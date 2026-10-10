# Improvements backlog

Running list of bugs, rough edges and small features spotted while working. One line each:
**where** — what — why it matters — size (S < 1h, M = a few hours, L = a day+). `[JS]` ships
over the air; `[native]` needs a new APK. Started 2026-10-11 from a walk of the main screens.

## Bugs

- **Now Playing › Sleep timer** (`NowPlayingScreen.tsx:70-102`) — the tick and "Xm left" match on `round(remaining/60) === 15`, so a 15-minute timer loses its tick after ~30 s, and a 30-minute timer shows "15 minutes" ticked halfway through — the sheet lies about what's set — S [JS]
- **Music › Folders** (`MusicScreen.tsx:180-186`) — opening a folder shows the previous folder's songs until the new list loads, and a failed load leaves the spinner state wrong (no try/finally) — S [JS]
- **Music › folder view** — hardware Back leaves the Music tab instead of returning to the folder list (no BackHandler while `selectedFolder` is set) — S [JS]
- **Music › A–Z scroller** (`MusicScreen.tsx:282-298, 589`) — shown for every sort, but always jumps by title, so with "Artist" or "Recently added" it lands somewhere random — S [JS]
- **Lyrics** (`LyricsService.ts:193-202`) — a network failure caches "no lyrics" for the session (roadmap Phase 2, still open) — S [JS]
- **Lyrics** (`NowPlayingScreen.tsx:185`) — `getLyricsForTrack` has no `.catch`; if it rejects the spinner never stops — S [JS]
- **Recents › Music** (`RecentMusicList.tsx:35-45`) — with audio permission denied it says "Nothing played yet" — misleading dead end — S [JS]
- **Recents › Delete** (`RecentsScreen.tsx:99-101`) — entries without `contentUri` say "Open this video from Videos to delete it", but `MediaService.deleteVideos` already resolves paths to URIs (`e919b33`) — S [JS]
- **Folders** (`FoldersScreen.tsx:184`) — permission denied shows "No videos found · Refresh"; video permission is only ever *requested*, never checked, and "never ask again" has no route to Settings (`PermissionService.hasAndroidPermission`) — M [JS]

- **Snackbar** (`ui/index.tsx:614-663`) — after fading it stays mounted at opacity 0 and keeps catching taps: an invisible strip over the bottom of the screen (in the player, over the controls) for the rest of the session — S [JS] *(verified)*
- **Settings › Shake action / Font** (`SettingsScreen.tsx:465, 730`) — chip rows don't wrap; "Backward 10 s" etc. run off-screen and can't be tapped — S [JS] *(verified)*
- **Delete, all screens** (`AlbumVideosScreen.tsx:70`, `SearchScreen.tsx:103`, `RecentsScreen.tsx:110`) — cancelling Android's delete dialog rejects `E_DELETE_CANCELLED` and shows "Delete failed… check permissions" — S [JS]
- **Search** (`useVideoSearch.ts:42-47`, `videoIndexStore.ts:25-40`) — results memo ignores index changes, the index is built once (empty if permission was denied) and never re-synced, a failed first load spins "Preparing search" forever — M [JS]
- **Album / Artist detail, Recents › Music** (`AlbumDetailScreen.tsx:50`, `ArtistDetailScreen.tsx:81`, `RecentMusicList.tsx:37`) — promises with no `.catch`; a rejection leaves the loader spinning — S [JS]
- **Album / Artist detail** — no empty state: "0 songs" with Play All / Shuffle that do nothing — S [JS]
- **AlbumVideos** (`AlbumVideosScreen.tsx:130-150`) — no pull-to-refresh; "Play all" only opens the first video (one file if auto-play-next is off) — S [JS]
- **Update modal** — reappears every cold start (`updateStatus` memory-only; roadmap Phase 2) — S [JS]
- **Subtitles** — SubDL downloads always parsed as `'srt'` (`PlayerDetailScreen.tsx:143, 281`); `picked_subtitle_*` never cleaned (roadmap Phase 2) — S [JS]
- **TrackOptionsSheet** (`TrackOptionsSheet.tsx:38-40`) — returns null as soon as `track` clears, so the close animation never plays; double horizontal inset — S [JS]
- **Licences sheet** — hardware Back on a licence closes the whole sheet instead of returning to the list — S [JS]
- **Snackbar position** (`RootNavigator.tsx:361`) — offset ignores the mini player, so snackbars overlap it; 64 dp too high on stack screens — S [JS]


### Reported by Pranav (2026-10-11)

- **Audio / Subtitles panels** (`TrackSelector.tsx`) — track rows sit flat on the panel (own `TrackRow`, no grouping, no icons) while the ⋮ Playback panel uses grouped `ListGroup`/`ListRow` cards; tabs are full-width chips — M [JS]
- **Active state** (`PlayerControls.tsx:686`, `GlyphButton`) — "on" is a white icon on a 14% white circle vs a white icon with no circle: enhancement / night mode / mute / rotation lock barely change when switched on — S [JS]
- **Lock button under the camera hole** (`PlayerControls.tsx:696`) — rail is `left: 8` with no side inset; `effectiveInsets` never passes the real landscape cutout inset, and the top bar / bottom bar ignore left/right too — S [JS]
- **Mini player** (`MiniPlayer.tsx:105-121`) — no swipe-down to close; `clearQueue()` already stops and clears — S [JS]
- **Packages** — `react-native-share` (1 call; its merged FileProvider is the `cache-path "/"` exposure), `react-native-zip-archive` (1 call; no size cap / zip-bomb guard), `react-native-linear-gradient` (5 uses; svg already installed), `react-native-config` (9 build-time strings) are all replaceable. Removing any is native → next APK — M [native]

### Video player

- **Errors** (`PlayerControls.tsx:503`, `usePlayerCore.ts:522`) — the error banner lives inside the controls overlay and fades with it after 3 s, leaving a black screen; it shows raw `ERROR_CODE_*` names; no Retry / Next / Close, and Play does nothing (player is idle). Includes 8c: GL 7000-range errors should switch enhancement off and say so (toggling it off already reopens at the current position) — M [JS] *(verified)*
- **Audio sync** (`AnimatedVideoView.tsx:187-210`) — `areEqual` never compares `audioDelay`, so the sync slider does nothing until another prop changes — S [JS] *(verified)*
- **Next / Prev / autoplay** (`usePlayerSettings.ts:79-97`) — `navigation.replace` remounts the screen: sleep timer, speed, EQ, enhancement, resize and mute reset every episode — M [JS]
- **Sleep timer** — on expiry calls `goBack()` even for "Open with" (black player; should use `handleGoBack`); "End of video" never fires with Repeat on; Quick Settings shows "30 min" with no countdown — S [JS]
- **Back** (`VideoPlayerScreen.tsx:1013`) — in landscape, Back with Quick Settings / Playlist / Bookmarks / sync panel open exits the video instead of closing the panel — S [JS]
- **Lock / rotation** (`usePlayerUI.ts:159,172`) — unlocking re-enables auto-rotate even when the rotation-lock toggle is on — S [JS]
- **Resume prompt** (`useResumePlayback.ts:47-77`) — the "paused 5 min" prompt shows the position from when the video opened, not now; dismissing ResumeModal starts playback despite the comment saying it doesn't — S [JS]
- **External subtitle** (`usePlayerTracks.ts:214`) — saved as track `-999` with no file; reopening restores nothing and shows "Off" — S [JS]
- **Stale exit save** (`PlayerControls.tsx:628-650`) — memo skips handlers, so on-screen Back while paused can save an old audio track / delay — S [JS]
- **Resize pill** — cycles 6 modes incl. `scale-down`, Quick Settings knows 5; on `scale-down` nothing is ticked — S [JS]
- **Playlist pick** drops `playMode` (haptics mode lost); scrub to 0:00 then exit doesn't save — S [JS]
- **SystemBars** (`VideoPlayerScreen.tsx:1062`) — cleanup un-hides bars on every controls toggle, likely a bar flash — S [JS]
- **Subtitle failures** (`TrackSelector.tsx`) — pick/download/parse/search failures silent; one AbortController shared by search and download — S [JS]
- **Panels pausing** — Quick Settings pauses and doesn't resume; audio/subtitle panels don't pause; Recap backdrop resumes but Resume backdrop doesn't — S [JS]
- **Bookmarks** — add / list buttons landscape-only though empty state says "tap the bookmark button"; delete has no Undo — S [JS]
- **Subtitle size** — default 0.38 never applies (`?? 0.42`); pinch-resize not saved — S [JS]
- **Snackbars under portrait panel Modals** — "Sleep timer set" etc. probably hidden by the scrim — S [JS]
- **Perf** — HUD state in the 1400-line screen re-renders it on every gesture step; brightness "throttle" is `floor(y) % 5`; Quick Settings sliders send a native prop per step; landscape playlist mounts and queues thumbnails at open; hidden time labels still tick React state — S–M [JS]
- **Small features** — no on-screen Previous button; autoplay-next has no "Up next" countdown/cancel; playlist doesn't scroll to current or show watched progress; no "Play from start" / "Mark as watched" in video options — S each [JS]

## UI / UX rough edges

- **Recents** — thumbnails are the generic frame, not where you stopped; `ThumbnailService` already takes a time, `useThumbnail` always passes 0 — S [JS]
- **Now Playing › Queue** — reorder is up/down chevrons with 32 dp targets, hidden while shuffle is on; no drag — M [JS]
- **Now Playing › Lyrics** — auto-scroll yanks back while you're reading; box is only cover-sized; empty LRC lines render as blank rows; no hint that online lyrics are off in Settings when nothing is found — M [JS]
- **Now Playing** — heart uses the app primary while every other control uses the cover accent; equalizer icon never shows "active" when a preset is on — S [JS]
- **Music** — Albums / Artists / Folders tabs show a blank list when empty or when search matches nothing (only Tracks has an EmptyState) — S [JS]
- **EmptyState** (`VideoRow.tsx:365-374`) — always a film icon, including on Music and Recents › Music — S [JS]
- **Music › A–Z scroller** — 10 px letters with ~14 dp targets, tap-only (no drag along the strip) — S [JS]
- **Folders / Recents / Music / Search / AlbumVideos** — view mode, sort and Recents' Videos/Music chip reset every launch (roadmap Phase 6) — S [JS]
- **Permission dead ends, app-wide** — Folders, AlbumVideos, Search, Recents › Music, Album/Artist detail all show plain "nothing here" copy when access is denied; Android 14 "Select videos" partial access has no "select more / allow all"; Music's button still says "Grant Permission" when tapping it opens Settings. Extract Music's screen into a shared `PermissionGate` — M [JS]
- **Headers** — Settings uses a raw title (4 dp different inset from other tabs); Album/Artist use a centred bar with `chevron-left`, AlbumVideos/Search a left bar with `arrow-left`, PlayerDetail a floating chevron — M [JS]
- **Wording** — "Play All" vs "Play all", "Song Options", "Grant Permission", "Access your Music" in title case against sentence case elsewhere; Album/Artist have no primary action button — S [JS]
- **Settings** — "Reset to default" for subtitle appearance has no confirm; "Clear subtitle cache" always says Done — S [JS]
- **Search** — `No videos match "a"` flashes during the 300 ms debounce — S [JS]
- **MiniPlayer** (`MiniPlayer.tsx:181`) — Next has no haptic (swipe does); while buffering the spinner replaces play/pause so you can't pause — S [JS]
- **Touch targets** — TrackRow "more" 28 dp, Album/Artist "more" 32 dp, queue buttons 32 dp — S [JS]
- **Small features** — theme "Auto" (follow system); re-tapping a tab scrolls to top; AlbumVideos sort + folder-scoped search; consider "Third-party licences" as the Settings label so nobody reads it as Glide being open source — S each [JS]

## Slow paths

- **Folders** (`FoldersScreen.tsx:149-150`) — `onPress={() => handleAlbumPress(item)}` is a new closure per render, defeating the cards' `React.memo` (the VideoRow fix in `21dce13` never reached this screen) — S [JS]
- **Folders** (`FoldersScreen.tsx:122-128`) — scroll-to-top timer on sort change is dead: the list's `key` includes `sortBy`, so it remounts at the top anyway — S [JS]
- **Settings sliders** (`SettingsScreen.tsx:417, 490, 567, 613, 624`) — every drag frame writes the store and MMKV and re-renders the 770-line screen; commit on `onSlidingComplete` like `FontSizeSliderControl` — S [JS]
- **Album / Artist detail** — inline unmemoised song rows duplicating `TrackRow`; all re-render on every play/pause — S [JS]
- **AlbumVideos** — subscribes to the whole history map with `extraData={history}` — S [JS]
- **PlayerDetail** (`PlayerDetailScreen.tsx:98-184`) — on mount extracts and parses every embedded subtitle and calls OMDb + SubDL, competing with player start if you tap Play — M [JS]
- **Music › Folders** — `getSongsByFolder` is a native round trip for a subset of `tracks` already in memory — S [JS]

## Open roadmap items (carried here for ordering)

- Sign Stallion OTA bundles — top security item — M [native + CI]
- 8c: enhancement GL-error fallback; Android 8/9 delete permission; thumbnail negative cache; ErrorBoundary hides splash — S each [JS]
- Pin CI actions by SHA, quote the secret heredocs — S [CI]

## Ops

- v2.3.0 "Android CI" run from 2026-10-10 19:12 UTC was still reported `in_progress` on 2026-10-11 — check whether the release job hung.
