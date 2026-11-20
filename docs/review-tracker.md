# Review tracker

Written for: the next agent session fixing these items, and the owner. Start here.

A full review of the app, done 2026-11-19 against `main` at `a9eefc0` plus the uncommitted
MatroskaSkipper work. It covers bugs, UX, Android TV, visual design, simpler code and React
Compiler. Each item was found by one reviewer, then **re-checked by a second reviewer told to
disprove it**. Where they disagreed, the second verdict stands. Items found wrong are kept under
"Already ruled out" so nobody looks again.

**You don't need to re-research anything here.** The file:line, evidence and fix in each row are
the second reviewer's. Line numbers drift as code changes, so if one doesn't match, find the code
by the function or variable name in the Evidence column.

## How to work this tracker

1. Take the first `TODO` in **Order of work** below. All owner decisions are made (see below).
2. Set its Status to `DOING`, apply the fix in the row, and keep the diff small.
3. Logic changes leave one small test, in the style the repo already uses: jest in `__tests__/`
   or a JVM test in `android/app/src/test/`. Run `npx tsc --noEmit`, `npx eslint src --quiet`,
   `npx jest`, and `cd android && ./gradlew testDebugUnitTest` for Kotlin changes.
4. Commit per AGENTS.md (`fix(scope): …`), on `main`, staging files by name. No Claude
   co-author trailer.
5. Set Status to `DONE <short sha>` in the same commit. If a fix turns out wrong or not worth it,
   set `WONTFIX: <reason>`.
6. Follow the AGENTS.md TV rules for every UI change: D-pad reachable, visible focus, touch-only
   things hidden with `IS_TV`, never branch on screen size.

Status values: `TODO` · `DOING` · `DONE <sha>` · `ASK` (owner decides) · `WONTFIX: why` ·
`—` (refuted, rejected or note only: nothing to do).

**Hold until the owner commits the MatroskaSkipper work** (`SubtitleSyncModule.kt` and
`EmbeddedSubtitles.kt` have uncommitted edits): SB-12, SB-13, CM-10, CM-N2.

## Owner decisions (made 2026-11-19)

| ID | Decision |
|---|---|
| PL-10 | Block Back (and edge-swipe Back) while the player is locked; flash the unlock hint instead. |
| PL-11 | Double-tap seek uses the "Seek by" setting. The "Seek by" slider always shows, not only when seek buttons are on. |
| LB-17 | Remove the sidecar `.lrc` lookup (unreadable on Android 11+). Embedded and online lyrics stay. Fix the comment that claims it works. |
| UX-11 | Must have: three-way "Follow phone / Light / Dark", default "Follow phone", switches live. Migrate the old boolean setting. |
| SB-4 | Yes: raise the proxy body cap to 24 KB in `proxy/`. The agent does NOT deploy; it gives the owner the exact deploy command. |
| TV-4 | No hint. Holding OK stays the way to open options on TV grid cards. |
| DS-5 | Keep the gradient look. Only swap the hard-coded colours for theme tokens, as written in the row. |
| DS-9 | Yes: the play button morphs from a circle (paused) to a rounded square (playing) with a spring. Do DS-7 (expressive spring) first. |

## Order of work

Highest value per effort first. IDs link to the tables below.

1. **Quick correctness fixes (all S):** PL-2, PL-9, PL-12, SB-1 + SB-2 (one shared time parser; same as CM-N1),
   SB-5, SB-6, SB-11, SB-15, LB-1, LB-2 (also fixes LB-N1), LB-8, LB-10, LB-14, LB-20 (also fixes LB-N4),
   LB-15, LB-4, UX-3, UX-5, SB-4, PL-10, PL-11, LB-17
2. **Larger correctness fixes (S/M):** SB-3, SB-8, SB-9 + SB-N2, SB-17, SB-19, SB-16, PL-3, PL-4, PL-5, PL-6,
   PL-7, PL-8, LB-3, LB-5, LB-6 + LB-N2, LB-7 (also fixes LB-N3), LB-9, LB-12, LB-16, LB-19, and after the
   MatroskaSkipper commit SB-12, SB-13
3. **UX and accessibility:** UX-11, UX-1, UX-2, UX-4, UX-6, UX-7, UX-8, UX-9, UX-10, UX-12, UX-13, PL-13
4. **TV:** TV-1, TV-2, TV-5, TV-3, TV-7, TV-6, TV-9, TV-10, TV-11, TV-12, TV-13, DS-14, PL-14
5. **Design:** DS-1 first (contrast), then DS-2, DS-3, DS-11 (type scale; this also clears TV-6), DS-4, DS-6, DS-7,
   DS-8, DS-10, DS-12, DS-13, DS-5, DS-9 (after DS-7)
6. **Simpler code:** CM-4, CM-5 (also fixes CM-N3), CM-3, CM-7, CM-12, CM-1, CM-11, and after the
   MatroskaSkipper commit CM-N2, CM-10
7. **React Compiler:** RC phase 1, then phase 2 after one release (see its section)
8. **Low priority, whenever:** LB-11, LB-13, LB-18, SB-10, SB-14, SB-18, SB-20, SB-21

## Already ruled out (don't re-investigate)

- **PL-1** (volume keys lost after Next): native-stack `replace` swaps screens in one commit, and
  React runs the old cleanup before the new effect. Listening ends up on.
- **TV-8** (Up next traps focus): intended; Back and X release it.
- **SB-22** (MatroskaSkipper): reviewed twice, no defects.
- **CM-2** (native subtitle parser): Media3's SSA parser drops inline styles, and the JS
  normalisation has to stay anyway. Fix the regexes instead.
- **CM-6** (one native thumbnail call): the memo already makes the common path a single hop.
- **CM-8** (Fabric codegen for GlidePlayer): it works through the interop layer, and the command
  design is deliberate (d91e20f, 77277db). Revisit only if the interop layer is deprecated.
- **CM-9** (per-entry MMKV history): at most 500 entries and debounced; per-key would slow startup.
- **CM-13** (subtitle polling): already adaptive. Fine as is.

---

## Player (PL)

| ID | Status | Verdict | Severity | file:line | Evidence | Minimal fix | Effort |
|---|---|---|---|---|---|---|---|
| PL-1 | — | REFUTED | – | src/hooks/video-player/useAudioController.ts:124-128; AudioVolumeModule.kt:383-413 | native-stack 7.21 renders only state.routes, so `replace` unmounts old + mounts new in one commit; React runs all passive cleanups (old stopListening) before passive mounts (new startListening). Listening ends true. Note: comment at VideoPlayerScreen.tsx:731-733 claiming "unmount follows the new screen's mount" is inaccurate (harmless). | None. | – |
| PL-2 | DONE | CONFIRMED | wrong-behaviour | src/hooks/video-player/useResumePlayback.ts:119-123 → src/screens/VideoPlayerScreen.tsx:565-568 → src/hooks/video-player/usePlayerCore.ts:230-239; AnimatedVideoView.tsx:155-166 | Prompt visible from mount; native opens at source.startTime; clearResumePosition only nulls resumePosRef; commitSeek(0) returns false before load; onRestartPersist already wrote 0 → "Start over" lost. | usePlayerCore: clearResumePosition sets `restartOnLoadRef`; handleLoad (~402) calls `applySeekToNative(0)` and syncs refs. | S |
| PL-3 | DONE | CONFIRMED | wrong-behaviour | android/app/src/main/java/com/glide/app/VideoPlayerActivity.kt:137-153,180-184; GlidePlayerView.kt:247 | onSaveInstanceState saves only stopPositionMs; onCreate pairs it with the intent's first URI → video_list item N's position applied to item 1 after process death. | Save `stopUri` alongside (setStopPoint + onSaveInstanceState); on restore use position only if `stopUri == externalVideoUri`, or open stopUri. | S |
| PL-4 | DONE | CONFIRMED | wrong-behaviour | android/.../pip/PipModule.kt:46-49; GlideBaseActivity.kt:137; src/native/PipModule.ts:96-104; VideoPlayerScreen.tsx:431-435,560,1305 | `promise.resolve(GlideBaseActivity.inPip)` is app-wide; syncFromNative on mount → a library player under an external PiP hides controls, blocks resume prompt, disables zoom, Back returns false. | `isInPipMode(activityName)` comparing `pip?.javaClass?.simpleName`; include activity name in the PiP event and filter in usePipModeListener via ExternalPlayerContext. | M |
| PL-5 | DONE | CONFIRMED | wrong-behaviour | android/.../brightness/DisplayBrightnessModule.kt:84-112; orientation/VideoOrientationModule.kt:28-32; VideoPlayerScreen.tsx:441-450,739-743,1240-1247 | `reactContext.currentActivity ?: return` then sets window attrs. External player in background + library open → AppState active → player sets MainActivity's brightness; later release() hits MainActivity too. | Target the player view's own host Activity (GlidePlayer prop/command or pass activity name) instead of currentActivity. | M |
| PL-6 | DONE | PARTIAL | wrong-behaviour | GlidePlayerView.kt:1399-1405; usePlayerCore.ts:363-368; VideoPlayerScreen.tsx:798 | `if (duration == C.TIME_UNSET || duration <= 0) return` → RTSP never loads (no tracks, spinner forever). Live HLS/DASH report a window duration and do load. | maybeEmitLoad: when `p.isCurrentMediaItemLive` (or READY with unset duration) emit with `isLive: true`, duration 0; handleLoad accepts isLive and skips the ≤1s guard. | M |
| PL-7 | DONE | CONFIRMED | wrong-behaviour | usePlayerTracks.ts:110-120,217-223; GlidePlayerView.kt:1171-1188 | History id used directly as selectedAudioTrackId; id = index in tracks.groups, which depends on renderer mapping (FFmpeg vs passthrough). | Save formatId + language in history; in setAudioTracksFromNative resolve by formatId, then language, then id. | M |
| PL-8 | DONE | CONFIRMED | minor | src/VideoPlayerRoot.tsx:69,80-82,91-107 | Compares new intent to first-opened URI, not the playing video_list item; concurrent resolveRoute calls unsequenced; prepare() can overwrite a newer intent's state. | Compare with `navigationRef.current?.getCurrentRoute()?.params.videoPath`; add `requestSeqRef` and drop stale results. | S |
| PL-9 | DONE | CONFIRMED | minor | usePlayerCore.ts:116-123 | Rate change sets lastSyncPosition and currentTimeShared from currentTimeRef (last 250ms tick) → playhead jumps back on hold-for-speed. | `lastSyncPosition.value = currentTimeShared.value`; drop the currentTimeShared write. | S |
| PL-10 | DONE | CONFIRMED | wrong-behaviour | VideoPlayerScreen.tsx:804-816,1302-1323 | Only the TV branch checks locked; handleGoBack has no lock check; gesture Back goes through hardwareBackPress → locked phone player exits. Owner: block it. | Before handleGoBack: `if (ui.state.locked) { flash unlock hint; return true; }`. | S |
| PL-11 | DONE | PARTIAL | minor | usePlayerGestures.ts:349; SettingsScreen.tsx:407-417,481-482 | Double-tap fixed 10s may be deliberate. Real gap: shake chips use settings.seekDuration, which is hidden unless seek buttons are on. | Owner decided: double-tap uses `settings.seekDuration` (usePlayerGestures.ts:349); always show the "Seek by" slider in Settings. | S |
| PL-12 | DONE | PARTIAL | minor | usePlayerRecap.ts:165-200; VideoPlayerScreen.tsx:611-616 | closeRecap already plays; bug only: user pauses after closing, then a late failure's onPlay() unpauses + stale toast. | `recapRunRef` counter bumped in closeRecap; bail after each await if changed. | S |
| PL-13 | DONE | CONFIRMED | minor | src/components/VideoPlayer/PlayerErrorCard.tsx:29; UpNextCard.tsx:108,116 | accessibilityRole="alert" doesn't announce on Android; countdown not announced. | `accessibilityLiveRegion="assertive"` on error card; Up next mount → `AccessibilityInfo.announceForAccessibility("Up next: {title} in Ns")`. | S |
| PL-14 | TODO | CONFIRMED | minor | VideoPlayerScreen.tsx:474,1486; PlayerDetailScreen.tsx:115 | haptics prop / findHapticCues ungated (entry already gated → unreachable on TV). | Prefix both with `!IS_TV &&`. | S |

## Library, music and storage (LB)

Media3 1.11.1 `DefaultShuffleOrder` was checked in the library source: there is no
"current song first" behaviour, added items land at random places in the shuffle order, and
`setShuffleModeEnabled` does not reorder.

| ID | Status | Verdict | Severity | file:line | Evidence | Minimal fix | Effort |
|---|---|---|---|---|---|---|---|
| LB-1 | DONE | CONFIRMED | data-loss | src/store/videoHistoryStore.ts:90-96,108-123,435-449; src/hooks/useMissingHistory.ts:16-21 | `same.length === 1 ? same[0] : null` name-only; relinkMoved deletes old key + persistNow. SD card out / partial access → history moves to another same-named file permanently. | findMovedVideo: name match only if `Math.abs(entry.duration - v.duration) < 2`; skip when entry's volume root (`/storage/XXXX-XXXX`) isn't mounted. | S |
| LB-2 | DONE | PARTIAL | wrong-behaviour | src/store/videoHistoryStore.ts:189-191,396,419; VideoPlayerScreen.tsx:587,678,1266 | name+size split can't happen (callers pass undefined size). Real: `generateVideoId(videoPath.split('/').pop())` uses the content:// URI's last segment, not the name → fallback never matches. Same as LB-N1. | Add `videoName` param to getVideoHistory/removeBookmark/clearVideoHistory and build the id from it. | S |
| LB-3 | DONE | CONFIRMED | wrong-behaviour | src/services/AudioMediaService.ts:13,46-48; android/.../audio/MediaStoreAudioModule.kt:223-235 | Native observer only clears songCache; JS cache cleared only on permission change / pull-to-refresh. | Emit debounced `onAudioLibraryChanged` from the observer; JS → `AudioMediaService.invalidateCache()`. | S |
| LB-4 | DONE | CONFIRMED | wrong-behaviour | android/.../audio/GlideAudioPlayerModule.kt:392-412,447-458; src/store/audioStore.ts:327-350,443-462 | addMediaItem posts to main immediately; pending build then `setMediaItems` wipes it; JS still shows it. | Route add/remove/move/skip via `queueExecutor.execute { mainHandler.post {…} }`. | S |
| LB-5 | DONE | CONFIRMED | minor | src/store/videoIndexStore.ts:26,60-64 | `if (inFlight) return inFlight` joins a pre-change scan. | `dirty` flag when joining; in finally re-run `load(false)` if set. | S |
| LB-6 | DONE | CONFIRMED | minor (perf) | android/.../player/MediaStoreVideoModule.kt:120-128,139-141,380-404; BackgroundWork.kt:40,48 | Walk every resume on 2-thread quick lane; `done.await(30,…)` holds a thread. | Move to `submitLong`, throttle to once/10 min, in-memory set of already-scanned paths. See LB-N2. | M |
| LB-7 | DONE | PARTIAL | minor | android/.../player/MediaStoreVideoModule.kt:223-240,290-291,306-318 | parseId on any authority → legacy getThumbnail may show the wrong video; only when loadThumbnail fails / API<29, non-MediaStore URIs. | Parse id only when `parsed.authority == MediaStore.AUTHORITY`; else hashCode key. Fixes LB-N3 too. | S |
| LB-8 | DONE | CONFIRMED | minor (ANR risk) | android/.../player/GlidePlayerService.kt:180-184 | `getSongsByIds(context, saved.ids)` whole queue in onReceive on main thread. | Look up only `saved.ids[saved.index.coerceIn(saved.ids.indices)]`. | S |
| LB-9 | DONE | CONFIRMED | minor | src/services/AudioMediaService.ts:112,144,175-194,221; MediaStoreAudioModule.kt:303,327 | Album comparator cycles with track 0; no numeric collation; COLLATE NOCASE ASCII-only. | Shared `Intl.Collator(undefined,{sensitivity:'base',numeric:true})`; track 0 after numbered; sort songs in JS. | S |
| LB-10 | DONE | CONFIRMED | minor | src/hooks/useAlbumArt.ts:43-45,99-102 | null cached for the session, also after errors. | Cache only non-null; same for palette when artworkUri null. | S |
| LB-11 | DONE | PARTIAL | minor | android/.../player/MediaStoreVideoModule.kt:747-755; src/services/MediaService.ts:67-71 | Raw delete before confirm; cancel skips notifyChanged. On 11+ only own files (rare). | Delete raw files after RESULT_OK, or notifyChanged whenever raw files were deleted. | S |
| LB-12 | DONE | CONFIRMED | minor | src/hooks/useMediaService.ts:86,125-128 | `if (loading) return` drops change refetch. | `pendingRef`; finally → `fetchVideos(true)` if pending. | S |
| LB-13 | DONE | PARTIAL | data-loss (theoretical) | videoHistoryStore.ts:139-148; favoritesStore.ts:7-19; musicHistoryStore.ts:14-21; storage.ts:21-29; appStore.ts:286-290 | Parse failure → empty → next save overwrites. MMKV crash-safe so unlikely. | On parse failure copy raw string to `${key}.corrupt` first. | S |
| LB-14 | DONE | CONFIRMED | minor | src/store/audioStore.ts:49-53,228-241,764-784 | Startup falls back to initialPlayback.currentTrack; PLAYBACK_KEY stale for 500ms; kill not covered. | clearQueue writes PLAYBACK_KEY immediately. | S |
| LB-15 | DONE | CONFIRMED | wrong-behaviour | src/store/audioStore.ts:420-440; GlideAudioPlayerModule.kt:447-458 | `p.addMediaItem(targetIndex,…)` → random shuffle slot. | `afterCurrent` flag; when shuffled rebuild `playOrder(p)` with new index after current and `setShuffleOrder` (pattern moveInShuffleOrder ~508). | S |
| LB-16 | DONE | PARTIAL | wrong-behaviour | GlidePlayerService.kt:298-305; audioStore.ts:99-104; GlideAudioPlayerModule.kt:462-490 | Known gap: Auto-started queue ≠ JS queue; JS index-based remove/move hit wrong native item. | When native track not in JS queue (resolveQueueIndex -1), pull native queue ids into JS. | M |
| LB-17 | DONE | CONFIRMED | wrong-behaviour | src/services/LyricsService.ts:212-228; AndroidManifest.xml:5-10 | Only READ_MEDIA_AUDIO (+READ_EXTERNAL_STORAGE ≤32); other apps' .lrc invisible on 11+. | Owner decided: remove the .lrc step (LyricsService.ts:212-228) and fix the LyricsService comment. | S |
| LB-18 | DONE | PARTIAL | minor | src/services/ThumbnailService.ts:10,18,171-176; MediaStoreVideoModule.kt:213,290-291 | No cap, but cacheDir (OS trims) and `at/` swept; memo clear is in-memory only. Stale dateModified keys pile up. | Startup sweep: delete files >30 days; memo → LRU. | S |
| LB-19 | DONE | CONFIRMED | minor | android/.../audio/EmbeddedLyricsReader.kt:109-110; src/services/LyricsService.ts:63,232 | USLT only (comment claims SYLT); regex lacks `:`/`,` fraction, `[offset:]`, 3-digit minutes. | Fix comment; regex `\[(\d{1,3}):(\d{2})(?:[.:,](\d{1,3}))?\]`; parse `[offset:±ms]` and subtract. | S |
| LB-20 | DONE | CONFIRMED | wrong-behaviour | src/screens/MusicScreen.tsx:251-254; GlideAudioPlayerModule.kt:415,670 | Random start + random shuffle order → ~half the songs skipped with repeat off; same on shuffle toggle (LB-N4). | Helper `startShuffleAt(p)`: current first, rest shuffled, `setShuffleOrder(DefaultShuffleOrder(arr, seed))`; call at 415 and 670. | S |
| LB-N1 | — | CONFIRMED | wrong-behaviour | src/store/videoHistoryStore.ts:190 | getVideoHistory id from URI segment (`msf:1234`) → resume never works for content:// whose URI changed. | Fixed by LB-2. | – |
| LB-N2 | DONE | CONFIRMED | perf | android/.../player/MediaStoreVideoModule.kt:383-385 | API 29: scoped storage hides others' files from File.exists(), so every resume rescans the whole library. | Skip reconcileLegacyIndex on API 29 (`SDK_INT < Q` only). Do with LB-6. | S |
| LB-N3 | — | CONFIRMED | minor | android/.../player/MediaStoreVideoModule.kt:290-291 | Non-MediaStore URIs with same numeric segment share a thumbnail cache file. | Fixed by LB-7. | – |
| LB-N4 | — | CONFIRMED | wrong-behaviour | android/.../audio/GlideAudioPlayerModule.kt:670 | setShuffleMode(true) leaves current mid-order → earlier songs skipped. | Fixed by LB-20 helper. | – |

## Subtitles, recap, network and proxy (SB)

| ID | Status | Verdict | Severity | File:line | Evidence | Minimal fix | Effort |
|---|---|---|---|---|---|---|---|
| SB-1 | DONE | CONFIRMED | wrong-behaviour | src/utils/SubtitleParser.ts:12,15-16,19 | `lines[1].match(/(\d{2}):(\d{2}):(\d{2}),(\d{3})…/)` + `lines.length < 3`: no-index blocks, 1-digit hours, `.` ms, 2-digit ms dropped. | Find first line containing `-->`; regex `(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})`, pad ms; text = lines after it. (Or CM-2.) | S |
| SB-2 | DONE | CONFIRMED | wrong-behaviour | src/utils/SubtitleParser.ts:58-59 | VTT regex requires hours; `00:01.000 --> 00:04.000` dropped. | `(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})`, hours default 0. (Or CM-2.) | S |
| SB-3 | DONE | CONFIRMED | wrong-behaviour | android/.../player/SubtitleZip.kt:33; android/.../smb/SmbModule.kt:96; src/services/SubtitlePickerService.ts:55,60,156,176,179 | `toString(Charsets.UTF_8)` / `RNFS.readFile(…,'utf8')` on all external paths (SubDL zip, picker, sidecar, SMB sidecar, intent content/http). SubtitleExtractor.ts:108 reads Glide's own UTF-8 output — fine. | One native `readText(uri)`: BOM (UTF-8/16LE/16BE) → strict UTF-8 (CodingErrorAction.REPORT) → windows-1252 fallback; route JS paths through it. | M |
| SB-4 | DONE | CONFIRMED | wrong-behaviour | src/services/RecapService.ts:16,168; proxy/src/index.ts:7,90-93,102-105 | Client caps 5000 UTF-16 chars; proxy readCappedText counts bytes vs 8KB → Cyrillic/CJK 413. | `MAX_RECAP_BODY_BYTES = 24 * 1024`; keep the `.length` 5000 check at :119 (see SB-N1). Redeploy Worker. | S |
| SB-5 | DONE | CONFIRMED | wrong-behaviour | src/services/RecapService.ts:122-131,138; proxy/src/index.ts:119 | Blank scene-break lines add uncounted `\n`; a full 20-min window exceeds 5000 → 400. | `chars += 1` when pushing '' and include in the cap check. | S |
| SB-6 | DONE | CONFIRMED | wrong-behaviour (spoiler) | src/services/RecapService.ts:107-108; usePlayerRecap.ts:98,162; VideoPlayerScreen.tsx:540; types.ts:290 | Raw cue times vs video time; cue shows at `c*ratio + delay`; ~150s leak at 1h with 25/23.976. | Pass delayMs + ratio; filter `cue.startTime*ratio + delay/1000 <= resumePosition` (and for `earliest`). | S |
| SB-7 | TODO | CONFIRMED | wrong-behaviour | src/services/SubtitleSelectionService.ts:9-12,46-57; SubtitleCueStore.ts:188-192 | SDH +20 > language +10; `includes('cc')` substring. "Français SDH" beats English. | Language +30; `/\b(sdh|cc|hoh)\b/i`. | S |
| SB-8 | TODO | CONFIRMED | wrong-behaviour | android/.../player/SubtitleZip.kt:26-31 | `minByOrNull { rank }` first .srt; season packs (subdlApi.ts:481 `full_season`) give E01. | Pass season/episode to `read`; prefer entry matching `S\d+E0*N` or `\bNxNN\b`. | M |
| SB-9 | DONE | CONFIRMED | wrong-behaviour | src/utils/subdlApi.ts:284-295 | Retry uses parsed season/episode/isTVShow, drops manual overrides and includeComments. | Reuse `effectiveSeason/effectiveEpisode`, same isTVShow expression, `includeComments: true`. | S |
| SB-10 | DONE | CONFIRMED | minor | src/utils/subdlApi.ts:26-40,51-62 | `includes('hi')` matches Chicago/This/White; `'cc'` matches Accountant. | Tokenise `[^a-z0-9]+`, compare whole tokens. | S |
| SB-11 | DONE | CONFIRMED | minor | android/.../player/Credits.kt:54 | `\b(…|ending|outro|ed)\b` IGNORE_CASE matches "The Ending", "Ed Returns" (2nd half only). | `^\s*(end ?credits|credits|ending|outro|ed)\s*$`. Update scripts/credits-fixtures.js words in step. | S |
| SB-12 | TODO | CONFIRMED | minor | android/.../player/EmbeddedSubtitles.kt:86,315,338 | Inner `\n\n` (ASS `\N\N`) splits the SRT block; tail dropped. | `toSrtText`: `.replace(Regex("\n\\s*\n"), "\n")`. | S |
| SB-13 | TODO | CONFIRMED | wrong-behaviour | android/.../player/SubtitleSyncModule.kt:77,211-243,552-560 | decodeClip has no catch; decodeAudio rethrows after `audio.fed`; first failing get() rejects whole run (E_ALIGN); shutdown() lets others run. | `.mapNotNull { runCatching { it.get() }.onFailure { Log.w(...) }.getOrNull() }`; `shutdownNow()` in finally. | S |
| SB-14 | DONE | PARTIAL | minor | proxy/src/index.ts:198-224,247; proxy/wrangler.jsonc:25-29 | Unauth KV write, 180d TTL, IPv6 rotation bypasses per-IP, but global limiter caps 60/min/colo. Risk = KV quota/cost. | Key by recap hash (dedupe) or daily KV counter cap. | S |
| SB-15 | DONE | CONFIRMED | wrong-behaviour | src/components/SubtitleOverlay.tsx:321; src/utils/SubtitleHtmlParser.tsx:424,441 | `maxLines={2}` → numberOfLines truncates merged/3-line cues. | `maxLines={4}` (or remove). | S |
| SB-16 | DONE | PARTIAL | wrong-behaviour | android/.../telegram/Td.kt:97,109; TgWindow.kt:60-66,95 | latch.await() no timeout; cancelled loads are interrupted (threads freed on seek/release), but lost network = endless buffering with no error; BackgroundWork callers can block. | `latch.await(30, SECONDS)` → throw TdException(-1,"timeout"); give-up timeout in TgWindow → IOException. | S |
| SB-17 | DONE | CONFIRMED | data-loss | android/.../telegram/Td.kt:127; TgSaves.kt:41,51-52,187; docs/telegram.md:85 | In-memory queue + START_NOT_STICKY; next Ready `optimize(0, FILMS)` deletes partial bytes (Td.saving exemption also in memory). Doc says MMKV; code finds saves by filename. | Persist queue (SharedPreferences/MMKV), re-enqueue at Ready before optimize; fix doc line. | M |
| SB-18 | DONE | PARTIAL | minor | android/.../smb/SmbDataSource.kt:74-78,146-155 | Short only when f.read ≤ 0 (EOF in smbj) — mid-file skip theoretical; shrinking file ends early. | If `got < n && at+got < end` throw IOException. | S |
| SB-19 | DONE | CONFIRMED | wrong-behaviour | android/.../smb/Smb.kt:53-58,62-63,97 | `@Synchronized share()` connects (15s timeout) under the object lock; drop()/withLogin wait → one dead host stalls all SMB. | Per-host lock `ConcurrentHashMap<String, Any>`; global section only for client creation. | M |
| SB-20 | DONE | PARTIAL | minor | src/services/SmbService.ts:45; Smb.kt:31-35 | Only a stale comment names `Smb.gate`; LocalNetworkDenied deliberately not thrown at targetSdk 36. | Fix comment → `Smb.LocalNetworkDenied`. | S |
| SB-21 | DONE | CONFIRMED | minor | src/utils/SubtitleParser.ts:232-260; SubtitleHtmlParser.tsx:221-222 | `\h` literal; `{\p1}` stripped but drawing text `m 0 0 l …` stays. | `\h` → space; drop text between `{\p[1-9]}` and `{\p0}` (or drop cue). | S |
| SB-22 | — | REFUTED | – | android/.../player/MatroskaSkipper.kt | vint length, unknown sizes, Cues offsets, BlockGroup, lacing, multi-track, >2GB offsets, fallback all correct. Caveat: exception after audio fed rethrows → SB-13. | None. | – |
| SB-N1 | — | NOTE | – | RecapService.ts:168; proxy/src/index.ts:119 | Both sides measure `.length` (UTF-16 units); keep it that way when fixing SB-4 — don't switch only one side to bytes. | Constraint on SB-4/SB-5 fix. | – |
| SB-N2 | DONE | CONFIRMED | minor | src/utils/subdlApi.ts:284 | Year retry gated on `parsed.year`, not `effectiveYear`; manual year ignored. | Use `effectiveYear`. Fix together with SB-9. | S |

## UX and Android TV (UX, TV)

| ID | Status | Verdict | Sev | File:line | Evidence | Minimal fix | Effort |
|---|---|---|---|---|---|---|---|
| UX-1 | DONE | CONFIRMED | M | src/store/videoIndexStore.ts:32-34; src/screens/SearchScreen.tsx:65-69,139-145 | catch only logs; isIndexReady stays false; effect deps never change so no retry; onChange only reloads when lastFullSyncAt is set; loader branch has no back bar (hardware Back works). | Add `indexError` to store, set in catch; render `EmptyState action="Retry" onAction={initializeIndex}` plus the back IconButton bar. | S |
| UX-2 | DONE | CONFIRMED | L | src/hooks/useMediaService.ts:11,20,99-100; src/screens/FoldersScreen.tsx:198,293; src/screens/MusicScreen.tsx:169-170,428 | `error` returned but FoldersScreen ignores it → "No local videos found". Refresh buttons exist. | Destructure `error`; `EmptyState icon="alert-circle" text="Couldn't load videos" action="Retry"`; same in Music with an error state. | S |
| UX-3 | DONE | CONFIRMED | M | src/components/VideoOptionsBottomSheet.tsx:183-188; src/screens/VideoPlayerScreen.tsx:1010-1018 | Sheet calls TelegramService.unsave directly; player confirms via showDialog. | Extract the player's Keep/Delete showDialog into a shared helper; call it from the sheet. | S |
| UX-4 | DONE | CONFIRMED | L | src/screens/TelegramScreen.tsx:194-200 | Code step only has Next + "Use a different number". | Add `other('Resend code', …)` → TDLib `resendAuthenticationCode` via TelegramService/TelegramModule. | M |
| UX-5 | DONE | CONFIRMED | M | src/screens/TelegramScreen.tsx:51-57,74-75 | start() in [] effect; error EmptyState has no action; on TV the tab never remounts → stuck. | `attempt` counter in effect deps; `action="Retry" onAction={() => { setError(''); setAttempt(n=>n+1); }}`. | S |
| UX-6 | DONE | CONFIRMED | L | src/screens/OnboardingScreen.tsx:377-420,432-446 (Skip opacity 0.55 at 398) | No accessibilityRole; faded wrappers lack pointerEvents/importantForAccessibility. Phone only. | `accessibilityRole="button"`; on `isLastSlide` set `importantForAccessibility="no-hide-descendants"` + `pointerEvents="none"` on faded wrappers (and inverse for Get Started); Skip opacity ≥ 0.7. | S |
| UX-7 | DONE | CONFIRMED | L | src/components/MiniPlayer.tsx:173-181 | Stop is pan-only. | `accessibilityActions={[{name:'dismiss',label:'Stop playback'}]}` + `onAccessibilityAction` → same stop+Undo path (handleDismiss). | S |
| UX-8 | DONE | CONFIRMED | L | src/screens/FoldersScreen.tsx:292; src/screens/SettingsScreen.tsx:224,461,738 | navigate('Settings') with no param. | Pass `{ openFolders: true }`; Settings `useEffect` on `route.params?.openFolders` → `setFoldersVisible(true)`. | S |
| UX-9 | DONE | CONFIRMED | L | src/screens/AlbumVideosScreen.tsx:147-151 | Banner only in Folders(305)/Search(184). | Render `<PartialAccessBanner />` above the list. | S |
| UX-10 | DONE | PARTIAL | L | src/screens/SettingsScreen.tsx:385-399,646,676 | Lyrics under general "Playback" heading; Storage after About is real. | Move Storage above About; optionally a "Music" section for lyrics. | S |
| UX-11 | DONE | CONFIRMED | L | src/store/appStore.ts:90-103,149; src/screens/SettingsScreen.tsx:437 | System scheme read once into a boolean; no Appearance listener. | `darkMode: 'system'|'light'|'dark'` (migrate old boolean), `useColorScheme()` for system, 3-way Segmented row. | M |
| UX-12 | DONE | CONFIRMED | L | src/components/NowPlayingProgressBar.tsx:50-61,81 | Slider unlabelled, height 40. | `accessibilityLabel="Seek"`, `accessibilityValue={{ text: … }}`, height 48. | S |
| UX-13 | DONE | CONFIRMED | L | src/components/QueueList.tsx:256-262; NowPlayingScreen.tsx:698; audioStore.ts:465 | removeFromQueue with no snackbar. | Snackbar with Undo re-inserting at old index (pattern: MiniPlayer.tsx:105-112). | S |
| TV-1 | DONE | PARTIAL | M | src/screens/VideoPlayerScreen.tsx:1403-1411,1421,1645-1651 | Reachable via Up (shows controls without pausing) but OK pauses; skipEarly needs several presses. | In handleTvKey: `center` with `skipEarly && !controlsShown` → `commitSeek(skips[i].end)` (or give Skip `preferFocus`). | S |
| TV-2 | DONE | PARTIAL | M | PlayerControls.tsx:577,600; VideoPlayerScreen.tsx:767-781; SettingsScreen.tsx:380; SearchScreen.tsx:236-237; NetworkScreen.tsx:422 | Player 4dp top/8dp bottom, Settings 16, Search 8, Network 12. Rail is fine (32dp). | Add `metrics.overscanY` on TV to those top/bottom paddings (pattern: VideoRow.tsx:547,551). | S |
| TV-3 | DONE | PARTIAL | L | PlayerControls.tsx:603,669; VideoRow.tsx:407-408; SearchScreen.tsx:132,150; AlbumVideosScreen.tsx:133 | Back arrows focusable on TV; player first focus is Play (not Back). | `onBack={IS_TV ? undefined : …}` in AlbumVideos and Search; hide player back arrow on TV. | S |
| TV-4 | WONTFIX: owner 2026-11-19, hold OK is the TV convention | PARTIAL | L | src/components/VideoRow.tsx:257,275-284 | ⋮ hidden on TV by design (docs/android-tv.md:66-67,128-129); list view and long-press OK reach options. | Optional hint "Hold OK for options"; otherwise as designed. | S |
| TV-5 | DONE | CONFIRMED | M | src/screens/SearchScreen.tsx:72-77,153-166; SettingsScreen.tsx:692-699 | No focus styling; Search double-focuses (autoFocus + 300ms timer) → TV IME covers results. | `autoFocus={!IS_TV}`, skip timer on TV; onFocus/onBlur border with focus-ring colour. | S |
| TV-6 | TODO | CONFIRMED | L | PlayerControls.tsx:821,866; VideoRow.tsx:501,503; ui/index.tsx:1215 | Raw fontSize without TV_SCALE. | Multiply by `TV_SCALE` (and lineHeight), pattern VideoRow.tsx:552 — or fix via DS-3/DS-11 tokens. | S |
| TV-7 | DONE | PARTIAL | M | android/app/src/main/java/com/glide/app/player/TvRemoteModule.kt:181-191 | Rescue only for overlay or mode != OFF. "Back from album loses focus" unproven. | In `watch()`: if `old != null && now == null` and no overlay → `decor.restoreDefaultFocus()` regardless of mode. | S |
| TV-8 | — | REFUTED | — | UpNextCard.tsx:52,115-116; VideoPlayerScreen.tsx:1319 | Trap intended; Back and X release it. | None. | — |
| TV-9 | TODO | CONFIRMED | L | src/components/VideoOptionsBottomSheet.tsx:191 | Share ungated on TV. | `{onShare && !IS_TV && …}`. | S |
| TV-10 | TODO | CONFIRMED | L | src/components/LicencesSheet.tsx:35-50 (catch at 45) | Nothing focusable without Source row; error swallowed. | Licence Text `focusable={IS_TV}`; catch → `showSnackbar({ text: open.source })`. | S |
| TV-11 | TODO | CONFIRMED | L | src/components/ui/index.tsx:833 | Drag handle drawn on TV. | `{!IS_TV && <View style={styles.handle} …/>}`. | S |
| TV-12 | TODO | PARTIAL | L | android/.../player/TvRemoteModule.kt:50-65 | CAPTIONS, INFO unmapped; MEDIA_STOP handled by MediaSession. | Map KEYCODE_CAPTIONS → "captions" (open Subtitles panel), KEYCODE_INFO → "info" (show controls); handle in useTvRemote. | S |
| TV-13 | TODO | CONFIRMED | L | docs/android-tv.md:11-12,51,135-136 vs RootNavigator.tsx:342-361 | Doc says rail Videos/Recents/Settings, "No SMB". | Update doc: rail = Videos, Recents, Network, Telegram (when available), Settings; SMB shipped. | S |

## Visual design (DS)

Checked against Material 3 Expressive and the Google TV design guides. **Keep:** the single
accent colour, the true-black background, tonal surfaces instead of shadows, `Touchable` as the
only pressable, pill buttons, and the TV scale and overscan values. Contrast ratios were
computed with the WCAG formula.

| ID | Status | Verdict | Impact | file:line | evidence | change | effort |
|---|---|---|---|---|---|---|---|
| DS-1 | DONE | CONFIRMED | H | src/theme/colors.ts:14,16,26,32,43-44,51,56 | Light textTertiary #8E8E96 = 3.01:1 on background #F6F6F8, 3.25 on surface/cardElevated #FFF; dark #6E6E76 = 4.15 on #000, 3.70 on surface #121214, 3.36 on cardElevated #1C1C1F. 63 uses: 16 meaningful Text, 11 placeholderTextColor, 36 icons (~10 tappable). playerColors spreads darkColors so player panels change too. | Light `textTertiary: '#6E6E76'` (4.68/5.05/5.05); dark `'#8A8A92'` (6.13/5.46/4.96). Nothing else. | S |
| DS-2 | DONE | CONFIRMED | M | src/screens/NowPlayingScreen.tsx:565; src/components/ui/index.tsx:696 | Track title and SheetHeader both `type.heading` (16/22/500). | Add `display: { fontSize: 24, lineHeight: 30, fontWeight: '700', letterSpacing: -0.3 }` to `type` in theme.ts; NowPlaying:565 → `type.display`. | S |
| DS-3 | DONE | PARTIAL | M | src/theme/theme.ts:42-60; literals: NowPlayingLyrics 222,227; ui/index 1215; DoubleTapRipple 157; PlayerControls 821,866; RecapModal 170; VideoRow 501,503,521,552; MusicScreen 689,740; NowPlaying 916; Onboarding 724,726,731,764; Telegram 752,765; StormSceneIcon 736 | No display tier; 21 fontSize literals, which also skip `forTv` scaling (VideoRow heroTitle 24 doesn't grow on TV). Onboarding title 28/34 already equals `type.title`. | Add `micro: { fontSize: 11, lineHeight: 14, fontWeight: '500' }`. VideoRow 521 → `{...type.display, color: playerColors.text}`; 552 → `type.section`; 501/503 → `type.micro`; ui 1215 → `type.micro` (keep letterSpacing 0.5); MusicScreen 689 → `type.body`; Onboarding 724 → `{...type.title, textAlign:'center'}`, 731 → `type.body`; PlayerControls 821 see DS-11. Leave fixed-box sizes (866, 916, 740), lyrics, recap, Telegram code entry, SVG 736. | M |
| DS-4 | DONE | CONFIRMED | M | src/screens/OnboardingScreen.tsx:35-36,302,312,385,411,432,692,726 | BTN_H 52/BTN_RADIUS 16; '#FFFFFF' at 302/692; 312 `withTiming(1,{duration:680,easing:Easing.linear})`; 726 italic; phone buttons raw Pressable. TV path (502-512, 788) already fine. | `BTN_H = 48`, `BTN_RADIUS = 24`; 302/692 → `colors.onPrimary`; 312 → `withSpring(1, motion.spatial)`; 726 drop fontStyle → `{...type.body, textAlign:'center', color: colors.textSecondary}`; phone Pressable → `Touchable` (keep android_ripple). | M |
| DS-5 | DONE | CONFIRMED | L | src/screens/NowPlayingScreen.tsx:461-481 | 3-stop gradient + rgba(0,0,0,.48)/rgba(255,255,255,.45) wash; hard-coded '#121214', fallback '#1c1c1f'/'#e6e6ea'. | Keep the wash (legibility). Replace '#121214' → `colors.surface`; fallback → `dark ? colors.cardElevated : colors.surfaceVariant`. | S |
| DS-6 | DONE | CONFIRMED | L | MiniPlayer.tsx:297; NowPlayingScreen.tsx:861,900; AlbumDetailScreen.tsx:305 | elevation 6/8/4/6 against colors.ts:4-5 "lighter steps, not shadows"; only visible in light mode. QueueList:174 drag lift is fine. | `elevation: 0` at all four; drop shadowColor at MiniPlayer 171/263, NowPlaying 774, AlbumDetail 194. | S |
| DS-7 | DONE | PARTIAL | L | src/theme/theme.ts:66-70; src/screens/PlayerDetailScreen.tsx:154-158 | press ζ≈0.895, spatial ζ≈0.907 (~0.15% overshoot: effectively none). PlayerDetail uses legacy Animated.timing 600ms. | Add `expressive: { mass: 1, stiffness: 380, damping: 31 }` (ζ≈0.8) to `motion`; PlayerDetail poster fade → Reanimated `withTiming(1, { duration: motion.fadeOut })`. | S |
| DS-8 | DONE | CONFIRMED | L | src/screens/FoldersScreen.tsx:362,367; src/components/VideoRow.tsx:466,510 | Folder gridCover 16/10 vs video gridThumb 16/9; rowCover 88×56 vs rowThumb 128×72. Hero (510) deliberately 16/10. | Folders 367 → `aspectRatio: 16 / 9`; 362 → `rowCover: { width: 96, height: 54 }`. | S |
| DS-9 | DONE | PARTIAL | L | src/screens/NowPlayingScreen.tsx:607-623,896-903 | 68dp circle never changes shape (has 0.94 press scale + buffering spinner). | Shared radius: 34 paused, `metrics.radius.card` (20) playing, `withSpring(r, motion.expressive)`. Needs DS-7 first. | M |
| DS-10 | DONE | CONFIRMED | L | src/components/VideoRow.tsx:427-442 (also PermissionGate 34, NowPlaying 446, PlayerDetail 167) | 48dp textTertiary glyph + centred grey body text template. | In EmptyState: glyph inside 72dp circle (`borderRadius: metrics.radius.pill`, `backgroundColor: colors.fill`), glyph 32 `colors.textSecondary`; text → `type.row` in `colors.text`. | S |
| DS-11 | DONE | CONFIRMED | M | src/components/VideoPlayer/PlayerControls.tsx:820-821 | Title type.row 15/20; subtitle literal 11.5/15 skips TV scaling. | 821 → `subtitle: { ...type.caption, color: colors.textSecondary }`. | S |
| DS-12 | DONE | PARTIAL | L | src/navigation/RootNavigator.tsx:254-269,330,648 | Feather `home` for the route titled "Home"; selected already changes icon colour + label colour; weight stays 500. Phone only. | 269 → `[type.caption, styles.label, focused && { fontWeight: '600' }, labelStyle]`. Keep icon. | S |
| DS-13 | DONE | CONFIRMED | L | src/components/ui/index.tsx:1018 | Snackbar hard-codes '#2A2A2E'. | `backgroundColor: colors.surfaceVariant` (player palette #26262A, 12.9:1). | S |
| DS-14 | DONE | CONFIRMED | M (TV) | src/components/VideoRow.tsx:303-304 | `focusRing={false}` on TV Continue card; only 1.05 grow + faint tint. | Delete 303-304 so the default 3dp primary ring applies. Phones unaffected. | S |

## Simpler code (CM)

Checked with git history for deliberate choices. `npx tsc --noEmit` and `npx eslint src --quiet`
were clean on 2026-11-19.

| ID | Status | Verdict | Pay | Eff | file:line | Evidence | Plan | Risk / test |
|---|---|---|---|---|---|---|---|---|
| CM-1 | DONE | MARGINAL (Album) / REJECT (Telegram) | L | S | src/screens/AlbumVideosScreen.tsx:42,93-124,156; TelegramScreen.tsx:270-276 | VideoRow/VideoCard are React.memo with primitive props → only renderItem reruns; saves happen mostly while behind the player. | Optional: row wrapper selecting its own progress tuple (pattern PlaylistPanel:37); delete `history`, `getHistoryEntry` (dupes store's findHistoryEntry), `extraData`. | Bar updates after "mark watched" and after returning from player. |
| CM-2 | — | REJECT | L | L | src/utils/SubtitleParser.ts; callers SubtitleCueStore:138, SubtitlePickerService:66,193, subdlApi:381 | Media3 SsaParser drops inline {\i1}{\b1}; SDH/entity normalisation stays in JS; subdl/picker pass strings not paths. | Keep JS parser; fix regexes (SB-1/SB-2/CM-N1). | — |
| CM-3 | TODO | WORTH IT (in AnimatedVideoView, not GlidePlayer) | M | S | src/components/VideoPlayer/AnimatedVideoView.tsx:224-262; VideoPlayerScreen.tsx:1181-1190 | Memo boundary is AnimatedVideoView; areEqual edited 10+ times (git log -L); plain memo would reintroduce churn removed in ca9feee. | 1) In AnimatedVideoView `const h = useRef(props); h.current = props;` pass stable `e => h.current.onX?.(e)` wrappers to GlidePlayer. 2) areEqual: generic key compare; `on*` compare presence only (`!!a[k] === !!b[k]`, PiP buttons depend on presence); skip initialResumeSeconds, preferredAudioLanguage; compare `source.uri`. 3) Delete creditsAtRef/skipsRef and the onEnd special case. | Test auto-play-next after playlist change, PiP prev/next appear+work, credits Up next, skip intro; check audioEqualizer/animatedStyle identity stable. |
| CM-4 | DONE | WORTH IT | L | S | src/store/appStore.ts:111-138,161-275 | 18 pure-copy setters (1-3 callers each). Keep setSubtitlePosition (clamp), setHapticStrength (nested), setCrashReportsEnabled (native). | Grep each setter, replace with `updateSettings({k: v})`, delete from type + store. | tsc + Settings smoke test. |
| CM-5 | DONE | WORTH IT | M | S | android/.../player/MediaStoreVideoModule.kt:419-556 vs 559-657; src/services/MediaService.ts:153-185 | getVideos runs on every album refresh; drifted (no rescanVolumes, no hashed bucketId fallback); never refreshes libraryCache (CM-N3). | Delete Kotlin getVideos + JS mock (__tests__/mediaStoreVideo.test:64); `getVideosByAlbum` = `(await this.getLibrary(forceRefresh)).videos.filter(filterFn)`. | Pull-to-refresh inside an album after adding a file; Folders counts update. |
| CM-6 | — | REJECT | L | M | src/services/ThumbnailService.ts:85-138,187-246 | Memo answers repeats with 0 hops; hot path is 1 hop; LIFO/promote/cancel would need porting. | — | — |
| CM-7 | DONE | MARGINAL (fix 3, keep 2) | L | S | MediaStoreVideoModule.kt:166; MediaStoreAudioModule.kt:54; SubtitleSyncModule.kt:552; Credits.kt:136 (keep); HapticAnalysis.kt:36 (keep) | Thumb/art/sync-decoder pools run at foreground priority during playback; `catch (e: Exception)` lets OOM Error leave the Promise unsettled. | Make `BackgroundWork.lane` internal; use `lane(n,"…")` for thumb(4), art(2), sync decoders; catch Throwable in thumb/art blocks. | Scrub during auto-sync; scroll large library. |
| CM-8 | — | REJECT (for now) | L | M | src/components/VideoPlayer/GlidePlayer.tsx:33,116-134; android/gradle.properties:37 | Works via interop; commands by name deliberate (d91e20f); setNativeProps fine for idempotent volume. | Revisit when interop is deprecated (with KeyboardInset ui/index.tsx:725). | — |
| CM-9 | — | REJECT | L | M | src/store/videoHistoryStore.ts:124-147,452-458 | ≤500 entries, debounced, 20s cadence; per-key would cost N parses at startup. | — | — |
| CM-10 | TODO | MARGINAL | L | S | android/.../player/SubtitleSyncModule.kt:60-117,283-520; haptic/HapticAnalysis.kt:138,156 | Shared decoder lives in a 759-line ReactModule companion. | After uncommitted SubtitleSyncModule edits land: move decodeAudio, PcmSink, PcmDecoder, MediaCodecPcm, FfmpegPcm into `player/AudioDecode.kt` (`internal object AudioDecode`); update 2 haptic imports. | JVM tests, auto-sync, haptics-lab listen. |
| CM-11 | DONE | MARGINAL | L | S | src/screens/PlayerDetailScreen.tsx:9,53-54,135-195 | Already useNativeDriver; consistency only. | useSharedValue + useAnimatedScrollHandler + interpolate(CLAMP) + withTiming poster fade. Pair with DS-7. | Hero parallax/fade phone + TV. |
| CM-12 | DONE | MARGINAL | L | S | src/services/LyricsService.ts:197-262 | `RNFS.exists` (:216) redundant; parse-or-plain repeated 4×. | `toLines(raw)` helper; drop exists; keep source order. | Track with and without sidecar .lrc. |
| CM-13 | — | KEEP | — | — | src/hooks/useSubtitleDisplay.ts:64-95 | 250ms playing/500ms paused, extrapolated; linear scan deliberate. | If ever needed: setTimeout to next cue boundary. | — |
| CM-N1 | DONE | WORTH IT | H | S | src/utils/SubtitleParser.ts:16,59 | Same as SB-1/SB-2 (node-verified `00:01.000 --> 00:04.000` fails). | One shared time parser `(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{3})`; jest cases per variant. | Merged into SB-1/SB-2. |
| CM-N2 | TODO | WORTH IT | M | S | android/.../player/SubtitleSyncModule.kt:734-754; src/services/SubtitleCueStore.ts:132-148 | Embedded extract writes temp SRT → JS readSubtitleFile → unlink (ffmpeg-kit leftover); doc mentions a nonexistent cleanupSubtitleFiles. | Resolve the SRT string directly; delete readSubtitleFile; fix comment. After the uncommitted edits land. | Embedded subtitle pick on MKV + MP4. |
| CM-N3 | — | — | M | S | MediaService.getVideosByAlbum | Album refresh leaves libraryCache stale. | Fixed by CM-5. | — |

## React Compiler (RC)

Status: `TODO`

**Verdict: go, in stages.** React Compiler 1.0.0 (stable, Oct 2025) was run over every file in
`src/` with Glide's real Babel setup (scratch run, repo untouched).

**Results:**
- 0 crashes. 155 functions compiled; 56 skipped across 47 files.
- A skipped function runs exactly as it does today. The compiler leaves it alone rather than
  changing it.
- Every function that writes a ref during render, or writes a Reanimated `.value`, is skipped.
  That includes `usePlayerCore` and `VideoPlayerScreen`.
- Worklets still compile correctly alongside it: 0 worklets hoisted out, and every worklet keeps
  its id.
- No package upgrades are needed. Ignore `react-compiler-healthcheck`'s "97/97": it is wrong
  here.

| package | version | status | evidence |
|---|---|---|---|
| babel-plugin-react-compiler | 1.0.0 (new) | stable; must be the first Babel plugin; `panicThreshold:'none'` (the default) skips instead of failing | react.dev/blog/2025/10/07/react-compiler-1 |
| reanimated / worklets | 4.7.1 / 0.13.0 | works; the compiler detects Reanimated automatically. Writing `.value` makes the compiler skip that function; `get()/set()` avoids it (Glide uses `.value` everywhere). The old worklet-hoisting bug (reanimated#6826) was not seen | docs.swmansion.com/react-native-reanimated/docs/core/useSharedValue |
| gesture-handler | 3.4.0 | 28 old-style `Gesture.X()` builders compile fine; v3's hook API is the long-term option | RNGH upgrading-to-3 guide |
| zustand | 5.0.x | works; inline selectors become stable functions | — |
| react-native-mmkv | 4.3.2 | no issues found; `useMMKVString` compiled | — |
| flash-list | 2.3.3 | no issues found | — |
| react-navigation | 7.x | no issues; RootNavigator 7 of 11 functions compiled | — |
| react-native-stallion | 2.4.2 | `node_modules` is never compiled; `App` itself is skipped (App.tsx:24 uses a variable before it is declared) | — |

**Why functions were skipped:**

| Count | Reason | Examples |
|---|---|---|
| 21 | Shared value changed after it was passed to a hook | NowPlayingLyrics.tsx:114, Pager.tsx |
| 16 | Syntax the compiler doesn't support yet | `try/finally` (15, e.g. TrackSelector.tsx:308); `??=` at PlayerControls.tsx:520 and useResumePlayback.ts:89; `try` without `catch` at useSubtitleAutoSync.ts:74; global `x++` at useTvRemote.ts:104 |
| 7 | `.value` written after use in an effect | MiniPlayer.tsx:138, usePlayerCore.ts:134 |
| 6 | Value treated as unchangeable | usePlayerCore.ts:145 |
| 6 | Ref read or written during render | QuickSettingsPanel.tsx:98, FloatingSyncPanel.tsx:274 |
| 6 | An `eslint-disable react-hooks/exhaustive-deps` comment | VideoPlayerScreen.tsx:452/1180/1297, useVideoSearch.ts:51, NetworkScreen.tsx:213, RecentsScreen.tsx:84 |
| 1 | Existing `useMemo` couldn't be kept | OnboardingScreen.tsx:366 |

**Steps:**

| Step | Status | What |
|---|---|---|
| RC-1 | TODO | `npm i -D -E babel-plugin-react-compiler@1.0.0` |
| RC-2 | TODO | Phase 1: compile everything except the player (see the config below). Then `npx react-native start --reset-cache` and build a release APK. |
| RC-3 | TODO | Lint: `eslint-plugin-react-hooks` 7.1.1 already ships through `@react-native/eslint-config`. Turn on its compiler rules (`recommended`) as `warn` in `.eslintrc.js`. Baseline: 51 files flagged. |
| RC-4 | TODO | Device test, phone and TV: MiniPlayer drag-to-dismiss; Now Playing morph, queue drag, lyrics follow; every sheet (open, close, swipe, Back); Settings; Home folder filter; tab switches; Onboarding pager; TV focus rings on Home, Settings, sheets and dialogs; the Back key. In React DevTools, compiled components show "Memo ✨". |
| RC-5 | TODO | Phase 2, after one release: delete `sources` and re-test the player (seek, speed, zoom, volume and brightness gestures, double-tap, QuickSettings, track selector, PiP, TV remote seek, resume, Up next). |
| RC-6 | TODO (optional) | Let the compiler cover more, best gain first: `.value` → `get()/set()` in the gesture hooks; rewrite the 17 `try/finally` and `??=` sites; move render-time `ref.current =` into effects or `useEffectEvent`; remove the 6 eslint-disable sites, which unblocks VideoPlayerScreen. |
| RC-7 | — | Keep the 459 manual `useCallback`/`useMemo`. Remove them only file by file, once a file compiles cleanly and lints clean, and never in a file the compiler skips. |

Phase 1 `babel.config.js`. The compiler goes first, worklets stays last, and the env block is
unchanged:

```js
plugins: [
  ['babel-plugin-react-compiler', {
    target: '19',
    // phase 1: skip the player; delete `sources` in phase 2 (RC-5)
    sources: f => !/[\\/](hooks[\\/]video-player|components[\\/]VideoPlayer)[\\/]|VideoPlayerScreen/.test(f),
  }],
  ['module-resolver', { root: ['./'], alias: {'@': './src'}, extensions: ['.ts', '.tsx', '.js'] }],
  'react-native-worklets/plugin',
],
```

**Rollback:** remove the plugin line and run `--reset-cache`, or add `'use no memo'` inside one
component. A JS-only rollback can ship as a Stallion OTA update.

**Risks:**
- Effects with deliberately missing dependencies may re-run differently once compiled; the device
  test covers this.
- A future Reanimated callback that captures nothing could hit the hoisting bug. Keep explicit
  `'worklet'` directives.
- On the player there is little gain until `.value` moves to `get()/set()`.
- The `sources` regex must accept both `\` and `/` (Windows).
