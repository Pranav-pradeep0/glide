package com.glide.app.player

import android.content.Context
import android.graphics.Typeface
import android.net.Uri
import android.text.Spanned
import android.text.style.StyleSpan
import android.text.style.UnderlineSpan
import androidx.media3.common.C
import androidx.media3.common.DataReader
import androidx.media3.common.Format
import androidx.media3.common.MimeTypes
import androidx.media3.common.util.ParsableByteArray
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.extractor.DefaultExtractorInput
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.DiscardingTrackOutput
import androidx.media3.extractor.Extractor
import androidx.media3.extractor.ExtractorOutput
import androidx.media3.extractor.PositionHolder
import androidx.media3.extractor.SeekMap
import androidx.media3.extractor.TrackOutput
import androidx.media3.extractor.text.CueDecoder
import androidx.media3.extractor.text.DefaultSubtitleParserFactory
import java.io.EOFException
import java.io.File
import java.util.Locale

/**
 * Embedded subtitle tracks, read with the same Media3 extractors and subtitle parsers the
 * player uses -- so track ordinals here are the player's ordinals, and anything the player
 * can show, this can hand to JS as a whole.
 *
 * Why a whole track: the player streams cues as playback reaches them, but haptics, subtitle
 * delay, auto-sync, Recap and SDH detection all need every cue upfront. This replaces the
 * ffmpeg-kit extraction that used to provide that.
 */
@UnstableApi
object EmbeddedSubtitles {

    data class Track(
        val ordinal: Int,
        val language: String,
        val label: String?,
        val codec: String,
        val isBitmap: Boolean,
        val isDefault: Boolean,
        val isForced: Boolean,
    )

    private data class Cue(val startUs: Long, var endUs: Long, val text: String)

    /** Text subtitle tracks in the container's order. Reads only the header. */
    fun listTracks(context: Context, uri: Uri): List<Track> {
        val output = Collector(wantedOrdinal = -1)
        read(context, uri, output) { output.tracksEnded && output.formats.none { it == null } }
        return output.formats.mapIndexed { ordinal, format -> describe(ordinal, format) }
    }

    /**
     * The whole track as SRT text, or null if it has no text cues (bitmap, unsupported or
     * empty). Reads the entire file, as ffmpeg did; callers cache the result.
     */
    fun extractSrt(context: Context, uri: Uri, ordinal: Int): String? {
        val output = Collector(wantedOrdinal = ordinal)
        read(context, uri, output) { false }
        val cues = output.cues.sortedBy { it.startUs }
        if (cues.isEmpty()) return null
        // A cue the format left open-ended runs until the next one starts.
        cues.forEachIndexed { i, cue ->
            if (cue.endUs <= cue.startUs) {
                cue.endUs = cues.getOrNull(i + 1)?.startUs ?: (cue.startUs + 3_000_000)
            }
        }
        return buildString {
            cues.forEachIndexed { i, cue ->
                append(i + 1).append('\n')
                append(srtTime(cue.startUs)).append(" --> ").append(srtTime(cue.endUs)).append('\n')
                append(cue.text).append("\n\n")
            }
        }
    }

    fun isNetwork(uri: Uri) = uri.scheme == "http" || uri.scheme == "https" || uri.scheme == "smb"

    fun toUri(path: String): Uri = if (path.startsWith("/")) Uri.fromFile(File(path)) else Uri.parse(path)

    // ---------------------------------------------------------------------------------------

    private fun describe(ordinal: Int, format: Format?): Track {
        // With transcoding on, the parsed track's mime is media3-cues and codecs holds the
        // container's original mime.
        val mime = (format?.codecs ?: format?.sampleMimeType ?: "").lowercase(Locale.US)
        val codec = when {
            mime.contains("subrip") -> "subrip"
            mime.contains("ssa") || mime.contains("ass") -> "ass"
            mime.contains("vtt") -> "webvtt"
            mime.contains("tx3g") -> "mov_text"
            mime.contains("pgs") -> "hdmv_pgs_subtitle"
            mime.contains("vobsub") -> "dvd_subtitle"
            mime.contains("dvbsubs") -> "dvb_subtitle"
            else -> mime.substringAfterLast('/')
        }
        val flags = format?.selectionFlags ?: 0
        return Track(
            ordinal = ordinal,
            language = format?.language ?: "und",
            label = format?.label,
            codec = codec,
            isBitmap = codec == "hdmv_pgs_subtitle" || codec == "dvd_subtitle" || codec == "dvb_subtitle",
            isDefault = flags and C.SELECTION_FLAG_DEFAULT != 0,
            isForced = flags and C.SELECTION_FLAG_FORCED != 0,
        )
    }

    /**
     * Runs a Media3 extractor over [uri] into [output] until [done] or the end of the file.
     * [seekTo] is asked after every read; a non-null point repositions the extractor there
     * (used to jump to a time once the file's seek map is known).
     */
    internal fun read(
        context: Context,
        uri: Uri,
        output: ExtractorOutput,
        seekTo: () -> androidx.media3.extractor.SeekPoint? = { null },
        done: () -> Boolean,
    ) {
        val extractors = DefaultExtractorsFactory()
            .setSubtitleParserFactory(DefaultSubtitleParserFactory())
            .setTextTrackTranscodingEnabled(true)
            .createExtractors(uri, emptyMap())
        val dataSource = DefaultDataSource(context, /* allowCrossProtocolRedirects = */ false)

        fun open(position: Long): DefaultExtractorInput {
            val length = dataSource.open(DataSpec.Builder().setUri(uri).setPosition(position).build())
            return DefaultExtractorInput(
                dataSource, position, if (length == C.LENGTH_UNSET.toLong()) C.LENGTH_UNSET.toLong() else position + length
            )
        }

        val extractor: Extractor = extractors.firstOrNull { candidate ->
            try {
                candidate.sniff(open(0))
            } catch (_: EOFException) {
                false
            } finally {
                dataSource.close()
            }
        } ?: return

        try {
            extractor.init(output)
            val holder = PositionHolder()
            var position = 0L
            outer@ while (true) {
                val input = open(position)
                try {
                    while (!done()) {
                        when (extractor.read(input, holder)) {
                            Extractor.RESULT_SEEK -> {
                                position = holder.position
                                continue@outer
                            }
                            Extractor.RESULT_END_OF_INPUT -> break@outer
                        }
                        val point = seekTo()
                        if (point != null) {
                            extractor.seek(point.position, point.timeUs)
                            position = point.position
                            continue@outer
                        }
                    }
                    break@outer
                } finally {
                    dataSource.close()
                }
            }
        } finally {
            extractor.release()
        }
    }

    /** Records text track formats; decodes the cues of [wantedOrdinal] and discards the rest. */
    private class Collector(private val wantedOrdinal: Int) : ExtractorOutput {
        val formats = ArrayList<Format?>()
        val cues = ArrayList<Cue>()
        var tracksEnded = false

        override fun track(id: Int, type: Int): TrackOutput {
            if (type != C.TRACK_TYPE_TEXT) return DiscardingTrackOutput()
            val ordinal = formats.size
            formats.add(null)
            return if (ordinal == wantedOrdinal) CueTrack(ordinal) else FormatOnly(ordinal)
        }

        override fun endTracks() {
            tracksEnded = true
        }

        override fun seekMap(seekMap: SeekMap) {}

        private open inner class FormatOnly(val ordinal: Int) : TrackOutput {
            private val discard = DiscardingTrackOutput()
            override fun format(format: Format) {
                formats[ordinal] = format
            }
            override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int) =
                discard.sampleData(input, length, allowEndOfInput, sampleDataPart)
            override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) =
                discard.sampleData(data, length, sampleDataPart)
            override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {}
        }

        /** Buffers sample bytes and decodes each finished sample into a cue. */
        private inner class CueTrack(ordinal: Int) : FormatOnly(ordinal) {
            private var buffer = ByteArray(4096)
            private var length = 0
            private val decoder = CueDecoder()

            private fun ensure(extra: Int) {
                if (length + extra > buffer.size) buffer = buffer.copyOf(maxOf(buffer.size * 2, length + extra))
            }

            override fun sampleData(input: DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
                ensure(length)
                val read = input.read(buffer, this.length, length)
                if (read == C.RESULT_END_OF_INPUT) {
                    if (allowEndOfInput) return C.RESULT_END_OF_INPUT
                    throw EOFException()
                }
                this.length += read
                return read
            }

            override fun sampleData(data: ParsableByteArray, length: Int, sampleDataPart: Int) {
                ensure(length)
                data.readBytes(buffer, this.length, length)
                this.length += length
            }

            override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: TrackOutput.CryptoData?) {
                val end = length - offset
                val start = end - size
                if (start >= 0 && formats[ordinal]?.sampleMimeType == MimeTypes.APPLICATION_MEDIA3_CUES) {
                    val timed = decoder.decode(timeUs, buffer, start, size)
                    val text = timed.cues.mapNotNull { it.text?.let(::toSrtText) }
                        .filter { it.isNotBlank() }
                        .joinToString("\n")
                    if (text.isNotEmpty()) {
                        val startUs = if (timed.startTimeUs != C.TIME_UNSET) timed.startTimeUs else timeUs
                        val endUs = if (timed.durationUs != C.TIME_UNSET) startUs + timed.durationUs else C.TIME_UNSET
                        cues.add(Cue(startUs, endUs, text))
                    }
                }
                // Keep only bytes that belong to samples not yet committed.
                System.arraycopy(buffer, end, buffer, 0, length - end)
                length -= end
            }
        }
    }

    /** Italic, bold and underline survive as SRT tags, the way ffmpeg's SRT output kept them. */
    private fun toSrtText(text: CharSequence): String {
        if (text !is Spanned) return text.toString().trim()
        val out = StringBuilder()
        val opens = HashMap<Int, MutableList<String>>()
        val closes = HashMap<Int, MutableList<String>>()
        fun mark(start: Int, end: Int, tag: String) {
            opens.getOrPut(start) { mutableListOf() }.add("<$tag>")
            closes.getOrPut(end) { mutableListOf() }.add(0, "</$tag>")
        }
        for (span in text.getSpans(0, text.length, Any::class.java)) {
            val s = text.getSpanStart(span)
            val e = text.getSpanEnd(span)
            when {
                span is StyleSpan && span.style == Typeface.ITALIC -> mark(s, e, "i")
                span is StyleSpan && span.style == Typeface.BOLD -> mark(s, e, "b")
                span is StyleSpan && span.style == Typeface.BOLD_ITALIC -> { mark(s, e, "b"); mark(s, e, "i") }
                span is UnderlineSpan -> mark(s, e, "u")
            }
        }
        for (i in 0..text.length) {
            closes[i]?.forEach { out.append(it) }
            opens[i]?.forEach { out.append(it) }
            if (i < text.length) out.append(text[i])
        }
        return out.toString().trim()
    }

    private fun srtTime(us: Long): String {
        val ms = (us / 1000).coerceAtLeast(0)
        return String.format(
            Locale.US, "%02d:%02d:%02d,%03d",
            ms / 3_600_000, (ms / 60_000) % 60, (ms / 1000) % 60, ms % 1000
        )
    }
}
