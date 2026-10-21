package com.glide.app.player

import com.glide.app.player.SubtitleAligner.FRAME_S
import com.glide.app.player.SubtitleAligner.align
import com.glide.app.player.SubtitleAligner.confirmRatio
import com.glide.app.player.SubtitleAligner.halvesConfirm
import com.glide.app.player.SubtitleAligner.scoreFrames
import com.glide.app.player.SubtitleAligner.speechLevels
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.log10
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * Synthetic but adversarial: speech at cue times shifted by a known delay, noise throughout,
 * and loud non-speech bursts ("music") in a third of the gaps, which no delay explains.
 * A wrong delay applied confidently is worse than none, so the refusals are tested as hard as
 * the successes.
 */
class SubtitleAlignerTest {

    private val windowStart = 1500.0
    private val windowLength = 300.0

    /** Window B for [confirmRatio], 1800 s from A, as the JS side picks it (>= 1200 s away). */
    private val secondStart = 3300.0

    /** Cues across the whole film, realistic lengths and gaps. */
    private fun cues(seed: Int = 1): Pair<DoubleArray, DoubleArray> {
        val rnd = Random(seed)
        val s = mutableListOf<Double>()
        val e = mutableListOf<Double>()
        var t = 5.0
        while (t < 3600) {
            val len = 1.0 + rnd.nextDouble() * 3.0
            s += t; e += t + len
            t += len + 0.5 + rnd.nextDouble() * 3.0
        }
        return s.toDoubleArray() to e.toDoubleArray()
    }

    /** Loudness where speech happens at [speechTime] of each cue interval. */
    private fun levels(
        starts: DoubleArray, ends: DoubleArray, speechTime: (Double) -> Double, seed: Int = 7,
        windowStart: Double = this.windowStart,
    ): FloatArray {
        val rnd = Random(seed)
        val n = (windowLength / FRAME_S).roundToInt()
        val out = FloatArray(n) { -48f + rnd.nextFloat() * 8f }
        for (i in starts.indices) {
            val a = ((speechTime(starts[i]) - windowStart) / FRAME_S).roundToInt()
            val b = ((speechTime(ends[i]) - windowStart) / FRAME_S).roundToInt()
            for (f in a.coerceAtLeast(0) until b.coerceAtMost(n)) out[f] = -22f + rnd.nextFloat() * 10f
            // Music in some gaps: as loud as speech, and tied to no cue.
            if (i + 1 < starts.size && rnd.nextInt(3) == 0) {
                val g0 = ((speechTime(ends[i]) - windowStart) / FRAME_S).roundToInt()
                val g1 = ((speechTime(starts[i + 1]) - windowStart) / FRAME_S).roundToInt()
                for (f in g0.coerceAtLeast(0) until g1.coerceAtMost(n)) out[f] = -24f + rnd.nextFloat() * 10f
            }
        }
        return out
    }

    @Test
    fun `recovers the delay in both directions to within a frame or two`() {
        val (s, e) = cues()
        listOf(0.0, 2.37, -7.81, 41.5).forEach { delay ->
            val r = align(levels(s, e, { it + delay }), windowStart, s, e)
            assertNotNull(r)
            assertEquals("delay $delay", delay, r!!.delayS, 0.02)
            assertTrue("delay $delay should be confident: z=${r.peakZ} runner=${r.runnerUp}", r.confident)
            assertEquals(1.0, r.ratio, 0.0)
        }
    }

    @Test
    fun `positive delay means show subtitles later`() {
        // Speech 3 s after the cues say: the app must delay subtitles by +3 s, the same sign
        // as SubtitleSyncService.calculateOffset and the player's effectiveTime = t - delay.
        val (s, e) = cues()
        val r = align(levels(s, e, { it + 3.0 }), windowStart, s, e)!!
        assertTrue(r.delayS > 2.9)
    }

    @Test
    fun `audio unrelated to the cues is refused, not guessed`() {
        val (s, e) = cues(seed = 1)
        val (s2, e2) = cues(seed = 99)   // a different film's dialogue pattern
        val r = align(levels(s2, e2, { it }), windowStart, s, e)
        assertFalse("must not be confident on unrelated audio: $r", r?.confident ?: false)
    }

    @Test
    fun `subtitles timed for another frame rate are reported as drift`() {
        // PAL-speed subtitle on a 23.976 film: 30 minutes in, the error is ~77 s -- beyond any
        // delay search, and no constant delay could fix the whole film anyway.
        val (s, e) = cues()
        val ratio = 25 / 23.976
        val r = align(levels(s, e, { it * ratio }), windowStart, s, e)!!
        assertTrue("expected drift, got $r", r.drift)
        assertEquals(ratio, r.ratio, 1e-9)
        assertTrue("plain peakZ should be non-negative", r.plainPeakZ >= 0.0)
        assertTrue("plain runnerUp should be non-negative", r.plainRunnerUp >= 0.0)
    }

    @Test
    fun `plain delay metrics match primary metrics when ratio is 1`() {
        val (s, e) = cues()
        val r = align(levels(s, e, { it + 2.5 }), windowStart, s, e)!!
        assertTrue(r.confident)
        assertEquals(1.0, r.ratio, 0.0)
        assertEquals(r.delayS, r.plainDelayS, 1e-9)
        assertEquals(r.peakZ, r.plainPeakZ, 1e-9)
        assertEquals(r.runnerUp, r.plainRunnerUp, 1e-9)
    }

    @Test
    fun `an in-sync subtitle is never called drift`() {
        // 24/23.976 is 0.1% from 1 and scores almost the same inside one window.
        val (s, e) = cues()
        val r = align(levels(s, e, { it }), windowStart, s, e)!!
        assertFalse(r.drift)
        assertEquals(1.0, r.ratio, 0.0)
    }

    @Test
    fun `too little audio or cue overlap is refused`() {
        val (s, e) = cues()
        assertNull(align(FloatArray(1000) { -30f }, windowStart, s, e))
        assertNull("no cues near the window", align(levels(s, e, { it }), 10_000.0, s, e))
    }

    @Test
    fun `speech band keeps voice frequencies and drops hum`() {
        val rate = 16000
        fun tone(hz: Double) = ShortArray(rate) { (8000 * sin(2 * PI * hz * it / rate)).toInt().toShort() }
        val voice = speechLevels(tone(1000.0), rate).drop(20).average()
        val hum = speechLevels(tone(50.0), rate).drop(20).average()
        val silence = speechLevels(ShortArray(rate), rate).average()
        assertEquals(100, speechLevels(tone(1000.0), rate).size)
        // Amplitude 8000/32768 is -15.26 dB RMS for a sine; the pass band must keep it within 0.5 dB.
        assertEquals("1 kHz should pass untouched", -15.26, voice, 0.5)
        assertTrue("50 Hz hum should be cut by >25 dB: voice $voice, hum $hum", voice - hum > 25)
        assertTrue(silence < -90)
    }

    /** A music bed that swells for 20 s and drops for 20 s, whatever the dialogue does. */
    private fun withBed(levels: FloatArray, bedDb: Double = -28.0) = FloatArray(levels.size) {
        if ((it * FRAME_S / 20).toInt() % 2 == 1) return@FloatArray levels[it]
        (10 * log10(10.0.pow(levels[it] / 10.0) + 10.0.pow(bedDb / 10))).toFloat()
    }

    @Test
    fun `a music bed under the dialogue does not hide the delay`() {
        val (s, e) = cues()
        val r = align(withBed(levels(s, e, { it + 1.2 })), windowStart, s, e)!!
        assertTrue("should be confident under a bed: $r", r.confident)
        assertEquals(1.2, r.delayS, 0.05)
    }

    /**
     * A busy film mix: each line fills only part of its cue, sits up to 0.3 s off its centre, at
     * any level from whisper to shout, and bursts of music and effects as loud as speech cover
     * 80% of the time. Scores a z of ~5 -- the device logs showed 2-4 on real films.
     */
    private fun busyMix(starts: DoubleArray, ends: DoubleArray, speechCues: DoubleArray, delay: Double, seed: Int): FloatArray {
        val rnd = Random(seed)
        val n = (windowLength / FRAME_S).roundToInt()
        val out = FloatArray(n) { -48f + rnd.nextFloat() * 8f }
        for (i in starts.indices) {
            val length = (ends[i] - starts[i]) * (0.4 + 0.5 * rnd.nextDouble())
            val start = speechCues.getOrElse(i) { 0.0 } + (ends[i] - starts[i] - length) / 2 + (rnd.nextDouble() * 2 - 1) * 0.3 + delay
            val level = -40f + rnd.nextFloat() * 25f
            val a = ((start - windowStart) / FRAME_S).roundToInt()
            val b = ((start + length - windowStart) / FRAME_S).roundToInt()
            for (f in a.coerceAtLeast(0) until b.coerceAtMost(n)) out[f] = level + rnd.nextFloat() * 6f
        }
        var f = 0
        while (f < n) {
            val length = 100 + rnd.nextInt(300)
            if (rnd.nextDouble() < 0.8) {
                val level = -36f + rnd.nextFloat() * 20f
                for (k in f until minOf(n, f + length)) out[k] = maxOf(out[k], level + rnd.nextFloat() * 4f)
            }
            f += length
        }
        return out
    }

    @Test
    fun `a busy mix with a low z is still applied when both halves agree`() {
        // Plain z alone applies 2 of these 10; with the halves check it is 5.
        val (s, e) = cues()
        val results = (1..10).map { align(busyMix(s, e, s, 0.3, it), windowStart, s, e)!! }
        val applied = results.filter { it.confident }
        applied.forEach { assertEquals("never a wrong delay: $it", 0.3, it.delayS, 0.2) }
        assertTrue("applied ${applied.size} of 10: $results", applied.size >= 4)
    }

    @Test
    fun `a busy mix of unrelated dialogue is refused`() {
        val (s, e) = cues(seed = 1)
        val (other, _) = cues(seed = 99)
        (1..20).forEach { seed ->
            val r = align(busyMix(s, e, other, 0.0, seed), windowStart, s, e)
            assertFalse("seed $seed must not be confident: $r", r?.confident ?: false)
        }
    }

    @Test
    fun `unrelated audio under a music bed is still refused`() {
        val (s, e) = cues(seed = 1)
        val (s2, e2) = cues(seed = 99)
        listOf(7, 8, 9, 10, 11).forEach { seed ->
            val r = align(withBed(levels(s2, e2, { it }, seed)), windowStart, s, e)
            assertFalse("seed $seed must not be confident: $r", r?.confident ?: false)
        }
    }

    @Test
    fun `a frame-rate drift is confirmed by a second window, at the exact ratio`() {
        // PAL-speed subtitle on a 23.976 film, plus a delay. 25/24 is 0.1% off and fits window A
        // almost as well; only window B tells them apart.
        val (s, e) = cues()
        val ratio = 25 / 23.976
        val a = levels(s, e, { it * ratio + 1.7 })
        val b = levels(s, e, { it * ratio + 1.7 }, seed = 8, windowStart = secondStart)
        assertTrue(align(a, windowStart, s, e)!!.drift)
        val r = confirmRatio(a, windowStart, b, secondStart, s, e)
        assertNotNull(r)
        assertEquals(ratio, r!!.ratio, 1e-9)
        assertEquals(1.7, r.delayS, 0.05)
        assertEquals(1.7, r.secondDelayS!!, 0.05)
        assertTrue("a confirmed ratio is safe to apply: $r", r.confident)
        assertFalse(r.drift)
    }

    @Test
    fun `unrelated audio never confirms a ratio`() {
        val (s, e) = cues(seed = 1)
        val (s2, e2) = cues(seed = 99)
        val ratio = 25 / 23.976
        listOf(7, 8, 9, 10, 11).forEach { seed ->
            val a = levels(s2, e2, { it * ratio }, seed)
            val b = levels(s2, e2, { it * ratio }, seed + 100, windowStart = secondStart)
            assertNull("seed $seed", confirmRatio(a, windowStart, b, secondStart, s, e))
        }
    }

    @Test
    fun `a plain delay is never turned into a ratio`() {
        // 24/23.976 is 0.1% from 1: inside one window it fits a plain delay almost as well, but
        // its delay moves 1.8 s between windows 1800 s apart.
        val (s, e) = cues()
        listOf(0.0, 2.0, -5.3).forEach { delay ->
            val a = levels(s, e, { it + delay })
            val b = levels(s, e, { it + delay }, seed = 8, windowStart = secondStart)
            assertNull("delay $delay", confirmRatio(a, windowStart, b, secondStart, s, e))
        }
    }

    @Test
    fun `sound-window scores land on their centres, interpolated between`() {
        // Window k covers [k * 0.48, k * 0.48 + 0.975) s: its centre is k * 0.48 + 0.4875.
        val scores = FloatArray(10) { it.toFloat() }
        val f = scoreFrames(scores, 0.0, 1000)
        assertEquals("held before the first centre", 0f, f[0], 1e-6f)
        assertEquals((1.0 - 0.4875) / 0.48, f[100].toDouble(), 1e-4)
        assertEquals((2.5 - 0.4875) / 0.48, f[250].toDouble(), 1e-4)
        assertEquals("ends at the last centre, 4.8075 s", 481, f.size)
        assertEquals(1.0, scoreFrames(scores, 0.9675, 1)[0].toDouble(), 1e-4)
    }

    @Test
    fun `speech scores align without the dB clamp`() {
        // A YAMNet-like Speech score per 0.48 s window: the share of the window that is speech,
        // plus noise, 0..1.
        val (s, e) = cues()
        val delay = 2.37
        val rnd = Random(3)
        val scores = FloatArray(((windowStart + windowLength) / 0.48).toInt() + 3) { k ->
            val w0 = k * 0.48
            val w1 = w0 + 0.975
            val speech = s.indices.sumOf { i -> maxOf(0.0, minOf(w1, e[i] + delay) - maxOf(w0, s[i] + delay)) } / 0.975
            (0.8 * speech + 0.2 * rnd.nextDouble()).toFloat().coerceIn(0f, 1f)
        }
        val frames = scoreFrames(scores, windowStart, (windowLength / FRAME_S).roundToInt())
        val r = align(frames, windowStart, s, e, clampDb = false)
        assertNotNull(r)
        assertTrue("should be confident: $r", r!!.confident)
        assertEquals(delay, r.delayS, 0.1)
        assertNull("clamped to dB, a 0..1 score is flat", align(frames, windowStart, s, e))
        // The fallback's extra bar: each half finds the delay on its own, and not a wrong one.
        assertTrue(halvesConfirm(frames, windowStart, s, e, r, clampDb = false))
        assertFalse(halvesConfirm(frames, windowStart, s, e, r.copy(delayS = r.delayS + 20), clampDb = false))
    }
}
