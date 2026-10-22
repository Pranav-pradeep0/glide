# Android TV

Written for: the next agent session working on the TV version, and the owner. Start here.
Started 2026-10-23 on branch `tv` (worktree `C:\glide-tv`).

## Decisions (owner, 2026-10-23) — do not reopen

- **Same app, same repo, same Play listing.** Android TV is added as a form factor of
  `com.glide.player`, not a separate app or repo.
- **First pass is videos only.** Music, Now Playing, the mini player and haptics are hidden on TV.
- **Navigation is a left side rail** (M3 navigation rail / Android TV pattern), not tabs across the top.
- **No SMB / network shares in the first pass.** Local storage and USB only. SMB is the next big
  piece once the basics work (see Later).
- **Testing:** the owner has an Android TV; first device test 2026-10-24.

## Where the code lives

- Branch `tv`, in its own worktree `C:\glide-tv`, so `C:\glide` stays on `main` for the 2.6.0
  phone release. The worktree has its own `node_modules` (`npm ci`); a junction to the main
  checkout's breaks Metro's release bundle.
- **After `v2.6.0` is tagged,** merge `tv` into `main` and continue on `main` (owner commits on
  `main`). TV code is gated by `IS_TV`, so phones never reach it. Delete the worktree after the
  merge (`git worktree remove ../glide-tv`).
- **The TV launcher entry is what makes the app appear on TVs and in Play for TVs.** It is on the
  `tv` branch. Before merging into `main`, decide: keep it (TV ships with the next release) or move
  it out until TV is ready (see Release).

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
- **Phone work reaches TV too.** Every phone change ships on TV after the merge, so a new button
  or screen must be D-pad reachable with a focus state, or hidden with `IS_TV`. Until the merge,
  bring `main` into `tv` with `git merge main` in `C:\glide-tv` after each batch of phone work
  (AGENTS.md "Android TV" says the same for every session).

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
- "Continue watching" row at the top of Videos (TV home pattern).

## Later

- **SMB / network shares** (backlog F: "SMB/WebDAV (L)"): browsing, credentials, playback over
  the network. The main reason people install a media player on a TV.
- TMDB posters and a poster-first library.
- Music on TV.
- Android TV home screen channels / "Watch Next" integration.

## Release

- Play reviews TV apps separately (Android TV quality review). Needs TV screenshots and a TV
  banner, and the store listing must mention TV.
- If TV is not ready when `tv` merges into `main`, remove the `LEANBACK_LAUNCHER` category before
  the next phone release so TVs don't get a half-finished app. All other TV code is harmless on
  phones behind `IS_TV`.
- Hand-written release notes as usual (`release-notes/X.Y.Z.txt`, see AGENTS.md).
- **CI builds no separate TV app:** the tag's AAB is the TV build too. The release job's "Verify
  Android TV compatibility" step (`aapt2 dump badging` on the universal APK) fails the tag if the
  TV launcher entry or banner is missing, or if anything requires hardware TVs lack
  (touchscreen, faketouch, telephony, camera, GPS, microphone, accelerometer, portrait), declared
  or implied by a permission. If TV is held back at merge time (launcher entry removed), remove
  this step too or the phone release will fail.

## Testing

- Build: from `C:\glide-tv\android`, `./gradlew assembleRelease -PallowDebugSigning=true`
  (debug-signed release build, same as phone testing).
- Connect the TV: Settings → Device preferences → About → press Build 7 times; then Developer
  options → USB / network debugging on. `adb connect <tv-ip>:5555` (older TVs) or Wireless
  debugging with a pairing code (Android 11+ TVs), like the phone.
- Install: `adb -s <tv> install -r android/app/build/outputs/apk/release/app-release.apk`.
- Without a TV: Android Studio's Android TV (1080p) emulator; the D-pad is on the emulator's
  extended controls.
- Record the screen to review focus movement frame by frame: `adb shell screenrecord`, then
  ffmpeg to tile frames (worked well for the phone tab bar on 2026-10-22).

## Status

**2026-10-23: Phase 1 written, not yet run on a device.** tsc clean, jest 33 suites pass. The
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

Known gaps:
- Sliders (playback rate, EQ bands, enhancement strength) can't be adjusted with the D-pad.
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
