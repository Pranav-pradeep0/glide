package com.glide.app.haptic

/**
 * Subtitle meaning (docs/haptics-engine-plan.md Phase 5): the sound tags of SDH subtitles as
 * data. "[explosion]" and "[door slams]" name hits, "♪" and "[tense music playing]" music,
 * "[grunting]" and "[breathing heavily]" voice. Anything else in brackets, mostly speaker names
 * ("[VICTOR]"), names nothing here and is dropped.
 */
object HapticMeaning {
    /** [SPEECH] comes only from [HapticSounds]: captions of plain dialogue carry no tag. */
    enum class Kind { SHARP, HEAVY, ENGINE, MUSIC, VOICE, SPEECH }

    data class Cue(val startMs: Int, val endMs: Int, val text: String)

    /** [exact]: the sound is within [startMs, endMs] (heard, [HapticSounds]), not near a caption's start. */
    data class Tag(val startMs: Int, val endMs: Int, val kind: Kind, val exact: Boolean = false)

    // First match wins: "[thunderclap]" is heavy, not sharp; "[pluto snarling, banging]" a hit.
    private val KINDS = listOf(
        Kind.HEAVY to Regex("""\b(explo|boom|thud|thump|slam|crash|thunder|pound|rumbl|heartbeat|impact|smash|stomp|collaps)"""),
        Kind.SHARP to Regex("""\b(gunshot|gunfire|shot|bang|fir(es|ing)\b|crack|snap|slap|punch|knock|clang|clank|shatter|stab|whip|(glass|window|bottle) break|breaking (glass|window|bottle))"""),
        Kind.ENGINE to Regex("""\b(engine|rev(s|ving|ved)?\b|motor|tires|skid|vroom)"""),
        Kind.MUSIC to Regex("""♪|♫|\b(music|song|sing|choir|chant|guitar|piano|r&b|vocaliz|waltz|humming)"""),
        Kind.VOICE to Regex("""\b(grunt|gasp|groan|pant|breath|chuckl|sigh|s i g h|scream|shriek|laugh|whimper|wheez|moan|sob|yell|gag|cough|whisper|sniff|huff|exhal|inhal|cry|crie|retch|shudder|strain|stammer|mumbl|shout|exclaim|clears throat|yelp|chok|gurgl)""")
    )
    private val BRACKETS = Regex("""\[([^\]]*)]|\(([^)]*)\)""")
    private val MARKUP = Regex("""<[^>]*>|\{[^}]*\}""")

    /** Each cue's tags, in cue order; a cue with several sounds gives several tags. */
    fun tags(cues: List<Cue>): List<Tag> = cues.flatMap { cue ->
        val text = cue.text.replace(MARKUP, "").lowercase()
        val kinds = BRACKETS.findAll(text).mapNotNull { m -> kindOf(m.value) }.toMutableList()
        if ('♪' in text || '♫' in text) kinds += Kind.MUSIC // lyrics between notes
        kinds.distinct().map { Tag(cue.startMs, cue.endMs, it) }
    }

    private fun kindOf(tag: String): Kind? = KINDS.firstOrNull { it.second.containsMatchIn(tag) }?.first
}
