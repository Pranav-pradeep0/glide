package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import java.io.File
import kotlin.math.log10
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
 *  - [SCENES]: named reports from testers, felt share in each; with [marks], the testers' "too
 *    much" / "missed" taps on the phone, each over the [MARK_LEAD_MS] before it.
 *
 * Felt is what reaches the motor: the track at the default strength through [HapticRenderer] and
 * the reference phone's calibration (the AIN065's own), amplitude over 0. Its shape (layer 4):
 *
 *  - floor: share of the motor's running time at the felt floor, where faint and fainter feel alike.
 *  - big / stray amp: median peak amplitude (of 255) of felt big cues and of stray moments.
 *  - plateau: share of felt big cues' running time within [PLATEAU_DB] of the cue's own peak
 *    motion (by the calibration curve): a clipped explosion holds one amplitude, a shaped one moves.
 *
 * [HOLDOUT] films are never tuned on: read their rows to check a change, never to choose one.
 * Prints only; each layer's step records its numbers in the decisions doc.
 */
class HapticBenchTest {
    private class Row(
        var cues: Int = 0, var cuesFelt: Int = 0, var big: Int = 0, var bigFelt: Int = 0,
        var stray: Int = 0, var minutes: Double = 0.0, var loud: Int = 0, var loudFelt: Int = 0, var opening: Double = 0.0,
        var driven: Long = 0, var floor: Long = 0, var bigMs: Long = 0, var plateauMs: Long = 0
    ) {
        val bigAmp = mutableListOf<Double>()
        val strayAmp = mutableListOf<Double>()

        operator fun plusAssign(o: Row) {
            cues += o.cues; cuesFelt += o.cuesFelt; big += o.big; bigFelt += o.bigFelt
            stray += o.stray; minutes += o.minutes; loud += o.loud; loudFelt += o.loudFelt; opening += o.opening
            driven += o.driven; floor += o.floor; bigAmp += o.bigAmp; strayAmp += o.strayAmp; bigMs += o.bigMs; plateauMs += o.plateauMs
        }

        override fun toString() = "%5d %6.3f %5d %6.3f %9.2f %9.3f %9.1f %6.2f %7.0f %6.0f %7.2f".format(
            cues, cuesFelt / cues.coerceAtLeast(1).toDouble(), big, bigFelt / big.coerceAtLeast(1).toDouble(),
            stray / minutes.coerceAtLeast(1e-9), loudFelt / loud.coerceAtLeast(1).toDouble(), opening,
            floor / driven.coerceAtLeast(1).toDouble(), median(bigAmp), median(strayAmp), plateauMs / bigMs.coerceAtLeast(1).toDouble()
        )
    }

    @Test
    fun bench() {
        val films = File(HapticHarness.fixturesDir(), "films").listFiles { f -> f.name.endsWith(".mka") && File(f.parentFile, f.nameWithoutExtension + ".srt").isFile }
            .orEmpty().sortedBy { it.name }
        assumeTrue("no films with subtitles in .haptics-fixtures/films", films.isNotEmpty())
        val tune = Row()
        val held = Row()
        println("%-22s %5s %6s %5s %6s %9s %9s %9s %6s %7s %6s %7s".format("film", "cues", "felt", "big", "felt", "stray/min", "loud felt", "opening", "floor", "big amp", "stray", "plateau"))
        for (file in films) {
            val name = file.nameWithoutExtension
            // Plain subtitles (Blast's) would count every felt moment as stray.
            if (HapticMeaning.tags(HapticFilmTest.cues(File(file.parentFile, "$name.srt").readText())).isEmpty()) { println("%-22s no SDH tags, skipped".format(name.take(22))); continue }
            val row = score(file)
            if (isHeld(name)) held += row else tune += row
            println("%-22s %s".format(name.take(22) + if (isHeld(name)) "*" else "", row))
        }
        for (m in marks()) if (films.none { m.of(it.nameWithoutExtension) }) println("   mark for no film here, name it as its .mka: ${m.film}")
        println("%-22s %s".format("tuning", tune))
        println("%-22s %s".format("held out*", held))
    }

    /**
     * The caption vocabulary's gaps, by data: every bracketed SDH cue [HapticMeaning] gives no kind,
     * with how often the subwoofer is big under it (as [score]'s big cues). A word that is often
     * big and unclassified ("roar" was) is a missing effect; speaker names and language notes stay
     * small. All films with SDH tags, held out too: this changes the truth, not the feel.
     */
    @Test
    fun audit() {
        val films = File(HapticHarness.fixturesDir(), "films").listFiles { f -> f.name.endsWith(".mka") && File(f.parentFile, f.nameWithoutExtension + ".srt").isFile }
            .orEmpty().sortedBy { it.name }
        assumeTrue("no films with subtitles in .haptics-fixtures/films", films.isNotEmpty())
        class Seen(var n: Int = 0, var big: Int = 0, val films: MutableSet<String> = mutableSetOf())
        val cues = sortedMapOf<String, Seen>()
        val words = sortedMapOf<String, Seen>()
        for (file in films) {
            val name = file.nameWithoutExtension
            val all = HapticFilmTest.cues(File(file.parentFile, "$name.srt").readText())
            if (HapticMeaning.tags(all).isEmpty()) continue
            val sub = HapticFilmTest().load(file).sub
            val subTop = sub.sorted().getOrElse((sub.size - 1) * 99 / 100) { 0.0 }
            for (c in all) for (m in BRACKETS.findAll(c.text)) {
                val inner = m.value.drop(1).dropLast(1).trim()
                // Speaker names are capitalised words: "[Victor]", "[Hunter 2]"; all-caps SDH ("[WHOOSHES]") isn't.
                if (inner.isEmpty() || inner.any { it.isLowerCase() } && inner.split(' ').all { it.first().isUpperCase() || it.first().isDigit() }) continue
                if (HapticMeaning.tags(listOf(HapticMeaning.Cue(0, 0, m.value))).isNotEmpty()) continue
                val from = (c.startMs - LEAD_MS).coerceAtLeast(0) / 100
                val to = minOf(sub.size - 1, maxOf(c.endMs, c.startMs + LEAD_MS) / 100)
                val big = subTop > 0 && (from..to).maxOfOrNull { sub[it] }.let { it != null && it >= subTop / LOUD }
                val text = inner.lowercase()
                for (s in listOf(cues.getOrPut(text, ::Seen)) + text.split(Regex("[^a-z]+")).filter { it.length > 2 }.distinct().map { words.getOrPut(it, ::Seen) }) {
                    s.n++; if (big) s.big++; s.films += name
                }
            }
        }
        // Big first: those are what a viewer would feel.
        fun show(title: String, m: Map<String, Seen>) {
            println("$title (count, big, films)")
            for ((k, s) in m.entries.sortedWith(compareByDescending<Map.Entry<String, Seen>> { it.value.big }.thenByDescending { it.value.n }).take(80))
                println("%5d %4d %2d  %s".format(s.n, s.big, s.films.size, k))
        }
        show("unclassified words", words)
        show("unclassified cues", cues)
    }

    private fun score(file: File): Row {
        val film = HapticFilmTest()
        val d = film.load(file)
        val name = file.nameWithoutExtension
        val cues = HapticFilmTest.cues(File(file.parentFile, "$name.srt").readText())
        val track = HapticDirector.direct(film.labelled(d.raw, File(file.parentFile, "$name.sounds")), HapticMeaning.tags(cues), strength = HapticDirector.strength(CINEMATIC))
        val f = HapticTrack.BED_FRAME_MS
        val amp = played(track, d.ms)
        val frameAmp = IntArray(d.ms / f) { i -> (i * f until i * f + f).maxOf { amp[it].toInt() and 0xFF } }
        val felt = BooleanArray(frameAmp.size) { frameAmp[it] > 0 }
        fun anyFelt(from: Int, to: Int) = (from.coerceAtLeast(0) / f until minOf(felt.size, to / f)).any { felt[it] }
        val row = Row(minutes = d.ms / 60_000.0)
        for (a in amp) if (a.toInt() != 0) { row.driven++; if (a.toInt() and 0xFF <= CAL.floorAmp) row.floor++ }

        val subTop = d.sub.sorted().getOrElse((d.sub.size - 1) * 99 / 100) { 0.0 }
        val effectCues = cues.filter { c -> HapticMeaning.tags(listOf(c)).any { it.kind in EFFECTS } }
        val effects = effectCues.map { it.startMs - LEAD_MS..maxOf(it.endMs, it.startMs + LEAD_MS) }
        for ((w, cue) in effects.zip(effectCues)) {
            val felt = anyFelt(w.first, w.last)
            row.cues++
            if (felt) row.cuesFelt++
            val peak = (w.first.coerceAtLeast(0) / 100..minOf(d.sub.size - 1, w.last / 100)).maxOfOrNull { d.sub[it] } ?: 0.0
            if (subTop > 0 && peak >= subTop / LOUD) {
                row.big++
                if (!felt) { println("   %s missed big %d s %s".format(name, cue.startMs / 1000, cue.text)); continue }
                row.bigFelt++
                val ms = w.first.coerceAtLeast(0) until minOf(amp.size, w.last)
                row.bigAmp += ms.maxOf { amp[it].toInt() and 0xFF }.toDouble()
                val motion = ms.map { amp[it].toInt() and 0xFF }.filter { it > 0 }.map { 20 * log10(motionOf(it)) }
                row.bigMs += motion.size
                val top = motion.max()
                row.plateauMs += motion.count { it >= top - PLATEAU_DB }
            }
        }

        var quiet = Int.MAX_VALUE
        var strayPeak = -1 // of the stray moment under way; -1 in a cue's
        for (i in felt.indices) if (felt[i]) {
            if (quiet > JOIN_MS / f) {
                if (strayPeak >= 0) row.strayAmp += strayPeak.toDouble()
                strayPeak = -1
                if (effects.none { i * f in it }) { row.stray++; strayPeak = 0 }
            }
            if (strayPeak >= 0) strayPeak = maxOf(strayPeak, frameAmp[i])
            quiet = 0
        } else quiet++
        if (strayPeak >= 0) row.strayAmp += strayPeak.toDouble()

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
        val marked = marks().filter { it.of(name) }.map { (it.ms - MARK_LEAD_MS).coerceAtLeast(0)..it.ms to "mark ${it.kind}" }
        for ((range, what) in SCENES[name].orEmpty() + marked) {
            val share = (range.first / 100 until range.last / 100).count { anyFelt(it * 100, it * 100 + 100) } / ((range.last - range.first) / 100.0)
            val bed = (range.first / f until range.last / f).count { track.bedAt(it * f) > 0f } / ((range.last - range.first) / f.toDouble())
            val peak = (range.first until minOf(amp.size, range.last)).maxOfOrNull { amp[it].toInt() and 0xFF } ?: 0
            println("   %s %d-%d s %s: %.2f felt, bed %.2f, %d hits, peak amp %d".format(name, range.first / 1000, range.last / 1000, what, share, bed, track.events.count { it.timeMs in range }, peak))
        }
        return row
    }

    /** The motor's amplitude at each ms of [ms], call by call as the Performer issues them. */
    private fun played(track: HapticTrack, ms: Int): ByteArray {
        val amp = ByteArray(ms)
        var from = 0
        while (true) {
            val c = HapticRenderer.next(track, from, CAL) ?: break
            var t = c.startMs
            for (k in c.stepsMs.indices) {
                amp.fill(c.amplitudes[k].toByte(), minOf(t, ms), minOf(t + c.stepsMs[k], ms))
                t += c.stepsMs[k]
            }
            from = c.endMs
        }
        return amp
    }

    companion object {
        /** The default slider position (src/store/appStore.ts), on the phone the curve is from. */
        private const val CINEMATIC = 0.6f
        private const val PLATEAU_DB = 1.0
        private val CAL = HapticCalibration.DEFAULT

        /** Share of full motion the calibration curve gives [amp]. */
        private fun motionOf(amp: Int) = (CAL.motionAt(amp) / CAL.motion.last()).toDouble().coerceAtLeast(1e-4)

        private fun median(xs: List<Double>) = xs.sorted().let { if (it.isEmpty()) Double.NaN else it[it.size / 2] }

        /** Titles never tuned on: a series' episodes are named `<title>-s01e01` and held out together. */
        val HOLDOUT = setOf("anora", "bethlehem", "boys")
        fun title(name: String) = name.substringBefore('-')
        fun isHeld(name: String) = title(name) in HOLDOUT
        private val EFFECTS = HapticMeaning.EFFECTS
        /** SDH cues trail their sound; a felt start up to this much before the cue is its moment. */
        private const val LEAD_MS = 1000
        /** Felt stretches closer than this are one moment (as HapticFilmTest). */
        private const val JOIN_MS = 300
        private const val SCENE_MS = 3000
        /** Within 6 dB of the loud level is loud (amplitude ratio). */
        private const val LOUD = 2.0
        private val BRACKETS = Regex("""\[[^\]]*]|\([^)]*\)""")
        /** Testers' reports: (span, what was wrong). */
        private val SCENES = mapOf(
            "frankenstein" to listOf(223_000..265_000 to "creature attack, buzzes nonstop")
        )

        /** A tap comes after what prompted it: bring up the controls, then the button. */
        private const val MARK_LEAD_MS = 10_000

        /** A mark's phone file name is its film's if it holds every part of the fixture's name ("boys-s05e04"). */
        private class Mark(val film: String, val ms: Int, val kind: String) {
            private val key = film.lowercase().filter { it.isLetterOrDigit() }
            fun of(name: String) = name.split('-').all { it in key }
        }

        /** .haptics-fixtures/marks.tsv, from scripts/haptics-marks.py: file name, media ms, kind. */
        private fun marks() = File(HapticHarness.fixturesDir(), "marks.tsv").takeIf { it.isFile }?.readLines().orEmpty()
            .map { it.split('\t') }.filter { it.size == 3 }.map { Mark(it[0], it[1].toInt(), it[2]) }
    }
}
