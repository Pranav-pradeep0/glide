# Volume leveler

Written for: the agent session that builds this, after `v2.6.0` is tagged (owner's call,
2026-10-23). Build on `main`; it is a phone and TV feature.

## The problem

Movies are mixed for cinemas: effects and music very loud, dialogue fairly quiet. On 5.1/7.1
tracks dialogue sits almost entirely in the center channel, and the usual fold-down to two
speakers mixes the center in quieter than the rest, so voices get buried. People ride the
volume all film. Nova Video Player's "Night mode" ("dynamically adjust the volume level") is the
reference the owner uses on TV.

## Decisions (owner, 2026-10-23)

- **Name:** "Volume leveler", caption "Quieter action, clearer voices", in the player's Audio
  panel (TrackSelector, Effects tab). Remembered across videos like the equalizer.
- **Keep** today's visual "Night mode" (a 50% black overlay, `VideoPlayerScreen.tsx` style
  `nightMode`, `onToggleNightMode`, `NightModeIcon`) exactly as it is, name included.
- **Remove** the equalizer's "Night Mode" preset: an EQ changes tone, not dynamics; the volume
  leveler is what fixes loud action vs quiet dialogue.
- **Solid, no patching.** One processing stage that works for every codec and decoder. If
  FFmpeg needs a change, change `C:\glide-ffmpeg-decoder\build.properties` and rebuild the AAR
  through that repo's workflow (memory: ffmpeg-decoder-repo), never a workaround in Glide.

## Design

`decoder (any) → all channels → Glide AudioProcessor → AudioSink`

1. **Media3 `AudioProcessor` in Kotlin**, always in the chain (so toggling never rebuilds the
   pipeline or gaps the audio), bypassing itself when off. Wired through the
   `DefaultAudioSink` audio processor chain where the player is built (`GlidePlayerView.kt`).
2. **Full channels in.** While on, keep decoders from downmixing (check
   `MediaCodecAudioRenderer`'s max output channel count and the FFmpeg renderer's output
   layout) so the processor sees 5.1/7.1.
3. **Dialogue-first downmix** to the output layout (stereo on phones and most TVs): center
   about +3 to +6 dB over the ITU fold-down, surrounds and LFE reduced. Media3's
   `ChannelMixingMatrix` / `ChannelMixingAudioProcessor` is the reference for matrix handling.
4. **Compressor → limiter → make-up gain**: fast attack and slower release on loud passages,
   lift quiet speech, a true-peak-safe limiter so nothing clips. Smooth parameter changes on
   toggle (no clicks).
5. **Passthrough off while on** (encoded AC-3/E-AC-3/DTS to a soundbar can't be processed);
   restored when off. Check how the sink's audio capabilities are chosen today.
6. Works alongside the existing equalizer and `LoudnessEnhancer` boost; decide the order
   (leveler before boost) and make sure their gains can't stack into clipping.

## FFmpeg check (not a patch)

FFmpeg's ac3/eac3 decoders apply the stream's own DRC metadata via the `drc_scale` option.
Confirm its default in FFmpeg `release/6.0` and how Media3's ffmpeg JNI opens the codec, so the
leveler doesn't compress audio that FFmpeg already compressed. Only if a change is needed:
`build.properties` + `ARTIFACT_VERSION` bump in the decoder repo, rebuild, copy the AAR and
`.sha256` into `android/app/libs`.

## Verification (automated, ground truth by script)

- JVM unit tests on the processor with generated signals: a loud burst then quiet speech-band
  noise (output range shrinks by a target dB, quiet part rises); a tone on each 5.1 channel
  (center lands louder than the ITU fold-down, LFE reduced); full-scale input (limiter keeps
  samples within range); toggling mid-stream (no discontinuity above a threshold).
- On device: a 5.1 movie with a known quiet-dialogue/loud-action scene, phone speaker and TV.
