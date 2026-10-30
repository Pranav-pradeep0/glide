# Ponytail audit — cleanup tracker

Audit of 2026-10-29: over-engineering only (dead code, duplication, hand-rolled stdlib, stale
docs). Estimated net: about -8,300 lines and -2 deps. Delete this file when every box is ticked.

## How to work this list

- One batch per commit, on `main`. Commit subject: `refactor(<scope>): …` (or `chore`/`docs`).
- Before deleting anything, grep for the symbol again: the audit may have gone stale.
- After each batch, run `npx tsc --noEmit`, `npm run lint` and `npx jest`. If a batch touches
  `android/`, also run `cd android && ./gradlew testDebugUnitTest`.
- No behaviour change. If an item turns out to change behaviour, skip it and note why here.
- TV: anything touching UI must still work with the D-pad.
- Tick `[x]` as you go. A skipped item becomes `[-]` with a reason.

## Batch 1 — stale docs and repo junk (~-3,700)

- [x] Move the open `[todo]` items of `docs/production-hardening-master-tracker.md` to the top. Delete its 261 `[done]` rows and the 1.8.1/Stallion baseline text.
- [x] Delete `docs/player-engine-migration-plan.md`. First move its open items (B9 bitmap subs, A7 cue display) into the tracker, then repoint the 2 code comments that cite it.
- [x] Delete `docs/hardening-plan.md` (it says it is superseded).
- [x] Delete `docs/hardening-roadmap.md` after moving its "Left undone" list into the tracker.
- [x] Delete `docs/exoplayer-migration.md` and remove the 3 links to it.
- [x] `docs/improvements.md`: delete the 72 done (✅ / struck) bullets.
- [x] Delete `scripts/verify-player-engine.sh` (the setting it needs is gone).
- [x] Delete `release-notes/2.6.0.txt`.
- [x] Delete `.bundle/config`.
- [x] `.gitignore`: drop the iOS, Xcode, CocoaPods, fastlane, Yarn and `ios/tmp.xcconfig` sections.
- [x] README: drop the VLC, ffmpeg-kit, RN 0.78, `npm run ios` and app `.env` key text.
- [x] Stale comments: the VLC-era header in `GlidePlayerViewManager.kt:13-18`, `MainApplication.kt:32-33` and `pip/PipModule.kt:17-19`.

## Batch 2 — build and config (~-120, -2 deps)

- [x] `metro.config.js` → `module.exports = require('@react-native/metro-config').getDefaultConfig(__dirname);` (the override only sets the defaults).
- [x] `tsconfig.json`: keep only `extends`, `paths` and `exclude` (10 keys repeat the base; `lib` narrows it).
- [x] Delete `jest.config.js` and add `"jest": {"preset": "@react-native/jest-preset"}` to package.json. Then confirm all suites still pass.
- [x] Delete `react-native.config.js` (it only sets the CLI defaults).
- [x] package.json: remove `@babel/preset-env` and `babel-jest`; drop `&& cd ..` from `clean`.
- [x] `babel.config.js`: set module-resolver `extensions` to `['.ts','.tsx','.js']` and drop the comments that restate the code.
- [x] `app.json`: drop `displayName`.
- [-] `android/settings.gradle:8`: remove the duplicate `includeBuild`. Skipped: not a duplicate. The `pluginManagement` copy only serves `plugins {}`; this one supplies the versionless `buildscript` classpath (AGP, RN Gradle plugin), and Gradle fails to resolve them without it.
- [x] Remove the `flatDir` repos that point at the missing `android/libs` (`app/build.gradle:125-129`, `build.gradle:30-32`).
- [x] `app/build.gradle:40-88`: delete the commented-out template block. Inline `enableProguardInReleaseBuilds`.
- [x] CI (`android-ci.yml`):
  - [-] the release job no longer re-runs the verify checks (272-294). Skipped: the tag job never waits on `verify`, so these steps are its only gate; dropping them lets a red commit publish. Redo with a check that `verify` passed for `$GITHUB_SHA`.
  - the proxy job becomes one `npx tsc -p proxy --noEmit` step in verify (21-46)
  - set `BT=` once in `$GITHUB_ENV`
  - drop the `develop` trigger
  - use `$GITHUB_REF_NAME` instead of `TAG`
- [x] Proxy: run `npx wrangler types` instead of hand-declaring `RateLimit`/`KVNamespace`; make `err()` reuse `json()`; fold `logUpstreamFailure` into `logRoute`.
- [x] `proxy/eval-recap.mjs:14`: use `fileURLToPath(new URL(…, import.meta.url))`.

## Batch 3 — dead JS/TS code (~-900)

- [x] `PlayerIcons.tsx`: delete BackgroundPlayIcon, HapticsIcon, RecapIcon and the whole animated block (99-310).
- [x] Subtitles:
  - delete `SubtitleCueStore.cleanup`/`evict`, which also makes `SubtitleExtractor.cleanupSubtitleFiles` dead
  - delete `isBitmapSubtitle`
  - delete `scoreAPISubtitles`, `selectBestEmbeddedSDH`, `selectBestAPISDH` and `ScoredSubtitleResult`
  - delete `findMatchingSubtitleTrack` and `SubtitleTrackForMatching` (languages.ts)
  - delete `useFormattedSubtitle` and `hasHtmlTags` (SubtitleHtmlParser)
- [x] `videoHistoryStore`:
  - delete `getVideoHistoryByName`, `updateVideoHistory` and `updateBookmarkLabel`
  - `isHydrated` is always true, so delete it and the dead skeleton branch in RecentsScreen:165-172
- [x] Media:
  - delete `useFolders`, `useVideos` and `useAlbumCover`
  - delete `MediaService.getVideos`, `VideoEdge` and `VideoPageResult` (update the tests)
  - delete the `getAlbums` alias and the `invalidateVideosCache` alias
- [x] FileService:
  - [x] delete `normalizePath`, `getCleanPath`, `unlink`, `stat` and `writeFile`
  - [-] delete the subtitle cache dir, which nothing writes: `getSubtitleCacheDir`, `cleanSubtitleCache`, `ensureDir`, App.tsx:50-51 and the Settings row. Skipped: removing the "Clear subtitle cache" row is a visible Settings change, so it needs a product call. `ensureDir` stays either way: ThumbnailService uses it.
- [x] `network.ts`: replace `abortSignalWithTimeout` and `NetworkTimeoutError` with `AbortSignal.timeout`; delete `fetchJsonWithTimeout`. Check Hermes has `AbortSignal.any` before using it. (RN 0.88's AbortSignal has both. Callers test `isTimeoutError`.)
- [x] ErrorBoundary: delete the context, `useErrorBoundary`, both `logError`s and `errorInfo`.
- [x] `hooks/video-player/types.ts`: delete `createDebounce`, `PlayerPlayingData`, `HUDType` and the orphan comment stubs.
- [x] Hook returns nobody reads:
  - `ui.toggleLock`, `ui.cancelAutoHide`
  - `settings.clearSleepTimer`
  - `tracks.currentSubtitleCue`, `tracks.setSubtitleCues`
  - `audioRoute` and `setVolume` in useAudioController
- [x] Remove props and params:
  - `playerRef` in VideoPlayerScreen (only written)
  - `isLandscape`/`insets` on QuickSettingsPanel and PlaylistPanel
  - route params `videoCount`, `subtitlePath` and `imdbId`. `imdbId` stays on VideoPlayer: PlayerDetail passes OMDb's id to it. It is gone from PlayerDetail, where nothing read it.
- [x] Constants and types:
  - `SUBTITLE_FONT_SIZES`, `PLAYBACK_RATES`, `DEFAULT_STORAGE_PATH`
  - `GestureState`, `SortOption`
  - `SubtitleTrack` is declared twice; keep one
  - equalizer `icon`/`note`
  - OMDb `Writer`/`Country`/`Awards`/`BoxOffice`
  - `SyncService.MAX_WINDOW_MINUTES`
- [x] Misc:
  - `searchByIMDBId`, `LyricsService.clearCache`, `DeepLinkService.isVideoUri` (test-only)
  - `lockPortrait`/`lockLandscape`, `isPipSupported` and the PipModule default export
  - `setGlobalBrightness`
- [x] UI:
  - `SortTabs`, `SUBTITLE_CODEC_NAMES`
  - theme `secondary`/`success`, `motion.slow`
  - unused NowPlaying styles (891-906)
  - iOS-only `shadow*` props
- [x] Onboarding:
  - `smoothPath`, `moonPulse`
  - `syncOn`/`hapticsOn`/`animateRef`
  - the ignored `secondaryColor`/`animate` props
  - the unused imports `tsc --noUnusedLocals` reports
- [x] Delete `src/utils/video-filename-parser/index.js` and `index.d.ts` (unimported).
- [x] FilenameParser: drop `quality`, `group` and `rawYear` (update the test).
- [x] ThumbnailService: drop the `OLD_THUMBNAIL_DIR` sweep and `PendingRequest.reject`.
- [x] Unexport file-local exports; drop the 13 unused `export default`s and the barrel re-exports in `hooks/video-player/index.ts`. (18 by now; the barrel keeps only what VideoPlayerScreen and Settings import.)
- [-] `subtitleParser.test.ts:66-72`: fix `parseVTT` for `MM:SS.mmm` and unskip the test, or delete it. Skipped: the fix changes what parses, and deleting the test would hide a known bug. Do it as a `fix(subtitles)` commit.

## Batch 4 — dead native code (~-400)

- [x] Delete `HdrSpikeActivity` and its debug manifest entry.
- [x] Native-API-level scheme: Stallion ties each bundle to its versionName, so these checks are always true.
  - delete the changelog in `GlideNativeModule.kt:22-58`
  - delete the numeric `getCommandsMap` and the `Int` `receiveCommand`
  - delete every JS `hasNativeApi()` and `typeof fn === 'function'` fallback (about 22 sites)
  - keep `NATIVE_API_LEVEL` for Settings
- [x] `GlidePipController`: delete `logViewChain`, `logTrace`, `isInPipMode`, `isSupported` and the `getReactActivity` alias.
- [x] `if (SDK_INT >= M/O)` branches are dead at minSdk 26:
  - `AudioVolumeModule` (`detectCurrentRouteLegacy`, `@RequiresApi`)
  - `HapticModule:44-57`
  - `FlatFrame.kt:36`
- [-] `AudioVolumeModule`: delete the `LifecycleEventListener`, which only logs; `invalidate()` already cleans up.
  Skipped: `onHostDestroy` also stops the volume observer and device callback when the Activity goes but the React instance lives on; `invalidate()` only runs at teardown.
- [x] `DisplayBrightnessModule`: keep one of `set`/`setSync` and one of `reset`/`resetSync`; drop the empty host callbacks and the JS fallbacks.
  The empty `onHostResume`/`onHostPause` stay: `LifecycleEventListener` has no defaults, and `onHostDestroy` resets the brightness.
- [x] `MediaStoreVideoModule`:
  - drop `getThumbnail`, which only calls `getThumbnailWithSize`, and its JS branch
  - drop the v1 `video_thumbs` migration
- [x] `MediaStoreAudioModule`: drop `getAlbumArt` and `getArtworkUri`; JS uses the palette version only.
  JS still called `getAlbumArt` (useAlbumArt, audioStore); `AudioMediaService.getAlbumArt` now reads `artworkUri` from the palette call, which computed the palette anyway.
- [x] Move `HapticModule.mark` (release-shipped, debug-only caller) into `HapticsLabModule`. Replace the `Class.forName` lookup with debug/release source-set objects.
- [x] `Smb.gate()` does nothing at targetSdk 36. Delete it and re-add it when bumping to 37.
  `LocalNetworkDenied` and its Kotlin/JS handling stay for the 37 bump (docs/network-shares.md says where the check goes).
- [x] Delete unused imports (`ReactActivity`, `ReactContext`, `kotlin.math.abs`) and the `@JvmStatic`/`@JvmField` that have no Java caller.
- [-] `VideoPlayerActivity:177-178`: drop the `requestedOrientation` set, which repeats the manifest.
  Skipped: on a restore after process death the system can keep the orientation JS had locked; this line resets it to fullSensor, so it is not just a repeat.
- [x] `SubtitleSyncModule:575-577`: delete the orphaned KDoc.

## Batch 5 — player gesture and HUD consolidation (~-800)

- [ ] `usePlayerHUD`:
  - reduce the state to `{seek,brightness,volume,speed,resize}` booleans + `flash(key, ms)`
  - delete the dead seek direction math, `seekStartTimeRef`, `speedGestureActiveRef`, the 7 unused hide/reset functions and their `RESET_*` actions
  - clear the timers with `Object.values(...).forEach(clearTimeout)`
  - update `hudReducer.test.ts`
- [ ] `types.ts`: inline the 7 single-use HUD sub-state interfaces; replace the `UsePlayer*Return` interfaces with `ReturnType<typeof hook>` (also in useAudioController and usePlayerGestures).
- [ ] Brightness and volume gestures → one `useVerticalAdjustGesture({side,max,sensitivity,onApply})`. Drop `onBrightnessWait`, `applyBrightnessDefault` and the `event.x` checks that hitSlop already covers.
- [ ] `useSpeedGesture` → one `speedPan(side, base)`; delete the `onEnd` bodies (onFinalize already resets).
- [ ] Seek and zoom: keep only `onFinalize` for the commit.
- [ ] `usePlayerGestures`: create shared values inside the sub-hook that uses them. Call `onBrightnessChange`/`onBrightnessSave` directly, without `runOnJS`, at 217 and 221.
- [ ] `usePlayerUI`: replace the 5 panel booleans with `panel: PanelType | null`.
- [ ] `usePlayerCore`:
  - replace the hand-rolled preview throttle with the `throttle` helper (+ `cancel`)
  - drop the `initialPaused` and `onPlaybackPositionRestore` options
  - pass the resume number instead of `getResumePosition`
- [ ] `useShakeControl` → about 25 lines: no `enabled` or `cooldownMs`; Settings passes its handler as `onShake`; use `useAnimatedReaction` instead of `useDerivedValue`.
- [ ] `formatTime` → reuse `formatDuration` (keep the isFinite guard).
- [ ] `VerticalSlider`: hard-code min/max/step and drop the color and `width` props nobody varies.
- [ ] `PlayerIcons`:
  - make one `ModeIcon({inner})` for the 6 resize icons
  - use Feather `volume-2` and `moon`/`sun` for AudioIcon and NightModeIcon
- [ ] Use reanimated `clamp` instead of the ~15 `Math.max(lo, Math.min(hi, x))`.
- [ ] Delete the "✅ FIX" and banner comments in usePlayerHUD and useSpeedGesture.

## Batch 6 — stores and services (~-700)

- [ ] `appStore`: drop the 26 one-field setters and use `updateSettings(patch)`. Keep `toggleHaptics`, `setSubtitlePosition` and `setCrashReportsEnabled`. `resetSubtitleSettings` should spread the defaults.
- [ ] `audioStore`:
  - make one `callNative(m, ...a)` for the 15 try/catch copies
  - make `playTrack` call `playQueue`
  - make one helper each for the queue push and the art backfill
  - drop `setAudioEqualizer` (inline it), `hydrateQueue` (test-only), the `NODE_ENV`/`unref` test hacks and the pre-2.3 `LEGACY_QUEUE_KEY` migration
- [ ] Queue: keep only `setQueueByIds` and drop `setQueue(tracks)` in both native and JS.
- [ ] `videoHistoryStore`: make one `patch(path, id, fn)` for the 9 copies and one basename helper for the 5 `split('/').pop()`.
- [ ] Persistence: use zustand `persist` + `createJSONStorage` over one MMKV adapter for app, favorites and musicHistory. Delete `storage.ts` (audioStore stays manual).
- [ ] Make one `dedupe(map, key, fn)` for the 7 in-flight copies; drop videoIndexStore's own `inFlight`.
- [ ] `useAlbumArt` and `useAlbumPalette` → one `useCached(cache, key, fetch)`.
- [ ] `useAlbumVideos`: drop its own cache and the pagination leftovers (`loadMore`, `loadingMore`, `hasMore`).
- [ ] Subtitles:
  - `readSubtitleFile` → `RNFS.readFile(p,'utf8').catch(() => null)`; drop the `__DEV__` log scaffolding
  - one timestamp regex + `toSec()` for SRT/VTT
  - `convertAssOverrides` → `{b,i,u}` map
  - `resolve*TextStyle` → one destructure
  - small SubtitleHtmlParser cleanups (`attributes`, `FlattenedBaseTextStyle`, the rgb branch, `/\r\n?/g`)
- [ ] SubtitleSelectionService: return booleans and drop the `reason`, `confidence` and `matchedPatterns` strings.
- [ ] `ContentDetector`: drop the `verifyWithOMDB` flag (it is always true) and share the scoring between `classify` and `classifySync`.
- [ ] `SubtitlePickerService`/`LyricsService`: read `content://` directly instead of copying to cache; reuse `parse()`.
- [ ] `RecapService`: derive `getRecapEligibility` from `getDialogueForRecap`; drop `_videoTitle`.
- [ ] `useSubtitleDisplay`: drop the duplicate same-cue check; delete `clearCue`.
- [ ] Use a `Map` for the LRUs in SubtitleCueStore. Rename `services/SubtitleCueStore` → `EmbeddedCueCache`.
- [ ] Keep one video extension list in constants (it exists 4 times). Add `utils/path.ts` with `basename`/`extname` (hand-rolled about 12 times).
- [ ] Drop the 46 `Platform.OS === 'android'` checks.
- [ ] `checkAudioPermission` → inline at the 3 call sites. `useVideoSearch.forceRefresh` → return `forceFullSync`.
- [ ] Turn static-only classes into plain modules of functions, and drop the `new X()` singletons.

## Batch 7 — native consolidation (~-550)

- [ ] `MediaStoreVideoModule`:
  - make one `rowToMap(c)` for `getVideos`/`getLibrary`, using `getColumnIndexOrThrow`
  - `loadThumbnailSync`: resolve to a content URI, then run one query
  - make one `deleteAll(uris, promise)`
- [ ] `MediaStoreAudioModule`:
  - `getSongs` reuses `queryAllSongs`/`readRecord` (extend `SongRecord`)
  - one `readPalette(file)`
  - one `artUri(context, albumId)`
- [ ] `GlideAudioPlayerModule`:
  - one `onMain(promise, code){}` for the 17 copies
  - one `stateMap(p)`
  - one duration helper and one repeat-mode helper
  - one `SongRecord.toMediaItem()`
- [ ] `AudioVolumeModule`: `setVolume`/`setVolumeSync` share one `apply(pct)`; `getVolume` reuses the existing helper.
- [ ] Replace the 9 `ReactPackage` classes with one `GlidePackage`.
- [ ] Fold `libs/react-native-simple-thumbnail` into the app: drop the gradle module, package.json, index.js, Package class and the `dataSourceFactory` hand-off, and use `BackgroundWork`.
- [ ] Use `BackgroundWork.submit` instead of the 3 ad-hoc thread pools.
- [ ] Use `reactContext.emitDeviceEvent(name, data)` instead of the 7 hand-written emitters.
- [ ] Move the PiP relay into `GlideBaseActivity.onPictureInPictureModeChanged`; drop the double module lookups.
- [ ] Make one `Context.isTv` extension for the 3 `uiMode` copies.
- [ ] `SubtitleSyncModule`: use `@file:OptIn(UnstableApi::class)`; one `open(target)` in `getVideoMetadata`.
- [ ] Use library helpers:
  - `DataSourceUtil.readToEnd` (SmbModule:89-96)
  - `TextUtils.htmlEncode` (PhoneSignIn:138)
  - `IntentCompat.getParcelableExtra` (VideoPlayerActivity:211-216)
  - `dir.mkdirs()` without the exists check
- [ ] `MusicPlayback.Listener` → two function properties.

## Batch 8 — screens and components (~-500)

- [ ] AlbumDetail/ArtistDetail:
  - use `TrackRow` with a `leading` slot and `ListHeader onBack`
  - add one `audioStore.playAll(list, shuffle, source)`
  - share `handleSongPress`
- [ ] Onboarding:
  - use `Pager` instead of the FlatList pager
  - use two ui `Button`s instead of `TvCTA`/`TvButton`
  - default `memo` (drop the custom comparators and displayNames)
  - reanimated `Easing`/`interpolate` instead of the custom easing helpers
  - `useTheme()` inside instead of drilling colours
- [ ] `RootNavigator`: move the repeated options into `screenOptions`; one `useTabPress` for TabBar and SideRail.
- [ ] `MiniPlayer`: one `MiniPlayerCard({interactive})`; use `ProgressLine` instead of `MiniPlayerProgressBar`.
- [ ] `VideoRow`: merge `VideoRowBase` and `VideoCardBase` with a `grid` flag; drop the stale JSDoc.
- [ ] `FeatureShowcaseIcon`: loop the 3 `schedule()` calls; drop the wrapper View.
- [ ] `AlbumVideosScreen`: use the store's `getVideoHistory` instead of `getHistoryEntry`.
- [ ] `PlayerDetailScreen`: use `<Image fadeDuration={600}>` instead of the `Animated` fade.
- [ ] `NowPlayingScreen`: inline `SleepTimerSheet` into its `<Sheet>`.
- [ ] App.tsx:
  - use `finally` for `setAppReady`
  - drop the console-only `onError`/`onReset`
  - set the background colour once
- [ ] ui: one `borderRadius` in `ringRowTv`; render the ListRow icon without the bare View.

## Batch 9 — API updates (no line saving)

- [ ] `runOnJS` → `scheduleOnRN` from `react-native-worklets` (~72 sites, deprecated in reanimated 4).
- [ ] React 19:
  - drop `forwardRef` (`GlidePlayer.tsx:116`, `AnimatedVideoView.tsx:100`)
  - `useContext` → `use`
  - `<Ctx.Provider>` → `<Ctx>`
- [ ] eslint 8 → 9 (`@react-native/eslint-config` 0.88 accepts it).

## Needs a decision or a check first

- [ ] Onboarding illustrations (1,430 lines of animated SVG) → static art? This is a product call; it would save about 1,300 lines.
- [ ] `EmbeddedLyricsReader` hand-written ID3/FLAC/MP4 parsers → Media3 `MetadataRetriever`? First check that it reads USLT and `©lyr` (maybe -150).
- [ ] Not fully audited, so audit these first: TrackSelector, FloatingSyncPanel, SubtitleOverlay, TrackOptionsSheet, SidePanel, BookmarkPanel, RecapModal, ResumeModal, UpNextCard, AnimatedVideoView, usePlayerTracks/Settings/Recap/Resume/TvRemote/SubtitleAutoSync, GlidePlayerView.kt, ColorEnhancement*, VolumeLeveler, Credits, Haptic{Director,Listener,Performer,Analysis}.
