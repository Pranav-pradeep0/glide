package com.glide.app.haptic

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.media.AudioAttributes
import android.net.Uri
import android.os.Debug
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.os.VibrationEffect
import android.os.Vibrator
import android.util.Log
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultRenderersFactory
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.glide.app.player.AudioDelayProcessor
import com.glide.app.player.BackgroundWork
import com.glide.app.player.SubtitleSyncModule
import java.io.File
import java.nio.ByteBuffer
import java.util.concurrent.locks.LockSupport

/**
 * Haptics Lab: the Phase 0 measurements of docs/haptics-engine-plan.md, run on the phone.
 *
 * Each run plays something (the motor, or a film through a bare player) while recording the
 * accelerometer, and writes every sample and event to a CSV under the app's external files
 * dir. scripts/haptics-lab.js pulls and scores it, and reads what the system really played
 * from `dumpsys vibrator_manager`. Recording here and scoring there keeps the scoring
 * tunable without a rebuild.
 *
 * CSV rows are `elapsedRealtimeNanos,kind,values...`:
 * acc x y z | vib amplitude ms | gap | tap contentUs | pos positionMs | note text.
 */
@UnstableApi
class HapticsLabModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

    override fun getName() = "HapticsLab"

    private val vibrator = context.getSystemService(Vibrator::class.java)

    /** USAGE_MEDIA, so the system's media-vibration setting and history bucket apply. */
    private val media = AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).build()

    /** One run's rows, written out at the end. ponytail: in memory; runs are under a minute. */
    private inner class Run(val name: String) {
        private val rows = StringBuilder()

        init {
            mark("note", "wallclock ${System.currentTimeMillis()}")
        }

        fun mark(kind: String, vararg values: Any) = mark(SystemClock.elapsedRealtimeNanos(), kind, *values)

        fun mark(t: Long, kind: String, vararg values: Any) {
            synchronized(rows) {
                rows.append(t).append(',').append(kind)
                for (v in values) rows.append(',').append(v)
                rows.append('\n')
            }
        }

        fun text() = synchronized(rows) { rows.toString() }

        fun save(): String {
            val dir = File(reactApplicationContext.getExternalFilesDir(null), "haptics-lab").apply { mkdirs() }
            val file = File(dir, "$name-${System.currentTimeMillis()}.csv")
            synchronized(rows) { file.writeText(rows.toString()) }
            Log.w(TAG, "saved ${file.absolutePath}")
            return file.absolutePath
        }
    }

    /** Raw accelerometer at its fastest rate (416 Hz here, above the motor's resonance). */
    private inner class Accel(private val run: Run) : SensorEventListener {
        private val sensors = reactApplicationContext.getSystemService(SensorManager::class.java)
        private val thread = HandlerThread("haptics-lab-accel").apply { start() }

        fun start() {
            val sensor = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
            run.mark("note", "accel ${sensor?.name} minDelayUs=${sensor?.minDelay}")
            sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_FASTEST, Handler(thread.looper))
        }

        fun stop() {
            sensors.unregisterListener(this)
            thread.quitSafely()
        }

        override fun onSensorChanged(e: SensorEvent) = run.mark(e.timestamp, "acc", e.values[0], e.values[1], e.values[2])
        override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
    }

    /** Runs [block] on its own thread with the accelerometer recording, saves, then resolves with [analyse] or the path. */
    private fun record(name: String, promise: Promise, analyse: ((Run) -> String)? = null, block: (Run) -> Unit) {
        Thread({
            val run = Run(name)
            val accel = Accel(run)
            try {
                accel.start()
                sleepUntil(SystemClock.elapsedRealtimeNanos() + 1_000_000_000L) // quiet baseline
                block(run)
                sleepUntil(SystemClock.elapsedRealtimeNanos() + 1_000_000_000L)
            } catch (t: Throwable) {
                run.mark("note", "error ${t.message}")
            } finally {
                accel.stop()
                vibrator.cancel()
            }
            val saved = run.save()
            promise.resolve(analyse?.let { runCatching { it(run) }.getOrElse { e -> "analysis failed: ${e.message}" } } ?: saved)
        }, "haptics-lab").apply { priority = Thread.MAX_PRIORITY }.start()
    }

    /** Sleeps most of the way, then spins: scheduling jitter is part of what L1 measures. */
    private fun sleepUntil(t: Long) {
        while (true) {
            val left = t - SystemClock.elapsedRealtimeNanos()
            if (left <= 0) return
            if (left > 2_000_000) LockSupport.parkNanos(left - 2_000_000)
        }
    }

    /** A constant-amplitude chunk made of 10 ms waveform steps, the shape a renderer sends. */
    private fun play(run: Run, ms: Int, amplitude: Int) {
        val steps = (ms / 10).coerceAtLeast(1)
        val effect = VibrationEffect.createWaveform(LongArray(steps) { 10L }, IntArray(steps) { amplitude }, -1)
        run.mark("vib", amplitude, steps * 10)
        vibrator.vibrate(effect, media)
    }

    /**
     * L1 seams. A 3 s bed at [amplitude] played as one call (control), then sliced into calls
     * of 500, 250 and 100 ms issued exactly back to back, then the same slices each 50 ms
     * long, so every call supersedes the previous one before it runs out.
     */
    @ReactMethod
    fun runSeams(amplitude: Int, promise: Promise) = record("seams", promise) { run ->
        val bedNs = 3_000_000_000L
        fun bed(windowMs: Int, overlapMs: Int) {
            run.mark("note", "bed window=$windowMs overlap=$overlapMs")
            val start = SystemClock.elapsedRealtimeNanos()
            var t = start
            while (t < start + bedNs) {
                sleepUntil(t)
                play(run, windowMs + overlapMs, amplitude)
                t += windowMs * 1_000_000L
            }
            sleepUntil(start + bedNs + windowMs * 1_000_000L) // let the last slice run out
            vibrator.cancel()
            run.mark("gap")
            sleepUntil(SystemClock.elapsedRealtimeNanos() + 1_200_000_000L)
        }
        bed(3000, 0)
        for (overlap in intArrayOf(0, 50)) for (w in intArrayOf(500, 250, 100)) bed(w, overlap)
    }

    /**
     * L5 self-calibration, and the calibration the Performer uses: measured and saved for this
     * phone. 500 ms holds over a range of amplitudes, twice, then single
     * full-strength pulses of rising length (what a "hit" costs to start the motor).
     */
    @ReactMethod
    fun runCalibration(promise: Promise) = record("calibration", promise, { run ->
        val cal = HapticCalibration.measure(run.text())
        HapticPerformer.saveCalibration(reactApplicationContext, cal)
        "saved: floor amp ${cal.floorAmp}, latency ${cal.latencyMs} ms, curve ${cal.encode()}"
    }) { run ->
        val levels = intArrayOf(3, 8, 15, 23, 31, 46, 64, 96, 128, 160, 192, 224, 255)
        repeat(2) {
            for (a in levels) {
                val t = SystemClock.elapsedRealtimeNanos()
                play(run, 500, a)
                sleepUntil(t + 1_000_000_000L)
            }
        }
        for (ms in intArrayOf(5, 10, 20, 30, 50, 80)) {
            val t = SystemClock.elapsedRealtimeNanos()
            run.mark("vib", 255, ms)
            vibrator.vibrate(VibrationEffect.createOneShot(ms.toLong(), 255), media)
            sleepUntil(t + 700_000_000L)
        }
    }

    /**
     * L2 decode speed: the whole audio of [path] through the same extractor and decoders
     * subtitle sync uses, on the same background lane analysis would run on.
     */
    @ReactMethod
    fun runDecode(path: String, promise: Promise) = BackgroundWork.submitLong(promise) {
        val sink = object : SubtitleSyncModule.PcmSink {
            override val done = false
            var mediaUs = 0L
            var format = ""
            var calls = 0
            var peakJava = 0L
            var peakNative = 0L
            var checksum = 0L

            var lastPtsUs = 0L

            override fun add(ptsUs: Long, data: ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
                lastPtsUs = ptsUs
                val frames = data.remaining() / (channels * if (isFloat) 4 else 2)
                mediaUs += frames * 1_000_000L / rate
                format = "${channels}ch ${rate}Hz ${if (isFloat) "float" else "s16"}"
                // Touch the samples, as any analysis would.
                for (i in data.position() until data.limit() step 64) checksum += data.get(i)
                if (++calls % 500 == 0) sampleMemory()
            }

            fun sampleMemory() {
                val rt = Runtime.getRuntime()
                peakJava = maxOf(peakJava, rt.totalMemory() - rt.freeMemory())
                peakNative = maxOf(peakNative, Debug.getNativeHeapAllocatedSize())
            }
        }
        val rt = Runtime.getRuntime()
        System.gc()
        val java0 = rt.totalMemory() - rt.freeMemory()
        val native0 = Debug.getNativeHeapAllocatedSize()
        val wall0 = SystemClock.elapsedRealtimeNanos()
        // Process-wide: FFmpeg decodes on its own thread, not this one.
        val cpu0 = android.os.Process.getElapsedCpuTime()
        // A file the extractor gives up on part way is a result too: how far it got.
        val using = try {
            SubtitleSyncModule.decodeAudio(reactApplicationContext, path, sink)
        } catch (e: Exception) {
            "failed at ${sink.lastPtsUs / 1_000_000} s: $e"
        }
        val cpuS = (android.os.Process.getElapsedCpuTime() - cpu0) / 1e3
        val wallS = (SystemClock.elapsedRealtimeNanos() - wall0) / 1e9
        val mediaS = sink.mediaUs / 1e6
        val result = Arguments.createMap().apply {
            putString("using", using)
            putString("format", sink.format)
            putDouble("mediaS", mediaS)
            putDouble("wallS", wallS)
            putDouble("cpuS", cpuS)
            putDouble("xRealtime", if (wallS > 0) mediaS / wallS else 0.0)
            putDouble("peakJavaMB", (sink.peakJava - java0) / 1048576.0)
            putDouble("peakNativeMB", (sink.peakNative - native0) / 1048576.0)
        }
        // Log.w: release builds strip Log.i. Saved too, so adb can read it after the fact.
        Log.w(TAG, "decode $path $result")
        File(reactApplicationContext.getExternalFilesDir(null), "haptics-lab").apply { mkdirs() }
            .resolve("decode-${System.currentTimeMillis()}.json").writeText(org.json.JSONObject(result.toHashMap()).toString(1))
        promise.resolve(result)
    }

    /**
     * L4: plays [path] from [startMs] for [seconds] through a bare player built like the real
     * one (delay processor in the sink, FFmpeg fallback), with a pass-through tap after the
     * delay that logs the content time of each buffer it passes. (L3, HapticGenerator, was
     * measured here too and dropped: docs/haptics-decisions.md.)
     */
    @ReactMethod
    fun runPlayer(path: String, startMs: Double, seconds: Double, promise: Promise) =
        record("tap", promise) { log ->
            val main = Handler(Looper.getMainLooper())
            var player: ExoPlayer? = null
            main.post {
                val ctx = reactApplicationContext
                val tap = Tap(log)
                val renderers = object : DefaultRenderersFactory(ctx) {
                    override fun buildAudioSink(context: Context, enableFloatOutput: Boolean, enableAudioOutputPlaybackParams: Boolean): AudioSink =
                        DefaultAudioSink.Builder(context)
                            .setEnableFloatOutput(enableFloatOutput)
                            .setAudioProcessors(arrayOf(AudioDelayProcessor(), tap))
                            .build()
                }.setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                val p = ExoPlayer.Builder(ctx, renderers)
                    .setAudioAttributes(
                        androidx.media3.common.AudioAttributes.Builder()
                            .setUsage(C.USAGE_MEDIA)
                            .setContentType(C.AUDIO_CONTENT_TYPE_MOVIE)
                            .build(),
                        false,
                    )
                    .build()
                player = p
                p.trackSelectionParameters = p.trackSelectionParameters.buildUpon()
                    .setTrackTypeDisabled(C.TRACK_TYPE_VIDEO, true).build()
                p.addListener(object : Player.Listener {
                    override fun onIsPlayingChanged(isPlaying: Boolean) = log.mark("note", "playing $isPlaying")
                })
                p.setMediaItem(MediaItem.fromUri(Uri.fromFile(File(path))), startMs.toLong())
                p.prepare()
                p.play()
                val poll = object : Runnable {
                    override fun run() {
                        val q = player ?: return
                        if (q.isPlaying) log.mark("pos", q.currentPosition)
                        main.postDelayed(this, 10)
                    }
                }
                main.post(poll)
            }
            sleepUntil(SystemClock.elapsedRealtimeNanos() + (seconds * 1e9).toLong())
            val done = java.util.concurrent.CountDownLatch(1)
            main.post {
                player?.release()
                player = null
                done.countDown()
            }
            done.await()
        }

    /** Pass-through that logs the content time at the end of each buffer it hands on. */
    private class Tap(private val run: Run) : BaseAudioProcessor() {
        private var offsetUs = 0L
        private var frames = 0L

        override fun onConfigure(inputAudioFormat: AudioProcessor.AudioFormat): AudioProcessor.AudioFormat =
            if (inputAudioFormat.bytesPerFrame <= 0) AudioProcessor.AudioFormat.NOT_SET else inputAudioFormat

        override fun queueInput(inputBuffer: ByteBuffer) {
            val n = inputBuffer.remaining()
            if (n == 0) return
            frames += n / inputAudioFormat.bytesPerFrame
            run.mark("tap", offsetUs + frames * 1_000_000L / inputAudioFormat.sampleRate)
            replaceOutputBuffer(n).put(inputBuffer).flip()
        }

        override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
            offsetUs = streamMetadata.positionOffsetUs
            frames = 0
            run.mark("note", "flush offsetUs=$offsetUs")
        }
    }

    /**
     * Phase 2 exit: caches, for the clip at [mediaPath], the track its truth file describes
     * (`scripts/haptics-fixtures.js`), so the real player plays exactly the intended hits and beds.
     */
    @ReactMethod
    fun importTruth(mediaPath: String, truthPath: String, promise: Promise) = BackgroundWork.submitLong(promise) {
        val rows = File(truthPath).readLines().map { it.trim().split(Regex("\\s+")) }
        val onsets = rows.filter { it[0] == "onset" }.map { it[1].toInt() }
        val beds = rows.filter { it[0] == "bed" }.map { it[1].toInt() until it[2].toInt() }
        val frames = (beds.maxOfOrNull { it.last + 1 } ?: 0) / HapticTrack.BED_FRAME_MS
        val bed = FloatArray(frames) { i -> if (beds.any { i * HapticTrack.BED_FRAME_MS in it }) 0.5f else 0f }
        val track = HapticTrack(
            0, HapticPerformer.fingerprint(reactApplicationContext, mediaPath), bed, FloatArray(frames),
            onsets.sorted().map { HapticTrack.Event(it, 1f, 0.5f, 70, 30, HapticTrack.SOURCE_AUDIO) }
        )
        HapticPerformer.saveTrack(reactApplicationContext, track)
        promise.resolve("${onsets.size} hits, ${beds.size} beds")
    }

    private companion object {
        const val TAG = "HapticsLab"
    }
}
