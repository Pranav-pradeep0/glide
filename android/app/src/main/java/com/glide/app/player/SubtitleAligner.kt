package com.glide.app.player

import com.glide.app.haptic.HapticSounds
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
 *    loud scene does not count as speech. Where YAMNet ran, its Speech score ([scoreFrames]) too.
 * 2. [align] over short [Clip]s spread through the film: in each clip, slide the cue intervals
 *    across the signal, +/-[MAX_SHIFT_S]; at each lag the score is mean level inside cues minus
 *    mean level outside, as a robust z. A clip's loudness and Speech curves are averaged (they
 *    hear the same dialogue, so they count once) and the clips' curves summed / sqrt(count):
 *    the true lag lines up in every clip, chance peaks do not. Every ratio in [RATIOS] is tried
 *    the same way, so a subtitle timed for another frame rate is retimed exactly.
 * 3. A mid-film edit (the delay changes partway) splits the clips into two camps; [align] then
 *    answers for the viewer's side only, or refuses.
 *
 * Tuned on 12 real films with scripts/subsync-bench.py (8 x 60 s clips): 94.8% of shifted
 * subtitles right (one more 0.32 s off), 44/48 frame-rate drifts retimed, none wrong; no other
 * film's subtitle applied (0/132); mid-film edits 49/72 right for the viewer's side, the rest
 * refused. Loudness alone (YAMNet unavailable): 80.2%, likewise none wrong. Pure arithmetic, so
 * [SubtitleAlignerTest] runs it on the JVM.
 * The bridge is [SubtitleSyncModule].
 */
internal object SubtitleAligner {

    const val FRAME_S = 0.01
    /** On 12 real films, +/-150 s found 130 s errors with no more refusals or false matches than +/-60. */
    const val MAX_SHIFT_S = 150.0

    /** Subtitle timed at one rate, video at another: cue times scale by these. */
    val RATIOS = doubleArrayOf(1.0, 25 / 23.976, 23.976 / 25, 25.0 / 24, 24.0 / 25, 24 / 23.976, 23.976 / 24)

    /**
     * Apply only when the summed peak stands this many robust sigmas up, and no other lag (further
     * than [RUNNER_UP_GUARD_S] away) reaches [MAX_RUNNER_UP] of it. A wrong delay applied is worse
     * than none: on the benchmark, other films' subtitles peaked at up to z 5.9.
     */
    const val MIN_PEAK_Z = 6.0
    const val MAX_RUNNER_UP = 0.6
    const val RUNNER_UP_GUARD_S = 1.0

    /** A frame-rate answer had six more chances at a fluke than a plain delay: it needs this much more z. */
    const val RATIO_EXTRA_Z = 1.0

    /** A clip scoring this at a lag backs it; a clip whose own peak is [DISAGREE_Z] elsewhere opposes it. */
    const val SUPPORT_Z = 2.0
    const val DISAGREE_Z = 5.0

    /** A frame-rate answer misses a clip whose own peak this tall, within 1.5 s, is further than [TIGHT_S] off. */
    const val TIGHT_Z = 6.0
    const val TIGHT_S = 0.25

    /** Long enough to keep a line of dialogue, short enough to drop a scene's music bed. */
    const val DETREND_S = 8.0

    /** Speech-cue time that must overlap a clip at a lag, as a share of the clip, or that lag means nothing. */
    private const val MIN_CUE_SHARE = 1 / 15.0

    /** A clip of the film: [energy] from [speechLevels], [speech] from [scoreFrames] or null, both from [startS]. */
    class Clip(val startS: Double, val energy: FloatArray, val speech: FloatArray? = null)

    data class Result(
        /** Positive = show subtitles later, the app's `subtitleDelay` convention. */
        val delayS: Double,
        /** A cue at subtitle time c belongs at c * ratio + delayS. */
        val ratio: Double,
        val peakZ: Double,
        val runnerUp: Double,
    )

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
     * The subtitle delay and ratio that line [starts]/[ends] (speech cues, subtitle seconds) up
     * with [clips], for a viewer at [positionS]; null when nothing is sure enough to apply.
     */
    fun align(clips: List<Clip>, starts: DoubleArray, ends: DoubleArray, positionS: Double): Result? {
        // Every clip at every ratio, on all cores: independent, and most of the run's time.
        val jobs = RATIOS.flatMap { q -> clips.indices.map { q to it } }
        val computed: List<DoubleArray?> = jobs.parallelStream()
            .map { (q, i) -> clipCurve(clips[i], starts, ends, q) }
            .collect(java.util.stream.Collectors.toList())
        val curves = RATIOS.withIndex().associate { (r, q) -> q to computed.subList(r * clips.size, (r + 1) * clips.size) }
        val all = clips.indices.toList()
        val a = solve(curves, all) ?: return null
        val opposed = all.filter { i -> curves.getValue(a.ratio)[i]?.let { disagrees(it, a.peak) } == true }
        val (answer, kept) = if (opposed.isEmpty()) a to all
        else viewerSide(curves, clips, positionS, a, opposed) ?: return null
        if (!answer.fits || (answer.ratio != 1.0 && answer.z < MIN_PEAK_Z + RATIO_EXTRA_Z)) return null
        // One of the two clips nearest the viewer must back it: an edit on a side with no clear
        // dialogue opposes nothing, and would otherwise hand the viewer the other side's delay.
        val chosen = curves.getValue(answer.ratio)
        val near = kept.filter { chosen[it] != null }.sortedBy { abs(centre(clips[it]) - positionS) }.take(2)
        if (near.none { at(chosen[it]!!, answer.peak) >= SUPPORT_Z }) return null
        // A frame-rate answer must sit on every clip's own sharp peak: a 24/23.976 retime (0.1%)
        // can pass for a mid-film step of a second or two, and then misses the clips at the ends.
        if (answer.ratio != 1.0 && kept.any { chosen[it]?.let { c -> !tight(c, answer.peak) } == true }) return null
        return Result(answer.delayS, answer.ratio, answer.z, answer.runnerUp)
    }

    /** The clip's sharpest peak within 1.5 s of [peak], if it stands [TIGHT_Z] tall, is within [TIGHT_S] of it. */
    private fun tight(c: DoubleArray, peak: Int): Boolean {
        var own = max(0, peak - 150)
        for (i in own..min(c.size - 1, peak + 150)) if (c[i] > c[own]) own = i
        return c[own] < TIGHT_Z || abs(own - peak) <= (TIGHT_S / FRAME_S).roundToInt()
    }

    /**
     * Some clips are sure of another lag. If they and the rest split the film at one point (an
     * edit), the answer from the clips on the viewer's side, with those clips; else null.
     */
    private fun viewerSide(
        curves: Map<Double, List<DoubleArray?>>, clips: List<Clip>, positionS: Double, a: Solved, opposed: List<Int>,
    ): Pair<Solved, List<Int>>? {
        val b = (if (opposed.size >= 2) solve(curves, opposed) else null) ?: return null
        // Each clip votes for the answer it backs more, if it backs either.
        val vote = clips.indices.map { i ->
            val va = curves.getValue(a.ratio)[i]?.let { at(it, a.peak) } ?: 0.0
            val vb = curves.getValue(b.ratio)[i]?.let { at(it, b.peak) } ?: 0.0
            if (max(va, vb) < SUPPORT_Z) null else va >= vb
        }
        val voters = clips.indices.filter { vote[it] != null }
        if (voters.zipWithNext().count { (x, y) -> vote[x] != vote[y] } != 1) return null
        val near = voters.minBy { abs(centre(clips[it]) - positionS) }
        val side = if (vote[near] == true) a else b
        val others = voters.filter { vote[it] != vote[near] }
        val kept = clips.indices.filter { if (near < others.first()) it < others.first() else it > others.last() }
        val r = solve(curves, kept) ?: return null
        return if (r.ratio == side.ratio && abs(r.delayS - side.delayS) <= 0.3) r to kept else null
    }

    private class Solved(val ratio: Double, val peak: Int, val delayS: Double, val z: Double, val runnerUp: Double) {
        val fits get() = z >= MIN_PEAK_Z && runnerUp <= MAX_RUNNER_UP
    }

    /** The best ratio and lag over clips [idx], their curves summed / sqrt(count). */
    private fun solve(curves: Map<Double, List<DoubleArray?>>, idx: List<Int>): Solved? {
        val guard = (RUNNER_UP_GUARD_S / FRAME_S).roundToInt()
        val maxLag = (MAX_SHIFT_S / FRAME_S).roundToInt()
        var best: Solved? = null
        for ((q, per) in curves) {
            val ps = idx.mapNotNull { per[it] }
            if (ps.size < 2) continue
            val norm = sqrt(ps.size.toDouble())
            val tot = DoubleArray(ps[0].size) { i -> ps.sumOf { it[i] } / norm }
            // A maximum on the edge of the search is not a peak, only a slope the range cut off.
            var p = guard
            for (i in guard until tot.size - guard) if (tot[i] > tot[p]) p = i
            var runner = Double.NEGATIVE_INFINITY
            for (i in tot.indices) if (abs(i - p) > guard && tot[i] > runner) runner = tot[i]
            // Sub-frame peak by parabola through the three samples around it.
            val curvature = tot[p - 1] - 2 * tot[p] + tot[p + 1]
            val fraction = if (curvature < 0) (0.5 * (tot[p - 1] - tot[p + 1]) / curvature).coerceIn(-0.5, 0.5) else 0.0
            if (best == null || tot[p] > best.z) best = Solved(q, p, (p - maxLag + fraction) * FRAME_S, tot[p], runner / tot[p])
        }
        return best
    }

    /** A clip's robust-z curve over every lag at [ratio]: loudness and Speech averaged, or whichever exists. */
    private fun clipCurve(clip: Clip, starts: DoubleArray, ends: DoubleArray, ratio: Double): DoubleArray? {
        val minCueS = clip.energy.size * FRAME_S * MIN_CUE_SHARE
        val curves = listOfNotNull(
            standardised(clip.energy, clampDb = true)?.let { lagCurve(it, clip.startS, starts, ends, ratio, minCueS) },
            clip.speech?.takeIf { it.size == clip.energy.size }
                ?.let { standardised(it, clampDb = false) }
                ?.let { lagCurve(it, clip.startS, starts, ends, ratio, minCueS) },
        )
        if (curves.isEmpty()) return null
        return DoubleArray(curves[0].size) { i -> curves.sumOf { it[i] } / curves.size }
    }

    private fun centre(clip: Clip) = clip.startS + clip.energy.size * FRAME_S / 2

    /** The curve's best value within 3 frames of [peak]: lags that close are the same answer. */
    private fun at(c: DoubleArray, peak: Int): Double {
        var m = Double.NEGATIVE_INFINITY
        for (i in max(0, peak - 3)..min(c.size - 1, peak + 3)) m = max(m, c[i])
        return m
    }

    /** Sure of a lag of its own, more than 0.5 s from [peak], and weak at [peak]. */
    private fun disagrees(c: DoubleArray, peak: Int): Boolean {
        var own = 0
        for (i in c.indices) if (c[i] > c[own]) own = i
        return c[own] >= DISAGREE_Z && abs(own - peak) > 50 && at(c, peak) < SUPPORT_Z
    }

    /**
     * Loudness floored so digital silence does not dominate (off for a 0..1 score series, which
     * it would flatten), minus its moving average over [DETREND_S] -- a music bed or a loud scene
     * lifts cues and gaps alike, and only the change where speech starts and stops should score --
     * then standardised. Null if flat.
     */
    private fun standardised(levels: FloatArray, clampDb: Boolean): DoubleArray? {
        val n = levels.size
        if (n == 0) return null
        val a = DoubleArray(n) { (if (clampDb) levels[it].coerceIn(-80f, 0f) else levels[it]).toDouble() }
        val p = prefixSums(a)
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

    /**
     * YAMNet Speech scores, one per sound window (window k hears [k * HOP_MS, k * HOP_MS +
     * WINDOW_MS) of the film, as the haptics sounds lane holds them), as up to [frames] levels
     * [FRAME_S] apart from [windowStartS], for a [Clip]'s speech. A score sits at its window's
     * centre and frames between two centres take the straight line between them; frames before
     * the first centre take its score, and frames past the last are left out, as where the audio ends.
     */
    fun scoreFrames(scores: FloatArray, windowStartS: Double, frames: Int): FloatArray {
        if (scores.isEmpty()) return FloatArray(0)
        val hop = HapticSounds.HOP_MS / 1000.0
        val centre = HapticSounds.WINDOW_MS / 2000.0
        val lastS = (scores.size - 1) * hop + centre
        val n = min(frames, ((lastS - windowStartS) / FRAME_S).toInt() + 1).coerceAtLeast(0)
        return FloatArray(n) {
            val x = ((windowStartS + it * FRAME_S - centre) / hop).coerceIn(0.0, scores.size - 1.0)
            val k = x.toInt()
            val next = scores[min(k + 1, scores.size - 1)]
            (scores[k] + (next - scores[k]) * (x - k)).toFloat()
        }
    }

    /**
     * Mean of [a] (a standardised clip from [windowStartS]) inside the cues minus outside, at
     * every lag in +/-[MAX_SHIFT_S], as a robust z; 0 where too little cue time overlaps.
     * Prefix sums make each lag O(cues), not O(frames). Null if most lags overlap too little.
     */
    private fun lagCurve(
        a: DoubleArray, windowStartS: Double, starts: DoubleArray, ends: DoubleArray, ratio: Double, minCueS: Double,
    ): DoubleArray? {
        val prefix = prefixSums(a)
        val n = a.size
        val maxLag = (MAX_SHIFT_S / FRAME_S).roundToInt()
        // Cue intervals in frames at lag 0, merged, keeping only those that can reach the clip at some lag.
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
        // Rounded once: round(x + lag) == round(x) + lag for a whole-frame lag, so the 30,000-lag
        // loop below is integer adds over primitive arrays (4.6 s -> well under 1 s on a phone).
        val lo0 = IntArray(intervals.size) { intervals[it].first.roundToInt() }
        val hi0 = IntArray(intervals.size) { intervals[it].second.roundToInt() }
        val minIn = (minCueS / FRAME_S).roundToInt()
        val total = prefix[n]
        val scores = DoubleArray(2 * maxLag + 1) { idx ->
            val lag = idx - maxLag
            var sumIn = 0.0
            var nIn = 0
            for (k in lo0.indices) {
                val lo = (lo0[k] + lag).coerceIn(0, n)
                val hi = (hi0[k] + lag).coerceIn(0, n)
                if (hi > lo) { sumIn += prefix[hi] - prefix[lo]; nIn += hi - lo }
            }
            if (nIn < minIn || n - nIn < minIn) Double.NaN
            else sumIn / nIn - (total - sumIn) / (n - nIn)
        }
        val finite = scores.filter { !it.isNaN() }.toDoubleArray().apply { sort() }
        if (finite.size < scores.size / 2) return null
        val median = finite[finite.size / 2]
        val spread = DoubleArray(finite.size) { abs(finite[it] - median) }.apply { sort() }
        val sigma = 1.4826 * spread[finite.size / 2]
        if (sigma <= 0) return null
        return DoubleArray(scores.size) { if (scores[it].isNaN()) 0.0 else (scores[it] - median) / sigma }
    }

    private fun prefixSums(a: DoubleArray): DoubleArray {
        val p = DoubleArray(a.size + 1)
        for (i in a.indices) p[i + 1] = p[i] + a[i]
        return p
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
