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

## Phase 1 (security) — not started, highest severity first

1. **Stallion OTA bundles are unsigned.** `StallionPublicSigningKey` is never set
   (`android/app/build.gradle:145-146`), and Stallion only verifies when it is present. A
   compromised Stallion account or CI token means arbitrary JS running with every native
   module, including `ApkInstallerModule`, on every install, with no APK change. **Top
   security item.**
2. **Confused deputy via `_data`.** `SimpleThumbnailModule.kt:191-204` trusts a
   provider-supplied `_data` column, so any app can send `content://evil/x` resolving to
   `/data/data/com.glide.app/...` and have Glide open it with its own permissions; the path
   then flows into history, Recents and Share (whose FileProvider exposes `cache-path "/"`).
   Only trust `_data` when `uri.authority == "media"`; reject `file://` under `/data/`.
3. **CI supply chain.** The release job holds the keystore and `contents: write` but pins
   actions by tag, not SHA; no wrapper validation, no `distributionSha256Sum`, no checksum
   on the committed FFmpeg AAR. Secrets are interpolated into an unquoted heredoc
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
10. **FFmpeg ships with no LGPL notice**; add an OSS licences screen.

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

## Deliberately deferred

- MMKV schema versions: add when the first migration actually needs one.
- Play-specific work (`play` flavor without the self-updater, AAB, media-permission
  declaration) — only if Play distribution ever happens.
