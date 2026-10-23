package com.glide.app.player

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

/** Generated signals in, numbers measured out; every expectation is computed here. */
class VolumeLevelerTest {

    private val rate = 48000

    private fun leveler(channels: Int, on: Boolean) = VolumeLeveler().apply {
        enabled = on
        configure(AudioProcessor.AudioFormat(rate, channels, C.ENCODING_PCM_16BIT))
        flush()
    }

    /** Feeds [input] in chunks, then end of stream. [beforeChunk] sees the frame index. */
    private fun VolumeLeveler.run(
        input: ShortArray, channels: Int, chunk: Int = 997, beforeChunk: (Int) -> Unit = {},
    ): ShortArray {
        val out = ArrayList<Short>(input.size)
        fun drain() {
            val b = output.order(ByteOrder.nativeOrder())
            while (b.hasRemaining()) out.add(b.short)
        }
        val frames = input.size / channels
        var i = 0
        while (i < frames) {
            beforeChunk(i)
            val n = minOf(chunk, frames - i)
            val buf = ByteBuffer.allocateDirect(n * channels * 2).order(ByteOrder.nativeOrder())
            for (k in 0 until n * channels) buf.putShort(input[i * channels + k])
            buf.flip()
            queueInput(buf)
            assertFalse(buf.hasRemaining())
            drain()
            i += n
        }
        queueEndOfStream()
        var guard = 0
        while (!isEnded) {
            queueInput(AudioProcessor.EMPTY_BUFFER)
            drain()
            check(++guard < 10)
        }
        return out.toShortArray()
    }

    private fun dbfs(x: Double) = 20 * log10(x / 32768)

    private fun rms(s: ShortArray, channels: Int, ch: Int, from: Int, to: Int): Double {
        var sum = 0.0
        for (f in from until to) sum += s[f * channels + ch].toDouble().pow(2)
        return sqrt(sum / (to - from))
    }

    private fun stereo(mono: DoubleArray) = ShortArray(mono.size * 2) { mono[it / 2].roundToInt().coerceIn(-32768, 32767).toShort() }

    private fun scaled(x: DoubleArray, rmsDbfs: Double): DoubleArray {
        val r = sqrt(x.sumOf { it * it } / x.size)
        val k = 32768 * 10.0.pow(rmsDbfs / 20) / r
        return DoubleArray(x.size) { x[it] * k }
    }

    private fun tone(hz: Double, seconds: Double, amp: Double, phase: Double = 0.0) =
        DoubleArray((seconds * rate).toInt()) { amp * sin(2 * PI * hz * it / rate + phase) }

    /**
     * Independent true-peak meter: 16x windowed-sinc (Blackman, 64 taps each side), much
     * finer and longer than the processor's 4x Lanczos. Linear, not dB.
     *
     * Every frame of [from, to), unless [near] is set: then only frames within 2 of a sample
     * louder than [near] -- an inter-sample peak sits beside loud samples, never in silence.
     */
    private fun truePeak(s: ShortArray, channels: Int, from: Int, to: Int, near: Double = 0.0): Double {
        val over = 16
        val half = 64
        val frames = s.size / channels
        var peak = 0.0
        val loud = BooleanArray(frames) { f -> (0 until channels).any { abs(s[f * channels + it].toInt()) >= near * 32768 } }
        for (ch in 0 until channels) for (f in from until to) {
            if (near > 0 && (maxOf(0, f - 2)..minOf(frames - 1, f + 2)).none { loud[it] }) continue
            for (p in 0 until over) {
            val t = f + p.toDouble() / over
            var v = 0.0
            for (k in f - half + 1..f + half) {
                if (k < 0 || k >= frames) continue
                val d = t - k
                val win = 0.42 + 0.5 * cos(PI * d / half) + 0.08 * cos(2 * PI * d / half)
                val sinc = if (d == 0.0) 1.0 else sin(PI * d) / (PI * d)
                v += s[k * channels + ch] * sinc * win
            }
            peak = max(peak, abs(v) / 32768)
            }
        }
        return peak
    }

    @Test
    fun offIsBitExactAndKeepsEveryFrame() {
        val r = Random(1)
        for (channels in listOf(1, 2, 6, 8)) {
            val input = ShortArray(rate / 2 * channels) { r.nextInt(-32768, 32768).toShort() }
            val out = leveler(channels, on = false).run(input, channels)
            assertArrayEquals("channels=$channels", input, out)
        }
    }

    @Test
    fun onKeepsEveryFrameInStep() {
        // Below the knee the leveler is a constant make-up gain, so on is the input times
        // that gain, sample for sample: no frame lost, no offset (A/V sync untouched).
        val input = stereo(tone(1000.0, 1.0, 32768 * 10.0.pow(-50.0 / 20)))
        val out = leveler(2, on = true).run(input, 2)
        assertEquals(input.size, out.size)
        val g = 10.0.pow(VolumeLeveler.MAKEUP_DB / 20)
        for (i in rate / 2 * 2 until input.size) {
            assertEquals("sample $i", input[i] * g, out[i].toDouble(), 1.5)
        }
    }

    @Test
    fun loudGetsQuieterAndQuietSpeechGetsLouder() {
        val r = Random(2)
        // 3 s loud broadband (an explosion), then 4 s quiet speech-band (300 Hz..3 kHz).
        val loud = scaled(DoubleArray(3 * rate) { r.nextDouble(-1.0, 1.0) }, -8.0)
        val freqs = DoubleArray(40) { r.nextDouble(300.0, 3000.0) }
        val phases = DoubleArray(40) { r.nextDouble(0.0, 2 * PI) }
        val speech = scaled(DoubleArray(4 * rate) { n -> freqs.indices.sumOf { sin(2 * PI * freqs[it] * n / rate + phases[it]) } }, -38.0)
        val input = stereo(loud + speech)
        val out = leveler(2, on = true).run(input, 2)

        // Settled windows: the last 2 s of each part.
        val loudIn = dbfs(rms(input, 2, 0, 1 * rate, 3 * rate))
        val loudOut = dbfs(rms(out, 2, 0, 1 * rate, 3 * rate))
        val quietIn = dbfs(rms(input, 2, 0, 5 * rate, 7 * rate))
        val quietOut = dbfs(rms(out, 2, 0, 5 * rate, 7 * rate))
        println("loud $loudIn -> $loudOut dBFS, quiet $quietIn -> $quietOut dBFS")

        assertTrue("loud part quieter", loudOut <= loudIn - 4)
        assertTrue("quiet speech louder", quietOut >= quietIn + 6)
        assertTrue("range shrinks by at least 12 dB", (loudOut - quietOut) <= (loudIn - quietIn) - 12)
    }

    @Test
    fun dialogueMixLiftsCentreAndCutsLfeAgainstTheAndroidFoldDown() {
        // Android's ChannelMix 5.1 -> stereo, the fold-down AudioTrack applies today.
        val reference = doubleArrayOf(1.0, 0.0, 0.7071, 0.5, 0.7071, 0.0)
        val g = 10.0.pow(VolumeLeveler.MAKEUP_DB / 20)
        val level = 32768 * 10.0.pow(-55.0 / 20) // below the knee: the gain is exactly make-up
        val measured = DoubleArray(6) { ch ->
            val t = tone(1000.0, 1.0, level)
            val input = ShortArray(t.size * 6)
            for (f in t.indices) input[f * 6 + ch] = t[f].roundToInt().toShort()
            val p = leveler(6, on = true)
            val out = p.run(input, 6)
            assertEquals("stereo out", 2 * t.size, out.size)
            rms(out, 2, 0, rate / 2, rate) / (level / sqrt(2.0)) / g
        }
        println("left-output coefficients: ${measured.joinToString { "%.3f".format(it) }}")
        assertEquals("front left unchanged", 1.0, measured[0], 0.02)
        assertEquals("front right stays right", 0.0, measured[1], 0.02)
        val centreDb = 20 * log10(measured[2] / reference[2])
        assertTrue("centre +3..+6 dB over the fold-down, was $centreDb", centreDb in 3.0..6.0)
        assertTrue("LFE reduced", measured[3] < reference[3] * 10.0.pow(-3.0 / 20))
        assertTrue("surround reduced", measured[4] < reference[4])
    }

    @Test
    fun limiterHoldsTruePeakUnderTheCeiling() {
        val r = Random(3)
        // A sine at fs/4, 45 degrees off: samples read -3 dBFS, the waveform peaks at 0.
        val quarter = stereo(tone(rate / 4.0, 1.0, 32767.0, PI / 4))
        val meterCheck = truePeak(quarter, 2, rate / 4, rate / 4 + 200)
        assertEquals("the meter itself reads the inter-sample peak", 1.0, meterCheck, 0.01)

        val cases = mapOf(
            "full-scale noise" to ShortArray(2 * rate) { r.nextInt(-32768, 32768).toShort() },
            "fs/4 sine" to quarter,
            "full-scale square" to stereo(DoubleArray(rate) { if ((it / 24) % 2 == 0) 32767.0 else -32768.0 }),
            "loud 60 Hz + 9 kHz" to stereo(DoubleArray(rate) { 23000 * sin(2 * PI * 60 * it / rate) + 9000 * sin(2 * PI * 9000 * it / rate) }),
        )
        // Each after half a second of quiet: the compressor sits at full make-up gain when the
        // blast lands (an explosion after quiet dialogue), so only the limiter stands between
        // its first milliseconds and clipping.
        val quiet = ShortArray(rate) { r.nextInt(-100, 100).toShort() }
        for ((name, blast) in cases) {
            val out = leveler(2, on = true).run(quiet + blast, 2)
            val frames = out.size / 2
            val samplePeak = out.maxOf { abs(it.toInt()) } / 32768.0
            // The whole output, start transient included; the meter only skips quiet frames.
            val tp = truePeak(out, 2, 0, frames, near = VolumeLeveler.CEILING / 4)
            println("$name: sample ${dbfs(samplePeak * 32768)} dBFS, true ${dbfs(tp * 32768)} dBTP")
            assertTrue("$name sample peak", samplePeak <= VolumeLeveler.CEILING + 1.0 / 32768)
            assertTrue("$name true peak", tp <= VolumeLeveler.CEILING * 10.0.pow(0.25 / 20))
            assertTrue("$name reaches the limiter", tp >= VolumeLeveler.CEILING * 10.0.pow(-1.0 / 20))
        }
    }

    @Test
    fun togglingMidStreamHasNoJump() {
        val hz = 440.0
        val input = stereo(tone(hz, 4.0, 32768 * 10.0.pow(-20.0 / 20)))
        val p = leveler(2, on = false)
        val out = p.run(input, 2, chunk = 480) { frame ->
            if (frame == rate) p.enabled = true
            if (frame == 5 * rate / 2) p.enabled = false
        }
        val before = dbfs(rms(out, 2, 0, rate / 2, rate))
        val during = dbfs(rms(out, 2, 0, 2 * rate, 5 * rate / 2))
        println("off $before dBFS, on $during dBFS")
        assertTrue("the toggle changes the level", abs(during - before) >= 4)

        // A sine's largest step is 2*pi*f/fs * amplitude. A click is a step far above it.
        var peakAmp = 0
        for (i in out.indices step 2) peakAmp = max(peakAmp, abs(out[i].toInt()))
        val allowed = 2 * PI * hz / rate * peakAmp * 1.1 + 2
        var worst = 0.0
        for (f in 1 until out.size / 2) worst = max(worst, abs(out[f * 2] - out[(f - 1) * 2]).toDouble())
        assertTrue("largest step $worst vs sine bound $allowed", worst <= allowed)
    }

    @Test
    fun multichannelAsksForAReconfigureOnlyWhenTheLayoutMustChange() {
        val six = AudioProcessor.AudioFormat(rate, 6, C.ENCODING_PCM_16BIT)
        val p = VolumeLeveler()
        assertEquals(6, p.configure(six).channelCount)
        p.flush()
        assertFalse(p.needsReconfigure())
        p.enabled = true
        assertTrue(p.needsReconfigure())
        assertEquals(2, p.configure(six).channelCount)
        p.flush()
        assertFalse(p.needsReconfigure())
        p.enabled = false
        assertTrue(p.needsReconfigure())

        val s = leveler(2, on = false)
        s.enabled = true
        assertFalse("stereo toggles in place", s.needsReconfigure())
    }

    @Test
    fun reconfigureMidStreamFollowsTheSinksDrainThenFlush() {
        // DefaultAudioSink's order: configure (pending) while the old layout still plays,
        // drain to end of stream in the old layout, then flush into the new one.
        val r = Random(5)
        val six = AudioProcessor.AudioFormat(rate, 6, C.ENCODING_PCM_16BIT)
        val p = VolumeLeveler()
        p.configure(six)
        p.flush()
        fun feed(frames: Int): Int {
            val buf = ByteBuffer.allocateDirect(frames * 12).order(ByteOrder.nativeOrder())
            repeat(frames * 6) { buf.putShort(r.nextInt(-8000, 8000).toShort()) }
            buf.flip()
            p.queueInput(buf)
            return p.output.remaining()
        }
        var bytes = feed(4800)
        p.enabled = true
        assertEquals(2, p.configure(six).channelCount)
        bytes += feed(4800)
        p.queueEndOfStream()
        while (!p.isEnded) { p.queueInput(AudioProcessor.EMPTY_BUFFER); bytes += p.output.remaining() }
        assertEquals("old layout to the end, every frame", 9600 * 12, bytes)

        p.flush()
        assertFalse(p.needsReconfigure())
        assertEquals("new layout after the flush", (4800 - p.latencyFrames) * 4, feed(4800))
    }

    @Test
    fun noLoudnessBumpAfterAFlush() {
        // A seek is a flush. Loud steady sound (well into compression): the first 20 ms after
        // it must already sit at the settled level, not at full make-up gain.
        val r = Random(6)
        val input = stereo(scaled(DoubleArray(rate) { r.nextDouble(-1.0, 1.0) }, -12.0))
        val out = leveler(2, on = true).run(input, 2)
        val first = dbfs(rms(out, 2, 0, 0, rate / 50))
        val settled = dbfs(rms(out, 2, 0, rate / 2, rate))
        println("after flush $first dBFS, settled $settled dBFS")
        assertEquals(settled, first, 1.5)
    }

    @Test
    fun countsWithoutAnAgreedOrderKeepTheirLayout() {
        // 3, 4, 5 and 7 channels: FFmpeg and Android disagree on where the centre is.
        for (n in listOf(3, 4, 5, 7)) {
            val p = VolumeLeveler().apply { enabled = true }
            assertEquals(n, p.configure(AudioProcessor.AudioFormat(rate, n, C.ENCODING_PCM_16BIT)).channelCount)
            assertFalse(p.needsReconfigure())
        }
    }

    @Test
    fun downmixedOutputKeepsEveryFrame() {
        val r = Random(4)
        val input = ShortArray(rate * 6) { r.nextInt(-8000, 8000).toShort() }
        val out = leveler(6, on = true).run(input, 6)
        assertEquals(input.size / 6, out.size / 2)
    }

    @Test
    fun otherEncodingsStandAside() {
        val p = VolumeLeveler().apply { enabled = true }
        p.configure(AudioProcessor.AudioFormat(rate, 2, C.ENCODING_PCM_FLOAT))
        assertFalse(p.isActive)
    }
}
