package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import java.io.File
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The benchmark for the long-term system (docs/haptics-decisions.md, Long-term system): ground
 * truth by script, nothing labelled by hand. An SDH cue [HapticMeaning] calls an effect (impact,
 * slam, explosion, engine) should be felt; the subwoofer feed says how big it is. Everything
 * else (dialogue, score, ambience, logos) should be still. Scored on the Cinematic track with the
 * film's sound labels, as the phone plays it:
 *
 *  - cues felt: effect cues with anything felt from [LEAD_MS] before the cue to its end. Big: the
 *    subwoofer peaks there within 6 dB of the film's loud level (99th percentile).
 *  - stray/min: felt moments that start outside every effect cue, per minute.
 *  - loud felt: share of the film's loud scenes (subwoofer power over [SCENE_MS] within 6 dB of
 *    its 99th percentile) with anything felt. The creature attack buzzed through all of it.
 *  - opening, s: felt before the first line.
 *  - [SCENES]: named reports from testers, felt share in each.
 *
 * [HOLDOUT] films are never tuned on: read their rows to check a change, never to choose one.
 * Prints only; each layer's step records its numbers in the decisions doc.
 */
class HapticBenchTest {
    private class Row(
        var cues: Int = 0, var cuesFelt: Int = 0, var big: Int = 0, var bigFelt: Int = 0,
        var stray: Int = 0, var minutes: Double = 0.0, var loud: Int = 0, var loudFelt: Int = 0, var opening: Double = 0.0
    ) {
        operator fun plusAssign(o: Row) {
            cues += o.cues; cuesFelt += o.cuesFelt; big += o.big; bigFelt += o.bigFelt
            stray += o.stray; minutes += o.minutes; loud += o.loud; loudFelt += o.loudFelt; opening += o.opening
        }

        override fun toString() = "%5d %6.3f %5d %6.3f %9.2f %9.3f %9.1f".format(
            cues, cuesFelt / cues.coerceAtLeast(1).toDouble(), big, bigFelt / big.coerceAtLeast(1).toDouble(),
            stray / minutes.coerceAtLeast(1e-9), loudFelt / loud.coerceAtLeast(1).toDouble(), opening
        )
    }

    @Test
    fun bench() {
        val films = File(HapticHarness.fixturesDir(), "films").listFiles { f -> f.name.endsWith(".mka") && File(f.parentFile, f.nameWithoutExtension + ".srt").isFile }
            .orEmpty().sortedBy { it.name }
        assumeTrue("no films with subtitles in .haptics-fixtures/films", films.isNotEmpty())
        val tune = Row()
        val held = Row()
        println("%-14s %5s %6s %5s %6s %9s %9s %9s".format("film", "cues", "felt", "big", "felt", "stray/min", "loud felt", "opening"))
        for (file in films) {
            val name = file.nameWithoutExtension
            // Plain subtitles (Blast's) would count every felt moment as stray.
            if (HapticMeaning.tags(HapticFilmTest.cues(File(file.parentFile, "$name.srt").readText())).isEmpty()) { println("%-14s no SDH tags, skipped".format(name.take(14))); continue }
            val row = score(file)
            if (name in HOLDOUT) held += row else tune += row
            println("%-14s %s".format(name.take(14) + if (name in HOLDOUT) "*" else "", row))
        }
        println("%-14s %s".format("tuning", tune))
        println("%-14s %s".format("held out*", held))
    }

    private fun score(file: File): Row {
        val film = HapticFilmTest()
        val d = film.load(file)
        val name = file.nameWithoutExtension
        val cues = HapticFilmTest.cues(File(file.parentFile, "$name.srt").readText())
        val heard = HapticMeaning.tags(cues) + film.sounds(File(file.parentFile, "$name.sounds"))
        val felt = HapticFilmTest.felt(HapticDirector.direct(d.raw, heard), d.ms)
        val f = HapticTrack.BED_FRAME_MS
        fun anyFelt(from: Int, to: Int) = (from.coerceAtLeast(0) / f until minOf(felt.size, to / f)).any { felt[it] }
        val row = Row(minutes = d.ms / 60_000.0)

        val subTop = d.sub.sorted().getOrElse((d.sub.size - 1) * 99 / 100) { 0.0 }
        val effects = HapticMeaning.tags(cues).filter { it.kind in EFFECTS }.map { it.startMs - LEAD_MS..maxOf(it.endMs, it.startMs + LEAD_MS) }
        for (w in effects) {
            val felt = anyFelt(w.first, w.last)
            row.cues++
            if (felt) row.cuesFelt++
            val peak = (w.first.coerceAtLeast(0) / 100..minOf(d.sub.size - 1, w.last / 100)).maxOfOrNull { d.sub[it] } ?: 0.0
            if (peak >= subTop / LOUD) { row.big++; if (felt) row.bigFelt++ }
        }

        var quiet = Int.MAX_VALUE
        for (i in felt.indices) if (felt[i]) {
            if (quiet > JOIN_MS / f && effects.none { i * f in it }) row.stray++
            quiet = 0
        } else quiet++

        // Power over SCENE_MS, centred: a scene is loud for its stretch, not its single peaks.
        if (d.sub.isNotEmpty()) {
            val sum = DoubleArray(d.sub.size + 1)
            for (i in d.sub.indices) sum[i + 1] = sum[i] + d.sub[i] * d.sub[i]
            val half = SCENE_MS / 200
            val scene = DoubleArray(d.sub.size) { i -> Math.sqrt((sum[minOf(d.sub.size, i + half + 1)] - sum[maxOf(0, i - half)]) / (2 * half + 1)) }
            val sceneTop = scene.sorted()[(scene.size - 1) * 99 / 100]
            for (w in scene.indices) if (scene[w] >= sceneTop / LOUD) { row.loud++; if (anyFelt(w * 100, w * 100 + 100)) row.loudFelt++ }
        }

        HapticFilmTest.dialogue(cues).firstOrNull()?.let { first -> row.opening = (0 until minOf(first.first / f, felt.size)).count { felt[it] } * f / 1000.0 }
        for ((range, what) in SCENES[name].orEmpty()) {
            val share = (range.first / 100 until range.last / 100).count { anyFelt(it * 100, it * 100 + 100) } / ((range.last - range.first) / 100.0)
            println("   %s %d-%d s %s: %.2f felt".format(name, range.first / 1000, range.last / 1000, what, share))
        }
        return row
    }

    companion object {
        /** Never tuned on. */
        val HOLDOUT = setOf("anora", "bethlehem")
        private val EFFECTS = setOf(Kind.SHARP, Kind.HEAVY, Kind.ENGINE)
        /** SDH cues trail their sound; a felt start up to this much before the cue is its moment. */
        private const val LEAD_MS = 1000
        /** Felt stretches closer than this are one moment (as HapticFilmTest). */
        private const val JOIN_MS = 300
        private const val SCENE_MS = 3000
        /** Within 6 dB of the loud level is loud (amplitude ratio). */
        private const val LOUD = 2.0
        /** Testers' reports: (span, what was wrong). */
        private val SCENES = mapOf(
            "frankenstein" to listOf(223_000..265_000 to "creature attack, buzzes nonstop")
        )
    }
}
