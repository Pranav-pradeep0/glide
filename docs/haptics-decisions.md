# Haptics engine — Phase 0 decisions

**Measured:** 2026-10-11, Nothing Phone (2) `AIN065`, Android 16 (API 36).
**Plan:** `docs/haptics-engine-plan.md`. This file is the Phase 0 exit.

**How to repeat any of it:** Settings › tap *Version* seven times opens the Haptics Lab. Each
test saves a CSV on the phone; `node scripts/haptics-lab.js pull` fetches them and
`seams | calib | tap | motion <csv>` scores them. `history <seconds> <out.json>` is L6.
`node scripts/haptics-lab.js check` tests the history parser.

---

## Decisions at a glance

| # | Question | Answer | Decision |
|---|---|---|---|
| L1 | Do back-to-back calls leave a gap? | **Yes, at every call.** A 40–80 ms dip each time; felt even at 500 ms slices | One waveform call per continuous stretch. New calls only at natural gaps, hits, pause, seek |
| L2 | Can we decode a whole film in the background? | **Yes.** 68–255× realtime, ~30 MB, ~3–7 mAh per film | Analyse the whole film ahead of time; live tap is not the main path |
| L3 | Does HapticGenerator drive the motor? | **No.** Not loaded by the vendor effects config | Dropped for good. A/B baselines: "off" and the old engine only |
| L4 | Can an audio tap map buffers to play time? | **Yes, exactly.** Runs ~654 ms ahead of the speaker, ±20 ms | Keep for network streams (Phase 6); not needed for local files |
| L5 | Can the accelerometer measure our own vibration? | **Yes, on a table.** Monotonic, repeatable curve; hand damps it 3.5× | Calibration runs with the phone flat on a table |
| L6 | Can scripts read what the system played? | **Yes**, by polling every 300 ms | Trust history for *what* played (amplitudes, steps, status, start); use the accelerometer for *when* it stopped |

---

## L1 — Seams

**Test.** A 3 s bed at amplitude 128 (50%) as one call, then sliced into back-to-back calls of
500, 250 and 100 ms, then the same slices each 50 ms longer, so every call cancels the one before it.
Phone on a table, then in the hand.

**Measured.**

```
bed                          p5   p50  below 50%  envelope, first 1.2 s (20 ms bins)
one 3000 ms call             1.01 1.11  0.0%      |#%%%%%%%%%%%%#######################|
500 ms calls                 0.63 1.06  2.4%      |**####################*=+**#########|
250 ms calls                 0.26 1.01 10.5%      |**########*++*#########*-=***#######|
100 ms calls                 0.23 0.75 24.9%      |***-:+****=::=+**++*###+=**#*=:++**=|
500 ms, overlapped by 50     0.38 1.08  7.8%      |*#####################%##+.-+*######|
100 ms, overlapped by 50     0.12 0.82 29.5%      |*#%%#+:...-+*####*-=*####*-:..:=*###|
```

(Levels are relative to the single call's plateau.) Every new call stops the motor and spins it
up again, which shows as a dip of 40–80 ms. Overlapping the calls doesn't help; it's slightly
worse. Scheduling was not the cause: calls went out within 0.7 ms of their target (p95).

**Felt (user, phone in hand):** the first slicing that felt bumpy was **500 ms**, the longest one tested.

**Decision.**
- The renderer never slices a continuous bed into fixed time windows. Each continuous stretch of
  the track is **one waveform call**. A new call starts only where the track already has a gap,
  at a hit, or on pause, seek or a rate change.
- This only works because the track is known ahead of time (L2). The Performer reads the bed lane
  ahead and builds long waveforms.
- Amplitude changes within one call are fine: they are steps of a single waveform.

## L2 — Decode speed

**Test.** The whole first audio track of three films, through the same Media3 extractor and
decoders subtitle sync uses (`SubtitleSyncModule.decodeAudio`, now shared through `PcmSink`), on
the background lane. Each sample is touched, as analysis would.

| Film | Codec | Decoder | Length | Wall time | Speed | CPU | Peak memory (Java / native) |
|---|---|---|---|---|---|---|---|
| Blast (2026) | E-AC-3 5.1 | FFmpeg | 2 h 22 min | 33 s | **255×** | 39.5 s | 29 / 3 MB |
| Frankenstein (2025) | E-AC-3 5.1 (×2 tracks) | FFmpeg | 2 h 32 min | 37 s | **249×** | 43.5 s | 26 / 1.6 MB |
| Us (2019) | AAC 5.1 | `c2.android.aac.decoder` (software) | 1 h 56 min | 103 s | **68×** | 90.6 s | 26 / 6 MB |

Battery (batterystats with the phone marked as unplugged): 16.5 mAh of CPU for all four runs, so
**~3 mAh per E-AC-3 film and ~7 mAh for AAC**. That's 0.07–0.15% of the 4,700 mAh battery. These
are model estimates, not readings from the battery itself.

**Findings.**
- FFmpeg decodes on its own `ExoPlayer:SimpleDecoder` thread at **normal priority** (nice 0), not
  on our background lane (nice 10). Analysis running during playback would compete with the player.
- *Blast*'s extractor throws `No valid varint length mask found` on junk after the last
  cluster, at 8,495.07 s of 8,495.55 s. Everything before it decoded.
- AAC on this phone goes through Google's software Codec2 decoder and is about 4× slower than
  FFmpeg on E-AC-3. The plan's "hardware audio decoders" list (Part 2) needs that correction.

**Decision.**
- Phase 3 analyses **the whole film in the background**, starting when the film opens with
  haptics on, and caches the result per file. Even the slowest case finishes in under 2 minutes.
- Haptics start once analysis has passed the playhead. The Performer plays only what is analysed.
- An extractor error after more than 99% of the duration counts as end of file. Keep what was decoded.
- Phase 3 must lower the decoder thread's priority, or pause analysis while the player is
  buffering. Measure the cost to playback in Phase 3 before choosing.

## L3 — HapticGenerator

**Test.** A bare player like the real one, with haptic channels unmuted
(`AudioAttributes.setHapticChannelsMuted(false)`) and `HapticGenerator` attached to its audio
session, playing *Frankenstein* from 10:00 for 20 s with the phone on a table.

**Measured.**
- `HapticGenerator.isAvailable()` = **false**. No effect was created.
- `dumpsys media.audio_flinger` during playback: our track ran on an ordinary output thread whose
  only effect chain was the system's Dirac effect. The `haptic-A` output stayed in standby with
  0 frames written.
- The active effects config is `/vendor/etc/audio/sku_cape/audio_effects.xml`, which does not
  mention haptics. The `/system/etc/audio_effects.xml` the plan cites isn't the one in use.
  `VibrationConfig.hapticChannelMaxAmplitude = 0.0`.
- Accelerometer: no motion. While playing, the 99th-percentile level was 0.059, below the quiet
  baseline's 0.14.

**Decision.** Dropped for good on this phone. The Phase 5/6 A/B baselines are "haptics off" and the
old engine. The Lab keeps no HapticGenerator code.

## L4 — Live tap timing

**Test.** A pass-through `AudioProcessor` after `AudioDelayProcessor`. It computes each buffer's
media time as `StreamMetadata.positionOffsetUs + framesSinceFlush / rate` and compares it with the
player's position, polled every 10 ms. *Frankenstein*, 6ch 48 kHz, phone speaker.

**Measured.**
- `positionOffsetUs` is the media time after a flush: 600,000,000 µs when starting at 10:00. The
  mapping needs no guessing.
- Buffers pass the tap every ~36 ms.
- The tap runs ahead of the speaker by **654 ms (p50)**, 636–673 ms (p5–p95), 629–681 ms (min–max).

**Decision.**
- A live tap works and gives ~650 ms of look-ahead, plenty for onset detection. It is the path for
  **network streams only**, in Phase 6 if wanted. Local files use whole-film analysis (L2).
- Nothing in Phases 1–5 depends on it.

## L5 — Self-calibration

**Test.** 500 ms holds at 13 amplitudes, played twice, then single full-strength pulses of
5–80 ms. Accelerometer at 426 Hz (`HIGH_SAMPLING_RATE_SENSORS`). Phone flat on a table.

**Response curve (accelerometer, m/s² RMS; quiet noise 0.030):**

| Amp | % | Level | × noise | Pass A | Pass B |
|---|---|---|---|---|---|
| 3 | 1 | 0.032 | 1.06 | 0.030 | 0.032 |
| 8 | 3 | 0.032 | 1.07 | 0.026 | 0.032 |
| 15 | 6 | 0.035 | 1.18 | 0.034 | 0.035 |
| 23 | 9 | 0.043 | 1.46 | 0.038 | 0.043 |
| 31 | 12 | 0.066 | 2.2 | 0.056 | 0.066 |
| 46 | 18 | 0.117 | 3.9 | 0.109 | 0.117 |
| 64 | 25 | 0.233 | 7.9 | 0.218 | 0.233 |
| 96 | 38 | 0.515 | 17 | 0.454 | 0.515 |
| 128 | 50 | 0.691 | 23 | 0.691 | 0.686 |
| 160 | 63 | 0.784 | 26 | 0.723 | 0.784 |
| 192 | 75 | 0.863 | 29 | 0.796 | 0.863 |
| 224 | 88 | 0.924 | 31 | 0.873 | 0.924 |
| 255 | 100 | 0.936 | 32 | 0.894 | 0.936 |

**Findings.**
- Amplitude really works, as the plan found by feel. History shows the requested amplitudes passed
  through unchanged (0.01 … 1.00), despite the missing `AMPLITUDE_CONTROL` flag.
- The curve is steep in the middle and flat at the top: 50% → 100% adds only 35% more motion.
  Most of the usable range is **~6% to ~50%**.
- The accelerometer first clearly picks up the motor at ~9–12%. The felt floor (from the plan's
  feel test) is ~6%. The sensor is a little less sensitive than skin but agrees on the shape.
- **Short pulses don't reach full strength.** 5–30 ms pulses all peak at ~25–40% of a full hold
  and last ~25 ms. 50 ms reaches ~60%, 80 ms ~100%. The motor needs ~80 ms to spin up.
- **Start latency** (call → 50% of peak motion): ~30–40 ms for `createOneShot`, ~60–80 ms for
  `createWaveform`. Full-strength holds reach 90% after ~85 ms.
- In the hand, measured motion is ~3.5× weaker and noise ~2× higher, so low amplitudes are lost
  in noise.

**Decision.**
- Calibration (Phase 2) is automatic, with the phone flat on a table. It measures the response
  curve, the floor (first level clearly above noise, adjusted down to the felt floor by the margin
  seen here), and the start latency. Defaults for phones never calibrated: this table.
- Renderer intensity 0..1 maps through the **inverse of the measured curve**, so equal intensity
  steps give equal motion steps. Intensity > 0 never goes below the floor.
- With no frequency control, a hit's character comes from its **length**: sharp/light ≈ 20–30 ms,
  heavy ≈ 60–80 ms with a decay tail. Phase 4 tunes the exact mapping.
- The Performer issues each call early by the measured start latency for its kind (one-shot vs
  waveform). On this phone that offset (35–70 ms) is larger than the 20 ms sync target, so it
  can't be skipped.

## L6 — History readout

**Test.** `node scripts/haptics-lab.js history`. Poll `dumpsys vibrator_manager` every 300 ms,
keep rows for `com.glide.app` from *Recent vibrations*, drop duplicates and parse them.

**Measured.**
- The ring keeps ~20 rows per usage, and one L1 run makes ~100 calls. Polling caught **122 rows**
  over that run, statuses `finished 29, cancelled_superseded 91, cancelled_by_user 2`.
- Rows show usage (`MEDIA`), status, start time, and every played step with its amplitude.
- The logged **duration and end time run ~100 ms late**. A 500 ms hold logs as ~613 ms while the
  accelerometer sees ~490–530 ms of motion. The start time is fine.
- A 3,000 ms waveform of 300 × 10 ms steps vibrated for ~3.29 s on the accelerometer. Long
  waveforms of short steps run about 10% slow. This is a single measurement; Phase 2 confirms it.

**Decision.**
- The Phase 2 exit test "history matches the intended track" compares **what played**: count,
  amplitude per step, status, and start time to the ms.
- Duration and timing are checked against the accelerometer, never the history's end time.
- The renderer uses the longest steps the content allows: equal neighbouring steps merged into
  one. It re-anchors to the player clock at every new call instead of trusting a long waveform's
  timing. Phase 2 measures the drift per step length and corrects for it.

---

## Corrections to the plan (Part 2)

- **HapticGenerator:** not "unproven". It isn't loaded at all (vendor config `sku_cape`).
- **Audio decoders:** AAC decoding is software (`c2.android.aac.decoder`), not hardware.
- **Best hit:** a 30 ms pulse reaches only ~25–40% of full motion. 30 ms *feeling* like THUD
  fits that: both are short and soft. Heavy hits need ~60–80 ms.
- **Latency:** missing from the plan. 30–80 ms from call to motion, depending on the call type.

## Code left by Phase 0

- `android/.../haptic/HapticsLabModule.kt`: the Lab's native side (L1, L2, L4, L5), native API level 10.
- `src/screens/HapticsLabScreen.tsx`: the hidden screen (Settings › Version ×7).
- `scripts/haptics-lab.js`: pull, score, history readout, parser check.
- `SubtitleSyncModule.decodeAudio` + `PcmSink`: the decode pipeline, shared. Phase 3's Listener
  is a `PcmSink`.
- Manifest: `HIGH_SAMPLING_RATE_SENSORS` (normal permission, no prompt) for 426 Hz accelerometer
  readings.

---

## Phase 2 — Performer (2026-10-12)

**Exit test.** `node scripts/haptics-lab.js perform mix1` with the Lab open. It plays the scripted mix
`mix1.mkv` in the real player with the track its truth file describes (Lab › Performer test). It pauses,
resumes and swipe-seeks, then compares the Performer's log with the system vibration history.

| Check | Target | Measured |
|---|---|---|
| Call time vs the settled player clock, p95 | ≤ 10 ms | **5 ms** (max 5) |
| Every call in the history, steps and amplitudes as intended | all | 11 of 11 |
| Vibrations nobody called | 0 | 0 |
| Haptics while paused | 0 | 0 over 18 pauses |
| Stale haptics after a seek | 0 | 0 over 9 seeks |

**Findings.**
- **The clock settles before it can be trusted.** Right after a start, resume or seek, ExoPlayer's
  position runs 100–230 ms off until the audio system reports timestamps. The Performer schedules
  nothing until three clock samples in a row agree within 20 ms. With video that takes under a
  second. Audio-only output stays coarse (250 ms steps) for ~3 s, so the phone test uses a clip
  with a video track.
- Each clock sample jitters by a few ms. Once settled, small differences nudge the anchor a
  quarter of the way instead of replacing it.
- **Bluetooth.** The Performer follows the player's position, the clock video is lip-synced to,
  so output latency is already in it. No offset table by device type. To confirm by feel with
  Bluetooth headphones; a fine-tune slider stays a Phase 6 item.
- A call can be refused by the system for a more important vibration (a notification). It shows as
  `ignored_for_higher_importance`; correct behaviour, counted separately by the script.
- Calibration (Lab › L5) now saves this phone's curve, floor and latency. On the Phase 0 recording it
  reproduces the L5 table exactly; measured waveform latency is **62 ms**, the default for
  uncalibrated phones.

**Until Phase 3**, real films have no track, so "Play with haptics" is silent on them. The strength
slider in Settings changes nothing until the Phase 6 presets.

## Phase 3 — Listener (2026-10-16)

**Exit test.** JVM: `HapticListenerTest` scores the Listener against the scripted fixtures' truth.
Phone: `node scripts/haptics-lab.js listen <mix1|path> <seconds>` with the Lab open (Lab › Listener
test). It plays the file twice, first while it is analysed, then from the cache, and reads the log.

| Check | Target | Measured |
|---|---|---|
| Hit F1, clicks / subbass (JVM) | ≥ 0.9 | **0.964 / 1.000** |
| Hit F1, mix1 / mix2 / mix3 (JVM) | ≥ 0.9 | **0.947 / 0.970 / 0.978** |
| Hit timing p50 (JVM) | ≤ 10 ms | 0–2 ms |
| False hits per minute, speech / music (JVM) | 0 | 0 / 0 |
| Hits on the phone match the PC (mix1) | same | F1 0.947, p50 1 ms |
| Analysis passes the playhead after play starts | ≤ 1 s | 0.57–0.71 s |
| Analysis stays ahead of the playhead | always | mix1, Us, Blast: all samples |
| Dropped video frames while analysing | 0 | 0 (mix1, Us, Blast) |
| Whole film analysed and cached | yes | Us 116.5 min in 126 s; Blast 141.6 min in 31 s |
| Second play uses the cache | yes | mix1, Us, Blast |

Still failing: haptics during speech from the bed. That is Phase 4.

**Findings.**
- **Weight rule.** A sudden loud jump only counts as a hit if it has weight: ≥ 15% of the attack's
  energy below 100 Hz, or it stands 25 dB over a scene heard for ≥ 1.5 s. This keeps sharp
  speech and music sounds out: 0 false hits per minute on both.
- **Priority is inherited.** The analysis thread runs at `Thread.MIN_PRIORITY` (nice 19). FFmpeg's
  decode thread is started from it and inherits that, so Dolby audio (Blast, 275x realtime) decodes
  at the lowest priority with no extra code.
- **AAC decodes outside the app.** Android decodes AAC in its own codec process (Us, 55–70x
  realtime), so our priority doesn't reach it. Playback still dropped no frames.
- **Leaving the player no longer cancels the analysis.** It keeps going and caches. Reopening the
  same file picks up the running analysis (Us: play 2 joined it and finished it). Opening another
  file cancels it. One analysis runs app-wide.
- **Catching up after a jump.** After a resume or a seek inside the analysed part, the wait is
  0 ms. A jump past it waits until the decode gets there (Us: 14 s for a jump to 21:22 early in the
  analysis). Hits start there; nothing goes wrong before.
- An extractor error in the last 1% (Blast) counts as done, and the track is cached.
  `analyzerVersion 0` marks tracks imported from Lab truth; the Listener never overwrites them.
- Hit rate differs a lot by film: Us 5.7 per minute, Blast 1.5 per minute. To check by feel in the
  Phase 4 A/B.

## Phase 4 — Director (2026-10-16)

**Exit test.** JVM, no phone: `HapticFilmTest` decodes each film in `.haptics-fixtures/films/`
(audio and subtitles taken from the phone's copies; not in git) with ffmpeg, as the phone hands it
over, and scores Listener → Director. `HapticListenerTest.directedPassesTheClips` runs the same
pipeline on every generated clip. Us and Blast were tuned on; Frankenstein and Together were held
out until the numbers were set.

| Check | Target | Us | Blast | Frankenstein | Together |
|---|---|---|---|---|---|
| Share of the runtime with anything felt | ≤ 15% | 5.7% | 13.6% | 6.0% | 6.1% |
| Hits during plain dialogue (subtitle lines with no sound tag) | ≤ 1/min | 0.61 | 0.96 | 0.42 | 0.43 |
| Bed vs what a 5.1 subwoofer plays (Pearson, 100 ms) | ≥ 0.5 | 0.78 | 0.74 | 0.76 | 0.73 |
| Bed vs the LFE channel alone (for reference) | — | 0.62 | 0.68 | 0.62 | 0.45 |
| Every generated clip, full pipeline | all pass | | | | |

Phone: `listen mix1` hits still match the PC (F1 0.947, p50 1 ms). Us re-analysed with 0 dropped
frames; the Director takes ≤ 51 ms per update on a whole 2 h film, on the analysis thread.

**Findings.**
- **The bed was mostly faint bass, not rumble.** Before the Director it ran 24–33% of a film. Two
  fixes. The Listener now fades the bed by the share of the sound that is below 100 Hz over 200 ms
  (none at ≤ 15%, full from 30%). Speech and music carry under 12% there, rumble and engines 25–90%,
  so a loud scene with dialogue no longer reads as bass. Listener VERSION 2.
- **Restraint is relative to the film.** The bed plays only within 10 dB of the film's own loud bass
  (99th percentile), hits only within 9 dB of its loud hits (95th); both are rescaled so the
  film's loud moments are full strength. Dialogue hits are the quiet ones (median 0.09–0.15 vs
  0.19–0.30), so the same gate quiets dialogue.
- **Gate on 100 ms of power, not 10 ms frames.** Low tones beat 10–20 times a second, so a frame-by-
  frame gate chopped rumbles into pieces (lfe51 coverage fell to 64%). A gate that holds open
  stretched every bass blip instead (Blast 22%). Judging the gate and the reference on power
  averaged over 100 ms fixed both. An open bed follows down to 6 dB below the gate.
- **The LFE alone is the wrong yardstick.** Together's mixer kept its bass in the front channels:
  60% of its bed time had a silent LFE, with the same spectrum as its LFE moments, during intense
  scenes. On a real system that bass goes to the subwoofer (bass management: every channel below
  ~100 Hz, plus the LFE at +10 dB). Scored against that, all four films agree (0.73–0.78).
- **The cache holds the raw track.** The Director runs on every publish, so tuning it never
  re-analyses a film. While a film is being analysed, its levels come from the part heard so far.
- **Known gap, for Phase 5.** Non-dialogue voice sounds with bass in the centre channel (grunts,
  heavy breathing) can drive the bed: ~35 s of 152 min in Frankenstein, the worst case. SDH tags
  them ("[grunting]"), which is where Phase 5 can quiet them.
- **No ducking needed.** The renderer plays the louder of bed and hit, so a hit no stronger than the
  bed under it would be lost. Measured: 0–2 hits per film (≤ 1.3%), printed by `HapticFilmTest`.
  Comfort limits weren't needed to meet the targets either; left for the Phase 6 presets if long
  scenes feel tiring.

## Phase 5 — Meaning (2026-10-16)

**Exit test.** JVM: `HapticFilmTest` scores each film twice, audio only and with its SDH tags, and
every score with tags must beat or match audio only and still meet the Phase 4 targets.
`HapticMeaningTest` checks the tag rules on their own. Each film's raw track is cached beside it
(`<name>.raw`), so a Director change reruns in ~15 s. Us and Frankenstein were tuned on, Together
held out; Blast's subtitles have no tags, so it is the no-subtitle check.

| Score (audio only → with tags) | Us | Frankenstein | Together | Blast |
|---|---|---|---|---|
| Tagged hits felt (a hit within ±1 s of a hit tag) | 0.32 → **0.54** | 0.25 → **0.48** | 0.44 → **0.50** | no tags |
| Untagged hits per minute under ♪ | 3.8 → **0** | 5.2 → **0** | 3.0 → **0** | |
| Bed under ♪ (mean strength) | 0.13 → **0.07** | 0.05 → **0.03** | 0.04 → **0.02** | |
| Loud LFE under ♪ / voice tags still felt | same | same | same | |
| Hits during plain dialogue, per minute (≤ 1) | 0.61 = | 0.42 = | 0.43 = | 0.999 = |
| Subwoofer correlation outside ♪ (≥ 0.5) | 0.755 = | 0.758 = | 0.734 = | 0.740 = |
| Share of the runtime felt (≤ 15%) | 5.7% = | 6.0% = | 6.0% = | 13.6% = |

Phone: `listen mix1` still matches the PC (F1 0.947, p50 1 ms). Frankenstein from its detail page:
504 tags reach the Director, ≤ 37 ms per update on the whole film. Blast with no subtitles: 0 tags,
the same 160 hits as audio only.

**Findings.**
- **Tags as data.** `HapticMeaning` reads tags by keyword: sharp hits ([gunshot], [knock]), heavy
  hits ([explosion], [thud], [thunder]), music (♪, [tense music playing]), voice ([grunting]).
  Anything else in brackets is dropped, which removes speaker names ([VICTOR]) without a list. The
  cues come from the SDH subtitle the detail page already finds (`hapticCues`, the old engine's
  detection), sent to native as a player prop; only cues with a bracket or ♪ cross the bridge.
- **Most tagged sounds had no hit to snap to.** Only 26–83% of hit tags had a Listener onset within
  ±1 s: the weight rule (Phase 3) drops bright sounds to keep speech out. The Listener now keeps
  those as **light** onsets (`HapticTrack.LIGHT`, VERSION 3); the Director plays one only where a
  hit tag names it. Untagged films get exactly the Phase 4 track.
- **A tag keeps the loudest onset near it** (the Director's, or one below its gate, or a light one)
  and sets its character: sharp 0.8 (40 ms, short tail), heavy 0.1 (75 ms, long tail). A light
  onset more than 200 ms before its cue is the line before: every rescue that landed in dialogue
  was one (−250 to −830 ms).
- **Music: the bed is halved, not gated.** The bed under ♪ follows the LFE (93% of loud-LFE moments
  in Us are felt): the mixer sent that bass to the subwoofer. A stricter gate removed 15–50% of
  them. Halving keeps every one, lighter. Hits under ♪ are dropped unless a tag names them.
- **The subwoofer yardstick is wrong under ♪,** as the LFE alone was in Phase 4: it counts a song's
  bass as wanted. Its correlation is now judged outside ♪ spans; under them the check is that
  loud-LFE moments are still felt (decided with the user).
- **Voice tags change nothing.** Under them, bass with a quiet LFE (centre-channel grunts, Phase 4's
  gap) is felt 1–6% of the time; bass with a loud LFE (effects under a scream) 80–86%. Both sit
  at similar levels, so every rule tried took more effect bass than grunts: a 5 dB stricter gate
  under voice cut loud-LFE moments by 30–70%. A bed without the centre channel halved Frankenstein's
  grunts (~10 s) but raised Blast's active share to 19%. Left as is.
- **Not done:** subtitle delay isn't applied to the tags (the ±1 s snap absorbs small offsets), and
  embedded SDH tracks only reach haptics if the detail page's detection extracts them, as before.
- **A/B baseline:** HapticGenerator was dropped in L3 (the motor doesn't respond), so the optional
  blind A/B is audio only vs with tags.

## Sound first, SDH as an enhancer (2026-10-17)

"Play with haptics" starts at once. The SDH search (embedded tracks, files beside the video, then
online) moved from the detail page into the player (`usePlayerTracks`) and runs in the background;
its cues reach native whenever it finishes, and the performer re-directs the track already playing.
The picker sheet, the "Looking for subtitles" caption and "Play without them" are gone.

- **Which subtitle shapes haptics.** Found automatically (background search, an embedded track
  loaded at start), the one with more tagged cues wins, so a plain track with a few
  [speaking Spanish] lines can't push out the SDH. A subtitle the user picks wins if it has any tag
  (decided with the user; HapticMeaning ignores the rest).
- **Remembered** in memory for the last 10 videos, so a second play directs with the tags at once.
- **Phone:** Frankenstein `direct tags=0` at open, `tags=504` 8 s later, sync error within ±10 ms
  meanwhile; played again, `tags=504` on the first direct. Blast: no sheet, `tags=0` throughout (its
  `varint` error is the known junk after the last cluster, L2).

## Phase 6 — Presets (2026-10-17)

**Presets** (`HapticDirector.Preset`). Restraint is how close to the film's own loud moments a
sound must be to be felt (the bed and hit ranges); contrast is how soft the softest felt hit may be
and how heavy the bed is under the hits. The old 1-255 strength (ignored by native since Phase 2)
is gone, with its slider, chips and test buzz; strength is now its own setting (below).

| | bed range | hit range | softest hit | bed |
|---|---|---|---|---|
| Subtle | 7 dB | 6 dB | 0.25 | × 0.6 |
| Cinematic (= Phases 4-5) | 10 dB | 9 dB | 0.25 | × 1 |
| Intense | 13 dB | 12 dB | 0.40 | × 1 |

**Exit test.** `HapticFilmTest` scores each preset with the film's tags; Cinematic's column is the
Phase 5 "fused" column unchanged, and active share and hits must rise Subtle < Cinematic < Intense.

| Subtle / Cinematic / Intense | Us | Frankenstein | Together | Blast |
|---|---|---|---|---|
| Share of the runtime felt (≤ 15%) | 3.3 / 5.7 / 9.0% | 3.1 / 6.0 / 9.2% | 3.0 / 6.0 / 9.9% | 6.6 / 13.6 / **21.4%** |
| Hits | 182 / 275 / 347 | 173 / 228 / 311 | 54 / 73 / 100 | 104 / 160 / 179 |
| Mean hit strength | 0.67 / 0.63 / 0.72 | 0.65 / 0.65 / 0.70 | 0.68 / 0.67 / 0.71 | 0.68 / 0.64 / 0.75 |
| Hits during plain dialogue, per min (≤ 1) | 0.20 / 0.61 / 0.89 | 0.13 / 0.42 / **1.03** | 0.36 / 0.43 / 0.53 | 0.31 / 1.00 / **1.11** |
| Subwoofer correlation (≥ 0.5) | 0.71 / 0.76 / 0.78 | 0.72 / 0.76 / 0.77 | 0.66 / 0.73 / 0.77 | 0.60 / 0.74 / 0.82 |
| Longest unbroken felt run | 7 / 33 / 33 s | 3 / 6 / 16 s | 13 / 16 / 34 s | 5 / 6 / 11 s |

**Strength.** On the phone every preset felt far too strong: the Director rescales each film's
loud moments to full motor motion, and no preset lowered that. A per-preset ceiling was tried
first (55 / 80 / 100% of motion): Cinematic and Intense felt the same, since this motor's motion
flattens at the top (amplitude 160 → 255 adds ~20% motion, ~2 dB). So strength became one
slider, like volume:
- **dB scale.** `HapticDirector.strength()` maps slider 0..1 onto 30 dB of motion, applied by
  the Director after everything else, so felt share and hits don't change with it. A linear
  scale left the bottom stop (10%) peaking near amplitude 47, well above the felt floor (15).
- **Presets are stops on it:** Subtle 35%, Cinematic 60% (default, ~25% motion), Intense 100%.
  Only the slider position is saved; the preset played is the nearest stop (`hapticPresetAt`),
  so chips and slider can't disagree. Tapping a chip moves the slider there.
- **Floor 10%, no 0%:** off is the Haptics toggle. 10% peaks just over the felt floor.
- **Live,** like a preset: each change re-directs (~50 ms, off the haptics thread) and reaches
  the next vibration call; a long unbroken rumble keeps the old strength until it ends.

The film test runs at strength 1, so its tables above are unchanged.

**Findings.**
- **Intense breaks two Phase 4 targets, left as is:** Blast is felt 21% of its runtime, and Blast
  and Frankenstein get just over 1 dialogue hit a minute. Those targets define Cinematic; Intense is
  the user asking for more. Shown as `over` by the test, not failed.
- **Tagged hits felt is the same in every preset:** a tag keeps its onset whatever the gate.
- **Comfort limits not added.** Long unbroken runs already exist in Cinematic (Us 33 s); Intense
  doubles Together's to 34 s. A cap waits for a report that long scenes tire.
- **A preset change re-directs the track playing,** like new tags: the cache holds the raw track,
  so it costs one Director pass. The player prop `hapticPreset` reaches `HapticPerformer.setPreset`.
- **Copy.** Settings › Haptic feedback reads "Rumbles with loud scenes and deep sounds"; the
  presets say "Fewer, lighter / Default / More, stronger". A one-time note on the first play
  (and a "Feel what you hear" line) was tried and dropped: plain words for what the user feels
  beat explaining the engine. The native Alert dialogs were replaced by the app's own
  (`showDialog`, `DialogHost`) on the way.

## Flickers (2026-10-19)

**Report:** "vibrates for everything", including studio logos; misses glass and engine revs.

**Measured** (`HapticFilmTest`, new row *felt moments/min*: felt stretches, gaps under 300 ms joined).
47–67% of everything felt was a bed burst under 300 ms with no hit: bass notes and gusts brushing the
gate, 2–10 a minute. *Active share* can't see them; they are short.

**Fix.** The Director drops a bed burst under 300 ms whose 100 ms level stays within 3 dB of the gate
and that holds no hit. It runs before tags, so a flicker is the same with or without subtitles (run
after them, music's halved bed read as faint and failed the audio-vs-tags check).

| Cinematic, with tags | Us | Frankenstein | Together | Blast |
|---|---|---|---|---|
| Felt moments/min | 7.5 → **5.6** | 4.3 → **3.1** | 5.6 → **2.5** | 15.1 → **8.8** |
| Subwoofer correlation (≥ 0.5) | 0.755 → 0.737 | 0.758 → 0.747 | 0.734 → 0.713 | 0.740 → 0.703 |
| Loud LFE felt under voice tags | 0.80 → 0.76 | 0.86 → 0.82 | 0.85 → 0.78 | no tags |
| Tagged hits felt | same | same | same | |

Dropping every short burst (no 3 dB rule) took moments/min lower (Blast 5.8) but lost loud-LFE
thumps (Us under voice 0.80 → 0.65); past ~4 dB the gain flattens and the losses keep growing.

**Not fixed here, measured for the next step.** The Listener knows how loud and how deep a sound
is, not what it is:
- **Logos.** Frankenstein's 0–11 s logo is 121–131 dB with 40–99% of it below 100 Hz, as loud and
  deep as its explosion scene (124–133 dB). ♪ tags cover only the 2–4 s a caption is on screen.
- **Engines.** A revving engine lives at 100–2000 Hz: Us 57:59 [engine revs] is at full level with
  1–15% below 100 Hz, so the bed fades out (share ≤ 15%) exactly as it revs. 4 of 10 engine tags
  in Us are felt, by their bass alone. `HapticMeaning` has no engine keyword.
- **Glass.** In a loud scene bass hides it: Us 70:46 [glass shattering] rose 15 dB in 2–8 kHz but
  4 dB overall, under the 10 dB onset rule; Frankenstein's [cuffs shatter] the same. Caught alone it
  is light (no bass), played only with a tag and at the softest hit. `[glass breaking]` matches no
  keyword.

## Sound recognition, go/no-go (2026-10-19)

**Test.** `scripts/haptics-yamnet.py` runs Google's YAMNet (`yamnet.tflite`, MediaPipe float32, 4.1 MB,
Apache 2.0) over each film's mono 16 kHz audio, one 0.975 s window every 0.48 s, and saves the 521
scores as `<name>.yamnet.npy`. Scored against the films' own SDH tags (±1.5 s); "false frames" is the
share of the whole film above the same threshold.

| Question | Result |
|---|---|
| Speed (PC, XNNPACK) | 4.1 ms a window, ~115× realtime: a 2.5 h film in 81 s |
| Music logos labelled music? | **Yes.** Frankenstein 2–11 s Music 0.26–0.59; Together 4–9 s 0.67–0.99 |
| Engine tags found (Us, > 0.2) | **7 of 13** (3 of 4 [engine revs]); 1.4% false frames |
| Breaking-glass tags found (> 0.15) | **5 of 6** (Us 0.74, 0.89; Frankenstein 0.26, 0.20, 0.74); ≤ 1% false frames. Missed: Us 70:46, under a thud |
| Gunshots / explosions found (Frankenstein, > 0.1) | 20 of 29; missed ones are mostly low [thunder rumbling], which the bed carries |
| Music under plain dialogue lines | 6–35% of their time (Blast's score runs under its dialogue) |

**Findings.**
- **Music is a span, not a mute.** It covers 24–51% of these films, including action under score.
  Silencing everything under music would cut real effects; the rule has to be "under music, only
  what is also labelled an effect is felt".
- **Not every opening is a music logo.** Blast 40–47 s and Us 45–57 s are labelled explosion and
  thunder: they are, as sound. Only a music logo can be told apart.
- Speech is found under 69–79% of dialogue-line time.

**Decision.** Go: build the integration (labels → tags → Director) and score it with `HapticFilmTest`.
Phone speed still to measure.

## Sound recognition, built (2026-10-19)

**Pipeline.** `HapticRecognizer` runs YAMNet beside the Listener in `HapticAnalysis`: the same mono
mix, anti-aliased (4th-order, 7 kHz) and resampled to 16 kHz, a window every 0.48 s. `HapticSounds`
turns the 521 scores into group scores (the track's new `sounds` lane) and those into tags the
Director already reads. The Listener adds a `body` lane: level below 300 Hz, unweighted. Track
format 2, Listener VERSION 4 (bump it whenever `HapticSounds.Group` changes: the cache holds group
scores). If the model fails to load, haptics go on from the sound alone.

| Group | Classes | Threshold | Tag |
|---|---|---|---|
| Music | Music | 0.2 (one-window dips bridged) | MUSIC |
| Speech | Speech | 0.5 | SPEECH |
| Engine | vehicle, car, engine, revving, idling, skid, motorcycle… | 0.2 | ENGINE |
| Glass | glass, shatter, smash, breaking (not chink/clink) | 0.3 | SHARP |
| Boom | explosion, gunshot, thunder, boom… | 0.3 | HEAVY |
| Impact | slam, knock, thump, thunk, bang, whack, clang, rumble… | 0.3 | HEAVY |

**Rules (Director).**
- **Music alone** (no effect tag over it): half bed, no hits, as ♪ was. **Before the first speech
  it isn't felt at all**: Frankenstein's logo is as loud and deep as its explosions, *louder on
  the LFE* (−13 to −24 dB vs −27 to −45 dB per second), so only its place tells it apart. Muting
  music everywhere was tried: loud-LFE moments under voice tags fell from 0.76 to 0.45 (Us), the
  score's braams under screams. Halving keeps them.
- **An effect under music plays**: boom, impact, glass or engine tags lift the music rule there.
- **Labels snap only inside their own window** (`Tag.exact`), not ±1 s like a caption: with ±1 s
  they picked speech consonants. Clink was dropped from glass and effect thresholds raised to 0.3
  for the same reason (Frankenstein's lab instruments and chains).
- **Engine**: under an ENGINE tag (label or `[engine revs]`, a new SDH keyword) the bed is at least
  the body level, gated on the film's 99th-percentile body like the bed on its bass.

**Results** (Cinematic; audio only → subtitles → subtitles + labels).

| | Us | Frankenstein | Together | Blast |
|---|---|---|---|---|
| Opening felt before the first line, s | 1.1 → 1.3 → 1.5 | 14.2 → 14.2 → **6.3** | 0 | 2.8 = |
| Engine tags felt | 0.31 → **0.77** → 0.77 | | | |
| Tagged hits felt | 0.32 → 0.54 → 0.54 | 0.25 → 0.48 → 0.48 | 0.44 → 0.50 → **0.56** | |
| Dialogue hits/min (≤ 1) | 0.61 → 0.61 → **0.45** | 0.42 → 0.42 → 0.44 | 0.43 → 0.43 → **0.30** | 1.00 → 1.00 → **0.85** |
| Loud LFE felt, ♪ / voice | kept | kept | kept | |
| Felt moments/min | 5.6 → 5.7 → 6.0 | 3.0 → 3.1 → 3.1 | 2.5 → 2.5 → 2.7 | 8.8 → 8.8 → 8.9 |

- Frankenstein's remaining 6 s of opening are its storm: YAMNet calls the ship and wind "vehicle",
  so the engine rule plays them.
- Felt moments barely move: halved music bass still counts as felt. Engines add a few.
- Blast's 40–47 s opening is labelled explosion and stays.

**Yardstick changes** (`HapticFilmTest`). Subtitle tags stay the ground truth; labels only direct.
A *subs* column shows subtitles alone. The subwoofer correlation is judged outside music-only
stretches (labels included, the Phase 5 rule widened) with 0.005 tolerance. Dialogue hits keep the
≤ 1/min target but are no longer compared with audio only: labels find real glass and clangs
during lines (Frankenstein, scores 0.5–0.94), which that comparison counts as false.

**Runtime.** LiteRT 1.4.2 (`org.tensorflow.lite.Interpreter`, CPU, 2 threads): 2.0–2.2 fail the
manifest merge (two artifacts share a namespace), 2.3 carries Kotlin 2.4 metadata this project's
2.2 can't read, and 2.x adds a data-sync foreground-service permission. APK: model 4.1 MB, runtime
4.5 MB (arm64) / 2.6 MB (armv7), both stored. R8 keeps the JNI wrapper by name.
`HapticRecognizerTest` checks the resampler and windowing.

**Still to measure on the phone:** classify time per window and the analysis staying ahead of the
playhead (`listen ... classify=` in the log), battery, and that its labels match the PC's.

## Phone check (2026-10-20)

**Device:** AIN065, Android 16, arm64, release build. The model loads.

**Speed.** Us (116 min) analysed in 201 s, 35× realtime, 20 s ahead of the playhead after 1 s.
YAMNet is 30.5 s of it (2.1 ms a window, 14556 windows); decoding and the Listener are the rest.

**Labels were 12 dB low.** The phone mixed to mono by averaging every channel, LFE included; the PC
labels (and every threshold) came from ffmpeg's downmix, 4× louder on 5.1. Same correlation shape,
but scores sank under the thresholds. Relabelling Us on the PC with the phone's mix reproduced the
phone (r 0.99). `HapticRecognizer` now mixes as ffmpeg does (fitted on all four films and on noise):
front pair 0.707, centre 1, LFE out, the rest 0.5. Listener VERSION 5.

| Us, windows over threshold (phone / PC) | Averaged | ffmpeg mix |
|---|---|---|
| Music | 4466 / 5341 | 5397 / 5341 |
| Speech | 2775 / 3137 | 3168 / 3137 |
| Engine | 57 / 208 | 194 / 208 |
| Glass | 14 / 38 | 36 / 38 |
| Boom | 48 / 126 | 130 / 126 |

**Found while testing.** Seeking past the analysis feels nothing until it gets there; in the
background the decode is frozen by Android, or killed for binder traffic ("excessive binder
traffic during cached") and its work lost.

## Jumping ahead (2026-10-20)

Analysis ran from the start only, so a jump past it felt nothing until it caught up; testers jump
straight to scenes. `HapticAnalysis` now works in pieces: playing more than 30 s past the piece
being analysed (or into a gap) stops it and starts one at the playhead; when a piece ends, the gap
under the playhead is filled first, then the next after it, then the first. One decodes at a
time; the cache is written once there are no gaps. Each piece decodes from 1.5 s early (the
Listener's context, a sound window) and keeps only its own span; YAMNet windows snap to the
film's 0.48 s grid. Listener VERSION 6.

Frankenstein on the phone, jumping to 53, 131 and 133 min: haptics 0.6-1.8 s after each jump;
13 pieces filled in 124 s. Without the pre-roll and grid, labels in later pieces fell to r 0.8
against the PC (first piece 0.99) with 34 empty windows at the seams; with them, 0.993-0.996 in
every 20 min and 6 empty windows. Still: until the start is analysed, a jumped-to piece's first
line counts as the film's first for the opening rule.

## Logos and texture (2026-10-20)

**Report:** Frankenstein's intro still vibrates; the final explosion feels flat, "linear, no texture".

**Intro, measured on the phone's track.** Two causes. While the start is still being analysed no
speech has been heard, so the opening rule had no line to anchor to and did nothing: 1-10.5 s
felt. And Netflix's 1-3 s boom carries no label over its threshold (boom 0.11, impact 0.15, music
0), so it played as plain bass. Fixes: with labels but no line yet, everything analysed is opening
(without labels nothing marks speech, subtitles carry no speech tags, and the rule stays off: tried
without that guard, music under subtitles alone fell to 0.07 loud LFE felt). In the first
`LOGO_MS` (15 s) before anyone speaks, only what is labelled an effect is felt. The yardstick leaves
that window out of the subwoofer correlation as it does music. Phone track: nothing felt 0-16 s,
mid-analysis or finished.

**Texture.** The bed clipped at the film's 99th percentile of bass and hits play as max(bed, hit):
in Frankenstein's final explosion (peaks 10 dB over that percentile) 147 of 250 frames sat at
full, and hits under it were lost. The bed now reaches `KNEE` (0.75) at the 99th percentile and the
loudest 1% fills the rest up to the 99.9th; the engine rule's body lane the same.

| | Clipped | Knee 0.75 |
|---|---|---|
| Explosion 8020.5-8023 s: bed sd / frames at max | 0.114 / 147 of 250 | **0.169 / 56 of 250** |
| Hits lost under the bed (Fr, Us, Together) | 2, 1, 2 | **0, 0, 0** |
| Subwoofer correlation, labels (Fr, Us, Together, Blast) | 0.771, 0.746, 0.757, 0.822 | 0.781, 0.761, 0.767, 0.823 |
| Frankenstein opening felt, labels | 6.3 s | 4.0 s |

The rest of the film's bed is 25% lighter for it; the strength setting covers that.

## Long-term system (plan, 2026-10-20)

**Why patching stopped working.** Each tester report got its own Director rule; they interact
(opening x pieces, logo x yardstick, knee x engine). Root causes: (1) "good" was never a measured
target: subwoofer correlation rewards following the bass, which is what makes action scenes buzz
nonstop (Frankenstein 223-265 s, the creature attack: bed on 30-100% of every second, old and new
Director alike); (2) hand-set label groups and thresholds are brittle (the roar scores Vehicle
0.74, Train 0.50, Siren 0.42; Netflix's boom scores nothing); (3) loudness is judged only against
the whole film, never the last seconds; (4) the motor's range is crushed: on the AIN065 the system
log shows 6-22% amplitude at Cinematic (strength 0.25), ~11 dB for everything; (5) four films, all
used to tune, none held out; phone feedback has no timestamps.

**Target (to confirm with the user):** feel the moments a viewer would point at (impacts,
explosions, roars, slams, revving engines) with their shape; stay still for dialogue, score,
ambience and logos.

**Layers.**
0. Benchmark: ground truth by script, no hand labels. SDH sound cues sorted feel / don't-feel by
   `HapticMeaning`; the LFE (5.1) for how big. Scores: cue moments felt (recall), felt moments per
   minute outside cues, felt share inside loud scenes, opening still. Two or more films held out,
   never tuned on.
1. Hear: Listener lanes and YAMNet, as now.
2. What: one small learned "moment" score per 0.48 s window (logistic regression over YAMNet scores
   plus a few Listener features: bass rise over the scene, bass share, onset strength), trained on
   the PC from the fixture films, shipped as a Kotlin array. Replaces the label groups and
   thresholds, music halving, the opening rule, the logo window and the engine rule.
3. How much: two timescales, importance against the film and salience against the last ~3 s;
   steady sound fades unless it is the film's peak.
4. Shape: the motor's whole range including silence; default strength from the device
   calibration, not a fixed 25%; texture from the 10 ms envelope. AIN065 has amplitude control only
   (no primitives, no frequency control: `dumpsys vibrator_manager`).
5. Feedback: a "too much / missed" mark during playback logs the media time; each becomes a test case.

**Order:** benchmark and more films (5.1 with SDH subtitles) with no change to the feel; layer 3;
layer 2 replacing the rules; layer 4 then a phone test; layer 5. Alongside: stop analysis in the
background (Android freezes it, or kills it for binder traffic), 8-bit YAMNet (~3 MB).

**Phone tooling (AIN065, Android 16, arm64).** Release builds are debug-signed:
`./gradlew :app:assembleRelease -PallowDebugSigning=true`, `adb install -r -d`. `Log.w` survives R8,
so `adb logcat -v time -s GlideHaptics` shows `listen`, `piece`, `direct`, `sync` and `call` lines
(a call's steps are `ms x amplitude/255`). Haptics run only when the film is started "with
haptics" from its detail screen; a VIEW intent plays without them. The track cache is private
(`files/haptics/<sha1>.ght`, `allowBackup=false`): install the same-key debug APK over it, `adb
exec-out run-as com.glide.app cat files/haptics/<f>.ght`, reinstall the release APK (data kept).
Test films: `/sdcard/Download/1DMP/Videos` (Us, Frankenstein, Together, Blast, and more 5.1 films).
Screen captures come back black; `uiautomator dump` reads the UI.

## Benchmark (2026-10-20)

Layer 0 of the long-term plan, `HapticBenchTest`. Ground truth by script: SDH cues `HapticMeaning`
calls an effect should be felt (from 1 s before the cue to its end); big when the subwoofer feed
peaks within 6 dB of the film's 99th percentile. Two films added from the phone, both 5.1 with
English SDH inside the file, both held out (`HOLDOUT`, never tuned on; `HapticFilmTest` skips them):
Anora (2024, Blu-ray) and Bethlehem Kudumba Unit (2026, web, its second subtitle track). Blast's
subtitles have no sound tags and SubDL has none for it, so it sits out. Stereo films on the phone
(Stranger Things, Now You See Me) have no LFE. Baseline, no change to the feel:

| Cinematic, labels | Effect cues felt | Big cues felt | Stray moments/min | Loud scenes felt | Opening felt |
|---|---|---|---|---|---|
| Frankenstein | 0.80 of 80 | 0.97 of 36 | 2.66 | 0.69 | 4.0 s |
| Together | 0.78 of 18 | 0.88 of 8 | 2.55 | 0.68 | 0.0 s |
| Us | 0.82 of 50 | 1.00 of 28 | 5.57 | 0.55 | 1.5 s |
| **Tuning** | **0.80 of 148** | **0.97 of 72** | **3.54** | **0.63** | 5.5 s |
| Anora* | 0.56 of 18 | 1.00 of 2 | 2.98 | 0.53 | 0.2 s |
| Bethlehem* | 0.57 of 14 | 1.00 of 3 | 7.81 | 0.55 | 0.0 s |
| **Held out*** | **0.56 of 32** | **1.00 of 5** | **5.53** | **0.55** | 0.2 s |

Creature attack (Frankenstein 223-265 s): felt 0.66 of the time. Stray moments and loud scenes
felt are what the later layers must bring down without losing big cues.

## Two timescales (2026-10-20)

Layer 3. The bed is judged against the film (its gate, as before) and against the last 3 s: it
must rise `STEADY_DB` (4 dB) over the typical recent level, and is full `RISE_DB` (6 dB) past
that; the film's loudest 1% (over the 99th percentile) stays felt however steady. The recent
level is the mean in dB: averaged as power, a loud scene's peaks hid the thuds and gunshots inside
it (big cues 0.97 -> 0.92 at the same setting). Chosen on the tuning films only:

| Tuning films | Effect cues felt | Big cues felt | Stray moments/min | Loud scenes felt | Creature attack felt |
|---|---|---|---|---|---|
| Before | 0.80 | 0.97 | 3.54 | 0.63 | 0.66 (bed 0.52) |
| Power mean, 0 dB | 0.80 | 0.97 | 3.94 | 0.51 | 0.56 |
| Power mean, 4 dB | 0.77 | 0.92 | 3.62 | 0.29 | 0.27 |
| **dB mean, 4 dB** | **0.80** | **0.97** | 3.83 | **0.39** | **0.34 (bed 0.25)** |
| dB mean, 6 dB | 0.77 | 0.92 | 3.46 | 0.32 | 0.23 |

Held out after the choice: big cues 5 -> 4 of 5 (Anora's "[gunfire sound effects on TV]"),
loud scenes 0.55 -> 0.29, stray 5.53 -> 6.57. Stray moments rise a little: a faded bed stutters
with a roar's swells. Tried and dropped: a 300-600 ms release on the gain (stray 3.79-3.76, loud
back to 0.40-0.41); judging against the 3 s before the last 300 ms (big cues 0.90); widening the
steady exemption 2-4 dB under the 99th percentile (loud 0.42-0.47, the clips' rumbles no better);
the same fade on the engine rule's body lane (cues 0.78; Anora's cars 0.50 -> 0.28).

Tests changed with it. The engine rule's body under an engine heard inside a music or voice cue
now stands out of the faded bed, so `HapticFilmTest`'s music and voice bed rows (0.001-0.006
heavier with labels; none with the rule off) are information now. The directed clips skip bed
coverage: their steady 2-6 s rumbles are felt for the first 2-3 s; the Listener's run of the clips
still checks it.

## Moments (2026-10-20)

Layer 2. `HapticSounds.moment`: logistic regression per 0.48 s YAMNet window over the logits of
the `KEPT` classes' scores and five Listener features (bass against the film's 99th percentile, its
rise over the last 3 s, the body below 300 Hz, the loudest weighty and light onset, in tens of dB).
`HapticMomentTrain` (JVM test) fits it on the tuning films and writes the `<model>` block in
HapticSounds.kt: a window is a moment if it meets an SDH effect cue (as the bench), and only windows
where something could be felt are learned from. L1 over all 521 classes keeps 22 (Explosion,
Door, Wind noise, Glass, Smash, Thunder, Vehicle...); the penalty is the fewest classes within 0.005
of the best leave-one-film-out ROC AUC (0.78). Held out: Anora 0.69, Bethlehem 0.73. The sounds lane
holds the `KEPT` scores (22 bytes a window), so a retrain on the same classes rebuilds nothing;
Listener VERSION 7.

**Director.** Bed and hits are scaled by the moment gain: a window's score is the best of it and
its neighbours (a dipping score between windows stuttered the bed), linear between window centres,
none under 0.05 and full from 0.15. Where it is a moment the bed also follows the body, gated on
the film's loud body and faded when steady like the bed. Removed: the label groups and thresholds,
labels as tags, music halving (labels and ♪), the opening rule, the engine rule. Subtitle hit tags
still keep their onset. Kept as a rule: in the first 15 s, until YAMNet hears speech, nothing is a
moment (as a sixth feature it trained to 0: three films are three openings).

| Tuning films | Effect cues felt | Big cues felt | Stray moments/min | Loud scenes felt | Creature attack felt | Opening felt |
|---|---|---|---|---|---|---|
| Before (two timescales) | 0.80 | 0.97 | 3.83 | 0.39 | 0.34 | 5.5 s |
| Model, gain 0.1-0.3, no body | 0.61 | 0.75 | 0.84 | 0.11 | 0.03 | 3.1 s |
| Logits, body unfaded, 0.05-0.15 | 0.83 | 0.96 | 3.05 | 0.44 | 0.72 | 16.1 s |
| Dilated, body unfaded, 0.08-0.2 | 0.78 | 0.93 | 1.90 | 0.39 | 0.54 | 15.1 s |
| **Dilated, body faded, 0.05-0.15, logo rule** | **0.81** | **0.93** | **3.66** | **0.25** | **0.21** | 7.8 s |
| Same, 0.08-0.2 | 0.74 | 0.89 | 2.08 | 0.18 | 0.15 | 5.3 s |

Held out after the choice: cues 0.53 -> 0.41, big 0.80 = (4 of 5), stray 6.57 -> 2.09, loud 0.29 ->
0.10. The cue loss is Anora's cars (0.50 -> 0.22): the engine rule opened the body under SDH
`[engine]` tags, the bench's own truth. Big cues missed: Frankenstein's thunder rumbling and fire
crackling, and Us's gunshots and knocking "on stereo" (a song, rightly still).

`HapticFilmTest`: the subwoofer correlation and loud LFE under music and voice are information
now (Us: loud LFE under ♪ 0.62 -> 0.07, the score's braams); the moment score fades bass a viewer
wouldn't point at, which they count as missed. Blast, no SDH: 160 -> 55 hits, felt moments 9.4 ->
5.8 a minute.

**Roars (tester report, same day).** Frankenstein 3:46, "[guttural, beastly roar]" after "A
prosthetic leg": nothing felt, scattered pulses through the rest of the scene. The roar is the
scene's loudest bass (-1 dB against the film's loud level, 11 dB over the last 3 s) but YAMNet hears
Vehicle and Train (0.5-0.74), and `HapticMeaning` had no word for roars: all 65 roar, growl and
snarl cues in the tuning films were learned as still, and the bench never counted one. They are
`Kind.ROAR` now (truth only, no hit to keep; `HapticMeaning.EFFECTS` is shared by the tests).
Retrained: leave-one-out AUC 0.79, held out 0.73 / 0.82; 66 classes (Vehicle, Roaring cats,
Growling, Animal, Explosion, Whack...), bass now weighted. Listener VERSION 8. The gain moved to
0.08-0.2 (the base rate rose; 0.07-0.18: stray 3.77, 0.1-0.25: cues 0.78).

| Same truth (roars counted) | Effect cues felt | Big cues felt | Stray moments/min | Loud scenes felt | Creature attack felt |
|---|---|---|---|---|---|
| Model above | 0.78 | 0.91 | 3.53 | 0.25 | 0.21 |
| **Retrained, 0.08-0.2** | **0.80** | **0.94** | **3.34** | 0.26 | 0.26 |
| Held out, model above / retrained | 0.39 / **0.46** | 0.80 = | 2.09 / **1.77** | 0.10 / **0.08** | |

The 3:46 roar is felt (54-100% of its windows) and the volley at "Fire!" (4:23); the scene's
clamoring and running between still score 0.08-0.15, inside the ramp, and play as faint pulses.

## Caption audit (2026-10-20)

`HapticBenchTest.audit` lists every bracketed SDH cue `HapticMeaning` gives no kind, across all
films with SDH (held out too: it changes the truth, not the feel), with how often the subwoofer is
big under it (as the bench's big cues). Speaker names (capitalised words) are skipped. Rerun it
whenever films are added. First run, 5 films: loud and unclassified were `firecracker bursts` (4
of 4 big), `clatters`, `heavy splash`, `bellowing`; music words `score`, `tune`, `band`, `drum`.
Added: firecracker, firework and clatter (sharp), splash (heavy), bellow (roar), and the music
words. Left out though often loud: creaking (Frankenstein's ship), wind whistling, door closes,
crowd cheering: ambience a viewer wouldn't point at, and as truth they would teach the model to
buzz through it.

Retrained (68 classes, still Flamenco, Microwave oven, Quack: memorising), Listener VERSION 9.
New truth, so rows move under both: tuning cues 0.80 = (197 -> 216), big 0.94 =, stray 3.34 ->
3.69, loud 0.26 -> 0.29; held out cues 0.46 -> 0.53 (33 -> 38, Bethlehem's firecrackers), big
0.80 -> 0.90 (5 -> 10), stray 1.77 -> 2.15, loud 0.08 -> 0.10. Gain left at 0.08-0.2: it is
chosen again once the model is constrained and the film set grown.

## Constrained moments (2026-10-20)

`HapticMomentTrain` now learns only from `EFFECT` classes (60, chosen from YAMNet's class names
as `HapticMeaning`'s effects: roars, impacts and breaks, guns and explosions, thunder and fire,
vehicles and engines), whose weights can only add to a moment, and Speech and Music, which can
only take from it (projected after each FISTA step). Unconstrained over all 521 it kept 68 classes
with Flamenco, Microwave oven and Quack; now 14 (Explosion, Vehicle, Glass, Whack, Roaring cats,
Door, Growling, Smash, Thunder... Music -0.12). Fits are ~8x faster (62 columns, not 526), which
leave-one-film-out over 20-40 films needs. Listener VERSION 10.

| Same truth (audit's words) | LOO AUC | Anora* / Bethlehem* AUC | Cues | Big | Stray/min | Loud | Held-out cues | Big | Stray | Loud |
|---|---|---|---|---|---|---|---|---|---|---|
| All 521, free signs (68 kept) | 0.788 | 0.716 / 0.861 | 0.80 | 0.94 | 3.69 | 0.29 | 0.53 | 0.90 | 2.15 | 0.10 |
| **Effect classes signed (14)** | 0.782 | 0.713 / **0.876** | 0.76 | 0.94 | **3.24** | **0.26** | 0.53 = | 0.90 = | **1.58** | **0.07** |

Held out it is as good on cues and stiller everywhere else; the tuning cues it gave up were the
memorised ones (tuning-held gap 0.27 -> 0.24). Gain unchanged (0.08-0.2) until the film set grows.

## Spider-Man (2026-10-20)

A fourth tuning film, the first action one: Spider-Man: Brand New Day (2026, web, 145 min), its
English 5.1 track (the second; the first is a Hindi dub) copied to `spiderman.mka`. Its own
subtitles have no sound tags; the SDH one is SubDL's (`api.subdl.com/api/v1/subtitles?api_key=..
&film_name=..&languages=EN&hi=1`, download `dl.subdl.com` + its url; the key is never committed).
SDH timing differs from a release's own: `scripts/haptics-subsync.py` fits a subtitle's dialogue
lines to YAMNet's Speech score in 0.1 s steps. Films in sync read -0.1 to +0.2 s (Us, Anora,
Frankenstein, Together, Bethlehem, Spider-Man's own); the SDH read +0.26 s and is shifted 360 ms.
Matching its lines' text to the release's own gave 0.76 s: SDH lines start earlier, so text
matching is no guide.

The audit with it: loud and unclassified `whooshes` (17 of 27 big: web-swinging, every fight),
sirens, `field warbling`, high-pitched ringing. None added: a whoosh is motion, not a moment, and
would buzz through every fight. The audit no longer skips all-caps SDH as speaker names.

Before training on it, Spider-Man scored as an unseen film: cues 0.85, big 0.94, stray 4.12, loud
0.43. Trained on four: leave-one-out AUC 0.795 (three films: 0.782), held out 0.715 / 0.879
(0.713 / 0.876), 17 classes (Speech -0.22, Music -0.29). Listener VERSION 11.

| | Cues | Big | Stray/min | Loud | Held-out cues | Big | Stray | Loud |
|---|---|---|---|---|---|---|---|---|
| Three films | 0.79 | 0.95 | 3.49 | 0.31 | 0.53 | 0.90 | 1.58 | 0.07 |
| **Four films** | 0.78 | 0.94 | 3.56 | 0.31 | 0.47 | 0.90 | 1.63 | 0.07 |

(Tuning rows include Spider-Man in both.) The held-out cue drop is Anora's cars, 4 -> 2 of 18;
38 held-out cues are too few to tell that from noise, and the AUC rose on both. Kept.
