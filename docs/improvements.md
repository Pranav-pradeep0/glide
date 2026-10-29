# Improvements backlog

Running list of bugs, rough edges and small features spotted while working. One line each:
**where** — what — why it matters — size (S < 1h, M = a few hours, L = a day+). Native or JS makes no difference until launch: each item gets its root-cause fix wherever that lives.
Started 2026-10-11 from a walk of the main screens.

## Bugs

- **AlbumVideos** (`AlbumVideosScreen.tsx:130-150`) — no pull-to-refresh; ~~"Play all" only opens the first video (one file if auto-play-next is off)~~ ✅ *(a `playAll` route flag runs the Up next countdown whatever the setting, kept through Next / Previous / playlist picks; it opens the player directly, skipping the detail page)*; ✅ the button took a whole row *(now a pill at the right of the video count, which moved out of the app bar)* — S
- **Landscape player panels** (`VideoPlayerScreen.tsx:1114`) — Back on a sub-page (Quick Settings page, track options) or a panel opened from ⋮ Playback closes everything instead of going back a step; side panels are plain views and the screen's single Back listener calls `closeAllPanels`. A per-panel listener would race the screen's re-subscription and could take Back from the library during PiP — S

### Reported by Pranav (2026-10-11)


### Video player

- **Playlist pick** — scrub to 0:00 then exit doesn't save — S
- **Perf** — measured on a Nothing Phone 2 (release build, temporary render counter) — S–M
  - hardware volume keys re-render the whole player on every press (7–11 renders/s while held): the HUD show dispatches go through `useReducer`, which has no eager bail-out
  - PlayerDetail: an embedded-subtitle extraction already running when Play is tapped still finishes natively; a native cancel (API bump) would free it at once
  - Other per-step state found (batch 8 item 7): the speed hold gesture sets React state per 0.25× step; `play()` / `pause()` / `handleEnd` always build a new state object (per tap, not per frame). Playback progress itself renders nothing: refs and shared values only

## UI / UX rough edges

- **Now Playing** — heart uses the app primary while every other control uses the cover accent; equalizer icon never shows "active" when a preset is on — S
- **Music › A–Z scroller** — 10 px letters with ~14 dp targets, tap-only (no drag along the strip) — S
- **Folders / Recents / Music / Search / AlbumVideos** — view mode, sort and Recents' Videos/Music chip reset every launch (roadmap Phase 6) — S
- **Headers** — Settings uses a raw title (4 dp different inset from other tabs); Album/Artist use a centred bar with `chevron-left`, AlbumVideos/Search a left bar with `arrow-left`, PlayerDetail a floating chevron — M
- **Wording** — "Play All" vs "Play all", "Song Options", "Grant Permission", "Access your Music" in title case against sentence case elsewhere; Album/Artist have no primary action button — S
- **Settings** — "Reset to default" for subtitle appearance has no confirm; "Clear subtitle cache" always says Done — S
- **MiniPlayer** (`MiniPlayer.tsx:181`) — Next has no haptic (swipe does); while buffering the spinner replaces play/pause so you can't pause — S
- **Touch targets** — TrackRow "more" 28 dp, Album/Artist "more" 32 dp, ~~queue buttons 32 dp~~ (✅ with the queue drag) — S
- **Small features** — theme "Auto" (follow system); re-tapping a tab scrolls to top; ~~AlbumVideos sort~~ ✅ + folder-scoped search; consider "Third-party licences" as the Settings label so nobody reads it as Glide being open source — S each

- **Folders** (`FoldersScreen.tsx:149-150`) — `onPress={() => handleAlbumPress(item)}` is a new closure per render, defeating the cards' `React.memo` (the VideoRow fix in `21dce13` never reached this screen) — S
- **Folders** (`FoldersScreen.tsx:122-128`) — scroll-to-top timer on sort change is dead: the list's `key` includes `sortBy`, so it remounts at the top anyway — S
- **Settings sliders** (`SettingsScreen.tsx:417, 490, 567, 613, 624`) — every drag frame writes the store and MMKV and re-renders the 770-line screen; commit on `onSlidingComplete` like `FontSizeSliderControl` — S
- **Album / Artist detail** — inline unmemoised song rows duplicating `TrackRow`; all re-render on every play/pause — S
- **AlbumVideos** — subscribes to the whole history map with `extraData={history}` — S
- **PlayerDetail** (`PlayerDetailScreen.tsx:98-184`) — on mount extracts and parses every embedded subtitle and calls OMDb + SubDL, competing with player start if you tap Play — M

## Open roadmap items (carried here for ordering)

- Sign Stallion OTA bundles — top security item — M
- 8c: ✅ enhancement GL-error fallback (`e5bcff4`); ✅ Android 8/9 delete permission (`ee30459`); thumbnail negative cache; ✅ ErrorBoundary hides splash (`1e6b4c9`) — S each
- Pin CI actions by SHA, quote the secret heredocs — S

## Ops


- v2.3.0 "Android CI" run from 2026-10-10 19:12 UTC was still reported `in_progress` on 2026-10-11 — check whether the release job hung.
