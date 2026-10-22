package com.glide.app.haptic

/**
 * Subtitle meaning (docs/haptics-engine-plan.md Phase 5): the sound tags of SDH subtitles as
 * data. "[explosion]" and "[door slams]" name hits, "♪" and "[tense music playing]" music,
 * "[grunting]" and "[breathing heavily]" voice. Anything else in brackets, mostly speaker names
 * ("[VICTOR]"), names nothing here and is dropped.
 */
object HapticMeaning {
    /** [ROAR] and [ENGINE] are long sounds, no hit to keep: they mark moments for the benchmark. */
    enum class Kind { SHARP, HEAVY, ENGINE, ROAR, MUSIC, VOICE }

    /** What a viewer would point at: SDH cues of these kinds should be felt (HapticBenchTest's truth). */
    val EFFECTS = setOf(Kind.SHARP, Kind.HEAVY, Kind.ENGINE, Kind.ROAR)

    /**
     * How a viewer feels an effect: strong (explosions, gunfire, roars, slams, thunder, revving),
     * light (a tap fits: knocks, thuds, clangs, growls), none (a fire crackling, heartbeats, an
     * engine stopping). Against the 2021 graded caption texts (`.haptics-fixtures/cue-grades.tsv`,
     * HapticMeaningTest): 66 of 67 strong read strong, 6 light ones too, no none text reads strong
     * and 15 of 1756 read light (docs/haptics-decisions.md, Events).
     * Crackling is light, as the tester marked the lab scene's electricity missed; a fire's isn't.
     */
    enum class Weight { STRONG, LIGHT, NONE }

    data class Cue(val startMs: Int, val endMs: Int, val text: String)

    data class Tag(val startMs: Int, val endMs: Int, val kind: Kind, val weight: Weight = Weight.LIGHT)

    // First match wins: "[thunderclap]" is heavy, not sharp; "[pluto snarling, banging]" a hit.
    private val KINDS = listOf(
        Kind.HEAVY to Regex("""\b(explo|boom|thud|thump|slam|crash|thunder|pound|rumbl|heartbeat|impact|smash|stomp|collaps|splash)"""),
        Kind.SHARP to Regex("""\b(gunshot|gunfire|shot|bang|fir(es|ing)\b|crack|snap|slap|punch|knock|clang|clank|shatter|clatter|firecracker|firework|stab|whip|(glass|window|bottle) break|breaking (glass|window|bottle))"""),
        Kind.ENGINE to Regex("""\b(engine|rev(s|ving|ved)?\b|motor|tires|skid|vroom)"""),
        Kind.ROAR to Regex("""\b(roar|growl|snarl|bellow)"""),
        Kind.MUSIC to Regex("""♪|♫|\b(music|song|sing|choir|chant|guitar|piano|r&b|vocaliz|waltz|humming|score|tune|band|drum)"""),
        Kind.VOICE to Regex("""\b(grunt|gasp|groan|pant|breath|chuckl|sigh|s i g h|scream|shriek|laugh|whimper|wheez|moan|sob|yell|gag|cough|whisper|sniff|huff|exhal|inhal|cry|crie|retch|shudder|strain|stammer|mumbl|shout|exclaim|clears throat|yelp|chok|gurgl)""")
    )
    private val BRACKETS = Regex("""\[([^\]]*)]|\(([^)]*)\)""")
    private val MARKUP = Regex("""<[^>]*>|\{[^}]*\}""")

    private val STRONG = Regex("""\b(roar(s|ing|ed)?\b|shatter|(glass|window|bottle) break|breaking (glass|window|bottle)|explo|gunfire|gunshot|guns? fir|rifles? fir|firecracker|crash|slam|thunder|rumbl|rev(s|ving|ved)?\b|accelerat|surge|heavy (splash|thud)|loud thud)""")
    private val NONE = Regex("""\b((fire|static) crackl|static|heartbeat|snaps fingers|fingers snapping|imitating|(stops|shuts off|turns off)\b|stops growling)""")

    /** Each cue's tags, in cue order; a cue with several sounds gives several tags, the strongest weight of each kind. */
    fun tags(cues: List<Cue>): List<Tag> = cues.flatMap { cue ->
        val text = cue.text.replace(MARKUP, "").lowercase()
        val kinds = BRACKETS.findAll(text).mapNotNull { m -> kindOf(m.value)?.let { it to weightOf(m.value) } }.toMutableList()
        if ('♪' in text || '♫' in text) kinds += Kind.MUSIC to Weight.NONE // lyrics between notes
        kinds.groupBy({ it.first }) { it.second }.map { (kind, ws) -> Tag(cue.startMs, cue.endMs, kind, ws.minOf { it }) }
    }

    private fun weightOf(tag: String) = when {
        NONE.containsMatchIn(tag) -> Weight.NONE
        STRONG.containsMatchIn(tag) -> Weight.STRONG
        else -> Weight.LIGHT
    }

    private fun kindOf(tag: String): Kind? = KINDS.firstOrNull { it.second.containsMatchIn(tag) }?.first
}
