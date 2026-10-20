package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import kotlin.math.log10

/**
 * The Director (docs/haptics-engine-plan.md Phase 4): decides what of the Listener's raw track is
 * felt, relative to the film itself. The bed plays only within [Preset.bedRangeDb] of the film's
 * loud bass (its 99th percentile), hits only within [Preset.hitRangeDb] of its loud hits (95th); both are
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
    /**
     * Phase 6. Restraint: how close to the film's loud moments a sound must be to be felt.
     * Contrast: how soft the softest felt hit may be ([hitMin]) and how heavy the bed is under
     * the hits ([bedGain]). Cinematic is the Phase 4-5 track. How strong it all is, is the
     * user's separate strength setting ([direct]).
     */
    enum class Preset(val bedRangeDb: Float, val hitRangeDb: Float, val hitMin: Float, val bedGain: Float) {
        SUBTLE(7f, 6f, 0.25f, 0.6f),
        CINEMATIC(10f, 9f, 0.25f, 1f),
        INTENSE(13f, 12f, 0.4f, 1f),
    }

    /** The strength slider spans this many dB of motion, like a volume control. */
    const val STRENGTH_RANGE_DB = 30f

    /** Slider position 0..1 to the [direct] strength: 0 is ~3% of full motion (near the felt floor), 1 is full. */
    fun strength(level: Float) = Math.pow(10.0, ((level.coerceIn(0f, 1f) - 1) * STRENGTH_RANGE_DB / 20).toDouble()).toFloat()

    const val SNAP_MS = 1000
    private const val SMOOTH_FRAMES = 10 // 100 ms
    private const val FOLLOW_DB = 6f // how far under the gate an open bed follows
    private const val MUSIC_BED = 0.5f
    private val EFFECTS = setOf(Kind.SHARP, Kind.HEAVY, Kind.ENGINE)
    private const val SHARP = 0.8f
    private const val HEAVY = 0.1f
    private const val LIGHT_LEAD_MS = 200 // a light onset well before its cue is the line before
    private const val MIN_BURST_MS = 300
    private const val FLICKER_DB = 3f
    private const val KNEE = 0.75f // bed at the film's loud bass (99th percentile)
    private const val RECENT_FRAMES = 300 // 3 s: what the bed is heard against, as well as the film
    private const val STEADY_DB = 4f // no more than this over the last 3 s is steady: not felt
    private const val RISE_DB = 6f // this far over that is fully felt
    // ponytail: a fixed window catches one or two logos; stacked studio logos run longer.
    const val LOGO_MS = 15_000

    // The Listener's dB scales: bed 0..1 is -45..0 dB, hit 0..1 is -40..0 dBFS.
    private const val BED_DB = 45f
    private const val HIT_DB = 40f

    /**
     * [strength] 0..1 is the user's volume: the film's loud moments play at that share of full
     * motor motion (intensity is a share of motion, see [HapticCalibration]). Full strength felt
     * too strong on the Nothing Phone 2 in every preset (docs/haptics-decisions.md, Phase 6).
     */
    fun direct(raw: HapticTrack, tags: List<HapticMeaning.Tag> = emptyList(), preset: Preset = Preset.CINEMATIC, strength: Float = 1f): HapticTrack {
        if (raw.analyzerVersion == 0) return raw // a fixture's truth, imported by the Lab
        val tags = tags + HapticSounds.tags(raw.sounds)
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
        val bedGate = bedRef - preset.bedRangeDb / BED_DB
        val bedLow = bedGate - FOLLOW_DB / BED_DB
        val weighty = raw.events.filter { it.sources and HapticTrack.LIGHT == 0 }
        val hitRef = percentile(FloatArray(weighty.size) { weighty[it].intensity }, 0.95f)
        val hitGate = hitRef - preset.hitRangeDb / HIT_DB
        // The film's loud bass plays at [KNEE]; its loudest 1% fills the rest up to the 99.9th
        // percentile instead of clipping, so an explosion keeps moving and hits stand out of it.
        val bedTop = percentile(heard, 0.999f)
        val bed = FloatArray(v.size) { i ->
            if (v[i] <= 0f || level[i] <= bedGate) 0f else preset.bedGain * kneed(v[i], bedLow, bedRef, bedTop)
        }
        val bedSalience = salience(level, bedRef, bedTop)
        for (i in bed.indices) bed[i] *= bedSalience[i]
        // On the film's own sound, before tags: a flicker is the same with or without subtitles.
        dropFlickers(bed, level, bedGate + FLICKER_DB / BED_DB, weighty.filter { it.intensity >= hitGate })
        // Music alone (no effect named with it: score, songs) is lighter under the bed and has no
        // hits of its own; an effect under the score plays as usual. Before anyone first speaks
        // (studio logos, title music) it isn't felt at all: a logo's boom is as deep and loud as an
        // explosion, even on the LFE, and only its place tells it apart.
        // Labels heard but no line yet (the start still being analysed): it's all opening so far.
        // Without labels nothing says where speech is (subtitles carry no speech tags).
        val opening = tags.filter { it.kind == Kind.SPEECH }.minOfOrNull { it.startMs }
            ?: if (raw.sounds.isEmpty()) 0 else bed.size * HapticTrack.BED_FRAME_MS
        val musicOnly = BooleanArray(bed.size)
        val effect = BooleanArray(bed.size)
        fun mark(lane: BooleanArray, kinds: Set<Kind>, on: Boolean) = tags.filter { it.kind in kinds }.forEach { t ->
            lane.fill(on, (t.startMs / HapticTrack.BED_FRAME_MS).coerceIn(0, bed.size), (t.endMs / HapticTrack.BED_FRAME_MS).coerceIn(0, bed.size))
        }
        mark(musicOnly, setOf(Kind.MUSIC), true)
        mark(musicOnly, EFFECTS, false)
        mark(effect, EFFECTS, true)
        // A studio logo needn't be labelled music (Netflix's boom isn't anything): in the first
        // [LOGO_MS], before anyone speaks, only what is labelled an effect is felt.
        val logoEnd = minOf(opening, LOGO_MS) / HapticTrack.BED_FRAME_MS
        for (i in bed.indices) {
            if (i < logoEnd && !effect[i]) bed[i] = 0f
            if (musicOnly[i]) bed[i] *= if (i * HapticTrack.BED_FRAME_MS < opening) 0f else MUSIC_BED
        }
        fun underMusic(ms: Int) = musicOnly.getOrElse(ms / HapticTrack.BED_FRAME_MS) { false }
        fun inLogo(ms: Int) = ms / HapticTrack.BED_FRAME_MS < logoEnd && !effect.getOrElse(ms / HapticTrack.BED_FRAME_MS) { false }
        // An engine revs above the bed's 100 Hz: under an engine tag the bed follows the body
        // (below 300 Hz), gated on the film's own loud body as the bed is on its loud bass.
        val body = raw.body
        if (body.isNotEmpty()) {
            val heardBody = body.filter { it > 0f }.toFloatArray()
            val bodyRef = percentile(heardBody, 0.99f)
            val bodyTop = percentile(heardBody, 0.999f)
            val bodyLow = bodyRef - (preset.bedRangeDb + FOLLOW_DB) / BED_DB
            for (t in tags) if (t.kind == Kind.ENGINE) {
                for (i in (t.startMs / HapticTrack.BED_FRAME_MS).coerceAtLeast(0) until minOf(bed.size, t.endMs / HapticTrack.BED_FRAME_MS)) {
                    if (body[i] > bodyLow) bed[i] = maxOf(bed[i], preset.bedGain * kneed(body[i], bodyLow, bodyRef, bodyTop))
                }
            }
        }

        fun scaled(e: HapticTrack.Event) = e.copy(
            intensity = (preset.hitMin + (1 - preset.hitMin) * (e.intensity - hitGate) / (hitRef - hitGate)).coerceIn(preset.hitMin, 1f),
            sources = e.sources and HapticTrack.LIGHT.inv()
        )
        // Music has no hits of its own: one there is kept only if a tag names it (below).
        val events = weighty.filter { e -> e.intensity >= hitGate && !underMusic(e.timeMs) && !inLogo(e.timeMs) }.map(::scaled).toMutableList()
        for (t in tags) {
            val sharpness = when (t.kind) { Kind.SHARP -> SHARP; Kind.HEAVY -> HEAVY; else -> continue }
            val near = if (t.exact) t.startMs..t.endMs else t.startMs - SNAP_MS..t.startMs + SNAP_MS
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
        for (i in bed.indices) bed[i] *= strength
        return HapticTrack(raw.analyzerVersion, raw.fingerprint, bed, raw.bedSharpness, events.map { it.copy(intensity = it.intensity * strength) })
    }

    /**
     * A bed burst shorter than [MIN_BURST_MS] whose [level] stays under [ceiling] (within
     * [FLICKER_DB] of the gate) and with no hit in it is a flicker: a bass note or gust brushing
     * the gate. They were half of all felt moments and read as noise; short loud ones are thumps
     * and stay. Gaps the renderer plays through ([HapticRenderer.MIN_GAP_MS]) don't end a burst.
     */
    private fun dropFlickers(bed: FloatArray, level: FloatArray, ceiling: Float, hits: List<HapticTrack.Event>) {
        val gap = HapticRenderer.MIN_GAP_MS / HapticTrack.BED_FRAME_MS
        var i = 0
        while (i < bed.size) {
            if (bed[i] <= 0f) { i++; continue }
            var end = i + 1 // after the burst's last felt frame
            var j = end
            while (j < bed.size && j - end < gap) if (bed[j++] > 0f) end = j
            val from = i * HapticTrack.BED_FRAME_MS
            val to = end * HapticTrack.BED_FRAME_MS
            if (to - from < MIN_BURST_MS && (i until end).all { level[it] < ceiling } && hits.none { it.timeMs in from until to }) bed.fill(0f, i, end)
            i = end
        }
    }

    /**
     * Two timescales: the bed's gain at each frame, 0..1. Against the film the bed is gated on its
     * own (before this); against the last [RECENT_FRAMES] it must rise over [STEADY_DB]: a steady
     * roar fades after its start unless it is the film's loudest 1% (over [ref], full at [top]),
     * and a hit out of it rises again. The yardstick is the typical recent [level] (mean dB), not
     * its peaks: power-averaged, a loud scene's peaks hid the thuds and gunshots inside it.
     */
    private fun salience(level: FloatArray, ref: Float, top: Float): FloatArray {
        val sum = DoubleArray(level.size + 1)
        for (i in level.indices) sum[i + 1] = sum[i] + level[i].coerceAtLeast(0f)
        return FloatArray(level.size) { i ->
            val a = maxOf(0, i + 1 - RECENT_FRAMES)
            val recent = ((sum[i + 1] - sum[a]) / (i + 1 - a)).toFloat()
            val rise = (((level[i] - recent) * BED_DB - STEADY_DB) / RISE_DB).coerceIn(0f, 1f)
            maxOf(rise, ((level[i] - ref) / maxOf(top - ref, 1e-3f)).coerceIn(0f, 1f))
        }
    }

    /**
     * A level [x] from [low] (0) to the film's loud [ref] (its 99th percentile, [KNEE]), and on up
     * to its [top] (99.9th, 1): the loudest 1% keeps moving instead of clipping.
     */
    private fun kneed(x: Float, low: Float, ref: Float, top: Float): Float =
        if (x <= ref) KNEE * ((x - low) / (ref - low)).coerceAtLeast(0f)
        else KNEE + (1 - KNEE) * ((x - ref) / maxOf(top - ref, 1e-3f)).coerceAtMost(1f)

    // ponytail: sorts the whole lane per publish (~1/s, 0.7M floats for a 2 h film); a 256-bin
    // histogram if it shows up in a profile.
    private fun percentile(values: FloatArray, p: Float): Float =
        if (values.isEmpty()) 1f else values.apply { sort() }[((values.size - 1) * p).toInt()]
}
