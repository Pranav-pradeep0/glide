package com.glide.app.haptic

import android.content.Context
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import org.tensorflow.lite.Interpreter

/**
 * Hears what a film's sounds are (docs/haptics-decisions.md, Sound recognition): the decoded audio,
 * mixed to mono as ffmpeg does ([downmix]) and resampled to 16 kHz, through YAMNet
 * (`assets/yamnet.tflite`), one 0.975 s window every [HapticSounds.HOP_MS]. Each window's
 * [HapticSounds] group scores land in [windows], the track's sounds lane.
 *
 * Changing [HapticSounds.Group] changes what the cache holds: bump [HapticListener.VERSION].
 */
class HapticRecognizer(private val classify: (FloatArray) -> FloatArray) {
    val windows = ArrayList<FloatArray>()

    /** Time spent in [classify], for the analysis log. */
    var classifyMs = 0L
        private set

    private val window = FloatArray(WINDOW)
    private var filled = 0
    private var rate = 0
    private lateinit var aaA: HapticListener.Biquad
    private lateinit var aaB: HapticListener.Biquad
    private var ratio = 0.0
    private var inputs = 0L // input samples seen
    private var nextAt = 0.0 // input-sample time of the next 16 kHz sample
    private var prev = 0.0
    private var mix = FloatArray(0) // per-channel gains, [downmix]

    /** Interleaved PCM from its position to its limit, starting at [ptsUs]; as `PcmSink.add`. */
    fun add(ptsUs: Long, data: ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
        if (this.rate == 0) start(ptsUs, rate)
        if (mix.size != channels) mix = downmix(channels)
        data.order(ByteOrder.LITTLE_ENDIAN)
        val bytes = if (isFloat) 4 else 2
        var p = data.position()
        repeat((data.limit() - p) / (bytes * channels)) {
            var s = 0f
            for (c in 0 until channels) {
                s += mix[c] * if (isFloat) data.getFloat(p) else data.getShort(p) / 32768f
                p += bytes
            }
            sample(s)
        }
    }

    private fun start(ptsUs: Long, rate: Int) {
        this.rate = rate
        ratio = rate.toDouble() / RATE
        // 4th-order Butterworth under the new Nyquist (8 kHz), as the Listener's bed filter.
        aaA = HapticListener.Biquad(rate, ANTI_ALIAS_HZ, 0.5412)
        aaB = HapticListener.Biquad(rate, ANTI_ALIAS_HZ, 1.3066)
        // Windows on the film's grid (k * HOP_MS) wherever decoding starts: skip to the next line.
        val hopUs = HapticSounds.HOP_MS * 1000L
        val first = if (ptsUs <= 0) 0L else (ptsUs + hopUs - 1) / hopUs
        repeat(first.toInt()) { windows += FloatArray(HapticSounds.Group.entries.size) }
        nextAt = (first * hopUs - ptsUs) * rate / 1e6
    }

    /** Linear interpolation between filtered input samples. */
    private fun sample(x: Float) {
        val y = aaB.run(aaA.run(x.toDouble()))
        val i = inputs++
        while (nextAt <= i) {
            push((prev + (y - prev) * (nextAt - (i - 1))).toFloat())
            nextAt += ratio
        }
        prev = y
    }

    private fun push(s: Float) {
        window[filled++] = s
        if (filled < WINDOW) return
        val t0 = System.nanoTime()
        windows += HapticSounds.groups(classify(window))
        classifyMs += (System.nanoTime() - t0) / 1_000_000
        window.copyInto(window, 0, HOP, WINDOW)
        filled = WINDOW - HOP
    }

    companion object {
        const val RATE = 16000
        private const val WINDOW = 15600
        private const val HOP = RATE * HapticSounds.HOP_MS / 1000
        private const val ANTI_ALIAS_HZ = 7000.0

        /**
         * ffmpeg's mono downmix, which the labels and thresholds were tuned on: front pair 0.707,
         * centre 1, LFE out, the rest 0.5, in WAVE order (FL FR FC LFE BL BR SL SR) as MediaCodec
         * outputs it. Averaging every channel instead fed YAMNet 12 dB low on 5.1 and its scores
         * sank under the thresholds (Us: engine over 0.2 in 57 windows, not 208).
         */
        // ponytail: 3-5 and 7 channels take 0.707 each; layouts that rare don't carry a film's mix.
        fun downmix(channels: Int): FloatArray = when (channels) {
            1 -> floatArrayOf(1f)
            6, 8 -> FloatArray(channels) { listOf(0.707f, 0.707f, 1f, 0f).getOrElse(it) { 0.5f } }
            else -> FloatArray(channels) { 0.707f }
        }

        /**
         * YAMNet on the CPU as a classify function for [HapticRecognizer]s fed one at a time, and
         * its interpreter to close; null if it can't load: haptics then go on from the sound alone.
         */
        fun open(context: Context): Pair<(FloatArray) -> FloatArray, Interpreter>? = runCatching {
            val model = context.assets.openFd("yamnet.tflite").use { fd ->
                FileInputStream(fd.fileDescriptor).channel.use { it.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength) }
            }
            val interpreter = Interpreter(model, Interpreter.Options().setNumThreads(2))
            val out = Array(1) { FloatArray(HapticSounds.CLASSES) }
            val classify = { w: FloatArray -> interpreter.run(w, out); out[0] }
            classify to interpreter
        }.getOrNull()
    }
}
