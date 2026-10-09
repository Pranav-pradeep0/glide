package com.glide.app.audio

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * The UI always sends ten fixed bands; devices expose however many they implement, often
 * five, at their own centre frequencies. Each device band has to pick up the gain of the
 * nearest one the user actually set.
 */
class GlideEqualizerTest {

    /** 60, 170, 310, 600, 1k, 3k, 6k, 12k, 14k, 16k Hz. */
    private val bands = floatArrayOf(1f, 2f, 3f, 4f, 5f, 6f, 7f, 8f, 9f, 10f)

    @Test
    fun `an exact centre frequency takes its own gain`() {
        assertEquals(1f, GlideEqualizer.nearestGainDb(bands, 60), 0f)
        assertEquals(5f, GlideEqualizer.nearestGainDb(bands, 1000), 0f)
        assertEquals(10f, GlideEqualizer.nearestGainDb(bands, 16000), 0f)
    }

    /** The five-band layout a typical device reports. */
    @Test
    fun `a device band takes the nearest requested frequency`() {
        assertEquals(1f, GlideEqualizer.nearestGainDb(bands, 50), 0f)    // -> 60
        assertEquals(2f, GlideEqualizer.nearestGainDb(bands, 230), 0f)   // -> 170, by 60Hz
        assertEquals(5f, GlideEqualizer.nearestGainDb(bands, 910), 0f)   // -> 1000
        assertEquals(6f, GlideEqualizer.nearestGainDb(bands, 3600), 0f)  // -> 3000, by 600Hz
        assertEquals(9f, GlideEqualizer.nearestGainDb(bands, 14500), 0f) // -> 14000, by 500Hz
    }

    @Test
    fun `frequencies past either end clamp to the end band`() {
        assertEquals(1f, GlideEqualizer.nearestGainDb(bands, 0), 0f)
        assertEquals(10f, GlideEqualizer.nearestGainDb(bands, 48000), 0f)
    }

    /** Audio offload is enabled on this, so a wrong answer is silent playback with no EQ. */
    @Test
    fun `flat means absent or every band at zero`() {
        assertTrue(GlideEqualizer.isFlat(null))
        assertTrue(GlideEqualizer.isFlat(floatArrayOf()))
        assertTrue(GlideEqualizer.isFlat(FloatArray(10)))
        assertFalse(GlideEqualizer.isFlat(floatArrayOf(0f, 0f, 0.5f)))
        assertFalse(GlideEqualizer.isFlat(floatArrayOf(-3f, 0f, 0f)))
    }

    /** A device with more bands than the UI sends must not read off the end of the array. */
    @Test
    fun `a short gain array is never indexed past its end`() {
        val fiveBands = floatArrayOf(1f, 2f, 3f, 4f, 5f)
        assertEquals(5f, GlideEqualizer.nearestGainDb(fiveBands, 16000), 0f)
        assertEquals(0f, GlideEqualizer.nearestGainDb(floatArrayOf(), 1000), 0f)
    }
}
