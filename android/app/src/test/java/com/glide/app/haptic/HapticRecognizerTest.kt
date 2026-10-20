package com.glide.app.haptic

import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.sin
import kotlin.math.sqrt
import org.junit.Assert.assertEquals
import org.junit.Test

/** What YAMNet is fed: 0.975 s windows every 0.48 s of the audio, at 16 kHz, in tune and at level. */
class HapticRecognizerTest {
    @Test
    fun resamplesAndWindows() {
        val rate = 48000
        val seconds = 3
        val pcm = ByteBuffer.allocate(rate * seconds * 2 * 2).order(ByteOrder.LITTLE_ENDIAN) // stereo 16-bit
        for (i in 0 until rate * seconds) repeat(2) { pcm.putShort((16384 * sin(2 * PI * 1000 * i / rate)).toInt().toShort()) }
        pcm.flip()
        val fed = mutableListOf<FloatArray>()
        val r = HapticRecognizer { w -> fed += w.copyOf(); FloatArray(HapticSounds.CLASSES) }
        // In decoder-sized chunks, as PcmSink hands them over.
        while (pcm.hasRemaining()) {
            val chunk = pcm.slice().order(ByteOrder.LITTLE_ENDIAN).apply { limit(minOf(remaining(), 1536 * 4)) }
            r.add(0, chunk, 2, rate, false)
            pcm.position(pcm.position() + chunk.limit())
        }
        // (3 s - 0.975 s) / 0.48 s + 1 windows.
        assertEquals(5, fed.size)
        assertEquals(fed.size, r.windows.size)
        val w = fed.last()
        // 1 kHz at 16 kHz: 2000 zero crossings a second, RMS of a half-scale sine.
        val crossings = (1 until w.size).count { (w[it - 1] < 0) != (w[it] < 0) }
        assertEquals(2000.0 * w.size / HapticRecognizer.RATE, crossings.toDouble(), 4.0)
        // Two half-scale channels at 0.707 each, as ffmpeg mixes stereo.
        assertEquals(0.707 * 0.5 * 2 / sqrt(2.0), sqrt(w.map { it * it.toDouble() }.average()), 0.01)
    }

    @Test
    fun windowsStayOnTheFilmsGrid() {
        // Decoding from 1 s (a piece after a jump): the first window is the grid's next, at 1.44 s.
        // The signal is its own media time / 10, so a window's first sample says where it starts.
        val rate = 48000
        val pcm = ByteBuffer.allocate(rate * 3 * 4).order(ByteOrder.LITTLE_ENDIAN)
        for (i in 0 until rate * 3) pcm.putFloat((1.0 + i.toDouble() / rate).toFloat() / 10)
        pcm.flip()
        val fed = mutableListOf<FloatArray>()
        val r = HapticRecognizer { w -> fed += w.copyOf(); FloatArray(HapticSounds.CLASSES) }
        r.add(1_000_000, pcm, 1, rate, true)
        assertEquals(3 + fed.size, r.windows.size) // 0, 0.48 and 0.96 s weren't heard
        assertEquals(0.144, fed.first()[0].toDouble(), 0.001)
    }

    @Test
    fun mixesLikeFfmpeg() {
        // 5.1, one channel at a time at 0.5: front 0.707, centre 1, LFE out, surrounds 0.5.
        val expected = listOf(0.707, 0.707, 1.0, 0.0, 0.5, 0.5)
        for (ch in 0 until 6) {
            val pcm = ByteBuffer.allocate(16000 * 2 * 6 * 4).order(ByteOrder.LITTLE_ENDIAN)
            repeat(16000 * 2) { repeat(6) { c -> pcm.putFloat(if (c == ch) 0.5f else 0f) } }
            pcm.flip()
            val fed = mutableListOf<FloatArray>()
            HapticRecognizer { w -> fed += w.copyOf(); FloatArray(HapticSounds.CLASSES) }.add(0, pcm, 6, 16000, true)
            assertEquals("channel $ch", 0.5 * expected[ch], fed.last().last().toDouble(), 0.01)
        }
    }
}
