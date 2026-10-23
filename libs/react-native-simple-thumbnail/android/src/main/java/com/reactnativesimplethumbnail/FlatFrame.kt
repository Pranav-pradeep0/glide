package com.reactnativesimplethumbnail

import android.graphics.Bitmap
import android.os.Build

/**
 * One colour all over: what a decoder that failed silently hands back. 10-bit HEVC on the
 * Amlogic decoder comes out as an all-zero YUV frame, which is solid green. Flat means no
 * variation, not dark: a dark scene still varies by more than [TOLERANCE] somewhere on the
 * grid, and a black opening is the smart timestamp's job, not this check's.
 */
object FlatFrame {
    private const val GRID = 16
    // JPEG noise on a flat frame stays within a couple of levels.
    private const val TOLERANCE = 6

    /** [pixels] are ARGB ints; alpha is ignored. */
    fun isFlat(pixels: IntArray): Boolean {
        if (pixels.isEmpty()) return true
        for (shift in intArrayOf(16, 8, 0)) {
            var lo = 255
            var hi = 0
            for (p in pixels) {
                val c = (p shr shift) and 0xFF
                if (c < lo) lo = c
                if (c > hi) hi = c
            }
            if (hi - lo > TOLERANCE) return false
        }
        return true
    }

    /** Samples a [GRID] x [GRID] grid of cell centres. */
    fun isFlat(bitmap: Bitmap): Boolean {
        // getPixel throws on a HARDWARE bitmap, which loadThumbnail may return.
        val readable = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && bitmap.config == Bitmap.Config.HARDWARE) {
            bitmap.copy(Bitmap.Config.ARGB_8888, false) ?: return false
        } else bitmap
        try {
            val w = readable.width
            val h = readable.height
            return isFlat(IntArray(GRID * GRID) { i ->
                readable.getPixel((i % GRID * 2 + 1) * w / (GRID * 2), (i / GRID * 2 + 1) * h / (GRID * 2))
            })
        } finally {
            if (readable !== bitmap) readable.recycle()
        }
    }
}
