package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Cue
import com.glide.app.haptic.HapticMeaning.Kind
import com.glide.app.haptic.HapticMeaning.Tag
import com.glide.app.haptic.HapticMeaning.Weight.LIGHT
import com.glide.app.haptic.HapticMeaning.Weight.NONE
import com.glide.app.haptic.HapticMeaning.Weight.STRONG
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/** Phase 5: subtitle tags as data, and what the Director does with them. */
class HapticMeaningTest {
    @Test
    fun tags() {
        val tags = HapticMeaning.tags(
            listOf(
                Cue(0, 1000, "[VICTOR] Stay back!"),
                Cue(1000, 2000, "<i>[gunshot]</i> [man screams]"),
                Cue(2000, 3000, "[thunderclap]"),
                Cue(3000, 4000, "♪ I got five on it ♪"),
                Cue(4000, 5000, "(breathing heavily)"),
                Cue(5000, 6000, "- [engine revs] - [glass breaking]"),
                Cue(6000, 7000, "[guttural, beastly roar]"),
                // Found by HapticBenchTest.audit: loud cues no pattern knew.
                Cue(7000, 8000, "[firecracker bursts]"),
                Cue(8000, 9000, "[heavy splash]"),
                Cue(9000, 10000, "[whimsical score plays]")
            )
        )
        assertEquals(
            listOf(Tag(1000, 2000, Kind.SHARP, STRONG), Tag(1000, 2000, Kind.VOICE), Tag(2000, 3000, Kind.HEAVY, STRONG), Tag(3000, 4000, Kind.MUSIC, NONE), Tag(4000, 5000, Kind.VOICE),
                Tag(5000, 6000, Kind.ENGINE, STRONG), Tag(5000, 6000, Kind.SHARP, STRONG), Tag(6000, 7000, Kind.ROAR, STRONG),
                Tag(7000, 8000, Kind.SHARP, STRONG), Tag(8000, 9000, Kind.HEAVY, STRONG), Tag(9000, 10000, Kind.MUSIC)),
            tags
        )
    }

    /** Strong, light or none: a few by hand, and the graded caption texts when the fixtures are here. */
    @Test
    fun weights() {
        fun weight(text: String) = HapticMeaning.tags(listOf(Cue(0, 1000, text))).single().weight
        assertEquals(listOf(STRONG, STRONG, LIGHT, LIGHT, LIGHT, NONE, NONE),
            listOf("[door slams]", "[explosions continue]", "[knocking]", "[growls]", "[crackling]", "[fire crackling]", "[engine stops]").map(::weight))
        val grades = File(HapticHarness.fixturesDir(), "cue-grades.tsv").takeIf { it.isFile }?.readLines().orEmpty().map { it.split('\t') }.filter { it.size == 2 }
        assumeTrue("no cue-grades.tsv", grades.isNotEmpty())
        val read = grades.map { (text, grade) -> grade to HapticMeaning.tags(listOf(Cue(0, 1000, "[$text]"))).filter { it.kind in HapticMeaning.EFFECTS }.minOfOrNull { it.weight } }
        val strong = read.filter { it.first == "strong" }
        val none = read.filter { it.first == "none" }
        println("strong read strong ${strong.count { it.second == STRONG }}/${strong.size}, none read strong ${none.count { it.second == STRONG }}, light ${none.count { it.second == LIGHT }} of ${none.size}")
        assertTrue(strong.count { it.second == STRONG } >= 0.95 * strong.size)
        assertEquals(0, none.count { it.second == STRONG })
    }

    @Test
    fun directorUsesTags() {
        fun hit(ms: Int, intensity: Float, light: Boolean = false) =
            HapticTrack.Event(ms, intensity, 0.5f, 55, 75, HapticTrack.SOURCE_AUDIO or if (light) HapticTrack.LIGHT else 0)
        val frames = 1000 // 10 s
        val raw = HapticTrack(
            HapticListener.VERSION, HapticTrack.Fingerprint("", 0, 0), FloatArray(frames), FloatArray(frames),
            listOf(hit(1000, 0.9f), hit(3000, 0.4f, light = true), hit(5000, 0.4f, light = true), hit(7000, 0.9f))
        )
        val tags = listOf(Tag(2900, 3500, Kind.SHARP), Tag(4500, 5500, Kind.HEAVY, NONE), Tag(6500, 8000, Kind.MUSIC))
        // Audio only, no labels: the film's loud sounds.
        assertEquals(listOf(1000, 7000), HapticDirector.direct(raw).events.map { it.timeMs })
        val e = HapticDirector.direct(raw, tags).events
        // A caption names the onset under it, sharp and short; one that names nothing to feel
        // (none) keeps it still. Music tags change nothing.
        assertEquals(listOf(1000, 3000, 7000), e.map { it.timeMs })
        assertEquals(HapticTrack.SOURCE_AUDIO or HapticTrack.SOURCE_SUBTITLE, e[1].sources)
        assertEquals(0.8f, e[1].sharpness)
    }
}
