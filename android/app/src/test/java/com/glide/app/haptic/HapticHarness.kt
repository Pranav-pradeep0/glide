package com.glide.app.haptic

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.abs
import kotlin.math.sqrt

/**
 * Scores any haptic producer against the generated clips from `scripts/haptics-fixtures.js`
 * (docs/haptics-engine-plan.md Part 4). A producer is `(Clip) -> HapticTrack`; the clip's truth
 * file is never shown to it. Targets come from the phase exits and fail the run when missed.
 */
object HapticHarness {
    /** Onset F1 and recall (Phase 3 exit). */
    const val MIN_ONSET_F1 = 0.9

    /** Timing error p50 of matched onsets, absolute (Phase 3 exit). */
    const val MAX_ONSET_P50_MS = 10.0

    /** An event this close to a true onset counts as a hit. */
    const val ONSET_WINDOW_MS = 50

    /** False haptics per minute in speech, music or silence (Phase 4 exit). */
    const val MAX_QUIET_FP_PER_MIN = 1.0

    /** Share of a quiet region with the bed running. */
    const val MAX_QUIET_BED_SHARE = 0.05

    /** Share of a true bed span with the bed or an event running. */
    const val MIN_BED_COVERAGE = 0.8

    /** Pearson correlation of bed and LFE level, 100 ms windows (Phase 4 exit). */
    const val MIN_LFE_CORRELATION = 0.5

    /** Interleaved 16-bit PCM, as decoders hand it to `SubtitleSyncModule.PcmSink`. */
    class Clip(val name: String, val rate: Int, val channels: Int, val pcm: ShortArray) {
        val durationMs get() = (pcm.size / channels * 1000L / rate).toInt()
    }

    data class Span(val startMs: Int, val endMs: Int, val label: String)

    class Truth(
        val onsets: List<Span>,
        val beds: List<Span>,
        val quiets: List<Span>,
        val lfeChannel: Int?,
        /** Truth onsets are incomplete (real base audio): score recall, not F1. */
        val partial: Boolean
    )

    class Fixture(val clip: Clip, val truth: Truth)

    data class Check(val name: String, val value: Double, val target: String, val passed: Boolean)

    class Report(val checks: List<Check>, val scores: Map<String, Double>) {
        val passed get() = checks.all { it.passed }
        override fun toString() = buildString {
            for (c in checks) appendLine("%-4s %-36s %8.3f  %s".format(if (c.passed) "ok" else "FAIL", c.name, c.value, c.target))
            for ((k, v) in scores) appendLine("     %-36s %8.3f".format(k, v))
        }
    }

    fun fixturesDir() = File(System.getProperty("haptics.fixtures") ?: "../../.haptics-fixtures")

    fun load(dir: File = fixturesDir()): List<Fixture> =
        dir.listFiles { f -> f.name.endsWith(".wav") }.orEmpty().sortedBy { it.name }.map { wav ->
            val name = wav.name.removeSuffix(".wav")
            Fixture(readWav(wav, name), readTruth(File(dir, "$name.truth.tsv")))
        }

    fun run(fixtures: List<Fixture>, producer: (Clip) -> HapticTrack): Report {
        val checks = mutableListOf<Check>()
        val scores = linkedMapOf<String, Double>()
        for (f in fixtures) score(f, producer(f.clip), checks, scores)
        return Report(checks, scores)
    }

    private fun score(f: Fixture, track: HapticTrack, checks: MutableList<Check>, scores: MutableMap<String, Double>) {
        val name = f.clip.name
        val t = f.truth
        fun atLeast(key: String, v: Double, min: Double) = checks.add(Check("$name $key", v, ">= $min", v >= min))
        fun atMost(key: String, v: Double, max: Double) = checks.add(Check("$name $key", v, "<= $max", v <= max))

        if (t.onsets.isNotEmpty()) {
            val errors = matchOnsets(t.onsets.map { it.startMs }, track.events.map { it.timeMs })
            val recall = errors.size.toDouble() / t.onsets.size
            val precision = if (track.events.isEmpty()) 0.0 else errors.size.toDouble() / track.events.size
            val f1 = if (errors.isEmpty()) 0.0 else 2 * precision * recall / (precision + recall)
            if (t.partial) atLeast("onset recall", recall, MIN_ONSET_F1) else atLeast("onset F1", f1, MIN_ONSET_F1)
            val abs = errors.map { abs(it).toDouble() }
            atMost("onset p50 ms", percentile(abs, 0.5), MAX_ONSET_P50_MS)
            scores["$name onset p95 ms"] = percentile(abs, 0.95)
            scores["$name onset mean signed ms"] = if (errors.isEmpty()) Double.NaN else errors.average()
        }
        for ((label, spans) in t.quiets.groupBy { it.label }) {
            val minutes = spans.sumOf { it.endMs - it.startMs } / 60_000.0
            val fp = track.events.count { e -> spans.any { e.timeMs in it.startMs until it.endMs } }
            atMost("quiet $label FP/min", fp / minutes, MAX_QUIET_FP_PER_MIN)
            atMost("quiet $label bed share", share(spans) { track.bedAt(it) > 0f }, MAX_QUIET_BED_SHARE)
        }
        if (t.beds.isNotEmpty()) atLeast("bed coverage", share(t.beds) { active(track, it) }, MIN_BED_COVERAGE)
        t.lfeChannel?.let { atLeast("LFE correlation", lfeCorrelation(f.clip, it, track), MIN_LFE_CORRELATION) }
        scores["$name active share"] = share(listOf(Span(0, f.clip.durationMs, ""))) { active(track, it) }
    }

    /** Signed error (event - truth) of each true onset matched to its own event within the window. */
    fun matchOnsets(truth: List<Int>, events: List<Int>): List<Int> {
        val used = BooleanArray(events.size)
        return truth.mapNotNull { t ->
            events.indices.filter { !used[it] && abs(events[it] - t) <= ONSET_WINDOW_MS }
                .minByOrNull { abs(events[it] - t) }
                ?.let { used[it] = true; events[it] - t }
        }
    }

    private fun active(track: HapticTrack, ms: Int) =
        track.bedAt(ms) > 0f || track.events.any { ms >= it.timeMs && ms < it.timeMs + it.lengthMs + it.decayMs }

    /** Share of the spans' bed frames where [on] holds. */
    private fun share(spans: List<Span>, on: (Int) -> Boolean): Double {
        var total = 0
        var hit = 0
        for (s in spans) for (ms in s.startMs until s.endMs step HapticTrack.BED_FRAME_MS) {
            total++
            if (on(ms)) hit++
        }
        return if (total == 0) 0.0 else hit.toDouble() / total
    }

    private fun lfeCorrelation(clip: Clip, channel: Int, track: HapticTrack): Double {
        val window = clip.rate / 10
        val frames = clip.pcm.size / clip.channels
        val lfe = mutableListOf<Double>()
        val bed = mutableListOf<Double>()
        for (start in 0 until frames - window + 1 step window) {
            var sum = 0.0
            for (i in start until start + window) sum += clip.pcm[i * clip.channels + channel].toDouble().let { it * it }
            lfe += sqrt(sum / window)
            val ms = (start * 1000L / clip.rate).toInt()
            bed += (0 until 100 step HapticTrack.BED_FRAME_MS).map { track.bedAt(ms + it).toDouble() }.average()
        }
        return pearson(lfe, bed)
    }

    /** 0 when either side is constant: an empty bed explains none of the LFE. */
    fun pearson(a: List<Double>, b: List<Double>): Double {
        val ma = a.average()
        val mb = b.average()
        var cov = 0.0
        var va = 0.0
        var vb = 0.0
        for (i in a.indices) {
            cov += (a[i] - ma) * (b[i] - mb)
            va += (a[i] - ma) * (a[i] - ma)
            vb += (b[i] - mb) * (b[i] - mb)
        }
        return if (va == 0.0 || vb == 0.0) 0.0 else cov / sqrt(va * vb)
    }

    /** Nearest-rank; NaN for no values, so a producer with no matches fails timing too. */
    fun percentile(values: List<Double>, p: Double): Double {
        if (values.isEmpty()) return Double.NaN
        val sorted = values.sorted()
        return sorted[(kotlin.math.ceil(p * sorted.size).toInt() - 1).coerceIn(0, sorted.size - 1)]
    }

    fun readWav(file: File, name: String): Clip {
        val b = ByteBuffer.wrap(file.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
        require(b.getInt(0) == 0x46464952 && b.getInt(8) == 0x45564157) { "$file: not a WAV" }
        var pos = 12
        var channels = 0
        var rate = 0
        while (pos + 8 <= b.limit()) {
            val id = b.getInt(pos)
            val size = b.getInt(pos + 4)
            when (id) {
                0x20746d66 -> { // "fmt "
                    require(b.getShort(pos + 8).toInt() == 1 && b.getShort(pos + 22).toInt() == 16) { "$file: not 16-bit PCM" }
                    channels = b.getShort(pos + 10).toInt()
                    rate = b.getInt(pos + 12)
                }
                0x61746164 -> { // "data"
                    val pcm = ShortArray(size / 2)
                    b.position(pos + 8)
                    b.asShortBuffer().get(pcm)
                    return Clip(name, rate, channels, pcm)
                }
            }
            pos += 8 + size + (size and 1)
        }
        error("$file: no data chunk")
    }

    fun readTruth(file: File): Truth {
        val onsets = mutableListOf<Span>()
        val beds = mutableListOf<Span>()
        val quiets = mutableListOf<Span>()
        var lfe: Int? = null
        var partial = false
        file.readLines().map { it.trim().split(Regex("\\s+")) }.filter { it[0].isNotEmpty() && !it[0].startsWith("#") }.forEach { w ->
            when (w[0]) {
                "onset" -> onsets += Span(w[1].toInt(), w[1].toInt(), w[2])
                "bed" -> beds += Span(w[1].toInt(), w[2].toInt(), w[3])
                "quiet" -> quiets += Span(w[1].toInt(), w[2].toInt(), w[3])
                "lfe" -> lfe = w[1].toInt()
                "partial" -> partial = true
                else -> error("$file: unknown truth line ${w.joinToString(" ")}")
            }
        }
        return Truth(onsets, beds, quiets, lfe, partial)
    }
}
