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
    `[position, …)` isn't on disk, `downloadFile(file_id, priority=32, offset=position, limit=0,
    synchronous=false)`.
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
- **Cache:** TDLib keeps what it downloaded. Cap it: when playback ends, `deleteFile` for
  films not being resumed soon, and `optimizeStorage(size = cap)` at app start. Cap to decide in
  (c) (TV boxes have 8 GB). Settings shows the size and a "Clear" button.
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

**2026-11-01: plan written. Nothing built yet.** Next: step (a).

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

**Next: session 1 (native), see Steps.**

**Next (was):** `gh run download <run> -R Pranav-pradeep0/glide-tdlib -n tdlib-aar -D android/app/libs`
(AAR + `.sha256`), build, fix compile errors, commit step 2 (stage files explicitly). Then step 4:
on the phone and Mi TV, `adb shell am start -n
com.glide.player/com.glide.app.telegram.TelegramDebugActivity`, sign in by QR, play each test
film; the screen and logcat `GlideTelegram` give first frame, MB/s, stalls, RAM. APK size per ABI
from a debug-signed release build (R8), before vs after. Record here with the go/no-go.
