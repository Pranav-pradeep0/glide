package com.glide.app.player

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.Charset
import java.nio.charset.CodingErrorAction

/**
 * Subtitle files from outside the app as text. Many older SRTs are not UTF-8: a BOM names
 * UTF-8/16 outright; otherwise the bytes must be valid UTF-8, or they are read as
 * windows-1252 (Western subtitles' usual legacy encoding) instead of turning into "�".
 */
object SubtitleText {

    const val MAX_BYTES = 10 * 1024 * 1024

    fun decode(bytes: ByteArray): String {
        fun bom(vararg b: Int) = bytes.size >= b.size && b.indices.all { bytes[it] == b[it].toByte() }
        return when {
            bom(0xEF, 0xBB, 0xBF) -> String(bytes, 3, bytes.size - 3, Charsets.UTF_8)
            bom(0xFF, 0xFE) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16LE)
            bom(0xFE, 0xFF) -> String(bytes, 2, bytes.size - 2, Charsets.UTF_16BE)
            else -> try {
                Charsets.UTF_8.newDecoder()
                    .onMalformedInput(CodingErrorAction.REPORT)
                    .onUnmappableCharacter(CodingErrorAction.REPORT)
                    .decode(ByteBuffer.wrap(bytes)).toString()
            } catch (e: CharacterCodingException) {
                String(bytes, Charset.forName("windows-1252"))
            }
        }
    }

    /** The declared size can lie, so the cap counts the bytes actually read. */
    fun readCapped(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            if (out.size() + n > MAX_BYTES) throw IOException("Subtitle is over ${MAX_BYTES / 1024 / 1024} MB")
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }
}
