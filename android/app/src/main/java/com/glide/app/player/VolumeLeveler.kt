package com.glide.app.player

import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.decoder.ffmpeg.FfmpegLibrary
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import androidx.media3.exoplayer.mediacodec.MediaCodecUtil
import java.nio.ByteBuffer
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The volume leveler: quieter action, clearer voices (docs/volume-leveler.md).
 *
 * Always in the sink's chain, so a toggle never rebuilds the player. Per frame:
 * dialogue-first mix (5.1/7.1 to stereo, centre lifted) -> compressor with make-up gain ->
 * look-ahead true-peak limiter. Off, the input passes through bit-exact.
 *
 * The output is held [latencyFrames] behind the input (the limiter's look-ahead) and the
 * held frames are released at end of stream, so frames out equal frames in and A/V sync
 * is untouched -- the sink's clock counts frames written.
 *
 * 5.1 and 7.1 change channel count when on, which only a sink reconfigure can apply:
 * [needsReconfigure] says so and [LevelerAudioSink] does it. Until then, and for other
 * counts (3, 4, 5, 7: FFmpeg and Android order them differently, so the centre is not
 * known), the dynamics run on all channels and the platform folds them down, as before.
 *
 * Runs after DefaultAudioSink's ToInt16 stage (custom processors only run without float
 * output), so 16-bit is the only encoding it can see; anything else stands it aside.
 */
@UnstableApi
class VolumeLeveler : BaseAudioProcessor() {

    /** Set from the main thread, read on the playback thread. */
    @Volatile var enabled = false

    // The latest configure, which may not be applied yet. Read from any thread.
    @Volatile private var configuredChannels = 0
    @Volatile private var configuredDownmix = false

    /** The output layout the last configure chose no longer matches [enabled]. */
    fun needsReconfigure(): Boolean =
        configuredChannels in LAYOUTS && configuredDownmix != enabled

    override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat {
        if (inputAudioFormat.encoding != C.ENCODING_PCM_16BIT) {
            configuredChannels = 0
            return AudioProcessor.AudioFormat.NOT_SET
        }
        val n = inputAudioFormat.channelCount
        val downmix = enabled && n in LAYOUTS
        configuredChannels = n
        configuredDownmix = downmix
        return if (downmix) AudioProcessor.AudioFormat(inputAudioFormat.sampleRate, 2, C.ENCODING_PCM_16BIT)
        else inputAudioFormat
    }

    // -- State, sized in onFlush for the applied format ------------------------------------

    private var inCh = 0
    private var outCh = 0
    private var rate = 0
    /** Row-major [out][in]; null is identity. */
    private var wetMix: DoubleArray? = null
    private var dryMix: DoubleArray? = null

    private var hold = 0
    var latencyFrames = 0
        private set
    private var ringFrames = 0
    private var xRing = ShortArray(0)
    private var yRing = DoubleArray(0)
    private var frame = 0L

    private var wetRunning = false
    private var wetFrom = 0L
    private var mix = 0.0
    private var fadeStep = 0.0

    // Compressor.
    private var shelf = Biquad.IDENTITY
    private var highPass = Biquad.IDENTITY
    private var kState = DoubleArray(0)
    private var aDet = 0.0
    private var aAtt = 0.0
    private var aRel = 0.0
    private var power = 0.0
    private var gainDb = 0.0
    /** Frames since the wet chain (re)started; the detector primes on the first ones. */
    private var primed = 0
    private var w = DoubleArray(0)

    // Limiter: segment peaks, sliding minimum, release, box average.
    private var lastSegment = 0.0
    private var dqIndex = LongArray(0)
    private var dqValue = DoubleArray(0)
    private var dqHead = 0
    private var dqSize = 0
    private var aLimRel = 0.0
    private var released = 1.0
    private var boxRing = DoubleArray(0)
    private var boxSum = 0.0

    private var ending = false
    private var tailDone = false

    override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
        ending = false
        tailDone = false
        if (inputAudioFormat == AudioProcessor.AudioFormat.NOT_SET) return
        inCh = inputAudioFormat.channelCount
        outCh = outputAudioFormat.channelCount
        rate = inputAudioFormat.sampleRate
        wetMix = if (outCh != inCh) downmix(inCh, DIALOGUE) else null
        dryMix = if (outCh != inCh) downmix(inCh, REFERENCE) else null

        hold = max(1, (rate * LOOKAHEAD_S).roundToInt())
        latencyFrames = hold + TAPS / 2 - 1
        ringFrames = latencyFrames + TAPS + 1
        xRing = ShortArray(ringFrames * inCh)
        yRing = DoubleArray(ringFrames * outCh)
        w = DoubleArray(outCh)
        frame = 0L

        fadeStep = 1.0 / (rate * FADE_S)
        shelf = Biquad.highShelf(rate, 1500.0, 4.0, 0.7071)
        highPass = Biquad.highPass(rate, 38.0, 0.5)
        aDet = coefficient(DETECT_S)
        aAtt = coefficient(ATTACK_S)
        aRel = coefficient(RELEASE_S)
        aLimRel = coefficient(LIMIT_RELEASE_S)
        dqIndex = LongArray(hold + 1)
        dqValue = DoubleArray(hold + 1)
        boxRing = DoubleArray(hold)

        // A flush is a new stream: start where the switch is, no fade.
        mix = if (enabled) 1.0 else 0.0
        wetRunning = false
        if (enabled) startWet()
    }

    override fun onReset() {
        configuredChannels = 0
        inCh = 0
    }

    override fun onQueueEndOfStream() {
        ending = true
    }

    override fun isEnded(): Boolean = super.isEnded() && tailDone

    override fun queueInput(inputBuffer: ByteBuffer) {
        if (!inputBuffer.hasRemaining()) {
            // Release the held frames once, after the last output has been taken.
            if (ending && !tailDone) {
                tailDone = true
                process(null, latencyFrames)
            }
            return
        }
        val frames = inputBuffer.remaining() / (inCh * 2)
        process(inputBuffer, frames)
        inputBuffer.position(inputBuffer.position() + frames * inCh * 2)
    }

    /** [frames] frames from [input], or silence when null (the end-of-stream tail). */
    private fun process(input: ByteBuffer?, frames: Int) {
        val first = frame
        val outFrames = max(0L, first + frames - max(first, latencyFrames.toLong())).toInt()
        val out = if (outFrames > 0) replaceOutputBuffer(outFrames * outCh * 2) else null
        val on = enabled
        val pos = input?.position() ?: 0

        for (i in 0 until frames) {
            val t = frame
            val slot = (t % ringFrames).toInt()
            for (c in 0 until inCh) {
                xRing[slot * inCh + c] = if (input == null) 0 else input.getShort(pos + (i * inCh + c) * 2)
            }
            if (on && !wetRunning) startWet()
            val gain = if (wetRunning) wetFrame(t, slot) else 1.0

            val f = t - latencyFrames
            if (f >= 0) {
                val target = if (on) 1.0 else 0.0
                if (f >= wetFrom || target == 0.0) {
                    mix = if (mix < target) min(target, mix + fadeStep) else max(target, mix - fadeStep)
                }
                writeFrame(out!!, (f % ringFrames).toInt(), gain)
                if (mix == 0.0 && !on) wetRunning = false
            }
            frame++
        }
        out?.flip()
    }

    private fun startWet() {
        wetRunning = true
        wetFrom = frame
        yRing.fill(0.0)
        kState = DoubleArray(outCh * 4 * 2)
        power = 0.0
        gainDb = 0.0
        primed = 0
        lastSegment = 0.0
        dqHead = 0
        dqSize = 0
        released = 1.0
        boxRing.fill(1.0)
        boxSum = hold.toDouble()
    }

    /**
     * Runs the wet chain for input frame [t] and returns the limiter gain for the frame
     * that leaves the delay now, t - [latencyFrames].
     */
    private fun wetFrame(t: Long, slot: Int): Double {
        // Mix.
        val m = wetMix
        for (o in 0 until outCh) {
            if (m == null) {
                w[o] = xRing[slot * inCh + o] / 32768.0
            } else {
                var s = 0.0
                for (c in 0 until inCh) s += m[o * inCh + c] * xRing[slot * inCh + c]
                w[o] = s / 32768.0
            }
        }

        // Compressor: K-weighted mean square, soft-knee curve, attack/release in dB.
        var ms = 0.0
        for (o in 0 until outCh) {
            val k = highPass.run(shelf.run(w[o], kState, o * 8), kState, o * 8 + 4)
            ms += k * k
        }
        // Until the look-ahead has filled once (after a seek or a switch-on), the level is the
        // plain mean so far and the gain follows it at once. Starting from silence instead
        // would play the first ~20 ms at full make-up gain: a bump after every seek.
        val priming = primed < latencyFrames
        if (priming) power += (ms / outCh - power) / ++primed else power += (ms / outCh - power) * aDet
        val over = 10 * log10(power + 1e-10) - THRESHOLD_DB
        val target = when {
            2 * over < -KNEE_DB -> 0.0
            2 * abs(over) <= KNEE_DB -> SLOPE * (over + KNEE_DB / 2).pow(2) / (2 * KNEE_DB)
            else -> SLOPE * over
        }
        gainDb = if (priming) target else gainDb + (target - gainDb) * (if (target < gainDb) aAtt else aRel)
        val g = 10.0.pow((gainDb + MAKEUP_DB) / 20)
        for (o in 0 until outCh) yRing[slot * outCh + o] = w[o] * g

        // Limiter. The segment between j and j+1 (j = t - TAPS/2) is now interpolable;
        // frame j's peak covers both segments either side of it.
        val j = t - TAPS / 2
        val segment = segmentPeak(j)
        var peak = max(lastSegment, segment)
        lastSegment = segment
        val js = (Math.floorMod(j, ringFrames.toLong())).toInt()
        for (o in 0 until outCh) peak = max(peak, abs(yRing[js * outCh + o]))
        val required = if (peak > CEILING) CEILING / peak else 1.0

        // Sliding minimum of the last `hold` requirements...
        while (dqSize > 0 && dqValue[(dqHead + dqSize - 1) % dqValue.size] >= required) dqSize--
        dqIndex[(dqHead + dqSize) % dqIndex.size] = j
        dqValue[(dqHead + dqSize) % dqValue.size] = required
        dqSize++
        if (dqIndex[dqHead] <= j - hold) { dqHead = (dqHead + 1) % dqIndex.size; dqSize-- }
        val held = dqValue[dqHead]
        // ...falling at once, recovering slowly (never above it)...
        released = if (held < released) held else released + (held - released) * aLimRel
        // ...averaged over `hold`: never above the requirement of frame j - hold + 1.
        val b = (Math.floorMod(j, hold.toLong())).toInt()
        boxSum += released - boxRing[b]
        boxRing[b] = released
        return min(1.0, boxSum / hold)
    }

    /** Largest |value| between frames j and j+1 at 4x, all channels. */
    private fun segmentPeak(j: Long): Double {
        var peak = 0.0
        val start = Math.floorMod(j - TAPS / 2 + 1, ringFrames.toLong()).toInt()
        for (o in 0 until outCh) {
            for (q in 0 until 3) {
                var v = 0.0
                val h = PHASES[q]
                var s = start
                for (i in 0 until TAPS) {
                    v += yRing[s * outCh + o] * h[i]
                    if (++s == ringFrames) s = 0
                }
                peak = max(peak, abs(v))
            }
        }
        return peak
    }

    private fun writeFrame(out: ByteBuffer, fs: Int, gain: Double) {
        val d = dryMix
        if (mix == 0.0 && d == null) {
            for (c in 0 until inCh) out.putShort(xRing[fs * inCh + c])
            return
        }
        for (o in 0 until outCh) {
            val wet = if (mix > 0.0) yRing[fs * outCh + o] * gain else 0.0
            val dry = if (mix < 1.0) {
                if (d == null) xRing[fs * inCh + o] / 32768.0
                else {
                    var s = 0.0
                    for (c in 0 until inCh) s += d[o * inCh + c] * xRing[fs * inCh + c]
                    s / 32768.0
                }
            } else 0.0
            val v = dry + (wet - dry) * mix
            out.putShort((v * 32768).roundToInt().coerceIn(-32768, 32767).toShort())
        }
    }

    /** One-pole smoothing coefficient for a time constant in seconds. */
    private fun coefficient(seconds: Double) = 1 - exp(-1 / (seconds * rate))

    private class Biquad(val b0: Double, val b1: Double, val b2: Double, val a1: Double, val a2: Double) {
        /** Direct form I; state[at..at+3] = x1, x2, y1, y2. */
        fun run(x: Double, state: DoubleArray, at: Int): Double {
            val y = b0 * x + b1 * state[at] + b2 * state[at + 1] - a1 * state[at + 2] - a2 * state[at + 3]
            state[at + 1] = state[at]; state[at] = x
            state[at + 3] = state[at + 2]; state[at + 2] = y
            return y
        }

        companion object {
            val IDENTITY = Biquad(1.0, 0.0, 0.0, 0.0, 0.0)

            // RBJ cookbook; these two make the K-weighting of ITU-R BS.1770.
            fun highShelf(rate: Int, fc: Double, gainDb: Double, q: Double): Biquad {
                val a = 10.0.pow(gainDb / 40)
                val w0 = 2 * PI * fc / rate
                val alpha = sin(w0) / (2 * q)
                val cw = cos(w0)
                val sa = 2 * sqrt(a) * alpha
                val a0 = (a + 1) - (a - 1) * cw + sa
                return Biquad(
                    a * ((a + 1) + (a - 1) * cw + sa) / a0,
                    -2 * a * ((a - 1) + (a + 1) * cw) / a0,
                    a * ((a + 1) + (a - 1) * cw - sa) / a0,
                    2 * ((a - 1) - (a + 1) * cw) / a0,
                    ((a + 1) - (a - 1) * cw - sa) / a0,
                )
            }

            fun highPass(rate: Int, fc: Double, q: Double): Biquad {
                val w0 = 2 * PI * fc / rate
                val alpha = sin(w0) / (2 * q)
                val cw = cos(w0)
                val a0 = 1 + alpha
                return Biquad((1 + cw) / 2 / a0, -(1 + cw) / a0, (1 + cw) / 2 / a0, -2 * cw / a0, (1 - alpha) / a0)
            }
        }
    }

    companion object {
        const val THRESHOLD_DB = -30.0
        const val RATIO = 3.0
        const val KNEE_DB = 12.0
        const val MAKEUP_DB = 9.0
        private const val SLOPE = 1 / RATIO - 1
        const val DETECT_S = 0.010
        const val ATTACK_S = 0.005
        const val RELEASE_S = 0.300
        /** -1 dBTP. */
        val CEILING = 10.0.pow(-1.0 / 20)
        const val LOOKAHEAD_S = 0.005
        const val LIMIT_RELEASE_S = 0.050
        const val FADE_S = 0.100

        /** Interpolation taps per 4x phase (Lanczos, a = TAPS / 2). */
        private const val TAPS = 12
        private val PHASES = Array(3) { q ->
            val phase = (q + 1) / 4.0
            val h = DoubleArray(TAPS) { i ->
                val d = phase + (TAPS / 2 - 1) - i
                sinc(d) * sinc(d / (TAPS / 2))
            }
            val sum = h.sum()
            DoubleArray(TAPS) { h[it] / sum }
        }

        private fun sinc(x: Double) = if (x == 0.0) 1.0 else sin(PI * x) / (PI * x)

        // Channel roles. 5.1 and 7.1 are the only counts whose order Android and FFmpeg agree
        // on (FL FR FC LFE, then back/side pairs).
        private const val L = 0; private const val R = 1; private const val CENTER = 2
        private const val LFE = 3; private const val SL = 4; private const val SR = 5
        private val LAYOUTS = mapOf(
            6 to intArrayOf(L, R, CENTER, LFE, SL, SR),
            8 to intArrayOf(L, R, CENTER, LFE, SL, SR, SL, SR),
        )

        /** Per role: centre, LFE, surround (fronts are 1). */
        private class Weights(val center: Double, val lfe: Double, val surround: Double)

        /** Android's own fold-down (audio_utils ChannelMix), what AudioTrack does today. */
        private val REFERENCE = Weights(0.7071, 0.5, 0.7071)
        /** Centre +4.5 dB over the reference, LFE -6 dB, surrounds -3 dB. */
        private val DIALOGUE = Weights(0.7071 * 10.0.pow(4.5 / 20), 0.25, 0.5)

        private fun downmix(n: Int, wt: Weights): DoubleArray {
            val roles = LAYOUTS.getValue(n)
            val m = DoubleArray(2 * n)
            for (c in 0 until n) {
                val (l, r) = when (roles[c]) {
                    L -> 1.0 to 0.0
                    R -> 0.0 to 1.0
                    CENTER -> wt.center to wt.center
                    LFE -> wt.lfe to wt.lfe
                    SL -> wt.surround to 0.0
                    else -> 0.0 to wt.surround
                }
                m[c] = l
                m[n + c] = r
            }
            return m
        }
    }
}

/**
 * The sink side of the leveler. While it is on, encoded audio is decoded instead of passed
 * through (a soundbar or TV decoding AC-3 itself would bypass every processor) -- but only
 * where a decoder exists, so a format nothing here decodes still plays. [reconfigure]
 * applies a multichannel layout change on the playback thread.
 */
@UnstableApi
class LevelerAudioSink(private val sink: AudioSink, private val leveler: VolumeLeveler) : ForwardingAudioSink(sink) {

    @Volatile private var lastConfig: AudioSink.AudioSinkConfig? = null

    /** Encoded formats passed through when off and decoded when on: a toggle re-opens them. */
    private val switchable: MutableSet<String> = ConcurrentHashMap.newKeySet()

    fun switchesPassthrough(format: Format?): Boolean = format != null && key(format) in switchable

    override fun supportsFormat(format: Format): Boolean =
        getFormatSupport(format) != AudioSink.SINK_FORMAT_UNSUPPORTED

    override fun getFormatSupport(format: Format): Int {
        val support = sink.getFormatSupport(format)
        if (format.sampleMimeType == MimeTypes.AUDIO_RAW || support == AudioSink.SINK_FORMAT_UNSUPPORTED ||
            !decodable(format)) {
            return support
        }
        switchable.add(key(format))
        return if (leveler.enabled) AudioSink.SINK_FORMAT_UNSUPPORTED else support
    }

    override fun configure(audioSinkConfig: AudioSink.AudioSinkConfig) {
        lastConfig = audioSinkConfig
        sink.configure(audioSinkConfig)
    }

    override fun reset() {
        lastConfig = null
        sink.reset()
    }

    /**
     * Playback thread only. Re-runs the last configure when the leveler's output layout no
     * longer matches its switch. The caller seeks to the current position right after, so the
     * flush applies it on a buffer boundary. Left to drain mid-buffer, the sink would restart
     * its clock at the start of a half-written buffer: A/V off by up to a buffer.
     */
    fun reconfigure() {
        val config = lastConfig ?: return
        if (config.format.sampleMimeType != MimeTypes.AUDIO_RAW || !leveler.needsReconfigure()) return
        try {
            // Without the encoder delay: a configure re-arms the start trim, which belongs to
            // the real start of the stream and would cut that much audio here.
            @Suppress("DEPRECATION")
            sink.configure(
                AudioSink.AudioSinkConfig.Builder(config.format.buildUpon().setEncoderDelay(0).build())
                    .setPreferredBufferSizeOverride(config.preferredBufferSizeOverride)
                    .setOutputChannelMapping(config.outputChannelMapping)
                    .setTimeline(config.timeline)
                    .setMediaPeriodId(config.mediaPeriodId)
                    .build()
            )
        } catch (e: AudioSink.ConfigurationException) {
            Log.w("LevelerAudioSink", "reconfigure failed: ${e.message}")
        }
    }

    private fun key(format: Format) =
        "${format.sampleMimeType}|${format.codecs}|${format.channelCount}|${format.sampleRate}"

    private fun decodable(format: Format): Boolean {
        val mime = format.sampleMimeType ?: return false
        if (FfmpegLibrary.supportsFormat(mime)) return true
        return try {
            MediaCodecUtil.getDecoderInfos(mime, false, false).isNotEmpty()
        } catch (e: MediaCodecUtil.DecoderQueryException) {
            false
        }
    }
}
