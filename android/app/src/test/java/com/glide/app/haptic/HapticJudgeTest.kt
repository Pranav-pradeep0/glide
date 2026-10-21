package com.glide.app.haptic

import com.glide.app.haptic.HapticBenchTest.Companion.BRACKETS
import com.glide.app.haptic.HapticBenchTest.Companion.CINEMATIC
import com.glide.app.haptic.HapticBenchTest.Companion.JOIN_MS
import com.glide.app.haptic.HapticBenchTest.Companion.LEAD_MS
import com.glide.app.haptic.HapticBenchTest.Companion.LOUD
import java.io.File
import kotlin.math.log10
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * The judge (docs/haptics-decisions.md, Judge): a tester's "missed" and "too much" taps, made by
 * script over every film at every second. What reaches the motor (as [HapticBenchTest], Cinematic)
 * against the film's graded SDH cues (`.haptics-fixtures/cue-grades.tsv`: strong, mild, none) and
 * its subwoofer feed:
 *
 *  - missed: a strong cue with nothing felt from [LEAD_MS] before it to its end.
 *  - faint: felt, but never at [NOTICE_AMP]: under a loud scene, testers called that missed.
 *  - too much: a moment felt at [TOO_MUCH_AMP] or more touching no strong or mild cue. Loud bass
 *    is no excuse: SDH captions the sounds that matter, and an uncaptioned bass hit 20 dB over its
 *    scene was marked too much (2:52 in Frankenstein).
 *  - loud, no caption: the subwoofer at the film's loud level, no cue near, nothing felt, and YAMNet
 *    hearing neither speech nor music (under them it was the score: Anora 51 of 51). Captions leave
 *    sounds out, so this one is a hint, not a verdict.
 *
 * A testers' mark (`marks.tsv`) is caught when a flag of its kind lies in the 10 s before it. Writes
 * `.haptics-fixtures/report/index.html` from `scripts/haptics-report.html`. Run by
 * `scripts/glide-analyse.sh`. Prints only.
 */
class HapticJudgeTest {
    private class Flag(val from: Int, val to: Int, val kind: String, val peak: Int, val what: String)

    private class Sum(var strong: Int = 0, var missed: Int = 0, var faint: Int = 0, var mild: Int = 0, var mildFelt: Int = 0,
                      var tooMuch: Int = 0, var minutes: Double = 0.0, var loudNoCaption: Int = 0, var marks: Int = 0, var caught: Int = 0) {
        operator fun plusAssign(o: Sum) {
            strong += o.strong; missed += o.missed; faint += o.faint; mild += o.mild; mildFelt += o.mildFelt
            tooMuch += o.tooMuch; minutes += o.minutes; loudNoCaption += o.loudNoCaption; marks += o.marks; caught += o.caught
        }

        override fun toString() = "%6d %6d %5d %5.2f %8d %7.2f %8d %7s".format(
            strong, missed, faint, mildFelt / mild.coerceAtLeast(1).toDouble(), tooMuch, tooMuch / minutes.coerceAtLeast(1e-9), loudNoCaption,
            if (marks == 0) "" else "$caught/$marks"
        )
    }

    @Test
    fun judge() {
        val fixtures = HapticHarness.fixturesDir()
        val dir = File(fixtures, "films")
        val films = dir.listFiles { f -> f.name.endsWith(".mka") && File(f.parentFile, f.nameWithoutExtension + ".srt").isFile }.orEmpty().sortedBy { it.name }
        assumeTrue("no films with subtitles in .haptics-fixtures/films", films.isNotEmpty())
        val grades = File(fixtures, "cue-grades.tsv").takeIf { it.isFile }?.readLines().orEmpty()
            .map { it.split('\t') }.filter { it.size == 2 }.associate { it[0] to GRADES.indexOf(it[1]) }
        val ungraded = sortedSetOf<String>()
        val tune = Sum()
        val held = Sum()
        val data = mutableListOf<String>()
        println("%-22s %6s %6s %5s %5s %8s %7s %8s %7s".format("film", "strong", "missed", "faint", "mild", "too much", "per min", "loud, no", "marks"))
        for (file in films) {
            val name = file.nameWithoutExtension
            // Plain subtitles (Blast's) name no sounds: every buzz would read as too much.
            if (HapticMeaning.tags(HapticFilmTest.cues(File(dir, "$name.srt").readText())).isEmpty()) { println("%-22s no SDH tags, skipped".format(name.take(22))); continue }
            val (sum, json) = judge(file, grades, ungraded)
            if (HapticBenchTest.isHeld(name)) held += sum else tune += sum
            println("%-22s %s".format(name.take(22) + if (HapticBenchTest.isHeld(name)) "*" else "", sum))
            data += json
        }
        println("%-22s %s".format("tuning", tune))
        println("%-22s %s".format("held out*", held))
        if (ungraded.isNotEmpty()) {
            File(fixtures, "cue-ungraded.txt").writeText(ungraded.joinToString("\n", postfix = "\n"))
            println("${ungraded.size} cue texts not in cue-grades.tsv, graded by HapticMeaning's words for now: listed in cue-ungraded.txt")
        }
        val template = File("../../scripts/haptics-report.html")
        if (template.isFile) {
            val out = File(fixtures, "report/index.html")
            out.parentFile.mkdirs()
            out.writeText(template.readText().replace("/*DATA*/null", "[" + data.joinToString(",") + "]"))
            println("report: ${out.canonicalPath}")
        }
    }

    private fun judge(file: File, grades: Map<String, Int>, ungraded: MutableSet<String>): Pair<Sum, String> {
        val name = file.nameWithoutExtension
        val dir = file.parentFile
        val film = HapticFilmTest()
        val d = film.load(file)
        val sounds = film.sounds(File(dir, "$name.sounds"))
        val cues = HapticFilmTest.cues(File(dir, "$name.srt").readText())
        val track = HapticDirector.direct(d.raw.withSounds(sounds.map(HapticSounds::features)), HapticMeaning.tags(cues), strength = HapticDirector.strength(CINEMATIC))
        val amp = HapticBenchTest().played(track, d.ms)
        val pk = IntArray((d.ms + 99) / 100) { i -> (i * 100 until minOf(amp.size, i * 100 + 100)).maxOfOrNull { amp[it].toInt() and 0xFF } ?: 0 }
        fun peak(r: IntRange) = (r.first.coerceAtLeast(0) / 100..minOf(pk.size - 1, r.last / 100)).maxOfOrNull { pk[it] } ?: 0
        val subTop = if (d.sub.isEmpty()) 0.0 else d.sub.sorted()[(d.sub.size - 1) * 99 / 100]
        fun heard(r: IntRange): String {
            val ks = r.first.coerceAtLeast(0) / HapticSounds.HOP_MS..minOf(sounds.size - 1, r.last / HapticSounds.HOP_MS)
            if (ks.isEmpty()) return ""
            val speech = ks.maxOf { sounds[it][HapticSounds.SPEECH] }
            val music = ks.maxOf { sounds[it][MUSIC] }
            return listOfNotNull("speech".takeIf { speech > 0.3f }, "music".takeIf { music > 0.3f }).joinToString(" and ").ifEmpty { "other sound" }
        }

        // Each sound cue's grade: its strongest bracket. -1 is a line with no sound tag.
        fun grade(text: String) = BRACKETS.findAll(text).map { it.value.drop(1).dropLast(1).trim().lowercase() }.filter { it.isNotEmpty() }
            .maxOfOrNull { t ->
                grades[t] ?: run {
                    ungraded += t
                    if (HapticMeaning.tags(listOf(HapticMeaning.Cue(0, 0, "[$t]"))).any { it.kind in HapticMeaning.EFFECTS }) 2 else 0
                }
            } ?: -1
        val graded = cues.map { it to grade(it.text) }.filter { it.second >= 0 }
        fun span(c: HapticMeaning.Cue) = c.startMs - LEAD_MS..maxOf(c.endMs, c.startMs + LEAD_MS)
        val sum = Sum(minutes = d.ms / 60_000.0)
        val flags = mutableListOf<Flag>()
        for ((c, g) in graded) {
            val p = peak(span(c))
            when (g) {
                2 -> { sum.strong++; if (p == 0) flags += Flag(span(c).first, span(c).last, "missed", 0, c.text) else if (p < NOTICE_AMP) flags += Flag(span(c).first, span(c).last, "faint", p, c.text) }
                1 -> { sum.mild++; if (p > 0) sum.mildFelt++ }
            }
        }
        val physical = graded.filter { it.second >= 1 }.map { span(it.first) }
        val captioned = graded.map { span(it.first) }
        // Felt moments, stretches closer than JOIN_MS joined.
        var i = 0
        while (i < pk.size) {
            if (pk[i] == 0) { i++; continue }
            var end = i + 1
            var j = end
            while (j < pk.size && j - end < JOIN_MS / 100) if (pk[j++] > 0) end = j
            val r = i * 100 until end * 100
            val p = (i until end).maxOf { pk[it] }
            if (p >= TOO_MUCH_AMP && physical.none { r.first < it.last && it.first < r.last }) flags += Flag(r.first, r.last, "too much", p, heard(r))
            i = end
        }
        // Loud stretches of the subwoofer (1 s apart or less is one), uncaptioned and unfelt.
        if (subTop > 0) {
            var k = 0
            while (k < d.sub.size) {
                if (d.sub[k] < subTop / LOUD) { k++; continue }
                var end = k + 1
                var j = end
                while (j < d.sub.size && j - end < 10) if (d.sub[j++] >= subTop / LOUD) end = j
                val r = k * 100 until end * 100
                if (end - k >= 3 && captioned.none { r.first < it.last && it.first < r.last } && peak(r) == 0 && heard(r) == "other sound") flags += Flag(r.first, r.last, "loud, no caption", 0, heard(r))
                k = end
            }
        }
        flags.sortBy { it.from }
        sum.missed = flags.count { it.kind == "missed" }
        sum.faint = flags.count { it.kind == "faint" }
        sum.tooMuch = flags.count { it.kind == "too much" }
        sum.loudNoCaption = flags.count { it.kind == "loud, no caption" }

        val marks = HapticBenchTest.marks().filter { it.of(name) }.map { m ->
            val kinds = if (m.kind == "missed") setOf("missed", "faint", "loud, no caption") else setOf("too much")
            val caught = flags.any { it.kind in kinds && it.from < m.ms + 1000 && it.to > m.ms - 10_000 }
            sum.marks++
            if (caught) sum.caught++
            "[${m.ms},${str(m.kind)},$caught]"
        }

        // The timeline at STEP_MS: motor peak, subwoofer dB against the loud level, speech and music.
        val n = (d.ms + STEP_MS - 1) / STEP_MS
        val motor = IntArray(n) { s -> (s * STEP_MS / 100 until minOf(pk.size, (s + 1) * STEP_MS / 100)).maxOfOrNull { pk[it] } ?: 0 }
        val sub = IntArray(n) { s ->
            val v = (s * STEP_MS / 100 until minOf(d.sub.size, (s + 1) * STEP_MS / 100)).maxOfOrNull { d.sub[it] } ?: 0.0
            if (subTop <= 0 || v <= 0) -60 else (20 * log10(v / subTop)).toInt().coerceIn(-60, 12)
        }
        fun lane(c: Int) = IntArray(n) { s -> sounds.getOrNull(s * STEP_MS / HapticSounds.HOP_MS)?.let { (it[c] * 100).toInt() } ?: 0 }
        val scenes = File(dir, "$name.scenes").takeIf { it.isFile }?.readLines().orEmpty().mapNotNull { it.trim().toDoubleOrNull()?.let { s -> (s * 1000).toInt() } }
        val json = buildString {
            append("{\"name\":${str(name)},\"held\":${HapticBenchTest.isHeld(name)},\"ms\":${d.ms},\"step\":$STEP_MS,\"stereo\":${subTop <= 0}")
            append(",\"motor\":[${motor.joinToString(",")}],\"sub\":[${sub.joinToString(",")}]")
            append(",\"speech\":[${lane(HapticSounds.SPEECH).joinToString(",")}],\"music\":[${lane(MUSIC).joinToString(",")}]")
            append(",\"cues\":[${graded.joinToString(",") { (c, g) -> "[${c.startMs},${c.endMs},$g,${str(c.text)}]" }}]")
            append(",\"flags\":[${flags.joinToString(",") { "[${it.from},${it.to},${str(it.kind)},${it.peak},${str(it.what)}]" }}]")
            append(",\"marks\":[${marks.joinToString(",")}],\"scenes\":[${scenes.joinToString(",")}]")
            append(",\"summary\":{\"strong\":${sum.strong},\"missed\":${sum.missed},\"faint\":${sum.faint},\"mild\":${sum.mild},\"mildFelt\":${sum.mildFelt}")
            append(",\"tooMuch\":${sum.tooMuch},\"minutes\":${"%.1f".format(sum.minutes)},\"loudNoCaption\":${sum.loudNoCaption},\"marks\":${sum.marks},\"caught\":${sum.caught}}}")
        }
        return sum to json
    }

    private fun str(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"").replace("</", "<\\/")
        .replace(Regex("[\\x00-\\x1f]"), " ") + "\""

    companion object {
        val GRADES = listOf("none", "mild", "strong")
        private const val MUSIC = 132 // YAMNet's Music class
        /**
         * ponytail: one level for "noticeable"; the first marks put it over 80 (felt at 50-80 under
         * a loud scene was called missed), while 56 on dialogue was called too much. Learn it per
         * scene loudness once more marks come in.
         */
        private const val NOTICE_AMP = 96
        /** ponytail: the faintest buzz counted as too much; the first too-much marks were at 56-66. */
        private const val TOO_MUCH_AMP = 40
        private const val STEP_MS = 250
    }
}
