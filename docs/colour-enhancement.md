# Colour enhancement

What the player's colour enhancement does, how to use it, and what has been measured.
The code lives in `android/app/src/main/java/com/glide/app/player/`:
- `ColorEnhancement.kt` holds all maths and constants, and generates the GLSL.
- `ColorEnhancementEffect.kt` is the GL plumbing.
- `ColorEnhancementTest.kt` has 23 JVM tests.

History and root-cause write-ups are in git history (the deleted `player-engine-migration-plan.md`, Phase 2).

## Using it

**Quick Settings → Colour enhancement.** It has an on/off switch, a strength slider from 0 to
150%, and three presets: Subtle 50%, Natural 100%, Vivid 150%. The header's enhancement icon
also toggles it.

- **Switching it on or off reopens the video at the same position.** It takes about 0.5 s:
  the frame processor is armed when the video is prepared.
- **Strength applies live, with no reopen.** While paused, a change shows once playback
  resumes. media3's effects path does not redraw a paused frame, even after an in-place seek.
- Settings last for the playback session, like the toggle always has.

## Features

One GPU effect handles both SDR and HDR, and each feature works in the colour space where it
is correct: SDR on media3's gamma-encoded values, HDR in ICtCp (ITU-R BT.2390). Everything
scales with strength. At 100%, a typical scene is exactly the tuning users approved.

| Feature | What it does | SDR | HDR |
|---|---|---|---|
| **Scene-adaptive tone** | Each frame's brightness is measured on the GPU, smoothed over 0.6 s, and adapts at once on scene cuts. | Contrast pivot drops from 0.18 to 0.06 in dark scenes, so shadows stop being darkened. | Dark scenes: 1–30 nits lifted up to +14%. Bright scenes: less lift, to protect highlights. Below 0.5 nits it never changes by more than ±3%. |
| **Smarter colour** | Saturation weighted per pixel. | Skin (hue 138°) gets about half the boost. | The same, skin at 142° in ICtCp. |
| | Deep shadows get a quarter of the boost, because colour noise lives there. | ✓ | ✓ |
| | Vibrance: muted colours are boosted more than vivid ones, so colours stop clipping at the gamut edge. | ✓ | ✓ |
| **Debanding** | Smooths 8-bit steps in skies and dark gradients, and adds a one-step dither. | ✓ | — (10-bit source) |
| **Highlight roll-off** | 1000 nits maps to itself, so nothing is pushed past the mastering peak. | — | ✓ |
| **Mastering metadata** | Re-applies the video's SMPTE 2086 / CTA-861.3 metadata, which media3 drops, to the output surface. | — | ✓ when the file has it |

Also fixed along the way: media3's own HDR shaders ran at fp16 and turned everything below
0.61 nits black whenever any effect was on. `res/raw` overrides them with `highp` copies, and a
test fails if media3 is upgraded without re-copying them.

## Deliberately not included

- **Local contrast ("clarity").** It was built and then removed, because it drew visible
  shadows around people against bright backgrounds (The Boys S05E04, 19:35). A halo-free
  version would need an edge-aware filter. A test fails if the main pass reads its
  neighbourhood.
- **SDR → HDR expansion.** media3 throws "SDR to HDR tonemapping is not supported".
- **AI upscaling and frame interpolation.** Too heavy for 4K on battery.

## Measured on device (AIN065, Android 16, 2026-09-25)

These are screenshot comparisons at the same frame. A "level" is one step of 255 in the
8-bit screenshot.

| Check | Result |
|---|---|
| SDR shader vs the Kotlin model (Frankenstein 8:44, 244,480 px) | median **0.44**, p99 **1.71** levels: dither plus rounding |
| SDR dark scene adapts | key 0.052, so the pivot is 0.06, as modelled |
| Vivid skin (6,280 px) | chroma gain **1.241** (model 1.249), hue shift **0.03°**, so no orange faces |
| Vivid other colours (43,364 px) | chroma gain **1.339** (model 1.344) |
| Halo after clarity removal (19:37) | bright background next to dark hair ×0.958, the same as far from edges |
| HDR black crush after the `highp` fix | 0.0% of a dark scene's pixels are zero, down from 89.9% |
| HDR kept | `DISPLAY_P3` display mode, `BT2020_PQ` layer |
| Strength live during playback | yes, 0 reopens |

**Cost** is GPU busy % over the same 30 s of video, with enhancement off and on:

| | off | on | GPU temperature, on |
|---|---|---|---|
| SDR, 1080p | 13.5% | 23.7% | flat, ~39 °C |
| HDR, 4K | 8.5% | **35.0%** | **rising**, 45.3 → 49.7 °C in 30 s |

HDR with enhancement off is cheap because the decoder's frames go straight to the display.
With it on, the cost includes media3's own input and output passes, which any enhancement
pays, plus this effect's pass.

## Known limits

- **HDR runs warm.** GPU temperature is still rising after 30 s. A 10-minute run is needed to
  see where it settles. The cheapest saving is computing only the two PQ channels I needs
  where possible.
- **About 4% even dimming on HDR** with enhancement on. Files that carry only HDR10+ per-frame
  metadata, like The Boys, which has none in the container, lose it on media3's effects
  path, so the display tone-maps the frame differently. Only visible side by side; judge on
  the panel.
- **Not yet checked on device:** debanding on a banded scene, and brightness "pumping" within
  a long shot.
- The GL ES 2 fallback (not hit on any tested device) is the fixed SDR matrix, and ignores
  strength.
