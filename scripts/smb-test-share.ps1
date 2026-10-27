# Temporary SMB share on this PC for testing network shares (docs/network-shares.md "Testing").
# Run elevated, in PowerShell 7 (GetInt32 below is .NET Core). Opens port 445 to the given devices only; -Undo removes everything it made.
#   pwsh -ExecutionPolicy Bypass -File scripts\smb-test-share.ps1 -Client 192.168.1.33,192.168.1.40 [-Film <path>]
#   pwsh -ExecutionPolicy Bypass -File scripts\smb-test-share.ps1 -Undo
param(
    [string[]]$Client,
    [string]$Film = "$env:USERPROFILE\Desktop\Spider-Man.Brand.New.Day.2026.iMAX.1080p.10Bit.HEVC.WEB-DL.Hindi-English.ESub.x265-1VegaMovies.tw.mkv",
    [switch]$Undo
)
$dir = 'C:\GlideTest'
$link = "$dir\Spider-Man.mkv"
$pwFile = "$env:TEMP\glidetest.pw"

if ($Undo) {
    Remove-NetFirewallRule -DisplayName 'Glide SMB test' -ErrorAction Continue
    Remove-SmbShare -Name GlideTest -Force -ErrorAction Continue
    # The hard link shares the film's ACL, so the grant comes off the film itself.
    icacls $link /remove glidetest
    # Deletes the second name only; the film stays where it was.
    Remove-Item $link, $dir, $pwFile -ErrorAction Continue
    Remove-LocalUser glidetest -ErrorAction Continue
    'UNDO DONE'
    return
}

$ErrorActionPreference = 'Stop'
if (-not $Client) { throw 'Pass -Client <device ip>[,<device ip>...]' }
# -File hands a comma list over as one string.
$Client = $Client -split ','
$chars = [char[]]'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
$pw = -join (1..20 | ForEach-Object { $chars[[Security.Cryptography.RandomNumberGenerator]::GetInt32($chars.Length)] })
Set-Content $pwFile $pw -NoNewline
New-Item -ItemType Directory $dir -Force | Out-Null
New-Item -ItemType HardLink -Path $link -Target $Film | Out-Null
New-LocalUser glidetest -Password (ConvertTo-SecureString $pw -AsPlainText -Force) -PasswordNeverExpires -UserMayNotChangePassword -Description 'Glide SMB test, temporary' | Out-Null
icacls $dir /grant 'glidetest:(OI)(CI)RX' | Out-Null
icacls $link /grant 'glidetest:R' | Out-Null
New-SmbShare -Name GlideTest -Path $dir -ReadAccess glidetest | Out-Null
New-NetFirewallRule -DisplayName 'Glide SMB test' -Direction Inbound -Protocol TCP -LocalPort 445 -RemoteAddress $Client -Action Allow -Profile Any | Out-Null
"SETUP OK: \\$(hostname)\GlideTest, user glidetest, password in $pwFile"
