package com.glide.app.audio

import android.media.audiofx.Equalizer
import android.util.Log
import com.facebook.react.bridge.ReadableArray
import kotlin.math.abs

/**
 * The equalizer both players share. The UI's bands are fixed (60Hz..16kHz) but
 * `android.media.audiofx.Equalizer` exposes however many the device implements -- five,
 * typically -- so each device band takes the gain of the nearest requested frequency.
 *
 * A system effect on the player's own audio session, so video and music each get their own
 * and neither touches the other's.
 */
object GlideEqualizer {

    private const val TAG = "GlideEqualizer"

    /** Matches src/config/equalizerPresets.ts. Ten gains arrive in this order. */
    private val BAND_HZ = intArrayOf(60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000)

    private const val PRIORITY = 0

    /** Ten band gains in dB, or null when the array is absent or empty (equalizer off). */
    @JvmStatic
    fun toBandLevels(bands: ReadableArray?): FloatArray? =
        bands?.takeIf { it.size() > 0 }?.let { array ->
            FloatArray(array.size()) { array.getDouble(it).toFloat() }
        }

    /**
     * Applies [bands] to [existing], creating the effect if needed. Returns the equalizer to
     * hold on to, or null when there is nothing to apply and the caller should drop its
     * reference -- a released effect must never be reused.
     *
     * Devices legitimately refuse: no equalizer effect, or another app holds it at a higher
     * priority. Losing the equalizer must not take playback down with it, so a failure
     * returns null rather than throwing.
     */
    @JvmStatic
    fun apply(existing: Equalizer?, bands: FloatArray?, audioSessionId: Int): Equalizer? {
        // Flat counts as off. An enabled 0 dB effect sounds the same but still holds the
        // audio session, which keeps offload from engaging while isFlat says it may.
        if (bands == null || isFlat(bands)) {
            existing?.release()
            return null
        }
        if (audioSessionId == 0) return existing

        var eq: Equalizer? = existing
        return try {
            val effect = eq ?: Equalizer(PRIORITY, audioSessionId).also { eq = it }
            val (minLevel, maxLevel) = effect.bandLevelRange.let { it[0] to it[1] }
            for (band in 0 until effect.numberOfBands) {
                val b = band.toShort()
                val centreHz = effect.getCenterFreq(b) / 1000
                val millibels = (nearestGainDb(bands, centreHz) * 100).toInt()
                effect.setBandLevel(b, millibels.coerceIn(minLevel.toInt(), maxLevel.toInt()).toShort())
            }
            effect.enabled = true
            effect
        } catch (e: RuntimeException) {
            // Lost control to another app or an OEM effect, or mediaserver restarted.
            // Release it: returning null drops our last reference to a native effect.
            Log.w(TAG, "equalizer unavailable: ${e.message}")
            try { eq?.release() } catch (_: RuntimeException) {}
            null
        }
    }

    /**
     * Nothing to apply: no equalizer, or every band at 0 dB.
     *
     * Audio offload is decided on this. Offload hands the decode to the DSP, which is the
     * big background-battery win, but it bypasses the audio session the system equalizer
     * attaches to -- so offload is only safe while the equalizer changes nothing.
     */
    @JvmStatic
    fun isFlat(bands: FloatArray?): Boolean = bands == null || bands.all { it == 0f }

    /** Gain of whichever UI band sits closest to this device band's centre frequency. */
    @JvmStatic
    fun nearestGainDb(bands: FloatArray, centreHz: Int): Float {
        if (bands.isEmpty()) return 0f
        val index = (0 until minOf(bands.size, BAND_HZ.size))
            .minByOrNull { abs(BAND_HZ[it] - centreHz) } ?: 0
        return bands[index]
    }
}
