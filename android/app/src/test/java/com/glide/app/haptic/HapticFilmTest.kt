package com.glide.app.haptic

import com.glide.app.haptic.HapticDirector.Preset
import com.glide.app.haptic.HapticMeaning.Kind
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Phase 4 and 5 exits on real films (docs/haptics-engine-plan.md Part 4): restraint, quiet dialogue and
 * the bed following what a 5.1 subwoofer plays (LFE plus the other channels' bass: mixers split
 * bass between them differently, so the LFE alone undercounts some films). Each `<name>.mka` in `.haptics-fixtures/films/` is decoded by ffmpeg
 * (first audio track, all channels, as the phone's decoder hands it over) and fed to the Listener
 * and the Director.
 * A `<name>.srt` beside it gives dialogue (lines with no sound tag should be felt as nothing) and the
 * tags Phase 5 fuses in: each film is scored audio only and with tags.
 *
 * Skipped without films. They aren't in git: `ffmpeg -i film.mkv -map 0:a:0 -c copy name.mka` and
 * `ffmpeg -i film.mkv -map 0:s:0 name.srt`.
 */
class HapticFilmTest {
    private val fp = HapticTrack.Fingerprint("", 0, 0)

    @Test
    fun films() {
        val films = File(HapticHarness.fixturesDir(), "films").listFiles { f -> f.name.endsWith(".mka") }.orEmpty().sortedBy { it.name }
        assumeTrue("no films in .haptics-fixtures/films", films.isNotEmpty())
        val fails = films.flatMap { score(it) }
        assertTrue(fails.joinToString("\n"), fails.isEmpty())
    }

    /** The raw track, the LFE and the subwoofer feed (RMS per 100 ms), and the length in ms. */
    private class Decoded(val raw: HapticTrack, val lfe: List<Double>, val sub: List<Double>, val ms: Int)

    /**
     * Decoding is most of the run (~3 min for the four films), so the result is kept beside the
     * film as `<name>.raw` until the Listener's VERSION or the film changes. The track goes
     * through the cache's 8-bit format, as a cached film does on the phone.
     */
    private fun load(file: File): Decoded {
        val cache = File(file.parentFile, file.nameWithoutExtension + ".raw")
        val cached = runCatching {
            DataInputStream(cache.inputStream().buffered()).use { d ->
                check(d.readInt() == HapticListener.VERSION && d.readLong() == file.length())
                val raw = HapticTrack.read(d)
                val lfe = List(d.readInt()) { d.readDouble() }
                Decoded(raw, lfe, List(lfe.size) { d.readDouble() }, d.readInt())
            }
        }.getOrNull()
        if (cached != null) return cached
        val decoded = decode(file)
        DataOutputStream(cache.outputStream().buffered()).use { d ->
            d.writeInt(HapticListener.VERSION)
            d.writeLong(file.length())
            decoded.raw.write(d)
            d.writeInt(decoded.lfe.size)
            decoded.lfe.forEach { d.writeDouble(it) }
            decoded.sub.forEach { d.writeDouble(it) }
            d.writeInt(decoded.ms)
        }
        return load(file)
    }

    private fun decode(file: File): Decoded {
        val (channels, rate) = ffprobe(file)
        val listener = HapticListener()
        val lfe = mutableListOf<Double>() // RMS per 100 ms
        val sub = mutableListOf<Double>() // what a 5.1 system's subwoofer plays, RMS per 100 ms
        // Bass management: the LFE at +10 dB, plus every other channel below 100 Hz (4th order).
        val lows = List(channels) { HapticListener.Biquad(rate, HapticListener.BED_HZ, 0.5412) to HapticListener.Biquad(rate, HapticListener.BED_HZ, 1.3066) }
        var subSum = 0.0
        val ff = ProcessBuilder("ffmpeg", "-v", "error", "-i", file.path, "-map", "0:a:0", "-f", "s16le", "-acodec", "pcm_s16le", "-")
            .redirectError(ProcessBuilder.Redirect.INHERIT).start()
        val window = rate / 10
        var inWindow = 0
        var lfeSum = 0.0
        val bytes = ByteArray(1536 * channels * 2)
        var frames = 0L
        ff.inputStream.use { input ->
            var filled = 0
            while (true) {
                val n = input.read(bytes, filled, bytes.size - filled)
                if (n > 0) filled += n
                if (filled == bytes.size || (n < 0 && filled > 0)) {
                    val whole = filled / (channels * 2) * channels * 2
                    val buf = ByteBuffer.wrap(bytes, 0, whole).order(ByteOrder.LITTLE_ENDIAN)
                    listener.add(frames * 1_000_000 / rate, buf.duplicate(), channels, rate, false)
                    if (channels == 6) for (i in 0 until whole / 12) { // FL FR FC LFE BL BR
                        for (c in 0 until 6) {
                            val s = buf.getShort(i * 12 + c * 2).toDouble()
                            if (c == 3) { lfeSum += s * s; subSum += 10 * s * s } else lows[c].let { (a, b) -> b.run(a.run(s)) }.let { subSum += it * it }
                        }
                        if (++inWindow == window) {
                            lfe += sqrt(lfeSum / window)
                            sub += sqrt(subSum / window)
                            lfeSum = 0.0
                            subSum = 0.0
                            inWindow = 0
                        }
                    }
                    frames += whole / (channels * 2)
                    filled = 0
                }
                if (n < 0) break
            }
        }
        ff.waitFor()
        listener.finish()
        return Decoded(listener.track(fp), lfe, sub, (frames * 1000 / rate).toInt())
    }

    /**
     * Phase 5: every score with the film's subtitle tags must beat (or match) the audio-only
     * Director's, and still meet the Phase 4 targets. Lower is better except where [HIGHER].
     */
    private fun score(file: File): List<String> {
        val decoded = load(file)
        val name = file.nameWithoutExtension
        val srt = File(file.parentFile, "$name.srt")
        val cues = if (srt.isFile) cues(srt.readText()) else emptyList()
        val tags = HapticMeaning.tags(cues)
        // Sound labels direct; the subtitles' own tags stay the yardstick.
        val heard = tags + sounds(File(file.parentFile, "$name.sounds"))
        val audio = metrics(decoded, HapticDirector.direct(decoded.raw), cues, tags, heard)
        val subs = metrics(decoded, HapticDirector.direct(decoded.raw, tags), cues, tags, heard)
        val fused = metrics(decoded, HapticDirector.direct(decoded.raw, heard), cues, tags, heard)
        val fails = mutableListOf<String>()
        println("     %-14s %-26s %8s %8s %8s".format(name.take(14), "", "audio", "subs", "fused"))
        for ((what, f) in fused) {
            val a = audio.getValue(what)
            val target = TARGETS[what]
            val tol = if ("correlation" in what) CORRELATION_NOISE else 1e-9
            val better = if (what in HIGHER) f >= a - tol else f <= a + tol
            val meets = target?.let { (min, max) -> f >= min && f <= max } ?: true
            val scored = what !in INFO
            val ok = (!scored || better) && meets
            println("%-4s %-14s %-26s %8.3f %8.3f %8.3f  %s".format(if (!scored && target == null) "" else if (ok) "ok" else "FAIL", name.take(14), what, a, subs[what] ?: Double.NaN, f, target?.let { "${it.first}..${it.second}" } ?: ""))
            if (!ok) fails += "$name $what audio=$a fused=$f"
        }
        // Phase 6: Subtle feels less of the film and fewer hits, Intense more. A Phase 4 target a
        // preset misses is shown ("over"), not failed: the user chose the preset.
        val presets = Preset.entries.associateWith { metrics(decoded, HapticDirector.direct(decoded.raw, heard, it), cues, tags, heard) }
        println("     %-14s %-26s %8s %8s %8s".format(name.take(14), "", "subtle", "cinema", "intense"))
        for (what in PRESET_ROWS) {
            val v = Preset.entries.mapNotNull { presets.getValue(it)[what] }
            if (v.size < 3) continue
            val over = TARGETS[what]?.let { (min, max) -> v.any { it < min || it > max } } == true
            println("%-4s %-14s %-26s %8.3f %8.3f %8.3f".format(if (over) "over" else "", name.take(14), what, v[0], v[1], v[2]))
        }
        for (what in listOf("active share", "hits")) {
            val (s, c, i) = Preset.entries.map { presets.getValue(it).getValue(what) }
            if (!(s < c && c < i)) fails += "$name $what not ordered by preset: $s $c $i"
        }
        return fails
    }

    /** YAMNet's tags from `scripts/haptics-yamnet.py`; none without the file. */
    private fun sounds(file: File): List<HapticMeaning.Tag> {
        if (!file.isFile) return emptyList()
        DataInputStream(file.inputStream().buffered()).use { d ->
            val row = ByteArray(HapticSounds.CLASSES)
            return HapticSounds.tags(List(d.readInt()) {
                d.readFully(row)
                HapticSounds.groups(FloatArray(row.size) { (row[it].toInt() and 0xFF) / 255f })
            })
        }
    }

    private fun metrics(d: Decoded, track: HapticTrack, cues: List<HapticMeaning.Cue>, tags: List<HapticMeaning.Tag>, heard: List<HapticMeaning.Tag>): Map<String, Double> {
        val m = linkedMapOf<String, Double>()
        val active = BooleanArray(d.ms / HapticTrack.BED_FRAME_MS)
        for (i in active.indices) active[i] = track.bedIntensity.getOrElse(i) { 0f } > 0f
        for (e in track.events) for (t in e.timeMs until e.timeMs + e.lengthMs + e.decayMs step HapticTrack.BED_FRAME_MS) {
            if (t / HapticTrack.BED_FRAME_MS < active.size) active[t / HapticTrack.BED_FRAME_MS] = true
        }
        m["active share"] = active.count { it }.toDouble() / active.size
        m["hits"] = track.events.size.toDouble()
        m["mean hit strength"] = track.events.map { it.intensity.toDouble() }.average()
        var run = 0
        var longest = 0
        for (a in active) { run = if (a) run + 1 else 0; longest = maxOf(longest, run) }
        m["longest felt run, s"] = longest * HapticTrack.BED_FRAME_MS / 1000.0
        // How often something starts: half of these were sub-300 ms bass flickers, which active share can't see.
        var moments = 0
        var quiet = Int.MAX_VALUE
        for (a in active) if (a) { if (quiet > MOMENT_JOIN_MS / HapticTrack.BED_FRAME_MS) moments++; quiet = 0 } else quiet++
        m["felt moments/min"] = moments / (d.ms / 60_000.0)
        // The renderer plays the louder of bed and hit: a hit no stronger than the bed under it is lost.
        m["hits lost under the bed"] = track.events.count { e -> (0 until e.lengthMs step HapticTrack.BED_FRAME_MS).all { track.bedAt(e.timeMs + it) >= e.intensity } }.toDouble()
        val lines = dialogue(cues)
        if (lines.isNotEmpty()) {
            val minutes = lines.sumOf { it.last - it.first } / 60_000.0
            m["dialogue FP/min"] = track.events.count { e -> lines.any { e.timeMs in it } } / minutes
            m["dialogue bed share"] = bedShare(track, lines)
        }
        // Studio logos and title music come before anyone speaks.
        lines.firstOrNull()?.let { first -> m["opening felt, s"] = (0 until minOf(first.first, d.ms) / HapticTrack.BED_FRAME_MS).count { active[it] } * HapticTrack.BED_FRAME_MS / 1000.0 }
        val engines = tags.filter { it.kind == Kind.ENGINE }
        if (engines.isNotEmpty()) m["engine tags felt"] = engines.count { t ->
            (t.startMs - HapticDirector.SNAP_MS until t.endMs + HapticDirector.SNAP_MS step HapticTrack.BED_FRAME_MS).any { active.getOrElse(it / HapticTrack.BED_FRAME_MS) { false } }
        }.toDouble() / engines.size
        val hits = tags.filter { it.kind == Kind.SHARP || it.kind == Kind.HEAVY }
        if (hits.isNotEmpty()) {
            val near = hits.map { it.startMs - HapticDirector.SNAP_MS..it.startMs + HapticDirector.SNAP_MS }
            m["tagged hits felt"] = near.count { w -> track.events.any { it.timeMs in w } }.toDouble() / hits.size
            m["tagged hits, raw onset"] = near.count { w -> d.raw.events.any { it.timeMs in w } }.toDouble() / hits.size
            m["tagged hits, bed or hit"] = near.count { w -> (w step HapticTrack.BED_FRAME_MS).any { active.getOrElse(it / HapticTrack.BED_FRAME_MS) { false } } }.toDouble() / hits.size
        }
        for (kind in listOf(Kind.MUSIC, Kind.VOICE)) {
            val spans = tags.filter { it.kind == kind }.map { it.startMs until it.endMs }
            if (spans.isEmpty()) continue
            val min = spans.sumOf { it.last - it.first } / 60_000.0
            m["$kind bed"] = spans.sumOf { r -> (r step HapticTrack.BED_FRAME_MS).sumOf { track.bedAt(it).toDouble() } } / spans.sumOf { r -> (r step HapticTrack.BED_FRAME_MS).count() }
            // A hit its own tag names isn't a false one; dialogue lines have no tags, so stay strict.
            m["$kind untagged hits/min"] = track.events.count { e -> e.sources and HapticTrack.SOURCE_SUBTITLE == 0 && spans.any { e.timeMs in it } } / min
        }
        if (d.lfe.isNotEmpty()) {
            val bed = d.lfe.indices.map { w -> (0 until 100 step HapticTrack.BED_FRAME_MS).map { track.bedAt(w * 100 + it).toDouble() }.average() }
            m["LFE-only correlation"] = HapticHarness.pearson(d.lfe, bed)
            m["subwoofer, whole film"] = HapticHarness.pearson(d.sub, bed)
            // Music alone isn't felt, which the subwoofer doesn't know: the correlation is judged
            // outside it (music tags and labels with no effect named), the same for every column.
            val tagged = BooleanArray(d.sub.size)
            for (t in heard.sortedBy { it.kind != Kind.MUSIC }) if (t.kind == Kind.MUSIC || t.kind in EFFECTS) for (w in t.startMs / 100..minOf(d.sub.size - 1, t.endMs / 100)) tagged[w] = t.kind == Kind.MUSIC
            val free = d.sub.indices.filter { !tagged[it] }
            m["subwoofer correlation"] = HapticHarness.pearson(free.map { d.sub[it] }, free.map { bed[it] })
            // The LFE tells them apart: mixers put explosions there, voices in the centre.
            val lfeTop = d.lfe.sorted()[(d.lfe.size - 1) * 99 / 100]
            for (kind in listOf(Kind.MUSIC, Kind.VOICE)) {
                val under = tags.filter { it.kind == kind }.flatMap { t -> t.startMs / 100..minOf(d.lfe.size - 1, t.endMs / 100) }.distinct()
                val effect = under.filter { d.lfe[it] >= lfeTop / LOUD_BASS }
                val other = under.filter { d.lfe[it] < lfeTop / QUIET_LFE }
                if (effect.isNotEmpty()) m["$kind, loud LFE felt"] = effect.count { bed[it] > 0 }.toDouble() / effect.size
                if (other.isNotEmpty()) m["$kind, quiet LFE felt"] = other.count { bed[it] > 0 }.toDouble() / other.size
            }
        }
        return m
    }

    private fun bedShare(track: HapticTrack, spans: List<IntRange>): Double {
        var bed = 0
        var all = 0
        for (r in spans) for (t in r step HapticTrack.BED_FRAME_MS) { all++; if (track.bedAt(t) > 0f) bed++ }
        return bed.toDouble() / all.coerceAtLeast(1)
    }

    private fun ffprobe(file: File): Pair<Int, Int> {
        val p = ProcessBuilder("ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels,sample_rate", "-of", "csv=p=0", file.path).start()
        val (rate, channels) = p.inputStream.bufferedReader().readText().trim().split(",").map { it.trim().toInt() }
        p.waitFor()
        return channels to rate
    }

    companion object {
        /** Share of the runtime with anything felt (Phase 4 exit, tunable). */
        const val MAX_ACTIVE = 0.15
        /** Within 6 dB of the film's loud level (99th percentile, RMS) is loud. */
        private const val LOUD_BASS = 2.0
        /** An LFE 40 dB under its loud level is silent. */
        private const val QUIET_LFE = 100.0
        /** Felt stretches closer than this are one moment. */
        private const val MOMENT_JOIN_MS = 300
        /** Correlations this close are the same: labels move a few frames at the edges. */
        private const val CORRELATION_NOISE = 0.005
        private val EFFECTS = setOf(Kind.SHARP, Kind.HEAVY, Kind.ENGINE)

        /** Phase 4 targets the fused track must still meet: (min, max). */
        private val TARGETS = mapOf(
            "active share" to (0.0 to MAX_ACTIVE),
            "dialogue FP/min" to (0.0 to HapticHarness.MAX_QUIET_FP_PER_MIN),
            "subwoofer correlation" to (HapticHarness.MIN_LFE_CORRELATION to 1.0)
        )
        private val PRESET_ROWS = listOf("active share", "felt moments/min", "hits", "mean hit strength", "longest felt run, s", "dialogue FP/min", "subwoofer correlation", "tagged hits felt", "opening felt, s")
        private val HIGHER = setOf("subwoofer correlation", "tagged hits felt", "engine tags felt", "MUSIC, loud LFE felt", "VOICE, loud LFE felt")
        /**
         * Shown, not compared with audio only: more hits and active time are the point of a rescued
         * hit. Dialogue FP keeps its target: sound labels find real
         * glass and clangs during lines (Frankenstein, scores 0.5-0.94) that this yardstick counts as false.
         */
        private val INFO = setOf("dialogue FP/min", "active share", "felt moments/min", "opening felt, s", "tagged hits, bed or hit", "hits", "mean hit strength", "longest felt run, s","hits lost under the bed", "dialogue bed share", "tagged hits, raw onset", "LFE-only correlation", "subwoofer, whole film", "MUSIC, quiet LFE felt", "VOICE, quiet LFE felt")

        private val TIME = Regex("""(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)""")
        private val TAG = Regex("""[\[(♪#*]""")

        /** An SRT file's cues, markup stripped. */
        fun cues(srt: String): List<HapticMeaning.Cue> = srt.replace("\r", "").split(Regex("\n\n+")).mapNotNull { cue ->
            val lines = cue.trim().lines()
            val i = lines.indexOfFirst { TIME.containsMatchIn(it) }
            if (i < 0) return@mapNotNull null
            val text = lines.drop(i + 1).joinToString(" ").replace(Regex("<[^>]*>|\\{[^}]*\\}"), "").trim()
            val g = TIME.find(lines[i])!!.groupValues.drop(1).map { it.toInt() }
            HapticMeaning.Cue(((g[0] * 60 + g[1]) * 60 + g[2]) * 1000 + g[3], ((g[4] * 60 + g[5]) * 60 + g[6]) * 1000 + g[7], text)
        }

        /** Time ranges of subtitle cues that are plain speech: no [sound], (effect) or ♪. */
        fun dialogue(cues: List<HapticMeaning.Cue>): List<IntRange> =
            cues.filter { it.text.isNotEmpty() && !TAG.containsMatchIn(it.text) }.map { it.startMs until it.endMs }
    }
}
