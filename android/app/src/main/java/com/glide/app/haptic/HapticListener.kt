package com.glide.app.haptic

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * The Listener (docs/haptics-engine-plan.md 3.2, Phase 3): turns a film's decoded audio into a raw
 * [HapticTrack]. Pure Kotlin, so `HapticListenerTest` scores it on the generated clips.
 *
 * - Bed: level of the mix below [BED_HZ], every 10 ms frame, faded by how much of the sound is down
 *   there over the last 200 ms. Voices and music have some energy below 100 Hz but little of it
 *   (under 12% in the clips); rumble and engines have 25-90%.
 * - Hits: onsets in 1 ms blocks of the mix. A hit is a jump in energy over both the moment just
 *   before and the scene's recent level, so an impact over dialogue counts but a sentence starting
 *   after a pause doesn't. Its time is the first block of the rise.
 * - Intensity is loudness; sharpness is brightness (RMS frequency of the onset), which also sets
 *   the pulse length: bright and short, dull and long (decision L5).
 *
 * Values are raw, film-independent levels. The Director (Phase 4) decides what is felt and how
 * strong relative to the whole film. Feed [add] in order, then [finish]; [track] snapshots.
 */
class HapticListener {
    private var rate = 0
    private var block = 0 // samples per 1 ms block
    private var frame = 0 // samples per bed frame
    private var startMs = 0
    private lateinit var lowA: Biquad
    private lateinit var lowB: Biquad

    // Mix state.
    private var prev = 0f
    private var inBlock = 0
    private var blockE = 0.0
    private var blockD = 0.0
    private var inFrame = 0
    private var frameE = 0.0
    private var lastFrameE = 0.0
    private var frameAll = 0.0
    private val shareLow = DoubleArray(SHARE_FRAMES)
    private val shareAll = DoubleArray(SHARE_FRAMES)
    private var frames = 0

    // Block energies (mean square) and of the first difference, by block index.
    private val energy = DoubleArray(RING)
    private val diff = DoubleArray(RING)
    private val lowE = DoubleArray(RING)
    private var blockL = 0.0
    private var blocks = 0 // completed blocks
    private var evaluated = 0 // next block to judge
    private var beforeSum = 0.0
    private var contextSum = 0.0

    // A rise being followed: first block above the threshold, its reference level, best ratio.
    private var riseAt = -1
    private var riseRef = 0.0
    private var riseBest = 0.0
    private var riseLoud = 0.0
    private var riseCtx = 0.0
    private var quietUntil = 0

    private var bed = FloatArray(1 shl 12)
    private var bedSize = 0
    private val events = ArrayList<HapticTrack.Event>()

    /** Media time analysed so far. */
    val analysedMs get() = if (rate == 0) 0 else startMs + ((evaluated.toLong() * block * 1000) / rate).toInt()

    /** Interleaved PCM from its position to its limit, starting at [ptsUs]; as `PcmSink.add`. */
    fun add(ptsUs: Long, data: ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
        if (this.rate == 0) start(ptsUs, rate)
        data.order(ByteOrder.LITTLE_ENDIAN)
        val bytes = if (isFloat) 4 else 2
        var p = data.position()
        repeat((data.limit() - p) / (bytes * channels)) {
            var s = 0f
            for (c in 0 until channels) {
                s += if (isFloat) data.getFloat(p) else data.getShort(p) / 32768f
                p += bytes
            }
            sample(s / channels)
        }
    }

    /** End of the audio: judges the last blocks. */
    fun finish() {
        if (rate == 0) return
        repeat((LOOK + 1) * block) { sample(0f) }
    }

    fun track(fingerprint: HapticTrack.Fingerprint): HapticTrack {
        val frames = minOf(bedSize, analysedMs / HapticTrack.BED_FRAME_MS)
        return HapticTrack(VERSION, fingerprint, bed.copyOf(frames), FloatArray(frames), events.toList())
    }

    private fun start(ptsUs: Long, rate: Int) {
        this.rate = rate
        block = rate / 1000
        frame = rate * HapticTrack.BED_FRAME_MS / 1000
        startMs = (ptsUs / 1000).toInt().coerceAtLeast(0)
        // 4th-order Butterworth low-pass: two biquads.
        lowA = Biquad(rate, BED_HZ, 0.5412)
        lowB = Biquad(rate, BED_HZ, 1.3066)
        repeat(startMs / HapticTrack.BED_FRAME_MS) { pushBed(0f) }
    }

    private fun sample(x: Float) {
        val low = lowB.run(lowA.run(x.toDouble()))
        frameE += low * low
        blockL += low * low
        frameAll += x * x
        if (++inFrame == frame) {
            val e = frameE / frame
            shareLow[frames % SHARE_FRAMES] = frameE
            shareAll[frames++ % SHARE_FRAMES] = frameAll
            val share = shareLow.sum() / (shareAll.sum() + 1e-12)
            val weight = ((share - SHARE_FROM) / (SHARE_FULL - SHARE_FROM)).coerceIn(0.0, 1.0).toFloat()
            pushBed(weight * bedLevel(sqrt((e + lastFrameE) / 2))) // 20 ms window: a 50 Hz cycle reads steady
            lastFrameE = e
            frameE = 0.0
            frameAll = 0.0
            inFrame = 0
        }
        val d = x - prev
        prev = x
        blockE += x * x
        blockD += d * d
        if (++inBlock == block) {
            energy[blocks and MASK] = blockE / block
            diff[blocks and MASK] = blockD / block
            lowE[blocks and MASK] = blockL / block
            blockL = 0.0
            blocks++
            blockE = 0.0
            blockD = 0.0
            inBlock = 0
            while (evaluated + LOOK < blocks) judge(evaluated++)
        }
    }

    private fun e(i: Int) = if (i < 0) 0.0 else energy[i and MASK]

    /** Decides block [j]; blocks up to j + LOOK are known. */
    private fun judge(j: Int) {
        beforeSum += e(j - 1) - e(j - 1 - BEFORE)
        // Mean amplitude, squared: steady sound reads as its level, one loud click hardly moves it.
        contextSum += sqrt(e(j - 1)) - sqrt(e(j - 1 - CONTEXT))
        // The loudest window soon after: a boom builds for ~20 ms, by then "before" holds its start.
        var window = 0.0
        for (i in j until j + AFTER) window += e(i)
        var after = window
        for (k in j + 1..j + PEAK_WITHIN) {
            window += e(k + AFTER - 1) - e(k - 1)
            after = maxOf(after, window)
        }
        after /= AFTER
        val context = contextSum / CONTEXT
        val ref = maxOf(beforeSum / BEFORE, context * context, FLOOR)
        val ratio = after / ref
        val rising = ratio > RATIO && after > MIN_ENERGY
        if (riseAt < 0) {
            if (!rising || j < quietUntil) return
            riseAt = j
            riseRef = ref
            riseCtx = context * context
            riseBest = 0.0
        }
        if (ratio > riseBest) {
            riseBest = ratio
            riseLoud = after
        }
        if (rising && j - riseAt < MAX_RISE) return
        emit(j)
    }

    /** Places the rise followed since [riseAt], judged up to block [j], and keeps it if it's a hit. */
    private fun emit(j: Int) {
        // The first block that clearly rose: the window above finds the hit, this finds its start.
        val end = j + AFTER + PEAK_WITHIN
        var peak = 0.0
        for (i in riseAt until end) peak = maxOf(peak, e(i))
        val gate = maxOf(riseRef * RISE, peak * 0.05)
        var at = riseAt
        while (at < end - AFTER && e(at) <= gate) at++
        riseAt = -1
        quietUntil = at + REFRACTORY

        // A hit has weight, or is far above a scene we have heard. Dialogue and these mixes'
        // music have almost nothing below 100 Hz; impacts, explosions and sub hits do.
        var low = 0.0
        var all = 0.0
        for (i in at until at + WEIGHT_MS) {
            low += lowE[i and MASK]
            all += e(i)
        }
        val weighty = low >= WEIGHT_SHARE * all
        val standsOut = j >= CONTEXT && riseLoud >= ALONE * riseCtx
        if (!weighty && !standsOut) return

        var es = 0.0
        var ds = 0.0
        for (i in at until at + AFTER) {
            es += e(i)
            ds += diff[i and MASK]
        }
        val loudness = 10 * log10(riseLoud + 1e-12) // dBFS of the loudest 10 ms
        val hz = sqrt(ds / es.coerceAtLeast(1e-12)) * rate / (2 * PI) // RMS frequency of the attack
        val sharpness = ((ln(hz / 50) / ln(4000.0 / 50)).toFloat()).coerceIn(0f, 1f)
        events += HapticTrack.Event(
            timeMs = startMs + ((at.toLong() * block * 1000) / rate).toInt(),
            intensity = ((loudness + 40) / 40).toFloat().coerceIn(0f, 1f),
            sharpness = sharpness,
            lengthMs = (80 - 50 * sharpness).roundToInt(),
            decayMs = (150 * (1 - sharpness)).roundToInt(),
            sources = HapticTrack.SOURCE_AUDIO
        )
    }

    private fun bedLevel(rms: Double): Float {
        val db = 20 * log10(rms + 1e-12)
        return if (db < BED_FLOOR_DB) 0f else ((db - BED_FLOOR_DB) / -BED_FLOOR_DB).toFloat().coerceIn(0f, 1f)
    }

    private fun pushBed(v: Float) {
        if (bedSize == bed.size) bed = bed.copyOf(bed.size * 2)
        bed[bedSize++] = v
    }

    /** RBJ low-pass, doubles: at 100 Hz of 48 kHz the poles sit too near 1 for floats. */
    internal class Biquad(rate: Int, hz: Double, q: Double) {
        private val b0: Double
        private val b1: Double
        private val a1: Double
        private val a2: Double
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        init {
            val k = tan(PI * hz / rate)
            val norm = 1 / (1 + k / q + k * k)
            b0 = k * k * norm
            b1 = 2 * b0
            a1 = 2 * (k * k - 1) * norm
            a2 = (1 - k / q + k * k) * norm
        }

        fun run(x: Double): Double {
            val y = b0 * x + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2
            x2 = x1
            x1 = x
            y2 = y1
            y1 = y
            return y
        }
    }

    companion object {
        /** Bump when the output changes: cached tracks are rebuilt. */
        const val VERSION = 2

        const val BED_HZ = 100.0
        private const val BED_FLOOR_DB = -45.0
        private const val SHARE_FRAMES = 20 // 200 ms
        private const val SHARE_FROM = 0.15 // no bed at or below this share of the sound
        private const val SHARE_FULL = 0.3 // full bed from here

        // Onsets, in 1 ms blocks.
        private const val AFTER = 10 // the window judged as the hit
        private const val BEFORE = 50 // the moment just before
        private const val CONTEXT = 1500 // the scene's recent level
        private const val PEAK_WITHIN = 20
        private const val WEIGHT_MS = 30 // low-band share is measured over the attack
        private const val LOOK = AFTER + PEAK_WITHIN + WEIGHT_MS
        private const val MAX_RISE = 20
        private const val REFRACTORY = 50
        private const val RATIO = 10.0 // 10 dB over both
        private const val RISE = 4.0 // a block 6 dB over the reference starts the hit
        private const val WEIGHT_SHARE = 0.15
        private const val ALONE = 316.0 // 25 dB over the scene
        private const val MIN_ENERGY = 1e-5 // -50 dBFS: hiss rising out of digital silence isn't a hit
        private const val FLOOR = 1e-7
        private const val RING = 2048
        private const val MASK = RING - 1
    }
}
