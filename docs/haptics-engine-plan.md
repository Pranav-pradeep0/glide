# Haptics engine — audit and plan

**Created:** 2026-10-11
**Status:** Phase 0 done (2026-10-11), see `docs/haptics-decisions.md`. Phase 1 not started.

This is the working document for rebuilding "Play with haptics" from scratch. It is written to
be picked up cold, in a new session, without the conversation that produced it. Results of
Phase 0 go in `docs/haptics-decisions.md`.

**Goal:** haptics that feel like a DualSense controller or Apple's F1 trailer: in sync with
the sound, restrained, with contrast. Every claim of "better" is backed by an automatic score,
not by opinion.

---

# Part 1 — What exists today, and why it falls short

## 1.1 The current pipeline

```
SDH cue "[door slams]" -> extract bracketed text -> match one of 22 keywords
  -> adjust by modifier words -> synthesize a 40 ms-step waveform
  -> JS setInterval (125 ms) checks for a starting cue -> throttle -> vibrate
```

| File | Role | Fate |
|---|---|---|
| `src/hooks/useHapticFeedback.ts` | One timer for **subtitle display** and haptics | Split: subtitle display survives, haptic half deleted |
| `src/services/HapticEngineService.ts` | Throttle, priority, native calls | Deleted |
| `src/services/HapticSynthesizer.ts` | ADSR/noise/oscillator waveform | Deleted |
| `src/services/HapticIntensityCalculator.ts` | User strength scaling | Deleted |
| `src/services/HapticPatternGenerator.ts` | Cue -> pattern | Deleted |
| `src/services/SmartKeywordMatcher.ts`, `ContextAnalyzer.ts`, `src/data/hapticKeywords.ts` | Text understanding | Knowledge reused in Phase 5, code rewritten |
| `android/.../haptic/HapticModule.java` | `vibrate`, `vibrateWaveform`, `cancel`, `perform` | `perform` (UI feedback) stays; the rest is replaced by the native engine |
| `src/utils/constants.ts` `MAX_HAPTICS_PER_SECOND`, `BASE_HAPTIC_INTENSITIES`, `HAPTIC_INTENSITY_MULTIPLIERS`, … | Unused | Deleted |

UI entry points stay and get rewired: `playMode: 'with-haptics'`, Settings toggle and strength
presets (`SettingsScreen.tsx`, `QuickSettingsPanel.tsx`), `hapticSettings` in `appStore.ts`.

## 1.2 The finding that explains the experience

On the reference phone, `Vibrator.hasAmplitudeControl()` returns **false** (the HAL reports
`capabilities=[ON_CALLBACK]` only), so `HapticEngineService.playPattern` always takes
`fallbackVibration`: **one 100% buzz lasting the subtitle's on-screen time, capped at 2 s.**
Confirmed from the system vibration history during a real playback:

```
Step=1625ms(amplitude=1.00)   Step=1500ms(amplitude=1.00)   Step=2000ms(amplitude=1.00) ...
```

The synthesizer, layers and envelopes have never run on this phone. Yet the motor **does**
honour amplitude (felt as a smooth 4-step ramp). Lesson: **measure the device, never trust
its capability flags.**

## 1.3 Other defects (all removed by the rebuild, not fixed individually)

- Impact category ignores its waveform and buzzes for the whole cue duration.
- Amplitude floor of 1 means rests never go silent.
- Default strength 128 x 0.8 synth gain: quiet effects land below the felt floor.
- 40 ms steps alias anything above 12.5 Hz (the "15 Hz engine" plays as ~10 Hz).
- `transient` lasts one step, so `[gunfire]` is one blip.
- 400 ms throttle drops events; each vibrate cancels the previous one.
- No `VibrationAttributes` usage, so the system media-vibration setting doesn't apply.
- Timing: SDH cue times are reading times (±200–500 ms off the sound), plus 125 ms polling,
  plus 250 ms position events, plus async bridge.
- No SDH track means no haptics at all.

---

# Part 2 — Reference device profile (measured 2026-10-11)

**Nothing Phone (2)** `AIN065`, Android 16 (API 36), Snapdragon 8+ Gen 1 (SM8475).

| Property | Value | Source |
|---|---|---|
| HAL capabilities | `[ON_CALLBACK]` only (flags=1) | `dumpsys vibrator_manager` |
| Amplitude actually works | **Yes**, smooth across 12/31/59/100% | feel test |
| Felt floor | ~**6%** (15/255); 2–3% not felt | feel test |
| Prebaked effects | CLICK, DOUBLE_CLICK, TICK, THUD, POP, HEAVY_CLICK, all **mushy** | feel test |
| Composition primitives / envelopes / frequency control | **None** (no Android 16 envelope support) | `dumpsys` |
| Best "hit" | **30 ms at 100%**, indistinguishable from THUD | blind A/B |
| Hardware audio decoders | AAC, FLAC, MP3, Opus only. **No AC3/EAC3/DTS** | `media_codecs*.xml` |
| HapticGenerator | Library present (`/system/etc/audio_effects.xml`), "haptics output" route with `haptic-A` channel mask; unproven | `dumpsys media.audio_flinger` |

Project facts: `minSdk 26`, `compileSdk 37`, Media3 `1.11.1`. The private FFmpeg AAR
(`android/app/libs/lib-decoder-ffmpeg-release.aar`) exposes a **public**
`FfmpegAudioDecoder(Format, int, int, int, boolean)`. A custom `AudioProcessor` already sits in the
audio path (`AudioDelayProcessor.kt`). `EmbeddedSubtitles.kt` already reads whole files with
Media3 extractors.

Useful commands:

```
adb shell dumpsys vibrator_manager | grep com.glide.app        # what Glide actually played
adb shell cmd vibrator_manager synced waveform -a 500 30 700 0 500 255   # quick feel test
```

---

# Part 3 — Design

## 3.1 What makes it immersive (design rules)

1. **Sync.** Within ~20 ms of the sound, never noticeably early. Bluetooth audio adds
   150–300 ms, so offset by output device type automatically, with a fine-tune slider.
2. **Contrast.** Still most of the time, so big moments land. Strength is normalized over the
   whole film, not per sound.
3. **Layers.** *Bed* (engines, rumble, bass weight) + *hits* (impacts, shots) + *rhythm*
   (heartbeat, giant footsteps). Duck the bed ~30 ms before a hit (side-chain).
4. **Believability.** Bright/sharp -> short pulse (~30 ms). Dull/heavy -> longer pulse with a
   decay tail. Distant -> softer and blunter.
5. **Restraint.** Nothing on speech, most music, ambience.
6. **Comfort.** Vary long beds slightly (skin adapts to constant vibration), cap continuous
   run time, never go below the device's felt floor.

## 3.2 Architecture: listen -> direct -> perform

```
 PRODUCERS                         CONTRACT                 CONSUMERS
 Listener (Kotlin DSP)   ──┐
   bass energy / LFE,      │    ┌──────────────────┐     Performer (Kotlin)
   onsets, brightness      ├──▶ │  HAPTIC TRACK    │ ──▶   scheduler: ExoPlayer clock,
 Subtitle meaning (labels) │    │  bed lane        │       pause/seek/rate/delay/offset
   [explosion], [♪]      ──┘    │  event lane      │       renderer: calibrated, per device
          │                     └──────────────────┘     Haptics Lab (dev screen)
          └──── Director (whole-film decisions) ──┘        timeline, history readout
```

- **The haptic track is the contract.** Device-independent units: intensity 0..1 and
  sharpness 0..1 (Apple's AHAP model).
  - *Bed lane:* fixed 100 Hz frames of (intensity, sharpness).
  - *Event lane:* (time ms, intensity, sharpness, length/decay hint, source flags).
  - Header: format version, analyzer version, file fingerprint (path + size + mtime).
  - Cached per file. Exact format is frozen in Phase 1.
- **Listener:** analyses audio only, knows nothing about vibration.
- **Director:** sees the whole film; decides what is felt and how strong relative to the
  film's peak. This is where immersion comes from.
- **Performer:** knows nothing about where events came from. Renders through one universal
  method (amplitude waveforms + short amplitude pulses, works API 26+). Prebaked effects,
  primitives and Android 16 envelopes are optional upgrades **only** where calibration shows
  they're better. Uses `USAGE_MEDIA`.
- **Calibration:** test the motor, don't trust flags. Find felt floor, response curve, and
  whether amplitude works. Accelerometer self-measurement is a candidate (Phase 0).

## 3.3 Rules for the work

1. Nothing gets built that a later phase rewrites. If unsure, answer it in Phase 0 first.
2. No fixes to code scheduled for deletion.
3. Every phase ends on a measured exit test. A regression on the automatic test set fails the phase.
4. **No hand-made data.** Ground truth is generated by script or already exists in the media.
   The user's only role is an optional blind A/B pick (a few taps per phase).
5. The app has two users and isn't public: replace outright, no parallel old/new engine.

---

# Part 4 — Automatic benchmark

| Question | Ground truth |
|---|---|
| Are hits on time? | **Scripted mixes:** ffmpeg drops known impacts/explosions/engines into real dialogue and music at script-chosen times (exact to the ms). |
| Does the bed follow the bass? | 5.1 films: the **LFE channel**, compared against our output from a stereo downmix. |
| Quiet during speech? | Plain subtitle dialogue lines: any haptic there without a sound tag is a false positive. |
| Quiet during music? | `[♪]` cues in SDH. |
| Right moments chosen? | SDH sound tags confirm an event exists nearby. |
| Did the phone play what we meant? | System vibration history vs the intended track. |

Scores: onset F1, timing error p50/p95 (ms), false positives per minute (speech, music), bed
correlation with LFE, haptic-active share of runtime, scheduler error p95, intended-vs-played match.

---

# Part 5 — Phases

### Phase 0 — Haptics Lab (permanent dev screen, hidden entry in Settings)

| Test | Answers |
|---|---|
| L1 Seams | Do back-to-back `vibrate()` calls (windows of 100/250/500 ms) leave a felt or logged gap in a continuous bed? Decides how the renderer slices time. |
| L2 Decode speed | Media3 extractor + `FfmpegAudioDecoder` over a full film's audio, background thread: x realtime, memory, battery. Also AAC via MediaCodec. |
| L3 HapticGenerator | Attach to the player's audio session with haptic channels unmuted. Does the motor respond? If yes, it becomes the A/B baseline. If no, drop for good. |
| L4 Live tap timing | Can a pass-through `AudioProcessor` after `AudioDelayProcessor` map buffers to play time, and how far ahead of the speaker does it run? Only needed for network streams. |
| L5 Self-calibration | Does the accelerometer register our own vibration well enough to measure floor and response curve automatically? |
| L6 History readout | Parse `dumpsys vibrator_manager` (via adb in scripts) to compare intended vs played. |

**Exit:** `docs/haptics-decisions.md` with every answer and the resulting decisions.

### Phase 1 — Contract and test harness
Freeze the track format. Script the generated test clips (clicks, sub-bass hits, sweeps,
speech-only, music-only, 5.1 with LFE, silence) and the scripted-mix generator. JVM harness
that scores any producer.
**Exit:** harness runs and correctly fails an empty producer.

### Phase 2 — Performer
Native scheduler (ExoPlayer is main-looper bound: sample position + clock there, schedule
on a dedicated thread) + renderer + calibration + auto Bluetooth offset. Delete the old engine
(Part 1.1). Subtitle display keeps working. Proven with tracks generated from the scripted mixes.
**Exit:** scheduler error p95 ≤ 10 ms; zero haptics while paused or after seek; vibration
history matches the intended track.

### Phase 3 — Listener
Pure-Kotlin DSP (no Android deps, runs in JVM tests): low-band energy or LFE, onsets,
spectral centroid. Background decode ahead of the playhead, per-file cache.
**Exit:** onset F1 ≥ 0.9 and timing p50 ≤ 10 ms on the test clips; analysis stays ahead of playback.

### Phase 4 — Director
Layers, ducking, restraint, whole-film normalization, comfort limits.
**Exit:** ≤ 1 false haptic/min on speech-only; haptic-active share ≤ ~15% of runtime (tunable);
bed correlates with LFE on 5.1 films.

### Phase 5 — Meaning
Subtitle labels rewritten as data; fused with audio (snap to the real onset within ±1 s,
set character, confirm importance; `[♪]` lowers the bed).
**Exit:** beats audio-only on every score, plus optional blind A/B against the HapticGenerator baseline.

### Phase 6 — Personal and polish
Presets (Subtle / Cinematic / Intense = restraint and contrast, not just gain), analysis
progress UI, onboarding copy, live analysis for streams if wanted.
**Exit:** both users prefer it in blind A/B over every baseline.

---

# Part 6 — Risks

- **Seams (L1).** One vibration at a time; if call boundaries are felt, the renderer must cut at natural gaps.
- **Bluetooth latency varies by headset.** Auto offset by device type plus a slider.
- **Decode cost on slower phones (L2).** Live tap (L4) is the fallback.
- **Single reference phone.** Results may not hold on other motors; calibration exists for that reason.
