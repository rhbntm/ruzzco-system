<#
.SYNOPSIS
  Lets phones reach the Ruzzco server on any Wi-Fi this PC joins. Run once; it asks for
  administrator rights.

.DESCRIPTION
  Windows treats a Wi-Fi it hasn't seen before as a public network and blocks incoming
  connections there, and Node.js is usually only allowed on private networks. This adds two
  inbound rules (group "Ruzzco phones") for node.exe, on every network type, that accept only
  devices on the same local network (LocalSubnet):
    TCP 3443, 3080        the app over HTTPS and the phone setup page
    UDP 5353              phones asking for ruzzco.local (multicast DNS)
  Port 3000 (the app over plain HTTP) is not opened: the app listens on 127.0.0.1 only and
  phones reach it through the HTTPS gateway, so no PIN, cookie or phone secret crosses the
  Wi-Fi unencrypted (slice 15). Re-running this replaces an older rule that opened 3000.
  Devices beyond the local network stay blocked. On public Wi-Fi (a cafe), other guests on the
  same network can reach these ports while the servers run; owner pages still need the owner PIN.

  Run it again any time: it replaces its own rules (after Node.js moves, for example). A block
  rule for node.exe wins over these rules; the script lists any it finds but leaves them alone.

  Exit code: 0 = done, 1 = node.exe not found, 2 = the rules could not be changed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\phone-firewall.ps1
  powershell -ExecutionPolicy Bypass -File scripts\phone-firewall.ps1 -Remove
#>
param(
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
$group = "Ruzzco phones"

function Say($text) { Write-Host $text }

# Block rules beat allow rules in Windows Firewall; reading them needs no administrator rights.
function Show-BlockRules($node) {
  $blocks = @(Get-NetFirewallApplicationFilter | Where-Object { [Environment]::ExpandEnvironmentVariables($_.Program) -eq $node } |
    Get-NetFirewallRule | Where-Object { $_.Direction -eq "Inbound" -and $_.Action -eq "Block" -and $_.Enabled -eq "True" })
  foreach ($block in $blocks) {
    Say ("  note: '" + $block.DisplayName + "' blocks Node.js on " + $block.Profile + " networks and wins over these rules.")
    Say "  Turn it off in Windows Defender Firewall (Advanced settings, Inbound Rules) to let phones in there."
  }
}

$node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  # Run this same script elevated (Windows asks first), then report from here.
  Say "Asking Windows for administrator rights (a prompt opens)..."
  $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"")
  if ($Remove) { $arguments += "-Remove" }
  try {
    $elevated = Start-Process -FilePath (Get-Process -Id $PID).Path -ArgumentList $arguments -Verb RunAs -Wait -PassThru
  } catch {
    Say "FAIL: administrator rights were refused; nothing changed."
    exit 2
  }
  $rules = @(Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue)
  if ($Remove) {
    if ($rules.Count -eq 0) { Say "Removed: phones are again subject to Windows' normal rules." } else { Say "FAIL: the rules are still there." }
  } else {
    foreach ($rule in $rules) { Say ("  " + $rule.DisplayName + "  (" + $rule.Profile + ")") }
    if ($rules.Count -eq 2) {
      Say "Done: phones can reach Ruzzco on any Wi-Fi this PC joins."
      Show-BlockRules $node
    } else {
      Say "FAIL: the rules were not added (exit code $($elevated.ExitCode))."
    }
  }
  exit $elevated.ExitCode
}

try {
  Get-NetFirewallRule -Group $group -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  if ($Remove) {
    Say "Removed the $group rules."
    exit 0
  }
  if (-not $node) {
    Say "FAIL: node.exe was not found on PATH; install Node.js first."
    Start-Sleep -Seconds 5 # this window may close at once
    exit 1
  }

  $common = @{ Group = $group; Direction = "Inbound"; Action = "Allow"; Program = $node; RemoteAddress = "LocalSubnet"; Profile = "Any" }
  New-NetFirewallRule @common -DisplayName "Ruzzco: phones open the app (TCP 3443, 3080)" -Protocol TCP -LocalPort 3443, 3080 | Out-Null
  New-NetFirewallRule @common -DisplayName "Ruzzco: phones find ruzzco.local (UDP 5353)" -Protocol UDP -LocalPort 5353 | Out-Null
  Say "Added the $group rules for $node."
  Show-BlockRules $node
  exit 0
} catch {
  Say ("FAIL: " + $_.Exception.Message)
  Start-Sleep -Seconds 5 # this window may close at once
  exit 2
}
