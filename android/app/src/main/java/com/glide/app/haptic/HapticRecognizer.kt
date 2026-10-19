package com.glide.app.haptic

import android.content.Context
import java.io.FileInputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.channels.FileChannel
import org.tensorflow.lite.Interpreter

/**
 * Hears what a film's sounds are (docs/haptics-decisions.md, Sound recognition): the decoded audio,
 * mixed to mono as the [HapticListener] hears it and resampled to 16 kHz, through YAMNet
 * (`assets/yamnet.tflite`), one 0.975 s window every [HapticSounds.HOP_MS]. Each window's
 * [HapticSounds] group scores land in [windows], the track's sounds lane.
 *
 * Changing [HapticSounds.Group] changes what the cache holds: bump [HapticListener.VERSION].
 */
class HapticRecognizer(private val classify: (FloatArray) -> FloatArray) {
    val windows = ArrayList<FloatArray>()

    /** Time spent in [classify], for the analysis log. */
    var classifyMs = 0L
        private set

    private val window = FloatArray(WINDOW)
    private var filled = 0
    private var rate = 0
    private lateinit var aaA: HapticListener.Biquad
    private lateinit var aaB: HapticListener.Biquad
    private var ratio = 0.0
    private var inputs = 0L // input samples seen
    private var nextAt = 0.0 // input-sample time of the next 16 kHz sample
    private var prev = 0.0

    /** Interleaved PCM from its position to its limit, starting at [ptsUs]; as `PcmSink.add`. */
    fun add(ptsUs: Long, data: ByteBuffer, channels: Int, rate: Int, isFloat: Boolean) {
        if (this.rate == 0) start(ptsUs, rate)
        data.order(ByteOrder.LITTLE_ENDIAN)
        val bytes = if (isFloat) 4 else 2
        var p = data.position()
        repeat((data.limit() - p) / (bytes * channels)) {
            var s = 0f
            for (c in 0 until channels) {
                s += if (isFloat) data.getFloat(p) else data.getShort(p) / 32768f
                p += bytes
            }
            sample(s / channels)
        }
    }

    private fun start(ptsUs: Long, rate: Int) {
        this.rate = rate
        ratio = rate.toDouble() / RATE
        // 4th-order Butterworth under the new Nyquist (8 kHz), as the Listener's bed filter.
        aaA = HapticListener.Biquad(rate, ANTI_ALIAS_HZ, 0.5412)
        aaB = HapticListener.Biquad(rate, ANTI_ALIAS_HZ, 1.3066)
        repeat((ptsUs / 1000 / HapticSounds.HOP_MS).toInt().coerceAtLeast(0)) { windows += FloatArray(HapticSounds.Group.entries.size) }
    }

    /** Linear interpolation between filtered input samples. */
    private fun sample(x: Float) {
        val y = aaB.run(aaA.run(x.toDouble()))
        val i = inputs++
        while (nextAt <= i) {
            push((prev + (y - prev) * (nextAt - (i - 1))).toFloat())
            nextAt += ratio
        }
        prev = y
    }

    private fun push(s: Float) {
        window[filled++] = s
        if (filled < WINDOW) return
        val t0 = System.nanoTime()
        windows += HapticSounds.groups(classify(window))
        classifyMs += (System.nanoTime() - t0) / 1_000_000
        window.copyInto(window, 0, HOP, WINDOW)
        filled = WINDOW - HOP
    }

    companion object {
        const val RATE = 16000
        private const val WINDOW = 15600
        private const val HOP = RATE * HapticSounds.HOP_MS / 1000
        private const val ANTI_ALIAS_HZ = 7000.0

        /** YAMNet on the CPU, or null if it can't load: haptics then go on from the sound alone. */
        fun open(context: Context): Pair<HapticRecognizer, Interpreter>? = runCatching {
            val model = context.assets.openFd("yamnet.tflite").use { fd ->
                FileInputStream(fd.fileDescriptor).channel.use { it.map(FileChannel.MapMode.READ_ONLY, fd.startOffset, fd.declaredLength) }
            }
            val interpreter = Interpreter(model, Interpreter.Options().setNumThreads(2))
            val out = Array(1) { FloatArray(HapticSounds.CLASSES) }
            HapticRecognizer { w -> interpreter.run(w, out); out[0] } to interpreter
        }.getOrNull()
    }
}
