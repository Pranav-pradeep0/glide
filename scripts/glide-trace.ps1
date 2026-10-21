<#
.SYNOPSIS
    One command for tracing Glide's player on a connected device.

.DESCRIPTION
    Enables the player's verbose tracing, prints a snapshot of the playback service and
    media session, then tails the player log together with crashes. Everything else on the
    device is silenced.

    Tracing is read once when the player's classes load, so the app is restarted to pick
    it up unless -NoRestart is given.

.EXAMPLE
    .\scripts\glide-trace.ps1
    Full trace of everything the player does.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Filter "SERVICE|SESSION|ENGINE"
    Only the media session and native player lifecycle.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Snapshot
    Print the service and session state and exit, without tailing.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Verify
    Check the toolchain-sensitive things a log never shows: 16 KB library alignment
    in the built APKs, the device page size, and which build is installed.

.EXAMPLE
    .\scripts\glide-trace.ps1 -Off
    Turn tracing back off, so release-level logging resumes.
#>
[CmdletBinding()]
param(
    # Regex applied to the log stream. Omit to see everything.
    [string] $Filter,
    # Also write the session to this file.
    [string] $LogFile,
    # Print the service/session snapshot and exit.
    [switch] $Snapshot,
    # Keep the app running instead of restarting it to pick up tracing.
    [switch] $NoRestart,
    # Disable tracing and exit.
    [switch] $Off,
    # Verify the built APKs and the installed app, then exit.
    [switch] $Verify
)

$ErrorActionPreference = 'Stop'
$package = 'com.glide.player'
$tag = 'GlideVLC'

if (-not (Get-Command adb -ErrorAction SilentlyContinue)) {
    throw "adb is not on PATH. Add <sdk>\platform-tools to PATH, or run it from there."
}
# The APK checks in -Verify are local, so only the device-facing modes need one.
$hasDevice = [bool](adb devices | Select-String -Pattern 'device$')
if (-not $hasDevice -and -not $Verify) {
    throw "No device is connected. Check 'adb devices'."
}

if ($Off) {
    adb shell setprop "log.tag.$tag" INFO
    adb shell am force-stop $package
    Write-Host "Tracing off. Relaunch the app." -ForegroundColor Yellow
    return
}

function Show-Snapshot {
    Write-Host "`n=== playback service ===" -ForegroundColor Cyan
    $service = adb shell dumpsys activity services $package |
        Select-String -Pattern 'GlidePlaybackService|isForeground|ServiceRecord'
    if ($service) { $service } else { Write-Host "  not running" -ForegroundColor DarkGray }

    Write-Host "`n=== media session ===" -ForegroundColor Cyan
    $session = adb shell dumpsys media_session | Select-String -Pattern $package -Context 0, 8
    if ($session) { $session } else { Write-Host "  no session registered" -ForegroundColor DarkGray }

    Write-Host "`n=== notifications posted ===" -ForegroundColor Cyan
    $notes = adb shell dumpsys notification --noredact |
        Select-String -SimpleMatch "StatusBarNotification(pkg=$package" |
        ForEach-Object {
            # Only the parts that say whether this is a foreground media notification.
            $line = $_.ToString()
            $id = if ($line -match 'id=([0-9]+)') { $matches[1] } else { '?' }
            $chan = if ($line -match 'channel=([^ ]+)') { $matches[1] } else { '?' }
            $flags = if ($line -match 'flags=([^ ]+)') { $matches[1] } else { '' }
            $fg = if ($flags -match 'FOREGROUND_SERVICE') { 'FOREGROUND' } else { 'not foreground' }
            "  id=$id channel=$chan  [$fg]  $flags"
        }
    if ($notes) { $notes } else { Write-Host "  none" -ForegroundColor DarkGray }

    Write-Host "`n=== granted permissions ===" -ForegroundColor Cyan
    adb shell dumpsys package $package |
        Select-String -Pattern 'android.permission\.[A-Z_]+: granted=true' |
        ForEach-Object { "  " + ($_ -replace '.*android\.permission\.', '') }
}

function Show-Verification {
    # 16 KB pages: Android 15 and later can run with them, and every shared library in
    # the APK must be 16 KB aligned or it will not load. NDK r27 only does this when
    # ANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES is on, which React Native's Gradle plugin sets
    # for us, so this is the check that the arrangement actually held.
    Write-Host "`n=== 16 KB library alignment ===" -ForegroundColor Cyan
    $zipalign = Get-ChildItem "$env:ANDROID_HOME\build-tools\*\zipalign.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1
    $apks = Get-ChildItem -Path "android\app\build\outputs\apk" -Filter *.apk -Recurse -ErrorAction SilentlyContinue
    if (-not $zipalign) {
        Write-Host "  zipalign not found under ANDROID_HOME; skipped." -ForegroundColor DarkGray
    } elseif (-not $apks) {
        Write-Host "  no APK built yet." -ForegroundColor DarkGray
    } else {
        foreach ($apk in $apks) {
            $result = & $zipalign.FullName -c -P 16 4 $apk.FullName 2>&1
            $ok = $LASTEXITCODE -eq 0
            $colour = if ($ok) { 'Green' } else { 'Red' }
            Write-Host ("  {0}: {1}" -f $apk.Name, $(if ($ok) { 'aligned' } else { 'NOT ALIGNED' })) -ForegroundColor $colour
            if (-not $ok) { $result | Select-Object -First 5 }
        }
    }

    if (-not $hasDevice) {
        Write-Host "`nNo device attached; skipping device checks." -ForegroundColor DarkGray
        return
    }

    Write-Host "`n=== device ===" -ForegroundColor Cyan
    $pageSize = (adb shell getconf PAGE_SIZE).Trim()
    Write-Host "  page size:  $pageSize$(if ($pageSize -eq '16384') { '  (16 KB device)' })"
    Write-Host "  android:    $((adb shell getprop ro.build.version.release).Trim()) (API $((adb shell getprop ro.build.version.sdk).Trim()))"

    Write-Host "`n=== installed build ===" -ForegroundColor Cyan
    $info = adb shell dumpsys package $package | Select-String -Pattern 'versionName=|versionCode=|targetSdk='
    if ($info) { $info | ForEach-Object { "  " + $_.ToString().Trim() } }
    else { Write-Host "  not installed" -ForegroundColor DarkGray }
}

if ($Verify) {
    Show-Verification
    return
}

if ($Snapshot) {
    Show-Snapshot
    return
}

adb shell setprop "log.tag.$tag" VERBOSE
if (-not $NoRestart) {
    # The trace flag is read when the player's classes load, so a running process keeps
    # whatever it started with.
    adb shell am force-stop $package
    Write-Host "Tracing on, app stopped. Open Glide now." -ForegroundColor Green
} else {
    Write-Host "Tracing on. It applies from the next app launch." -ForegroundColor Yellow
}

if (-not $NoRestart) {
    Write-Host "`nWaiting for playback to start - open a video now (Ctrl+C to skip)..." -ForegroundColor DarkGray
    # The service only exists while something is playing, so waiting for the app process
    # is not enough: the snapshot would describe an idle app every time.
    $waited = 0
    while ($waited -lt 180) {
        $running = adb shell dumpsys activity services $package 2>$null |
            Select-String -SimpleMatch "GlidePlaybackService"
        if ($running) { break }
        Start-Sleep -Seconds 1
        $waited++
    }
    if ($waited -ge 180) {
        Write-Host "No playback service appeared; snapshot describes an idle app." -ForegroundColor Yellow
    } else {
        # Let the session settle before asking what it looks like.
        Start-Sleep -Seconds 2
    }
}

Show-Snapshot

Write-Host "`n=== log (Ctrl+C to stop) ===" -ForegroundColor Cyan
adb logcat -c
$stream = { adb logcat -v time -s $tag 'AndroidRuntime:E' }

$pipeline = & $stream
if ($Filter) { $pipeline = $pipeline | Select-String -Pattern $Filter }
if ($LogFile) { $pipeline | Tee-Object -FilePath $LogFile } else { $pipeline }
