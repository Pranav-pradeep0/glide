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
 * What the sound is decides the rest: the moment score ([HapticSounds.moment]) fades out score,
 * logos, ambience and dialogue and keeps what a viewer would point at. Subtitle hit tags (Phase 5,
 * [HapticMeaning]) keep the loudest onset within [SNAP_MS] of their cue, light or below the gate,
 * and give it the tag's character.
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

    /** Under Cinematic the strength slider is a volume control, this many dB of motion per full slider. */
    const val STRENGTH_RANGE_DB = 30f

    /** Cinematic's slider position (src/store/appStore.ts) and its strength: loud moments [CINEMATIC_DB] under full motion. */
    private const val CINEMATIC = 0.6f
    private const val CINEMATIC_DB = -2.4f

    /**
     * Slider position 0..1 to the [direct] strength. Cinematic plays the film's real moments near
     * the motor's top (docs/haptics-decisions.md, Contrast): 25% of full motion read as missed.
     * Over it the slider reaches full at 1: louder clips them flat (a 1.5x Intense held 15% of a
     * big moment's time at one amplitude, 3x held 36%). Under it each 0.1 is 3 dB, Subtle (0.35)
     * playing as the old Cinematic did.
     */
    fun strength(level: Float): Float {
        val l = level.coerceIn(0f, 1f)
        val db = if (l >= CINEMATIC) CINEMATIC_DB * (1 - l) / (1 - CINEMATIC) else CINEMATIC_DB + (l - CINEMATIC) * STRENGTH_RANGE_DB
        return Math.pow(10.0, db / 20.0).toFloat()
    }

    const val SNAP_MS = 1000
    private const val SMOOTH_FRAMES = 10 // 100 ms
    private const val FOLLOW_DB = 6f // how far under the gate an open bed follows
    private const val SHARP = 0.8f
    private const val HEAVY = 0.1f
    private const val LIGHT_LEAD_MS = 200 // a light onset well before its cue is the line before
    private const val MIN_BURST_MS = 300
    private const val FLICKER_DB = 3f
    private const val KNEE = 0.75f // bed at the film's loud bass (99th percentile)
    private const val RECENT_FRAMES = 300 // 3 s: what the bed is heard against, as well as the film
    private const val STEADY_DB = 4f // no more than this over the last 3 s is steady: not felt
    private const val RISE_DB = 6f // this far over that is fully felt
    private const val MOMENT_FROM = 0.06f // moment score with nothing felt
    private const val MOMENT_FULL = 0.25f // and fully felt
    private const val MOMENT_CURVE = 1.5 // the gain is the ramp to this power: the unsure fade first
    private const val FLOOR = -3f // listened features: 30 dB under the film's loud level is silence
    private const val TOP = 1.5f
    // ponytail: a fixed window catches one or two logos; stacked studio logos run longer.
    private const val LOGO_MS = 15_000
    private const val SPEECH = 0.5f // YAMNet's Speech score over this is someone speaking

    // The Listener's dB scales: bed 0..1 is -45..0 dB, hit 0..1 is -40..0 dBFS.
    private const val BED_DB = 45f
    private const val HIT_DB = 40f

    /**
     * [strength] 0..1 is the user's volume: the film's loud moments play at that share of full
     * motor motion (intensity is a share of motion, see [HapticCalibration]) and louder ones rise
     * over it ([strengthened]). The slider maps to it by [strength].
     */
    fun direct(raw: HapticTrack, tags: List<HapticMeaning.Tag> = emptyList(), preset: Preset = Preset.CINEMATIC, strength: Float = 1f): HapticTrack {
        if (raw.analyzerVersion == 0) return raw // a fixture's truth, imported by the Lab
        val film = Film(raw)
        val v = raw.bedIntensity
        val level = film.level
        val bedGate = film.bedRef - preset.bedRangeDb / BED_DB
        val bedLow = bedGate - FOLLOW_DB / BED_DB
        val hitGate = film.hitRef - preset.hitRangeDb / HIT_DB
        // The film's loud bass plays at [KNEE]; its loudest 1% rises over it dB for dB instead of
        // clipping, so an explosion keeps moving and hits stand out of it.
        val bed = FloatArray(v.size) { i ->
            if (v[i] <= 0f || level[i] <= bedGate) 0f else preset.bedGain * kneed(v[i], bedLow, film.bedRef)
        }
        val bedSalience = salience(film.level, film.recent, film.bedRef, film.bedTop)
        for (i in bed.indices) bed[i] *= bedSalience[i]
        // On the film's own sound, before meaning: a flicker is the same with or without labels.
        dropFlickers(bed, level, bedGate + FLICKER_DB / BED_DB, film.weighty.filter { it.intensity >= hitGate })
        // What the sound is: score, logos, ambience and dialogue fade out, what a viewer would
        // point at stays. Without labels (the model didn't load) everything plays.
        val moment = moments(raw, film)
        fun at(ms: Int) = moment?.getOrElse(ms / HapticTrack.BED_FRAME_MS) { 0f } ?: 1f
        if (moment != null) for (i in bed.indices) bed[i] *= moment[i]
        // A moment above the bed's 100 Hz (an engine revving, 100-2000 Hz) follows the body (below
        // 300 Hz), gated on the film's own loud body as the bed is on its loud bass and faded the
        // same way when steady. Unfaded, it buzzed through loud scenes (creature attack 0.72 felt).
        if (moment != null && raw.body.isNotEmpty()) {
            val bodyLow = film.bodyRef - (preset.bedRangeDb + FOLLOW_DB) / BED_DB
            val bodySalience = smoothed(raw.body).let { salience(it, recent(it), film.bodyRef, film.bodyTop) }
            for (i in bed.indices) if (moment[i] > 0f && raw.body[i] > bodyLow) {
                bed[i] = maxOf(bed[i], moment[i] * bodySalience[i] * preset.bedGain * kneed(raw.body[i], bodyLow, film.bodyRef))
            }
        }

        fun scaled(e: HapticTrack.Event) = e.copy(
            // Over the film's loud hits dB for dB, as the bed: [strengthened] clips.
            intensity = if (e.intensity > film.hitRef) Math.pow(10.0, ((e.intensity - film.hitRef) * HIT_DB / 20).toDouble()).toFloat()
            else (preset.hitMin + (1 - preset.hitMin) * (e.intensity - hitGate) / (film.hitRef - hitGate)).coerceAtLeast(preset.hitMin),
            sources = e.sources and HapticTrack.LIGHT.inv()
        )
        // Hits are scaled by the moment gain as the bed is: gated only, a hit at 0.01 of a moment
        // played as hard as an explosion's (a "too much" mark on dialogue, 2:52 in Frankenstein).
        val events = film.weighty.filter { e -> e.intensity >= hitGate && at(e.timeMs) > 0f }
            .map { scaled(it).let { h -> h.copy(intensity = h.intensity * at(h.timeMs)) } }.toMutableList()
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
        for (i in bed.indices) bed[i] = strengthened(bed[i], strength)
        return HapticTrack(raw.analyzerVersion, raw.fingerprint, bed, raw.bedSharpness, events.map { it.copy(intensity = strengthened(it.intensity, strength)) })
    }

    /**
     * [strength] is a volume and full motion the only ceiling: what is over the film's loud level
     * rises into the motor's top. Clipped at the loud level before the volume, the motor never
     * passed amplitude 67 of 255 at Cinematic.
     */
    private fun strengthened(x: Float, strength: Float) = minOf(1f, x * strength)

    /**
     * The film's own levels, the same for every preset. Levels are judged on power averaged over
     * [SMOOTH_FRAMES]: low tones beat 10-20 times a second, and judged frame by frame their dips
     * would chop a rumble into pieces.
     */
    internal class Film(raw: HapticTrack) {
        val level: FloatArray
        /** Mean [level] (dB) over the last [RECENT_FRAMES]: what the bed is heard against. */
        val recent: FloatArray
        val bedRef: Float
        val bedTop: Float
        val weighty = raw.events.filter { it.sources and HapticTrack.LIGHT == 0 }
        val hitRef = percentile(FloatArray(weighty.size) { weighty[it].intensity }, 0.95f)
        private val heardBody = raw.body.filter { it > 0f }.toFloatArray()
        val bodyRef = percentile(heardBody, 0.99f)
        val bodyTop = percentile(heardBody, 0.999f)

        init {
            val v = raw.bedIntensity
            level = smoothed(v)
            val heard = FloatArray(v.count { it > 0f })
            var k = 0
            for (i in v.indices) if (v[i] > 0f) heard[k++] = level[i]
            bedRef = percentile(heard, 0.99f)
            bedTop = percentile(heard, 0.999f)
            recent = recent(level)
        }
    }

    /** [v] as power over [SMOOTH_FRAMES], centred. */
    private fun smoothed(v: FloatArray): FloatArray {
        val sum = DoubleArray(v.size + 1) // running power
        for (i in v.indices) sum[i + 1] = sum[i] + if (v[i] > 0f) Math.pow(10.0, (v[i] - 1.0) * BED_DB / 10) else 0.0
        val half = SMOOTH_FRAMES / 2
        return FloatArray(v.size) { i ->
            val a = maxOf(0, i - half)
            val b = minOf(v.size, i + half + 1)
            (1 + 10 * log10((sum[b] - sum[a]) / (b - a) + 1e-12) / BED_DB).toFloat()
        }
    }

    /** Mean of [level] (dB) over the last [RECENT_FRAMES] at each frame. */
    private fun recent(level: FloatArray): FloatArray {
        val s = DoubleArray(level.size + 1)
        for (i in level.indices) s[i + 1] = s[i] + level[i].coerceAtLeast(0f)
        return FloatArray(level.size) { i ->
            val a = maxOf(0, i + 1 - RECENT_FRAMES)
            ((s[i + 1] - s[a]) / (i + 1 - a)).toFloat()
        }
    }

    /**
     * The Listener's view of each of [windows] sound windows, the moment score's other inputs, in
     * tens of dB: bass against the film's loud bass (99th percentile), its rise over the last 3 s,
     * the body (below 300 Hz) against the film's, and the loudest weighty and light hit against
     * the film's loud hits (95th). Clamped, so silence and the film's peak read as fixed ends.
     */
    internal fun listened(raw: HapticTrack, film: Film, windows: Int): Array<FloatArray> {
        val f = HapticTrack.BED_FRAME_MS
        val n = raw.bedIntensity.size
        var e = 0 // first event at or after the window
        return Array(windows) { k ->
            val from = k * HapticSounds.HOP_MS
            val to = from + HapticSounds.WINDOW_MS
            var bass = -1f
            var rise = -1f
            var body = -1f
            for (i in from / f until minOf(n, to / f)) {
                bass = maxOf(bass, film.level[i])
                rise = maxOf(rise, film.level[i] - film.recent[i])
                if (raw.body.isNotEmpty()) body = maxOf(body, raw.body[i])
            }
            while (e < raw.events.size && raw.events[e].timeMs < from) e++
            var hit = -1f
            var light = -1f
            for (j in e until raw.events.size) {
                val ev = raw.events[j]
                if (ev.timeMs >= to) break
                if (ev.sources and HapticTrack.LIGHT != 0) light = maxOf(light, ev.intensity) else hit = maxOf(hit, ev.intensity)
            }
            floatArrayOf(
                ((bass - film.bedRef) * BED_DB / 10).coerceIn(FLOOR, TOP),
                (rise * BED_DB / 10).coerceIn(-1f, 3f),
                ((body - film.bodyRef) * BED_DB / 10).coerceIn(FLOOR, TOP),
                ((hit - film.hitRef) * HIT_DB / 10).coerceIn(FLOOR, TOP),
                ((light - film.hitRef) * HIT_DB / 10).coerceIn(FLOOR, TOP)
            )
        }
    }

    /**
     * The moment gain per bed frame, 0..1, from each window's score (the best of it and its
     * neighbours): linear between window centres, none under [MOMENT_FROM], full from
     * [MOMENT_FULL], the ramp to [MOMENT_CURVE] between. Null with no sounds lane.
     */
    private fun moments(raw: HapticTrack, film: Film): FloatArray? {
        if (raw.sounds.isEmpty()) return null
        val listened = listened(raw, film, raw.sounds.size)
        // A studio logo is as loud and deep as an explosion, even on the LFE, and only its place
        // tells it apart: in the first [LOGO_MS], until YAMNet hears speech, nothing is a moment.
        // Three tuning films are three openings, too few to learn it from (it trained to 0). A
        // piece analysed later, past it, never reads as one.
        val speech = HapticSounds.KEPT.indexOf(HapticSounds.SPEECH)
        val spoken = raw.sounds.indexOfFirst { it[speech] > SPEECH }.let { if (it < 0) raw.sounds.size else it }
        val q = FloatArray(raw.sounds.size) { k ->
            if (k < spoken && k * HapticSounds.HOP_MS < LOGO_MS) 0f else HapticSounds.moment(raw.sounds[k], listened[k])
        }
        // A window takes its neighbours' best: a moment's sound spans windows, and a score dipping
        // between them stuttered the bed.
        val p = FloatArray(q.size) { k -> maxOf(q[k], q.getOrElse(k - 1) { 0f }, q.getOrElse(k + 1) { 0f }) }
        val f = HapticTrack.BED_FRAME_MS
        return FloatArray(raw.bedIntensity.size) { i ->
            val x = ((i * f - HapticSounds.WINDOW_MS / 2f) / HapticSounds.HOP_MS).coerceIn(0f, p.size - 1f)
            val k = x.toInt()
            val s = p[k] + (p[minOf(k + 1, p.size - 1)] - p[k]) * (x - k)
            Math.pow(((s - MOMENT_FROM) / (MOMENT_FULL - MOMENT_FROM)).coerceIn(0f, 1f).toDouble(), MOMENT_CURVE).toFloat()
        }
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
     * roar fades after its start unless it is the film's loudest 1% (over its 99th percentile, full
     * at its 99.9th), and a hit out of it rises again. The yardstick is the typical recent level
     * (mean dB), not its peaks: power-averaged, a loud scene's peaks hid the thuds and gunshots inside it.
     */
    private fun salience(level: FloatArray, recent: FloatArray, ref: Float, top: Float): FloatArray = FloatArray(level.size) { i ->
        val rise = (((level[i] - recent[i]) * BED_DB - STEADY_DB) / RISE_DB).coerceIn(0f, 1f)
        maxOf(rise, ((level[i] - ref) / maxOf(top - ref, 1e-3f)).coerceIn(0f, 1f))
    }

    /**
     * A level [x] from [low] (0) to the film's loud [ref] (its 99th percentile, [KNEE]), and over
     * it dB for dB, past 1 ([strengthened] clips): the loudest 1% keeps its swells. Clipped at the
     * 99.9th percentile, Frankenstein's final explosion (15 dB of swells) held one amplitude for 1.2 s.
     */
    private fun kneed(x: Float, low: Float, ref: Float): Float =
        if (x <= ref) KNEE * ((x - low) / (ref - low)).coerceAtLeast(0f)
        else KNEE * Math.pow(10.0, ((x - ref) * BED_DB / 20).toDouble()).toFloat()

    // ponytail: sorts the whole lane per publish (~1/s, 0.7M floats for a 2 h film); a 256-bin
    // histogram if it shows up in a profile.
    private fun percentile(values: FloatArray, p: Float): Float =
        if (values.isEmpty()) 1f else values.apply { sort() }[((values.size - 1) * p).toInt()]
}
