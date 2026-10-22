package com.glide.app.haptic

import com.glide.app.haptic.HapticMeaning.Kind
import com.glide.app.haptic.HapticMeaning.Weight
import kotlin.math.log10

/**
 * The Director: decides what of the Listener's raw track is felt (docs/haptics-decisions.md,
 * Events). A film is felt as events, each clearly felt or not there at all: testers called a faint
 * buzz "missed" on a real roar and "too much" on music and crowds. Three questions, each answered
 * from the best source for it:
 *
 *  - What: an SDH caption names it ([HapticMeaning]: strong or light). Without one, the moment
 *    score ([HapticSounds.moment]) adds a strong event only where it is sure ([Preset.sure]):
 *    alone it finds about half of the captioned moments, so it can't lead.
 *  - When: at the sound's own start ([attacks]): an onset, or a jump of the bass or the body. A buzz
 *    that swelled in with a rising score read as half a second late.
 *  - How strong: a strong event from clearly felt ([STRONG_MIN]) up with its loudness against the
 *    film, then following its sound until [DROP_DB] under its peak or the next event; a light one
 *    is a single tap. A sequence of blasts is one event per blast, never one long wall.
 *
 * Runs on every published track: the cache holds the raw one, so changing this rebuilds nothing.
 * While a film is still being analysed the levels come from the part heard so far.
 */
object HapticDirector {
    /**
     * Subtle: strong captions only. Cinematic: light captions too, and the moment score's sure
     * events. Intense: its likelier ones as well. How strong it all is, is the user's separate
     * strength setting ([direct]).
     */
    enum class Preset(val light: Boolean, val sure: Float?) {
        SUBTLE(false, null),
        CINEMATIC(true, 0.3f),
        INTENSE(true, 0.2f),
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

    /** SDH cues trail their sound: a sound up to this long before its cue is the one it names. */
    const val SNAP_MS = 1000
    private const val SMOOTH_FRAMES = 10 // 100 ms
    private const val RECENT_FRAMES = 300 // 3 s: what a jump is heard against
    private const val JUMP_DB = 6f // a level this far over its last 3 s is a sound starting
    internal const val ATTACK_GAP_MS = 300
    private const val SEQUENCE_DB = 6f // in a strong cue, attacks this close to its loudest are its blasts too
    private const val MODEL_LOUD_DB = -10f // the moment score's events are this loud against the film at least
    private const val FALLBACK_DB = 9f // with no labels, hits this close to the film's loud hits play
    // ponytail: intensities picked for the AIN065 at Cinematic (amplitude ~100, ~110, ~137 at the
    // film's loud level); the phone strength test sets them.
    private const val LIGHT_LEVEL = 0.74f
    private const val STRONG_MIN = 0.82f
    private const val LOUD_SPAN_DB = 20f // a strong event this far under the film's loud level plays at STRONG_MIN
    private const val FOLLOW_RISE_DB = 3f // an attack whose bass or body rose this much is followed, else a tap
    private const val DROP_DB = 10f
    private const val MAX_EVENT_MS = 1500 // the moment score's events, which no caption ends
    private const val TAP_MS = 100 // shorter taps at a clear amplitude weren't clearly felt
    private const val TAP_DECAY_MS = 80
    private const val SHARP = 0.8f
    private const val HEAVY = 0.1f
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
        val f = HapticTrack.BED_FRAME_MS
        val bass = Lane(film.level, film.recent, film.bedRef)
        val body = if (raw.body.isEmpty()) null else smoothed(raw.body).let { Lane(it, recent(it), film.bodyRef) }
        val attacks = attacks(raw, film)
        val loud = loudness(raw, film, attacks, bass, body)

        // What: captions first. A cue names the loudest start from SNAP_MS before it to its end; a
        // strong cue also every start nearly as loud (its blasts). Light cues are one tap.
        val picked = HashMap<Int, Pick>()
        val named = ArrayList<IntRange>()
        for (t in tags) {
            if (t.kind !in HapticMeaning.EFFECTS) continue
            val w = t.startMs - SNAP_MS..maxOf(t.endMs, t.startMs + SNAP_MS)
            named += w
            if (t.weight == Weight.NONE || t.weight == Weight.LIGHT && !preset.light) continue
            val inW = attacks.indices.filter { attacks[it] in w }
            val best = inW.maxByOrNull { loud[it] } ?: continue
            val chosen = if (t.weight == Weight.STRONG) inW.filter { loud[it] >= loud[best] - SEQUENCE_DB } else listOf(best)
            val sharp = if (t.kind == Kind.SHARP) SHARP else HEAVY
            for (i in chosen) if (picked[i]?.strong != true) picked[i] = Pick(t.weight == Weight.STRONG, sharp, maxOf(t.endMs, attacks[i] + ATTACK_GAP_MS))
        }
        // Then the moment score, where no caption has said what is there: only what it is sure of.
        // Without labels (the model didn't load), the Phase 4 rules: weighty onsets within
        // FALLBACK_DB of the film's loud hits, swells within it of its loud bass (the Listener's
        // weight rule keeps speech and music out; a light onset is as likely a consonant).
        val q = scores(raw, film)
        val onsets = HashMap<Int, Float>() // weighty onsets' intensity, light ones -1
        for (ev in raw.events) onsets[ev.timeMs] = maxOf(onsets[ev.timeMs] ?: -1f, if (ev.sources and HapticTrack.LIGHT == 0) ev.intensity else -1f)
        for (i in attacks.indices) {
            if (i in picked || named.any { attacks[i] in it }) continue
            val sure = if (q == null) onsets[attacks[i]]?.let { it >= film.hitRef - FALLBACK_DB / HIT_DB } ?: (bass.loud(attacks[i]) >= -FALLBACK_DB)
            else preset.sure != null && scoreAt(q, attacks[i]) >= preset.sure && loud[i] >= MODEL_LOUD_DB
            if (sure) picked[i] = Pick(true, null, attacks[i] + MAX_EVENT_MS)
        }

        // How strong, and for how long.
        val bed = FloatArray(raw.bedIntensity.size)
        val events = ArrayList<HapticTrack.Event>()
        val order = picked.keys.sorted()
        var e = 0 // first raw onset at or after the attack
        for ((n, i) in order.withIndex()) {
            val p = picked.getValue(i)
            val t = attacks[i]
            while (e < raw.events.size && raw.events[e].timeMs < t) e++
            val onset = (e until raw.events.size).takeWhile { raw.events[it].timeMs < t + ATTACK_GAP_MS }.maxByOrNull { raw.events[it].intensity }?.let { raw.events[it] }
            val sharp = p.sharpness ?: onset?.sharpness ?: HEAVY
            val sources = HapticTrack.SOURCE_AUDIO or if (p.sharpness != null) HapticTrack.SOURCE_SUBTITLE else 0
            if (!p.strong) { events += HapticTrack.Event(t, LIGHT_LEVEL, sharp, TAP_MS, TAP_DECAY_MS, sources); continue }
            val peak = strongLevel(loud[i])
            // An onset is the hit; a swell (a jump with no onset) has no punch, it only follows.
            if (onset != null) events += HapticTrack.Event(t, peak, sharp, HapticListener.lengthMs(sharp), HapticListener.decayMs(sharp), sources)
            // Follow the lane that rose most at the start, until DROP_DB under its peak.
            val lane = listOfNotNull(bass, body).maxByOrNull { it.rise(t) }?.takeIf { it.rise(t) >= FOLLOW_RISE_DB } ?: continue
            val top = lane.peak(t)
            val end = minOf(order.getOrNull(n + 1)?.let { attacks[it] } ?: Int.MAX_VALUE, p.untilMs, bed.size * f)
            for (k in t / f until end / f) {
                val db = (lane.level[k] - top) * BED_DB
                if (k * f >= t + ATTACK_GAP_MS && db < -DROP_DB) break
                bed[k] = maxOf(bed[k], peak * Math.pow(10.0, db / 20.0).toFloat())
            }
        }
        events.sortBy { it.timeMs }
        for (i in bed.indices) bed[i] = strengthened(bed[i], strength)
        return HapticTrack(raw.analyzerVersion, raw.fingerprint, bed, raw.bedSharpness, events.map { it.copy(intensity = strengthened(it.intensity, strength)) })
    }

    /**
     * An attack chosen to be felt: strong or a light tap, its character if a caption set one (null
     * for the moment score's), and when it ends at the latest: its caption's end (the caption says
     * how long the sound lasts; past it, a roar's event ran on through the shouting after it).
     */
    private class Pick(val strong: Boolean, val sharpness: Float?, val untilMs: Int)

    /** A level lane (0..1 is -45..0 dB, smoothed), its mean over the last 3 s, and the film's loud level of it. */
    private class Lane(val level: FloatArray, val recent: FloatArray, val ref: Float) {
        private fun frames(t: Int) = t / HapticTrack.BED_FRAME_MS until minOf(level.size, (t + ATTACK_GAP_MS) / HapticTrack.BED_FRAME_MS)
        /** How far, in dB, the lane rose over its last 3 s just after [t]. */
        fun rise(t: Int) = frames(t).maxOfOrNull { (level[it] - recent[it]) * BED_DB } ?: -99f
        fun peak(t: Int) = frames(t).maxOfOrNull { level[it] } ?: 0f
        /** Just after [t], against the film's loud level, in dB. */
        fun loud(t: Int) = (peak(t) - ref) * BED_DB
    }

    /**
     * How loud each attack is against the film, in dB: the loudest of its bass and body against
     * the film's loud levels and of its onsets against the film's loud hits (glass and gunshots
     * carry little bass).
     */
    private fun loudness(raw: HapticTrack, film: Film, attacks: IntArray, bass: Lane, body: Lane?): FloatArray {
        var e = 0
        return FloatArray(attacks.size) { i ->
            val t = attacks[i]
            while (e < raw.events.size && raw.events[e].timeMs < t) e++
            var hit = -99f
            var j = e
            while (j < raw.events.size && raw.events[j].timeMs < t + ATTACK_GAP_MS) hit = maxOf(hit, (raw.events[j++].intensity - film.hitRef) * HIT_DB)
            maxOf(bass.loud(t), body?.loud(t) ?: -99f, hit)
        }
    }

    /**
     * A strong event's intensity from its loudness [db] against the film: [STRONG_MIN] at
     * [LOUD_SPAN_DB] under the film's loud level and quieter, 1 at it, over it dB for dB
     * ([strengthened] clips at full motion).
     */
    private fun strongLevel(db: Float): Float =
        if (db >= 0f) Math.pow(10.0, db / 20.0).toFloat()
        else STRONG_MIN + (1 - STRONG_MIN) * ((db + LOUD_SPAN_DB) / LOUD_SPAN_DB).coerceIn(0f, 1f)

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
        /** Mean [level] (dB) over the last [RECENT_FRAMES]: what a jump is heard against. */
        val recent: FloatArray
        val bedRef: Float
        private val weighty = raw.events.filter { it.sources and HapticTrack.LIGHT == 0 }
        val hitRef = percentile(FloatArray(weighty.size) { weighty[it].intensity }, 0.95f)
        val bodyRef = percentile(raw.body.filter { it > 0f }.toFloatArray(), 0.99f)

        init {
            val v = raw.bedIntensity
            level = smoothed(v)
            val heard = FloatArray(v.count { it > 0f })
            var k = 0
            for (i in v.indices) if (v[i] > 0f) heard[k++] = level[i]
            bedRef = percentile(heard, 0.99f)
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
     * Where sounds start, in media ms: every Listener onset (the mix's and the high band's, to the
     * ms), and where the bass or the body jumps [JUMP_DB] over its last 3 s with no onset within
     * [ATTACK_GAP_MS]: a roar or an engine swells with no sharp onset (one jump per
     * [ATTACK_GAP_MS]; a smoothed level reads a jump up to 50 ms early, so an onset's time wins).
     * 94% of the strong SDH cues of the tuning films have one (docs/haptics-decisions.md, Events).
     */
    internal fun attacks(raw: HapticTrack, film: Film): IntArray {
        val f = HapticTrack.BED_FRAME_MS
        val onsets = raw.events.map { it.timeMs }.distinct()
        val jumps = sortedSetOf<Int>()
        fun jumps(level: FloatArray, recent: FloatArray) {
            for (i in level.indices) if ((level[i] - recent[i]) * BED_DB >= JUMP_DB) jumps += i * f
        }
        jumps(film.level, film.recent)
        if (raw.body.isNotEmpty()) smoothed(raw.body).let { jumps(it, recent(it)) }
        val out = onsets.toMutableList()
        var last = Int.MIN_VALUE / 2
        var k = 0 // first onset at or after the jump less the gap
        for (t in jumps) {
            if (t - last < ATTACK_GAP_MS) continue
            last = t
            while (k < onsets.size && onsets[k] < t - ATTACK_GAP_MS) k++
            if (k < onsets.size && onsets[k] <= t + ATTACK_GAP_MS) continue
            out += t
        }
        out.sort()
        return out.toIntArray()
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
     * The moment score of each sound window; null with no sounds lane. A studio logo is as loud
     * and deep as an explosion, even on the LFE, and only its place tells it apart: in the first
     * [LOGO_MS], until YAMNet hears speech, nothing is a moment (three tuning films are three
     * openings, too few to learn it from). A piece analysed later, past it, never reads as one.
     */
    private fun scores(raw: HapticTrack, film: Film): FloatArray? {
        if (raw.sounds.isEmpty()) return null
        val listened = listened(raw, film, raw.sounds.size)
        val speech = HapticSounds.KEPT.indexOf(HapticSounds.SPEECH)
        val spoken = raw.sounds.indexOfFirst { it[speech] > SPEECH }.let { if (it < 0) raw.sounds.size else it }
        return FloatArray(raw.sounds.size) { k ->
            if (k < spoken && k * HapticSounds.HOP_MS < LOGO_MS) 0f else HapticSounds.moment(raw.sounds[k], listened[k])
        }
    }

    /** The best score of the windows that hear the half second after [t]. */
    private fun scoreAt(q: FloatArray, t: Int): Float {
        val from = ((t - HapticSounds.WINDOW_MS) / HapticSounds.HOP_MS + 1).coerceAtLeast(0)
        val to = minOf(q.size - 1, (t + 500) / HapticSounds.HOP_MS)
        return (from..to).maxOfOrNull { q[it] } ?: 0f
    }

    // ponytail: sorts the whole lane per publish (~1/s, 0.7M floats for a 2 h film); a 256-bin
    // histogram if it shows up in a profile.
    private fun percentile(values: FloatArray, p: Float): Float =
        if (values.isEmpty()) 1f else values.apply { sort() }[((values.size - 1) * p).toInt()]
}
