package com.glide.app.player

import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.shadows.ShadowLog
import java.io.File
import java.io.RandomAccessFile

/**
 * [EmbeddedSubtitles.extractSrt] through [MatroskaSkipper] must give exactly what reading the
 * whole file gives: same cues, same SRT text. The film is made by ffmpeg (skipped without it):
 * video, audio, an SRT and an ASS track, the subtitles in BlockGroups with BlockDuration; once
 * with sized clusters, once as a live stream with unknown-size clusters.
 */
@RunWith(RobolectricTestRunner::class)
class MatroskaSkipperTest {

    private fun ffmpeg(args: List<String>, output: File) {
        val p = ProcessBuilder(listOf("ffmpeg", "-v", "error", "-y") + args)
            .redirectOutput(output).redirectError(ProcessBuilder.Redirect.INHERIT).start()
        assertEquals(0, p.waitFor())
    }

    private fun film(dir: File, live: Boolean): File {
        val srt = File(dir, "a.srt").apply {
            writeText(
                "1\n00:00:01,000 --> 00:00:02,500\nHello <i>there</i>\n\n" +
                    "2\n00:00:03,000 --> 00:00:04,000\nTwo\nlines\n\n" +
                    "3\n00:00:03,500 --> 00:00:07,250\n[door slams]\n\n" +
                    "4\n00:00:09,000 --> 00:00:09,900\n<b>Last</b>\n\n"
            )
        }
        val ass = File(dir, "b.ass").apply {
            writeText(
                "[Script Info]\nScriptType: v4.00+\n\n[V4+ Styles]\n" +
                    "Format: Name, Fontname, Fontsize, PrimaryColour, Bold, Italic\nStyle: Default,Arial,20,&H00FFFFFF,0,0\n\n" +
                    "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n" +
                    "Dialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\i1}Bonjour{\\i0}\n" +
                    "Dialogue: 0,0:00:05.00,0:00:06.20,Default,,0,0,0,,Encore\\Nune fois\n"
            )
        }
        val inputs = listOf(
            "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=10",
            "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
            "-i", srt.path, "-i", ass.path,
            "-map", "0", "-map", "1", "-map", "2", "-map", "3",
            "-c:v", "mpeg4", "-q:v", "2", "-c:a", "aac", "-c:s:0", "srt", "-c:s:1", "ass",
            "-cluster_time_limit", "2000",
        )
        val out = File(dir, if (live) "live.mkv" else "film.mkv")
        if (live) {
            // A pipe can't be seeked back: ffmpeg leaves the Segment's size unknown. A live
            // muxer leaves its Clusters' unknown too; ffmpeg buffers them, so that is patched in.
            ffmpeg(inputs + listOf("-live", "1", "-f", "matroska", "pipe:1"), out)
            unsizeClusters(out)
        } else {
            ffmpeg(inputs + out.path, File(dir, "log"))
        }
        return out
    }

    /** Rewrites every Cluster's size as "unknown" in the same number of bytes, so nothing moves. */
    private fun unsizeClusters(file: File) {
        val d = file.readBytes()
        fun length(p: Int) = Integer.numberOfLeadingZeros(d[p].toInt() and 0xFF) - 23
        fun value(p: Int): Long {
            var v = (d[p].toInt() and (0xFF shr length(p))).toLong()
            for (i in 1 until length(p)) v = (v shl 8) or (d[p + i].toLong() and 0xFF)
            return v
        }
        fun dataStart(p: Int) = p + length(p) + length(p + length(p))
        var p = dataStart(dataStart(0) + value(4).toInt()) // past the EBML header, into the Segment
        var clusters = 0
        while (p < d.size) {
            val sizeAt = p + length(p)
            val next = dataStart(p) + value(sizeAt).toInt()
            if (value(p) == 0x0F43B675L) {
                val n = length(sizeAt)
                d[sizeAt] = (0xFF shr (n - 1)).toByte()
                for (i in 1 until n) d[sizeAt + i] = -1
                clusters++
            }
            p = next
        }
        assertTrue("clusters: $clusters", clusters > 2)
        file.writeBytes(d)
    }

    private fun check(live: Boolean) {
        val dir = kotlin.io.path.createTempDirectory("mkv").toFile()
        try {
            assumeTrue("ffmpeg not on PATH", runCatching { ffmpeg(listOf("-version"), File(dir, "log")) }.isSuccess)
            val file = film(dir, live)
            val context = RuntimeEnvironment.getApplication()
            val uri = Uri.fromFile(file)
            for (ordinal in 0..1) {
                val whole = EmbeddedSubtitles.extractSrt(context, uri, ordinal, skipping = false)
                assertNotNull(whole)
                assertEquals("track $ordinal", whole, EmbeddedSubtitles.extractSrt(context, uri, ordinal))
            }
            assertTrue("fell back to the whole file", ShadowLog.getLogsForTag("EmbeddedSubtitles").isEmpty())

            // Only the subtitle's blocks come out: none of the video.
            RandomAccessFile(file, "r").channel.use { channel ->
                val skipper = MatroskaSkipper(channel) { it == 3L }
                val buffer = ByteArray(4096)
                var served = 0L
                while (true) served += skipper.read(buffer, 0, buffer.size).takeIf { it > 0 } ?: break
                assertTrue("served $served of ${file.length()}", served < file.length() / 20)
                // ffmpeg's file lists every subtitle block in its Cues; its live stream has none,
                // so it is walked: both ways are covered.
                assertEquals("found through the Cues", !live, skipper.usesIndex)
            }
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun sizedClusters() = check(live = false)

    /** The audio track's samples (time, size) from [skipper], or the whole file's without one. */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun audioSamples(uri: Uri, skipper: MatroskaSkipper?): List<Pair<Long, Int>> {
        val samples = ArrayList<Pair<Long, Int>>()
        val output = object : androidx.media3.extractor.ExtractorOutput {
            override fun track(id: Int, type: Int) = if (type != androidx.media3.common.C.TRACK_TYPE_AUDIO) {
                androidx.media3.extractor.DiscardingTrackOutput()
            } else object : androidx.media3.extractor.TrackOutput by androidx.media3.extractor.DiscardingTrackOutput() {
                override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: androidx.media3.extractor.TrackOutput.CryptoData?) {
                    samples += timeUs to size
                }
            }
            override fun endTracks() {}
            override fun seekMap(seekMap: androidx.media3.extractor.SeekMap) {}
        }
        EmbeddedSubtitles.read(RuntimeEnvironment.getApplication(), uri, output, matroska = skipper) { false }
        return samples
    }

    /** From a start time, the audio's samples come out as the whole file has them from that cluster on. */
    @Test fun audioFromStart() {
        val dir = kotlin.io.path.createTempDirectory("mkv").toFile()
        try {
            assumeTrue("ffmpeg not on PATH", runCatching { ffmpeg(listOf("-version"), File(dir, "log")) }.isSuccess)
            val file = film(dir, live = false)
            val uri = Uri.fromFile(file)
            val whole = audioSamples(uri, null)
            val skipped = RandomAccessFile(file, "r").channel.use { audioSamples(uri, MatroskaSkipper(it, 5_000_000L) { n -> n == 2L }) }
            assertTrue("starts at ${skipped.firstOrNull()}", skipped.isNotEmpty() && skipped.first().first in 1..5_000_000L)
            assertEquals(whole.filter { it.first >= skipped.first().first }, skipped)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test fun unknownSizeClusters() = check(live = true)
}
