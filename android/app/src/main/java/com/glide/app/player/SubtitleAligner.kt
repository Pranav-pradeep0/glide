package com.glide.app.player

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Automatic subtitle sync by aligning *when people speak* with *when cues are shown* -- the
 * ffsubsync / alass idea, with no speech recognition, no network and no language dependence.
 *
 * 1. [speechLevels]: the audio, band-passed to the speech band (300-3000 Hz), as loudness in
 *    dB every 10 ms, minus the loudness of the surrounding [DETREND_S] so a music bed or a
 *    loud scene does not count as speech.
 * 2. [align]: slide the cue intervals across that loudness, +/-[MAX_SHIFT_S]. At each lag the
 *    score is mean loudness inside cues minus mean loudness outside them, which prefix sums
 *    make O(cues) per lag instead of O(frames). The best lag is the delay.
 * 3. The same search at the common frame-rate ratios ([RATIOS]) catches subtitles timed for a
 *    different frame rate, whose error grows through the film and no constant delay can fix.
 *
 * Pure arithmetic, so [SubtitleAlignerTest] runs it on the JVM. The bridge is
 * [SubtitleSyncModule].
 */
internal object SubtitleAligner {

    const val FRAME_S = 0.01
    const val MAX_SHIFT_S = 60.0

    /** Subtitle timed at one rate, video at another: cue times scale by these. */
    val RATIOS = doubleArrayOf(1.0, 25 / 23.976, 23.976 / 25, 25.0 / 24, 24.0 / 25, 24 / 23.976, 23.976 / 24)

    /**
     * Apply only when the peak stands this many robust sigmas above the typical lag, and no
     * other lag (further than [RUNNER_UP_GUARD_S] away) comes within [MAX_RUNNER_UP] of it.
     * Both guard against confidently applying a wrong delay, which is worse than none.
     */
    const val MIN_PEAK_Z = 6.0
    const val MAX_RUNNER_UP = 0.75
    const val RUNNER_UP_GUARD_S = 1.0

    /**
     * The other way to be sure: each half of the window, searched on its own over the full
     * range, lands on the same delay. A chance peak lands anywhere in +/-[MAX_SHIFT_S], so two
     * independent ones agreeing within [AGREE_TOLERANCE_S] is ~0.5% likely; real dialogue in a
     * busy mix often scores a low z yet agrees every time.
     */
    const val AGREE_MIN_Z = 2.0
    const val AGREE_TOLERANCE_S = 0.25

    /** Long enough to keep a line of dialogue, short enough to drop a scene's music bed. */
    const val DETREND_S = 8.0

    /** Minimum speech-cue time that must overlap the audio, or the score means nothing. */
    const val MIN_CUE_SECONDS = 20.0

    data class Result(
        /** Positive = show subtitles later, the app's `subtitleDelay` convention. */
        val delayS: Double,
        val ratio: Double,
        val peakZ: Double,
        val runnerUp: Double,
        val plainDelayS: Double = delayS,
        val plainPeakZ: Double = peakZ,
        val plainRunnerUp: Double = runnerUp,
        /** Both halves of the window found this delay on their own. */
        val agreed: Boolean = false,
    ) {
        val confident get() = agreed || (peakZ >= MIN_PEAK_Z && runnerUp <= MAX_RUNNER_UP)
        /** The best fit needs a frame-rate change, which a delay alone cannot apply. */
        val drift get() = confident && ratio != 1.0
    }

    /** 16-bit mono PCM to speech-band loudness in dB, one value per [FRAME_S]. */
    fun speechLevels(pcm: ShortArray, sampleRate: Int): FloatArray {
        val meter = SpeechMeter(sampleRate)
        for (s in pcm) meter.add(s / 32768.0)
        return meter.levels()
    }

    /**
     * [speechLevels] one sample at a time, at the source's own sample rate. The decoder feeds
     * this directly, so no audio is buffered and nothing is resampled: decimating 48 kHz to
     * 8 kHz without a low-pass folded music and effects above 4 kHz into the speech band and
     * left every alignment "unsure".
     */
    class SpeechMeter(sampleRate: Int) {
        private val hp = Biquad(sampleRate, 300.0, highPass = true)
        private val lp = Biquad(sampleRate, 3000.0, highPass = false)
        private val frame = (sampleRate * FRAME_S).roundToInt().coerceAtLeast(1)
        private var energy = 0.0
        private var count = 0
        private var levels = FloatArray(1024)
        private var size = 0

        /** One mono sample in [-1, 1]. */
        fun add(sample: Double) {
            val x = lp.process(hp.process(sample))
            energy += x * x
            if (++count == frame) {
                if (size == levels.size) levels = levels.copyOf(size * 2)
                levels[size++] = (10 * log10(energy / frame + 1e-10)).toFloat()
                energy = 0.0
                count = 0
            }
        }

        fun levels(): FloatArray = levels.copyOf(size)
    }

    /**
     * Where the cues ([starts]/[ends], seconds of video time) best line up with [levels], whose
     * first frame is at [windowStartS]. Null if too little cue time overlaps the audio.
     */
    fun align(levels: FloatArray, windowStartS: Double, starts: DoubleArray, ends: DoubleArray): Result? {
        if (levels.size < 2 * (MAX_SHIFT_S / FRAME_S)) return null
        val a = standardised(levels) ?: return null
        val prefix = prefixSums(a, 0, a.size)

        // A plain delay wins whenever it fits. 24/23.976 is only 0.1% from 1, so inside one window
        // it scores about the same as a delay, and letting the higher z win would randomly call
        // an in-sync subtitle "drifting". Other ratios are only for when no delay fits at all.
        val plain = alignAt(prefix, windowStartS, starts, ends, 1.0)
        if (plain?.confident == true) return plain
        if (plain != null && halvesAgree(a, windowStartS, starts, ends, plain)) return plain.copy(agreed = true)

        val best = (listOfNotNull(plain) + RATIOS.drop(1).mapNotNull { alignAt(prefix, windowStartS, starts, ends, it) })
            .maxByOrNull { it.peakZ } ?: return null
        return if (plain == null) best
        else best.copy(plainDelayS = plain.delayS, plainPeakZ = plain.peakZ, plainRunnerUp = plain.runnerUp)
    }

    /**
     * Loudness floored so digital silence does not dominate, minus its moving average over
     * [DETREND_S] -- a music bed or a loud scene lifts cues and gaps alike, and only the change
     * where speech starts and stops should score -- then standardised.
     */
    private fun standardised(levels: FloatArray): DoubleArray? {
        val n = levels.size
        val a = DoubleArray(n) { levels[it].coerceIn(-80f, 0f).toDouble() }
        val p = prefixSums(a, 0, n)
        val half = (DETREND_S / 2 / FRAME_S).roundToInt()
        val d = DoubleArray(n) {
            val lo = max(0, it - half)
            val hi = min(n, it + half + 1)
            a[it] - (p[hi] - p[lo]) / (hi - lo)
        }
        val mean = d.average()
        val sd = sqrt(d.sumOf { (it - mean) * (it - mean) } / n)
        if (sd < 1e-6) return null
        return DoubleArray(n) { (d[it] - mean) / sd }
    }

    private fun prefixSums(a: DoubleArray, from: Int, to: Int): DoubleArray {
        val p = DoubleArray(to - from + 1)
        for (i in from until to) p[i - from + 1] = p[i - from] + a[i]
        return p
    }

    private fun halvesAgree(
        a: DoubleArray, windowStartS: Double, starts: DoubleArray, ends: DoubleArray, plain: Result,
    ): Boolean {
        if (plain.peakZ < AGREE_MIN_Z) return false
        val half = a.size / 2
        return (0..1).all { k ->
            val from = k * half
            val r = alignAt(
                prefixSums(a, from, from + half), windowStartS + from * FRAME_S, starts, ends, 1.0,
                minCueS = MIN_CUE_SECONDS / 2,
            )
            r != null && abs(r.delayS - plain.delayS) <= AGREE_TOLERANCE_S
        }
    }

    private fun alignAt(
        prefix: DoubleArray, windowStartS: Double,
        starts: DoubleArray, ends: DoubleArray, ratio: Double,
        minCueS: Double = MIN_CUE_SECONDS,
    ): Result? {
        val n = prefix.size - 1
        val maxLag = (MAX_SHIFT_S / FRAME_S).roundToInt()
        // Cue intervals in audio frames at lag 0, merged, keeping only those that can reach the
        // window at some lag.
        val intervals = starts.indices
            .map { (starts[it] * ratio - windowStartS) / FRAME_S to (ends[it] * ratio - windowStartS) / FRAME_S }
            .filter { (s, e) -> e > s && e > -maxLag && s < n + maxLag }
            .sortedBy { it.first }
            .fold(mutableListOf<Pair<Double, Double>>()) { merged, iv ->
                val last = merged.lastOrNull()
                if (last != null && iv.first <= last.second) merged[merged.size - 1] = last.first to maxOf(last.second, iv.second)
                else merged += iv
                merged
            }
        if (intervals.isEmpty()) return null
        val minIn = (minCueS / FRAME_S).roundToInt()
        val total = prefix[n]

        val scores = DoubleArray(2 * maxLag + 1) { idx ->
            val lag = idx - maxLag
            var sumIn = 0.0
            var nIn = 0
            for ((s, e) in intervals) {
                val lo = (s + lag).roundToInt().coerceIn(0, n)
                val hi = (e + lag).roundToInt().coerceIn(0, n)
                if (hi > lo) { sumIn += prefix[hi] - prefix[lo]; nIn += hi - lo }
            }
            if (nIn < minIn || n - nIn < minIn) Double.NaN
            else sumIn / nIn - (total - sumIn) / (n - nIn)
        }

        val finite = scores.filter { !it.isNaN() }.sorted()
        if (finite.size < scores.size / 2) return null
        val median = finite[finite.size / 2]
        val mad = finite.map { abs(it - median) }.sorted()[finite.size / 2]
        val sigma = 1.4826 * mad
        val guard = (RUNNER_UP_GUARD_S / FRAME_S).roundToInt()
        // A maximum on the edge of the search is not a peak, only a slope the range cut off.
        val peak = (guard until scores.size - guard)
            .filter { !scores[it].isNaN() }
            .maxByOrNull { scores[it] } ?: return null
        val runner = scores.indices
            .filter { abs(it - peak) > guard && !scores[it].isNaN() }
            .maxOfOrNull { scores[it] } ?: median
        val height = scores[peak] - median
        if (sigma <= 0 || height <= 0) return null

        // Sub-frame peak by parabola through the three samples around it.
        val left = scores[peak - 1].takeUnless { it.isNaN() } ?: scores[peak]
        val right = scores[peak + 1].takeUnless { it.isNaN() } ?: scores[peak]
        val curvature = left - 2 * scores[peak] + right
        val fraction = if (curvature < 0) (0.5 * (left - right) / curvature).coerceIn(-0.5, 0.5) else 0.0

        return Result(
            delayS = (peak - maxLag + fraction) * FRAME_S,
            ratio = ratio,
            peakZ = height / sigma,
            runnerUp = (runner - median) / height,
        )
    }

    /** RBJ cookbook second-order filter, Q = 1/sqrt(2). */
    private class Biquad(sampleRate: Int, cutoff: Double, highPass: Boolean) {
        private val b0: Double
        private val b1: Double
        private val b2: Double
        private val a1: Double
        private val a2: Double
        private var x1 = 0.0
        private var x2 = 0.0
        private var y1 = 0.0
        private var y2 = 0.0

        init {
            val w = 2 * PI * cutoff / sampleRate
            val alpha = sin(w) / (2 * 0.7071067811865476)
            val c = cos(w)
            val a0 = 1 + alpha
            val k = if (highPass) (1 + c) / 2 else (1 - c) / 2
            b0 = k / a0
            b1 = (if (highPass) -(1 + c) else 1 - c) / a0
            b2 = k / a0
            a1 = -2 * c / a0
            a2 = (1 - alpha) / a0
        }

        fun process(x: Double): Double {
            val y = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            return y
        }
    }
}
