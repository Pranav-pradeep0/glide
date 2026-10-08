# Glide hardening roadmap

Written for: the next agent session picking this up, and anyone reviewing the plan.

Status as of commit `7bd7e0f` (2026-10-08). Phase 0 and most of Phase 5 are done and
committed on `main`. Nothing below has been tested on a device.

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

### Needs a device before trusting
1. PiP: expand, and dismiss, with background play off.
2. Video notification tap — from the library, and from "Open with".
3. A second "Open with" while the player is running.
4. Volume boost on speaker, wired, Bluetooth, and after unplugging mid-boost.
5. Fold/unfold on a foldable.
6. Android 17 background audio: `adb shell cmd audio set-enable-hardening throw`.

---

## Phase 5 remainder (architecture)

- **`VideoPlayerScreen` is still a 1400-line god component.** Callbacks reference
  `bookmarksHook` and `player` before declaration (~line 309) and only work because they
  run later; a synchronous call during render would crash. Position, playing state and
  tracks each live in two or three places (refs, shared values, React state, native).
  A per-screen controller owning position/tracks/settings is the real fix. **Large and
  risky — do it before adding big player features, not after.**
- `usePlayerHUD` (`:178-227`): `showSeekHUD` reads stale `state` so its skip check never
  fires; `HIDE_*` always allocates new state, so `showBrightnessHUD` forces a full-screen
  render via a pointless `HIDE_VOLUME`.
- One `ErrorBoundary` for the whole app, and no `getDerivedStateFromError`. A player
  render crash replaces the navigator and Reset remounts into the same crash.
- Robolectric test for `GlidePlayerHolder` start/clear/attach order — it would have caught
  the service race fixed in `8221a3a`.
- Comment at `VideoPlayerScreen:~896` contradicts `usePlayerTracks.ts:263-267` about cue
  eviction on unmount; decide the policy.

## Phase 3 (performance and battery)

- **Music player** (`GlidePlayerService.kt:62`): audio offload when the EQ is flat (biggest
  background-battery win), `EXTENSION_RENDERER_MODE_ON` (AC-3/ALAC play silently today),
  and a `DefaultRenderersFactory` with decoder fallback — video has it, music does not.
- **Background progress events**: `GlideAudioPlayerModule` emits every 500 ms regardless of
  app state. Stop the ticker on host pause, push one position on resume.
- **History writes**: rewritten in full every 2 s during playback and never pruned. Cap at
  ~500 entries (keep any with bookmarks), save on pause/background/exit plus every 15–30 s.
  Add `freezeOnBlur: true` so `AlbumVideosScreen` and `RecentsScreen` stop re-rendering
  underneath the player.
- **Audio queue**: `audioStore` persists full track JSON — tapping one song in a 5k library
  stringifies ~2 MB on the JS thread. Persist ids only; native already has `setQueueByIds`.
- **Scrubbing**: `ExoPlayer.setScrubbingModeEnabled(true)` while dragging instead of ~25
  flushing `CLOSEST_SYNC` seeks per second (`GlidePlayerView.kt:597-613`).
- **Background work competing with playback**: subtitle extraction and `alignVideo` each
  spawn a bare `thread {}` at normal priority with no cancellation, reading the same file
  being played. Use one single-thread executor at `THREAD_PRIORITY_BACKGROUND` with a
  cancel flag. Same for library scans (`MediaStoreVideoModule.kt:245,384`,
  `MediaStoreAudioModule.kt:296`) — coalesce repeated scans.
- **Thumbnails**: cache check before the ContentResolver query; drop stale requests (or
  LIFO) so fast scrolling does not queue hundreds of decodes for off-screen rows.
  `ThumbnailService.cancelRequest` also deletes *every* waiter for a key, so a video shown
  twice leaves one caller's promise unresolved.
- **Startup**: `getComponent={() => require(...)}` for VideoPlayer, NowPlaying,
  PlayerDetail, Onboarding, Search — all are evaluated before first frame today.
- **Lists**: inline `onPress`/`onMore` closures defeat `VideoRow`/`TrackRow` memo;
  `renderTrackItem` depends on `isPlaying` so every visible row re-renders on play/pause;
  `VideoRow.tsx:306-314` runs a Reanimated `entering` spring inside FlashList cells.
- **Track selection**: seed `setPreferredAudioLanguages` / `setPreferredTextLanguages` so
  playback does not start on the container default and switch audibly after load.
- **Subtitle timing**: `useHapticFeedback.ts:95-117` polls every 250 ms off a ref updated
  by 250 ms events — up to ~500 ms late. Interpolate instead, and stop while paused.
- `runOnJS` → `scheduleOnRN` (63 call sites, 16 files). Mechanical, low value.

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
- **HLS/DASH missing**: the manifest advertises `.m3u8` but `media3-exoplayer-hls` and
  `-dash` are not dependencies, so it cannot play. Two Gradle lines.
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
- `FilenameParser.ts:111-118` mangles non-Latin titles (`[^a-zA-Z0-9]`); use
  `/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu`.
- `LyricsService.ts:196-202` caches `null` on network failure, so lyrics stay missing all
  session.
- `picked_subtitle_*` cache files are never deleted (cleanup only matches `^subtitle_\d+`).

## Phase 4 (build and size)

- **Update download is 31 MB.** `.so` files are stored uncompressed (22.6 MB);
  `packaging { jniLibs { useLegacyPackaging true } }` would take the APK to ~14 MB. Every
  update is a full APK over mobile data. Measure install size/time before committing.
- Remove the remaining blanket R8 keeps (reanimated, svg, screens, safeareacontext,
  rnziparchive) — the libraries ship consumer rules. Stale rules:
  `com.lugg.ReactNativeConfig.**` (real package is `com.lugg.RNCConfig`) and `com.rnfs.**`
  (real package is `com.drpogodin.reactnativefs`).
- `Feather.ttf` is packaged twice (assets + res); remove the `<queries>` block, `jscFlavor`
  and the dead `project.ext.vectoricons`.
- CI: add `zipalign -c -P 16 -v 4`, and a `proxy` job (`tsc -p proxy` + smoke test) —
  `proxy/` is excluded from tsconfig and never typechecked.
- Baseline Profile + Macrobenchmark module (cold start, library list, opening the player).
- Replace `react-native-markdown-display` (abandoned 2021, pulls markdown-it 10 with
  high-severity advisories). Delete `integrate-lock.json` (lists VLC, axios, RN 0.78).
- Proxy caches nothing on GitHub failure, so a rate limit makes every client hit upstream.

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
