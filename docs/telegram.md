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
- **Sign-in by QR code first** (scan with the Telegram app on the phone: no typing on TV), then the
  2-step password if the account has one. Phone number + code is the fallback.
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
- **(b) Sign-in for real.** QR, 2-step password, phone + code fallback, log out, "Signed in as".
  TV: QR is the main path. Errors: wrong password, flood wait ("Try again in N minutes").
- **(c) Browse.** Chat list, chat videos (video + document), thumbnails, paging, empty states,
  cache cap + Settings "Clear".
- **(d) Seeking and playback hardening.** The seek matrix below, all on the Mi TV.
- **(e) History/Recents/resume, drops, Data safety + `privacy.html`**, Play listing text.
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

- [ ] Register the app at my.telegram.org (API development tools): app title "Glide", platform
      Android. Put `TELEGRAM_API_ID` / `TELEGRAM_API_HASH` in `.env` and as GitHub secrets.
- [ ] Create the private `glide-tdlib` repo (or say to reuse the FFmpeg one's pattern under a new
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
