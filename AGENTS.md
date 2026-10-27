# Commit Message Guidelines (Agent Instructions)

Release notes are hand-written (see "Release Notes" at the end); commit subjects
no longer become release notes. Keep the format anyway: `feat`, `fix` and `perf`
are what to read when drafting the notes.

## Required Format

1. First line (summary)
   - `type(scope): short summary`
   - Keep it <= 72 characters.
   - Use present tense, imperative voice.

2. Optional body (recommended for clarity)
   - Bullet list of user-visible changes.
   - One change per line.

## User-Visible Types

`feat`, `fix`, `perf`

## Other Allowed Types (Internal)

`refactor`, `docs`, `chore`, `ci`, `test`, `style`

## Scope

Use a small, relevant scope like:
`player`, `subtitles`, `haptics`, `updates`, `ui`, `build`, `ci`

## Examples (User-Visible)

```
feat(updates): add in-app update modal

- show changelog in a dedicated modal
- download correct APK based on device ABI
- keep Settings badge visible while update is available
```

```
fix(subtitles): improve SDH detection for bracketed cues

- detect parenthetical effects like (footsteps)
- reduce false positives around music-only captions
```

## Examples (Internal)

```
chore(ci): tidy workflow env injection
```

```
refactor(player): extract seek helpers
```

## What To Avoid

- No multi-paragraph prose.
- Avoid vague summaries like "misc fixes".
- Avoid internal-only notes unless user-visible.

## Release Notes

Before tagging `vX.Y.Z`, add `release-notes/X.Y.Z.txt`. CI fails the tag without it.

- The same text goes to Play's "What's new" and the GitHub Release.
- At most 500 characters (Play's limit; CI checks it).
- Plain words for users: what they will notice, not how it was done.
- One `- ` bullet per change. No scopes, file names or library names.
- Draft it from `git log --no-merges <last tag>..HEAD` (`feat`/`fix`/`perf`); the owner
  approves the wording.

## Android TV

The TV version is the same app (`IS_TV` from `src/utils/tv.ts` gates TV-only code), built and
released from `main`; it ships with the next release. Plan and guidance: `docs/android-tv.md`.

- Every UI change must work with a TV remote: reachable with the D-pad, with a visible focus state
  (the shared primitives in `src/components/ui` give this). Touch-only features (gestures,
  haptics, PiP, rotation) are hidden on TV with `IS_TV`.
- Never branch TV behaviour on screen size; phones must behave exactly as before.
