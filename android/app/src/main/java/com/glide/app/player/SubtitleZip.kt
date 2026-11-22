package com.glide.app.player

import java.io.File
import java.io.IOException
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
    const val MAX_SUBTITLE_BYTES = SubtitleText.MAX_BYTES

    /**
     * The best subtitle in the archive as text ([SubtitleText] picks the encoding), or null when
     * it holds none. A season pack holds one file per episode: given [episode] (and [season] when
     * known, -1 otherwise), a file named for it (S01E05, 1x05) wins over the format order.
     */
    fun read(zipFile: File, season: Int = -1, episode: Int = -1): String? = ZipFile(zipFile).use { zip ->
        if (zip.size() > MAX_ENTRIES) throw IOException("Subtitle zip has ${zip.size()} entries")
        val named = episode.takeIf { it >= 0 }?.let {
            val s = if (season >= 0) "0*$season" else """\d+"""
            Regex("""(?i)(s$s[ ._-]?e0*$it(?!\d)|(?<!\d)${s}x0*$it(?!\d))""")
        }
        val entry = zip.entries().asSequence()
            // macOS archives carry "__MACOSX/._name.srt" resource forks, which aren't text.
            .filter { !it.isDirectory && !it.name.startsWith("__MACOSX/") }
            .mapNotNull { e -> rank(e.name)?.let { e to it + if (named?.containsMatchIn(e.name) == false) EXTENSIONS.size else 0 } }
            .minByOrNull { it.second }
            ?.first
            ?: return null
        SubtitleText.decode(zip.getInputStream(entry).use(SubtitleText::readCapped))
    }

    private fun rank(name: String): Int? =
        EXTENSIONS.indexOfFirst { name.lowercase().endsWith(it) }.takeIf { it >= 0 }
}
