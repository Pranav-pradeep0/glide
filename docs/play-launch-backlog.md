# Play launch backlog

Written for: the next agent session. Source: full audit on 2026-10-19 (Play policy, Media3 engine,
RN layer, competitor gap). Line numbers are from that date; re-check before editing.

**Decisions already made — do not reopen:**
- Distribution: Google Play only for installs. Each tag still makes a GitHub Release in this repo
  (`glide-public`, not being retired), carrying the changelog plus the **Play-signed universal APK**
  downloaded from Play. One key: Google-generated app signing key + a new upload key in GitHub secrets.
- Self-updater: removed (`c68a856`). No flavor split.
- v2.5.0 testers (old `glide-key`) uninstall once. Don't `wrangler deploy` the proxy until the
  Play version is live and a last GitHub release has told them to move.
- Play developer account: created on owner's personal Google account, in verification.
- Done: `3da5cef` screens 4.30.0 (fixes reanimated #10734 SIGSEGV; reanimated 4.7.1 now unblocked).

## A. Play blockers (code)

- [ ] **A1 CI → AAB.** Tag job: `bundleRelease` → upload to Play internal track (needs a
      service-account JSON secret; until then save AAB as artifact) → fetch Play-signed universal APK
      → attach to GitHub Release with changelog; changelog also → Play "What's new" (500 chars).
      Drop `splits.abi` and `useLegacyPackaging` (`android/app/build.gradle`). Run FFmpeg/16 KB
      checks on `bundletool build-apks` output. Changelog step comment at `android-ci.yml:~395`
      still mentions the in-app updater.
- [ ] **A2 Move OMDb + SubDL keys into the Worker** as secrets (pattern: `GROQ_API_KEY`); app
      calls the proxy. Keys are readable in the shipped dex today (`build.gradle` `JS_ENV`).
- [ ] **A3 Privacy honesty.** Onboarding says "No accounts, no analytics"
      (`OnboardingScreen.tsx:104`) but Stallion sends ANDROID_ID + crash traces, SubDL gets raw
      filenames, LRCLIB gets track metadata. Reword; add Privacy policy link in Settings.
      `autoDownloadSubtitles` defaults true (`appStore.ts`) — consider default off.
- [ ] **A4 AI recap "Report" action** + one-line disclosure on RecapModal (Play AI-content policy).
- [ ] **A5 Remove TV launcher** (`LEANBACK_LAUNCHER`, leanback feature, banner) — no D-pad support.
      Don't opt in to Android Auto form factor (no voice search, flat browse tree).
- [ ] **A6 Haptics Lab out of release** (`__DEV__` route + debug-only native module) and
      `HIGH_SAMPLING_RATE_SENSORS` permission.
- [ ] **A7 Licences:** FFmpeg notice → exact commit (binary reports `b37bf81`,
      `scripts/gen-licences.js:32-35`); add Atkinson Hyperlegible Next (OFL).
- [ ] **A8 Stale comments:** manifest POST_NOTIFICATIONS comment (media notifications are exempt),
      `network_security_config.xml` "speech-to-text proxy", `android/build.gradle` ffmpeg-kit note,
      `docs/hardening-roadmap.md` "Play policies do not apply".

## B. Bugs — playback engine (`android/.../player/GlidePlayerView.kt` unless noted)

- [ ] **B1** `stopPlayer` (~810) doesn't cancel the IO retry `postDelayed({ player?.prepare() })`
      (~1179) or clear `playWhenReady` → old video can restart after exit/Next.
- [ ] **B2** `progressTick` (~241) runs every 250 ms forever, also paused/backgrounded. Start/stop
      from `onIsPlayingChanged`; slow when host stopped.
- [ ] **B3** Background play keeps decoding video: `setTrackTypeDisabled(TRACK_TYPE_VIDEO, true)` in
      `onActivityStopped` (~221) when playing on and not PiP; re-enable on start.
- [ ] **B4** ALAC not in FFmpeg `ENABLED_DECODERS` (`docs/exoplayer-migration.md:75`, private
      decoder repo); tracks with no supported audio play silently with no error →
      treat as error in `onTracksChanged` (music: `MusicPlayback.kt`).
- [ ] **B5** HTTP redirects http→https fail (default `DefaultHttpDataSource`,
      `allowCrossProtocolRedirects`); extensionless HLS fails (intent MIME type dropped in
      `VideoPlayerActivity`; set `MediaItem.Builder.setMimeType`).
- [ ] **B6** PiP `sourceRectHint` uses whole view rect, not video aspect
      (`GlidePipController.java:~432`).
- [ ] **B7** Media3 #3286: 1.11.x positions up to 200 ms stale (dynamic scheduling). Try
      `experimentalSetDynamicSchedulingEnabled(false)` for video only; may explain haptic offset.
      Unverified on device.
- [ ] **B8** PiP auto-enter disarmed while buffering (`GlidePipController.java:361`, use `!showPlay`).
- [ ] **B9** `onPlaybackResumption(isForPlayback=false)` switches session to music
      (`GlidePlayerService.kt:~398`).
- [ ] **B10** `MusicPlayback.save` rewrites whole queue on every event (`MusicPlayback.kt:54-63`).
- [ ] **B11** Credits detection runs a second decoder during playback (`Credits.kt`) — measure first.

## C. Bugs — RN layer

- [ ] **C1** Thumbnails flash previous video in recycled rows (`src/hooks/useThumbnails.ts:20`).
- [ ] **C2** ErrorBoundary "Report Error" only console.logs then says "reported"
      (`ErrorBoundary.tsx:112-117`); fallback hardcoded light colours; "Try again" loops.
- [ ] **C3** Lyrics cache unbounded, never cleared, copies embedded lyrics
      (`LyricsService.ts:9,179,198,219,366`).
- [ ] **C4** `useAudioController.ts:287` uncleared 300 ms guard timer.
- [ ] **C5** `VideoPlayerRoot.tsx` spinner never ends if no `videoUri` / `resolveRoute` throws.
- [ ] **C6** Dead code: `storage.clearCache`, `persistRaf` (`videoHistoryStore.ts`), no-op
      `hydrateFromStorage`, duplicate `SystemBars.setStyle` in `App.tsx`, `@glide/vlc-player` in
      `jest.config.js`, unused `RECAP_AVAILABLE` import in `VideoPlayerScreen.tsx`.
- [ ] **C7** `SubtitleOverlay.tsx:123-175` rebuilds gestures every cue → `useMemo`.
- [ ] **C8** Recents re-renders under the player on every history save (`RecentsScreen.tsx:56`).

## D. Before launch

- [ ] **D1 Crash reporting** (none today): Sentry SDK → self-hosted GlitchTip, or ACRA; opt-in.
- [ ] **D2 Accessibility:** `IconButton` real 48 dp box (hitSlop isn't measured); default
      `accessibilityRole="button"` in `Touchable`; `maxFontSizeMultiplier` on player chrome.
- [ ] **D3 Predictive back** on Android 16 / targetSdk 36: device-check player, sheets, PiP.
- [ ] **D4 Dependency bumps:** RN 0.88, reanimated 4.7.1 + worklets 0.13, gesture-handler 3.4,
      navigation 7.5, safe-area 5.10.1, flash-list 2.3.3. Skip feather icons 14 (unreviewed major).

## E. Owner tasks (not code)

- [ ] Play account verification → create app (Google-generated signing key), choose store name
      (shortlist: Sonder, Velvet; "Glide" collides with Glide video messenger).
- [ ] New upload key (`keytool … -alias upload`, PKCS12, one password) → password manager +
      `gh secret set ANDROID_KEYSTORE_BASE64/…PASSWORD/ANDROID_KEY_PASSWORD/ANDROID_KEY_ALIAS`.
- [ ] Play service account JSON → GitHub secret.
- [ ] Rotate keys: Cloudflare login recovery, new Groq key (`wrangler secret put GROQ_API_KEY`),
      new OMDb + SubDL keys; Stallion bundle signing.
- [ ] Privacy policy page (GitHub Pages on this repo).
- [ ] 12 testers for the 14-day closed test.
- [ ] Console forms: Data safety, READ_MEDIA_VIDEO declaration, FGS mediaPlayback (video),
      content rating, listing, screenshots (no copyrighted posters).

Data safety inventory: SubDL (title, raw filename, IMDb id), OMDb (title/year), LRCLIB (artist,
track, album, duration — automatic), Worker→Groq (≤5000 chars subtitle dialogue + title, on
Recap tap), Stallion (ANDROID_ID, device/OS/locale/timezone, events, crash traces). No location,
contacts, accounts, or media upload.

## F. After launch — features

Parity: Open URL sheet (S), SMB/WebDAV (L), full ASS via `io.github.peerless2012:ass-media` (M–L),
subtitle charset detection with `android.icu.text.CharsetDetector` (S), music playlists + m3u (M),
scrubbing-mode exact seek preview (S), seek-bar thumbnails (M), ±10 s notification buttons via
`setMediaButtonPreferences` (S), Chromecast via media3-cast (L), hidden folders/.nomedia (M),
ReplayGain (M), theme "follow system" (S), i18n (~350 strings, L), large-screen layouts (M).

Differentiators: on-device subtitle translation (ML Kit, M) then generation (whisper.cpp, L);
dual subtitles (M); haptics as headline + music haptics (M); audio-fingerprint intro detection (L);
TMDB artwork library (L); colour-enhancement before/after (S).
