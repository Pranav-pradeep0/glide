package com.glide.app.haptic

/**
 * Turns a [HapticTrack] into vibrator calls. Every new call stops the motor and spins it up again,
 * a 40-80 ms dip (decision L1), so a call covers a whole continuous stretch: it starts at the end
 * of a gap or at a hit and runs until the next gap or hit. Inside it, bed and hits are amplitude
 * steps of one waveform, equal neighbours merged (decision L6).
 */
object HapticRenderer {
    /** Silences shorter than this stay inside one call as amplitude-0 steps. */
    const val MIN_GAP_MS = 100

    /**
     * ponytail: a stretch with no gap or hit for this long is cut anyway, one seam, to re-anchor
     * to the player clock (long waveforms run slow, L6). Lift it once Phase 2 drift is corrected.
     */
    const val MAX_CALL_MS = 30_000

    /** One vibrator call: amplitude steps (media ms, 0..255) from [startMs] of media time. */
    class Call(val startMs: Int, val stepsMs: IntArray, val amplitudes: IntArray) {
        val endMs get() = startMs + stepsMs.sum()
        override fun toString() = "$startMs:" + stepsMs.indices.joinToString(",") { "${stepsMs[it]}x${amplitudes[it]}" }
    }

    /**
     * The next call that plays at or after [fromMs]. If [fromMs] falls inside a stretch (resume,
     * seek), the call starts there. Null when nothing is left.
     */
    fun next(track: HapticTrack, fromMs: Int, cal: HapticCalibration): Call? {
        val level = Level(track)
        val end = track.events.lastOrNull()?.let { it.timeMs + it.lengthMs + it.decayMs }
            .let { maxOf(it ?: 0, track.bedIntensity.size * HapticTrack.BED_FRAME_MS) }
        var start = maxOf(fromMs, 0)
        // Nothing sounds at a silent ms until the next bed frame or the next hit starts.
        while (start < end && level.at(start) <= 0f) {
            start = minOf((start / HapticTrack.BED_FRAME_MS + 1) * HapticTrack.BED_FRAME_MS, level.hitAfter(start))
        }
        if (start >= end) return null

        val nextHit = level.hitAfter(start)
        val stop = minOf(nextHit, start + MAX_CALL_MS, end)
        val amps = ArrayList<Int>()
        var ms = start
        while (ms < stop) {
            val a = cal.amplitude(level.at(ms))
            if (a == 0) {
                var quiet = ms
                while (quiet < stop && quiet - ms < MIN_GAP_MS && level.at(quiet) <= 0f) quiet++
                if (quiet == stop || quiet - ms >= MIN_GAP_MS) break
            }
            amps += a
            ms++
        }
        val steps = ArrayList<Int>()
        val values = ArrayList<Int>()
        for (a in amps) {
            if (values.lastOrNull() == a) steps[steps.size - 1]++ else { steps += 1; values += a }
        }
        return Call(start, steps.toIntArray(), values.toIntArray())
    }

    /** Track intensity at a media ms: the louder of bed and any hit sounding there. */
    private class Level(private val track: HapticTrack) {
        private val longest = track.events.maxOfOrNull { it.lengthMs + it.decayMs } ?: 0

        fun at(ms: Int): Float {
            var v = track.bedAt(ms)
            var i = upperBound(ms) - 1
            while (i >= 0 && track.events[i].timeMs > ms - longest) {
                val e = track.events[i--]
                val into = ms - e.timeMs
                v = maxOf(v, when {
                    into < e.lengthMs -> e.intensity
                    into < e.lengthMs + e.decayMs -> e.intensity * (1f - (into - e.lengthMs + 1).toFloat() / (e.decayMs + 1))
                    else -> 0f
                })
            }
            return v
        }

        /** Time of the first hit after [ms]. */
        fun hitAfter(ms: Int) = track.events.getOrNull(upperBound(ms))?.timeMs ?: Int.MAX_VALUE

        /** Index of the first event after [ms]. */
        private fun upperBound(ms: Int): Int {
            var lo = 0
            var hi = track.events.size
            while (lo < hi) {
                val mid = (lo + hi) ushr 1
                if (track.events[mid].timeMs <= ms) lo = mid + 1 else hi = mid
            }
            return lo
        }
    }
}
