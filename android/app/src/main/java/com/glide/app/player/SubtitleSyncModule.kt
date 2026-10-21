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
        ): String {
            val audio = AudioCollector(sink, startUs, targetTrackIndex)
            try {
                EmbeddedSubtitles.read(
                    context,
                    EmbeddedSubtitles.toUri(videoPath),
                    audio,
                    seekTo = audio::seekRequest,
                ) { sink.done || audio.noDecoder }
                if (!sink.done) audio.decoder?.finish()
            } finally {
                audio.decoder?.release()
            }
            return "tracks=${audio.trackMimes} targetTrack=$targetTrackIndex chosen=${audio.chosen} using=${audio.description}"
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
     * Decodes up to [durationS] of audio from [windowStartS] and measures its speech-band
     * loudness. The file is read with Media3's extractors -- the player's own, which see every
     * track it can play; Android's MediaExtractor hides DTS and TrueHD inside MKV -- and the
     * first audio track a decoder exists for is used: a platform decoder, else the Media3 FFmpeg
     * extension the player already ships, for the AC-3, E-AC-3, DTS and TrueHD soundtracks
     * most phones cannot decode and that are often a film's only audio.
     */
    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun decodeAudioWindow(
        videoPath: String,
        windowStartS: Double,
        durationS: Double = 300.0,
        targetTrackIndex: Int = -1,
    ): DecodedLevels? {
        val startUs = (windowStartS * 1_000_000).toLong().coerceAtLeast(0L)
        val window = WindowMeter(startUs, startUs + (durationS * 1_000_000).toLong())
        val using = decodeAudio(reactApplicationContext, videoPath, window, startUs, targetTrackIndex)
        val result = window.result(windowStartS)
        android.util.Log.i(
            NAME, "auto-sync: $using decoded " +
                "${"%.1f".format(Locale.US, (result?.levels?.size ?: 0) * SubtitleAligner.FRAME_S)} s"
        )
        return result
    }

    /**
     * YAMNet's Speech level for [frames] frames from [startS] ([SubtitleAligner.scoreFrames]):
     * from the haptics cache when it has heard this window, else heard again here (~9 s per
     * 5-min window on a phone, against ~2 s for loudness). Null if YAMNet can't load.
     */
    private fun speechLevels(videoPath: String, startS: Double, frames: Int, trackIndex: Int): FloatArray? {
        val durationS = frames * SubtitleAligner.FRAME_S
        val t0 = android.os.SystemClock.elapsedRealtime()
        val cached = cachedSpeech(videoPath, startS, durationS, trackIndex)
        val scores = cached ?: recognizeSpeech(videoPath, startS, durationS, trackIndex) ?: return null
        android.util.Log.i(
            NAME, "auto-sync: speech from ${if (cached != null) "haptics cache" else "yamnet"} " +
                "window=${startS}s took=${android.os.SystemClock.elapsedRealtime() - t0}ms"
        )
        return SubtitleAligner.scoreFrames(scores, startS, frames)
    }

    /**
     * Speech scores of every sound window from the haptics track cached for this file, when it
     * is the current analyser's and covers [startS, startS + durationS) (or up to the film's end).
     * HapticAnalysis caches a track only once the whole film is heard, but its sounds lane is
     * zeros where YAMNet did not run, so a window with many all-zero rows counts as not covered.
     * It is the first decodable audio track's, so another track never reads from it.
     */
    private fun cachedSpeech(videoPath: String, startS: Double, durationS: Double, trackIndex: Int): FloatArray? {
        if (trackIndex > 0) return null
        val context = reactApplicationContext
        val track = runCatching {
            val file = HapticPerformer.cacheFile(context, HapticPerformer.fingerprint(context, videoPath))
            DataInputStream(file.inputStream().buffered()).use { HapticTrack.read(it) }
        }.getOrNull()?.takeIf { it.analyzerVersion == HapticListener.VERSION } ?: return null
        val hopS = HapticSounds.HOP_MS / 1000.0
        val endS = minOf(startS + durationS, track.bedIntensity.size * HapticTrack.BED_FRAME_MS / 1000.0)
        val rows = Math.ceil(startS / hopS).toInt()..Math.floor((endS - HapticSounds.WINDOW_MS / 1000.0) / hopS).toInt()
        if (rows.isEmpty() || rows.first < 0 || rows.last >= track.sounds.size) return null
        // ponytail: a fixed 10% share; a genuinely silent stretch only costs a fresh YAMNet pass.
        if (rows.count { k -> track.sounds[k].all { it == 0f } } * 10 > rows.count()) return null
        return FloatArray(track.sounds.size) { track.sounds[it][SPEECH] }
    }

    /** The window decoded again through YAMNet, as HapticAnalysis hears it: Speech score per sound window. */
    private fun recognizeSpeech(videoPath: String, startS: Double, durationS: Double, trackIndex: Int): FloatArray? {
        val (classify, interpreter) = HapticRecognizer.open(reactApplicationContext) ?: return null
        try {
            val recognizer = HapticRecognizer(classify)
            // A sound window either side, so the first and last frames lie between two centres.
            val margin = 1.5
            val endUs = ((startS + durationS + margin) * 1_000_000).toLong()
            val sink = object : PcmSink {
                override var done = false
                override fun add(ptsUs: Long, data: java.nio.ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
                    if (ptsUs >= endUs) done = true
                    if (!done && channels > 0 && rate > 0) recognizer.add(ptsUs, data, channels, rate, isFloat)
                }
            }
            decodeAudio(reactApplicationContext, videoPath, sink, ((startS - margin).coerceAtLeast(0.0) * 1_000_000).toLong(), trackIndex)
            return FloatArray(recognizer.windows.size) { recognizer.windows[it][SPEECH] }
        } finally {
            interpreter.close()
        }
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
                val name = try { codecs.findDecoderForFormat(mediaFormat) } catch (_: Exception) { null }
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
                if (index == chosen && start >= 0 && !window.done) decoder?.feed(buffer, start, size, timeUs)
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
     * Aligns the cues against the 300 s of audio from [windowStartS]: speech-band loudness first;
     * where that is unsure (neither confident nor drift), YAMNet's Speech score, right more often
     * on real films but coarser, used only if it is sure. A drift is then checked at window
     * [secondWindowStartS] (negative: none) with the signal that found it
     * ([SubtitleAligner.confirmRatio]): a confirmed ratio comes back confident, else it stays drift.
     */
    @ReactMethod
    fun alignVideo(
        videoPath: String, windowStartS: Double, starts: ReadableArray, ends: ReadableArray,
        audioTrackIndex: Int, secondWindowStartS: Double, promise: Promise,
    ) {
        BackgroundWork.submitLong(promise) {
            try {
                val decoded = decodeAudioWindow(videoPath, windowStartS, 300.0, audioTrackIndex)
                    ?: return@submitLong promise.reject("E_NO_AUDIO", "No decodable audio in this video")

                val s = DoubleArray(starts.size()) { starts.getDouble(it) }
                val e = DoubleArray(ends.size()) { ends.getDouble(it) }

                var result = SubtitleAligner.align(decoded.levels, decoded.actualStartS, s, e)
                var source = "energy"
                var levels = decoded.levels
                android.util.Log.i(NAME, "auto-sync: energy window=${decoded.actualStartS}s cues=${s.size} $result")

                if (result?.confident != true && result?.drift != true) {
                    speechLevels(videoPath, decoded.actualStartS, decoded.levels.size, audioTrackIndex)?.let { speech ->
                        val r = SubtitleAligner.align(speech, decoded.actualStartS, s, e, clampDb = false)
                        val sure = r != null && (r.drift ||
                            (r.confident && SubtitleAligner.halvesConfirm(speech, decoded.actualStartS, s, e, r, clampDb = false)))
                        if (sure) { result = r; source = "speech"; levels = speech }
                        android.util.Log.i(NAME, "auto-sync: speech $r")
                    }
                }

                if (result?.drift == true && secondWindowStartS >= 0) {
                    val second = if (source == "energy") {
                        decodeAudioWindow(videoPath, secondWindowStartS, 300.0, audioTrackIndex)?.let { it.levels to it.actualStartS }
                    } else {
                        speechLevels(videoPath, secondWindowStartS, (300.0 / SubtitleAligner.FRAME_S).toInt(), audioTrackIndex)
                            ?.let { it to secondWindowStartS }
                    }
                    val confirmed = second?.let { (b, startB) ->
                        SubtitleAligner.confirmRatio(levels, decoded.actualStartS, b, startB, s, e, clampDb = source == "energy")
                    }
                    // Its delayS is window A's, secondDelayS window B's.
                    android.util.Log.i(NAME, "auto-sync: ratio check windowB=${second?.second}s $confirmed")
                    if (confirmed != null) result = confirmed
                }

                val chosen = result
                android.util.Log.i(
                    NAME, "auto-sync: source=$source window=${decoded.actualStartS}s cues=${s.size} $chosen " +
                        "confident=${chosen?.confident} drift=${chosen?.drift}"
                )
                if (chosen == null) return@submitLong promise.resolve(null)

                promise.resolve(Arguments.createMap().apply {
                    putDouble("delayMs", chosen.delayS * 1000)
                    putDouble("ratio", chosen.ratio)
                    putDouble("peakZ", chosen.peakZ)
                    putDouble("runnerUp", chosen.runnerUp)
                    putBoolean("confident", chosen.confident)
                    putBoolean("drift", chosen.drift)
                    putString("source", source)
                })
            } catch (t: Throwable) {
                promise.reject("E_ALIGN", t.message ?: "Alignment error", t)
            }
        }
    }

    /**
     * Extract stream and metadata information from [videoPath] using native MediaExtractor and MediaMetadataRetriever.
     */
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
                val uri = EmbeddedSubtitles.toUri(videoPath)
                val srt = if (EmbeddedSubtitles.isNetwork(uri)) null
                    else EmbeddedSubtitles.extractSrt(reactApplicationContext, uri, ordinal)
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
