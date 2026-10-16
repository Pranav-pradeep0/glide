package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import kotlin.math.log10

/**
 * The Director (docs/haptics-engine-plan.md Phase 4): decides what of the Listener's raw track is
 * felt, relative to the film itself. The bed plays only within [BED_RANGE_DB] of the film's loud
 * bass (its 99th percentile), hits only within [HIT_RANGE_DB] of its loud hits (95th); both are
 * rescaled so the film's loud moments are full strength. Real films have faint bass under a
 * quarter of their runtime and quiet hits under dialogue; this keeps the bed to 5-11% of Us and
 * Blast and dialogue to under 1 hit a minute (docs/haptics-decisions.md, Phase 4).
 *
 * Subtitle tags (Phase 5, [HapticMeaning]) add meaning: a hit tag keeps the loudest onset within
 * [SNAP_MS] of its cue, light or below the gate, and gives it the tag's character. Under music the
 * bed is halved and untagged hits dropped. Voice tags change nothing: centre-channel grunts drive
 * the bed for 1-6% of their time, and every rule tried to quiet them cut more of the effect bass
 * under the same tags (docs/haptics-decisions.md, Phase 5). With no tags the result is audio-only.
 *
 * Runs on every published track: the cache holds the raw one, so changing this rebuilds nothing.
 * While a film is still being analysed the levels come from the part heard so far.
 */
object HapticDirector {
    const val BED_RANGE_DB = 10f
    const val HIT_RANGE_DB = 9f
    const val SNAP_MS = 1000
    private const val SMOOTH_FRAMES = 10 // 100 ms
    private const val FOLLOW_DB = 6f // how far under the gate an open bed follows
    private const val HIT_MIN = 0.25f // a hit at the edge of the range is still felt
    private const val MUSIC_BED = 0.5f
    private const val SHARP = 0.8f
    private const val HEAVY = 0.1f
    private const val LIGHT_LEAD_MS = 200 // a light onset well before its cue is the line before

    // The Listener's dB scales: bed 0..1 is -45..0 dB, hit 0..1 is -40..0 dBFS.
    private const val BED_DB = 45f
    private const val HIT_DB = 40f

    fun direct(raw: HapticTrack, tags: List<HapticMeaning.Tag> = emptyList()): HapticTrack {
        if (raw.analyzerVersion == 0) return raw // a fixture's truth, imported by the Lab
        // Levels are judged on power averaged over [SMOOTH_FRAMES]: low tones beat 10-20 times a
        // second, and judged frame by frame their dips would chop a rumble into pieces.
        val v = raw.bedIntensity
        val sum = DoubleArray(v.size + 1) // running power
        for (i in v.indices) sum[i + 1] = sum[i] + if (v[i] > 0f) Math.pow(10.0, (v[i] - 1.0) * BED_DB / 10) else 0.0
        val half = SMOOTH_FRAMES / 2
        val level = FloatArray(v.size) { i ->
            val a = maxOf(0, i - half)
            val b = minOf(v.size, i + half + 1)
            (1 + 10 * log10((sum[b] - sum[a]) / (b - a) + 1e-12) / BED_DB).toFloat()
        }
        val heard = FloatArray(v.count { it > 0f })
        var k = 0
        for (i in v.indices) if (v[i] > 0f) heard[k++] = level[i]
        val bedRef = percentile(heard, 0.99f)
        val bedGate = bedRef - BED_RANGE_DB / BED_DB
        val bedLow = bedGate - FOLLOW_DB / BED_DB
        val bed = FloatArray(v.size) { i ->
            if (v[i] <= 0f || level[i] <= bedGate) 0f else ((v[i] - bedLow) / (bedRef - bedLow)).coerceIn(0f, 1f)
        }
        // Under music the bed is lighter but still there: what a mixer sends to the LFE in a song
        // scene is meant to be heavy. Gating it out lost 15-50% of loud-LFE moments.
        val music = tags.filter { it.kind == Kind.MUSIC }.map { it.startMs until it.endMs }
        for (r in music) for (i in r.first / HapticTrack.BED_FRAME_MS until minOf(bed.size, r.last / HapticTrack.BED_FRAME_MS)) bed[i] *= MUSIC_BED

        val weighty = raw.events.filter { it.sources and HapticTrack.LIGHT == 0 }
        val hitRef = percentile(FloatArray(weighty.size) { weighty[it].intensity }, 0.95f)
        val hitGate = hitRef - HIT_RANGE_DB / HIT_DB
        fun scaled(e: HapticTrack.Event) = e.copy(
            intensity = (HIT_MIN + (1 - HIT_MIN) * (e.intensity - hitGate) / (hitRef - hitGate)).coerceIn(HIT_MIN, 1f),
            sources = e.sources and HapticTrack.LIGHT.inv()
        )
        // Music has no hits of its own: one there is kept only if a tag names it (below).
        val events = weighty.filter { e -> e.intensity >= hitGate && music.none { e.timeMs in it } }.map(::scaled).toMutableList()
        for (t in tags) {
            val sharpness = when (t.kind) { Kind.SHARP -> SHARP; Kind.HEAVY -> HEAVY; else -> continue }
            val near = t.startMs - SNAP_MS..t.startMs + SNAP_MS
            val felt = events.indices.filter { events[it].timeMs in near }.maxByOrNull { events[it].intensity }
            val e = felt?.let { events.removeAt(it) }
                ?: raw.events.filter { it.timeMs in near && (it.sources and HapticTrack.LIGHT == 0 || it.timeMs >= t.startMs - LIGHT_LEAD_MS) }
                    .maxByOrNull { it.intensity }?.let(::scaled)
                ?: continue
            events += e.copy(
                sharpness = sharpness,
                lengthMs = HapticListener.lengthMs(sharpness),
                decayMs = HapticListener.decayMs(sharpness),
                sources = e.sources or HapticTrack.SOURCE_SUBTITLE
            )
        }
        events.sortBy { it.timeMs }
        return HapticTrack(raw.analyzerVersion, raw.fingerprint, bed, raw.bedSharpness, events)
    }

    // ponytail: sorts the whole lane per publish (~1/s, 0.7M floats for a 2 h film); a 256-bin
    // histogram if it shows up in a profile.
    private fun percentile(values: FloatArray, p: Float): Float =
        if (values.isEmpty()) 1f else values.apply { sort() }[((values.size - 1) * p).toInt()]
}
