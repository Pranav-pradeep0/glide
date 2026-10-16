package com.glide.app.haptic

import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.sqrt
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Phase 4 exit on real films (docs/haptics-engine-plan.md Part 4): restraint, quiet dialogue and
 * the bed following what a 5.1 subwoofer plays (LFE plus the other channels' bass: mixers split
 * bass between them differently, so the LFE alone undercounts some films). Each `<name>.mka` in `.haptics-fixtures/films/` is decoded by ffmpeg
 * (first audio track, all channels, as the phone's decoder hands it over) and fed to the Listener
 * and the Director.
 * A `<name>.srt` beside it gives dialogue: lines with no sound tag should be felt as nothing.
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

    private fun score(file: File): List<String> {
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
        val track = HapticDirector.direct(listener.track(fp))
        val ms = (frames * 1000 / rate).toInt()

        val name = file.nameWithoutExtension
        val fails = mutableListOf<String>()
        fun check(what: String, v: Double, ok: Boolean, target: String) {
            println("%-4s %-28s %-24s %8.3f  %s".format(if (ok) "ok" else "FAIL", name.take(28), what, v, target))
            if (!ok) fails += "$name $what $v $target"
        }
        val active = BooleanArray(ms / HapticTrack.BED_FRAME_MS)
        for (i in active.indices) active[i] = track.bedIntensity.getOrElse(i) { 0f } > 0f
        for (e in track.events) for (t in e.timeMs until e.timeMs + e.lengthMs + e.decayMs step HapticTrack.BED_FRAME_MS) {
            if (t / HapticTrack.BED_FRAME_MS < active.size) active[t / HapticTrack.BED_FRAME_MS] = true
        }
        check("active share", active.count { it }.toDouble() / active.size, active.count { it } <= MAX_ACTIVE * active.size, "<= $MAX_ACTIVE")
        println("     %-28s %-24s %8d  %.1f min".format(name.take(28), "hits", track.events.size, ms / 60_000.0))
        // The renderer plays the louder of bed and hit: a hit no stronger than the bed under it is lost.
        val lost = track.events.count { e -> (0 until e.lengthMs step HapticTrack.BED_FRAME_MS).all { track.bedAt(e.timeMs + it) >= e.intensity } }
        println("     %-28s %-24s %8.3f  %d hits".format(name.take(28), "hits lost under the bed", lost.toDouble() / track.events.size.coerceAtLeast(1), lost))

        val srt = File(file.parentFile, "$name.srt")
        if (srt.isFile) {
            val lines = dialogue(srt.readText())
            val minutes = lines.sumOf { it.last - it.first } / 60_000.0
            val fp = track.events.count { e -> lines.any { e.timeMs in it } }
            var bed = 0
            var all = 0
            for (r in lines) for (t in r step HapticTrack.BED_FRAME_MS) { all++; if (track.bedAt(t) > 0f) bed++ }
            check("dialogue FP/min", fp / minutes, fp / minutes <= HapticHarness.MAX_QUIET_FP_PER_MIN, "<= ${HapticHarness.MAX_QUIET_FP_PER_MIN}")
            println("     %-28s %-24s %8.3f  %.1f min of dialogue".format(name.take(28), "dialogue bed share", bed.toDouble() / all, minutes))
        }
        if (lfe.isNotEmpty()) {
            val bed = lfe.indices.map { w -> (0 until 100 step HapticTrack.BED_FRAME_MS).map { track.bedAt(w * 100 + it).toDouble() }.average() }
            val r = HapticHarness.pearson(lfe, bed)
            println("     %-28s %-24s %8.3f  for reference: mixers split bass differently".format(name.take(28), "LFE-only correlation", r))
            val s = HapticHarness.pearson(sub, bed)
            check("subwoofer correlation", s, s >= HapticHarness.MIN_LFE_CORRELATION, ">= ${HapticHarness.MIN_LFE_CORRELATION}")
        }
        return fails
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

        private val TIME = Regex("""(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)""")
        private val TAG = Regex("""[\[(♪#*]""")

        /** Time ranges of subtitle cues that are plain speech: no [sound], (effect) or ♪. */
        fun dialogue(srt: String): List<IntRange> = srt.replace("\r", "").split(Regex("\n\n+")).mapNotNull { cue ->
            val lines = cue.trim().lines()
            val i = lines.indexOfFirst { TIME.containsMatchIn(it) }
            if (i < 0) return@mapNotNull null
            val text = lines.drop(i + 1).joinToString(" ").replace(Regex("<[^>]*>|\\{[^}]*\\}"), "").trim()
            if (text.isEmpty() || TAG.containsMatchIn(text)) return@mapNotNull null
            val g = TIME.find(lines[i])!!.groupValues.drop(1).map { it.toInt() }
            ((g[0] * 60 + g[1]) * 60 + g[2]) * 1000 + g[3] until ((g[4] * 60 + g[5]) * 60 + g[6]) * 1000 + g[7]
        }
    }
}
