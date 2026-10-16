package com.glide.app.haptic

import java.nio.ByteBuffer
import java.nio.ByteOrder
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test

/**
 * Phase 3 exit: onset F1 >= 0.9 and timing p50 <= 10 ms on the generated clips. The other checks
 * (restraint, bed, LFE) are the Director's (Phase 4) and are only printed here.
 *
 * Needs the clips: `node scripts/haptics-fixtures.js` (skipped without them, e.g. on CI).
 */
class HapticListenerTest {
    private val fp = HapticTrack.Fingerprint("", 0, 0)

    /** Fed in decoder-sized chunks, as `PcmSink` would. */
    private fun listen(clip: HapticHarness.Clip, chunkFrames: Int = 1536): HapticListener {
        val l = HapticListener()
        val buf = ByteBuffer.allocate(clip.pcm.size * 2).order(ByteOrder.LITTLE_ENDIAN)
        buf.asShortBuffer().put(clip.pcm)
        val frameBytes = clip.channels * 2
        var at = 0
        while (at < buf.capacity()) {
            val end = minOf(at + chunkFrames * frameBytes, buf.capacity())
            val chunk = buf.duplicate().apply { position(at); limit(end) }
            l.add(at / frameBytes * 1_000_000L / clip.rate, chunk, clip.channels, clip.rate, false)
            at = end
        }
        l.finish()
        return l
    }

    @Test
    fun onsetsOnTheClips() {
        val dir = HapticHarness.fixturesDir()
        assumeTrue("no clips in ${dir.absolutePath}: run node scripts/haptics-fixtures.js", dir.isDirectory)
        val report = HapticHarness.run(HapticHarness.load(dir)) { listen(it).track(fp) }
        println(report)
        val onsets = report.checks.filter { "onset" in it.name }
        assertTrue("no onset checks ran", onsets.isNotEmpty())
        assertTrue(onsets.filter { !it.passed }.joinToString("\n"), onsets.all { it.passed })
    }

    /** What the Performer gets mid-analysis is a prefix of the finished track. */
    @Test
    fun snapshotsArePrefixes() {
        val rate = 48000
        val pcm = ShortArray(rate * 3)
        for (k in 0 until 6) for (i in 0 until 100) pcm[(k * 0.45 + 0.2).times(rate).toInt() + i] = (20000 * (1 - i / 100.0)).toInt().toShort()
        val clip = HapticHarness.Clip("t", rate, 1, pcm)
        val whole = listen(clip).track(fp)
        assertEquals(6, whole.events.size)

        val l = HapticListener()
        val buf = ByteBuffer.allocate(rate * 2).order(ByteOrder.LITTLE_ENDIAN)
        buf.asShortBuffer().put(pcm, 0, rate)
        l.add(0, buf, 1, rate, false)
        val part = l.track(fp)
        assertTrue(l.analysedMs in 900..1000)
        assertEquals(whole.events.filter { it.timeMs < l.analysedMs }, part.events)
        assertEquals(part.bedIntensity.size, l.analysedMs / HapticTrack.BED_FRAME_MS)
    }
}
