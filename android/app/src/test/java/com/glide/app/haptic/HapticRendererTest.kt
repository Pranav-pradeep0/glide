package com.glide.app.haptic

import java.util.zip.GZIPInputStream
import kotlin.math.abs
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class HapticRendererTest {
    private val cal = HapticCalibration.DEFAULT
    private val none = HapticTrack.Fingerprint("", 0, 0)

    /** Bed 0.5 over 0-500 and 550-800 ms (a 50 ms dip between), a hit at 1200 ms. */
    private val track = HapticTrack(
        0, none,
        FloatArray(80) { if (it in 50..54) 0f else 0.5f }, FloatArray(80),
        listOf(HapticTrack.Event(1200, 1f, 1f, 30, 20, HapticTrack.SOURCE_AUDIO))
    )

    @Test
    fun shortDipStaysInsideOneCall() {
        val call = HapticRenderer.next(track, 0, cal)!!
        val bed = cal.amplitude(0.5f)
        assertEquals(0, call.startMs)
        assertArrayEquals(intArrayOf(500, 50, 250), call.stepsMs)
        assertArrayEquals(intArrayOf(bed, 0, bed), call.amplitudes)
    }

    @Test
    fun hitStartsItsOwnCallAtItsExactTime() {
        val call = HapticRenderer.next(track, 800, cal)!!
        assertEquals(1200, call.startMs)
        assertEquals(255, call.amplitudes[0])
        assertEquals(30, call.stepsMs[0])
        assertEquals(1250, call.endMs)
        assertTrue("decay falls", call.amplitudes.toList().zipWithNext().all { (a, b) -> b <= a })
        assertNull(HapticRenderer.next(track, 1250, cal))
    }

    /** A fade under the felt floor is silence: no call starts in it, and a short one is a 0 step. */
    @Test
    fun underTheFloorIsSilence() {
        val faint = 0.001f // a moment fading out: a tenth of what the floor moves
        val t = HapticTrack(0, none, FloatArray(100) { if (it < 30 || it in 50..54) faint else 0.5f }, FloatArray(100), emptyList())
        val call = HapticRenderer.next(t, 0, cal)!!
        assertEquals(300, call.startMs)
        assertArrayEquals(intArrayOf(cal.amplitude(0.5f), 0, cal.amplitude(0.5f)), call.amplitudes)
    }

    @Test
    fun resumeStartsMidStretch() {
        assertEquals(250, HapticRenderer.next(track, 250, cal)!!.startMs)
    }

    @Test
    fun aHitCutsTheBedCallBeforeIt() {
        val t = HapticTrack(0, none, FloatArray(200) { 0.3f }, FloatArray(200), listOf(HapticTrack.Event(1234, 1f, 1f, 70, 0, 0)))
        assertEquals(1234, HapticRenderer.next(t, 0, cal)!!.endMs)
        val hit = HapticRenderer.next(t, 1234, cal)!!
        assertEquals(1234, hit.startMs)
        assertEquals(2000, hit.endMs) // the bed carries on in the hit's call
    }

    @Test
    fun intensityMapsThroughTheCurveAboveTheFloor() {
        assertEquals(0, cal.amplitude(0f))
        val floor = cal.motionAt(cal.floorAmp) / cal.motion.last()
        assertEquals("under what the floor moves: silence", 0, cal.amplitude(floor * 0.9f))
        assertEquals(cal.floorAmp, cal.amplitude(floor * 1.01f))
        assertEquals(255, cal.amplitude(1f))
        val amps = (1..10).map { cal.amplitude(it / 10f) }
        assertTrue(amps.toString(), amps.zipWithNext().all { (a, b) -> b >= a })
        assertEquals(cal.encode(), HapticCalibration.decode(cal.encode())!!.encode())
    }

    /** The on-phone analysis reproduces the Phase 0 table from the Phase 0 recording. */
    @Test
    fun measuresTheReferenceRun() {
        val csv = GZIPInputStream(javaClass.getResourceAsStream("/haptics/calibration-ref.csv.gz")!!).reader().readText()
        val m = HapticCalibration.measure(csv)
        println(m.encode())
        assertArrayEquals(cal.amps, m.amps)
        for (i in m.amps.indices) assertTrue("amp ${m.amps[i]}: ${m.motion[i]} vs ${cal.motion[i]}", abs(m.motion[i] - cal.motion[i]) <= 0.02f + 0.1f * cal.motion[i])
        assertEquals(cal.floorAmp, m.floorAmp)
        assertTrue("latency ${m.latencyMs}", abs(m.latencyMs - cal.latencyMs) <= 5)
    }
}
