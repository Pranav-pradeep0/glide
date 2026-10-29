# Glide Production Hardening Master Tracker

Open production work. Closed items are in git history.

## 0. Open items

### Checks

- `[todo]` ESLint — 0 errors but 262 warnings at audit time; warnings are not yet a useful gate.
- `[todo]` `npm audit --omit=dev` — 23 advisories at audit time: 1 critical,
  19 high, 2 moderate, 1 low. Triage by reachable runtime impact, not count alone.
- `[todo]` no signed release APK has yet passed the complete release checklist in section 16.

### 3.1 Stop further accidental publication

- `[todo]` **Owner action, not code.** Inventory GitHub Releases and tags created from
  both `main` and `develop`:
  - record tag, commit, branch, `versionName`, `versionCode`, signer, and assets;
  - identify any non-prerelease built from `develop`;
  - do not delete historical releases merely to hide the embedded key; deletion does
    not revoke a credential already downloaded.
- `[todo]` **Owner action, not code.** Record 1.8.1 asset download counts when the incident inventory is taken, but
  do not use a low count as evidence that the embedded credential was not extracted.

### 3.2 Contain the exposed Groq key

- `[todo]` The proxy has no client authentication, and its URL is packaged in the APK
  by `react-native-config`, so it is extractable exactly as the Groq key was. A shared
  app token would be equally extractable; do not mistake one for authentication. The
  per-IP and global rate-limit bindings are per-colo burst gates, not a budget, so the
  binding cost ceiling must be a spending limit set in the Groq console. Record that
  limit here once set.
- `[todo]` Remove secrets and response bodies from logs. Never log audio, dialogue,
  authorization headers, or raw provider errors that may contain request content. The
  Worker already logs route plus status only; the client side is unaudited.
- `[todo]` Add privacy copy before uploading subtitle dialogue or audio. State what is
  sent, to whom, why, and whether the provider retains it. Nothing in `src` currently
  says anything to the user about what leaves the device.

### 3.3 Audit other packaged credentials

- `[todo]` Treat `SUBDL_API_KEY`, `OMDB_API_KEY`, Stallion project ID, and Stallion app
  token as packaged client values until provider documentation proves otherwise.
- `[todo]` For each value, record whether the provider intends it to be public,
  available key restrictions, quotas, rotation procedure, and abuse owner.
- `[todo]` If a value is not safe in a client, use the same proxy/disable/BYOK decision
  as Groq. Do not rely on GitHub Actions secrets to protect an APK-embedded value.
- `[todo]` Remove the word “secret” from CI/config documentation for intentionally
  public client identifiers so future maintainers do not mistake storage location for security.

### 3.4 Correct 1.8.1 with a new release identity

- `[todo]` The corrective native release must be `1.8.2` or later with a new monotonically
  higher Android `versionCode`; never replace the 1.8.1 assets in place.
- `[todo]` At minimum, it must contain the section 3 credential removal/feature decision,
  section 4 release guards/version identity, and every R1 item whose unsafe behavior is
  already present in 1.8.1.
- `[todo]` After publication, install it over both public 1.8.1 ABI APKs, verify the
  updater sees it as newer, and search the signed binaries/bundle for the revoked key.
- `[todo]` Leave the 1.8.1 release record intact unless the owner explicitly chooses to
  hide it. Hiding reduces new downloads but is not credential revocation or user remediation.

### 4.1 Separate verification from publishing

- `[todo]` The published 1.9.2 release notes still carry the truncated list. The workflow
  fix only affects future releases; those notes need editing by hand or not at all.
- `[todo]` Verify the attestation end to end on the next release: run
  `gh attestation verify` against a downloaded public APK, not against the build output,
  and record the result. An attestation step that runs without error is not proof that
  the published asset verifies.

### 4.2 Make version identity monotonic and single-source

- `[todo]` Keep `package.json` as the human-facing `versionName` source.
- `[todo]` Enforce: every public APK has a greater `versionCode` and a unique
  `versionName`. Same-version public rebuilds are forbidden.
- `[todo]` Set iOS `MARKETING_VERSION` from the same source and increment
  `CURRENT_PROJECT_VERSION` for every submitted build.
- `[todo]` Ensure Stallion release targeting uses the native app version and never
  crosses incompatible native binaries.
- `[todo]` Rename final tags from `vX.Y.Z-build.N` to `vX.Y.Z` after the updater and
  workflow switch. Keep old tags as history unless there is a specific reason to remove them.
- `[todo]` Add CI assertions for version/tag match, positive `versionCode`, monotonicity
  relative to the latest final release, and expected APK manifest values.

### 5.1 Remove the unnecessary media-notification permission path

- `[todo]` Add an Android 13+ manual test with notifications denied at the OS level:
  media controls must still appear while the media session is active.
- `[todo]` Do not re-add this permission for the future playback service unless Glide
  introduces a separate non-exempt notification feature.

### 5.2 Request only the media collection Glide reads

- `[todo]` Device-test that stripping `READ_PHONE_STATE` does not break the
  `react-native-share` sheet or the Stallion OTA check. If either library reads phone
  state at runtime it will now raise `SecurityException`.
- `[todo]` Re-run the merged-manifest permission diff after every dependency upgrade;
  direct-manifest review does not catch an injected permission.
- `[todo]` Verify library, albums, search index, thumbnails, playback, and video deletion
  on Android 13, 14, 15, and 16.
- `[todo]` Verify denial behavior: explain why video access is needed, allow retry from
  Settings, and never show an empty library as though the device has no videos.
- `[todo]` If Google Play distribution is added, review the current broad video-access
  policy and determine whether Glide qualifies or must use a picker.

### 6.1 Remove accidental cleartext for app APIs without breaking intentional streams

- `[todo]` Device-test an arbitrary HTTP LibVLC stream. Expected unaffected — LibVLC uses
  its own native network stack, so the config should never reach it — but "expected to be
  unaffected" is the claim that needs the device, not the one that gets to skip it.
- `[todo]` Device-test that the update check, subtitle search/download, OMDb lookup, and
  the Stallion OTA check all still succeed over the pinned domains.
- `[todo]` Enforce expected *hosts*, not only HTTPS, in OMDb and SubDL code. The config
  now covers the transport; the code still trusts whatever host `.env` supplies.
- `[todo]` Never allow "accept invalid certificate" for app APIs. If LibVLC exposes it
  for user streams, keep it off by default and make the risk explicit. The
  `acceptInvalidCertificates` native prop exists and is unused by this app (section 10.5).

### 6.2 Validate external intents and deep links

- `[todo]` A `content://` URI arriving with no read grant is still accepted, and fails
  downstream as a decode error rather than a clear message. Rejecting on a missing
  `FLAG_GRANT_READ_URI_PERMISSION` would also reject world-readable exported providers
  that legitimately need no grant, so this needs the device matrix first. Marked with a
  `ponytail:` comment at the return site.
- `[todo]` `onNewIntent` is unvalidated but currently inert: `launchMode="singleTask"`
  means a second intent never re-runs `getLaunchOptions`, so no new URI reaches
  JavaScript. That is a UX gap — opening a second video while the player is open does
  nothing — not a hole. Validate it whenever that UX is fixed.
- `[todo]` Add tests for ACTION_VIEW, ACTION_SEND, malformed URLs, missing grants, and
  unsupported schemes. **Not done, and deliberately not faked:** the logic uses
  `android.net.Uri`, so a JVM unit test needs Robolectric or a hand-rolled URI parser, and
  hand-rolling URI parsing to test URI validation reintroduces the bug class the check
  exists to prevent. Section 15.2 already tracks the instrumentation test that covers this.

### 7.1 Release discovery and version parsing

- `[todo]` Update `markdown-it`/`react-native-markdown-display` through a compatible
  package update. Split from the cap above; it belongs with the dependency work.

### 7.2b Update UI state, reported from device use

- `[todo]` Device-test both surfaces at once: start a download in Settings, open the
  modal, and confirm one progress figure, one cancel, and one resulting install.

### 7.3 Installer behavior

- `[todo]` Test denied/allowed unknown sources, corrupt APK, wrong signer, lower/equal/
  higher versionCode, cancelling the system prompt, and a successful upgrade preserving data.
- `[todo]` Consider `requestUserPreapproval()` on API 34+ so the install is approved
  before a ~60 MB download rather than after it.

### 8.1 Replace hand-written resize geometry

- `[todo]` Re-test all six modes after this fix, then the rest of the section 8.5 fixture
  set. The math is verifiable by reading, the rendering is not.

### 8.2 Replace lifecycle timing guesses with Activity lifecycle

- `[todo]` Device-test: background and return during playback, enter PiP and return,
  dismiss the PiP window, lock the screen, and the same set with background play enabled,
  on Android 8, 12 and 16. This replaces a timing heuristic, so behavior differences show
  up only on real transitions.

### 8.3 Replace fixed player retries with real events

- `[todo]` Retest resume: a local file, an HTTP/HTTPS stream and a live stream, plus a
  decoder change and an enhancement toggle mid-playback. `[ENGINE] opened ... startTime=`
  in the trace is the confirmation, and `[SEEK_VERIFY] drift` must not appear on resume.
  The trace that motivated this fix showed `mediaOptions=0`, which is how the missing
  initial-mount case was found; the equivalent evidence now is a non-zero `startTime=`.
- `[todo]` Twelve `volatile` fields predate this work, including `isPaused`. They rest on
  the same wrong premise and are equally unnecessary, but removing them is not this
  change's business. They are harmless; do not read them as evidence of concurrency.
- `[todo]` A `SEEK: requested position=0.0000` appeared once, roughly a second after a
  resume, and the player did move to zero. It is not yet established whether that was a
  genuine tap at the left edge of the seek bar during rapid seeking or a spurious commit;
  the reporter noticed the HUD showing zero several times. Re-check once seeks are precise,
  because a HUD that disagreed with the player was an expected consequence of 19-35 s drift.

### 8.5 Player fixture/device acceptance

- `[todo]` Build a small legal fixture set: 16:9, 2.39:1, portrait, rotated metadata,
  SAR != 1, MKV with three audio tracks, embedded/external subtitles, AC3, EAC3,
  HEVC, short file, long file, HTTP stream, HTTPS stream, and RTSP stream.
- `[todo]` Exercise every resize mode, rotate, seek rapidly, switch audio tracks ten
  times, change delay, enable/disable enhancement, enter/resize/exit PiP, lock screen,
  receive a call, disconnect Bluetooth, and background/foreground.
- `[todo]` Run both `MainActivity` and external-open `VideoPlayerActivity` paths.

### 8.6 Audio controls already simplified, still requiring runtime proof

- `[todo]` Device-test delay persistence/reset on multiple videos and confirm no old
  non-zero history value is presented as a new default.
- `[todo]` Device-test repeated rate changes across pause/play, PiP, audio-only media,
  enhancement recreation, and save/restore; verify no duplicate native application.
- `[todo]` Device-test every equalizer preset, flat/off, custom bands, rapid switching,
  player recreation, and source change. Confirm the native cached equalizer is released
  and no preset from the previous source leaks into the next one.

### 8.7 P2 — remove the measured progress-driven whole-screen render

- `[todo]` Confirm with the React DevTools Profiler that idle playback renders
  `VideoPlayerScreen` zero times with controls both visible and hidden, and that opening
  bookmarks or the sync panel updates only that panel. No always-on render counter was
  added: the Profiler already measures this, and shipping diagnostic scaffolding to do it
  again is the kind of code this tracker exists to remove.
- `[todo]` Device-test time labels, rapid seek/scrub, bookmark activation, subtitle/audio
  sync matching, pause/resume, PiP, rate changes, source change, and enhancement recreation.

### 9. P1 — make background playback honest before target SDK 35+

- `[todo]` Device-test the notification and lock-screen clock across pause, stop, closing
  PiP, and background play left enabled, on Android 13 through 16.
- `[todo]` The session position also goes stale after seeking while paused, because
  nothing republishes the state on a seek. Media3 removes the whole class of bug by
  deriving session state from the player, so fix it there rather than adding another
  publish call to the legacy path.
- `[todo]` Media3 injects `ACCESS_NETWORK_STATE` into the merged manifest. It is a normal
  permission so it does not prompt, and it is left in place: only `media3-session` and
  `media3-common` are used, so it is probably unreachable, but removing a permission a
  library declares without proving it unused risks a `SecurityException` in code this
  project does not control. Confirm before stripping it.
- `[todo]` Device-test the corrected states: close PiP while playing, lose audio focus to a
  call, and unplug headphones — the notification must show paused in all three, and pressing
  play from it must resume and show playing. `[SERVICE] onUpdateNotification startInForeground=true` in the
  trace is the confirmation; `[SERVICE] session created and registered` alone is not.

### 9.1 Foreground service crash loop (found on device, 2026-08-27)

- `[todo]` The trigger for the *first* death is not in the captured log, which begins at
  the crash. `ApplicationExitInfo` reports `pss=488MB rss=627MB`, so a low-memory kill of
  a large video process is the likely entry into the loop. Worth watching memory
  independently; the fix above breaks the loop regardless of what starts it.
- `[todo]` Retest: play, background, PiP, swipe the task away, and force-stop, confirming
  no `AndroidRuntime` crash and that the notification still appears and controls playback.

### 10.2 Android template alignment

- `[todo]` Remove both when moving to AGP 10, which drops the opt-outs; the build currently logs obsolete-variant-API warnings that are the deferred work, not a defect.
- `[todo]` Some third-party modules (`react-native-stallion`, `react-native-mmkv`) still configure x86/x86_64 CMake targets regardless of `reactNativeArchitectures`. It costs build time only, since the APK splits exclude them, but it is worth revisiting.
- `[todo]` Re-run Android 15/16 behavior-change checklists, predictive back, edge-to-edge,
  exported components, foreground service, permissions, and 16 KB tests.

### 10.5 Clean sweep review (2026-08-27)

- `[todo]` **`ios/` is a stale pre-0.80 template.** Old-style `AppDelegate.mm`, no
  `Podfile.lock`, and last touched only by a version bump. It cannot build on RN 0.87,
  where the AppDelegate moved to Swift. With no iOS release planned it is dead weight that
  implies support that does not exist. Deleting it is a product call, not a cleanup.

### 10.3 Local VLC module Gradle cleanup

- `[todo]` Update `androidx.activity` through dependency alignment rather than a stale hard pin.

### 10.4 Local simple-thumbnail module cleanup

- `[todo]` Replace the `compileOnly` path to `ffmpeg-kit-minimal.aar` with the single
  app-owned FFmpeg module/dependency so compile and runtime APIs cannot drift.
- `[todo]` Decide whether to keep the legacy `NativeModules`/`ReactPackage` bridge or
  migrate it to a typed TurboModule. The minimum acceptable RN 0.87 result is a tested,
  explicitly registered legacy module with no New Architecture warnings.
- `[todo]` Add unit/instrumentation coverage for thumbnail generation, media metadata,
  FFprobe subtitle discovery, extraction, invalid content URIs, cancellation, and cleanup.
- `[todo]` Keep its Android implementation and section 14's iOS support decision tied
  together; do not claim cross-platform behavior from this package metadata.

### 11.2 Focused FFmpegKit wrapper repair

- `[todo]` Attempt the smallest compatibility repair first: rebuild ARM64
  `libffmpegkit.so` and `libffmpegkit_abidetect.so` from the matching FFmpegKit 6 source
  with 16 KB linker alignment, against the existing aligned FFmpeg libraries.
- `[todo]` Do not mix FFmpegKitNext 8 wrappers with FFmpegKit 6 libraries; ABI compatibility
  must be exact.
- `[todo]` Replace the two AAR entries, then repeat ELF inspection and functional tests
  for probe, thumbnail, subtitle extraction, audio extraction, HTTPS input, and cancellation.
- `[todo]` If a focused rebuild cannot be reproduced safely, move directly to the full migration below.

### 11.3 Full FFmpegKitNext maintenance migration

- `[todo]` Build a pinned FFmpegKitNext release locally/CI using its recommended Nix
  environment; it is not a normal npm/Maven drop-in.
- `[todo]` Enable only libraries/codecs Glide actually uses. Record configure flags and hashes.
- `[todo]` Produce reproducible AAR/XCFramework artifacts for supported platforms/ABIs.
- `[todo]` Review LGPL/GPL configuration, source-offer/notice obligations, and codec patent considerations.
- `[todo]` Replace retired `react-native-ffmpeg-kit`, the vendored AAR, five global
  dependency substitutions, and duplicate app-level FFmpeg/smart-exception dependencies.
- `[todo]` Keep the focused wrapper repair and full migration as separate commits/phases.

### 11.5 HDR10 renders washed out — a LibVLC 3.x capability limit (2026-09-06)

- `[todo]` Independent of HDR, the enhancement toggle is a **performance defect**. Setting
  `--no-mediacodec-dr` makes `AMediaCodec.configure` fail outright on this device, so
  playback silently falls back to software-decoding 4K and swscaling `I0AL` to `RV16`
  (RGB565). It is measurably laggy and stays laggy for the rest of the session because the
  flag is sticky. Fix this whatever is decided about HDR.

### Phase 1 — stop the bleeding (no engine decision required)

- `[todo]` **Fix the enhancement defect.** `--no-mediacodec-dr` makes
  `AMediaCodec.configure` fail on this device, dropping to software 4K decode and `RV16`.
  Until a GPU path exists, enhancement must not silently do this: either gate it off above
  a resolution threshold, or clear `mEnhancementCompatiblePipeline` on toggle-off so the
  damage is not sticky for the session. It is currently a performance defect sold as a
  colour feature.
- `[todo]` **Provide the subtitles surface.** `ReactVlcPlayerView` becomes a `FrameLayout`
  holding two `SurfaceView`s, mirroring VLC's own `VLCVideoLayout`. This stops
  `android_display` being rejected, which is what silently forces the 8-bit `gles2` path
  today, and restores bitmap (PGS/VobSub) subtitles. It does **not** fix HDR on its own.
- `[todo]` **Land the `TextureView` → `SurfaceView` migration** already on
  `spike/surfaceview-hdr`. It measurably improved display-mode fit and is required by every
  option below. Needs the section 8.5 geometry matrix and the reported
  background-resume crashes cleared first.

### Phase 2 — one cheap experiment that decides everything

- `[todo]` **Play the same HDR10 file through ExoPlayer on this device.** Media3 `1.7.1` is
  already a dependency for the media session, so this is a throwaway screen with an
  `ExoPlayer` and a `SurfaceView` — no migration, no commitment. Android's own guidance is
  "use ExoPlayer, which supports HDR by default and handles these requirements internally."
- `[todo]` The Media3 **FFmpeg decoder extension is mandatory**, not optional insurance.
  Build it with `ENABLED_DECODERS=(ac3 eac3 dca mlp truehd)` against FFmpeg 6.0. Without
  it, moving to ExoPlayer loses audio outright on every AC-3/E-AC-3 file — which is most
  of this library. This is the single largest piece of Phase 3 work.

### 11.4 Final native package validation

- `[todo]` Run `zipalign -c -P 16 -v 4` on each signed APK.
- `[todo]` Inspect every packaged `.so` PT_LOAD alignment for ARM64.
- `[todo]` Test on a real/emulated 16 KB ARM64 Android image with compatibility mode disabled.
- `[todo]` Record APK sizes and confirm each ABI APK contains only its intended ABI.

### 12.1 Remove dependencies with proven replacements

- `[todo]` After RN 0.87, use built-in `edgeToEdgeEnabled=true`; replace only required
  navigation-bar styling and remove `react-native-edge-to-edge`.
- `[todo]` Upgrade `react-native-config` only as part of RN compatibility; never use it for secrets.
- `[todo]` Upgrade Stallion SDK `2.2.0` and CLI `2.3.1` to compatible current stable
  versions, then test production bundle download, restart, phased rollout, and rollback.
- `[todo]` Upgrade navigation/screens/gesture/reanimated/MMKV/Nitro packages in compatible
  groups after RN migration. Do not run a blanket `npm update`.
- `[todo]` Re-run `npm audit --omit=dev`; document which remaining advisories are build-only,
  unreachable, accepted, or fixed, with expiry dates for accepted risk.

### 12.3 Remove stale configuration and build plumbing

- `[todo]` Review the bundled `NetflixSans-*` font files. Record license/provenance or
  replace them with a redistributable font; do not publish unverified branded font assets.
- `[todo]` Remove global Gradle `flatDir`; keep one explicit local AAR module only while
  the FFmpeg wrapper remains vendored.
- `[todo]` Resolve Gradle warnings owned by this repository, including duplicate/stale
  namespace declarations, after the RN template migration.
- `[todo]` Decide the lone `SearchScreen` TODO: implement the options sheet because a
  reachable control promises it, or remove the control/TODO. Do not ship a dead affordance.

### 12.4 Reduce noise without abstraction churn

- `[todo]` Fix all real `react-hooks/exhaustive-deps` warnings first; each can be a stale-state bug.
- `[todo]` Remove unused variables/imports and useless escapes; then set CI ESLint
  `--max-warnings 0`.
- `[todo]` Audit 352 `console.*` calls in `src`:
  - remove diagnostic spam from hot paths;
  - gate useful development diagnostics with `__DEV__`;
  - keep actionable production errors without media paths, content, or credentials;
  - enforce the rule in ESLint.
- `[todo]` Apply the same treatment to the remaining project-owned Android `Log.*` calls
  outside the player, and audit the original baseline of 208:
  85 debug, 63 info, 30 warning, and 30 error. Remove hot-path diagnostics, including
  production `Log.i` noise from `[PIP_RESIZE]`/`[PIP_BOUNDS]`; retain actionable warnings
  and errors without media URIs, titles, device content, or credentials. Development-only
  geometry/event traces must be build-gated or stripped from release builds, and the
  release check must confirm they do not flood logcat during playback/PiP resize.

### 12.5 Direct JavaScript dependency disposition ledger

- `[todo]` Keep one FFmpeg provider. Remove the app's direct
  `com.arthenica:ffmpeg-kit-https:6.0-2`, duplicate smart-exception artifacts, five
  global substitutions, local AAR path, and wrapper package only as the selected
  section 11 migration makes each redundant.
- `[todo]` Keep one React Android dependency per module; no `react-native:+` selectors.
- `[todo]` Align `androidx.activity`, legacy `androidx.media`, and future Media3 versions
  from one root catalog/constraint set; delete legacy media only after service migration.
- `[todo]` Generate and review the resolved npm and Gradle dependency trees after each
  migration group; direct-entry accounting alone does not catch vulnerable transitives.

### 12.6 Bridge, cache, and network contracts

- `[todo]` Define one typed event map shared by `VLCPlayer.tsx` and `index.d.ts` for every
  native player callback. Remove `any` from `onBuffering`/`NativeSyntheticEvent` and make
  the buffering declaration include both `isBuffering` and `bufferRate`.
- `[todo]` Compare `VideoEventEmitter.java`, the ViewManager event export, the TypeScript
  wrapper, and every JS consumer. Add a contract test/fixture for names, required fields,
  units, nullability, and Android/iOS parity; delete stale declared events.
- `[todo]` Document subtitle storage layers and invalidation separately:
  - online search results live only for the requesting screen/in-flight coalescer;
  - downloaded ZIP and extraction directories are removed on success, error, abort, and timeout;
  - parsed cue cache keys include video and subtitle identity and are evicted on source/subtitle change;
  - app-start/final cleanup removes orphan temporary subtitle/audio files;
  - a user-visible “clear cache” action reports what it deleted and never removes user originals.
- `[todo]` Add bounded archive extraction: reject absolute paths, `..` traversal,
  symlinks if exposed by the archive library, excessive entry count, and excessive
  compressed/uncompressed size before reading subtitle content.
- `[todo]` Verify `SubtitleCueStore` cache and track LRU limits with long playback and
  repeated subtitle switching; make eviction deterministic and cover it with tests.
- `[todo]` After the RN/Hermes migration, check runtime support for
  `AbortSignal.timeout()` and `AbortSignal.any()`. If both cover the required abort-reason
  behavior, simplify `network.ts`; otherwise keep the tested helper rather than polyfilling
  merely for fewer lines.
- `[todo]` Keep every external request's timeout, caller cancellation, HTTP-status check,
  response-size/schema validation, and user-safe error mapping when simplifying networking.

### 13. P1/P2 — Stallion OTA contract

- `[todo]` Document that OTA may change JavaScript and compatible assets only. Native
  modules, permissions, Gradle/Pod changes, RN runtime changes, codecs, and binary API
  changes require a new APK/IPA.
- `[todo]` Target Stallion releases to the exact compatible native app version/channel.
- `[todo]` Never use OTA to work around the monotonic APK version/release process.
- `[todo]` Enable and verify signed updates/integrity features supported by the selected SDK plan.
- `[todo]` Use staged production rollout; define pause and rollback owners.
- `[todo]` Test automatic rollback from a deliberately crashing test bundle.
- `[todo]` Surface pending-restart state consistently with the APK update UI so two
  update systems do not issue contradictory prompts.
- `[todo]` Record currently running native version, OTA bundle version, and rollback
  state in a diagnostics screen/log without identifiers or secrets.

### 14. P2 — decide and correct iOS scope

- `[todo]` Add accurate photo/video library usage descriptions required by CameraRoll.
- `[todo]` Remove the empty, apparently unused location permission description.
- `[todo]` Implement or replace Android-only `react-native-simple-thumbnail` calls on iOS.
- `[todo]` Align local VLC podspec version (`1.0.38`) with the package (`1.0.96`) or remove
  meaningless independent versions for a path dependency.
- `[todo]` Raise obsolete iOS deployment target 8.4 to the RN 0.87 template minimum.
- `[todo]` Upgrade MobileVLCKit 3.5.1 to a maintained compatible version and test the
  complete player feature matrix.
- `[todo]` Remove stale `MobileVLCKit-unstable` project search paths if CocoaPods/SPM owns linkage.
- `[todo]` Align `CURRENT_PROJECT_VERSION` and `MARKETING_VERSION` with section 4.
- `[todo]` Register only licensed custom fonts in iOS or use system fonts consistently.
- `[todo]` Implement/verify iOS PiP, background audio/session, interruptions, route
  changes, lock-screen controls, AirPlay if claimed, and app lifecycle.
- `[todo]` Verify ATS behavior for HTTPS and intentional user-entered streams.
- `[todo]` Build, test, archive, sign, install, and upgrade on supported iOS versions.
- `[todo]` Verify `PrivacyInfo.xcprivacy` accurately covers app and dependency API usage.

### 15.1 Fast automated tests

- `[todo]` Strict version parser/comparator and release-tag validation.
- `[todo]` `selectApkForDevice`, trusted URL validation, checksum parsing, file-name sanitation.
- `[todo]` Settings migration and corrupt MMKV payload behavior.
- `[todo]` Filename parser on representative movie/show names and malformed input.
- `[todo]` Subtitle parser for SRT/VTT/ASS/SSA, malformed cues, encodings, and SDH cases.
- `[todo]` SubDL request coalescing: two consumers, one cancellation, all cancellation,
  timeout, retry, and no leaked in-flight entry.
- `[todo]` Player pure state reducers: user pause vs host stop vs focus loss vs PiP vs ended.
- `[todo]` DAR/SAR and resize-mode pure decisions extracted from native geometry where practical.
- `[todo]` Permission decision tests by Android API level.
- `[todo]` OTA/native-version compatibility policy tests if Stallion exposes a pure selector.

### 15.2 Android/native automation

- `[todo]` Add a minimal instrumentation test for exported intent validation and installer path validation.
- `[todo]` Add a CI task that inspects final APK manifest version/permissions/cleartext state.
- `[todo]` Add automated ARM64 ELF and APK zip-alignment checks.
- `[todo]` Add dependency/license inventory output to release artifacts.
- `[todo]` Keep release signing failure test: absent upload credentials must fail unless
  the explicit local debug-signing opt-in is supplied.

### 15.3 Manual release matrix

- `[todo]` clean install and upgrade over latest public version;
- `[todo]` first-run permission grant/deny/retry;
- `[todo]` local library load, folders, search, recents, deletion;
- `[todo]` playback, seek, pause/resume, rotate, subtitles, tracks, delay, rate, enhancement;
- `[todo]` manual and auto PiP on 16:9 and 2.39:1; resize without dragging afterward;
- `[todo]` navigate away then Home: no PiP leak;
- `[todo]` MainActivity and external-open Activity;
- `[todo]` notification/lockscreen/headset/Bluetooth controls;
- `[todo]` background behavior according to the currently advertised support level;
- `[todo]` APK update check/download/hash/install and unknown-sources flow;
- `[todo]` Stallion update/restart/rollback if enabled;
- `[todo]` airplane mode, slow network, API timeout, and cancellation;
- `[todo]` no production secret visible in APK strings/resources/bundle;
- `[todo]` ARM64 16 KB device launch and media-feature smoke test.

### 16. Release checklist — no exceptions

- `[todo]` All R0/R1 items relevant to the release are `[done]`.
- `[todo]` Working tree and staged changes are understood; no user work is overwritten.
- `[todo]` Version/tag/changelog/versionCode/build number agree.
- `[todo]` CI uses the expected commit and release signing key.
- `[todo]` TypeScript, zero-warning ESLint, Jest, Android build, and required native checks pass.
- `[todo]` Dependency audit and accepted risks are recorded.
- `[todo]` APKs contain only intended ABIs and pass signature/hash/zipalign/ELF checks.
- `[todo]` Upgrade installs over the latest public APK and app data remains intact.
- `[todo]` Manual matrix is signed off with device/API versions.
- `[todo]` Release is created only after assets are ready.
- `[todo]` `/releases/latest` returns the intended production release, never a develop build.
- `[todo]` In-app updater selects the correct asset on ARM and ARM64.
- `[todo]` Stallion production channel targets the correct native version.
- `[todo]` Rollback owner and previous known-good release are recorded.
- `[todo]` Post-release smoke test downloads through the same public URLs users receive.

### 17. Documentation and ownership cleanup

- `[todo]` After this tracker is reviewed, add a short banner to the three older docs
  pointing here, or move them to `docs/archive/`. Do not maintain four active plans.
- `[todo]` Update README architecture, supported platforms, permissions, update channels,
  background-play support level, network-stream security, and Groq availability.
- `[todo]` Add a release runbook containing external actions that an agent must never
  perform implicitly: credential revocation, workflow cancellation, release publication,
  release deletion, Stallion promotion, and rollback.
- `[todo]` Assign an owner for releases, credentials/provider abuse, Android player,
  OTA, and privacy disclosures—even if all roles currently name the same person.
- `[todo]` Record completion commits beside each tracker item. Periodically remove
  completed implementation detail into a concise changelog so the active list stays usable.

### Player engine (from the deleted player-engine-migration-plan.md)

- `[todo]` **B9 bitmap subtitles are unverified on a device.** No PGS content was available, so
  not one bitmap cue has been drawn. Play a Blu-ray remux with a PGS track and check the native
  `text track N codec=... lang=...` log lines match the JS subtitle list: JS sends the ordinal
  among subtitle streams, which assumes both sides enumerate the container in the same order.
- `[decision]` **A7: text subtitle display stays on extraction, not `onCues`.** Haptics, the
  negative subtitle delay and `FloatingSyncPanel` all need the whole cue list upfront, which
  `onCues` cannot give. Revisit only if none of those need it any more.

### Left undone (from the deleted hardening-roadmap.md)

- `[todo]` **`VideoPlayerScreen` is still a god component.** Position, playing state and tracks
  live in two or three places each. A per-screen controller is the real fix; do it before
  adding big player features. Needs a device to check.
- `[todo]` **No Robolectric test for `GlidePlayerHolder`** start/clear/attach ordering. Needs
  Robolectric plus a real `GlidePlayerService`; a heavy dependency for one case.
- `[todo]` **No Baseline Profile or Macrobenchmark module.** Generating a profile needs a device.

## 1. How to use this tracker

Status:

- `[todo]` — verified work not started.
- `[doing]` — actively being changed; record the branch/commit beside it.
- `[done]` — implemented and acceptance checks passed; record the commit.
- `[blocked]` — cannot proceed; state the exact external blocker.
- `[decision]` — product choice required before implementation.
- `[keep]` — reviewed and intentionally retained; do not reopen without new evidence.

Priority:

- **R0 — incident/release freeze:** act before another public build can be produced.
- **R1 — next-release blocker:** must be complete before the next public APK.
- **P1 — production correctness:** complete before calling the affected feature production-ready.
- **P2 — migration/maintenance:** scheduled work with a verified reason.
- **P3 — cleanup/guardrail:** lowers future cost but does not block a release by itself.

Completion rule: changing code is not enough. An item becomes `[done]` only when its
listed automated and manual acceptance checks pass.

## 3. R0 — contain the release and credential incidents

### 3.1 Stop further accidental publication

Files: `.github/workflows/android-ci.yml`, `package.json`, GitHub Releases settings.

Exit check: ordinary branch pushes can run verification but cannot create a tag,
GitHub Release, or release asset.

### 3.2 Contain the exposed Groq key

Exposure path as originally found (all five links are now broken; see below):

1. `.github/workflows/android-ci.yml` writes `GROQ_API_KEY` to `.env`.
2. `react-native-config` compiles it into the mobile application.
3. `src/utils/constants.ts` exposes it to JavaScript.
4. `RecapService.ts` uses it for chat completions.
5. `SpeechToTextService.ts` uses it for transcription and translation.

`react-native-config` does not encrypt packaged values. Rotating the key and embedding
the replacement in another APK creates the same exposure again.

**Reconciled 2026-09-04.** The code half of this section shipped with the proxy and was
never marked. Verified against the working tree, not memory: `grep -rn GROQ` matches
nothing in `.github/workflows/`, `src/`, or `.env.example`. Both Groq console actions —
key revocation and the usage review — are confirmed by the owner as of this date and are
marked as attestations; no repository state can prove either.

What remains open in this section is not console work: client-side logging is unaudited,
there is no privacy copy, the proxy has no client authentication, and the exit check below
has not been run against built bytes.

- `[keep]` A Stallion OTA may disable the 1.8.1 recap/STT UI promptly, but it cannot
  remove the key from already-downloaded APK bytes. Key revocation is not contingent on
  OTA adoption; recorded here so the two are never traded against each other.

Files: `.github/workflows/android-ci.yml`, `.env.example`, `src/utils/constants.ts`,
`src/services/RecapService.ts`, `src/services/SpeechToTextService.ts`, recap/STT UI,
README/privacy documentation.

Exit check: decompile/search a signed production APK and confirm no project-owned Groq
credential exists. Exercise both disabled and restored product paths.

## 4. R1 — rebuild CI, releases, and version identity

### 4.1 Separate verification from publishing

Keep one workflow unless splitting materially improves maintenance.

Reconciled 2026-08-27. Most of this section was implemented in the 1.9.x workflow rebuild
but never marked; the entries below are verified against the workflow file, not memory.

### 4.2 Make version identity monotonic and single-source

Current severity: `android/app/build.gradle` hardcodes app `versionCode 1`, and the
public 1.8.1 Build 54 APKs shipped with that value. The local VLC Android library also
contains an irrelevant `versionCode 1`, handled separately in section 10.3. This is not
general tidiness: the next APK needs a greater app version code for a reliable upgrade
contract, while the current updater also discards `-build.N` from tag comparisons.

Files: `package.json`, `android/app/build.gradle`, iOS project build settings,
`.github/workflows/android-ci.yml`, updater version utilities.

Exit check: install the new APK over the latest public APK without `adb` downgrade or
debug flags; the system reports the expected version name/code.

## 5. R1 — correct Android notification and media permissions

### 5.1 Remove the unnecessary media-notification permission path

The player creates a `MediaStyle` notification with a media-session token. Android
exempts media-session notifications from `POST_NOTIFICATIONS`. The current permission
gate suppresses a notification that Android allows.

### 5.2 Request only the media collection Glide reads

Current CameraRoll reads use `assetType: 'Videos'`; deletion passes video content URIs.

- `[keep]` Keep `READ_EXTERNAL_STORAGE` with `maxSdkVersion=32` for older devices.

New finding, present in public 1.8.1: the release merged manifest ships two permissions
Glide never declared. `READ_PHONE_STATE`, a dangerous runtime permission, is injected by
`react-native-share` and `react-native-stallion`; `WRITE_EXTERNAL_STORAGE` is injected
unbounded by `@dr.pogodin/react-native-fs`. Both appear on the user-visible permission
list of a video player that reads neither.

### 5.3 Review special permissions

- `[decision]` `WRITE_SETTINGS`: decide whether “global brightness” is worth a special
  system permission. The smaller product is per-window brightness; if selected, remove
  global mode, permission, settings UI, and native write-settings path.
- `[keep]` `REQUEST_INSTALL_PACKAGES` only while GitHub APK self-update remains a
  supported distribution path. Reassess before Google Play distribution because the
  permission is policy-sensitive.
- `[keep]` `VIBRATE` for haptics and `INTERNET` for metadata, subtitles, updates, and streams.

## 6. R1 — network and exported-input security

### 6.1 Remove accidental cleartext for app APIs without breaking intentional streams

Glide intentionally accepts `http://`, `https://`, and `rtsp://` playback sources.

Implemented 2026-08-27. The `[decision]` below is resolved by making it unnecessary
rather than by choosing a side: a Network Security Config permits cleartext in its
`base-config`, so arbitrary user streams are untouched, and forbids it per-domain for
every app-owned API. No product capability is given up, so no insecurity warning is owed.

- `[keep]` Stallion's bundle CDN (`cloudfront.net`) is deliberately **not** pinned.
  Pinning all of CloudFront would also block a user stream hosted there, which is exactly
  the case `base-config` exists to permit. The control plane on `stalliontech.io` is pinned.
- `[keep]` APK asset URLs were already covered by `isTrustedAssetUrl`, which requires
  HTTPS plus a GitHub release-asset host. Nothing to add.
- `[keep]` The proxy URL needs no config entry: `constants.ts` already refuses any
  `AI_PROXY_URL` not starting with `https://`, and static XML cannot know a custom proxy
  domain chosen at build time. `workers.dev` covers the default Workers domain.

### 6.2 Validate external intents and deep links

Implemented 2026-08-27. `VideoPlayerActivity` is `exported="true"`, so any installed app
can start it with an **explicit** intent and bypass all eight manifest intent filters.
Before this change `intent.data.toString()` reached JavaScript and LibVLC unvalidated, and
LibVLC natively resolves `smb`, `ftp`, `nfs`, `sftp`, `dvd`, `screen` and more.

- `[keep]` **No MIME assertion on ACTION_VIEW.** The manifest already requires `video/*`
  for every implicit VIEW except extension-matched http(s) links, and an explicit intent
  can declare `video/mp4` for anything — so the check buys nothing against an attacker
  while rejecting file managers that send `application/octet-stream` for a real video.
  ACTION_SEND keeps its MIME check, where the sender chooses the type and the stream
  extra carries no scheme guarantee of its own.
- `[keep]` `RootNavigator`'s `Linking` handler calls `DeepLinkService.isVideoUri` only to
  decide whether to log, and `MainActivity` declares no VIEW filter, so no external URL
  reaches it. It is not an input boundary; do not harden it as though it were one.

## 7. R1/P1 — harden GitHub APK updates

### 7.1 Release discovery and version parsing

Verified defect, present in public 1.8.1: `getPreferredAbi()` read
`NativeModules.PlatformConstants.supportedAbis`, which React Native does not define on
any platform — the Android `PlatformConstants` spec exposes only `Version`, `Release`,
`Serial`, `Fingerprint`, `Model`, `Brand`, `Manufacturer`, `ServerHost`, `uiMode`,
`isTesting`, and `reactNativeVersion`. Both ABI branches were therefore unreachable and
every device fell through to the ARM64 fallback, so armeabi-v7a users were handed an
incompatible APK and the installer failed silently because `ApkInstallerModule.install()`
resolves as soon as `startActivity` returns. This is the reason the corrective release
must ship the fix below: without it, 32-bit users cannot install the build that revokes
the exposed credential.

- `[keep]` Ignore draft/prerelease releases. `/releases/latest` already returns "the most
  recent non-prerelease, non-draft release," so the client check only guards a custom
  `GITHUB_RELEASES_URL`. A prerelease channel would be new product scope, not a fix.
- `[done, deploy pending]` Send the update check through the Cloudflare Worker with a short cache.
  `GET /v1/latest-release` calls GitHub with an optional `GITHUB_TOKEN` secret (5,000/h)
  and caches for 5 min in memory (the Cache API is a no-op on workers.dev). The app tries
  the proxy first and GitHub direct second. Smoke-tested against real GitHub under
  `wrangler dev`.

Tests: strict versions, leading `v`, malformed input, missing patch component if allowed,
greater/less/equal, every supported ABI, asset reordering, no asset, and malicious URLs.

### 7.2b Update UI state, reported from device use

Verified defect, present in public 1.8.1: the update UI exists in two places — the
app-level `UpdateModal` mounted for the whole session in `App.tsx`, and the Settings
update card — and each called `useUpdateInstaller`, so each owned its own `useState`.
Two independent state machines drove one shared download and one shared cache file, so
progress, download status, and cached-APK state disagreed between the two surfaces.
Settings also never rendered the changelog at all.

### 7.3 Installer behavior

Replaced `ACTION_VIEW` on a FileProvider URI with a `PackageInstaller` session.
`ACTION_INSTALL_PACKAGE` has been deprecated since API 29, and the intent path cannot
report an install result at all: it resolved success as soon as the installer Activity
started, which is why the ABI defect in section 7.1 was invisible in production.

## 8. P1 — complete timer-free player geometry and lifecycle

### 8.1 Replace hand-written resize geometry

**Correction, verified against the LibVLC 3.6.5 bytecode on 2026-08-27.** The plan below
originally routed resize modes through `MediaPlayer.setVideoScale(ScaleType)`. That method
cannot work here:

```java
public void setVideoScale(ScaleType st) {
    if (mVideoHelper != null) { mVideoHelper.setVideoScale(st); }
    return;   // silent no-op otherwise
}
```

`mVideoHelper` is constructed *only* inside `attachViews(VLCVideoLayout, DisplayManager,
boolean, boolean)`. Glide attaches through the raw
`IVLCVout.attachViews(OnNewVideoLayoutListener)` path, so `setVideoScale` and
`updateVideoSurfaces` are both no-ops in this codebase. The former fallback — "keep the
TextureView but collapse geometry into one `setVideoScale` path" — was self-contradictory.

Adopting `VLCVideoLayout` to obtain `ScaleType` was rejected against two verified facts:
`VlcPipController` overrides bounds on this view's subtree, and Fabric manages the view as
the TextureView. A third blocker, `doSnapshot()` needing `TextureView.getBitmap()`, was
removed when the screenshot feature was deleted as unused — so the case is weaker than it
was, but the PiP bounds override remains the hard one. LibVLC 4 changes this API surface,
and section 11.1 already forbids shipping its EAP, so revisit only when LibVLC 4 is stable.

The goal is unchanged — one geometry route, correct SAR, no forced retries — but it is met
with app-owned math against the TextureView rather than with LibVLC's scaler.

- `[keep]` Stay on `TextureView` with `IVLCVout.attachViews(listener)`. Do not spike
  `VLCVideoLayout` while snapshots, PiP bounds override, and Fabric depend on the
  TextureView identity.
- `[keep]` The applied-state cache fields. They prevent redundant native calls on every
  layout pass, and the cache is keyed on every input the geometry depends on.
- Note on cause: the aspect forcing is older than this refactor, but it sat behind an
  `if (mSarNum > 0 && mSarDen > 0)` guard. On files where `onNewVideoLayout` never fires,
  SAR stayed 0:0 and the guard fell through to `setAspectRatio(null)` — accidentally
  correct. Populating SAR from the video track put those files on the broken branch for the
  first time, so the SAR fix did not create this bug but did expose it.

### 8.2 Replace lifecycle timing guesses with Activity lifecycle

The platform documentation is explicit about this: "In Android 7.0 and later, you should
pause and resume video playback when the system calls your activity's `onStop()` and
`onStart()`. By doing this, you can avoid having to check if your app is in PiP mode in
`onPause()`." The 800 ms grace period existed only because the view listened on the wrong
callback — `onPause` fires for both backgrounding and entering PiP, `onStop` for neither
but the first.

### 8.3 Replace fixed player retries with real events

**Status: `[doing]`.** Section 1's completion rule is explicit — an item is `[done]` only
once its acceptance checks pass — and the device matrix at the end of this section has not
been run. The `[done]` markers below therefore mean "implemented and verified as far as a
desk allows": each one compiles, and where a device trace exists it is cited. They do not
mean accepted. Do not close this section, or treat resume as fixed, until the matrix passes.

An earlier version of this section marked these `[done]` outright, which was wrong by the
tracker's own rule and is the sort of drift that makes a status column worthless.

**As of 2026-09-04 every code item in this section is implemented and the last three
anomalies are explained, and two of the three are confirmed fixed on device.** Capture with:

    adb shell am force-stop com.glide.app
    adb logcat -c
    adb logcat -v time -s GlideVLC:V ReactNativeJS:V

The force-stop is not incidental. Focus registrations leak into the *process*, so a capture
taken against an app that has already played something carries state from before the
capture began and will show the symptom whether or not a fix works. This section has been
reopened three times by a trace read as evidence when it could not distinguish the two
outcomes, so before reading a capture, name the line that would have appeared had the
behaviour still been broken.

Implemented 2026-08-27, corrected against a device trace 2026-08-28. Verified against the
LibVLC 3.6.5 bytecode before writing any of it: `MediaPlayer.Event` exposes `ESAdded=276`,
`ESSelected=278`, `SeekableChanged=269` and `LengthChanged=273` with `getEsChangedType()`,
`getSeekable()` and `getLengthChanged()`; `MediaPlayer.isSeekable()` is a real native
method; `IMedia.Track.Type.Audio` is `0`.

A correction to this section's framing: it reads as though four event paths had to be
built. The `Playing` event already applied the audio track and reasserted the audio delay.
The work was deleting the timers and enhancement restore paths that duplicated those
owners, then adding the one event genuinely missing.

**Confirmed on device 2026-08-28**, which is what these items could not claim before:
`ESSelected`/`ESAdded` fire and the track applies with `reason=es`; `SeekableChanged` and
`LengthChanged` both fire; there is no runaway re-selection loop; no `apply failed`; no
crash. The trace also showed `reapplied ... reason=create-player ok=false` followed by
`reason=audio-track ok=true` — VLC rejects an audio delay set before there is media, so
the ES events are the real application point, exactly as designed.

- `[keep]` Seek buffer timeout, unchanged as directed. Confirmed properly versioned:
  guarded by `mSeekVersion == thisSeekVersion`, and `cancelPendingSeek()` increments it.
  The device trace showed it firing mid-flush during a failed resume; that specific
  trigger disappears with the resume fix below, so re-measure before touching it.
- `[keep]` UI auto-hide, debounce, sleep and animation timers where the timer is the
  intended UX. The progress poll, resize debounce, buffering debounce and enhancement
  debounce are all of that kind.

**Saved-position restore: replaced twice, and the second answer is the right one.**

The first attempt did what this entry literally asked — replaced the flat 200 ms with a
`SeekableChanged`/`LengthChanged`/`Playing` gate. The device trace disproved the premise.
At the moment of the failing resume, `SeekableChanged=true` and `LengthChanged=9146049`
had **already** arrived, and a `setTime` issued 146 ms later still landed at 0:

    02.052  SeekableChanged seekable=true
    02.052  LengthChanged length=9146049
    02.240  [SEEK] setTime(6354400ms)
    02.598  Playing | time=0
    02.598  [SEEK_VERIFY] drift: target=6354400ms actual=0ms delta=6354400ms

So seekability and length are **not** sufficient readiness. LibVLC drops a `setTime`
issued during its startup ramp regardless. Any gate built from those two signals — the one
this entry specified — would have failed the same way.

- `[doing]` Resume no longer seeks at all. The offset is applied as VLC's `:start-time`
  media option when the media is opened, so the demuxer starts there and there is no
  window to miss. `start-time` was verified present in this LibVLC build's option table by
  binary inspection, alongside the `input-fast-seek` and `audio-desync` options the project
  already relies on.
- `[keep]` The guard in `savePlaybackProgress` that refuses to overwrite deep history when
  the player is still near zero. It was a workaround for this bug, but it also prevents
  real data loss on an immediate exit, so it stays on its own merits.

**A wrong diagnosis, corrected 2026-08-28 after external review.** An earlier version of
this section claimed the player's event listener ran on VLC's own thread and could
therefore overlap a main-thread release, and it added seventeen `volatile` fields on that
basis. That was wrong, and the file's own long-standing comment — "VLC dispatches events on
its own internal thread, NOT Android's main thread" — is wrong with it.

Verified from the LibVLC 3.6.5 bytecode: `VLCObject.dispatchEventFromNative` is invoked on
a native thread but always ends in `Handler.post(EventRunnable)`, and
`setEventListener(listener)` builds that handler with `Looper.getMainLooper()` when none is
supplied. Events are therefore delivered on the **main thread**. `releasePlayer`, the prop
setters and the seek path all run on the main thread too, so none of them can interleave.
Nothing in the class touches the player off the main thread: `seekExecutor` was allocated
and shut down but never submitted to, and has been deleted.

- `[keep]` `onEvent` still reads the player into one local per event. Kept for legibility —
  one read instead of seventeen, with the null check and every use referring to the same
  object — not as protection against a race.
- `[keep]` `setEventListener(null)` before release, with the correct justification:
  `setEventListener` calls `removeCallbacksAndMessages` on the handler it dispatches
  through, so detaching **discards events already queued for the main thread**. Without it
  an event posted just before release runs afterwards against a freed player, which is the
  `IllegalStateException: can't get VLCObject instance` failure. Queued behind, not
  overlapping — the fix is right, the original reason was not.
- Lesson worth keeping: the wrong diagnosis came from trusting a comment in the file
  instead of reading the library, in a session that had already caught two other claims
  the same way. Verify the mechanism, not the annotation.

**Findings from the same review that were already resolved.** Three findings targeted the
event-gated position restore — a paused recreate never producing a `Playing` event, the
ignored `setTime` return value, and the five-second backstop abandoning ready media. All
three were real against that design. The `:start-time` change above removes the design
rather than patching it: VLC opens the demuxer at the offset whether or not anything plays,
so there is no event to miss, no return value to check and no backstop to time out.

**Two further findings from the review, both fixed at the ownership boundary.**

**Second review round, 2026-08-28. Six findings, all legitimate, all fixed.** Four were
introduced or left open by this section's own work, which is worth recording rather than
smoothing over.

**Checked against LibVLC/VLC sources rather than inferred, 2026-09-02.** The resume work
above was reasoned from Java bytecode signatures and device symptoms. That produced one
correct decision and one wrong one, so the mechanism was read at the source.

Findings, each with its consequence:

- **`:start-time` is the supported route, not a workaround.** VLC's own Android application
  resumes with the same media option: `media.addOption(":start-time=${start/1000L}")` in
  `PlaylistManager.playIndex`. This implementation is therefore aligned with upstream, and
  the earlier plan to fall back to a post-play seek would have moved *away* from it.
- **The option is declared `add_float`** in `src/libvlc-module.c`
  (`add_float( "start-time", 0, ... )`), so a fractional value is valid. Glide keeps
  sub-second precision deliberately and does **not** copy upstream's integer-second
  rounding; matching upstream's formatting for its own sake would discard precision for no
  reason.
- **VLC applies it asynchronously.** `StartTitle()` in `src/input/input.c` reads
  `var_GetFloat(p_input, "start-time")`, converts to microseconds, and then
  `input_ControlPush(p_input, INPUT_CONTROL_SET_TIME, &s)`. It is a queued input control,
  not a synchronous seek, and there is no `b_can_seek` or demuxer-capability precondition
  in that path.

That last fact invalidated the verification this section previously shipped:

**Root cause of seek and resume imprecision, found 2026-09-02 from a device journal.**

Two symptoms that looked unrelated turned out to be one option. A trace of ordinary use
showed user seeks landing far from the requested time:

    [SEEK_VERIFY] drift: target=5535978ms actual=5516562ms delta=19416ms
    [SEEK_VERIFY] drift: target=5606632ms actual=5571138ms delta=35494ms

and resume landing consistently early (4.6 s, 7.9 s, 2.1 s, 2.0 s on successive opens).

`src/input/input.c` reads the option once per input and then uses it as the precision
argument for every seek:

    priv->b_fast_seek = var_GetBool( p_input, "input-fast-seek" );
    ...
    demux_Control( ..., DEMUX_SET_TIME, i_time, !input_priv(p_input)->b_fast_seek );
    demux_Control( ..., DEMUX_SET_POSITION, (double) f_pos, !input_priv(p_input)->b_fast_seek );

- Note on why a per-call fix was not enough: `MediaPlayer.setTime(long)` compiles to
  `nativeSetTime(time, false)`, so Glide was *already* requesting precise seeks. That flag
  only selects the `time` versus `time-fast` input variable; the demuxer's precision comes
  from `b_fast_seek`, which the option had already fixed for the whole input. This is why
  the earlier keyframe-tolerance work treated coarse landings as unavoidable — they were
  not, they were self-inflicted.
- `[keep]` Precision over seek latency, which is also VLC's own default: its Android app
  exposes fast seek as an opt-in setting rather than enabling it for everyone.
- `[keep]` The resume precision correction stays as a safety net, but it should now rarely
  fire. If `START_TIME: landed Nms early` disappears from traces, the residual was entirely
  this option and the correction can be deleted.

**Device confirmation, 2026-09-02 23:40 build.** A clean capture over two and a half
minutes of deliberate abuse — repeated resumes, rapid seek spam, enhancement toggling,
twenty-two rate changes, an audio-track switch and a PiP round trip — settles most of this
section.

- `[keep]` The start-time precision correction, for now. It has stopped firing entirely,
  which by the measurement rule above argues for deleting it — but the evidence is one file
  on one device, and a coarser demuxer or a different codec could still land short. It
  costs nothing when it does not fire. Delete it once traces from more than one source
  agree.
**The three remaining anomalies, 2026-09-04. All three are closed and confirmed on device.**
Each was found by reading the code the journal pointed at; the audio-focus one took three
captures and two wrong explanations before a field existed that could falsify them.

One new observation from the same captures, recorded so it is not rediscovered as a bug:
`INTENT: stop` is *absent* from most teardowns, appearing on roughly one exit in four. The
JavaScript stop is `videoRef.current?.stopPlayer?.()`, and by the time the screen unmounts
that ref is often already null, so teardown runs through `cleanUpResources()` →
`stopPlayback()` instead. Both paths release the player and abandon focus, so nothing is
leaked and nothing is left playing. It is `[keep]` rather than `[todo]` because the exit is
correct by either route; what would be wrong is reading the missing line as a missing stop.

  The confirmed cause is a leaked registration. `AUDIOFOCUS_LOSS` clears `mHasAudioFocus`
  without abandoning anything, and `abandonAudioFocusInternal()` was gated on that same
  flag — so a view that had ever lost focus reached teardown with the flag already false,
  returned early, and left its listener registered with `AudioManager` for the life of the
  process. Every cycle leaked another. The loss then lands on an older leaked view, whose
  flag is false, which is exactly what `held=false` reports. Fixed by abandoning
  unconditionally; abandoning without focus is a framework no-op, so the guard bought only
  the leak. `mHasAudioFocus` is now `volatile` — it is written from VLC's event thread and
  the seek handler, and read by the callback on main, and it is the field the diagnosis
  rests on.

  The remaining losses are explained by the `view=` capture of 2026-09-04, and the answer
  was neither of the two candidates. **Every loss carried the *previous* view's identity**,
  arriving ~110 ms after its successor's grant and *seconds after that view had already
  abandoned focus and released its player*:

      22:16:52.105 view=74010389  requested → GRANTED
      22:16:52.214 view=89370395  change=-1 (lost) held=false playing=false
      22:16:46.127 view=89370395  abandoned          ← six seconds earlier

  So the notification outlives the abandonment. `cleanUpResources()` routes through
  `stopPlayback()` to `abandonAudioFocusInternal()` and the journal confirms it ran, so
  this is not the view's bookkeeping. The delivery is inert — the pause branch tests
  `isPlaying()`, false on a released player — which is why playback never suffered.

  `onAudioFocusChange` now returns immediately when `mCleaned` is set. That flag already
  existed to guard double cleanup, so a torn-down view stops reacting and stops
  journalling. Not silenced: a live view's focus changes journal exactly as before.

- `[keep]` **Three investigations began with `AUDIO_FOCUS: change=-1`, and two of them
  produced confident wrong explanations before a capture existed that could tell them
  apart.** The first blamed a second `AudioFocusRequest` around the same listener and was
  disproved by the very `held=` field it predicted would read `true`; the second blamed the
  abandonment guard, which was a real leak worth fixing but accounted for only part of the
  symptom. What settled it was one identity field and a force-stopped process. Record the
  discriminating observation before the mechanism, and prefer a field that can falsify a
  hypothesis over a fix that merely makes the line go away.

  `commitSeek` now refuses when there is no duration and returns whether it accepted; the
  three skip callers show nothing on a refusal. One guard in the shared function, honoured
  by the callers that display a time — not a guard per caller. The slider path is left
  alone: its gesture already refuses to begin without a duration, and a second guard there
  would imply the first was insufficient.
- `[keep]` The seek bar "disappearing" was the same 430 ms window and is already fixed by
  the dimmed-scrubber work above. No separate defect was found.

**Controls claimed readiness they did not have, fixed 2026-09-02.** Reported as the HUD
showing zeros and the seek bar being absent when touched immediately after opening a video.
Neither was a native fault; the journal for those moments is clean.

The window is measurable from a device trace: `SOURCE opened` at 23:53:16.985 and the first
`STATE playing … of 9146049ms` at 23:53:17.417, so JavaScript does not learn the duration
for roughly 430 ms. During it `durationShared` is still its initial `0`, and:

- the scrubber's `progress` divides by `duration.value || 1`, so it drew an empty track with
  no thumb — read as "the seek bar is missing";
- the three time labels formatted `0`, so they read a confident `00:00 / 00:00`;
- `panGesture.onBegin` already refused to start on `duration.value <= 0`, so a tap in that
  window correctly did nothing — which is precisely why it looked broken. The control was
  inert but presented as usable.

`isVideoLoaded` already existed and was set in `handleLoad`, but only ever gated
`applySeekToVLC` and the buffering-spinner decision. It was never applied to the controls.

- `[keep]` No interaction blocking was added. The gesture guard already refuses to start
  without a duration; the defect was the presentation, and adding a second guard would
  imply the first was insufficient.
- `[keep]` A tap made before the duration is known is discarded rather than replayed once
  it arrives. Honouring it would mean guessing at an intent formed against a bar that had
  no scale.

### 8.4 Collapse native scheduling ownership

- `[keep]` Do **not** merge the player view's seven main-loop Handlers into one. Verified
  safe to do — every removal in that file is `removeCallbacks(runnable)` and nothing calls
  `removeCallbacksAndMessages(null)`, so a shared handler would behave identically — and
  verified pointless: they already post to the same looper queue, so the only change is one
  object instead of seven. The separate handlers name their owner, which is what made the
  section 8.3 work tractable. Churning a file that was just rewritten, for no functional
  gain, is the opposite of what this item was for.

### 8.7 P2 — remove the measured progress-driven whole-screen render

On-device measurement and source tracing agree: idle playback renders
`VideoPlayerScreen` about twice per second because `handleProgress` copies current time
into React state every `DISPLAY_TIME_UPDATE_INTERVAL = 500` ms. Smooth playback time is
already maintained by `currentTimeShared`, while `currentTimeRef` holds an immediate JS
snapshot. The recurring React state update currently reaches these paths:

- `PlayerControls.currentTimeSeconds`, used only to build `ReanimatedText` fallback strings;
- `BookmarkPanel.currentTime`, used to highlight bookmarks near the playhead;
- `FloatingSyncPanel.currentTime`, which is passed from `currentTimeRef.current` but only
  receives a new prop because its parent happens to render on the state tick;
- `AnimatedVideoView.currentTime`, ignored by its memo comparison during progress but
  sampled when `playerKey` changes to resume decoder/enhancement recreation.

## 9. P1 — make background playback honest before target SDK 35+

**Status as of 2026-09-04: built, running on device, and open only on verification.** The
architecture landed 2026-08-27 — `VlcPlaybackEngine` owns the native handles,
`GlidePlaybackService` is a Media3 `MediaSessionService` running foreground as
`mediaPlayback`, `VlcMedia3Player` adapts LibVLC in ~170 lines, and the hand-written
`MediaSessionCompat` notification is deleted. Three device-found defects were fixed on top
of it. Confirmed on device: `isForeground=true foregroundId=1001 types=0x00000002`.

What remains is a device pass over notification states, one real bug (session position
going stale after a seek while paused), one permission check, and a decision on how
background playback is labelled until those close. The target-SDK bump this section was
written to unblock is itself blocked on section 10.2; see the end of this section.

Verified defect, present in public 1.8.1, reported from device use: the notification's
playback clock kept advancing after pausing, stopping, or closing PiP, while actual
playback position stayed correct. `updatePlayPauseState` passed `mMediaPlayer.getRate()`
as the `PlaybackStateCompat` playback speed. That is the rate *setting*, which stays at
1.0 while paused; LibVLC never reports 0 for it. The system extrapolates the position it
displays as `position + elapsed * speed`, so any non-playing state published with a
non-zero speed produces a clock that runs on its own, client-side, forever.

Decisions taken 2026-08-27:

- `[decision]` Until this phase is complete, either label background playback
  experimental or disable its production toggle. Activity-owned playback is not a
  reliable background architecture.
Implemented 2026-08-27. Five new files in the player module; `ReactVlcPlayerView` came
out 58 lines shorter despite gaining the integration, because the hand-written session went.

Corrections to earlier assumptions in this section:

- `[keep]` **Audio focus stays in the view.** Media3 does not manage focus for a
  `SimpleBasePlayer`: `handleSetAudioAttributes(attributes, handleAudioFocus)` is a handler
  the implementer fills in, and `AudioFocusManager` is a utility ExoPlayer wires up, not
  something `SimpleBasePlayer` runs. The existing request/abandon, ducking, transient-loss
  and noisy-device handling works; rewriting it onto `AudioFocusManager` would be churn
  carrying real regression risk for no functional gain.
- `[keep]` **PiP needs no service work.** The requirement was that PiP must not create a
  second player. There is exactly one, owned by the engine, and PiP is the same Activity
  and the same view entering PiP mode. Already satisfied.
- `[decision]` **Media3 is pinned to 1.7.1, not 1.11.0.** Verified by building both: 1.11.0
  requires `compileSdk 36` *and* Kotlin 2.x — it pulls `kotlin-stdlib 2.2.10` against this
  project's 1.9.24 and fails with an incompatible-metadata error. Both are exactly the
  AGP 9 / Kotlin 2.2 work in section 10.2. So this phase is coupled to that one after all,
  which was not previously recorded. 1.7.1 has `SimpleBasePlayer`, `MediaSessionService` and
  `PositionSupplier`, so nothing above depends on the newer release.
- Correction: this section previously reasoned that a `MediaController` was optional
  because the session alone would drive the notification. That was wrong about the
  mechanism. A controller is still not required — `addSession` covers it — but the
  registration it would have performed as a side effect is not optional.

**The original plan for this section was struck on 2026-09-04.** Eleven `[todo]` lines stood
here describing work to move ownership into a foreground service, add the
`FOREGROUND_SERVICE` permissions, adopt a `MediaSessionService`, write a LibVLC `Player`
adapter and let Media3 own the notification. All of it was implemented on 2026-08-27 and
recorded as `[done]` sixty lines above, in this same section, while the plan it replaced was
left in place underneath. Nothing was gained by keeping it and something real was lost: a
reader counting open items — including one returning to this tracker on 2026-09-04 —
concludes the section has not been started.

That is the failure section 1's completion rule exists to prevent, applied in the other
direction. A plan is not a record. When work lands, strike the plan; do not leave both and
expect the dates to tell them apart.

Three items from that block were **not** superseded and survive it:

- `[keep]` **No `MediaController` from the UI.** The original plan required one so the
  Activity would not own the only live player. That requirement is met differently: the
  engine owns the player, the view borrows it, and `addSession` registers the session
  without a controller ever connecting. `VlcMedia3Player` mirrors LibVLC rather than
  replacing it, so making React drive Media3 would rewrite every one of the 198
  `mMediaPlayer` call sites to gain nothing the session needs. Reopen only with a
  requirement a controller uniquely satisfies.
- `[keep]` **Process death and cross-connection state transfer are out of scope**, and were
  answered by the task-removal decision rather than implemented. `onTaskRemoved` stops
  playback and the service, so there is no surviving session to restore state into.
- `[blocked]` **Raise target SDK to 35+.** This is the reason the section exists — Android
  35+ rejects audio focus requests from a background app without a foreground service, and
  that service now exists. It is blocked on section 10.2, not on anything here: Media3 is
  pinned to 1.7.1 because 1.11.0 requires `compileSdk 36` *and* Kotlin 2.x, which is exactly
  the AGP 9 / Kotlin 2.2 migration. Do not attempt the SDK bump from this section.

Exit check: lock screen, Home, task dismissal, process pressure, Bluetooth disconnect,
incoming call, notification controls, and reopening the UI all preserve explicit user intent.

## 10. P2 — coordinated React Native and Android toolchain migration

Do not update these independently. Use the RN Upgrade Helper/template diff as the source of truth.

### 9.1 Foreground service crash loop (found on device, 2026-08-27)

`ForegroundServiceDidNotStartInTimeException` on `GlidePlaybackService`, twice in 23
seconds across two PIDs: `Context.startForegroundService() did not then call
Service.startForeground()`.

- These two compounded into a loop that cannot exit: the process dies for any reason, the
  platform restarts the service sticky, the restart finds no host, it stops without going
  foreground, and the platform kills the process for it. Which matches the log exactly —
  same exception, same service, two PIDs, 23 seconds apart.

### 10.5 Clean sweep review (2026-08-27)

A deliberate re-read of everything changed in sections 9 and 10, against the shipped APIs
rather than against memory. Findings, including against my own work:

Deliberately **not** done, with reasons:

- `[keep]` The module declares 50 props and the app passes 29. Most of the difference is
  not dead: the eleven `onVideoX` callbacks are the native event names that
  `VLCPlayer.tsx` maps to the short names the app uses, and `subtitleUri` and
  `acceptInvalidCertificates` are real native features this app happens not to use. Only
  `disableFocus` and `playWhenInactive` are genuinely inert, which is not worth churning
  a file that was just validated on device. Checked before cutting, not after.
- `[keep]` `autoAspectRatio` is never passed from JavaScript but is load-bearing in the
  native geometry code from section 8.1. Removing the prop would have stranded live
  branches; removing the machinery is a geometry refactor, not a sweep.

### 10.4 Local simple-thumbnail module cleanup

This Android-only module is manually included in `android/settings.gradle`, linked in
`android/app/build.gradle`, and registered in `MainApplication.kt`; it is not a normal
root-package dependency and therefore needs its own migration checklist.

## 11. P2 — native media dependencies and 16 KB support

### 11.0 Status 2026-09-11 — the engine migration closed most of this section

LibVLC is deleted. Everything in 11.1
is therefore moot, and the 16 KB problem has narrowed from "the native media stack" to two
named files.

**Measured on the 2.0.0 release APK**, by reading `PT_LOAD` `p_align` out of the ELF program
headers of every packaged `arm64-v8a` library:

| library | p_align | |
|---|---|---|
| `libffmpegJNI.so` (new Media3 decoder) | 16384 | OK |
| `libavcodec/avformat/avutil/swresample/swscale.so` | 16384 | OK |
| every React Native, Hermes, Reanimated, MMKV, Stallion library | 16384 | OK |
| **`libffmpegkit.so`** | **4096** | **blocks 16 KB devices** |
| **`libffmpegkit_abidetect.so`** | **4096** | **blocks 16 KB devices** |

So 32 of 34 packaged libraries are already correct, `libvlc.so` is gone entirely, and the
only two that are not are exactly the FFmpegKit *wrapper* libraries 11.2 already identified.
The hypothesis in 11.2 was right; this is the measurement behind it.

That makes 11.2 the live item and 11.3 the fallback, not the other way round: the blocker is
two small wrapper libraries, not the FFmpeg libraries they wrap.

Reproduce with the ELF parse rather than trusting the build plugin — it needs no NDK on
PATH, only `od`:

    e_phoff @0x20 (u64), e_phentsize @0x36 (u16), e_phnum @0x38 (u16);
    per entry: p_type @+0 (u32, PT_LOAD == 1), p_align @+48 (u64)

### 11.5 HDR10 renders washed out — a LibVLC 3.x capability limit (2026-09-06)

Reported from device use: HDR10 files play with flat, desaturated colour. VLC's own
Android app plays the same file correctly on the same phone (Nothing AIN065, Android 16,
display reports `supportedHdrTypes=[2,3,4]`, `mMaxLuminance=420`, `HDR_CONVERSION_SYSTEM`).

**This was chased through four wrong explanations before the mechanism was established.**
Each was plausible, each was disproved by a device capture, and the pattern in every case
was reasoning from what was *present* in the build rather than what actually *ran*. VLC was
silent throughout because no log listener is set and verbosity defaults to 0; `-vv` should
have been the first move, not the fifth.

**Mechanism, from device captures.** VLC selects its vout like this:

- `android_display` refuses to load: `can't get Subtitles Surface` →
  `cannot blend subtitles with an opaque surface, trying next vout`. Glide never calls
  `IVLCVout.setSubtitlesView`. VLC 3.0's `modules/video_output/android/display.c` gates
  this on `!vd->obj.force && sys->p_window->b_opaque`.
- VLC therefore falls back to `gles2`, which opens with `I420` as its display format. A
  10-bit `I0AL` decoder output gets a swscale filter appended and the HDR precision is
  destroyed before anything could tone map it.
- Naming the module explicitly (`--vout=android_display`) sets `obj.force` and *does* load
  it opaque with hardware decode — and colour is **still wrong**. VLC 3.0's
  `android_display` never calls `setBuffersDataSpace`, so the surface is never tagged
  BT2020/PQ and the compositor has nothing to act on. Forcing it also breaks every resize
  mode, because scaling becomes the surface's job while our geometry drives VLC's
  `setScale`/`setAspectRatio`.
- `[keep]` The `Could not initialize NativeWindow Priv API` warning is **not** related.
  Those symbols are buffer management (`connect`, `setUsage`, `setBuffersGeometry`,
  `dequeue`, `queue`); none touch colour.

- `[decision]` **HDR10 cannot be rendered correctly on LibVLC 3.x here.** The remaining
  options are to evaluate LibVLC 4 EAP, where libplacebo runs across the pipeline rather
  than only in an 8-bit ES2 vout, or to accept the limitation and say so in the UI.
  Section 18 currently forbids LibVLC 4 EAP; that rule predates this evidence and needs an
  explicit owner decision rather than being quietly broken.

### 11.6 Plan — HDR, the LibVLC question, and enhancement (2026-09-06)

Three symptoms, one cause: **LibVLC 3.x on modern Android cannot negotiate HDR, and its
filter architecture cannot apply a video filter without giving up hardware decoding.**
Everything below follows from that, and from one rule: prove the engine before migrating to
it. This section has already cost four confident wrong explanations.

**What Android actually requires**, from the platform HDR guide, is short: a `SurfaceView`,
and a `MediaCodec` configured against it with the HDR profile set (`KEY_PROFILE`, e.g.
`AV1ProfileMain10` / `HEVCProfileMain10HDR10`). Then "standard MediaCodec playback flow
handles HDR without any special handling" and the system does the tone mapping. No
dataspace call is needed from the app. So the bar is low, and VLC 3.x is not clearing it —
consistent with the 23 consecutive
`Exception occurred in MediaCodecInfo.getCapabilitiesForType` lines in every device capture,
which is VLC failing to enumerate codec capabilities on Android 16 before it ever gets to
profile negotiation.

#### Phase 2 — one cheap experiment that decides everything

  This is the measurement the whole question turns on. If ExoPlayer renders it correctly,
  the engine is the problem and Phase 3 is justified on evidence. If ExoPlayer is *also*
  washed out, the problem is the device or the file, LibVLC is exonerated, and no migration
  should happen at all. Either answer is worth far more than another option guess.

**Phase 2 result, 2026-09-06: ExoPlayer renders HDR correctly on this device.** A
debug-only `HdrSpikeActivity` — an `ExoPlayer` and a `SurfaceView`, nothing else — played a
2160p HDR10+/DV file and reported:

    track codec=video/dolby-vision colorSpace=6 colorTransfer=6 colorRange=2

`colorSpace=6` is BT.2020 and `colorTransfer=6` is ST2084 (PQ), so the decoder negotiated
true HDR, and the picture was correct on screen. Same device, same panel, same class of
file that LibVLC 3.x renders washed out. **The engine is the problem, and the migration is
justified on measurement rather than argument.**

**Phase 2 also settled the audio question, and the answer is the bad one.** This device
declares no Dolby decoder of any kind — the full audio list from
`/vendor/etc/media_codecs*.xml` is 3gpp, alac, amr-wb, amr-wb-plus, dsd, evrc, flac, g711,
gsm, mp4a-latm, mpeg, opus, qcelp, raw, vorbis, x-ape, x-ms-wma. No `ac3`, `eac3`, `ac4`,
`dts` or `truehd`. So:

**Confirmed on device 2026-09-06 against a DUAL E-AC-3 file.** Both audio tracks report
`SUPPORTED=false SELECTED=false`, and ExoPlayer raised **no error** — its track selector
simply declines to pick a track it has no decoder for and plays on, video-only. The file is
silent, with nothing in the log to explain it. That is a worse failure mode than a crash and
must not reach a user.

Two other results from the same capture:

- `[keep]` **ExoPlayer parses embedded subtitles natively**: seven tracks came back as
  `application/x-media3-cues` with `SUPPORTED=true`, immediately. Glide's current path
  shells out to `ffmpeg-kit` per track and the device log measures that at 1.5-3.0 s per
  extraction before any cue is available. Migrating the engine therefore also removes a
  multi-second delay and a whole extraction/caching subsystem from the subtitle path.
  Confirm `ffmpeg-kit`'s remaining callers before assuming the dependency can go.
- `[keep]` `Frankenstein...DD 5.1.Atmos.mkv` is **SDR**, not HDR — `colorSpace=-1
  colorTransfer=-1`, 1920x1080. Every HDR observation this session came from the 2160p
  `The Boys` file at 3840x1600. Do not use the Frankenstein file as an HDR comparison.

- `[keep]` Atmos is **not** a regression. E-AC-3 JOC is a 5.1 core plus proprietary object
  metadata; FFmpeg decodes the core and discards the metadata, and VLC uses FFmpeg's `eac3`
  decoder, so nothing on this device renders true Atmos today either. Do not let the word
  "Atmos" in a filename block this decision.

#### Phase 3 — engine strategy

**What is actually lost.** Verified against Media3's extractor set, not assumed:

- **WMV / ASF.** No extractor exists in Media3 and the FFmpeg extension is audio-only, so
  this is a container gap that cannot be closed by enabling decoders. Remove `.wmv` from
  `VIDEO_EXTENSIONS` and `DeepLinkService` rather than failing on open.
- **RTMP.** Not supported. `rtsp://` *is*, via `media3-exoplayer-rtsp`. Remove the
  `rtmp://` branches in `NavigationService` and `VideoPlayerScreen`.
- **AVI is *not* lost** — `AviExtractor` is in Media3; the published supported-formats page
  omits it. Do not drop `.avi` from the advertised list.
- Audio delay needs a custom `AudioProcessor` or must be dropped. Subtitle delay is free:
  cues are rendered by `SubtitleOverlay`, so it is an offset in JavaScript.
- The 10-band equalizer moves to `android.media.audiofx.Equalizer` against ExoPlayer's
  audio session id, which is a system-level effect rather than a VLC-only one.

**What section 9 gets back.** `VlcMedia3Player` exists only because LibVLC is not a Media3
`Player` — ~170 lines of `SimpleBasePlayer` adapter mirroring VLC's state, plus every defect
found in it: the position supplier outliving a released player, the session never being
registered without a `MediaController`, and the PiP-close state divergence. Handing a real
`ExoPlayer` to `MediaSession` deletes the adapter and that entire class of bug.

This section remains the decision of record.

#### Phase 3 work items, in dependency order

- `[decision]` **Option A — Media3/ExoPlayer as the primary engine, LibVLC as fallback.**
  HDR10 works by default; colour enhancement becomes `ExoPlayer.setVideoEffects()` with
  `Contrast`, `HslAdjustment` and `RgbAdjustment`, which are `GlEffect` shader programs on
  the GPU and therefore keep hardware decoding — solving the enhancement defect properly
  rather than gating it. Media3 session and notification are already integrated. Cost is
  real: ExoPlayer does not cover every container, codec and network protocol VLC does, so
  this is a dual-engine design, not a replacement.
- `[decision]` **Option B — LibVLC 4 EAP.** 4.0 carries libplacebo across the pipeline and
  advertises improved HDR. But it is EAP, section 18 forbids it, the API differs from 3.x,
  and it would land on top of 198 `mMediaPlayer` call sites. Reopen section 18's rule
  explicitly if this is chosen; do not drift into it.
- `[keep]` **Option C — stay on 3.x and document HDR as unsupported.** Legitimate if
  Phase 2 shows the gap is small or the audience does not care. Requires honest UI copy,
  not silence.

## 12. P2/P3 — dependency and code simplification

### 12.2 Delete proven dead source

- `[decision]` Video **recording** is in exactly the same position: `startRecording`,
  `stopRecording`, and `onRecordingState` are referenced only inside the player wrapper,
  with no consumer anywhere in `src/`. Confirm whether it is wanted before deleting; unlike
  the files above it is a feature, not a stray helper.

Re-run references immediately before deletion, then remove:

### 12.4 Reduce noise without abstraction churn

- `[keep]` Large files are not split only for line count. Split after behavior is frozen
  only when ownership/test boundaries become clearer. `ReactVlcPlayerView` is the first
  justified candidate after geometry/lifecycle simplification.
- `[decision]` Review `ThumbnailService`'s LIFO queue/dedupe/worker cache only with a
  measured scroll/thumbnail benchmark. Do not replace working backpressure speculatively.

### 12.5 Direct JavaScript dependency disposition ledger

Every direct entry in the baseline `package.json` is accounted for below. “Keep/align”
means retain only if its current source consumer still exists and its RN 0.87 peer/native
matrix passes; it is not permission to update it independently.

Registry evidence captured with `npm outdated --json --long` on 2026-08-23 follows.
These are installed-lockfile → npm `latest` values for entries npm reported as outdated;
an omitted package was registry-current at that instant, local, or not reported. Registry
`latest` does **not** prove RN compatibility, maintenance quality, or that a major upgrade
belongs in Glide.

| Runtime package reported outdated | Installed → npm latest |
|---|---|
| `@dr.pogodin/react-native-fs` | `2.36.2` → `2.40.0` |
| `@react-native-community/slider` | `5.1.0` → `5.2.1` |
| `@react-native-documents/picker` | `11.0.3` → `12.0.2` |
| `@react-native-vector-icons/feather` | `12.4.0` → `13.1.3` |
| `@react-navigation/bottom-tabs` | `7.6.0` → `7.18.17` |
| `@react-navigation/native` | `7.1.19` → `7.3.17` |
| `@react-navigation/native-stack` | `7.6.0` → `7.18.9` |
| `@shopify/flash-list` | `2.2.0` → `2.3.2` |
| `axios` | `1.12.2` → `1.19.0` |
| `compromise` | `14.14.5` → `14.16.0` |
| `react` | `19.0.0` → `19.2.8` |
| `react-native` | `0.78.3` → `0.87.0` |
| `react-native-config` | `1.5.6` → `1.6.1` |
| `react-native-edge-to-edge` | `1.7.0` → `1.8.1` |
| `react-native-gesture-handler` | `2.29.0` → `3.2.1` |
| `react-native-mmkv` | `4.0.0` → `4.3.2` |
| `react-native-nitro-modules` | `0.33.2` → `0.37.0` |
| `react-native-reanimated` | `3.19.3` → `4.6.0` |
| `react-native-safe-area-context` | `5.6.1` → `5.9.1` |
| `react-native-screens` | `4.18.0` → `4.27.0` |
| `react-native-share` | `12.1.0` → `12.3.1` |
| `react-native-stallion` | `2.2.0` → `2.4.2` |
| `react-native-svg` | `15.14.0` → `15.15.5` |
| `react-native-zip-archive` | `7.0.2` → `9.4.0` |
| `zustand` | `5.0.8` → `5.0.15` |

| Development package reported outdated | Installed → npm latest |
|---|---|
| `@babel/core` | `7.28.5` → `8.0.1` |
| `@babel/preset-env` | `7.28.5` → `8.0.2` |
| `@babel/runtime` | `7.28.4` → `8.0.0` |
| `@react-native-community/cli` | `15.0.0-alpha.2` → `20.2.0` |
| `@react-native-community/cli-platform-android` | `15.0.0-alpha.2` → `20.2.0` |
| `@react-native-community/cli-platform-ios` | `15.0.0-alpha.2` → `20.2.0` |
| `@react-native/babel-preset` | `0.76.0` → `0.87.0` |
| `@react-native/eslint-config` | `0.76.0` → `0.87.0` |
| `@react-native/metro-config` | `0.76.0` → `0.87.0` |
| `@react-native/typescript-config` | `0.76.0` → `0.87.0` |
| `@types/react` | `19.2.2` → `19.2.18` |
| `@types/react-test-renderer` | `18.3.1` → `19.1.0` |
| `babel-jest` | `29.7.0` → `30.4.1` |
| `babel-plugin-module-resolver` | `5.0.2` → `5.0.3` |
| `baseline-browser-mapping` | `2.9.11` → `2.11.18` |
| `eslint` | `8.57.1` → `10.9.0` |
| `jest` | `29.7.0` → `30.4.2` |
| `prettier` | `2.8.8` → `3.9.6` |
| `stallion-cli` | `2.3.1` → `2.5.1` |
| `typescript` | `5.0.4` → `7.0.2` |

| Direct dependency | Required action |
|---|---|
| `@dr.pogodin/react-native-fs` | Keep/align; updater and file operations depend on it. Test scoped-storage/content-URI behavior. |
| `@react-native-camera-roll/camera-roll` | Keep/align for the video library; verify Android partial-video grants and remove unrelated permissions. |
| `@react-native-community/blur` | Keep/align only for verified blur call sites; test Android rendering/fallback. |
| `@react-native-community/slider` | Keep/align the root slider used by the app; remove only the stale slider dependency inside local VLC. |
| `@react-native-documents/picker` | Keep/align; test picker grants, persisted access, cancellation, and invalid results. |
| `@react-native-vector-icons/feather` | Keep/align scoped Feather package; remove stale umbrella vector-icons/type packages. |
| `@react-navigation/bottom-tabs` | Keep and update with the navigation group. |
| `@react-navigation/native` | Keep and update with bottom-tabs/native-stack/screens/safe-area. |
| `@react-navigation/native-stack` | Keep and update with the navigation group. |
| `@shopify/flash-list` | Keep/align while the library list uses it; regression-test item recycling and thumbnails. |
| `@types/sentiment` | Move to `devDependencies`; it is compile-time only. Remove if `sentiment` ships sufficient types. |
| `axios` | Remove after its one caller uses `fetchWithTimeout`. |
| `compromise` | Keep only while recap/NLP source consumers remain; test bundle cost and remove with the feature if unused. |
| `react` | Align exactly to the RN template; never independently. |
| `react-native` | Coordinated migration in section 10. |
| `react-native-config` | Keep/align only for non-secret build configuration; remove packaged credential use. |
| `react-native-edge-to-edge` | Remove after RN 0.87 built-in edge-to-edge replacement is verified. |
| `react-native-fast-image` | Replace seven call sites with RN `Image`, verify UX, then remove. |
| `react-native-ffmpeg-kit` | Retired dependency; remove through section 11's focused repair/full migration, not by itself. |
| `react-native-gesture-handler` | Keep and align with navigation/reanimated/RN. |
| `react-native-linear-gradient` | Keep only for verified UI consumers; visually regression-test before considering removal. |
| `react-native-mmkv` | Keep/align for synchronous persisted state; remove fake async wrappers around it. |
| `react-native-nitro-modules` | Keep only as required by MMKV/other verified Nitro consumers; align as one native group. |
| `react-native-markdown-display` | Keep/align for bounded release notes; audit its Markdown dependency chain. |
| `react-native-reanimated` | Keep and align with RN/gesture/navigation; run worklet and release-build tests. |
| `react-native-safe-area-context` | Keep and align with RN/navigation. |
| `react-native-screens` | Keep and align with RN/navigation; retest PiP/navigation lifecycle. |
| `react-native-share` | Keep only for reachable share UI; test Android URI grants and iOS if supported. |
| `react-native-stallion` | Keep only if section 13's OTA contract is accepted; otherwise remove SDK and channel UI. |
| `react-native-svg` | Keep/align for verified SVG/icon consumers. |
| `@glide/vlc-player` | Keep as the core local player; execute sections 8, 9, 10.3, and 11. |
| `react-native-zip-archive` | Keep only for the verified subtitle/archive flow; enforce archive size/path traversal limits. |
| `sentiment` | Keep only while recap/NLP analysis consumes it; remove with unused feature paths. |
| `zustand` | Keep for current stores; do not add a second state framework. |

| Direct development dependency | Required action |
|---|---|
| `@babel/core`, `@babel/preset-env`, `@babel/runtime` | Align to the RN 0.87 template and Metro; keep runtime in the template-selected dependency section. |
| `@react-native-community/cli` | Replace alpha 15 with the exact stable CLI selected by the RN template. |
| `@react-native-community/cli-platform-android` | Align exactly with the template CLI/core package. |
| `@react-native-community/cli-platform-ios` | Align exactly with the template CLI/core package. |
| `@react-native/babel-preset` | Align exactly to the RN runtime/template. |
| `@react-native/eslint-config` | Align exactly to the RN runtime, then enforce zero warnings. |
| `@react-native/metro-config` | Align exactly to the RN runtime/template. |
| `@react-native/typescript-config` | Align exactly to the RN runtime and Strict TypeScript API. |
| `@types/react` | Align exactly to template React. |
| `@types/react-native-vector-icons` | Remove after scoped Feather types pass TypeScript; it targets the old umbrella package. |
| `@types/react-test-renderer` | Remove if there is no renderer consumer; otherwise align renderer and types to React 19. |
| `babel-jest`, `jest` | Align with the RN template/preset and retain the existing tests. |
| `babel-plugin-module-resolver` | Keep only while Babel config uses aliases that TypeScript/Metro also resolve; otherwise remove. |
| `baseline-browser-mapping` | Remove; no source/config consumer exists. |
| `eslint` | Migrate with RN config, resolve all warnings, and enforce zero warnings. |
| `prettier` | Keep as the single formatter; upgrade only with one formatting decision, not incidental dependency work. |
| `stallion-cli` | Align with the retained Stallion SDK or remove both if OTA is dropped. |
| `typescript` | Align to the RN template/Strict TypeScript API and keep `tsc --noEmit` in CI. |

Native dependency ownership must also stay singular:

## 14. P2 — decide and correct iOS scope

The repository advertises/builds iOS source, but current production proof is Android-only.

- `[decision]` Choose one:
  - **Android-only:** state it in README/package scripts and remove unmaintained iOS
    product code rather than implying parity.
  - **iOS supported:** complete every item below on macOS hardware/CI.

If iOS remains supported:

## 15. P3 — tests and guardrails

### 15.1 Fast automated tests

  The extraction is the point. That judgement previously lived inside the VLC event
  handler, welded between `player.getTime()` and `player.setTime()`, so the only way to
  exercise it was to install a build and read logcat. It was wrong three times on the way
  to being right, and each wrong version cost a device session:
  - it read the position at `Playing`, where VLC has not yet applied the offset;
  - it then used a fixed 2 s tolerance plus "advanced past 4 s" as proof of a drop, which
    classified every successful resume as a failure and issued a pointless corrective seek.

  Verified the tests earn their keep rather than assuming it: restoring the second wrong
  rule makes exactly two of them fail — `landingEarlyIsCorrectedNotTreatedAsDropped` and
  `landingEarlyIsAcceptedOnceCorrectionWasAlreadyTried`, the rows carrying the observed
  8.8 s, 5.2 s and 2.9 s keyframe undershoots. That regression would have been caught
  before an APK was built.

  Cost was a single `testImplementation 'junit:junit:4.13.2'` line. No Robolectric is
  needed because the decision touches no Android API — which is exactly why extracting it
  was worth doing. Logic that does touch `android.*`, such as the intent-scheme validation
  in section 6.2, still needs instrumentation and remains open below.

  Verified the tests earn their keep rather than assuming it: deleting the supersession
  check — the third of the three ways this diagnostic was wrong — fails exactly three of
  them, the rows carrying the transposed target/actual pairs that were once reported as
  19-35 s of drift. Two further rows pin the ordering: supersession is checked *before* the
  position is read, because a superseded seek that returned `WAIT` would linger and later
  be judged against a newer position, which is the mis-attribution the check exists to
  prevent.

  `logSeekVerification` now reads, decides, and acts in that order, and its drift line was
  promoted from `warn` to the journal so a drifted seek appears in a release capture.

Test rule: test non-obvious logic, not implementation trivia. No snapshot suite for static styling.

### 15.3 Manual release matrix

Every release:

When native/player code changes, additionally run Android 8/9 manual PiP, Android
12+ auto-enter, Android 15/16 behavior, portrait/rotated/SAR media, AC3/EAC3/HEVC,
HTTP/HTTPS/RTSP, audio focus, calls, screen lock, and process pressure.

## 18. Explicit do-nots

- Do not rotate Groq and embed the replacement key in another APK.
- Do not publish from ordinary `main` or `develop` pushes.
- Do not rebuild a public SemVer in place; bump the patch version.
- Do not raise target SDK to 35/36 while advertising Activity-owned background playback.
- Do not re-add `POST_NOTIFICATIONS` solely for a media-session notification.
- Do not request image/audio/location media permissions for a video-only library.
- Do not remove the native PiP bounds override while Fabric remains paused in PiP.
- Do not call event-driven AppState reconciliation “polling” or replace ten-line relays
  with a larger registry without a bug.
- Do not delete `createCoalescedRequest` while its concurrent consumers remain untested.
- Do not migrate to LibVLC 4 EAP.
- Do not mix FFmpegKitNext wrappers with FFmpegKit 6 binaries.
- Do not combine RN, background-service, geometry, and FFmpeg migrations in one commit.
- Do not update every dependency to latest independently.
- Do not split large files merely to improve line counts.
- Do not treat CI secret storage as mobile secret storage.
- Do not claim iOS support without an iOS build/device matrix.

## 19. Intended execution order

1. **R0:** stop accidental publication; contain Groq and inventory releases.
2. **R1:** release/version contract; notification/media permissions; updater/security fixes.
3. **P1:** geometry/lifecycle/audio event rebuild.
4. **P1:** foreground playback service — *built; verify on device and settle how background
   playback is labelled until it is verified.* The target-SDK bump it was written to unblock
   is not available here; it moved into step 5.
5. **P2:** coordinated RN 0.87/AGP 9/Kotlin 2.2/SDK migration — now also carries the
   target SDK 35+ raise and the Media3 1.7.1 → 1.11.0 unpin, both blocked on Kotlin 2.x.
6. **P2:** LibVLC 3.7.5 and focused FFmpeg wrapper repair; full FFmpegKitNext separately.
7. **P2/P3:** dependency/dead-code/config cleanup.
8. **P2:** iOS completion or explicit Android-only reduction.
9. **P3:** finish tests, zero-warning CI, documentation, and recurring release checks.

Security/release containment can interrupt this order. Otherwise, do not start a later
phase merely because it is more interesting than the current exit criteria.

### 19.1 Revised order after the engine migration — 2026-09-11

Steps 3, 4 and 6 above were written around LibVLC and have to be re-read. The engine
migration shipped as 2.0.0 and closed step 6's
LibVLC half outright, plus most of section 11 and section 8's geometry work. What is
actually next, in order:

1. **Finish verifying 2.0.0 on device, then tag it.** The build is committed and the release
   APK builds at 33.6 MB, but three things are unverified: the corrected colour-enhancement
   values, the `setFixedSize` fix for the resize-mode flash, and bitmap (PGS) subtitles,
   which have never had a single cue drawn on a device for want of test content. Nothing
   below matters until the thing users run is known good.

2. **16 KB: rebuild the two FFmpegKit wrapper libraries (11.2).** Now the narrowest it will
   ever be — 32 of 34 packaged libraries already pass, and the two that fail are named and
   measured in 11.0. This blocks 16 KB devices and Play going forward, and it is the last
   native-alignment item.

3. **Discharge the LGPL obligation (11.3, migration D2).** Overdue and now more so: 2.0.0
   ships `libffmpegJNI.so` with FFmpeg *statically* linked, and the AAR was committed to a
   public repo to unblock CI. Publishing `glide-ffmpeg-decoder` with its build inputs is
   what makes the relink path real; committing a binary does not.

4. **Consume the decoder AAR from GitHub Packages (§4.3).** Removes the committed binary and
   restores 12.3's no-vendored-AAR rule, which 2.0.0 deliberately broke to stay buildable.

5. **Section 15, tests and guardrails.** The largest remaining bucket at 29 items, and the
   migration made it cheaper: `Geometry.kt` and `ColorEnhancement.kt` are pure and already
   carry 20 JVM tests between them, which is the pattern the rest should follow.

6. **Section 12 cleanup**, then 14 (iOS scope) and the rest as originally ordered.

Deliberately *not* next: A7's subtitle-cue swap, which was investigated and rejected — see the
migration plan. It is quality work behind three real blockers, not a defect.

Colour enhancement crushing HDR blacks *was* a defect, and not the one assumed. media3's own
shaders run at fp16 on the device and zeroed everything under 0.61 nits whenever any effect
was on. Fixed 2026-09-25 with `highp` overrides in `res/raw`, alongside the ICtCp shader that
replaced the HDR matrix (migration plan, *HDR enhancement moved to an ICtCp shader*). Both
were verified on device. Still open: a ~13% even darkening in screenshots, and GPU cost.
Those fold into item 1.

## 20. Primary references checked

- React Native 0.87 release and requirements:
  <https://reactnative.dev/blog/2026/08/11/react-native-0.87>
- React Native support policy/status:
  <https://reactnative.dev/releases/overview>
- Android PiP lifecycle:
  <https://developer.android.com/develop/ui/views/picture-in-picture>
- Android notification permission and media-session exemption:
  <https://developer.android.com/develop/ui/compose/notifications/notification-permission>
- Android Media3 background playback:
  <https://developer.android.com/media/media3/session/background-playback>
- Android audio focus, including target API 35 behavior:
  <https://developer.android.com/media/optimize/audio-focus>
- Android shared-media permissions:
  <https://developer.android.com/training/data-storage/shared/media>
- Android 14 selected photo/video access:
  <https://developer.android.com/about/versions/14/changes/partial-photo-video-access>
- Android cleartext risk and network security config:
  <https://developer.android.com/privacy-and-security/risks/cleartext-communications>
- Android app versioning:
  <https://developer.android.com/studio/publish/versioning>
- Android unknown-source install APIs:
  <https://developer.android.com/reference/android/content/pm/PackageManager#canRequestPackageInstalls()>
  and <https://developer.android.com/reference/android/provider/Settings#ACTION_MANAGE_UNKNOWN_APP_SOURCES>
- Android 16 KB page-size guidance and zipalign:
  <https://developer.android.com/guide/practices/page-sizes> and
  <https://developer.android.com/tools/zipalign>
- Media3 releases:
  <https://developer.android.com/jetpack/androidx/releases/media3>
- FFmpegKitNext:
  <https://github.com/arthenica/ffmpeg-kit-next>
- RN built-in edge-to-edge migration note:
  <https://github.com/zoontek/react-native-edge-to-edge>
- `react-native-config` packaged-value warning:
  <https://github.com/react-native-config/react-native-config/blob/master/README.md>
- Groq production key guidance:
  <https://console.groq.com/docs/production-readiness/security-onboarding>
- Stallion production rollout/rollback guidance:
  <https://stalliontech.io/learn/docs/sdk/production-usage>
