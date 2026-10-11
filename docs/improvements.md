# Improvements backlog

Running list of bugs, rough edges and small features spotted while working. One line each:
**where** — what — why it matters — size (S < 1h, M = a few hours, L = a day+). Native or JS makes no difference until launch: each item gets its root-cause fix wherever that lives.
Started 2026-10-11 from a walk of the main screens. ✅ marks done, with the commit.

## Bugs

- ✅ `4fc6516` **Now Playing › Sleep timer** (`NowPlayingScreen.tsx:70-102`) — the tick and "Xm left" match on `round(remaining/60) === 15`, so a 15-minute timer loses its tick after ~30 s, and a 30-minute timer shows "15 minutes" ticked halfway through — the sheet lies about what's set — S
- ✅ **Music › Folders** (`MusicScreen.tsx:180-186`) — opening a folder shows the previous folder's songs until the new list loads, and a failed load leaves the spinner state wrong (no try/finally) — S *(no load any more: the folder's songs are filtered from the library already in memory, so they show at once)*
- ✅ **Music › folder view** — hardware Back leaves the Music tab instead of returning to the folder list (no BackHandler while `selectedFolder` is set) — S
- ✅ **Music › A–Z scroller** (`MusicScreen.tsx:282-298, 589`) — shown for every sort, but always jumps by title, so with "Artist" or "Recently added" it lands somewhere random — S *(jumps by artist under Artist sort, hidden for Recently added / Duration; accents file under their letter; an empty letter lands on the next one)*
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
- ✅ **Album / Artist detail** — (permission gate ✅) no empty state: "0 songs" with Play All / Shuffle that do nothing — S *(the music empty state replaces the header and buttons; the top bar stays for Back)*
- **AlbumVideos** (`AlbumVideosScreen.tsx:130-150`) — no pull-to-refresh; ~~"Play all" only opens the first video (one file if auto-play-next is off)~~ ✅ *(a `playAll` route flag runs the Up next countdown whatever the setting, kept through Next / Previous / playlist picks; it opens the player directly, skipping the detail page)*; ✅ the button took a whole row *(now a pill at the right of the video count, which moved out of the app bar)* — S
- ✅ **Update modal** — reappears every cold start (`updateStatus` memory-only; roadmap Phase 2) — S *(the announced version is now kept in update storage)*
- ✅ **Subtitles** — SubDL `.ass`/`.ssa` are rejected by the `-->` check in `subdlApi.ts`, and downloads are always parsed as `'srt'` (`PlayerDetailScreen.tsx:143, 281`); `picked_subtitle_*` never cleaned (roadmap Phase 2) — S *(`downloadSubtitle` now returns cues, format detected from the content; the player's subtitle panel had the same `'srt'` call. CRLF `.ass` files also left a blank line under every cue. The picked copy is deleted once read)*
- ✅ **TrackOptionsSheet** (`TrackOptionsSheet.tsx:38-40`) — returns null as soon as `track` clears, so the close animation never plays; double horizontal inset — S *(keeps the last song while it slides away; the sheet's own 16 dp padding is the only inset now)*
- ✅ **Licences sheet** — hardware Back on a licence closes the whole sheet instead of returning to the list — S *(root cause in `Sheet`: Android Back always closed; it now follows the header's back arrow, which also fixes portrait player panels on a sub-page or opened from ⋮ Playback)*
- **Landscape player panels** (`VideoPlayerScreen.tsx:1114`) — Back on a sub-page (Quick Settings page, track options) or a panel opened from ⋮ Playback closes everything instead of going back a step; side panels are plain views and the screen's single Back listener calls `closeAllPanels`. A per-panel listener would race the screen's re-subscription and could take Back from the library during PiP — S
- ✅ **Snackbar position** (`RootNavigator.tsx:361`) — offset ignores the mini player, so snackbars overlap it; 64 dp too high on stack screens — S *(the bar at the bottom of the focused screen — tabs plus mini player, or the mini player on Album / Artist — reports its height through `useSnackbarClearance`)*


### Reported by Pranav (2026-10-11)

- ✅ `7980891` **Audio / Subtitles panels** (`TrackSelector.tsx`) — track rows sit flat on the panel (own `TrackRow`, no grouping, no icons) while the ⋮ Playback panel uses grouped `ListGroup`/`ListRow` cards; tabs are full-width chips — M
- ✅ `e5bcff4` **Active state** (`PlayerControls.tsx:686`, `GlyphButton`) — "on" is a white icon on a 14% white circle vs a white icon with no circle: enhancement / night mode / mute / rotation lock barely change when switched on — S *(the solid disc read too loud; now the filled icon plus a dot under it)*
- ✅ `e5bcff4` **Lock button under the camera hole** (`PlayerControls.tsx:696`) — rail is `left: 8` with no side inset; `effectiveInsets` never passes the real landscape cutout inset, and the top bar / bottom bar ignore left/right too — S *(refined: with a punch hole only the controls level with it move in; `getCutoutRects`, API 9)*
- ✅ `5821e85` **Mini player** (`MiniPlayer.tsx:105-121`) — no swipe-down to close; `clearQueue()` already stops and clears — S
- ✅ **Updates under "Open with"** — the check and the prompt lived only in `App.tsx`, so a video opened from another app never learned of an update; now a one-time snackbar and a row in ⋮ Playback — M
- ✅ **Update dot in the player** — a pending update showed only as a row inside ⋮ Playback — S *(accent dot on ⋮ and on that row's icon; `badge` on `IconButton` / `ListRow`)*
- **Packages** — ~~`react-native-share` (1 call; its merged FileProvider is the `cache-path "/"` exposure)~~ ✅ native `shareVideo` (API 6), ~~`react-native-zip-archive` (1 call; no size cap / zip-bomb guard)~~ ✅ `SubtitleZip.kt` (API 7), ~~`react-native-linear-gradient` (5 uses; svg already installed)~~ ✅ `Gradient` in the ui kit, ~~`react-native-config` (9 build-time strings)~~ ✅ `.env` read in `app/build.gradle`, served as `GlideNative.env` (API 8) — M

- ✅ **Now Playing › Lyrics** (`NowPlayingLyrics.tsx`) — opened mid-song, the first line sits in the middle instead of the current one: the first scroll runs before any row is measured and the fallback scrolls to 0 × average height; nothing retried until the next line — S
- ✅ **Player, landscape** — a grey shade over the left ~45% while the controls show — S *(the scrims: react-native-svg on Android keeps a shape's path cached at its first size, and a resize only drops the bitmap. Drawn in portrait (controls up behind the resume prompt), the `100%` gradient stayed portrait-wide after rotating. `Gradient` now sizes the Svg in numbers from `onLayout`, so a resize is a prop change and clears the cache)*

- ✅ **Update sheet, landscape** (`UpdateNotes.tsx`) — the notes block (200 dp) never shrank, so the sheet's 90% height cap pushed Download / Not now off the bottom — S *(notes now give way and scroll)*

- ✅ **Next / Up next rotation** (`VideoPlayerScreen.tsx` `exitPlayer`) — `navigation.replace` unmounts the old player after the new one mounts, and its cleanup released orientation: a portrait flash, and controls left with frames from the other orientation (buttons overlapping, a frozen time label) — S *(a replaced player hands orientation over; only a real exit releases)*
- ✅ **Titles** (`FilenameParser.ts`) — "The Boys (2026) S05E05" showed as "The Boys (2026": the edge trim took the ")" — S
- ✅ **"Open with" folder name** (`VideoPlayerScreen.tsx` albumName) — the player's subtitle line showed "My%20Shows": a file manager's own `content://` link can't be resolved to a path, and the folder was cut from it undecoded — S *(`DeepLinkService.getFolderNameFromUri` decodes links, leaves plain paths alone)*

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
- ✅ **Bookmarks** — add / list buttons landscape-only though empty state says "tap the bookmark button"; delete has no Undo — S *(partly wrong: portrait reaches both through ⋮ Playback; the empty panel now has its own "Add bookmark here", and delete offers Undo)*
- ✅ **Subtitle size** — default 0.38 never applies (`?? 0.42`); pinch-resize not saved — S *(pinch now saves via `setSubtitleFontSize`, capped at the slider's 40 px; the 0.38 claim was mostly wrong: defaults merge in, only dead `0.42` fallbacks, now pointed at the defaults)*
- ✅ **Snackbars under portrait panel Modals** — "Sleep timer set" etc. probably hidden by the scrim — S *(confirmed in code: a `Sheet` is a Modal, its own window over the player's host. Every open sheet now hosts snackbars, and a host closing mid-message hands it to the one below; app-wide, not just the player)*
- ✅ **Snackbar dismissal** — no way to clear one; on the player it sat over the controls for 3 s — S *(swipe sideways or tap to dismiss; plain messages 2–5 s by length, with an action 5 s)*
- ✅ **Recap formatting** (`RecapModal.tsx`) — the AI writes Markdown, so titles showed as "*Frankenstein*" with the asterisks — S *(`parseEmphasis`: `*italic*` and `**bold**` render as styled text; the subtitle formatter reads HTML tags, not Markdown)*
- **Perf** — measured on a Nothing Phone 2 (release build, temporary render counter) — S–M
  - ~~HUD state re-renders the screen on every gesture step~~ not any more: brightness / volume swipes re-render the screen once or twice per swipe (3 renders over ~8 s of brightness swipes); the HUD reads shared values
  - ✅ **Scrub** — every live preview seek (25/s) reported buffering then ready, and `handleBuffering` set a new state object each time: ~20 screen renders/s while dragging the seek bar, now ≤5/s
  - brightness / volume "throttle" is `floor(y) % 5`
  - hidden time labels still re-render twice a second; while scrubbing they re-render ~300 times a second through React state
  - Quick Settings speed / colour-strength sliders re-render the whole screen per step
  - landscape playlist is mounted (rows + thumbnails) from the moment the player opens, even if never opened
  - PlayerDetail: tapping Play straight away took 1.0–2.6 s to playing vs 0.3 s when the page had settled — its subtitle extraction and SubDL work keep running
- ✅ **Screen lock across autoplay** — the next episode opens unlocked (lock isn't carried), so a pocketed phone is touchable again — S
- ✅ **Episode order** (`useMediaService.ts` `sortVideosByName`) — name order puts `Show.2019.S01E02` before `Show.S01E01`, so Next skips around — S *(season/episode decide when every file in the folder has one; anime `Show - 12` and `Ep 9` aren't parsed and keep the name order)*
- ✅ **Folder order** (tester) — since `e919b33` every folder sorted by name, so camera and WhatsApp folders lost their newest-first order, and natural name order read as neither A–Z nor by date — S *(a series keeps episode order, anything else is newest first; Newest / Name / Largest sort button in the count row, carried to the player so Next and the playlist follow the list)*
- ✅ **Up next** — autoplay-next jumped after 500 ms with no warning or way out — S *(`UpNextCard`: 10 s countdown with Cancel / Play now; with autoplay off, the name and Play now; read-only while locked, hidden in PiP; dropped when the ended video is played again)*
- ✅ **Previous button** — `handlePrevious` existed but no control called it — S *(landscape: a "Previous" pill at the left end of the bottom row, mirroring Next; portrait: Previous / Next flank Play, a missing one disabled so Play stays centred)*
- **Portrait tools row overflow** (`PlayerControls.tsx` `tools`) — five 40 dp buttons plus the display-mode pill: "Original size" (~139 dp) makes it ~339 dp against 320 dp on a 360 dp phone, pushing PiP off the edge — S *(Next moved to the centre already freed 40 dp; check on device)*
- ✅ **Playlist panel** — opened at the top, not the current video; no watched progress — S *(scrolls to the current video on every open; each thumbnail has the same progress line as the folder list)*
- ✅ **Playlist durations** (`PlaylistPanel.tsx`) — treated MediaStore seconds as ms, so a 45 min episode read "0:02" — S
- ✅ **Video options** — no "Play from start" / "Mark as watched" — S *("watched" = position in the last second, `isFinished`; marking keeps the last-watched time so Recents order holds; Play reads "Resume from 12:34" when there is a position; Recents "Continue watching" no longer leads with a finished video)*

## UI / UX rough edges

- ✅ **Recents** — thumbnails are the generic frame, not where you stopped; `ThumbnailService` already takes a time, `useThumbnail` always passes 0. Also: the native side seeked to the nearest keyframe (`OPTION_CLOSEST_SYNC`), seconds off — S
- ✅ **Now Playing › Queue** — reorder is up/down chevrons with 32 dp targets, hidden while shuffle is on; no drag. Now a drag handle that also works in shuffle (native `moveInShuffleOrder`, API 5); TalkBack gets Move up / Move down actions — M
- ✅ **Now Playing › Lyrics** — box is only cover-sized; empty LRC lines render as blank rows; no hint that online lyrics are off in Settings when nothing is found; the current line grows 16→18 px and reflows the list — M *(full-screen view, ♪ breaks, one-tap "Turn on online lyrics", fixed-size lines)*
- ✅ **Now Playing › Lyrics** — auto-scroll yanks back while you're reading (pause it while the user scrolls) — S *(follows again 3 s after the drag or fling ends, or at once on a line tap)*
- **Now Playing** — heart uses the app primary while every other control uses the cover accent; equalizer icon never shows "active" when a preset is on — S
- ✅ **Music** — Albums / Artists / Folders tabs show a blank list when empty or when search matches nothing (only Tracks has an EmptyState) — S
- ✅ **EmptyState** (`VideoRow.tsx:365-374`) — always a film icon, including on Music and Recents › Music — S *(optional `icon`; Music tabs and Recents › Music use music icons)*
- **Music › A–Z scroller** — 10 px letters with ~14 dp targets, tap-only (no drag along the strip) — S
- ✅ **Recents › Videos / Music** — two loose chips, unlike the tabs in the player's audio and subtitle panels — S *(now the same `Segmented` control, full width)*
- **Folders / Recents / Music / Search / AlbumVideos** — view mode, sort and Recents' Videos/Music chip reset every launch (roadmap Phase 6) — S
- ✅ **Permission dead ends, app-wide** — Folders, AlbumVideos, Search, Recents › Music, Album/Artist detail all show plain "nothing here" copy when access is denied; Android 14 "Select videos" partial access has no "select more / allow all"; Music's button still says "Grant Permission" when tapping it opens Settings. Extract Music's screen into a shared `PermissionGate` — M
- **Headers** — Settings uses a raw title (4 dp different inset from other tabs); Album/Artist use a centred bar with `chevron-left`, AlbumVideos/Search a left bar with `arrow-left`, PlayerDetail a floating chevron — M
- **Wording** — "Play All" vs "Play all", "Song Options", "Grant Permission", "Access your Music" in title case against sentence case elsewhere; Album/Artist have no primary action button — S
- **Settings** — "Reset to default" for subtitle appearance has no confirm; "Clear subtitle cache" always says Done — S
- ✅ **Search** — `No videos match "a"` flashes during the 300 ms debounce — S
- **MiniPlayer** (`MiniPlayer.tsx:181`) — Next has no haptic (swipe does); while buffering the spinner replaces play/pause so you can't pause — S
- **Touch targets** — TrackRow "more" 28 dp, Album/Artist "more" 32 dp, ~~queue buttons 32 dp~~ (✅ with the queue drag) — S
- **Small features** — theme "Auto" (follow system); re-tapping a tab scrolls to top; ~~AlbumVideos sort~~ ✅ + folder-scoped search; consider "Third-party licences" as the Settings label so nobody reads it as Glide being open source — S each

- ✅ **Music queue after a late grant** (`audioStore.ts:97`) — the saved queue is resolved against MediaStore once at launch; granting audio access later leaves it unresolved until the next launch — S *(resolved when access is granted, unless the one-song stand-in was already played or replaced by then — Play next / Add to queue before granting still saves the shorter queue)*

## Slow paths

- **Folders** (`FoldersScreen.tsx:149-150`) — `onPress={() => handleAlbumPress(item)}` is a new closure per render, defeating the cards' `React.memo` (the VideoRow fix in `21dce13` never reached this screen) — S
- **Folders** (`FoldersScreen.tsx:122-128`) — scroll-to-top timer on sort change is dead: the list's `key` includes `sortBy`, so it remounts at the top anyway — S
- **Settings sliders** (`SettingsScreen.tsx:417, 490, 567, 613, 624`) — every drag frame writes the store and MMKV and re-renders the 770-line screen; commit on `onSlidingComplete` like `FontSizeSliderControl` — S
- **Album / Artist detail** — inline unmemoised song rows duplicating `TrackRow`; all re-render on every play/pause — S
- **AlbumVideos** — subscribes to the whole history map with `extraData={history}` — S
- **PlayerDetail** (`PlayerDetailScreen.tsx:98-184`) — on mount extracts and parses every embedded subtitle and calls OMDb + SubDL, competing with player start if you tap Play — M
- ✅ **Music › Folders** — `getSongsByFolder` is a native round trip for a subset of `tracks` already in memory — S

## Open roadmap items (carried here for ordering)

- Sign Stallion OTA bundles — top security item — M
- 8c: ✅ enhancement GL-error fallback (`e5bcff4`); ✅ Android 8/9 delete permission (`ee30459`); thumbnail negative cache; ✅ ErrorBoundary hides splash (`1e6b4c9`) — S each
- Pin CI actions by SHA, quote the secret heredocs — S

## Ops

- v2.3.0 "Android CI" run from 2026-10-10 19:12 UTC was still reported `in_progress` on 2026-10-11 — check whether the release job hung.
