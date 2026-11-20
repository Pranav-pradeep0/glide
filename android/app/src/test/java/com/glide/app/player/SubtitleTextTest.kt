package com.glide.app.player

import org.junit.Assert.assertEquals
import org.junit.Test

class SubtitleTextTest {

    @Test
    fun decodesBomsUtf8AndLegacyWindows1252() {
        assertEquals("Café", SubtitleText.decode("Café".toByteArray(Charsets.UTF_8)))
        assertEquals("Café", SubtitleText.decode(byteArrayOf(0xEF.toByte(), 0xBB.toByte(), 0xBF.toByte()) + "Café".toByteArray()))
        assertEquals("Café", SubtitleText.decode(byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + "Café".toByteArray(Charsets.UTF_16LE)))
        assertEquals("Café", SubtitleText.decode(byteArrayOf(0xFE.toByte(), 0xFF.toByte()) + "Café".toByteArray(Charsets.UTF_16BE)))
        // An old SRT saved as windows-1252: é is the lone byte 0xE9, invalid as UTF-8.
        assertEquals("Café “hi”", SubtitleText.decode("Café “hi”".toByteArray(charset("windows-1252"))))
    }
}
