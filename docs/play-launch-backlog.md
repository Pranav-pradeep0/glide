# Play launch backlog

Written for: the next agent session. Source: full audit on 2026-10-19 (Play policy, Media3 engine,
RN layer, competitor gap). Line numbers are from that date; re-check before editing.

**Decisions already made — do not reopen:**
- Distribution: Google Play only for installs. Each tag still makes a GitHub Release in this repo
  (`glide-public`, not being retired), carrying the changelog plus the **Play-signed universal APK**
  downloaded from Play. One key: Google-generated app signing key + a new upload key in GitHub secrets.
- Self-updater: removed (`c68a856`). No flavor split.
- v2.5.0 testers (old `glide-key`) uninstall once. Owner deleted the old `glide-ai-proxy` Worker
  2026-10-20, so their Recap is offline. The Worker is now `glide-proxy`
  (`https://glide-proxy.glidemediaplayer.workers.dev`, repo variable `AI_PROXY_URL` set).
- Play developer account: created on owner's personal Google account, in verification.
- Done: `3da5cef` screens 4.30.0 (fixes reanimated #10734 SIGSEGV; reanimated 4.7.1 now unblocked).

## RESUME HERE (state at end of 2026-10-21)

Pushed to origin/main 2026-10-21 on the owner's go-ahead. Done that day:
- D4 finished: navigation 7.5 (69f1fa7), safe-area 5.10.1, flash-list 2.3.3, Kotlin 2.4.21 +
  ACRA 5.14.2 (74af186; Gradle Metaspace raised to 1 GB for the Kotlin 2.4 plugin).
- applicationId is now `com.glide.player` (8b0dfda); namespace stays `com.glide.app`.
- 17919f1: release resource shrinking had stripped Stallion's project ID, token and signing key
  (read by name via getIdentifier), so OTA never worked in release APKs. Fixed with
  `res/raw/keep_stallion.xml` (not `keep.xml`: RN's plugin writes its own and overwrote ours).
  Server side checked: scratchpad `stallion-check.js` replays the launch call; real creds → 200.
- c264b75: crash dialog uses the system dialog theme (ACRA defaulted to Android 1.0 Theme.Dialog).
  Test a crash with `adb shell am crash <pid>`; `am crash <package>` also kills the `:acra` dialog.

Next:
1. Owner to-dos below (upload key + secrets, `npx stallion login`, Play Console app
   com.glide.player, service account JSON, `PLAY_RELEASE_STATUS=draft`, privacy page, testers).
2. First tag → CI tag job end to end (AAB, Play internal upload, GitHub Release APK).
3. First signed OTA bundle → confirms Stallion on a device end to end.
4. Uncommitted subtitle frame-rate ratio work in `src/` (not from the 2026-10-21 session): review,
   tsc/jest, commit.

Done 2026-10-20 outside the code: Worker `glide-proxy` live (old glide-ai-proxy deleted),
new Groq/SubDL/OMDb keys, SubDL key stripped from download links. Stallion moved to a new
account (glidemediaplayer@gmail.com): GitHub secrets STALLION_PROJECT_ID / STALLION_APP_TOKEN
and .env updated; bundle path glide-media-player/glide-media-player/glide-media-player-bucket.
OTA bundles must be signed (public key in res/values/stallion.xml). Secrets backup:
C:UsersPranavDesktopGlide-secrets-backup.txt.

Done 2026-10-21: upload key `Desktop\Glide-secrets\glide-upload.p12` (alias `upload`) + 4 ANDROID_*
secrets; `npx stallion login`; Stallion key pair backed up in `Desktop\Glide-secrets\stallion-keys`
(checked against stallion.xml).

Owner to-dos: revoke the old Groq key and set a Groq spending limit; Play Console app with package **com.glide.player**; service
account JSON; `PLAY_RELEASE_STATUS=draft`; privacy page; 12 testers; Console forms (Data
safety adds Crash logs, Diagnostics, Email address — optional).

## A. Play blockers (code)

All done 2026-10-19. Not yet run for real: the tag job (no tag cut since), the Play upload (no
`PLAY_SERVICE_ACCOUNT_JSON` yet), and the Worker changes (not deployed). Follow-ups:
- **Worker deploy: done 2026-10-20** (new keys set, KV `glide-proxy-reports`, smoke 10/10 PASS). Was: needs `wrangler secret put GROQ_API_KEY` / `SUBDL_API_KEY` / `OMDB_API_KEY
  --name glide-proxy` first (new keys, E4), then `npm run deploy` in `proxy/` (creates the Worker
  and the `REPORTS` KV namespace), then `BASE_URL=… npm run smoke`. Until deployed, recap,
  subtitle search and OMDb fail in every build. The SubDL/OMDb keys
  in the local `.env` were rejected by both APIs when tested through `wrangler dev`.
- **Until the app's first Play rollout**, set repo variable `PLAY_RELEASE_STATUS=draft`.
- Play "What's new" is sent as `en-US`; change it if the listing's default language differs.
- Reports: `npx wrangler kv key list --binding REPORTS --remote` in `proxy/`.
- Privacy link points at `https://pranav-pradeep0.github.io/glide-public/privacy` (E5).

- [x] **A1 CI → AAB.** Tag job builds the AAB (kept as a workflow artifact), checks FFmpeg +
      16 KB (ELF and zipalign) on a bundletool universal APK, uploads to the internal track
      with "What's new", downloads Play's universal APK onto the GitHub Release. `splits.abi`
      and `useLegacyPackaging` gone; `ndk.abiFilters` keeps the FFmpeg AAR's x86 out.
- [x] **A2** SubDL + OMDb via Worker `/v1/subdl`, `/v1/omdb` (allowlisted params, key added
      server-side). `JS_ENV` now holds only `AI_PROXY_URL`. API_LEVEL 15.
- [x] **A3** Onboarding reworded; Settings > About > Privacy policy. `autoDownloadSubtitles` was
      dead (nothing read it) — deleted. The automatic SubDL call is the haptics SDH lookup.
- [x] **A4** Disclosure line + "Report this recap" → Worker `/v1/report` → KV (180 days).
- [x] **A5** TV launcher, leanback and banner removed. Auto metadata kept; just don't opt in.
- [x] **A6** HapticsLabModule in `src/debug`, registered by reflection in debug only; route and
      Version taps behind `__DEV__`; permission in the debug manifest. API_LEVEL 14.
- [x] **A7** FFmpeg commit `b37bf81a7a97`; Atkinson Hyperlegible Next (OFL) listed.
- [x] **A8** Comments fixed.

## B. Bugs — playback engine (`android/.../player/GlidePlayerView.kt` unless noted)

Done 2026-10-20 (B4 in-app half only; ALAC still pending): B4 0db6de7, B5 69b2a64 (+manifest MIME filter),
B6 f8e1078, B8 e92c6e2, B9 d72ec9b, B10 99d0818 (own prefs file), API_LEVEL 17 a91fec3. All need a device check.
B1 04fda3f, B2 dc973ea (5 s tick in background), B3 5ada6c7 (video decoder off in background play). B7 measured:
no difference on this phone (p95 staleness 10 ms either way), not changed. Haptic clock never used the tick.

- [x] **B1** `stopPlayer` (~810) doesn't cancel the IO retry `postDelayed({ player?.prepare() })`
      (~1179) or clear `playWhenReady` → old video can restart after exit/Next.
- [x] **B2** `progressTick` (~241) runs every 250 ms forever, also paused/backgrounded. Start/stop
      from `onIsPlayingChanged`; slow when host stopped.
- [x] **B3** Background play keeps decoding video: `setTrackTypeDisabled(TRACK_TYPE_VIDEO, true)` in
      `onActivityStopped` (~221) when playing on and not PiP; re-enable on start.
- [x] **B4** ALAC not in FFmpeg `ENABLED_DECODERS` (`docs/exoplayer-migration.md:75`, private
      decoder repo); tracks with no supported audio play silently with no error →
      treat as error in `onTracksChanged` (music: `MusicPlayback.kt`).
- [x] **B5** HTTP redirects http→https fail (default `DefaultHttpDataSource`,
      `allowCrossProtocolRedirects`); extensionless HLS fails (intent MIME type dropped in
      `VideoPlayerActivity`; set `MediaItem.Builder.setMimeType`).
- [x] **B6** PiP `sourceRectHint` uses whole view rect, not video aspect
      (`GlidePipController.java:~432`).
- [x] **B7** Media3 #3286: 1.11.x positions up to 200 ms stale (dynamic scheduling). Try
      `experimentalSetDynamicSchedulingEnabled(false)` for video only; may explain haptic offset.
      Unverified on device.
- [x] **B8** PiP auto-enter disarmed while buffering (`GlidePipController.java:361`, use `!showPlay`).
- [x] **B9** `onPlaybackResumption(isForPlayback=false)` switches session to music
      (`GlidePlayerService.kt:~398`).
- [x] **B10** `MusicPlayback.save` rewrites whole queue on every event (`MusicPlayback.kt:54-63`).
- [x] **B11** Credits detection runs a second decoder during playback (`Credits.kt`) — measure first.

## C. Bugs — RN layer

Done 2026-10-20: C1 7e2f5b7, C2 c8e0a56 ("Share details"), C3 de2f05f, C4 0ebe120, C5 2bf5f75, C6 92e0d8c,
C7 3553d6d, C8 db356fb. Left: Recents `isHydrated` loader branch and `LyricsService.clearCache` are dead too.

- [x] **C1** Thumbnails flash previous video in recycled rows (`src/hooks/useThumbnails.ts:20`).
- [x] **C2** ErrorBoundary "Report Error" only console.logs then says "reported"
      (`ErrorBoundary.tsx:112-117`); fallback hardcoded light colours; "Try again" loops.
- [x] **C3** Lyrics cache unbounded, never cleared, copies embedded lyrics
      (`LyricsService.ts:9,179,198,219,366`).
- [x] **C4** `useAudioController.ts:287` uncleared 300 ms guard timer.
- [x] **C5** `VideoPlayerRoot.tsx` spinner never ends if no `videoUri` / `resolveRoute` throws.
- [x] **C6** Dead code: `storage.clearCache`, `persistRaf` (`videoHistoryStore.ts`), no-op
      `hydrateFromStorage`, duplicate `SystemBars.setStyle` in `App.tsx`, `@glide/vlc-player` in
      `jest.config.js`, unused `RECAP_AVAILABLE` import in `VideoPlayerScreen.tsx`.
- [x] **C7** `SubtitleOverlay.tsx:123-175` rebuilds gestures every cue → `useMemo`.
- [x] **C8** Recents re-renders under the player on every history save (`RecentsScreen.tsx:56`).

## D. Before launch

Done 2026-10-20: D1 b7c086b (ACRA mail+dialog, opt-in toggle; report address is the git email — swap for a support address), D2 65f9742 891df14
(player GlyphButtons still 40 dp: tools row needs a rework), D3 4c48d49 (PiP + library Back fixes). B11 measured: once per file,
3–12 s, ~0.8 core, ≤3 late frames — no change. Also 7403b4d (B4 Retry), 669bd82 (error card z-order), 0b97274 (Recents dup).

- [x] **D1 Crash reporting** (none today): Sentry SDK → self-hosted GlitchTip, or ACRA; opt-in.
- [x] **D2 Accessibility:** `IconButton` real 48 dp box (hitSlop isn't measured); default
      `accessibilityRole="button"` in `Touchable`; `maxFontSizeMultiplier` on player chrome.
- [x] **D3 Predictive back** on Android 16 / targetSdk 36: device-check player, sheets, PiP.
- [x] **D4 Dependency bumps:** RN 0.88, reanimated 4.7.1 + worklets 0.13, gesture-handler 3.4,
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

Later (owner, 2026-10-20): player tools row rework so GlyphButtons reach 48 dp (D2 follow-up); Android TV version —
plan in depth before starting (needs D-pad player, focus on every list, TV manifest back, SMB/USB sources).

Parity: Open URL sheet (S), SMB/WebDAV (L), full ASS via `io.github.peerless2012:ass-media` (M–L),
subtitle charset detection with `android.icu.text.CharsetDetector` (S), music playlists + m3u (M),
scrubbing-mode exact seek preview (S), seek-bar thumbnails (M), ±10 s notification buttons via
`setMediaButtonPreferences` (S), Chromecast via media3-cast (L), hidden folders/.nomedia (M),
ReplayGain (M), theme "follow system" (S), i18n (~350 strings, L), large-screen layouts (M).

Differentiators: on-device subtitle translation (ML Kit, M) then generation (whisper.cpp, L);
dual subtitles (M); haptics as headline + music haptics (M); audio-fingerprint intro detection (L);
TMDB artwork library (L); colour-enhancement before/after (S).
