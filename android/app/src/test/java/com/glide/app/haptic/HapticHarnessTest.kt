package com.glide.app.haptic

import com.glide.app.haptic.HapticHarness.Fixture
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import kotlin.math.abs
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Phase 1 exit: the harness runs and correctly fails an empty producer. "Correctly" means it fails
 * on what an empty producer misses (hits, beds, LFE), passes it on restraint, and passes a producer
 * that plays the truth itself, so a harness that fails everything can't pass this test.
 *
 * Needs the clips: `node scripts/haptics-fixtures.js` (skipped without them, e.g. on CI).
 */
class HapticHarnessTest {
    private fun fixtures(): List<Fixture> {
        val dir = HapticHarness.fixturesDir()
        assumeTrue("no clips in ${dir.absolutePath}: run node scripts/haptics-fixtures.js", dir.isDirectory)
        return HapticHarness.load(dir).also { assertTrue("no clips in $dir", it.isNotEmpty()) }
    }

    private fun empty() = HapticTrack(0, HapticTrack.Fingerprint("", 0, 0), FloatArray(0), FloatArray(0), emptyList())

    @Test
    fun emptyProducerFails() {
        val report = HapticHarness.run(fixtures()) { empty() }
        println(report)
        assertFalse(report.passed)
        for (c in report.checks) {
            val shouldFail = listOf("onset", "bed coverage", "LFE").any { it in c.name }
            assertEquals(c.toString(), !shouldFail, c.passed)
        }
        assertTrue("no quiet checks ran", report.checks.any { "quiet" in it.name })
    }

    @Test
    fun truthProducerPasses() {
        val all = fixtures()
        val truth = all.associate { it.clip.name to it.truth }
        val report = HapticHarness.run(all) { clip ->
            val t = truth.getValue(clip.name)
            val bed = FloatArray(clip.durationMs / HapticTrack.BED_FRAME_MS) { i ->
                val ms = i * HapticTrack.BED_FRAME_MS
                if (t.beds.any { ms >= it.startMs && ms < it.endMs }) 0.5f else 0f
            }
            val events = t.onsets.map { HapticTrack.Event(it.startMs, 1f, 0.5f, 30, 0, HapticTrack.SOURCE_AUDIO) }
            HapticTrack(0, HapticTrack.Fingerprint("", 0, 0), bed, FloatArray(bed.size), events)
        }
        println(report)
        assertTrue(report.toString(), report.passed)
    }

    /** The generator placed each sound where its truth says: the audio jumps right at each onset. */
    @Test
    fun truthOnsetsAreAudible() {
        for (f in fixtures()) {
            val c = f.clip
            fun rms(fromMs: Int, toMs: Int): Double {
                val a = (fromMs.toLong() * c.rate / 1000).toInt()
                val b = (toMs.toLong() * c.rate / 1000).toInt()
                var sum = 0.0
                for (i in a * c.channels until b * c.channels) sum += c.pcm[i].toDouble() * c.pcm[i]
                return sqrt(sum / ((b - a) * c.channels))
            }
            for (o in f.truth.onsets) {
                val before = rms(o.startMs - 20, o.startMs - 1)
                val after = rms(o.startMs + 1, o.startMs + 20)
                assertTrue("${c.name} ${o.label} at ${o.startMs} ms: $before -> $after", after > 2 * before + 100)
            }
        }
    }

    @Test
    fun trackRoundTrips() {
        val track = HapticTrack(
            7, HapticTrack.Fingerprint("/sdcard/Movies/a.mkv", 123456789L, 1760000000000L),
            floatArrayOf(0f, 0.25f, 1f), floatArrayOf(0.5f, 0f, 1f),
            listOf(HapticTrack.Event(1000, 0.8f, 0.2f, 70, 120, HapticTrack.SOURCE_AUDIO or HapticTrack.SOURCE_SUBTITLE))
        )
        val bytes = ByteArrayOutputStream().also { track.write(DataOutputStream(it)) }.toByteArray()
        val back = HapticTrack.read(DataInputStream(ByteArrayInputStream(bytes)))
        assertEquals(7, back.analyzerVersion)
        assertEquals(track.fingerprint, back.fingerprint)
        for (i in 0..2) assertTrue(abs(back.bedIntensity[i] - track.bedIntensity[i]) <= 0.5f / 255 + 1e-6f)
        assertEquals(track.events.single().copy(intensity = 204 / 255f, sharpness = 51 / 255f), back.events.single())
        assertEquals(1f, back.bedAt(29))
        assertEquals(0f, back.bedAt(30))
    }

    @Test
    fun matchingPairsEachOnsetOnce() {
        assertEquals(listOf(5, -40), HapticHarness.matchOnsets(listOf(100, 200, 900), listOf(105, 106, 160)))
        assertEquals(5.0, HapticHarness.percentile(listOf(5.0, 40.0), 0.5), 0.0)
    }
}
