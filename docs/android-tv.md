# Android TV

Written for: the next agent session working on the TV version, and the owner. Start here.
Started 2026-10-23 on branch `tv`; merged into `main` 2026-10-27, after 2.6.0.

## Decisions (owner, 2026-10-23) — do not reopen

- **Same app, same repo, same Play listing.** Android TV is added as a form factor of
  `com.glide.player`, not a separate app or repo.
- **First pass is videos only.** Music, Now Playing, the mini player and haptics are hidden on TV.
- **Navigation is a left side rail** (M3 navigation rail / Android TV pattern), not tabs across the top.
- **No SMB / network shares in the first pass.** Local storage and USB only. SMB is the next big
  piece once the basics work (see Later).
- **Testing:** the owner has an Android TV; first device test 2026-10-24.

## Where the code lives

- On `main`, like the phone app. TV code is gated by `IS_TV`, so phones never reach it.
- **The TV launcher entry is what makes the app appear on TVs and in Play for TVs.** Owner,
  2026-10-27: it stays on `main`, so TV ships with the next release (2.7.0). The open items in
  Status are to be fixed before that tag.

## How TV code is written

- **One flag:** `IS_TV` from `src/utils/tv.ts` (`Platform.isTV`, true when the device UI mode is
  television). Branch on it; never on screen size. Phone behaviour must stay identical.
- **Stock React Native, not react-native-tvos.** Stock RN 0.88 gives D-pad focus to `Pressable`,
  reports `Platform.isTV`, and still honours `hasTVPreferredFocus` on Android (deprecated; it
  requests focus when the prop is set, possibly before the view is on screen, so don't rely on it
  alone). It has no `TVEventHandler` or `TVFocusGuideView`. Remote keys the player needs come from native code (`dispatchKeyEvent`
  in the player activity, emitted to JS). Only switch to react-native-tvos if focus control turns
  out to be unworkable — it is a fork of RN and would affect the phone build too.
- **Focus is the TV equivalent of touch.** Every interactive element must be reachable with the
  D-pad and show a clear focus state. Put focus handling in the shared primitives
  (`src/components/ui/index.tsx`: Touchable and friends), not per screen.
- **10-foot UI:** larger type and spacing on TV, overscan-safe margins (about 48 dp horizontal,
  27 dp vertical), landscape only.
- **Back:** closes the topmost thing first (sheet, panel, overlay, controls), then goes to Videos
  from another top-level destination, then exits from Videos.
- **No touch-only features on TV:** gestures, haptics, brightness, PiP, rotation lock, shake.
- **Phone work reaches TV too.** Every phone change ships on TV, so a new button or screen must
  be D-pad reachable with a focus state, or hidden with `IS_TV`.

## Phase 1 — videos on TV (in progress, 2026-10-23)

Built by four parallel agents, each owning separate files:

| Area | Files | What |
|---|---|---|
| Focus system | `ui/index.tsx`, `theme/**`, `VideoRow.tsx`, `FoldersScreen`, `AlbumVideosScreen`, `Skeleton.tsx` | Focus ring on every primitive, focusable library rows and cards, focus-follow scrolling, TV sizing and overscan margins, focus moving into sheets and dialogs |
| Navigation and manifest | `src/navigation/**`, `MiniPlayer`, `AndroidManifest.xml`, banner in `res/` | Left side rail (Videos, Recents, Settings), music routes unreachable, Back behaviour, `LEANBACK_LAUNCHER`, banner, touchscreen and leanback marked not required |
| Player remote | `VideoPlayerScreen`, `components/VideoPlayer/**`, `TrackSelector`, `FloatingSyncPanel`, `hooks/video-player/**`, player Kotlin | Native key bridge; OK to play/pause, Left/Right to seek, Up/Down to show controls; focus inside controls and panels; phone-only player features hidden |
| Other screens | Settings, Recents, Onboarding, PlayerDetail, Search | Phone-only settings hidden, video-only Recents, onboarding usable with a remote, Play focused first, search with the TV keyboard |

Results, open issues and the device checklist: see **Status** below.

## Phase 2 — after the first device test

- Fix what the device test finds (focus traps, wrong initial focus, sizing).
- Play's TV quality checklist: full D-pad navigation, no touch-only controls, banner, TV
  screenshots (1920×1080), no portrait-only screens, the app not crashing without a touchscreen.
- Media keys from TV remotes and HDMI-CEC (play/pause/seek) through the existing MediaSession.
- "Continue watching" row at the top of Videos (TV home pattern). **Built 2026-10-27, passed on
  the owner's TV the same day:** up to 10 part-watched videos (same rule as the resume prompt), last watched
  first, missing files hidden as in Recents; its first card takes focus, else the first folder.
  The folder sort bar moves under it, inside the list, on TV only. Cards have no options (no ⋮
  on TV cards; Recents has them).

## Later

- **SMB / network shares** (backlog F: "SMB/WebDAV (L)"): browsing, credentials, playback over
  the network. The main reason people install a media player on a TV.
- TMDB posters and a poster-first library.
- Music on TV.
- Android TV home screen channels / "Watch Next" integration.

## Release

- Play reviews TV apps separately (Android TV quality review). Needs TV screenshots and a TV
  banner, and the store listing must mention TV.
- To hold TV back from a release, remove the `LEANBACK_LAUNCHER` category (and the CI step
  below) so TVs don't get a half-finished app. All other TV code is harmless on phones behind
  `IS_TV`.
- Hand-written release notes as usual (`release-notes/X.Y.Z.txt`, see AGENTS.md).
- **CI builds no separate TV app:** the tag's AAB is the TV build too. The release job's "Verify
  Android TV compatibility" step (`aapt2 dump badging` on the universal APK) fails the tag if the
  TV launcher entry or banner is missing, or if anything requires hardware TVs lack
  (touchscreen, faketouch, telephony, camera, GPS, microphone, accelerometer, portrait), declared
  or implied by a permission. If TV is held back at merge time (launcher entry removed), remove
  this step too or the phone release will fail.

## Testing

- Build: from `android`, `./gradlew assembleRelease -PallowDebugSigning=true`
  (debug-signed release build, same as phone testing).
- Connect the TV: Settings → Device preferences → About → press Build 7 times; then Developer
  options → USB / network debugging on. `adb connect <tv-ip>:5555` (older TVs) or Wireless
  debugging with a pairing code (Android 11+ TVs), like the phone.
- Install: `adb -s <tv> install -r android/app/build/outputs/apk/release/app-release.apk`.
- Without a TV: Android Studio's Android TV (1080p) emulator; the D-pad is on the emulator's
  extended controls.
- Record the screen to review focus movement frame by frame: `adb shell screenrecord`, then
  ffmpeg to tile frames (worked well for the phone tab bar on 2026-10-22). Record to
  `/data/local/tmp`, not `/sdcard`: MediaStore indexes anything there and it shows up in Videos.
- **Set `package.json` to a version with no published OTA** (locally, never committed) before
  building a TV test APK. Stallion serves the bundle published for the app's version; with the
  phone's version, the second launch swaps in the live phone bundle, which has no TV code.
- Which view has focus, exactly (no timing guesswork): `adb shell dumpsys activity top`, the
  Glide section, the line whose second flag group starts `.F`. Keep presses under ~0.5 s apart
  in the player or the controls auto-hide between steps.
- The owner's TV (Mi TV AXSO0, Amlogic, Android 9, 1280×720 at 213 dpi) draws video on a
  hardware layer: `screencap` and `screenrecord` show the picture black. It plays fine.
- A debug build with Metro works over network adb (`adb reverse tcp:8081 tcp:8081`) but runs JS
  too slowly on this TV to judge timing; use it for where focus goes, release builds for feel.

## Status

**2026-10-23: Phase 1 written.** tsc clean, jest 33 suites pass. The
TV APK builds (`assembleRelease -PallowDebugSigning=true`) and passes the CI "Verify Android TV
compatibility" check locally. The worktree has its own `node_modules` (`npm ci`): the junction
to `C:\glide
ode_modules` broke Metro's bundle step.

Built:
- **Focus:** ring + TV grow + focus tint in `Touchable`; `preferFocus` (TV-only, released after
  first blur so FlashList recycling can't steal focus back); `focusRing={false}` opt-out; toggle
  rows are one stop on TV; sheets/dialogs hide the close X on TV and start focus on content;
  `TV_SCALE` 1.2, gutter 48, overscan 27, 3-column grid; grid default on TV; card ⋮ hidden on TV
  (options via list view's row → Right → ⋮).
- **Shell:** `SideRail` (80 dp, opens to 240 dp on focus) on `tabBarPosition: 'left'`; Videos,
  Recents, Settings; music routes and "Open with" for audio disabled on TV; Back → Videos → home.
- **Screens:** Settings hides lyrics, brightness, PiP, gestures & haptics; Recents video-only;
  onboarding one slide at a time with Next/Skip; PlayerDetail focuses Play; Search 48 dp pads.
- **Player:** native `TvRemoteModule` + `GlideBaseActivity.dispatchKeyEvent`; JS sets the mode
  (OFF / HIDDEN / FOCUS) so there's no per-key round trip; `useTvFocusScope` traps focus in
  panels and overlays and restores it to the opener; seek ±10 s with hold-to-accelerate; media
  keys: play/pause left to the MediaSession, FF/RW/next/prev taken by the player; PiP, lock,
  rotation lock, haptic marks, shake, brightness swipe hidden on TV.
- **CI:** "Verify Android TV compatibility" step (tested against the phone APK: correctly fails
  there on missing launcher entry, banner, and implied faketouch).

**2026-10-23: first device test** (owner's Mi TV, release build). Passed: banner in Apps (1),
onboarding (2), Allow access (3), Videos focus and rail (4), rail pages and Back (5), album first
video focused (6), PlayerDetail Play focused, Continue watching focused, every player control
reachable (9), Playback panel in/out with focus back on its opener (10).

Fixed on the device:
- **Fabric hoists children out of a View that is not a stacking context**, even one with a
  background or a ref. The player screen, the error card and every overlay scope had no native
  children, so containment thought every control was outside the player and snapped focus back
  to Play on each press ("can't move between the controls"). All scopes are `collapsable={false}`.
- Focus could escape an overlay without a key press (a view re-created under it): the native
  module now watches global focus changes and pulls it back into the topmost overlay.
- The player opened with focus on the back arrow (Android's first pick; OK left the video). It
  now starts on Play, and an overlay the app opened itself (Continue watching, an error) returns
  focus to Play, not to that first pick.
- Left from the page opened the rail on whichever item was level with the card (often
  Settings); entering the rail now goes to the current tab's item.
- Onboarding's Next showed no focus (dark ring on a dark button): ring drawn outside the edge.
- "Allow access" takes focus; the sheet close X is hidden on TV (Back closes).

Second pass, same day (owner's list after the first test):
- **Thumbnails** come from media3's FrameExtractor (`media3-inspector-frame`, hardware decoder
  first, as playback does), falling back to MediaMetadataRetriever; a flat single-colour frame
  from any source, the system's included, is never cached. Fixes green 10-bit HEVC thumbnails on
  Android 9 (the system thumbnailer and MediaMetadataRetriever fall back to the Amlogic decoder,
  which returns an empty frame). Not TV-only. `Credits.kt` still uses MediaMetadataRetriever.
- **Sliders are steppers on TV** (`ui/TvStepper.tsx`: − value +, focusable buttons; stock RN
  has no D-pad keys outside the player): Settings, playback speed, colour strength, EQ bands.
- **Subtitle Size and Position** steppers in the player's Subtitles panel (Built-in and Files
  tabs); position is "N% up", live.
- Panels are up to half the screen wide on TV; controls auto-hide after 8 s on TV (3 s on
  phones), each key restarting it; no Recap on TV (`RECAP_AVAILABLE`); dark theme by default.
- Play and ±10 are squircle plates on TV, so their focus rings are squircles.
- Back to Videos from another tab lands on the rail; Play takes focus as the player mounts.
- **Splash on Android 9:** it was white (TVs report light mode; the logo is white) and still
  (the compat splash can't animate before Android 12). `values-television` makes it black, and
  below Android 12 MainActivity plays the logo morph on the splash's own view.

**Display modes on the Mi TV (2026-10-23, open).** The pill and Display row change nothing with
colour enhancement off, and work with it on. Not a Glide bug: JS, the SurfaceView and
SurfaceFlinger all get every mode right (`dumpsys SurfaceFlinger`, "HWC layers": display frame
and source crop change per mode). The layer is composed as `Device`, Amlogic's hardware video
plane, which ignores them; it ignores Original size even at open. With enhancement on, frames come
from GL, the layer is `Client` (GPU) and the modes apply, but the GPU composes into the TV's
1280×720 UI framebuffer (`Calibration: (1280x720)->(1920x1080)`): the owner saw a large quality
loss, on top of GL's HDR → SDR. Tried and reverted: GPU playback on TV only for Crop / Stretch /
Original (re-open on switch was annoying, quality poor). `/sys/class/video/axis` (Kodi's way) is
not readable without root; the TV's own menu has no aspect option. **Decision: display modes and
colour enhancement are hidden on TV** (pill, Display row, enhancement button and panel toggle,
onboarding bullet), and the player gets `contain` and no enhancement there whatever the stored
settings say. Still to test: a portrait or 4:3 video, Fit vs Stretch (temporarily un-hidden).
If they differ, the plane follows the display frame and only drops the crop: Auto/Fit/Stretch
could come back on TV.

Known gaps:
- PlayerDetail needs a TV layout (owner: "needs to be better").
- After choosing a subtitle track, focus once went to the back arrow instead of the Subtitles
  button (choosing an audio track returns to Audio correctly); not reproduced cleanly.
- Not yet tested on the device: remote media keys (11), Up next (12), sofa readability (13),
  phone regression (14).
- Recap text doesn't scroll with the D-pad.
- While Up next shows, the controls can't be reached (Back dismisses the card).
- Back from an album lands focus where Android puts it, not on the folder you came from.
- `hasTVPreferredFocus` reliability on the new architecture is unverified; if it fails, the first
  D-pad press lands on the first focusable view.

TV test checklist (2026-10-24):
1. Glide appears on the TV home screen with the banner (check the banner art).
2. Onboarding: focus on Next; Left → Skip; slides have no haptics or music copy.
3. "Allow access" works with the remote.
4. Videos: a card is focused at start; arrows move one card; Up reaches search/grid button;
   Left reaches the rail and it opens with labels; Right returns and it closes.
5. Rail: OK on Recents/Settings switches page; Back from them → Videos; Back on Videos → TV home.
6. Folder → album opens with the first video focused → OK plays.
7. Album in list view: row → Right → ⋮ → options sheet, focus inside, Back closes.
8. Settings: no lyrics/brightness/PiP/haptics rows; toggles are one stop; sliders and swatches
   reachable.
9. Player: Resume card focused; controls hidden → OK pauses (once), Up → Play, Down → seek bar,
   Left/Right seek ±10 s, hold accelerates; controls showing → focus never leaves the player,
   doesn't auto-hide while pressing; Back hides controls, then exits.
10. Player panels (⋮, Audio, Subtitles, Playlist, Bookmarks): focus enters, can't escape, Back
    steps back/closes, focus returns to the opener. Sync panel the same.
11. Remote media keys: play/pause, FF/RW, next/prev.
12. Up next at the end: focus on its Play; error card holds focus.
13. Text readable from the sofa; nothing cut off at the edges.
14. Phone regression: run the phone build once; everything as before (bottom bar, gestures, PiP).
