# Telegram videos

Written for: the next agent session working on Telegram playback, and the owner. Start here.
Started 2026-11-01 on `main`. Modelled on `docs/network-shares.md` (same shape: a remote byte
source behind a media3 `DataSource`).

## What it is

The user signs in to their own Telegram account inside Glide. Glide lists the videos in their
chats (Saved Messages first) and streams them: playback starts in seconds while the file is still
downloading, and a seek moves the download to the new spot. "Send it to the player" = forward a
video to your Saved Messages; it shows up in Glide.

No Glide server, no bot. Bytes go Telegram → device. Nothing to pay for (API ID, TDLib and
hosting are free). Users with Telegram Premium may download faster; that's their choice.

## Decisions (2026-11-01) — reopen only with the owner

- **User account through TDLib**, Telegram's official client library (BSL-1.0: fine for unlicensed,
  closed Glide). Not the Bot API: a normal bot can't download files over **20 MB**, and lifting that
  means running our own Bot API server that relays every film (bandwidth bill, legal exposure).
- **Phones and TV both get it.** D-pad usable everywhere (AGENTS.md "Android TV").
- **Sign-in: phones by phone number + code, TV by QR code** (scanned with Telegram on the phone: no
  typing on TV), then the 2-step password if the account has one. Each offers the other as "Use …
  instead". (Changed 2026-11-01: a phone can't scan its own screen, so QR-first is wrong there.)
- **Scope of the first release: private chats, groups and Saved Messages. No channels.** Telegram's
  API terms require official sponsored messages wherever an app shows channel content; skipping
  channels keeps us compliant without building that. Channels + sponsored messages = step (f),
  later, if wanted.
- **No channel search or discovery, ever** in this feature. Telegram is full of pirate film
  channels; the Play listing and the UI say "your videos from your chats". Keeps us clear of Play's
  copyright policy.
- **Not copying TMPlayer** (github.com/dracu-lah/TMPlayer): it's GPL-3.0. Its design is fine to
  learn from; its code is not to be pasted. Its `docs/ARCHITECTURE.md` (seek rules) is the reference.
- **TDLib build: our own AAR, built in a private CI repo**, the way `glide-ffmpeg-decoder` builds
  the FFmpeg AAR. TDLib's official Android build (`td/example/android/build.sh`) gives
  `libtdjni.so` per ABI + `TdApi.java`/`Client.java`. Pin one TDLib commit; record it here.
  Not TGX-Android/tdlib (its README: "not intended to be used in any projects except Telegram
  X"); not a community Maven/JitPack build (unknown upkeep, a supply-chain risk for a library that
  holds the user's Telegram session).
- **API ID/hash:** the owner registers Glide at my.telegram.org. Injected like the Stallion keys:
  `.env` locally, a CI secret in `android-ci.yml`, into a native `BuildConfig` field (not
  `JS_ENV`). It still ships readable in the APK, as with every Telegram client; that's expected.
  Builds without it hide the feature.

## Decisions (2026-11-02, ground-up re-plan) — reopen only with the owner

Session 3 on the phone showed three faults in the first design: films downloaded to their end
whether watched or not (2.16 GB cache after two films; the download even outlived the player),
the cache only shrank at app start, and the chat list couldn't tell which chats hold videos.
TMPlayer's answers (`TdByteWindow.kt`, `WatchCache.kt`, `ChatVideoCount.kt`) were read; where
Glide differs, the reason is given.

- **Chat list: only chats with videos, Telegram's order, Saved Messages first. No picker.**
  - Each chat is counted with `getChatMessageCount` (video filter, then document filter; TDLib's
    local figure first, free; the server only if TDLib doesn't know). A chat with documents but
    no video count gets one `searchChatMessages` page of documents checked for video files (MKVs
    are sent as files). 3 chats at a time, app-wide.
  - **Answers are saved (MMKV, by chat id)**, so a second visit shows the list at once; chats are
    re-counted quietly in the background, at most once a session. A chat Telegram can't answer
    for stays shown (never hidden by an error).
  - FLOOD_WAIT ≤ 60 s: that one call waits it out once; longer: unknown (shown).
  - One `searchMessages` page across all chats (`recent()`, 100 per filter, sent together) gives
    each chat's newest video: its row's second line, and those chats skip counting.
  - Too few chats with videos on screen (< 20): the next 100 chats are counted by themselves.
  - Rejected: TMPlayer's "Add chats" picker (a screen and a stored choice to maintain; the counts
    already answer the question); per-chat video searches, cross-chat paging, per-folder batches
    (slow, missed chats, FLOOD_WAIT stalls of 14 s in the logs).
- **Streaming: a bounded window, always (Wi-Fi too).** `downloadFile` asks for `max(8 MB,
  size / 64)` bytes from the read position (≈ 2 min of any film whatever its bitrate: size/64 of
  the bytes is duration/64 of the time) and is extended when reading gets within half a window of
  its end. Data used ≈ what is watched + ~2 min; seeks unchanged. No setting. TMPlayer bounds it
  only with "Save mobile data" on; Glide always, because an unbounded download fills the phone and
  hotspots and capped Wi-Fi are metered too.
- **Cache: one film.** Starting a film deletes every other film's streamed bytes (not offline
  saves, not thumbnails or chat photos); at app start all streamed film bytes go. Resume
  re-downloads from the resume point (seconds). The 4 GB cap goes. Settings "Clear Telegram
  downloads" stays (streamed bytes; offline saves have their own delete). The player cancels its
  download when it closes.
- **Offline saves ("Download" in the ⋯ sheet).** The whole film, TDLib priority below playback,
  `limit = 0`. Runs in a foreground service (`dataSync`, a progress notification with Cancel) so
  it survives leaving the app; one at a time, a queue after it. When complete, the file is
  **moved** (rename, same volume) from `cacheDir/tdlib` to
  `filesDir/telegram/<chatId>_<messageId>.<ext>` (Android may empty `cacheDir`; saves must not
  vanish) and recorded in MMKV (`tg://chat/msg` → path, name, size). Playing a `tg://` URI that has
  a save reads the file (`FileDataSource`), no network. Listed in a "Downloaded" section on
  Telegram home (above the chats) and marked on its row in the chat; ⋯ → "Delete download".
  Logging out deletes them. Any network: the user asked for it.
- **Prefetch stays** (first + last 2 MB on ⋯): it took the MKV first frame from 7.8 s to 2.7 s.
- **No Details metadata for `tg://`** (owner): reading it means downloading.
- **Chat videos screen stays** (search pages, paging only on a real scroll, "Look further").

## How it works

### Native (Kotlin, `android/app/src/main/java/com/glide/app/telegram/`)

- `Td.kt`: one TDLib `Client` for the process, started on first use.
  - `setTdlibParameters`: `database_directory` = `filesDir/tdlib` (the session lives here; never
    backed up: add it to the backup exclusion rules), `files_directory` = `cacheDir/tdlib`,
    `use_file_database`, `use_chat_info_database`, `use_message_database` = true,
    `use_secret_chats` = false.
  - Turns TDLib's `updateFile` into per-file listeners for the DataSource; auth state as an event
    for JS.
- `TelegramModule` (`GlideTelegram` for JS): `authState`, `requestQr` (→
  `requestQrCodeAuthentication`; the `tg://login?token=…` link is redrawn as a QR each time TDLib
  updates it), `checkPassword`, `phoneNumber`/`code` (fallback), `logOut`, `chats` (`loadChats`
  then the main list; Saved Messages = `createPrivateChat(getMe().id)` pinned first), `videos(chatId,
  fromMessageId)` (paged), `thumbnail(fileId)`.
- **Listing videos:** `searchChatMessages` twice per page: `searchMessagesFilterVideo`
  (`messageVideo`), and `searchMessagesFilterDocument` kept only when the mime type is `video/*` or
  the name ends in a video extension (MKVs are usually sent as files). Merge by date.
  Each row: name, size, duration (videos only: documents don't carry one), Telegram's thumbnail.
  **Never `FrameExtractor` for Telegram:** it would download part of the film per thumbnail.
- **URI:** `tg://<chatId>/<messageId>`. Stable across sessions; `file_id` isn't (it's per TDLib
  database). The DataSource resolves message → file id on `open()`.
- `TelegramDataSource` (`BaseDataSource`), picked for `tg://` by the same wrapping factory as
  `smb://` (`GlidePlayerView.kt` "smb:// to the network-share reader"):
  - `open(position)`: resolve file, size from `file.size` (or `expected_size`); if
    `[position, …)` isn't on disk, `downloadFile(file_id, priority=32, offset=position,
    limit=window, synchronous=false)`, extended as reading nears its end (Decisions 2026-11-02).
  - `read()`: how much is readable at `position` comes **only** from TDLib's numbers
    (`getFileDownloadedPrefixSize(file_id, position)`, or `local.download_offset` +
    `downloaded_prefix_size` from `updateFile`). Never the file's length on disk: the partial file
    has holes (tdlib/td#3262). Block the loading thread on the file's listener until bytes arrive;
    then read with a `RandomAccessFile` on `local.path`.
  - Read-ahead buffer (e.g. 64 KB) for tiny reads: Matroska reads its index one or two bytes at a
    time.
  - TDLib keeps **one active download per file**: the latest `downloadFile` wins. No debounce for
    fast seeks.
  - `close()`: nothing destructive. Network loss: TDLib reconnects itself; the read keeps waiting,
    media3's load-error retries and our "Can't reach" card cover the rest (time-out to measure).
- **Cache:** one film (Decisions 2026-11-02). Offline saves live in `filesDir/telegram`.
- Bump `GlideNativeModule.API_LEVEL`; JS checks it before showing Telegram (`TELEGRAM_AVAILABLE`).

### JS

- `TelegramService` (like `SmbService`): auth state, chat list, video pages. Nothing secret
  stored in MMKV (TDLib holds the session).
- Screens: entry next to Network (phones: in the Videos header next to the server icon; TV: rail
  entry). Signed out → sign-in screen (QR + "Use phone number instead"). Signed in → chat list
  (Saved Messages first, only chats with videos as they're found) → chat's videos, reusing
  `VideoRow`/`VideoCard`, grid/list, `⋯` → Play + Details.
- History, Recents, Continue watching keyed by `tg://` path (`isReplayable` gets `tg`).
- `NavigationService.isNetworkStream` treats `tg` as a stream (recap, bookmarks off as for SMB).
- Other native readers of the URI (from the SMB notes): `EmbeddedSubtitles.read` uses the same
  factory; `isNetwork` includes `tg` (no whole-file reads); haptics stay off; Credits skip it.

## Steps

- **(a) Spike + go/no-go.** Private repo builds the TDLib AAR (arm64-v8a, armeabi-v7a; check
  `nativeArchitectures`). API ID in `.env`. Debug screen: QR sign-in, play the newest video of
  Saved Messages through `TelegramDataSource`. Measure on the owner's Mi TV and phone with a
  ~2 GB MKV and an MP4: time to first frame, sustained MB/s on a free account (Telegram is
  reported to slow free accounts: measure), APK size per ABI after R8.
  **Go if:** first frame ≤ 5 s, a 1080p film plays without stalls on the phone over 5 GHz.
Re-planned 2026-11-01 with the owner: (b)–(e) become four sessions. Build everything first,
then **one** device session. Each session reads/edits a file once; automatic checks only (build,
unit tests, typecheck) until session 3. Step (a) already proved TDLib, streaming and speed.

- **Session 1, native (no device).** The whole `TelegramModule` in one pass: sign-in (phone +
  code on phones, QR on TV, each offering the other; 2-step password; errors: wrong code/password,
  flood wait "Try again in N minutes"; log out wiping `filesDir/tdlib` + cache; "Signed in as"),
  chats, videos (video + document, paged), thumbnails, MKV head+tail prefetch (`prefetch(uri)`,
  called when a film is opened/focused), cache cap + size + clear, `API_LEVEL` bump. Check:
  build + unit tests.
- **Session 2, JS (no device).** `TelegramService`, sign-in / chat list / chat videos screens
  (reusing `VideoRow`/`VideoCard`, empty states, paging), entries (phone Videos header, TV rail),
  Settings cache row, the `tg` flags (`isReplayable`, `isNetworkStream`, `isNetwork`, History,
  Recents, Continue watching). Check: typecheck + tests.
- **Session 3, one device session (phone + Mi TV).** Before it: phone on a fixed IP (DHCP
  reservation) or USB; test films in Saved Messages. Sign in **once** (Telegram rate-limits codes
  for hours; the session survives app updates). A script drives taps and seeks and prints one
  table from logcat (`open @`/`downloadFile @` lines); read the screen as text (`uiautomator
  dump`), screenshots only when something looks wrong. Covers the seek matrix, the MKV start, the
  Mi TV numbers from (a), D-pad focus everywhere; fix what breaks.
- **Session 4, paperwork.** Data safety, `privacy.html`, Play listing text, release notes.
Re-planned again 2026-11-02 (Decisions 2026-11-02). Each session ends with build + unit tests +
typecheck/jest; on the device the owner taps and the agent reads logcat.

- **Session A, streaming window + one-film cache (native).** `TgWindow`: bounded `downloadFile`
  and its extension rule, unit-tested with fake updates (the window extends before reads starve;
  a seek re-anchors it; end of file). `Td`: delete other films' bytes on open, all at start, drop
  the cap. Log time to first byte per `downloadFile`. Device: data for 5 min of the MP4 ≈ 5 min of
  bytes + one window; cache after two films = one film; the seek matrix incl. last 30 s, a deleted
  video, a network cut; MP4 long jumps (decide from the first-byte numbers).
- **Session B, chat list for good.** Saved counts (MMKV), background re-count. Device: time until
  the list is full on a first and a second visit, no `FLOOD_WAIT` beyond one wait, no chat with
  videos missing.
- **Session C, offline saves.** Foreground service + notification, queue, move into
  `filesDir/telegram`, MMKV record, `tg://` → file playback, "Downloaded" section, ⋯ Download /
  Delete download, logout wipe. Device: save on Wi-Fi, leave the app, airplane mode, play it.
- **Session D, Mi TV + D-pad**, then the NetworkScreen keyboard check (likely the same
  covered-buttons bug sign-in had).
- **Session 4 (paperwork)** as above, plus offline saves in Data safety.

- **(f) Later, maybe:** channels with sponsored messages (`getChatSponsoredMessages`, shown in the
  chat list, `viewMessages`/`clickChatSponsoredMessage` reported), forwarded-to-Glide shortcuts.

## Seek matrix (step (d) acceptance, from TMPlayer's targets)

| # | Case | Target |
|---|---|---|
| 1 | Seek 10 min ahead into an undownloaded part of a big MKV | resumes ≤ 4 s |
| 2 | Seek back into watched part | resumes < 1 s (from disk) |
| 3 | Ten fast alternating FF/RW presses | no crash, no stuck buffer, ends at the last position |
| 4 | MP4 with its index (`moov`) at the end | plays and seeks |
| 5 | Seek to the last 30 s | plays to the end, exits cleanly |
| 6 | Network cut during a seek | buffering shown; recovers when the network returns |

Ground truth by script, not by eye: a Gradle unit test drives `TelegramDataSource`'s window
logic with fake `updateFile` sequences (holes, offset jumps, out-of-order updates). On device,
`adb` + logcat timings.

## Risks and open questions

- **Speed on free accounts:** unknown until (a). If free accounts can't hold 1080p, say so in the UI
  ("Buffering: Telegram limits download speed") rather than fight it.
- **TDLib on Android 8 TV boxes / 1 GB RAM:** TMPlayer targets a 1 GB stick, so it's doable; watch
  memory in (a).
- **APK size:** ~10–15 MB per ABI expected; Play's per-ABI split keeps the download down.
- **Play review:** a Telegram client is allowed (many are listed); keep the "your chats" framing
  and no discovery.
- **Account safety:** we use Telegram's own sign-in; never ask for anything by our own UI except
  the 2-step password TDLib asks for. Log out wipes `filesDir/tdlib` and the cache.

## Owner to-do

- [x] Register the app at my.telegram.org (API development tools): app title "Glide", platform
      Android. Put `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` in `.env` and as GitHub secrets.
- [x] Create the private `glide-tdlib` repo (or say to reuse the FFmpeg one's pattern under a new
      name).
- [ ] A test account or your own, with a few films in Saved Messages: a ~2 GB MKV, an MP4 with
      `moov` at the end, a short video sent as "video".

## Status

**2026-11-01: plan written.**

**2026-11-01: step (a) part 1, the TDLib build.** Private repo `Pranav-pradeep0/glide-tdlib`
(local `C:\glide-tdlib`, branch `main`), workflow "Build TDLib" (manual). Pins in its
`build.properties`: TDLib **1.8.69** at `0e88653dcbf4e44c73cb655a05b58cd749a91169`, NDK
27.1.12297006 (Glide's), OpenSSL 1.1.1w static, API 26, `arm64-v8a armeabi-v7a`. It runs TDLib's
own `td/example/android` scripts, patched only to add `ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES` (16 KB
pages, checked), then packs `glide-tdlib-release.aar` (+ `.sha256`): `jni/<abi>/libtdjni.so`,
`classes.jar` (`Client`, `TdApi`), `proguard.txt` keeping `org.drinkless.tdlib.**`.
`TELEGRAM_API_ID`/`TELEGRAM_API_HASH` go `.env` → `BuildConfig` (0/empty = hidden); CI writes them
from secrets of the same names.

**2026-11-01: step (a) parts 2–3.** Committed: `TgWindow` (the download window, no TDLib types)
and `TgWindowTest` (10 fake-`updateFile` cases, pass): step 3 done. **Written, not committed**
(needs the AAR to compile): `Td.kt`, `TelegramDataSource.kt`, the `tg://` branch in
`SmbAwareDataSource` (`smb/SmbDataSource.kt`), `Td.init` in `MainApplication`,
`PhoneSignIn.qrBitmap`, the debug-only `TelegramDebugActivity` (+ `src/debug/AndroidManifest.xml`),
the `files("libs/glide-tdlib-release.aar")` dependency, the AAR `sha256sum -c` steps in
`android-ci.yml`, `.env.example`, and this doc. TdApi names checked against `td_api.tl` at the
pinned commit. glide-tdlib run 1 built TDLib but failed its own 16 KB check on `armeabi-v7a`
(fixed: 64-bit only); run 2 is `41300091949`.

**2026-11-01: step (a) part 2 committed.** Run `41300091949` green; its AAR (+ `.sha256`) is
committed in `android/app/libs` like the FFmpeg one (`.gitignore` exception: CI checks it). Only
fix needed against the real `TdApi`: none (one Kotlin return-type slip in the debug screen).
Debug and R8 release builds pass.

**2026-11-01: step (a) part 4, measured on the phone. GO.** Nothing Phone (AIN065), 5 GHz Wi-Fi,
free account, debug screen, every run from a cold cache:

| Film | First frame | Download | Stalls |
|---|---|---|---|
| Gone Girl, 1.9 GB 1080p 10-bit HEVC MKV | 5.9–6.2 s (7–8.5 s first play in a process) | 2.8–2.9 MB/s | 0 in 90 s |
| Spartacus S01E01, 529 MB MP4 | 1.0 s | 4.1–4.2 MB/s | 0 |
| 26 MB clip sent as video | 5.5 s | 1.4 MB/s | 0 |

- RAM, whole app while playing: 150–190 MB.
- APK per ABI after R8: `libtdjni.so` 17.6 MB arm64 / 15.6 MB armv7 (stored uncompressed; ~8.7 /
  8.4 MB in the download) + `TdApi` dex 1.3 MB (0.4 MB compressed). So **~+9 MB download, +17–19 MB
  installed** per ABI.
- Verdict: 1080p plays without stalls (download ~1.7× the film's average bitrate). First frame
  meets ≤ 5 s for MP4 but not MKV: Matroska needs two fetches before the first frame (header, then
  the Cues at the end; logcat `open … @ 2025065804`), each ~3 s from that file's DC. Go anyway;
  the MKV start is a step (d) target. Idea: start fetching the head and the tail when the film is
  focused/opened (details, `⋯`), before Play is pressed.
- Bug found and fixed: `deleteFile` during a download unlinked the partial file while TDLib kept
  writing into it and counting the bytes; the next play failed with ENOENT. `Td.delete` cancels
  first; `Td.open` restarts a download TDLib lists but the cache no longer has (Android also
  clears `cacheDir` on low storage).
- `TelegramDataSource`/`Td` log each `open @ position` and `downloadFile @ offset` (debug level):
  the step (d) seek matrix reads its timings from these.
- **Mi TV: not measured yet** (owner: later). The debug screen shows the QR on TV.

**2026-11-01: session 1 (native) done.** `TelegramModule` (`telegram/TelegramModule.kt`,
registered in `GlidePlayerPackage`), `API_LEVEL` 26. Unit tests `TgTest` (paging, error wording,
video documents) + `TgWindowTest` pass; debug and R8 release builds pass. Not run on a device.
What session 2 calls (`NativeModules.GlideTelegram`; every failure rejects with code `telegram`
and a message fit to show):

- Constant `available` (false: no API ID in this build; hide the feature).
- `start()` → sign-in state; then event `GlideTelegramAuth` with each new state. States:
  `starting`, `phone`, `code` (+ `phone`, `sentTo` `telegram`/`sms`/`other`), `qr` (+ `link`,
  `qr` PNG data URI, renewed by TDLib: redraw on each event), `password` (+ `hint`), `ready`
  (+ `name`, `phone`: "Signed in as"), `loggingOut`, `unsupported` (+ `what`: Telegram wants an
  email or sign-up; say "finish in the Telegram app").
- `phoneNumber(n)`, `code(c)`, `password(p)`, `requestQr()` (from `phone`/`code`/`password`).
  **QR → phone is `logOut()`**: TDLib can't leave the QR state, so it wipes and restarts at `phone`.
- `logOut()`: signs out, deletes `filesDir/tdlib` + `cacheDir/tdlib`, ends at `phone`.
- `chats(limit)` → Saved Messages first (`saved: true`), then the main list minus channels and
  secret chats: `{ id, title, saved, group }`. Page by asking a bigger `limit`.
- `videos(chatId, from, limit)` → `{ items, next }`, newest first; `next` 0 at the end (never an
  empty page with more to come). Item: `{ uri: "tg://chat/msg", name, size, duration (0 for
  files), width, height, date (ms) }`.
- `poster(uri)` → `file://` path of Telegram's own thumbnail, or null (session 2: by URI, so
  Recents and Continue watching get it through `ThumbnailService` too; chat photos dropped).
- `prefetch(uri)`: head + tail 2 MB each at low priority, latest call wins; stops once the film
  plays. Call on details/`⋯`, or after a short focus dwell on TV (not on every focus move).
- `cacheSize()` (bytes), `clearCache()`. The cap (min(4 GB, a quarter of free space)) is applied
  each time TDLib reaches `ready`.

Skipped, add if session 3 shows the need: resend code (`resendAuthenticationCode`), deleting a
film's download when playback ends (the cap covers it), `deleteFile` while playing on Clear
(Settings isn't reachable mid-film).

**2026-11-01: session 2 (JS) done.** `TelegramService`, `screens/TelegramScreen.tsx` (sign-in,
chats, `TelegramChatScreen`), routes `TelegramHome`/`TelegramChat` (phones, from the Videos
header's paper-plane icon) and the `Telegram` rail page (TV). Sign-in: TV asks for the QR at
once; phones start on the number. Chats: Saved Messages always, then each of the first 100 chats
probed in turn for a first page of videos (shown as found; kept for opening the chat). `tg`
added to `isNetworkStream`, `isReplayable` (History, Recents, Continue watching follow),
`EmbeddedSubtitles.isNetwork`; `ThumbnailService` answers `tg://` with `poster`; the ⋯ sheet
skips metadata and folder for `tg://` and calls `prefetch`. Settings > Storage: "Clear Telegram
downloads" with the size, shown once Telegram was used. Typecheck, jest (36 suites), native unit
tests pass.

Left for session 3 to judge on device: whether the chat probe hits Telegram's flood limit on
big accounts (it stops quietly), TV focus prefetch (only the ⋯ sheet prefetches now; Play from
the grid doesn't), D-pad paths through sign-in.

**2026-11-02: session 3 (device), first half.** Built and installed (release, Log.d/i kept):

- Home: chats as Telegram lists them (`chats(limit, folderId)`, local), folder tabs from
  `updateChatFolders` (swipe; TV: chips), round chat photos, last-message date + preview, Continue
  watching, Saved first, channels hidden, "load 100 more" on a real scroll.
- Telegram calls on their own 8-thread pool; thumbnails and chat photos download by callback.
- Chat videos: paging only on a real scroll + "Load more"; `videos()` searches ≤ 3 pages a call.
- Sign-in restyled (autofill; `KeyboardAvoidingView`: `adjustResize` fails edge-to-edge).
- Player: `tg://` `DefaultLoadControl` 1000/2000 ms; the seek bar's loading line covers the first
  load (no centred spinner: owner).
- `recent()` (`Td.sendAll`: 2 searches in one round trip; 200 messages in ~1.0 s) and
  `hasVideos(chatId)` with a JS queue (3 at a time, session map): the first half of the chat list
  decision; not yet judged on the phone. Saved counts not built.
- **Bug fixed:** a film's `downloadFile(limit = 0)` kept running after the player closed, and Clear
  can't delete a file still downloading (cache 2.16 GB; 833 MB right after Clear).
  `Td.stopStreams()` cancels them on player release and before Clear.

Seek results (logcat, after the 1000 ms buffer):

| Case | MP4 2.0 GB (~226 KB/s) | MKV 570 MB (~58 KB/s) | Target |
|---|---|---|---|
| First frame | 0.4 s (head on disk) | **2.7 s** (was 7.8) | ≤ 5 s |
| Jump ahead | 3.4 / 5.9 / 6.8 s ✗ | 1.8 / 3.1 / 2.7 / 3.1 s ✓ | ≤ 4 s |
| ±10/20 s taps | 0.1–0.5 s | 0.1–0.4 s | < 1 s |
| Fast scrub, jump back | ✓ | ✓ | |
| Last 30 s, deleted video, network cut | not run | not run | |

The MP4's long jumps miss: it needs ~4× the bytes per second. Unknown yet whether the time goes
to TDLib's first byte or to the amount: Session A logs time to first byte and decides.

**2026-11-02: Session A done (streaming window + one-film cache).**

- `TgWindow`: `downloadFile(offset = read position, limit = max(8 MB, size/64))`, moved when
  reading is within half a window of its end, or goes back before its start (a seek re-anchors);
  cut at the end of the file. `TgWindowTest` 13 cases pass (extends before reads starve, seek
  re-anchors, end of file, smallest window).
- `Td`: opening a film deletes the bytes of every other film streamed or prefetched this run; at
  `ready`, `optimizeStorage` drops all videos/documents (last run's films; thumbnails and chat
  photos stay). 4 GB cap gone. `stopStreams()` on player release kept. Log
  `first byte <file> @ <offset> in N ms` per `downloadFile` (first part, ≤ 1 MB).
- **Bug fixed:** Settings' size used `getStorageStatisticsFast`, which leaves out partly
  downloaded films (6.2 MB shown, Android's App info cache 130 MB). Now `getStorageStatistics`.

Phone (Nothing Phone, 5 GHz Wi-Fi), 2 GB MP4 (window 31.6 MB):

| Check | Result |
|---|---|
| Data for 5.5 min of playback | 143 MB (≈ 95 MB watched + 31.6 MB window + a short film), extended every ~60 s before reads starved, no stall |
| Cache after two films | 130 MB = the second film + thumbnails ✓ |
| Jump ahead (request → playing) | 3.4 / 3.6 / 4.0 / 4.3 / 4.6 s; 6.3 s and 13.6 s after two requests in a row |
| Back into the watched part | 0.03–0.3 s ✓ |
| Fast taps | no crash, no stuck buffer ✓ |
| Last 30 s | 4.7 s, played to the end, ended cleanly ✓ |
| Deleted video | "file moved or deleted" (`FILE_NOT_FOUND`), no hang ✓; TDLib drops its bytes itself |
| First frame from the list (no prefetch, `moov` at the end) | 6.9 s (head 3.2 s + tail 3.4 s) |
| Network cut | not run (would drop wireless adb; owner: fine) |
| MKV | not re-run; session 3's 1.8–3.1 s stands |

**MP4 long jumps, decided:** the time is TDLib's first byte at the new offset (2.8–4.7 s); once
it lands, playback starts in 0.1–0.6 s, so the amount of data isn't the cause and no window
change helps. Accept ~4 s as Telegram's floor. The outliers come from a second `downloadFile` to a
new offset within ~0.1 s of the first (scrub, then the exact seek): TDLib seems to finish the
first. If it matters later, a short debounce of new offsets is the lever (reopens "no debounce").

**2026-11-02: Session C (offline saves) built; offline test pending (owner, by cable).**

- Native `telegram/TgSaves.kt`: queue (one at a time), `TelegramSaveService` (`dataSync`, progress
  notification + Cancel, stops itself when the queue empties; Android 15 `onTimeout` cancels).
  Whole film via synchronous `downloadFile(priority 1, limit 0)`; done → `renameTo`
  `filesDir/telegram/<chatId>_<messageId>.<ext>` + `deleteFile` so TDLib forgets its copy. The
  file name is the record native reads; JS keeps name/duration in MMKV (`save:<uri>`).
- `TelegramDataSource` reads a saved film straight from the file (no TDLib, no network).
- Saving while playing: TDLib keeps one download per file, so the player's window runs to the end
  of the file (`limit 0`) for a film being saved; the save shows complete as soon as TDLib says so
  and moves the file once the player closes. Films being saved are never evicted by "one film".
- Module: `saves()`, `save(uri, name)`, `unsave(uri)` (cancel or delete), `deleteSaves()`, event
  `GlideTelegramSaves`. Logging out wipes saves.
- UI (owner's calls this session): a **Downloaded tab** on Telegram home (always shown, second
  after All, so tabs never shift); ⋯ sheet Download / Cancel download / Delete download; row label
  "Downloaded" / "Downloading 34%"; **player top bar Download button** (ring fills with eased
  progress, then a tick over the line, YouTube-style); Settings: "Clear Telegram cache" (renamed:
  streamed bytes) + "Delete downloaded films" with their size. Telegram Continue watching ⋯ opens
  the sheet.
- Owner, decided: **no cache-size setting or cleanup rules** (saves are the user's control);
  **Clear watch history doesn't delete downloads** (separate buttons).
- Checked on the phone: save while playing completes and shows the tick; saved film replays from
  the file (`open … (saved)` in logcat).
- **Offline test (owner, read by cable afterwards):** a 499 MB film saved while it played (~3 MB/s,
  163 s; file moved 2 s after the player closed). Then, offline after an app restart: it resumed
  from the file and seeks across the whole film (start, 27 %, 73 %, 95 %, 99 %, back to 31 %) each
  opened at once, with no `downloadFile` at all. The 27 MB clip saved earlier played offline too.
  Not visible in logs (no log lines): the notification, a queue of two, delete; owner to confirm.

**2026-11-02: Session B (chat list for good) built; measured on the phone 2026-11-03 (below).**

- Each chat's `hasVideos` answer is saved in MMKV (`has:<chatId>`; `recent()` hits saved as
  true), so a later visit shows the list from the saved answers at once. A failed count saves
  nothing and keeps the earlier answer; a chat with no answer at all stays shown. Logout forgets them.
- Each chat is re-counted once per app launch, in the background: chats with no answer first
  (they hold the list back), then the saved ones. "< 20 → next 100" waits only for chats with no answer.
- Unchanged: 3 at a time app-wide, FLOOD_WAIT ≤ 60 s waited out once, `recent()` hints (still run on
  every visit, so a new video's chat shows at once even if saved as "no videos").
- Logs: `chats <limit> folder <id>: N in M ms`, `hasVideos <id>: true|false in M ms`.
- To measure on the phone: time until the list is full on a first and a second visit, no FLOOD_WAIT
  beyond one wait, no chat with videos missing.
- **Measured 2026-11-03** (Nothing Phone, 207 chats; release build with `Log.d` kept for the test,
  `proguard-rules.pro` strips it otherwise): visit 1 of a launch, first 100 in 147 ms and all 40
  counted 0.9 s after the tap (slowest 478 ms); scrolling paged to 207 chats, 206 counted, 81 with
  videos, and the list showed exactly 82 rows (81 + Saved Messages): none missing. After an app
  restart: 131 ms, all 40 re-counted in 0.14 s. No FLOOD_WAIT anywhere. Not measured: a fresh
  sign-in with TDLib's cache empty (signing out deletes downloads).

**2026-11-02: Session 4 (paperwork); owner approved 2026-11-03, owner fills the Console.**

- `docs/privacy.html` (dated 2 November 2026): a Telegram row (phone number, code, 2-step password
  or QR; chat/video requests; device model, Android and Glide version as in Telegram's active
  sessions; straight to Telegram, not Glide's server), the session, chat list and downloads kept on
  the phone, "no Glide account; the only sign-in is your own Telegram account", the notification
  for download progress, sign out deletes the session and downloads. 2026-11-03: a Network shares
  row added (user name/password and requests go to the user's own PC/NAS; logins kept encrypted
  on the phone); "the only sign-ins are to your own network shares and Telegram account".
- `release-notes/3.1.0.txt` (406 chars, "chats, groups and Saved Messages"), from `v3.0.0..HEAD`.
  Version 3.1.0 (owner bumps package.json).
- **Data safety, what changes** (Console → App content → Data safety):
  - Collected: **Personal info → Phone number**. Optional, for account management (signing in to
    Telegram), not shared (it goes to Telegram because the user asks to sign in: Play's
    user-initiated exemption), encrypted in transit (MTProto). Not processed ephemerally: TDLib
    keeps the session.
  - Not collected: messages (chat titles, previews and video lists come *to* the phone, nothing of
    them is sent), photos and videos (downloaded, never uploaded), offline saves (on the phone only).
  - Deletion: signing out in Glide deletes everything Telegram-related on the device; the Telegram
    account itself is Telegram's (no Glide account to delete).
- **Other Console forms:** foreground service `dataSync` (`TelegramSaveService`) needs a
  declaration: "downloads a film the user chose to save for offline viewing, with a progress
  notification and Cancel"; a short video of ⋯ → Download and the notification.
- **Play listing, done 2026-11-03:** the owner's text, checked line by line against the code, is in
  `Desktop/glide-play-screenshots/store-listing.txt`. It names Telegram, so it goes live with 3.1.0.
  Short: "Play local media, stream SMB shares, and watch Telegram videos." Owner's rules: plain,
  factual (VLC style), no pricing or promo claims (Play discourages them: no "free, no ads"), no
  speed claims (Telegram sets download speed), phone-only features marked "on your phone".

**2026-11-03: TV install.**

- The Mi TV (MiTV-AXSO0, Android 9, `192.168.1.34:5555`, plain adb on 5555, no pairing) is
  **32-bit: `abilist` = `armeabi-v7a,armeabi`**. The build and the TDLib AAR carry both ABIs; a
  phone build made with `-PreactNativeArchitectures=arm64-v8a` doesn't install on it.
- TV build, from `android`: `./gradlew assembleRelease -PallowDebugSigning=true
  -PreactNativeArchitectures=armeabi-v7a` (debug key, same as the TV's install, so `adb install -r`
  keeps its data). Installed 8d14052 on the TV and the phone (shows 3.0.0, version not bumped yet).
- Release builds strip `Log.d`/`Log.i` (`proguard-rules.pro`), so the timing logs need a one-off
  build with that rule commented out; put the file back after.
- Sizes (fa4e269, estimated from the AAB): Play download ~27 MB armv7 / ~29 MB arm64; APK 50 / 61 MB.
  TDLib is 8.7 MB of the download, most of the growth since 3.0.0.

**2026-11-03: sign-in redesign, Data safety file, store art.**

- Committed: downloads start from the player at once and survive opening the film (db924ed,
  194ed56); the chat list is live from `updateNewMessage`, refresh removed (6409a90); the sign-in
  page redesign (66d3725).
- Data safety: `Desktop/data_safety_upload.csv`, made from the Console export. Phone number filled
  in (collected, optional, account management, not ephemeral); email's purpose is app
  functionality only (it arrives only when a user emails a crash report); "accounts created
  outside the app" = yes, Other, Telegram. Upload only once main is pushed: the Telegram section of
  `privacy.html` (6440a1c) must be live first.
- Store art: 8 slides and the feature graphic in `Desktop/glide-play-screenshots/posters-3.1`.
  Home and Network still need recapturing on the owner's user (sources connected, a share's
  folders listed).

**Next: TV tests by remote (Telegram: QR sign-in, focus, play, seek, download; shares: focus,
phone signs the TV in by QR, keyboard not covering buttons); Session C
notification/queue/delete by eye; Play closed test shows 0 testers opted in (owner checks the
Testers tab and opt-in link); then Session D.**
