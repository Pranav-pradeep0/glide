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
        assertEquals(0.5 / sqrt(2.0), sqrt(w.map { it * it.toDouble() }.average()), 0.01)
    }
}
