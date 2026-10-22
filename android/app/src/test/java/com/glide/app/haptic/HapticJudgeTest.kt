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
 *  - faint: felt, but never at [CLEAR_AMP]. Testers call that missed (a roar at 16-55, an
 *    explosion with gaps), so the headline "not clear" counts both.
 *  - too much: seconds felt per minute touching no strong or mild cue. Counted in time, not
 *    stretches (merging buzzes into one long one read as less), and with no excuse for what YAMNet
 *    hears: a buzz the judge excused as "an effect" was marked too much on the phone.
 *  - faint s/min: seconds the motor runs under [CLEAR_AMP]: neither still nor clearly felt, it was
 *    marked missed on real moments and too much on the rest.
 *  - on time: share of felt starts (after [JOIN_MS] still) within [ON_TIME_MS] after a sound
 *    starts ([HapticDirector.attacks]): a buzz that swells in after its sound reads as late.
 *  - loud, no caption: the subwoofer at the film's loud level, no cue near, nothing felt, and YAMNet
 *    hearing neither speech nor music (under them it was the score: Anora 51 of 51). Captions leave
 *    sounds out, so this one is a hint, not a verdict.
 *
 * Testers' marks (`marks.tsv`) are pass/fail: a missed mark passes if something is clearly felt in
 * the [MISSED_LOOK_MS] before the tap, a too-much mark if no more than [TOO_MUCH_MAX_MS] of the
 * [TOO_MUCH_LOOK_MS] before it is felt: any buzz there is the complaint (the buttons sit over the
 * video, so taps come quickly). Writes
 * `.haptics-fixtures/report/index.html` from `scripts/haptics-report.html`. Run by
 * `scripts/glide-analyse.sh`. Prints only.
 */
class HapticJudgeTest {
    private class Flag(val from: Int, val to: Int, val kind: String, val peak: Int, val what: String)

    private class Sum(var strong: Int = 0, var missed: Int = 0, var faint: Int = 0, var mild: Int = 0, var mildFelt: Int = 0,
                      var tooMuch: Int = 0, var minutes: Double = 0.0, var loudNoCaption: Int = 0, var marks: Int = 0, var caught: Int = 0,
                      var tooMuchMs: Long = 0, var faintMs: Long = 0, var starts: Int = 0, var onTime: Int = 0,
                      var missedMarks: Int = 0, var missedPass: Int = 0, var muchMarks: Int = 0, var muchPass: Int = 0) {
        operator fun plusAssign(o: Sum) {
            strong += o.strong; missed += o.missed; faint += o.faint; mild += o.mild; mildFelt += o.mildFelt
            tooMuch += o.tooMuch; minutes += o.minutes; loudNoCaption += o.loudNoCaption; marks += o.marks; caught += o.caught
            tooMuchMs += o.tooMuchMs; faintMs += o.faintMs; starts += o.starts; onTime += o.onTime
            missedMarks += o.missedMarks; missedPass += o.missedPass; muchMarks += o.muchMarks; muchPass += o.muchPass
        }

        override fun toString() = "%6d %9d %5.2f %8.2f %7.2f %7.0f%% %8d %7s %7s".format(
            strong, missed + faint, mildFelt / mild.coerceAtLeast(1).toDouble(), tooMuchMs / 1000.0 / minutes.coerceAtLeast(1e-9),
            faintMs / 1000.0 / minutes.coerceAtLeast(1e-9), 100.0 * onTime / starts.coerceAtLeast(1), loudNoCaption,
            if (missedMarks == 0) "" else "$missedPass/$missedMarks", if (muchMarks == 0) "" else "$muchPass/$muchMarks"
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
        println("%-22s %6s %9s %5s %8s %7s %8s %8s %7s %7s".format("film", "strong", "not clear", "mild", "much s/m", "faint", "on time", "loud, no", "missed", "much"))
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
        val raw = d.raw.withSounds(sounds.map(HapticSounds::features))
        val track = HapticDirector.direct(raw, HapticMeaning.tags(cues), strength = HapticDirector.strength(CINEMATIC))
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

        // YAMNet's surest effect class: captions leave effects out, a clear one is no mistake to feel.
        fun effect(r: IntRange): Float {
            val ks = r.first.coerceAtLeast(0) / HapticSounds.HOP_MS..minOf(sounds.size - 1, r.last / HapticSounds.HOP_MS + 1)
            return ks.maxOfOrNull { k -> HapticMomentTrain.EFFECT.maxOf { sounds[k][it] } } ?: 0f
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
                2 -> { sum.strong++; if (p == 0) flags += Flag(span(c).first, span(c).last, "missed", 0, c.text) else if (p < CLEAR_AMP) flags += Flag(span(c).first, span(c).last, "faint", p, c.text) }
                1 -> { sum.mild++; if (p > 0) sum.mildFelt++ }
            }
        }
        val physical = graded.filter { it.second >= 1 }.map { span(it.first) }
        val captioned = graded.map { span(it.first) }
        // Felt moments, stretches closer than JOIN_MS joined: too much is their felt time outside
        // every strong or mild cue.
        var i = 0
        while (i < pk.size) {
            if (pk[i] == 0) { i++; continue }
            var end = i + 1
            var j = end
            while (j < pk.size && j - end < JOIN_MS / 100) if (pk[j++] > 0) end = j
            val r = i * 100 until end * 100
            val p = (i until end).maxOf { pk[it] }
            val outside = r.count { ms -> ms < amp.size && amp[ms].toInt() != 0 && physical.none { ms in it } }
            if (outside > 0) { sum.tooMuchMs += outside; flags += Flag(r.first, r.last, "too much", p, heard(r) + if (effect(r) >= HEARD_EFFECT) ", YAMNet hears an effect" else "") }
            i = end
        }
        for (a in amp) { val v = a.toInt() and 0xFF; if (v in 1 until CLEAR_AMP) sum.faintMs++ }
        val attacks = HapticDirector.attacks(raw, HapticDirector.Film(raw))
        var still = JOIN_MS
        var k0 = 0
        for (ms in amp.indices) {
            if (amp[ms].toInt() == 0) { still++; continue }
            if (still >= JOIN_MS) {
                sum.starts++
                while (k0 < attacks.size && attacks[k0] < ms - ON_TIME_MS) k0++
                if (k0 < attacks.size && attacks[k0] <= ms + ON_TIME_EARLY_MS) sum.onTime++
            }
            still = 0
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
        sum.tooMuch = (sum.tooMuchMs / 1000).toInt()
        sum.loudNoCaption = flags.count { it.kind == "loud, no caption" }

        val marks = HapticBenchTest.marks().filter { it.of(name) }.map { m ->
            val pass = if (m.kind == "missed") {
                sum.missedMarks++
                (m.ms - MISSED_LOOK_MS..m.ms + 500).count { it in amp.indices && (amp[it].toInt() and 0xFF) >= CLEAR_AMP } >= CLEAR_MIN_MS
            } else {
                sum.muchMarks++
                (m.ms - TOO_MUCH_LOOK_MS until m.ms).count { it in amp.indices && amp[it].toInt() != 0 } <= TOO_MUCH_MAX_MS
            }
            if (pass) { if (m.kind == "missed") sum.missedPass++ else sum.muchPass++ }
            sum.marks++
            if (pass) sum.caught++
            println("   mark %-9s %7.1f s %s".format(m.kind, m.ms / 1000.0, if (pass) "pass" else "FAIL"))
            "[${m.ms},${str(m.kind)},$pass]"
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
         * ponytail: one level for "clearly felt"; marks called 16-80 missed. Set by the phone
         * strength test once it is run.
         */
        private const val CLEAR_AMP = 96
        private const val CLEAR_MIN_MS = 100
        private const val HEARD_EFFECT = 0.3f
        private const val ON_TIME_MS = 100
        private const val ON_TIME_EARLY_MS = 30
        private const val MISSED_LOOK_MS = 6000
        private const val TOO_MUCH_LOOK_MS = 3000
        private const val TOO_MUCH_MAX_MS = 100
        private const val STEP_MS = 250
    }
}
