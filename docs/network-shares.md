# Network shares (SMB)

Written for: the next agent session working on SMB, and the owner. Start here.
Started 2026-10-27 on `main`. Backlog F ("SMB/WebDAV (L)"); `docs/android-tv.md` "Later".

## Decisions (owner, 2026-10-27) — do not reopen

- **Phones and TV both get it.** On TV every screen must be fully D-pad usable (AGENTS.md
  "Android TV"): reachable focus, visible focus state, shared primitives from `src/components/ui`.
- **Library: smbj 0.15.0** (Apache-2.0, SMB2/3.1.1, maintained; jcifs-ng has had no release since
  2023). **No SMB1.**
- **Known smbj slowness is fixed from day one:**
  - SMB3 signing (AES-CMAC) goes through the platform JCE/Conscrypt provider, not BouncyCastle's
    pure-Java AES (that capped a Cortex-A55 box at ~2 MB/s). BouncyCastle only if NTLM's MD4
    needs it.
  - Read-ahead: several async reads in flight (`File.readAsync`), each sized to the negotiated
    max read size. Reference: github.com/leonsuv/SMBTVPlayer (Media3 + smbj, a 2 MB window as
    8 parallel requests, ~14 MB/s on an S905Y4 over 5 GHz Wi-Fi).
- **Go/no-go in step (a):** an on-device throughput benchmark on the owner's Mi TV (Android 9,
  Amlogic) against their Windows PC. Target **≥ 12 MB/s sustained** (4K remux). If smbj can't
  reach it after the fixes, fall back to **libsmb2 over JNI** (what VLC uses; LGPL-2.1, shipped as
  its own `.so`). Explain the licence to the owner in plain words before choosing it.
- **Windows 11 24H2 Pro requires signing and blocks guest access:** always ask for
  username/password; guest is optional and may fail.
- **Credentials:** AES-GCM key in AndroidKeyStore, ciphertext in MMKV. Not Jetpack
  security-crypto (deprecated), no Tink.
- **Android 17 local network permission:** we target SDK 36, so `INTERNET` still grants LAN
  access. Don't declare `ACCESS_LOCAL_NETWORK` yet, but every SMB connect goes through one place
  where the runtime request will go when we target 37; then show "Allow nearby devices" rather
  than a timeout. Test the restriction on an Android 16 phone:
  `adb shell am compat enable RESTRICT_LOCAL_NETWORK com.glide.player`.
- **Playback:** a media3 `DataSource` (`BaseDataSource`) for `smb://` URIs, picked by a wrapping
  `DataSource.Factory` (everything else still goes to `DefaultDataSource`). Reused for sidecar
  `.srt` (`SubtitleConfiguration`) and thumbnails (`FrameExtractor.Builder.setMediaSourceFactory`
  with a `DefaultMediaSourceFactory` on our factory). One pooled smbj session per server;
  reconnect on drop; media3's load-error retries do the rest.
- **UI:** "Network" in the TV rail and on phones. Add a server by IP (NetBIOS names don't resolve
  on Android; `.local` only on Android 12+). Browse folders live (not merged into the Videos
  library yet), same rows/cards/focus as local. History and Continue watching keyed by the
  `smb://` path. "Can't reach <server>" + Retry when it drops.

Owner, 2026-10-27, on the step (a) plan:

- (a) asks for the share name (`\\<ip>\<share>`); listing shares comes in (b).
- The speed test is an in-app button for now. **Remove it before the release that ships SMB.**

## Steps

Reordered by the owner, 2026-10-27: finding servers first, as VLC/Kodi/Nova do (a list of
servers on the network, sign in, pick a share; typing an IP is the fallback).

- **(a) Done** (`fe7a7d4`): add a share by IP + share name + login, list folders, play, speed test.
- **(b) Finding servers:** done; checked on the phone, TV pass pending. Plan below; see Status.
- **(c) Browsing:** done; checked on the phone, TV pass pending. The library's rows/cards,
  thumbnails, sidecar subtitles.
- **(d) TV sign-in from the phone:** done; checked on the phone standing in for the TV, TV pass
  pending. The TV shows a QR code for a page the TV serves itself on the LAN; the phone's keyboard
  fills in IP/username/password. Plain http on the home network (like a router's page); the UI says
  so.
- **(e) Done:** Resume/Recents, connection drops ("Can't reach <server>" + Retry), Android 17
  permission; checked on the phone, and Recents/resume on the TV. See Status. Same step: app streams (Stremio etc. "Open with" `http(s)`) go to Recents too, both loosen the
  same two skips (the view count in `VideoPlayerScreen`, `incrementViewCount`).
  - Save the sender's `external.headers` on the entry and send them on replay; `secureUri` entries
    never show the link.
  - Addon links last: Torrentio hands out `/resolve/<debrid>/…`, which 302s to a fresh debrid link
    on every request (`RESOLVED_URL_TTL` 3 h), so the saved URL works while the account does.
  - Skip `127.0.0.1` / `localhost` (Stremio's own torrent server, gone once Stremio closes) and
    unresolved `content://` (the grant ends with the task stack).
- Later, maybe: merging network videos into the Videos library.

### Step (b) plan: finding servers

- **Where it lives on phones** (owner: five bottom tabs feel crowded). Proposed: take Network
  off the phone tab bar and put a "Network shares" row at the top of the Videos folder list (VLC
  keeps network under "Browse" the same way). TV keeps its rail entry. Owner agreed 2026-10-27.
- **Discovery**, shown as a live list with the saved servers above it:
  - mDNS `_smb._tcp` via `NsdManager` (NAS boxes, Macs, Samba).
  - Windows doesn't advertise over mDNS. Use WS-Discovery (UDP multicast 239.255.255.250:3702,
    what Explorer's "Network" uses) to get the PC's name and IP; fall back to a quick port-445
    scan of the /24 if WS-Discovery finds nothing. Measure which works against the owner's PC.
  - All of it goes through the single connect gate in `Smb.kt` (Android 17 permission later).
- **Share list** via Rapid7 `smbj-rpc` (`com.rapid7.client:dcerpc` 0.12.13, BSD-3-Clause, June
  2025; NetrShareEnum over `IPC$`). It pulls Guava, commons-io and commons-lang3: measure the
  release APK; if it adds over ~1 MB after R8, hand-write the one call (~150 lines) instead.
  Hide admin shares (`C$`, `IPC$`, names ending in `$`).
- **Flow:** tap a found server (or "Add by IP") → username/password → pick a share → saved.
  Typing a share name stays as a fallback.

### Step (c) plan: browsing (read 2026-10-27)

- `NetworkFolderScreen` becomes a FlashList: films use `VideoRow`/`VideoCard` from
  `src/components/VideoRow.tsx` (they take path/name/meta, so `smb://` paths work), grid/list
  toggle like Videos, folders as rows with a folder icon (no peeking inside for a picture), natural
  name sort, TV focus on the first item. The `⋯` menu offers Play only (the rest is local-file).
- Thumbnails: `ThumbnailService` caches by path, unchanged. In `SimpleThumbnailModule`,
  `smb://` skips `MediaMetadataRetriever` (it throws on it) and goes to `FrameExtractor`, which in
  media3 1.11.1 has `setMediaSourceFactory` and `getThumbnail()`. The app sets a
  `DataSource.Factory` field on the module at startup (`SmbAwareDataSource.Factory`).
- Sidecar subtitles: `SubtitlePickerService.findMatchingSubtitles` lists the SMB folder
  (`SmbService.list`) instead of `RNFS.readDir`; `loadFromPath` reads through a new native
  `readText(uri)` (10 MB cap) and parses with the same `SubtitleParser`.
  - Found while writing (c): sidecar files only ever fed the haptics SDH search, which never runs
    for streams, so the above alone changed nothing visible. Owner, 2026-10-27: matching files
    next to *any* video (local or SMB) are now listed under the subtitle menu's Files tab ("Next to
    the video"), none turned on by itself.
- Embedded subtitles already render during playback through ExoPlayer; check on a real file.
  Whole-track extraction stays off over SMB (it reads the entire film).

## Testing against this PC

The owner's PC is Windows 11 Home on 5 GHz Wi-Fi with the network on the Public profile. Don't
change that. Make a temporary share instead: `scripts/smb-test-share.ps1 -Client <device ip>` (run
elevated; the owner clicks UAC) creates `C:\GlideTest` with a hard link to a film, a local
non-admin user `glidetest` with a random password (printed to `%TEMP%\glidetest.pw`), a read-only
share, and a firewall rule opening 445 to that one device. `-Undo` removes all of it. Drive the TV
with `adb shell input dpad keyevent …` (not plain `keyevent`: that's a keyboard source and text
fields keep its arrows). The owner's test film: `Spider-Man…1080p.10Bit.HEVC…mkv` on the Desktop.
Devices: Mi TV `192.168.1.33:5555` (2.4 GHz only); phone AIN065 over wireless debugging (its port
changes; the owner reads it off the Wireless debugging screen).

## What the code says (read 2026-10-27)

- **Player:** `GlidePlayerView.openMedia()` builds one `DefaultMediaSourceFactory(DefaultDataSource.Factory(context, httpSource))`.
  The SMB-aware factory wraps that `DefaultDataSource.Factory`. `isLocalUri` already treats `smb` as
  network (`WAKE_MODE_NETWORK`).
- **Other native readers of the video URI:** `EmbeddedSubtitles.read` makes its own
  `DefaultDataSource` (embedded track list/extract), so it has to use the same factory in (b).
  `EmbeddedSubtitles.isNetwork` (http/https only) skips whole-file reads; add `smb`. Credits skip
  non-local URIs already. Haptics (`HapticAnalysis`, via `SubtitleSyncModule.decodeAudio` and
  `MediaMetadataRetriever`) can't open `smb://`; errors are caught, so haptics are off over SMB.
- **Sidecar subtitles are not media3's:** they are found with `RNFS.readDir` next to the video
  (`SubtitlePickerService`) and parsed in JS into a full cue list (haptics and subtitle delay need
  it). So in (b) a sidecar `.srt` is read over SMB into the cache and handed to the same JS
  parser; `SubtitleConfiguration` is not used.
- **Thumbnails:** `libs/react-native-simple-thumbnail` is its own Gradle module and can't see app
  classes. In (b) the app hands it a `DataSource.Factory` at startup (a settable field on the
  module), and `FrameExtractor` uses it.
- **JS:** `NavigationService.isNetworkStream` turns off recap, bookmarks and next/previous for
  streams. History and resume follow `isReplayable` in `videoHistoryStore` instead (step (e)).
- **Shares:** smbj can't list a server's shares (that's DCE/RPC `srvsvc`). (a) asks for the share
  name; listing is decided in (b).
- Native changes bump `GlideNativeModule.API_LEVEL` (17 now). Release builds are minified: check smbj
  keep rules on a release build.

## Status

**2026-10-27: step (a) written, not yet measured.** tsc clean, jest 34 suites pass, the release APK
builds with R8 (+1.5 MB) and runs on the Mi TV; the Network rail entry shows.

- `android/.../smb/`: `SmbSecurity` (platform crypto; AES-CMAC on AES/CBC, RFC 4493 vectors in
  `AesCmacTest`), `Smb` (session pool, the single connect gate, `Secrets`), `SmbDataSource`
  (read-ahead, default 8 × 1 MB) and `SmbAwareDataSource.Factory` in the player, `SmbModule`
  (`GlideSmb`: encrypt, setServers, list, speedTest). API level 18.
- smbj facts: 0.15.0's `File.readAsync` is package-private, so read-ahead is blocking reads on a
  thread pool (each is its own request on the wire). smbj's JCE provider already has MD4 and the
  KDF; BouncyCastle stays on the classpath only because NTLM uses one of its array helpers.
- JS: `SmbService` (MMKV `glide_smb_v1`, password sealed), `NetworkScreen` (tab + `NetworkFolder`),
  `smb://` counts as a network stream (no history/resume yet, step (e)).
- Speed test: the activity button on a folder tests its largest video, 20 s per setup
  (1 × 1 MB, 8 × 256 KB, 8 × 1 MB, 8 × 1 MB on BouncyCastle). `node scripts/smb-bench.js`.

TV check of the add-share sheet (2026-10-27), with `adb shell input dpad keyevent …`. Plain
`input keyevent` is a *keyboard* source, and Android's TextView keeps keyboard arrows inside a
text field, so it wrongly looks as if the D-pad can't leave a field. Findings, fixed:
- No field had focus on TV (autoFocus was phone-only): the IP field now takes it.
- Connect was disabled until IP and share were filled; a disabled button can't take TV focus, so
  the D-pad stopped at Domain. It is always enabled now and says what's missing.
- The keyboard's ✓ moves to the next field (last one connects).
- Known: the TV keyboard covers the lower half of the sheet while typing; ✓ to move on.

**2026-10-27, first measurement (Mi TV → owner's PC, Win 11 Home, SMB 3.1.1, signing on):**

| Setup | MB/s |
|---|---|
| 1 × 1 MB | 3.2 |
| 8 × 256 KB | 3.2 |
| 8 × 1 MB | 3.3 |
| 8 × 1 MB, BouncyCastle | 2.9 |
| raw link, `adb push` 100 MB, no SMB | 2.8 |

The network is the ceiling, not smbj: the TV is on the **2.4 GHz** network (FTTH-RAILWIRE,
channel 1, 65 Mbps link), the PC on the separate 5 GHz one. SMB already matches the raw link, so
the go/no-go is **not decided**: it needs the TV on 5 GHz or Ethernet. (A 100 Mb Ethernet port
tops out near 11 MB/s.) Playback of a 1080p HEVC film (2.9 GB, ~0.3 MB/s) over SMB worked:
playing, ~50 s buffered, seeks recover and refill at ~5× real time. The test share, account and
firewall rule were made by a script and removed after.

Owner, 2026-10-27: the Mi TV has no 5 GHz Wi-Fi. Over Wi-Fi it can't reach the target with any
SMB library, so the go/no-go moves to a phone on 5 GHz (smbj's own ceiling on ARM), plus the TV
on Ethernet if available.

**2026-10-27, go/no-go: GO for smbj.** Phone (AIN065, Android 16) on 5 GHz (11ac, 526 Mbps link),
same PC and share, two runs:

| Setup | Run 1 | Run 2 |
|---|---|---|
| 1 × 1 MB | 11.5 | 9.6 |
| 8 × 256 KB | 16.0 | 14.5 |
| 8 × 1 MB | 14.5 | 14.7 |
| 8 × 1 MB, BouncyCastle | 12.6 | 9.8 |

Read-ahead is worth ~40% and platform crypto 15–50%; 256 KB and 1 MB chunks are within noise, so
`CHUNK`/`DEPTH` stay 1 MB × 8. (Plain `adb push` gave 6.6 MB/s and a single `nc` stream 9.7 MB/s:
both are weaker yardsticks than SMB's 8 parallel reads.) libsmb2 is not needed. The TV stays at its
2.4 GHz Wi-Fi ceiling (~3 MB/s) whatever the library; 4K remux on it needs Ethernet.

**2026-10-27: step (b) written, checks deferred by the owner to one pass on both devices.**
tsc clean, jest 34 suites pass, `ShareEnumTest` passes. API level 19 (`SMB_AVAILABLE` needs it).

- Phones: the Network tab is gone; a server icon in the Videos header, next to grid/list (owner,
  2026-10-27), opens `NetworkShares` (same `NetworkScreen`, with a back arrow). TV keeps the rail.
- "How it works" (`HowItWorks`): what the feature is for and three setup steps. Inline on Network
  while nothing is saved; always behind the header's info button.
- `Discovery.kt`: mDNS, WS-Discovery and the port-445 scan run together for ~3 s, always (a NAS
  found by mDNS mustn't hide a Windows PC only the scan sees). Names come from mDNS or the router's
  reverse DNS; WS-Discovery hits are kept only if 445 is open. Logcat `GlideSmb` logs
  `discovery: [ip by mdns|ws-discovery|scan]`: read it to see which method found the PC.
- Share list: **hand-written** `ShareEnum.kt` (NetrShareEnum level 1 over `srvsvc`, ~110 lines),
  not smbj-rpc: 0.12.13 is built against smbj 0.12.2 (we ship 0.15.0) and pulls desktop Guava.
  No new dependency, so no APK size check. An RPC failure after a good sign-in falls back to typing
  the share name.
- `Smb.gate()` is the single connect gate; `Smb.withLogin` signs in on a throwaway session.
- `scripts/smb-test-share.ps1 -Client <tv>,<phone>` opens 445 to both.

**2026-10-27, phone (AIN065, Android 16), debug-signed release build (R8), +4.5 KB APK:** passed.
- 4 tabs; the Videos entry opens Network; Back from the player lands on Videos.
- Discovery found the PC (192.168.1.37) in ~3 s with no name: the router has no reverse DNS.
  Found **by the port scan** (logcat `discovery: [192.168.1.37 by scan]`): the PC on a Public
  network answers neither mDNS nor WS-Discovery, as expected.
- Header icon and the info sheet checked on screen. The inline card (no saved shares) not yet.
- Header order: grid/list, then Network (owner). "Searching…" uses Android's spinner
  (`ActivityIndicator`), not Feather's iOS-style `loader` icon.
- **Sheets now rise with the keyboard** (owner: the sign-in sheet's fields were hidden). A
  `Modal` is its own edge-to-edge window, so `adjustResize` doesn't resize it and Reanimated's
  `useAnimatedKeyboard` (tried; watches the activity's window) never moves. `KeyboardInsetView`
  (native, in the Modal's window) reports the IME inset each frame; `Sheet` sits on it and
  shrinks below the status bar. Applies to every `Sheet`. Checked on the phone: rises, drops back,
  a back swipe closes only the keyboard. (`adb shell input keyevent 4` closes the sheet too: an
  injected key, not what a user's Back does.)
- Wrong password → "Wrong username or password". Right one → share list shows `GlideTest` only
  (NetrShareEnum works through R8; `IPC$`, `C$`, `ADMIN$` hidden) → saved → folder → plays.
- Not tried: "Add by IP", and a server that won't list its shares.

**2026-10-27: step (c) written and passed on the phone** (AIN065, debug-signed release build,
+5 KB APK). tsc, eslint (no errors), jest 34 suites, Gradle unit tests pass. API level **20**
(`GlideSmb.readText`, `SimpleThumbnail` reads `smb://`); `SMB_AVAILABLE` needs 20.

- `NetworkFolderScreen`: films in a FlashList of `VideoRow`/`VideoCard`, grid/list toggle (grid
  by default on TV), size as the meta line; subfolders as `ListRow`s above them (FlashList header);
  natural sort; TV focus on the first folder, else the first film. `⋯`/long-press opens
  `VideoOptionsBottomSheet` with Play only (`onShare`/`onDelete` are optional now; the local-only
  metadata probe is skipped for `smb://`).
- Thumbnails: `SimpleThumbnailModule.dataSourceFactory` (set in `MainApplication` to
  `SmbDataSource`). `smb://` gives `FrameExtractor` a `DefaultMediaSourceFactory` on it, and
  `MediaMetadataRetriever` a `MediaDataSource` (`Windowed`) for the film's length, so the frame is
  10% in as for local files. Why: `FrameExtractor.getThumbnail()` only knows an MP4's thumbnail
  time and otherwise takes frame 0 (black, rejected by `FlatFrame`). `Windowed` opens once
  unbounded (size + header), then reopens a 1 MB window at each jump instead of the full 8 MB
  read-ahead. First thumbnail of the 2.9 GB MKV took ~10–15 s on the phone; cached after.
- Sidecar subtitles: `usePlayerTracks` lists matching files when the player opens (local and
  SMB), `source: 'beside'`.
- Phone checks, with screenshots: list and grid, thumbnails (a real frame, also in `Extras/` with
  a space in the file name), `⋯` → Play + Details only, plays; built-in subtitles render (the
  film's English track); `Spider-Man.srt` next to it shows under Files as "Next to the video" and
  renders in sync.
- (b) leftovers: removing the only share shows the "How it works" card; "Add by IP" signs in,
  lists `GlideTest`, saves. "Type the share's name" checked with a throwaway build whose
  `listShares` returned nothing (not committed): the field shows, a wrong name says "No share by
  that name on 192.168.1.37", `GlideTest` connects and opens the folder.
- Seen, not changed: the share field there doesn't raise the keyboard by itself (`autoFocus` when
  the sheet swaps content); Google Password Manager offers to save the SMB login after "Add by
  IP" (Android autofill sees a username + password form).
- `C:\GlideTest` now also has `Spider-Man.srt` and `Extras\Spider-Man Clip.mkv` (a second hard
  link); `-Undo` deletes the folder recursively.

**2026-10-28: step (d) written and passed on the phone** (AIN065, debug-signed release build, phone
standing in for the TV). tsc, eslint (no errors), jest 34 suites, Gradle unit tests pass. API level
**21**; the phone sign-in needs 21, the rest of SMB still 20. zxing `core` 3.5.4 (Apache-2.0, no
dependencies): R8 keeps 17 encoder classes.

- `PhoneSignIn.kt`: while the TV's sign-in sheet is open (found server or "Add by IP"), a
  `ServerSocket` on the TV's LAN address (`Discovery.ownAddress()`, shared with the port scan), a
  random port and an 8-character token in the path (no `x`: the app's font draws `9x2` as `9×2`);
  other paths 404. It serves a small form (IP only when the TV doesn't know it), and each POST
  arrives in JS as the `GlideSmbPhoneLogin` event. A thread per connection: browsers open spare
  connections and send nothing. Stopped when the sheet closes.
- The sheet (TV only, `PHONE_SIGN_IN`): QR (PNG data URI) beside "Sign in from your phone", the
  URL as text, and the unencrypted note. A login from the phone fills the fields and signs in, so
  a wrong password shows on the TV and the QR stays for another try; the share is picked on the TV.
  The remote's own fields stay.
- Fixed on the way:
  - smbj reuses its connection to a server while the socket looks open, and Windows closes it
    after a failed sign-in: the next sign-in failed with "Can't reach" (reset, broken pipe).
    `Smb.connect` now closes the connection when sign-in fails.
  - The sign-in sheet reopened on the last visit's share list (it was keyed by host); it now
    starts fresh each time it opens.
  - Keyboard (the (c) note): RN's autoFocus asks for the keyboard once, straight after focusing,
    and Android drops it while the window has no keyboard attached: a sheet opening, or the
    swap to the share field (RN blurs the unmounted field, which hides the keyboard). Seen in
    `dumpsys input_method`. `KeyboardInsetView` (in every sheet's window) now raises it through
    the window's insets controller when a field takes focus or the window gains focus with one,
    phones only (API 30+): the sheet's first field and the share field both raise it now. Domain's
    and Share's go key keep focus (`submitBehavior="submit"`) like the other fields.
  - Google Password Manager no longer offers to save the login (`importantForAutofill="no"`).
- Phone checks, with screenshots, on a throwaway build (not committed) that showed the TV's QR
  section on the phone and returned no shares for `GLIDETEST`: the QR in a screenshot decodes to
  the URL shown (zxing); Playwright on this PC opened it, sent the login, the phone signed in,
  listed `GlideTest`, opened it; a wrong token gets 404; after the sheet closes the port refuses;
  wrong password from the page shows "Wrong username or password", then the right one signs in.
  The real build: no QR section on the phone; Add by IP signs in and saves with no save-password
  prompt; the keyboard rises with the sheet; a back swipe still closes only the keyboard.
  `PhoneSignInTest`: the QR reads back, and a real HTTP round trip (form, POST with `&`, `=`, `é`,
  404, closed after stop).
- Not done: the phone's page doesn't wait to hear whether sign-in worked (the TV shows it). Add a
  long-poll if that turns out to matter.
- The phone is now **192.168.1.43** (DHCP). SMB from it works although the "Glide SMB test"
  firewall rule still lists .40 (raising the rule was refused at UAC); some other rule lets 445
  through on this PC. Not looked into.

**2026-10-29: step (e) written and checked on the phone** (AIN065, debug-signed release build),
Recents/resume also on the Mi TV. tsc, eslint, jest 36 suites (new `historyStreams`), Gradle unit
tests pass. API level **22** (native changes; JS needs no new gate).

- History: `isReplayable(path)` (local, `smb://`, `http(s)` except `localhost`/`127.*`) entries are
  keyed by path, never matched by name, counted, shown in Recents. `content://` keeps the old hidden
  by-name entry; rtsp and Stremio's own server keep no history. App links save the sender's
  `headers` and `secureUri` on the entry; Recents and Continue watching reopen them with both
  (`replayParams`). In the external player a stream's start comes from the sender, not Glide's
  history, and gets no prompt; its progress still lands in Recents.
- Recents rows for shares/links: no Share or Delete; links have no folder in Details and no
  thumbnail (`ThumbnailService` skips http: without headers it would fetch a debrid link per
  frame).
- Saved logins go to native at app start, so a share's video opens from Recents in a fresh process
  (before, only the Network screen pushed them: "No login for host").
- Drops: the player card says "Can't reach <host>" for `smb://` with the existing Retry. Measured on
  the phone (Wi-Fi off mid-play, phone on USB): ~80 s of buffer plays out, then three native
  retries; the card is up ~94 s after the drop. Retry after Wi-Fi returns reconnects and plays on.
  No timeout change.
- Android 17: `Smb.gate()` throws `LocalNetworkDenied` when the OS is 17+, our targetSdk 37+ and
  `ACCESS_LOCAL_NETWORK` isn't granted: inert while we target 36. Network shows "Allow nearby
  devices" (discovery row, folder screen with "Open settings"); the player card says the same
  (`LOCAL_NETWORK_DENIED`, never retried) with Open settings. When targeting 37: declare the
  permission and request it before the first connect.
  - **The doc's compat-flag test doesn't work on this phone:** `RESTRICT_LOCAL_NETWORK` is listed
    but not enforced (no platform flag on this Android 16 build); with it on, Glide's UID still
    reaches 445 (probed with `run-as` on a throwaway debuggable build, which otherwise won't start:
    it looks for debug-only modules). The denial UI was checked with a throwaway build whose gate
    always throws (not committed).
- Found on the way: the resume prompt was still hidden for streams while its state paused the
  player, so a share's video opened from Recents sat paused with no prompt. One `noResume` now
  drives both.
- Phone checks, with screenshots: share film → Recents and Continue watching with its stop frame →
  cold start → plays from 0:33 with the prompt; `⋯` shows no Share/Delete; drop → card → Retry. App
  stream (`am start` with `headers`, `secure_uri`, `title`, served by a local Python server that
  logs headers): plays, every request carries the header; Recents shows "Test Stream" with no link;
  replay from Recents sends the header on every request; a sender `position` of 5:00 wins over the
  saved 0:32 with no prompt.
- TV checks: Continue watching shows the share's film with its stop frame, D-pad reaches it, the
  resume prompt opens focused on Resume, plays. Not tried on TV: the drop card (cutting its Wi-Fi
  drops adb; same card as on the phone, D-pad focus scope unchanged).
- The TV's saved GlideTest login was stale ("Wrong username or password"): most likely from the
  step (a) share, deleted and recreated with a new password. Signed in again through its phone
  sign-in page (POST from this PC).

**2026-10-29: share thumbnails fixed (measured).** API level **24**. Both devices on 2.4 GHz
(~3 MB/s); the 2.9 GB MKV's stop frame, one each:

| | Before (phone) | After (TV) |
|---|---|---|
| Stop frame (time given) | 470 s: retriever open 57 s, ExoPlayer timed out at 20 s, retriever fallback ~6.5 min | 4.0 s |
| Folder thumbnail (time 0) | — | 4.6 s (retriever 2.3 s, ExoPlayer 2.2 s) |

- `Windowed` reopened the file at every small step back of the retriever's parser (8343 → 8171):
  39 reopens of ~1.4 s just to open, hundreds as the fallback. It now keeps its 1 MB window in
  memory (starting 128 KB before the asked position) and answers from it: 5 opens.
- The retriever is opened only when needed: the smart scan's duration, or the fallback. A stop
  frame never needs it.
- Thumbnails read through `SmbDataSource(256 KB, 4)`: ExoPlayer opens a film 4 times per frame
  (header, cues at the end, first cluster, target), and playback's 8 × 1 MB read-ahead made that
  ~32 MB. `EXACT` seek kept: the target open is ~1 s.

**2026-10-29: speed test removed** (folder button, `GlideSmb.speedTest`, `Smb.security`,
`scripts/smb-bench.js`). API level **25**. BouncyCastle stays on the classpath for NTLM (above).

**Next:** the TV pass (owner: not yet). D-pad reaches every row, the refresh button, the sheet's
fields and the share list; focus shows. Read the `discovery:` log line there too. Step (c) on
TV: the grid opens focused on `Extras`, D-pad from the folder row into the cards and between them,
long-press/`⋯` from list view, thumbnails over 2.4 GHz (slow: ~3 MB/s), sidecar under Files.
Step (d) on TV: the sheet shows the QR and the URL; a real phone camera scans it from the sofa
and opens the page; the TV's URL uses its Wi-Fi address; the phone's login signs the TV in and the
share is picked with the D-pad; a wrong password shows on the TV, resend from the phone works; the
remote's fields still work beside it and D-pad focus never lands on the QR; the keyboard doesn't
pop up by itself when the D-pad moves onto a field; the share field takes D-pad focus. Android 9.
`smb-test-share.ps1` needs PowerShell 7 (`pwsh`); 5.1 has no `RandomNumberGenerator.GetInt32`.

**Test share left up for the TV pass (owner, 2026-10-27):** `\\DESKTOP-S4T6400\GlideTest`
(192.168.1.37), user `glidetest`, password in `%TEMP%\glidetest.pw`, firewall rule "Glide SMB test"
opening 445 to the TV (192.168.1.33, now .35 by DHCP) and the phone (192.168.1.40, now .43); SMB
works from the new addresses anyway. The TV already has the step (b)
build installed (not opened). Remove it all after the TV pass:
`pwsh -ExecutionPolicy Bypass -File scripts\smb-test-share.ps1 -Undo` (elevated).
