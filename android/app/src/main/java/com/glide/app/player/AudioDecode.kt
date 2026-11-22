package com.glide.app.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaFormat

/**
 * Compressed audio in a video or music file, decoded to PCM. Shared by auto-sync
 * ([SubtitleSyncModule]) and haptics ([com.glide.app.haptic.HapticAnalysis]).
 */
internal object AudioDecode {
    private const val TAG = "AudioDecode"

    /**
     * No AAC dynamic range control: it narrows the gap between dialogue and the quiet around
     * it, which is what alignment measures. Zero boost and cut remove its gain in any mode.
     */
    private fun disableDrc(format: MediaFormat) {
        format.setInteger(MediaFormat.KEY_AAC_DRC_EFFECT_TYPE, 0)
        format.setInteger(MediaFormat.KEY_AAC_DRC_HEAVY_COMPRESSION, 0)
        format.setInteger(MediaFormat.KEY_AAC_DRC_BOOST_FACTOR, 0)
        format.setInteger(MediaFormat.KEY_AAC_DRC_ATTENUATION_FACTOR, 0)
        format.setInteger(MediaFormat.KEY_AAC_DRC_TARGET_REFERENCE_LEVEL, -1)
    }

    /**
     * Decodes the first decodable audio track of [videoPath] from [startUs] into [sink]
     * until the file ends or the sink is done. Returns what was used, for the log.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    internal fun decodeAudio(
        context: android.content.Context,
        videoPath: String,
        sink: PcmSink,
        startUs: Long = 0L,
        targetTrackIndex: Int = -1,
        preferFfmpeg: Boolean = false,
    ): String {
        val uri = EmbeddedSubtitles.toUri(videoPath)
        var audio = AudioCollector(sink, startUs, targetTrackIndex, preferFfmpeg)
        try {
            // A local MKV is served with only the chosen track's blocks from the cluster
            // before startUs, the video seeked past instead of read.
            val skipped = try {
                EmbeddedSubtitles.skipping(context, uri, startUs, keep = { audio.keeps(it) }) { skipper ->
                    EmbeddedSubtitles.read(context, uri, audio, matroska = skipper) { sink.done || audio.noDecoder }
                } != null
            } catch (e: Exception) {
                if (audio.fed) throw e
                android.util.Log.w(TAG, "skipping reader failed, reading the whole file: $e")
                audio.decoder?.release()
                audio = AudioCollector(sink, startUs, targetTrackIndex, preferFfmpeg)
                false
            }
            if (!skipped) {
                EmbeddedSubtitles.read(context, uri, audio, seekTo = audio::seekRequest) { sink.done || audio.noDecoder }
            }
            if (!sink.done) audio.decoder?.finish()
            return "tracks=${audio.trackMimes} targetTrack=$targetTrackIndex chosen=${audio.chosen} " +
                "using=${audio.description} skipped=$skipped"
        } finally {
            audio.decoder?.release()
        }
    }

    /** Where [decodeAudio] puts decoded PCM. */
    internal interface PcmSink {
        /** Stop decoding. */
        val done: Boolean

        /** [data] holds interleaved PCM from its position to its limit, starting at [ptsUs]. */
        fun add(ptsUs: Long, data: java.nio.ByteBuffer, channels: Int, rate: Int, isFloat: Boolean)
    }

    /** PCM out of compressed audio samples, into a [PcmSink]. */
    private interface PcmDecoder {
        fun feed(data: ByteArray, offset: Int, size: Int, timeUs: Long)
        fun finish()
        fun release()
    }

    /** Picks the first decodable audio track once the header is read, and feeds its samples to a decoder. */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private class AudioCollector(
        private val window: PcmSink,
        private val startUs: Long,
        private val targetTrackIndex: Int = -1,
        private val preferFfmpeg: Boolean = false,
    ) : androidx.media3.extractor.ExtractorOutput {
        private val formats = ArrayList<androidx.media3.common.Format?>()
        private var seekMap: androidx.media3.extractor.SeekMap? = null
        var chosen = -1
            private set
        private var seeked = false
        var decoder: PcmDecoder? = null
            private set
        var noDecoder = false
            private set
        var description = "none"
            private set
        val trackMimes get() = formats.map { it?.sampleMimeType }
        /** A sample has gone to the decoder: a retry from scratch would feed the sink twice. */
        var fed = false
            private set

        /** Whether Matroska TrackNumber [number] is the chosen track (Format.id is the TrackNumber). */
        fun keeps(number: Long) = formats.getOrNull(chosen)?.id == number.toString()

        override fun track(id: Int, type: Int): androidx.media3.extractor.TrackOutput {
            if (type != androidx.media3.common.C.TRACK_TYPE_AUDIO) return androidx.media3.extractor.DiscardingTrackOutput()
            val index = formats.size
            formats.add(null)
            return SampleTrack(index)
        }

        override fun seekMap(seekMap: androidx.media3.extractor.SeekMap) {
            this.seekMap = seekMap
        }

        override fun endTracks() {
            if (decoder != null || noDecoder) return
            val codecs = MediaCodecList(MediaCodecList.REGULAR_CODECS)
            val ffmpeg = try { androidx.media3.decoder.ffmpeg.FfmpegLibrary.isAvailable() } catch (_: Throwable) { false }
            // The track being heard first: on a dubbed release the first track is often another
            // language, whose lines start and stop at other times than the subtitle's.
            val order = listOf(targetTrackIndex).filter { it in formats.indices } +
                formats.indices.filter { it != targetTrackIndex }
            for (i in order) {
                val format = formats[i] ?: continue
                val mediaFormat = androidx.media3.common.util.MediaFormatUtil.createMediaFormatFromFormat(format)
                val name = if (preferFfmpeg && ffmpeg && androidx.media3.decoder.ffmpeg.FfmpegLibrary.supportsFormat(format.sampleMimeType ?: "")) null
                    else inProcessDecoder(codecs, format.sampleMimeType)
                        ?: try { codecs.findDecoderForFormat(mediaFormat) } catch (_: Exception) { null }
                // A decoder can be listed for a format and still refuse to configure it
                // (E-AC-3 JOC, AC-4 on some devices). Fall through to FFmpeg, then the next
                // track, rather than failing the whole alignment.
                val platform = name?.let {
                    try {
                        MediaCodecPcm(mediaFormat, it, window)
                    } catch (e: Exception) {
                        android.util.Log.w(TAG, "decoder $it refused ${format.sampleMimeType}: ${e.message}")
                        null
                    }
                }
                if (platform != null) {
                    chosen = i
                    decoder = platform
                    description = "${format.sampleMimeType} [track $i] via $name"
                    return
                }
                if (ffmpeg && androidx.media3.decoder.ffmpeg.FfmpegLibrary.supportsFormat(format.sampleMimeType ?: continue)) {
                    chosen = i
                    decoder = FfmpegPcm(format, window)
                    description = "${format.sampleMimeType} [track $i] via ffmpeg"
                    return
                }
            }
            noDecoder = true
        }

        /**
         * Android 17's in-process platform decoders (c2.android.inproc.aac/opus.decoder, also
         * coming through Mainline updates) skip the per-buffer IPC to the media.swcodec process;
         * Google measures ~40% less decode time. Picked by name: they are not the default yet.
         */
        private fun inProcessDecoder(codecs: MediaCodecList, mime: String?): String? = codecs.codecInfos.firstOrNull { info ->
            !info.isEncoder && ".inproc." in info.name && info.supportedTypes.any { it.equals(mime, ignoreCase = true) }
        }?.name

        /** Once the header and seek map are in, jump straight to the window instead of decoding up to it. */
        fun seekRequest(): androidx.media3.extractor.SeekPoint? {
            val map = seekMap ?: return null
            if (seeked || decoder == null) return null
            seeked = true
            return if (startUs > 0 && map.isSeekable) map.getSeekPoints(startUs).first else null
        }

        private inner class SampleTrack(private val index: Int) : androidx.media3.extractor.TrackOutput {
            private var buffer = ByteArray(16 * 1024)
            private var length = 0

            override fun format(format: androidx.media3.common.Format) {
                formats[index] = format
            }

            private fun ensure(extra: Int) {
                if (length + extra > buffer.size) buffer = buffer.copyOf(maxOf(buffer.size * 2, length + extra))
            }

            override fun sampleData(input: androidx.media3.common.DataReader, length: Int, allowEndOfInput: Boolean, sampleDataPart: Int): Int {
                ensure(length)
                val read = input.read(buffer, this.length, length)
                if (read == androidx.media3.common.C.RESULT_END_OF_INPUT) {
                    if (allowEndOfInput) return androidx.media3.common.C.RESULT_END_OF_INPUT
                    throw java.io.EOFException()
                }
                this.length += read
                return read
            }

            override fun sampleData(data: androidx.media3.common.util.ParsableByteArray, length: Int, sampleDataPart: Int) {
                ensure(length)
                data.readBytes(buffer, this.length, length)
                this.length += length
            }

            override fun sampleMetadata(timeUs: Long, flags: Int, size: Int, offset: Int, cryptoData: androidx.media3.extractor.TrackOutput.CryptoData?) {
                val end = length - offset
                val start = end - size
                if (index == chosen && start >= 0 && !window.done) decoder?.let { fed = true; it.feed(buffer, start, size, timeUs) }
                System.arraycopy(buffer, end, buffer, 0, length - end)
                length -= end
            }
        }
    }

    private class MediaCodecPcm(format: MediaFormat, name: String, private val window: PcmSink) : PcmDecoder {
        private val codec = MediaCodec.createByCodecName(name).also {
            // Released on failure: otherwise a hardware codec slot stays held until GC.
            try {
                disableDrc(format)
                it.configure(format, null, null, 0)
                it.start()
            } catch (e: Exception) {
                it.release()
                throw e
            }
        }
        private val info = MediaCodec.BufferInfo()
        private var rate = format.getIntegerOr(MediaFormat.KEY_SAMPLE_RATE, 44100)
        private var channels = format.getIntegerOr(MediaFormat.KEY_CHANNEL_COUNT, 2)
        private var encoding = AudioFormat.ENCODING_PCM_16BIT
        private var ended = false

        override fun feed(data: ByteArray, offset: Int, size: Int, timeUs: Long) {
            queue(timeUs) { it.put(data, offset, size); size }
        }

        private fun queue(timeUs: Long, flags: Int = 0, write: (java.nio.ByteBuffer) -> Int) {
            repeat(400) {
                val index = codec.dequeueInputBuffer(10_000)
                if (index >= 0) {
                    val size = write(codec.getInputBuffer(index)!!)
                    codec.queueInputBuffer(index, 0, size, timeUs, flags)
                    drain(0)
                    return
                }
                drain(0)
            }
        }

        /** Pull every ready output; with a timeout, wait for more until end of stream. */
        private fun drain(timeoutUs: Long) {
            var idle = 0
            while (!ended) {
                val index = codec.dequeueOutputBuffer(info, timeoutUs)
                when {
                    index >= 0 -> {
                        idle = 0
                        val out = codec.getOutputBuffer(index)
                        if (out != null && info.size > 0) {
                            out.position(info.offset)
                            out.limit(info.offset + info.size)
                            window.add(info.presentationTimeUs, out.slice(), channels, rate, encoding == AudioFormat.ENCODING_PCM_FLOAT)
                        }
                        codec.releaseOutputBuffer(index, false)
                        if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) ended = true
                    }
                    index == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED -> {
                        val f = codec.outputFormat
                        rate = f.getIntegerOr(MediaFormat.KEY_SAMPLE_RATE, rate)
                        channels = f.getIntegerOr(MediaFormat.KEY_CHANNEL_COUNT, channels)
                        encoding = f.getIntegerOr(MediaFormat.KEY_PCM_ENCODING, encoding)
                    }
                    timeoutUs == 0L -> return
                    ++idle > 100 -> return
                }
            }
        }

        override fun finish() {
            queue(0L, MediaCodec.BUFFER_FLAG_END_OF_STREAM) { 0 }
            drain(10_000)
        }

        override fun release() {
            try { codec.stop() } catch (_: Exception) {}
            try { codec.release() } catch (_: Exception) {}
        }
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private class FfmpegPcm(format: androidx.media3.common.Format, private val window: PcmSink) : PcmDecoder {
        private val decoder = androidx.media3.decoder.ffmpeg.FfmpegAudioDecoder(
            format, 16, 16, format.maxInputSize.takeIf { it > 0 } ?: (64 * 1024), /* outputFloat = */ false
        )
        private var ended = false

        override fun feed(data: ByteArray, offset: Int, size: Int, timeUs: Long) {
            val input = obtainInput() ?: return
            input.ensureSpaceForWrite(size)
            input.data!!.put(data, offset, size)
            input.timeUs = timeUs
            input.flip()
            decoder.queueInputBuffer(input)
            drain()
        }

        private fun obtainInput(): androidx.media3.decoder.DecoderInputBuffer? {
            repeat(400) {
                decoder.dequeueInputBuffer()?.let { return it }
                drain()
                Thread.sleep(2)
            }
            return null
        }

        private fun drain() {
            while (!ended) {
                val out = decoder.dequeueOutputBuffer() ?: return
                if (out.isEndOfStream) {
                    ended = true
                } else {
                    out.data?.let { window.add(out.timeUs, it, decoder.channelCount, decoder.sampleRate, false) }
                }
                out.release()
            }
        }

        override fun finish() {
            val input = obtainInput() ?: return
            input.addFlag(androidx.media3.common.C.BUFFER_FLAG_END_OF_STREAM)
            decoder.queueInputBuffer(input)
            repeat(400) {
                drain()
                if (ended) return
                Thread.sleep(5)
            }
        }

        override fun release() = decoder.release()
    }
}

private fun MediaFormat.getIntegerOr(key: String, fallback: Int) =
    if (containsKey(key)) getInteger(key) else fallback
