package com.glide.app.player

import com.reactnativesimplethumbnail.FlatFrame
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.random.Random

/** The flat-frame check that keeps failed decodes (solid green) out of the thumbnail caches. */
class FlatFrameTest {

    private fun rgb(r: Int, g: Int, b: Int) = (0xFF shl 24) or (r shl 16) or (g shl 8) or b

    @Test
    fun solidGreenFromAZeroYuvFrameIsFlat() {
        // The device's green thumbnails averaged 1,134,3, with a level or two of JPEG noise.
        val rnd = Random(1)
        assertTrue(FlatFrame.isFlat(IntArray(256) { rgb(rnd.nextInt(0, 3), 133 + rnd.nextInt(0, 3), 2 + rnd.nextInt(0, 3)) }))
    }

    @Test
    fun solidBlackIsFlat() {
        assertTrue(FlatFrame.isFlat(IntArray(256) { rgb(0, 0, 0) }))
    }

    @Test
    fun darkSceneWithDetailIsNotFlat() {
        // A night shot: mostly near-black, a few dim highlights.
        val pixels = IntArray(256) { rgb(4, 4, 6) }
        pixels[40] = rgb(30, 28, 25)
        assertFalse(FlatFrame.isFlat(pixels))
    }

    @Test
    fun ordinaryFrameIsNotFlat() {
        assertFalse(FlatFrame.isFlat(IntArray(256) { rgb(it % 200, 80, 255 - it % 200) }))
    }
}
