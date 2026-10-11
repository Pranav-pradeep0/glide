package com.glide.app.player

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File
import java.io.IOException
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class SubtitleZipTest {

    private fun zipOf(vararg entries: Pair<String, ByteArray>): File =
        File.createTempFile("sub", ".zip").apply {
            deleteOnExit()
            ZipOutputStream(outputStream()).use { zip ->
                for ((name, bytes) in entries) {
                    zip.putNextEntry(ZipEntry(name))
                    zip.write(bytes)
                    zip.closeEntry()
                }
            }
        }

    @Test
    fun picksSrtOverOtherFormatsAndSkipsMacResourceForks() {
        val zip = zipOf(
            "__MACOSX/._film.srt" to byteArrayOf(0, 5, 22, 7),
            "extras/film.vtt" to "WEBVTT".toByteArray(),
            "nested/film.SRT" to "1\n00:00:01,000 --> 00:00:02,000\nHi".toByteArray(),
            "readme.txt" to "x".toByteArray(),
        )
        assertEquals("1\n00:00:01,000 --> 00:00:02,000\nHi", SubtitleZip.read(zip))
    }

    @Test
    fun nullWhenNoSubtitle() {
        assertNull(SubtitleZip.read(zipOf("readme.txt" to "x".toByteArray())))
    }

    @Test
    fun entryNamedToEscapeIsReadNotWritten() {
        assertEquals("ok -->", SubtitleZip.read(zipOf("../../evil.srt" to "ok -->".toByteArray())))
    }

    @Test(expected = IOException::class)
    fun refusesAnOversizedSubtitle() {
        // Zeros compress to almost nothing: the shape of a zip bomb.
        SubtitleZip.read(zipOf("bomb.srt" to ByteArray(SubtitleZip.MAX_SUBTITLE_BYTES + 1)))
    }
}
