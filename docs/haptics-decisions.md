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
