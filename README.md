# Glide - Haptic Video Player

Glide is a React Native video player that blends traditional playback controls with a tactile, subtitle-aware experience. It is built on Media3/ExoPlayer and adds a smart subtitle pipeline, assisted sync tools, and deep media controls that go beyond a typical player UI.

## Why Glide Feels Different

Most video players focus on decoding and playback controls. Glide keeps that foundation, but then adds a second layer that interprets the video context and makes the experience feel more alive.

This is especially visible in three areas:

- Haptics are driven by subtitle sound effects and synthesized into real vibration waveforms.
- Subtitles are not just rendered, they are parsed, styled, searched, auto-downloaded, and even used for assisted sync.
- Playback controls are gesture-first, with brightness, volume, speed, zoom, and seek all handled directly on the video surface.

## Feature Deep Dive

## 1) Haptic-Enabled Playback

Glide turns SDH subtitle cues into a tactile track.

- Subtitle cues are scanned for bracketed sound effects like [Explosion] or (Footsteps).
- A smart keyword matcher handles variations and blocks false positives with context blacklists.
- ContextAnalyzer uses NLP and sentiment to shape intensity, speed, roughness, and sharpness.
- HapticSynthesizer generates a waveform (not just a single buzz) and the engine applies priority and throttling so it feels intentional, not noisy.
- Intensity is user-tunable and scaled across the entire waveform.

Key files:
- `C:\glide\src\services\HapticPatternGenerator.ts`
- `C:\glide\src\services\ContextAnalyzer.ts`
- `C:\glide\src\services\HapticSynthesizer.ts`
- `C:\glide\src\services\HapticEngineService.ts`
- `C:\glide\src\hooks\useHapticFeedback.ts`

## 2) Assisted Subtitle Sync (Smart Sync)

Glide includes a floating sync panel with three ways to fix drift:

- Manual adjustment in 0.5 s and 0.05 s steps, with the offset shown in plain words.
- Auto sync, which matches the audio around the current time against the subtitle cues
  on the device, with no network call.
- Pick a line: type a few words you just heard, then choose the matching cue; the offset is
  calculated from it and applied.

Key files:
- `C:\glide\src\components\FloatingSyncPanel.tsx`
- `C:\glide\src\services\SubtitleSyncService.ts`
- `C:\glide\src\services\SubtitleAutoSync.ts`
- `C:\glide\src\utils\AudioExtractor.ts`

## 3) Subtitle Engine and Rendering

Subtitles are treated like a full subsystem, not a toggle.

- Embedded tracks are discovered and extracted natively when text-based.
- Bitmap subtitles (PGS, VobSub) are decoded by ExoPlayer and drawn by the same overlay.
- External files can be picked locally or downloaded via SubDL.
- SDH content is detected by actual text patterns, not only by filename hints.
- Subtitle rendering supports inline HTML formatting with a custom parser.
- On-screen subtitles are adjustable by pinch (font size) and drag (position) gestures.

Key files:
- `C:\glide\src\services\SubtitleCueStore.ts`
- `C:\glide\src\utils\SubtitleExtractor.ts`
- `C:\glide\src\utils\SubtitleHtmlParser.tsx`
- `C:\glide\src\components\SubtitleOverlay.tsx`
- `C:\glide\src\components\TrackSelector.tsx`
- `C:\glide\src\services\SubtitleSelectionService.ts`

## 4) Visual Enhancement Toggle

A color enhancement toggle is wired directly into the native player. It allows quick visual boost without leaving playback.

Key files:
- `C:\glide\src\hooks\video-player\usePlayerSettings.ts`
- `C:\glide\src\components\VideoPlayer\AnimatedVideoView.tsx`

## 5) Audio Stack: EQ, Delay, and Route-Aware Volume

Glide has a real audio stack:

- 10-band equalizer with presets and custom tuning.
- Audio delay control with a dedicated sync panel.
- Route-aware volume handling (speaker, wired, bluetooth) with support for >100% boost when appropriate.
- Hardware volume buttons and gestures update the HUD without fighting each other.

Key files:
- `C:\glide\src\components\EqualizerModal.tsx`
- `C:\glide\src\hooks\video-player\useAudioController.ts`
- `C:\glide\src\hooks\video-player\usePlayerSettings.ts`

## 6) Gesture-First Playback UX

The playback surface acts like a control surface:

- Double-tap seek with ripple feedback.
- Vertical swipes for brightness and volume with HUD indicators.
- Long-press speed boost.
- Pinch and pan zoom with safe constraints.
- Lock mode to prevent accidental touches.

Key files:
- `C:\glide\src\hooks\video-player\usePlayerGestures.ts`
- `C:\glide\src\hooks\video-player\useSeekGesture.ts`
- `C:\glide\src\hooks\video-player\useSpeedGesture.ts`
- `C:\glide\src\components\VideoPlayer\VideoHUD.tsx`

## 7) Resume, Recap, and Context

Glide preserves watch state and adds a recap flow for longer breaks.

- Resume position, selected tracks, and delays are persisted per video.
- A recap modal can generate a short summary based on the last few minutes of subtitle dialogue.
- Content detection helps route movies and series into a details screen.

Key files:
- `C:\glide\src\services\RecapService.ts`
- `C:\glide\src\store\videoHistoryStore.ts`
- `C:\glide\src\services\ContentDetector.ts`

## 8) Library and Metadata

- MMKV-backed indexing for albums and fast search.
- FFprobe-powered metadata badges for bitrate, codec, fps, and subtitle formats.

Key files:
- `C:\glide\src\store\videoIndexStore.ts`
- `C:\glide\src\components\VideoOptionsBottomSheet.tsx`

## Comparison to Typical Players

Compared to mainstream players, Glide focuses less on just playing video and more on extracting meaning and context from it.

- The haptic layer turns SDH subtitles into a tactile track, which most players treat as plain text.
- Assisted subtitle sync matches the audio on the device to reduce manual trial-and-error.
- Subtitles are treated as a full pipeline (extraction, formatting, SDH detection, gesture-driven adjustments) rather than a single menu toggle.
- Gesture controls cover not only seeking but brightness, volume, speed, and zoom without interrupting playback.

Glide is not trying to replace any media player. Instead, it is pushing the player experience into a more immersive, assistive, and context-aware space.

## Tech Stack

- React Native
- Media3/ExoPlayer
- Cloudflare Worker AI proxy for Groq recap
- Zustand + MMKV for state and persistence

## Environment Variables

Copy `.env.example` to `.env` and set `AI_PROXY_URL`. API keys are Worker secrets and never go in the app's `.env`.

## Getting Started

1. Install dependencies

```bash
npm install
```

2. Configure environment

```bash
copy .env.example .env
```

3. Run Metro

```bash
npm start
```

4. Run the app

```bash
npm run android
```

## Project Structure

- `C:\glide\src\components` UI components and player panels
- `C:\glide\src\hooks` player hooks and gesture system
- `C:\glide\src\services` haptics, sync, subtitle, recap, and system services
- `C:\glide\src\utils` parsing, extraction, and helper utilities
- `C:\glide\src\native` native module wrappers

## License

This project is private by default. Add your license of choice before publishing.
