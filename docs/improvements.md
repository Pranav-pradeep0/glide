# Improvements backlog

Running list of bugs, rough edges and small features spotted while working. One line each:
**where** — what — why it matters — size (S < 1h, M = a few hours, L = a day+). Native or JS makes no difference until launch: each item gets its root-cause fix wherever that lives.
Started 2026-10-11 from a walk of the main screens. ✅ marks done, with the commit.

## Bugs

- ✅ `4fc6516` **Now Playing › Sleep timer** (`NowPlayingScreen.tsx:70-102`) — the tick and "Xm left" match on `round(remaining/60) === 15`, so a 15-minute timer loses its tick after ~30 s, and a 30-minute timer shows "15 minutes" ticked halfway through — the sheet lies about what's set — S
- **Music › Folders** (`MusicScreen.tsx:180-186`) — opening a folder shows the previous folder's songs until the new list loads, and a failed load leaves the spinner state wrong (no try/finally) — S
- **Music › folder view** — hardware Back leaves the Music tab instead of returning to the folder list (no BackHandler while `selectedFolder` is set) — S
- **Music › A–Z scroller** (`MusicScreen.tsx:282-298, 589`) — shown for every sort, but always jumps by title, so with "Artist" or "Recently added" it lands somewhere random — S
- ✅ `d054578` **Lyrics** (`LyricsService.ts:193-202`) — a network failure caches "no lyrics" for the session (roadmap Phase 2, still open) — S
- ~~**Lyrics** (`NowPlayingScreen.tsx:185`) — no `.catch`~~ not a bug: `getLyricsForTrack` catches every step and never rejects
- ✅ **Recents › Music** (`RecentMusicList.tsx:35-45`) — with audio permission denied it says "Nothing played yet" — misleading dead end — S
- ✅ `ee30459` **Recents › Delete** (`RecentsScreen.tsx:99-101`) — entries without `contentUri` say "Open this video from Videos to delete it", but `MediaService.deleteVideos` already resolves paths to URIs (`e919b33`) — S
- ✅ **Folders** (`FoldersScreen.tsx:184`) — permission denied shows "No videos found · Refresh"; video permission is only ever *requested*, never checked, and "never ask again" has no route to Settings (`PermissionService.hasAndroidPermission`) — M

- ✅ `f67414e` **Snackbar** (`ui/index.tsx:614-663`) — after fading it stays mounted at opacity 0 and keeps catching taps: an invisible strip over the bottom of the screen (in the player, over the controls) for the rest of the session — S *(verified)*
- ✅ `f67414e` **Settings › Shake action / Font** (`SettingsScreen.tsx:465, 730`) — chip rows don't wrap; "Backward 10 s" etc. run off-screen and can't be tapped — S *(verified)*
- ✅ `ee30459` **Delete, all screens** (`AlbumVideosScreen.tsx:70`, `SearchScreen.tsx:103`, `RecentsScreen.tsx:110`) — cancelling Android's delete dialog rejects `E_DELETE_CANCELLED` and shows "Delete failed… check permissions" — S
- ✅ **Search** (`useVideoSearch.ts:42-47`, `videoIndexStore.ts:25-40`) — results memo ignores index changes, the index is built once (empty if permission was denied) and never re-synced, a failed first load spins "Preparing search" forever — M
- ~~**Album / Artist detail, Recents › Music** — promises with no `.catch`~~ not a bug: `AudioMediaService.getSongs` catches and never rejects
- **Album / Artist detail** — (permission gate ✅) no empty state: "0 songs" with Play All / Shuffle that do nothing — S
- **AlbumVideos** (`AlbumVideosScreen.tsx:130-150`) — no pull-to-refresh; "Play all" only opens the first video (one file if auto-play-next is off) — S
- ✅ **Update modal** — reappears every cold start (`updateStatus` memory-only; roadmap Phase 2) — S *(the announced version is now kept in update storage)*
- **Subtitles** — SubDL `.ass`/`.ssa` are rejected by the `-->` check in `subdlApi.ts`, and downloads are always parsed as `'srt'` (`PlayerDetailScreen.tsx:143, 281`); `picked_subtitle_*` never cleaned (roadmap Phase 2) — S
- **TrackOptionsSheet** (`TrackOptionsSheet.tsx:38-40`) — returns null as soon as `track` clears, so the close animation never plays; double horizontal inset — S
- **Licences sheet** — hardware Back on a licence closes the whole sheet instead of returning to the list — S
- **Snackbar position** (`RootNavigator.tsx:361`) — offset ignores the mini player, so snackbars overlap it; 64 dp too high on stack screens — S


### Reported by Pranav (2026-10-11)

- ✅ `7980891` **Audio / Subtitles panels** (`TrackSelector.tsx`) — track rows sit flat on the panel (own `TrackRow`, no grouping, no icons) while the ⋮ Playback panel uses grouped `ListGroup`/`ListRow` cards; tabs are full-width chips — M
- ✅ `e5bcff4` **Active state** (`PlayerControls.tsx:686`, `GlyphButton`) — "on" is a white icon on a 14% white circle vs a white icon with no circle: enhancement / night mode / mute / rotation lock barely change when switched on — S *(the solid disc read too loud; now the filled icon plus a dot under it)*
- ✅ `e5bcff4` **Lock button under the camera hole** (`PlayerControls.tsx:696`) — rail is `left: 8` with no side inset; `effectiveInsets` never passes the real landscape cutout inset, and the top bar / bottom bar ignore left/right too — S *(refined: with a punch hole only the controls level with it move in; `getCutoutRects`, API 9)*
- ✅ `5821e85` **Mini player** (`MiniPlayer.tsx:105-121`) — no swipe-down to close; `clearQueue()` already stops and clears — S
- ✅ **Updates under "Open with"** — the check and the prompt lived only in `App.tsx`, so a video opened from another app never learned of an update; now a one-time snackbar and a row in ⋮ Playback — M
- **Packages** — ~~`react-native-share` (1 call; its merged FileProvider is the `cache-path "/"` exposure)~~ ✅ native `shareVideo` (API 6), ~~`react-native-zip-archive` (1 call; no size cap / zip-bomb guard)~~ ✅ `SubtitleZip.kt` (API 7), ~~`react-native-linear-gradient` (5 uses; svg already installed)~~ ✅ `Gradient` in the ui kit, ~~`react-native-config` (9 build-time strings)~~ ✅ `.env` read in `app/build.gradle`, served as `GlideNative.env` (API 8) — M

### Video player

- ✅ `e5bcff4` **Errors** (`PlayerControls.tsx:503`, `usePlayerCore.ts:522`) — the error banner lives inside the controls overlay and fades with it after 3 s, leaving a black screen; it shows raw `ERROR_CODE_*` names; no Retry / Next / Close, and Play does nothing (player is idle). Includes 8c: GL 7000-range errors should switch enhancement off and say so (toggling it off already reopens at the current position) — M *(verified)*
- ✅ `e5bcff4` **Audio sync** (`AnimatedVideoView.tsx:187-210`) — `areEqual` never compares `audioDelay`, so the sync slider does nothing until another prop changes — S *(verified)*
- ✅ **Next / Prev / autoplay** (`usePlayerSettings.ts:79-97`) — `navigation.replace` remounts the screen: sleep timer, speed, EQ, enhancement, resize and mute reset every episode — M *(now a `carry` route param; also night mode, haptics toggle, rotation lock)*
- ✅ **Sleep timer** — on expiry calls `goBack()` even for "Open with" (black player; should use `handleGoBack`); "End of video" never fires with Repeat on; Quick Settings shows "30 min" with no countdown — S
- ✅ **Back** (`VideoPlayerScreen.tsx:1013`) — in landscape, Back with Quick Settings / Playlist / Bookmarks / sync panel open exits the video instead of closing the panel — S
- ✅ **Lock / rotation** (`usePlayerUI.ts:159,172`) — unlocking re-enables auto-rotate even when the rotation-lock toggle is on — S
- ✅ **Resume prompt** (`useResumePlayback.ts:47-77`) — the "paused 5 min" prompt shows the position from when the video opened, not now; dismissing ResumeModal starts playback despite the comment saying it doesn't — S *(the long-pause prompt and Recap now use where you paused; closing pauses)*
- ✅ **External subtitle** (`usePlayerTracks.ts:214`) — saved as track `-999` with no file; reopening restores nothing and shows "Off" — S *(cues saved per video in `ExternalSubtitleStore`, swept at launch like stop frames)*
- ✅ **Stale exit save** (`PlayerControls.tsx:628-650`) — memo skips handlers, so on-screen Back while paused can save an old audio track / delay — S *(controls get stable stand-ins that call the latest handler; the memo compares every other prop — Next carried stale settings too)*
- ✅ **Resize pill** — cycles 6 modes incl. `scale-down`, Quick Settings knows 5; on `scale-down` nothing is ticked — S *(the pill steps through `DISPLAY_MODES` via `nextDisplayMode`; unused `toggleResizeMode` removed)*
- ~~**Playlist pick** drops `playMode`~~ ✅; scrub to 0:00 then exit doesn't save — S
- ✅ **SystemBars** (`VideoPlayerScreen.tsx:1062`) — cleanup un-hides bars on every controls toggle, likely a bar flash — S *(confirmed: cleanup showed then the effect hid the bars on every hide; now declarative `<SystemBars hidden>` stack entries, with the app theme as the base in RootNavigator)*
- ✅ **Subtitle failures** (`TrackSelector.tsx`) — pick/download/parse/search failures silent; one AbortController shared by search and download — S *(inline notice in the panel; `searchAllSubtitles` now rejects on a failure instead of returning "no results"; separate search / download controllers)*
- ✅ **Panels pausing** — Quick Settings pauses and doesn't resume; audio/subtitle panels don't pause; Recap backdrop resumes but Resume backdrop doesn't — S *(decided: panels never pause; closing Recap or Continue watching stays paused, only their Resume button plays)*
- **Bookmarks** — add / list buttons landscape-only though empty state says "tap the bookmark button"; delete has no Undo — S
- ✅ **Subtitle size** — default 0.38 never applies (`?? 0.42`); pinch-resize not saved — S *(pinch now saves via `setSubtitleFontSize`, capped at the slider's 40 px; the 0.38 claim was mostly wrong: defaults merge in, only dead `0.42` fallbacks, now pointed at the defaults)*
- **Snackbars under portrait panel Modals** — "Sleep timer set" etc. probably hidden by the scrim — S
- **Perf** — HUD state in the 1400-line screen re-renders it on every gesture step; brightness "throttle" is `floor(y) % 5`; Quick Settings sliders send a native prop per step; landscape playlist mounts and queues thumbnails at open; hidden time labels still tick React state — S–M
- ✅ **Screen lock across autoplay** — the next episode opens unlocked (lock isn't carried), so a pocketed phone is touchable again — S
- **Small features** — no on-screen Previous button; autoplay-next has no "Up next" countdown/cancel; playlist doesn't scroll to current or show watched progress; no "Play from start" / "Mark as watched" in video options — S each

## UI / UX rough edges

- ✅ **Recents** — thumbnails are the generic frame, not where you stopped; `ThumbnailService` already takes a time, `useThumbnail` always passes 0. Also: the native side seeked to the nearest keyframe (`OPTION_CLOSEST_SYNC`), seconds off — S
- ✅ **Now Playing › Queue** — reorder is up/down chevrons with 32 dp targets, hidden while shuffle is on; no drag. Now a drag handle that also works in shuffle (native `moveInShuffleOrder`, API 5); TalkBack gets Move up / Move down actions — M
- ✅ **Now Playing › Lyrics** — box is only cover-sized; empty LRC lines render as blank rows; no hint that online lyrics are off in Settings when nothing is found; the current line grows 16→18 px and reflows the list — M *(full-screen view, ♪ breaks, one-tap "Turn on online lyrics", fixed-size lines)*
- **Now Playing › Lyrics** — auto-scroll yanks back while you're reading (pause it while the user scrolls) — S
- **Now Playing** — heart uses the app primary while every other control uses the cover accent; equalizer icon never shows "active" when a preset is on — S
- **Music** — Albums / Artists / Folders tabs show a blank list when empty or when search matches nothing (only Tracks has an EmptyState) — S
- **EmptyState** (`VideoRow.tsx:365-374`) — always a film icon, including on Music and Recents › Music — S
- **Music › A–Z scroller** — 10 px letters with ~14 dp targets, tap-only (no drag along the strip) — S
- **Folders / Recents / Music / Search / AlbumVideos** — view mode, sort and Recents' Videos/Music chip reset every launch (roadmap Phase 6) — S
- ✅ **Permission dead ends, app-wide** — Folders, AlbumVideos, Search, Recents › Music, Album/Artist detail all show plain "nothing here" copy when access is denied; Android 14 "Select videos" partial access has no "select more / allow all"; Music's button still says "Grant Permission" when tapping it opens Settings. Extract Music's screen into a shared `PermissionGate` — M
- **Headers** — Settings uses a raw title (4 dp different inset from other tabs); Album/Artist use a centred bar with `chevron-left`, AlbumVideos/Search a left bar with `arrow-left`, PlayerDetail a floating chevron — M
- **Wording** — "Play All" vs "Play all", "Song Options", "Grant Permission", "Access your Music" in title case against sentence case elsewhere; Album/Artist have no primary action button — S
- **Settings** — "Reset to default" for subtitle appearance has no confirm; "Clear subtitle cache" always says Done — S
- ✅ **Search** — `No videos match "a"` flashes during the 300 ms debounce — S
- **MiniPlayer** (`MiniPlayer.tsx:181`) — Next has no haptic (swipe does); while buffering the spinner replaces play/pause so you can't pause — S
- **Touch targets** — TrackRow "more" 28 dp, Album/Artist "more" 32 dp, ~~queue buttons 32 dp~~ (✅ with the queue drag) — S
- **Small features** — theme "Auto" (follow system); re-tapping a tab scrolls to top; AlbumVideos sort + folder-scoped search; consider "Third-party licences" as the Settings label so nobody reads it as Glide being open source — S each

- **Music queue after a late grant** (`audioStore.ts:97`) — the saved queue is resolved against MediaStore once at launch; granting audio access later leaves it unresolved until the next launch — S

## Slow paths

- **Folders** (`FoldersScreen.tsx:149-150`) — `onPress={() => handleAlbumPress(item)}` is a new closure per render, defeating the cards' `React.memo` (the VideoRow fix in `21dce13` never reached this screen) — S
- **Folders** (`FoldersScreen.tsx:122-128`) — scroll-to-top timer on sort change is dead: the list's `key` includes `sortBy`, so it remounts at the top anyway — S
- **Settings sliders** (`SettingsScreen.tsx:417, 490, 567, 613, 624`) — every drag frame writes the store and MMKV and re-renders the 770-line screen; commit on `onSlidingComplete` like `FontSizeSliderControl` — S
- **Album / Artist detail** — inline unmemoised song rows duplicating `TrackRow`; all re-render on every play/pause — S
- **AlbumVideos** — subscribes to the whole history map with `extraData={history}` — S
- **PlayerDetail** (`PlayerDetailScreen.tsx:98-184`) — on mount extracts and parses every embedded subtitle and calls OMDb + SubDL, competing with player start if you tap Play — M
- **Music › Folders** — `getSongsByFolder` is a native round trip for a subset of `tracks` already in memory — S

## Open roadmap items (carried here for ordering)

- Sign Stallion OTA bundles — top security item — M
- 8c: ✅ enhancement GL-error fallback (`e5bcff4`); ✅ Android 8/9 delete permission (`ee30459`); thumbnail negative cache; ✅ ErrorBoundary hides splash (`1e6b4c9`) — S each
- Pin CI actions by SHA, quote the secret heredocs — S

## Ops

- v2.3.0 "Android CI" run from 2026-10-10 19:12 UTC was still reported `in_progress` on 2026-10-11 — check whether the release job hung.
