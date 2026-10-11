# Glide hardening roadmap

Written for: the next agent session picking this up, and anyone reviewing the plan.

Status as of the Phase 3/4/5 commits (2026-10-09). Phases 0, 3, 4 and 5 are done and
committed on `main`, bar the two items named under "Left undone". Nothing below has been
tested on a device.

## Context that changes priorities

Glide ships as **GitHub Release APKs plus Stallion OTA**, not Google Play
(`docs/hardening-plan.md:92`). So Play deadlines, Play wake-lock penalties and the
`REQUEST_INSTALL_PACKAGES` policy block **do not apply**. Supply-chain and OTA integrity
matter much more than Play compliance.

**2026-10-11: no JS-over-native preference until launch.** Glide is not live, so a change
needing a new APK costs nothing today. The "prefer JS so it ships over the air" rule, the
Phase 8 "native freeze" framing and "policy lives in JS where an OTA can tune it" below are on
hold: every fix goes where its root cause is, native or JS, with no workarounds. Revisit at
launch.

Verification commands used throughout:

```
npx tsc --noEmit
npx jest
cd android && ./gradlew :app:compileDebugKotlin :app:testDebugUnitTest
```

All three are green at `7bd7e0f`.

---

## Done (committed)

### `8221a3a` fix(player): keep the session, PiP and boost correct
- Deferred `stopServiceIfIdle` to the main looper, so opening a second video no longer
  destroys the new player's MediaSession and foreground service.
- Video notification now targets the Activity the video is playing in
  (`GlidePlayerHolder.videoHostActivity`), `SINGLE_TOP` only. `CLEAR_TOP` was finishing
  VideoPlayerActivity on tap.
- Replaced `LifecycleEventListener` (process-wide, fires for whichever Activity moved
  last) with per-Activity `ActivityLifecycleCallbacks` on the view's own host.
  `onActivityStopped` is now the single pause signal: PiP and split-screen stay started,
  so both play on, and dismissing PiP stops the Activity. No ordering dependence.
- `getHostActivity()` unwraps the view's own context, which also fixes `GlidePipController`
  binding PiP to the wrong Activity.
- Volume boost: `getAudioDevicesForAttributes(USAGE_MEDIA)` on API 33+, port scan below.
  Unknown device types count as speaker. (The first attempt used
  `activePlaybackConfigurations`, API 34 — would have thrown `NoSuchMethodError` on
  Android 8–13, uncatchable by `catch (Exception)`.)
- `playerStoppedRef` reset on seek, load and play — scrubbing back from the end no longer
  freezes time tracking.
- `density` added to `configChanges` on both Activities (foldables).

### `caa3823` fix(player): open the second file sent to an open player
- `VideoPlayerActivity.onNewIntent` emits `onNewVideoUri`; `VideoPlayerRoot` resolves and
  resets the route. Re-opening the file already playing is ignored.
- New native `MediaStoreAudioModule.getMimeType(uri)` (ContentResolver, falls back to
  `MimeTypeMap`).
- `DeepLinkService`: extensions now read from the last path segment only
  (`com.foo.tsprovider` is not a `.ts` file). `isOpenableAudioUri` is a shape check;
  `isAudioContent` asks the system and is what stops a video opening in the music player
  (the `Linking` url event is process-wide).

### `e919b33` fix(library): keep history per file and play folders in order
- `findHistoryEntry`: path first, then `contentUri`, and the name-only fallback is limited
  to non-local URIs. **Trade-off: renaming or moving a file loses its history.**
- `sortVideosByName` inside `useAlbumVideos`, so the folder screen, playlist panel and
  next/previous all agree. MediaStore returns `DATE_MODIFIED DESC`, which played E01 after
  E02.
- `bucketId` threaded through every route, so folders sharing a name stop merging.
- `deleteVideos` resolves paths to MediaStore URIs and rejects on failure instead of
  reporting success.

### `7bd7e0f` refactor(player): stabilise player callbacks and share the equalizer
- `usePlayerCore` reads its options through `optsRef`, plus a `durationRef`. The handlers
  now keep one identity, so `player` only changes when `state` does. This was defeating
  `PlayerControls`'s memo and rebuilding the whole gesture tree on every render.
- One `exitPlayer()` guarded by `exitedRef`, called from `handleGoBack`, `beforeRemove`
  and unmount. Save and `stop()` used to run three times per exit.
- `GlideEqualizer` object shared by `GlidePlayerView` and `GlideAudioPlayerModule`.
- `PlayerErrorPolicy` extracted: stops retrying permanent errors 2004–2007 (was costing
  ~5s before showing the user the failure) and handles `BEHIND_LIVE_WINDOW`.
- `setAudioTracksFromNative` / `setSubtitleTracksFromPlayer` typed properly; both
  `as any` casts gone.
- Deleted `src/utils/debounce.ts` and `indexProgress` (could never be non-null).
- `useVideoSearch` now uses per-field selectors instead of subscribing to the whole store.
- New JVM tests: `AudioRouteTest`, `GlideEqualizerTest`, `PlayerErrorPolicyTest`.

### `34ea9e4` perf(music): offload audio playback and stop the background ticker
- DSP audio offload while the equalizer is flat (`GlideEqualizer.isFlat` decides, because
  offload bypasses the audio session `audiofx.Equalizer` attaches to). Unverified: whether
  an equalizer left attached at 0 dB still blocks offload on some devices.
- The music player now builds the same `DefaultRenderersFactory` the video view does:
  `EXTENSION_RENDERER_MODE_ON` plus decoder fallback, so AC-3/E-AC-3/DTS/ALAC stop
  selecting no track and playing silently.
- `GlideAudioPlayerModule` is a `LifecycleEventListener`: in the background the progress
  event slows from 500 ms to 5 s (not off -- `audioStore` saves the position from it, so a
  killed app resumes close to where it was) and snaps back with one position on resume.
- `audioStore` persists track **ids**, not records. Hydration resolves them against
  MediaStore; the saved current track is put back into the queue when the library cannot
  resolve it (a file opened from Files, or a deleted song). The old `@glide_audio_queue`
  key is converted to ids in place on first read. `togglePlayPause`, `playNext` and
  `addToQueue` wait for hydration (5 s ceiling) so they never act on the empty queue.

### `75651bc` perf(player): keep background work out of playback's way
- `setScrubbingModeEnabled(!exact)` in `GlidePlayerView.seekTo`. The suppression it causes
  is not reported as a pause (`onIsPlayingChanged`), and `setPaused` turns it off as a
  backstop.
- New `BackgroundWork` at `THREAD_PRIORITY_BACKGROUND`, two lanes: `submitLong` (one
  thread) for subtitle extraction and alignment, `submit` (two threads) for scans,
  metadata and track listing, so a long decode never stalls a screen. **No
  cancellation** -- every task owns a Promise that has to settle; see the `ponytail:` note.
- `MediaService.getLibrary` / `AudioMediaService.getSongs` share one in-flight scan. A
  forced refresh or `invalidateCache` starts a new one, and only the newest may write the
  cache.
- Preferred audio languages seeded from the device locale before `prepare`. Subtitles use
  `setPreferredTextLanguageAndRoleFlagsToCaptioningManagerSettings`, deliberately: seeding
  a text language would switch subtitles on for everyone.
- `useHapticFeedback` interpolates from the last position event with wall clock and the
  playback rate, capped at 0.3 s so a stall or a resume cannot run cues ahead. Paused it
  polls at 500 ms rather than stopping, so a seek while paused still updates the cue.
- History: 20 s interval, a save on pause, and `prune()` capping at 500 entries while
  keeping anything bookmarked.

### `21dce13` perf(ui): stop lists re-rendering and defer screens past first frame
- `VideoRow`/`VideoCard`/`ContinueCard` are generic over the item and hand it back, so
  screens pass one stable callback. `TrackRow` takes the track back and is told whether
  **it** is playing.
- Entering springs removed from FlashList cells (they replayed on recycle).
- `getComponent` for VideoPlayer, NowPlaying, PlayerDetail, Onboarding, Search and the
  music detail screens. `freezeOnBlur` per screen -- **not** on `MainTabs`, because Now
  Playing is a transparent modal and the mini player keeps animating underneath it.
- `ThumbnailService` memoises resolved paths (hits only; a miss is retried) and
  `cancelRequest` takes a token, so one row giving up no longer strands another waiting on
  the same video. A key being generated keeps its entry, so a returning row joins it.
  Known gap: a memoised `file://` path goes stale if Android trims the cache directory
  mid-session.

### `dc3bba9` perf(build): halve the update download and drop dead build config
- `useLegacyPackaging true`. arm64 release APK measured at **15.5 MB** after, against the
  ~31 MB the roadmap recorded. Install size and cold start are still unmeasured.
- Blanket R8 keeps for reanimated, svg, screens, safeareacontext and rnziparchive gone;
  release build verified green with them removed.
- `project.ext.vectoricons`, the JSC flavour and the `<queries>` block deleted.
- `react-native-markdown-display` replaced by `parseNotes` in `UpdateNotes.tsx`.
- Proxy serves its last good release for an hour when GitHub fails, and waits 60 s
  before asking GitHub again.
- CI: a `proxy` job (`tsc -p proxy`), and a 16 KB check that reads every arm64 library's
  ELF LOAD-segment alignment. Not `zipalign -P 16`: the libraries are compressed now, and
  zip alignment says nothing about them. All 25 measured at 0x4000 today.

### Phase 5 remainder
- `usePlayerHUD`: every `HIDE_*` returns the same state when already hidden, and
  `showSeekHUD`'s stale-`state` skip is gone (`SHOW_SEEK` makes the same check correctly).
- `ErrorBoundary` has `getDerivedStateFromError`, and the player screen has its own
  boundary via the stack's `layout` prop, so a player crash leaves the navigator alive.
- The forward references in `VideoPlayerScreen` (`bookmarksHook`, `player`, `tracksHook`)
  go through refs filled right after the hooks run.
- Cue eviction decided: `SubtitleCueStore`'s LRU of five is the bound, and the
  `evict()` on unmount is gone -- it threw away the entry the LRU exists to keep.

---

### Needs a device before trusting
1. PiP: expand, and dismiss, with background play off.
2. Video notification tap — from the library, and from "Open with".
3. A second "Open with" while the player is running.
4. Volume boost on speaker, wired, Bluetooth, and after unplugging mid-boost.
5. Fold/unfold on a foldable.
6. Android 17 background audio: `adb shell cmd audio set-enable-hardening throw`.
7. Audio offload: music on a device that supports it, then change an equalizer band and
   confirm the change is audible (offload has to drop out for the effect to apply).
8. Scrubbing mode: drag the scrubber across a long 4K file and watch for a stuck frame.
9. Install size and cold start after `useLegacyPackaging`, against the previous release.
10. The player error boundary: force a render crash and check the navigator survives.
11. A queue restored from ids after a cold start, including one built from "Open with".

---

## Left undone

1. **`VideoPlayerScreen` is still a 1400-line god component.** The forward-reference
   hazard is fixed, but position, playing state and tracks still live in two or three
   places each (refs, shared values, React state, native). A per-screen controller is the
   real fix, and it is the one item here that cannot be checked without a device. Do it
   before adding big player features, not after.
2. **No Robolectric test for `GlidePlayerHolder`.** Covering the start/clear/attach
   ordering needs Robolectric plus a real `GlidePlayerService` (whose `onCreate` builds a
   `MediaLibrarySession`), which is a heavyweight new test dependency and a slower CI run
   for one ordering case. The decision is reversible; it is recorded here rather than
   taken silently.
3. **No Baseline Profile or Macrobenchmark module.** Generating a profile needs a device,
   so the module would be scaffolding that nothing runs until one is available.
4. `runOnJS` -> `scheduleOnRN` (63 call sites) skipped, as the roadmap itself rated it:
   mechanical, low value.

---

## Phase 1 (security) — highest severity first

Done: 2 and 4 in `356efea` (`PrivatePath`, `onConnect`), and 9 in `17dfba6`. Device
checks: an `adb` "Open with" of `file:///data/data/com.glide.app/...` is refused by both
Activities, and Android Auto and a Bluetooth head unit still browse the music library.

1. **Stallion OTA bundles are unsigned.** `StallionPublicSigningKey` is never set
   (`android/app/build.gradle:145-146`), and Stallion only verifies when it is present. A
   compromised Stallion account or CI token means arbitrary JS running with every native
   module, including `ApkInstallerModule`, on every install, with no APK change. **Top
   security item.**
2. **Confused deputy via `_data`.** `SimpleThumbnailModule.kt:191-204` trusts a
   provider-supplied `_data` column, so any app can send `content://evil/x` resolving to
   `/data/data/com.glide.app/...` and have Glide open it with its own permissions; the path
   then flows into history and Recents. (Share no longer can: since 2026-10-11 it sends only
   a MediaStore entry, and the FileProvider with `cache-path "/"` is gone.)
   Only trust `_data` when `uri.authority == "media"`; reject `file://` under `/data/`.
3. **CI supply chain.** The release job holds the keystore and `contents: write` but pins
   actions by tag, not SHA; no wrapper validation, no `distributionSha256Sum` (the FFmpeg
   AAR checksum is done, see 8b). Secrets are interpolated into an unquoted heredoc
   (`android-ci.yml:45-58, 195-208`) — a `$` or backtick silently corrupts the baked key.
   Also verify the signing cert SHA-256 before publishing.
4. **`GlidePlayerService` has no `onConnect`** — exported, so any app can browse the whole
   music library without the media permission.
5. **Subtitle size caps**: nothing bounds the SubDL zip download, the extracted file, or
   `readFile` (`SubtitleExtractor.ts:108` stats but only logs). Zip bombs are unhandled.
   Accept `https:` only for `downloadUrl`.
6. **SubDL/OMDB keys behind the worker** (Groq already is). Not just key hiding: the OMDB
   key is 1000 req/day shared by every user, and nothing caches.
7. **`/v1/recap` has no client auth** — per-IP rate limits exist, but add an install token
   and a daily spend cap.
8. **Crash reporting**: no Sentry, no `ErrorUtils.setGlobalHandler`; `ErrorBoundary` only
   logs, and `App.tsx:130` uses `console.log`, which release babel strips. A bad OTA leaves
   users on the error screen with no rollback.
9. **Onboarding claims "zero data collection"** (`OnboardingScreen.tsx:105`) — false:
   Stallion sends `ANDROID_ID` on every sync, recap sends dialogue to Groq. Reword.
10. ~~FFmpeg ships with no LGPL notice~~ **Done.** Settings → About → Open source licences:
    every dependency with its own LICENSE text, plus FFmpeg (notice, full LGPL 2.1 text,
    link to its unmodified `release/6.0` source), Media3, AndroidX and Kotlin. Generated
    by `node scripts/gen-licences.js` into `src/data/licences.json`; a Jest test fails when
    a dependency is added without regenerating. Linking is LGPL-shaped since 8b.

## Phase 2 (error handling and subtitles)

- Playback errors show raw codes (`ERROR_CODE_DECODING_FORMAT_UNSUPPORTED`) in a red box
  with no action. Map ~8 codes to plain language; add Retry / Next / Open with.
- Subtitle failures are silent (`TrackSelector.tsx:405-407, 470-474, 487-491`); use the
  existing `showSnackbar`. Offline search shows "No results", which is misleading.
- Subtitle picker `type: ['text/*', ...]` greys out valid `.srt`/`.ass` labelled
  `application/octet-stream` — use `*/*`, the extension is already checked.
- All subtitle reads are hard-coded UTF-8 — CP1251/1256/GBK come out garbled, and a BOM
  makes the first cue index `NaN`. Use `android.icu.text.CharsetDetector` natively.
- Parser drops valid cues: VTT without hours (`00:01.000`), SRT with 1-digit hours or `.`
  milliseconds, blocks with no index line. SubDL downloads are always parsed as `'srt'`.
- Video permission denial is a dead end (`FoldersScreen`); the Music tab already has the
  right screen (`MusicScreen.tsx:416-436`) — port it.
- Update modal reappears every cold start (`updateStatus` is memory-only) and the GitHub
  check runs unthrottled.
- `ApkInstallerModule.kt:149-158`: if the app is backgrounded when the download finishes,
  `startActivity` is silently blocked, `pendingPromise` never settles, and every later
  attempt gets `INSTALL_BUSY` until the process dies.
- `LyricsService.ts:196-202` caches `null` on network failure, so lyrics stay missing all
  session.
- `picked_subtitle_*` cache files are never deleted (cleanup only matches `^subtitle_\d+`).

## Phase 6 (UX and accessibility)

- Fixed `height` clips text at 200% font scale: tab bar (64), mini player (56), Button
  (40/48), Chip (34), speed chip (28, also under the 48dp touch target). Use `minHeight`.
- `textTertiary` fails WCAG AA (3.0:1 light, 3.4:1 dark) and is used for real text.
- `ListRow` sets `accessibilityLabel={title}`, which hides the value — TalkBack reads
  "Audio" not "Audio: English", across Settings and Quick Settings. Toggle rows also give
  two focus stops.
- `numColumns` hardcoded to 2 on five screens; derive from `useWindowDimensions`. Now
  Playing artwork caps at 330dp with no two-pane landscape layout.
- Grid/list and sort choices live in `useState` and reset every launch.
- Hide the rotation-lock toggle at ≥600dp — Android ignores it there under API 36.
- `supportsRtl="true"` with zero `I18nManager` usage and 101 physical left/right offsets;
  call `I18nManager.allowRTL(false)` until translations exist.
- PiP on Android 8–11 needs `onUserLeaveHint`.
- Folder screen has no sort options.
- Onboarding's invisible Skip/Next stay focusable for TalkBack.

## Phase 7 (features for best-in-class)

Ranked: network sources (Open URL + HLS/DASH first, then SMB/WebDAV/DLNA) → library
control (hide folders, `.nomedia`, private folder, multi-select, flat "All videos",
watched filters) → decoder control (per-file HW/SW like MX, plus a stats overlay) →
screenshot / A-B repeat / frame step → keyboard and mouse shortcuts and large-screen
layouts → casting → i18n for ~340 hard-coded strings.

## Phase 8 (native freeze before Play) — from the 2026-10-10 native review

Goal: native changes only with an APK, and Play users sit on old APKs for months, so the
native layer has to be finished before launch. JS keeps moving over Stallion. Five
read-only reviews (player core, music/audio, media I/O, dependencies, platform) against
Media3 1.11.1 bytecode, RN 0.87 source and the Android 16/17 docs.

**Done in `c0762a0`:** fragment-restore crash, `BackgroundWork` `Throwable` guard,
album-art OOM, splash timeout, play from IDLE/ENDED (music and video), `onTaskRemoved`
without `super`, video session re-registered on resume, thumbnails off `v_native` and
actually scaled (they were saved full-size), Auto/Assistant unresolvable ids, haptic
crash paths, equalizer leak and flat-means-off, fixed-volume keys, `AudioVolumeModule`
reload leak. Dead FFmpegKit methods deleted.

### 8a. Contract and architecture — done

All four landed together (see the commit after `9e816d6`). Device checks before trusting:
Bluetooth Play with Glide force-stopped resumes the last queue; the Android 13+ resume card
appears; one notification follows music -> video -> music with no stale one left; Auto
lists Glide once and a song picked there pauses an open video; EQ and a 1-minute sleep
timer survive a JS reload (shake menu) mid-song; `NativeModules.GlideNative.apiLevel` is 1.

1. **Native capability contract.** Nothing tells a JS bundle which native it runs on. Export
   one `NATIVE_API` integer (bump on any native surface change), gate new calls in JS on
   it, and target every Stallion release at the app version. Principle from here on:
   native exposes primitives and stays dumb; policy (retry counts, intervals, fallbacks)
   lives in JS where an OTA can tune it.
2. **One media session, not two.** Media3 has one notification slot: the music and video
   sessions steal it from each other, a stale video notification's Play starts music, and
   the app shows twice in Auto. Use one `MediaLibrarySession` and swap `session.player`.
   Needs the device matrix.
3. **Playback resumption.** No `MediaButtonReceiver`, no `onPlaybackResumption`: Bluetooth
   Play with Glide killed goes to another app, and Android 13+ shows no resume card.
   Native must persist its own last ids, index and position.
4. **Process-wide music state.** EQ bands and the sleep-timer deadline live in the module,
   so a JS reload or OTA restart drops both while music plays on. Move them to
   `GlidePlayerHolder`; give posted runnables an `invalidated` check.

### 8b. Native correctness — done (brightness range is won't-fix)
All landed in one commit after 8a; `API_LEVEL` is now 2 (`currentActivityName`,
`onVideoLibraryChanged`, commands by name). Sleep timer vs offload landed with 8a. Done:
`setQueue` loads paused when the host is paused; `finishCurrentActivity` only finishes
`VideoPlayerActivity`, and the player's `BackHandler` yields in PiP or when its Activity is
not in front (also the 8c item); scrubbing mode cleared on stop and PiP change; PiP closed
with background play on pauses; `SubtitleSyncModule` releases a codec whose `configure`
throws and falls through to FFmpeg, and the frame-rate read no longer throws; the installer
copies on `BackgroundWork`, abandons stale sessions, and holds the confirm prompt until
resume; orientation on the UI thread; media opened once in `onAfterUpdateTransaction`;
NULL-duration songs listed; a video `ContentObserver` drops the JS library cache (debounced
1.5 s); `configChanges` extended on both Activities; String `receiveCommand` (Int kept for
old bundles), `MapBuilder` gone, `onDropViewInstance` calls `super`; `BEHIND_LIVE_WINDOW`
shares the IO retry budget; audio delay scaled by speed so it stays wall-clock time.

FFmpeg AAR, done: rebuilt by glide-ffmpeg-decoder's CI (`cb773e8`) against Media3 1.11.1,
which was 1.11.0. Its `.sha256` from the same run is committed next to it, and both CI jobs
run `sha256sum -c` before building and check that each release APK still has
`libffmpegJNI.so`, `libavcodec.so`, `libavutil.so`, `libswresample.so` and
`FfmpegAudioRenderer` after R8. Already audio-only where it counts:
only `ac3 eac3 dca mlp truehd` are compiled, so `ExperimentalFfmpegVideoRenderer` supports no
format and is never selected. No emulator renderer-construction test: the APK check catches
the failure that has actually happened. To update: run that repo's workflow, copy both
files from its artifact into `android/app/libs`. Device check: an E-AC-3 or DTS file has
sound.

LGPL linking, done: that repo is private, so nobody else could rebuild a `libffmpegJNI.so`
with FFmpeg fused in. From its 1.1.0 (`1c0ff69`) FFmpeg ships as separate shared libraries
that `libffmpegJNI.so` loads, so a user can swap in their own FFmpeg 6.0 build. Cost +132 KB
on the arm64 APK; all 28 arm64 libraries at 16 KB alignment. The notice and source pointer
are still owed: Phase 1 item 10.

Left:
- `DisplayBrightnessModule` 0-255: won't fix. The OEM's real range is not public API, and
  the window brightness path it uses is already 0-1.

Device checks: Back in the library while a video is in PiP leaves both alone; closing PiP
with background play on stops audio; an update downloaded with Glide in the background
prompts on return; a file copied in via USB shows on the next screen; 200 ms audio delay
sounds the same at 1x and 2x; changing font size or dark mode mid-video keeps playing; the
commands (seek, PiP, stop) work on both an old and a new bundle.

### 8c. JS-side (can ship over the air any time)
- Enhancement GL errors (7000-range codes) fail every video: turn enhancement off and reopen.
- Deleting videos on Android 8/9 needs `WRITE_EXTERNAL_STORAGE` requested first.
- Thumbnail misses retry on every scroll; add a negative cache with a TTL. Thumbnails made
  before `c0762a0` are full-size on disk; clear the folder once.
- `ErrorBoundary` should call `SplashModule.hide()`.

### 8d. Dependencies and toolchain
- **Replace `react-native-linear-gradient`** (stable from 2023, legacy interop, no
  namespace) with react-native-svg's `LinearGradient`.
- ✅ 2026-10-11 `react-native-share` → `MediaStoreVideoModule.shareVideo` (API 6).
- ✅ 2026-10-11 `react-native-zip-archive` → `SubtitleZip.kt` (API 7): reads the chosen entry
  in memory with a 10 MB / 1000-entry cap and never extracts, so zip-slip has nothing to hit.
- Stallion #146: Android bundle download has no timeout and can hang. Take 2.4.3 if fixed.
- Patch upgrades: fs 2.40.3, gesture-handler 3.3.0, safe-area 5.10.1, screens 4.29.0,
  zip-archive 9.5.3, edge-to-edge 1.8.2. Hold reanimated at 4.6.0 until RN 0.88 and
  reanimated #10734 (Android SIGSEGV since 4.7.0) settle.
- ~~GitHub Actions on node20~~ **Done.** Each action is on its lowest node24 major, read
  from its own `action.yml`: `checkout@v5`, `setup-node@v5`, `setup-java@v5`,
  `attest-build-provenance@v3` (a composite; v2's inner predicate action is node20). The
  decoder repo got the same plus `cache@v5` and `upload-artifact@v6` (v5 is still node20).
- Toolchain is pinned by RN and fine through RN 0.88; `builtInKotlin=false`/`newDsl=false`
  die with AGP 10, which only arrives with an RN upgrade.
- Stale comment about react-native-ffmpeg-kit in `android/build.gradle`.

### 8e. Platform deadlines
- **targetSdk 37** (Play deadline likely 2027-08-31, unannounced): `ACCESS_LOCAL_NETWORK`
  runtime permission or LAN http/rtsp streams fail; the large-screen orientation opt-out
  disappears.
- **Android 17 background audio** applies to all apps now: run
  `adb shell cmd audio set-enable-hardening throw` through music, video background play
  and PiP.
- **Developer verification** is enforced for sideloaded apps in Brazil, Indonesia,
  Singapore and Thailand since 2026-09-30, worldwide in 2027. Register `com.glide.app`.
- 16 KB pages: Play rejects non-compliant updates from 2027-02-01. CI already checks.

## Deliberately deferred

- MMKV schema versions: add when the first migration actually needs one.
- Play-specific work (`play` flavor without the self-updater, AAB, media-permission
  declaration) — only if Play distribution ever happens.
