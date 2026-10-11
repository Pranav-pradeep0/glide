package com.glide.app.player

import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.util.zip.ZipFile

/**
 * Pulls the subtitle out of a downloaded SubDL zip without extracting anything.
 *
 * Only the chosen entry is read, into memory, so no path inside the archive ever reaches
 * the file system (nothing for a `../` name to escape from), and entries that aren't picked
 * are never inflated. The caps stop a zip bomb: a feature film's SRT is around 100 KB.
 */
object SubtitleZip {

    /** In preference order. */
    private val EXTENSIONS = listOf(".srt", ".vtt", ".ass", ".ssa")
    const val MAX_ENTRIES = 1_000
    const val MAX_SUBTITLE_BYTES = 10 * 1024 * 1024

    /** The best subtitle in the archive as UTF-8 text, or null when it holds none. */
    fun read(zipFile: File): String? = ZipFile(zipFile).use { zip ->
        if (zip.size() > MAX_ENTRIES) throw IOException("Subtitle zip has ${zip.size()} entries")
        val entry = zip.entries().asSequence()
            // macOS archives carry "__MACOSX/._name.srt" resource forks, which aren't text.
            .filter { !it.isDirectory && !it.name.startsWith("__MACOSX/") }
            .mapNotNull { e -> rank(e.name)?.let { e to it } }
            .minByOrNull { it.second }
            ?.first
            ?: return null
        zip.getInputStream(entry).use(::readCapped).toString(Charsets.UTF_8)
    }

    private fun rank(name: String): Int? =
        EXTENSIONS.indexOfFirst { name.lowercase().endsWith(it) }.takeIf { it >= 0 }

    /** The declared size can lie, so the cap counts the bytes actually inflated. */
    private fun readCapped(input: InputStream): ByteArray {
        val out = ByteArrayOutputStream()
        val buffer = ByteArray(8 * 1024)
        while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            if (out.size() + n > MAX_SUBTITLE_BYTES) throw IOException("Subtitle is over ${MAX_SUBTITLE_BYTES / 1024 / 1024} MB")
            out.write(buffer, 0, n)
        }
        return out.toByteArray()
    }
}
