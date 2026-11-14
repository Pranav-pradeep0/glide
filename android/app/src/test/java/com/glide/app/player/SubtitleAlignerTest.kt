package com.glide.app.player

import com.glide.app.player.SubtitleAligner.Clip
import com.glide.app.player.SubtitleAligner.FRAME_S
import com.glide.app.player.SubtitleAligner.align
import com.glide.app.player.SubtitleAligner.scoreFrames
import com.glide.app.player.SubtitleAligner.speechLevels
import org.junit.Assert.assertEquals
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
 * Synthetic but adversarial: speech at cue times moved by a known mapping, noise throughout,
 * and loud non-speech bursts ("music") in a third of the gaps, which no delay explains; heard
 * as 8 one-minute clips spread over an hour, as SubtitleAutoSync.chooseClips picks them.
 * A wrong delay applied is worse than none, so the refusals are tested as hard as the successes.
 */
class SubtitleAlignerTest {

    private val clipLength = 60.0
    private val clipStarts = (0 until 8).map { 200.0 + it * 430.0 }
    private val middle = 1800.0

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

    /** Loudness of one clip from [start] where speech happens at [speechTime] of each cue interval. */
    private fun levels(starts: DoubleArray, ends: DoubleArray, speechTime: (Double) -> Double, start: Double, seed: Int): FloatArray {
        val rnd = Random(seed)
        val n = (clipLength / FRAME_S).roundToInt()
        val out = FloatArray(n) { -48f + rnd.nextFloat() * 8f }
        for (i in starts.indices) {
            val a = ((speechTime(starts[i]) - start) / FRAME_S).roundToInt()
            val b = ((speechTime(ends[i]) - start) / FRAME_S).roundToInt()
            for (f in a.coerceAtLeast(0) until b.coerceAtMost(n)) out[f] = -22f + rnd.nextFloat() * 10f
            // Music in some gaps: as loud as speech, and tied to no cue.
            if (i + 1 < starts.size && rnd.nextInt(3) == 0) {
                val g0 = ((speechTime(ends[i]) - start) / FRAME_S).roundToInt()
                val g1 = ((speechTime(starts[i + 1]) - start) / FRAME_S).roundToInt()
                for (f in g0.coerceAtLeast(0) until g1.coerceAtMost(n)) out[f] = -24f + rnd.nextFloat() * 10f
            }
        }
        return out
    }

    /** The 8 clips of a film whose dialogue falls at [speechTime] of the cues [starts]/[ends]. */
    private fun film(
        starts: DoubleArray, ends: DoubleArray, seed: Int = 7, speechTime: (Double) -> Double,
    ) = clipStarts.mapIndexed { i, at -> Clip(at, levels(starts, ends, speechTime, at, seed + i)) }

    @Test
    fun `recovers the delay in both directions to within a frame or two`() {
        val (s, e) = cues()
        listOf(0.0, 2.37, -7.81, 41.5, -95.5, 130.2).forEach { delay ->
            val r = align(film(s, e) { it + delay }, s, e, middle)
            assertNotNull("delay $delay", r)
            assertEquals("delay $delay", delay, r!!.delayS, 0.02)
            assertEquals(1.0, r.ratio, 0.0)
        }
    }

    @Test
    fun `positive delay means show subtitles later`() {
        // Speech 3 s after the cues say: the app must delay subtitles by +3 s, the same sign
        // as SubtitleSyncService.calculateOffset and the player's effectiveTime = t - delay.
        val (s, e) = cues()
        assertTrue(align(film(s, e) { it + 3.0 }, s, e, middle)!!.delayS > 2.9)
    }

    @Test
    fun `audio unrelated to the cues is refused, not guessed`() {
        val (s, e) = cues(seed = 1)
        listOf(99, 100, 101).forEach { other ->
            val (s2, e2) = cues(seed = other)   // a different film's dialogue pattern
            assertNull("other film $other", align(film(s2, e2) { it }, s, e, middle))
        }
    }

    @Test
    fun `a subtitle timed for another frame rate is retimed at the exact ratio`() {
        // PAL-speed subtitle on a 23.976 film, plus a delay: 30 minutes in the error is ~77 s,
        // and no constant delay could fix the whole film. 25/24 is 0.1% off and must lose.
        val (s, e) = cues()
        val ratio = 25 / 23.976
        val r = align(film(s, e) { it * ratio + 1.7 }, s, e, middle)!!
        assertEquals(ratio, r.ratio, 1e-9)
        assertEquals(1.7, r.delayS, 0.05)
    }

    @Test
    fun `a 24 to 23,976 drift is retimed, not taken for a plain delay`() {
        // 0.1%: barely visible in one clip, 3.6 s across the hour. A plain delay would be right
        // only where it was measured.
        val (s, e) = cues()
        val ratio = 24 / 23.976
        val r = align(film(s, e) { it * ratio }, s, e, middle)!!
        assertEquals(ratio, r.ratio, 1e-9)
        assertEquals(0.0, r.delayS, 0.05)
    }

    @Test
    fun `an in-sync subtitle is never called a frame-rate change`() {
        val (s, e) = cues()
        val r = align(film(s, e) { it }, s, e, middle)!!
        assertEquals(1.0, r.ratio, 0.0)
        assertEquals(0.0, r.delayS, 0.02)
    }

    @Test
    fun `a mid-film edit gets the delay for the viewer's side, never the other side's`() {
        // A scene 5 s longer in this cut than the subtitle's: in sync before 1800 s, 5 s late after.
        val (s, e) = cues()
        val clips = film(s, e) { if (it < 1800) it else it + 5.0 }
        assertEquals(0.0, align(clips, s, e, 400.0)!!.delayS, 0.05)
        assertEquals(5.0, align(clips, s, e, 3200.0)!!.delayS, 0.05)
    }

    @Test
    fun `too few clips or no cues near them are refused`() {
        val (s, e) = cues()
        assertNull("one clip", align(film(s, e) { it }.take(1), s, e, middle))
        assertNull("no cues near the clips", align(film(s, e) { it }, s.map { it + 10_000 }.toDoubleArray(), e.map { it + 10_000 }.toDoubleArray(), middle))
        assertNull("silence", align(clipStarts.map { Clip(it, FloatArray(6000) { -30f }) }, s, e, middle))
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
    fun `a music bed under the dialogue does not hide the delay, nor fake one`() {
        val (s, e) = cues()
        val clips = film(s, e) { it + 1.2 }.map { Clip(it.startS, withBed(it.energy)) }
        assertEquals(1.2, align(clips, s, e, middle)!!.delayS, 0.05)
        val (s2, e2) = cues(seed = 99)
        assertNull(align(film(s2, e2) { it }.map { Clip(it.startS, withBed(it.energy)) }, s, e, middle))
    }

    /**
     * A busy film mix: each line fills only part of its cue, sits up to 0.3 s off its centre, at
     * any level from whisper to shout, and bursts of music and effects as loud as speech cover
     * 80% of the time.
     */
    private fun busyMix(starts: DoubleArray, ends: DoubleArray, speechCues: DoubleArray, delay: Double, start: Double, seed: Int): FloatArray {
        val rnd = Random(seed)
        val n = (clipLength / FRAME_S).roundToInt()
        val out = FloatArray(n) { -48f + rnd.nextFloat() * 8f }
        for (i in starts.indices) {
            val length = (ends[i] - starts[i]) * (0.4 + 0.5 * rnd.nextDouble())
            val at = speechCues.getOrElse(i) { 0.0 } + (ends[i] - starts[i] - length) / 2 + (rnd.nextDouble() * 2 - 1) * 0.3 + delay
            val level = -40f + rnd.nextFloat() * 25f
            val a = ((at - start) / FRAME_S).roundToInt()
            val b = ((at + length - start) / FRAME_S).roundToInt()
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
    fun `a busy mix is never given a wrong delay, and unrelated dialogue in one is refused`() {
        val (s, e) = cues(seed = 1)
        val (other, _) = cues(seed = 99)
        var applied = 0
        (1..6).forEach { seed ->
            val right = align(clipStarts.mapIndexed { i, at -> Clip(at, busyMix(s, e, s, 0.3, at, seed * 10 + i)) }, s, e, middle)
            if (right != null) { applied++; assertEquals("seed $seed", 0.3, right.delayS, 0.2) }
            val unrelated = align(clipStarts.mapIndexed { i, at -> Clip(at, busyMix(s, e, other, 0.0, at, seed * 10 + i)) }, s, e, middle)
            assertNull("seed $seed must refuse unrelated dialogue: $unrelated", unrelated)
        }
        // Accuracy is scripts/subsync-bench.py's to measure, on real films; here, not refusing all.
        assertTrue("applied $applied of 6", applied >= 2)
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
    fun `YAMNet speech scores align on their own, without the dB clamp`() {
        // Loudness flat (nothing to hear), a YAMNet-like Speech score per 0.48 s window: the share
        // of the window that is speech, plus noise, 0..1.
        val (s, e) = cues()
        val delay = 2.37
        val rnd = Random(3)
        val scores = FloatArray((3700 / 0.48).toInt()) { k ->
            val w0 = k * 0.48
            val w1 = w0 + 0.975
            var speech = 0.0
            for (i in s.indices) if (e[i] + delay > w0 && s[i] + delay < w1) speech += minOf(w1, e[i] + delay) - maxOf(w0, s[i] + delay)
            (0.8 * speech / 0.975 + 0.2 * rnd.nextDouble()).toFloat().coerceIn(0f, 1f)
        }
        val n = (clipLength / FRAME_S).roundToInt()
        val clips = clipStarts.map { Clip(it, FloatArray(n) { -30f }, scoreFrames(scores, it, n)) }
        assertEquals(delay, align(clips, s, e, middle)!!.delayS, 0.1)
    }
}
