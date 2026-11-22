package com.glide.app.player

import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaCodecList
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.module.annotations.ReactModule
import com.glide.app.haptic.HapticListener
import com.glide.app.haptic.HapticPerformer
import com.glide.app.haptic.HapticRecognizer
import com.glide.app.haptic.HapticSounds
import com.glide.app.haptic.HapticTrack
import java.io.DataInputStream
import java.io.File
import java.nio.ByteOrder
import java.util.Locale

/**
 * JS bridge for [SubtitleAligner].
 *
 * Provides native PCM audio decoding directly from video files via [MediaExtractor] and [MediaCodec],
 * eliminating the need for heavy external extraction tools like FFmpeg.
 */
@ReactModule(name = SubtitleSyncModule.NAME)
class SubtitleSyncModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    companion object {
        const val NAME = "SubtitleSyncModule"
        private const val CLIP_CACHE_VERSION = 1
        /** The 4-clip peak z that ends a run early; see [align]. */
        private const val EARLY_STOP_Z = 13.0
        private const val CLIP_CACHE_FILES = 300

        /** YAMNet's Speech score among a sound window's [HapticSounds.KEPT] scores. */
        private val SPEECH = HapticSounds.KEPT.indexOf(HapticSounds.SPEECH)

        /**
         * No AAC dynamic range control: it narrows the gap between dialogue and the quiet around
         * it, which is what alignment measures. Zero boost and cut remove its gain in any mode.
         */
        fun disableDrc(format: MediaFormat) {
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
                    android.util.Log.w(NAME, "skipping reader failed, reading the whole file: $e")
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
    }

    /** Where [decodeAudio] puts decoded PCM. */
    internal interface PcmSink {
        /** Stop decoding. */
        val done: Boolean

        /** [data] holds interleaved PCM from its position to its limit, starting at [ptsUs]. */
        fun add(ptsUs: Long, data: java.nio.ByteBuffer, channels: Int, rate: Int, isFloat: Boolean)
    }

    override fun getName() = NAME

    /** Speech-band loudness of the window ([SubtitleAligner.FRAME_S] apart) and where it starts. */
    private data class DecodedLevels(
        val levels: FloatArray,
        val actualStartS: Double
    )

    /**
     * Turns decoded PCM into speech-band loudness for the window [startUs, endUs), at the
     * source sample rate, using the dialogue (centre) channel of 5.1/7.1 and the average of
     * the channels otherwise. Holds no PCM. Shared by both decoders below.
     */
    private class WindowMeter(private val startUs: Long, private val endUs: Long) : PcmSink {
        private var meter: SubtitleAligner.SpeechMeter? = null
        private var meterRate = 0
        var actualStartUs: Long? = null
            private set
        /** The window is covered, or the stream changed rate; stop decoding. */
        override var done = false
            private set

        override fun add(ptsUs: Long, data: java.nio.ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
            if (done || channels <= 0 || rate <= 0) return
            data.order(ByteOrder.LITTLE_ENDIAN)
            val frames = data.remaining() / (channels * if (isFloat) 4 else 2)
            val durUs = frames * 1_000_000L / rate
            if (ptsUs >= endUs) { done = true; return }
            if (ptsUs + durUs <= startUs) return
            val first = if (ptsUs < startUs) ((startUs - ptsUs) * rate / 1_000_000L).toInt().coerceIn(0, frames) else 0
            val last = if (ptsUs + durUs > endUs) ((endUs - ptsUs) * rate / 1_000_000L).toInt().coerceIn(first, frames) else frames
            if (last <= first) return

            // A meter is built for one rate; a later change would mis-time it, so it ends the window.
            val m = meter ?: SubtitleAligner.SpeechMeter(rate).also { meter = it; meterRate = rate }
            if (rate != meterRate) { done = true; return }
            if (actualStartUs == null) actualStartUs = ptsUs + first * 1_000_000L / rate

            val centre = channels == 6 || channels == 8
            if (isFloat) {
                val buf = data.asFloatBuffer()
                for (f in first until last) {
                    val base = f * channels
                    val s = if (centre) buf.get(base + 2).toDouble() else {
                        var sum = 0.0
                        for (c in 0 until channels) sum += buf.get(base + c)
                        sum / channels
                    }
                    m.add(s.coerceIn(-1.0, 1.0))
                }
            } else {
                val buf = data.asShortBuffer()
                for (f in first until last) {
                    val base = f * channels
                    val s = if (centre) buf.get(base + 2) / 32768.0 else {
                        var sum = 0.0
                        for (c in 0 until channels) sum += buf.get(base + c)
                        sum / channels / 32768.0
                    }
                    m.add(s)
                }
            }
            if (last < frames || ptsUs + durUs >= endUs) done = true
        }

        fun result(fallbackStartS: Double): DecodedLevels? {
            val levels = meter?.levels()?.takeIf { it.isNotEmpty() } ?: return null
            return DecodedLevels(levels, (actualStartUs?.let { it / 1_000_000.0 }) ?: fallbackStartS)
        }
    }

    /**
     * One clip of [clipS] from [startS]: its speech-band loudness, and YAMNet's Speech score
     * from the same decode pass (or from [cachedSpeech], the haptics track's, when it covers
     * the clip). The file is read with Media3's extractors -- the player's own, which see every
     * track it can play; Android's MediaExtractor hides DTS and TrueHD inside MKV -- and the
     * first audio track a decoder exists for is used: a platform decoder, else the Media3 FFmpeg
     * extension the player already ships, for the AC-3, E-AC-3, DTS and TrueHD soundtracks
     * most phones cannot decode and that are often a film's only audio.
     */
    /**
     * The container ids (Media3 Format.id) of [videoPath]'s audio tracks, in the file's order, as
     * [decodeAudio] numbers them. Reads only the header.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun audioTrackIds(videoPath: String): List<String?> {
        val ids = ArrayList<String?>()
        var ended = false
        val output = object : androidx.media3.extractor.ExtractorOutput {
            override fun track(id: Int, type: Int): androidx.media3.extractor.TrackOutput {
                if (type != androidx.media3.common.C.TRACK_TYPE_AUDIO) return androidx.media3.extractor.DiscardingTrackOutput()
                val index = ids.size
                ids.add(null)
                return object : androidx.media3.extractor.TrackOutput by androidx.media3.extractor.DiscardingTrackOutput() {
                    override fun format(format: androidx.media3.common.Format) { ids[index] = format.id }
                }
            }
            override fun endTracks() { ended = true }
            override fun seekMap(seekMap: androidx.media3.extractor.SeekMap) {}
        }
        EmbeddedSubtitles.read(reactApplicationContext, EmbeddedSubtitles.toUri(videoPath), output) { ended && ids.none { it == null } }
        return ids
    }

    /** The last clip's decoder and time, for the run's log line. */
    @Volatile private var lastDecode = ""

    private fun decodeClip(
        videoPath: String, startS: Double, clipS: Double, trackIndex: Int, cachedSpeech: FloatArray?, preferFfmpeg: Boolean,
    ): SubtitleAligner.Clip? {
        val cache = clipCacheFile(videoPath, trackIndex, startS, clipS)
        readClip(cache)?.let { lastDecode = "cached"; return it }
        val startUs = (startS * 1_000_000).toLong().coerceAtLeast(0L)
        val endUs = startUs + (clipS * 1_000_000).toLong()
        val meter = WindowMeter(startUs, endUs)
        val yamnet = if (cachedSpeech == null) HapticRecognizer.open(reactApplicationContext) else null
        try {
            val recognizer = yamnet?.let { HapticRecognizer(it.first) }
            // A sound window either side, so the clip's first and last frames lie between two centres.
            val marginUs = if (recognizer != null) 1_500_000L else 0L
            val sink = object : PcmSink {
                override var done = false
                override fun add(ptsUs: Long, data: java.nio.ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
                    if (ptsUs >= endUs + marginUs) done = true
                    if (done || channels <= 0 || rate <= 0) return
                    // Both read the buffer by index and leave its position alone.
                    meter.add(ptsUs, data, channels, rate, isFloat)
                    recognizer?.add(ptsUs, data, channels, rate, isFloat)
                    if (recognizer == null && meter.done) done = true
                }
            }
            val t0 = android.os.SystemClock.elapsedRealtime()
            val using = decodeAudio(reactApplicationContext, videoPath, sink, (startUs - marginUs).coerceAtLeast(0L), trackIndex, preferFfmpeg)
            lastDecode = "$using took=${android.os.SystemClock.elapsedRealtime() - t0}ms"
            val levels = meter.result(startS) ?: return null
            val scores = cachedSpeech ?: recognizer?.let { r -> FloatArray(r.windows.size) { r.windows[it][SPEECH] } }
            val speech = scores?.let { SubtitleAligner.scoreFrames(it, levels.actualStartS, levels.levels.size) }
            // Without Speech scores (YAMNet unavailable) it is not what a later run would make.
            return SubtitleAligner.Clip(levels.actualStartS, levels.levels, speech).also { if (speech != null) writeClip(cache, it) }
        } finally {
            yamnet?.second?.close()
        }
    }

    /**
     * Where a clip's analysis is kept: per file (path, size, mtime), audio track, start and
     * length, so syncing the same film again decodes nothing it has already heard. In
     * cacheDir, which Android clears when storage runs low; [writeClip] keeps it under
     * [CLIP_CACHE_FILES] files (~50 KB each) anyway. Bump [CLIP_CACHE_VERSION] whenever the
     * loudness meter or YAMNet scoring changes.
     */
    private fun clipCacheFile(videoPath: String, trackIndex: Int, startS: Double, clipS: Double): File {
        val fp = HapticPerformer.fingerprint(reactApplicationContext, videoPath)
        val key = java.security.MessageDigest.getInstance("SHA-1")
            .digest("$CLIP_CACHE_VERSION|${fp.path}|${fp.size}|${fp.mtimeMs}|$trackIndex|$startS|$clipS".toByteArray())
            .joinToString("") { "%02x".format(it) }
        return File(File(reactApplicationContext.cacheDir, "autosync"), key)
    }

    private fun readClip(file: File): SubtitleAligner.Clip? = runCatching {
        DataInputStream(file.inputStream().buffered()).use { input ->
            fun floats() = FloatArray(input.readInt()) { input.readFloat() }
            SubtitleAligner.Clip(input.readDouble(), floats(), floats())
        }
    }.getOrNull()

    private fun writeClip(file: File, clip: SubtitleAligner.Clip) {
        runCatching {
            val dir = file.parentFile!!.apply { mkdirs() }
            dir.listFiles()?.sortedBy { it.lastModified() }?.dropLast(CLIP_CACHE_FILES - 1)?.forEach { it.delete() }
            val tmp = File(dir, "${file.name}.tmp")
            java.io.DataOutputStream(tmp.outputStream().buffered()).use { out ->
                out.writeDouble(clip.startS)
                for (a in listOf(clip.energy, clip.speech!!)) { out.writeInt(a.size); a.forEach(out::writeFloat) }
            }
            tmp.renameTo(file)
        }
    }

    /**
     * The Speech score of every sound window in the haptics track cached for this file, when it
     * is the current analyser's; null otherwise. It is the first decodable audio track's, so
     * another track never reads from it. [coveredBy] says whether it heard a given clip.
     */
    private fun cachedSpeech(videoPath: String, trackIndex: Int): HapticTrack? {
        if (trackIndex > 0) return null
        val context = reactApplicationContext
        return runCatching {
            val file = HapticPerformer.cacheFile(context, HapticPerformer.fingerprint(context, videoPath))
            DataInputStream(file.inputStream().buffered()).use { HapticTrack.read(it) }
        }.getOrNull()?.takeIf { it.analyzerVersion == HapticListener.VERSION }
    }

    /**
     * Whether [track] heard [startS, startS + durationS) (or up to the film's end). HapticAnalysis
     * caches a track only once the whole film is heard, but its sounds lane is zeros where YAMNet
     * did not run, so a clip with many all-zero rows counts as not heard.
     */
    private fun coveredBy(track: HapticTrack, startS: Double, durationS: Double): Boolean {
        val hopS = HapticSounds.HOP_MS / 1000.0
        val endS = minOf(startS + durationS, track.bedIntensity.size * HapticTrack.BED_FRAME_MS / 1000.0)
        val rows = Math.ceil(startS / hopS).toInt()..Math.floor((endS - HapticSounds.WINDOW_MS / 1000.0) / hopS).toInt()
        if (rows.isEmpty() || rows.first < 0 || rows.last >= track.sounds.size) return false
        // ponytail: a fixed 10% share; a genuinely silent stretch only costs a fresh YAMNet pass.
        return rows.count { k -> track.sounds[k].all { it == 0f } } * 10 <= rows.count()
    }

    /** PCM out of compressed audio samples, into a [WindowMeter]. */
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
                        android.util.Log.w(NAME, "decoder $it refused ${format.sampleMimeType}: ${e.message}")
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


    /**
     * Aligns the speech cues ([starts]/[ends], subtitle seconds) against [clipS]-second clips of
     * the audio from each of [clipStarts], decoded in parallel, for a viewer at [positionS]
     * ([SubtitleAligner.align]). Resolves the delay and ratio to apply, or null when unsure.
     */
    @ReactMethod
    fun alignVideo(
        videoPath: String, clipStarts: ReadableArray, clipS: Double, starts: ReadableArray, ends: ReadableArray,
        audioFormatId: String?, positionS: Double, promise: Promise,
    ) {
        BackgroundWork.submitLong(promise) {
            try {
                val result = align(
                    videoPath, List(clipStarts.size()) { clipStarts.getDouble(it) }, clipS,
                    DoubleArray(starts.size()) { starts.getDouble(it) }, DoubleArray(ends.size()) { ends.getDouble(it) },
                    audioFormatId, positionS,
                )
                if (result == null) return@submitLong promise.resolve(null)
                promise.resolve(Arguments.createMap().apply {
                    putDouble("delayMs", result.delayS * 1000)
                    putDouble("ratio", result.ratio)
                    putDouble("peakZ", result.peakZ)
                    putDouble("runnerUp", result.runnerUp)
                })
            } catch (_: NoAudio) {
                promise.reject("E_NO_AUDIO", "No decodable audio in this video")
            } catch (t: Throwable) {
                promise.reject("E_ALIGN", t.message ?: "Alignment error", t)
            }
        }
    }

    class NoAudio : Exception()

    /** [alignVideo]'s work, also run by the debug AutoSyncBenchActivity. Logs one "auto-sync:" line. */
    internal fun align(
        videoPath: String, at: List<Double>, clipS: Double, s: DoubleArray, e: DoubleArray,
        audioFormatId: String?, positionS: Double, poolSize: Int = 4, preferFfmpeg: Boolean = false,
        earlyZ: Double = EARLY_STOP_Z,
    ): SubtitleAligner.Result? {
        val t0 = android.os.SystemClock.elapsedRealtime()
        // The heard track, by its container id: the player's track list is in renderer order.
        val audioTrackIndex = audioFormatId?.let { audioTrackIds(videoPath).indexOf(it) } ?: -1
        val track = cachedSpeech(videoPath, audioTrackIndex)
        val speech = track?.let { t -> FloatArray(t.sounds.size) { t.sounds[it][SPEECH] } }
        // ponytail: 4 decoders at background priority, each with its own extractor, decoder and
        // YAMNet; 8 measured no faster on the phone, and 4 leaves cores for playback.
        val pool = BackgroundWork.lane(minOf(poolSize, at.size).coerceAtLeast(1), "glide-sync-decode")
        // One clip that fails to decode is skipped; the rest still align.
        fun decode(starts: List<Double>) = starts.map { start ->
            val cached = track?.takeIf { coveredBy(it, start, clipS) }?.let { speech }
            pool.submit<SubtitleAligner.Clip?> { decodeClip(videoPath, start, clipS, audioTrackIndex, cached, preferFfmpeg) }
        }.mapNotNull { f ->
            runCatching { f.get() }.onFailure { android.util.Log.w(NAME, "auto-sync: clip skipped: ${it.cause ?: it}") }.getOrNull()
        }
        // Every other clip first, spread across the film. When those already agree this
        // strongly, the rest have never changed the answer (scripts/subsync-bench.py: identical
        // results for any threshold from 12 up; 10 got mid-film edits wrong), so they are skipped.
        val first = at.filterIndexed { i, _ -> i % 2 == 0 }
        var clips: List<SubtitleAligner.Clip>
        var result: SubtitleAligner.Result?
        try {
            clips = decode(first)
            result = if (first.size < at.size && clips.size >= 2) SubtitleAligner.align(clips, s, e, positionS) else null
            if (result == null || result.peakZ < earlyZ) {
                clips = (clips + decode(at - first.toSet())).sortedBy { it.startS }
                result = null
            }
        } finally {
            pool.shutdownNow()
        }
        val decodedMs = android.os.SystemClock.elapsedRealtime() - t0
        if (clips.isEmpty()) throw NoAudio()

        if (result == null) result = SubtitleAligner.align(clips, s, e, positionS)
        // Warn, not info: release builds strip Log.i, and this one line per run is how a
        // device's timing and answer are checked.
        android.util.Log.w(
            NAME, "auto-sync: clips=${clips.size}/${at.size} at=${clips.map { it.startS.toInt() }} " +
                "speech=${clips.count { it.speech != null }} cached=${track != null} cues=${s.size} " +
                "position=${positionS.toInt()}s track=$audioFormatId->$audioTrackIndex decoded=${decodedMs}ms " +
                "total=${android.os.SystemClock.elapsedRealtime() - t0}ms $result last clip: $lastDecode"
        )
        return result
    }

    /** The subtitle inside a downloaded SubDL zip, as text; null when it holds none. See [SubtitleZip]. */
    @ReactMethod
    fun readSubtitleFromZip(zipPath: String, promise: Promise) {
        BackgroundWork.submit(promise) {
            promise.resolve(SubtitleZip.read(File(zipPath)))
        }
    }

    @ReactMethod
    fun getVideoMetadata(videoPath: String, promise: Promise) {
        BackgroundWork.submit(promise) {
            val context = reactApplicationContext
            val uri = Uri.parse(videoPath)
            var pfd: ParcelFileDescriptor? = null
            val extractor = MediaExtractor()
            try {
                if (videoPath.startsWith("content://")) {
                    pfd = context.contentResolver.openFileDescriptor(uri, "r")
                    if (pfd != null) {
                        extractor.setDataSource(pfd.fileDescriptor)
                    } else {
                        extractor.setDataSource(context, uri, null)
                    }
                } else {
                    val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                    extractor.setDataSource(cleanPath)
                }

                var videoInfo: String? = null
                var audioInfo: String? = null
                var bitrate: String? = null
                val subtitleTracks = Arguments.createArray()

                var retriever: MediaMetadataRetriever? = null
                try {
                    retriever = MediaMetadataRetriever()
                    if (pfd != null) {
                        retriever.setDataSource(pfd.fileDescriptor)
                    } else if (videoPath.startsWith("content://")) {
                        retriever.setDataSource(context, uri)
                    } else {
                        val cleanPath = if (videoPath.startsWith("file://")) uri.path ?: videoPath.removePrefix("file://") else videoPath
                        retriever.setDataSource(cleanPath)
                    }
                    val bVal = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toLongOrNull()
                    if (bVal != null && bVal > 0) {
                        bitrate = if (bVal > 1_000_000) String.format(Locale.US, "%.1f Mbps", bVal / 1_000_000.0)
                                  else String.format(Locale.US, "%d Kbps", bVal / 1000)
                    }
                } catch (_: Exception) {} finally {
                    try { retriever?.release() } catch (_: Exception) {}
                }

                for (i in 0 until extractor.trackCount) {
                    val format = extractor.getTrackFormat(i)
                    val mime = format.getString(MediaFormat.KEY_MIME) ?: ""
                    if (mime.startsWith("video/") && videoInfo == null) {
                        val codecName = mime.substringAfter("video/").replace("x-vnd.on2.", "").replace("avc", "H264").replace("hevc", "HEVC").uppercase(Locale.US)
                        // Extractors store the rate as an int or a float (23.976); getInteger on
                        // a float throws, which lost the whole metadata result.
                        val fps = if (format.containsKey(MediaFormat.KEY_FRAME_RATE)) {
                            val rate = try {
                                format.getInteger(MediaFormat.KEY_FRAME_RATE).toString()
                            } catch (_: ClassCastException) {
                                format.getFloat(MediaFormat.KEY_FRAME_RATE).let {
                                    if (it % 1f == 0f) it.toInt().toString() else String.format(Locale.US, "%.2f", it)
                                }
                            }
                            "$rate fps"
                        } else null
                        videoInfo = listOfNotNull(codecName, fps).joinToString(" · ")
                    } else if (mime.startsWith("audio/") && audioInfo == null) {
                        val codecName = mime.substringAfter("audio/").replace("mp4a-latm", "AAC").uppercase(Locale.US)
                        val rate = if (format.containsKey(MediaFormat.KEY_SAMPLE_RATE)) "${format.getInteger(MediaFormat.KEY_SAMPLE_RATE) / 1000} kHz" else null
                        audioInfo = listOfNotNull(codecName, rate).joinToString(" · ")
                    } else if (mime.startsWith("text/") || mime.startsWith("application/") || mime.contains("sub") || mime.contains("pgs") || mime.contains("tx3g")) {
                        val lang = (if (format.containsKey(MediaFormat.KEY_LANGUAGE)) format.getString(MediaFormat.KEY_LANGUAGE) else "UND")?.uppercase(Locale.US) ?: "UND"
                        val codec = when {
                            mime.contains("subrip") || mime.contains("srt") -> "SRT"
                            mime.contains("pgs") -> "PGS"
                            mime.contains("ssa") || mime.contains("ass") -> "SSA"
                            mime.contains("vtt") -> "VTT"
                            mime.contains("tx3g") || mime.contains("quicktime") -> "MOV"
                            else -> mime.substringAfterLast("/").uppercase(Locale.US)
                        }
                        subtitleTracks.pushMap(Arguments.createMap().apply {
                            putString("lang", lang)
                            putString("codec", codec)
                            putInt("index", i)
                        })
                    }
                }

                promise.resolve(Arguments.createMap().apply {
                    putString("video", videoInfo)
                    putString("audio", audioInfo)
                    putString("bitrate", bitrate)
                    putArray("subtitles", subtitleTracks)
                })
            } catch (e: Exception) {
                promise.resolve(null)
            } finally {
                extractor.release()
                try { pfd?.close() } catch (_: Exception) {}
            }
        }
    }

    /**
     * Embedded subtitle tracks, in the player's own ordinal order (same Media3 extractor), with
     * the container's default and forced flags. Reads only the file header.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    @ReactMethod
    fun getSubtitleTracks(videoPath: String, promise: Promise) {
        BackgroundWork.submit(promise) {
            try {
                val uri = EmbeddedSubtitles.toUri(videoPath)
                val tracks = Arguments.createArray()
                if (!EmbeddedSubtitles.isNetwork(uri)) {
                    for (t in EmbeddedSubtitles.listTracks(reactApplicationContext, uri)) {
                        val lang = t.language
                        tracks.pushMap(Arguments.createMap().apply {
                            putInt("index", t.ordinal)
                            putString("codec", t.codec)
                            putString("language", lang)
                            putString("title", t.label ?: if (lang != "und") lang else "Subtitle ${t.ordinal + 1}")
                            putBoolean("isDefault", t.isDefault)
                            putBoolean("isForced", t.isForced)
                            putBoolean("isBitmap", t.isBitmap)
                        })
                    }
                }
                promise.resolve(tracks)
            } catch (t: Throwable) {
                promise.resolve(Arguments.createArray())
            }
        }
    }

    /**
     * Writes embedded text subtitle track [ordinal] to an SRT file in the cache and resolves
     * its path, or null when the track has no text cues (bitmap, unsupported, empty) or the
     * video is a network stream (this reads the whole file). Replaces ffmpeg-kit's extraction;
     * the file name matches what SubtitleExtractor.cleanupSubtitleFiles sweeps.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    @ReactMethod
    fun extractSubtitle(videoPath: String, ordinal: Int, promise: Promise) {
        BackgroundWork.submitLong(promise) {
            try {
                val t0 = android.os.SystemClock.elapsedRealtime()
                val uri = EmbeddedSubtitles.toUri(videoPath)
                val srt = if (EmbeddedSubtitles.isNetwork(uri)) null
                    else EmbeddedSubtitles.extractSrt(reactApplicationContext, uri, ordinal)
                // Warn, not info: release builds strip Log.i, and this is how a device's time is checked.
                android.util.Log.w(NAME, "extract-subtitle: track=$ordinal chars=${srt?.length} took=${android.os.SystemClock.elapsedRealtime() - t0}ms")
                if (srt == null) {
                    promise.resolve(null)
                    return@submitLong
                }
                val file = File(reactApplicationContext.cacheDir, "subtitle_${System.nanoTime()}.srt")
                file.writeText(srt)
                promise.resolve(file.absolutePath)
            } catch (t: Throwable) {
                promise.reject("E_EXTRACT_SUBTITLE", t.message ?: "Subtitle extraction failed", t)
            }
        }
    }

}

private fun MediaFormat.getIntegerOr(key: String, fallback: Int) =
    if (containsKey(key)) getInteger(key) else fallback
