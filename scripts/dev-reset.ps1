<#
.SYNOPSIS
  Puts the Windows dev environment in a known state: frees the dev port, makes sure the
  MySQL container is up, regenerates the Prisma client, and optionally starts the dev server.

.DESCRIPTION
  Run it before prisma generate / migrate, builds and verification (the running dev server
  locks the Prisma engine, EPERM). Steps, all of which always run:
    1. Kill whatever listens on the dev port, plus node processes from THIS repo (matched by
       repo path in the command line). Other node processes on the machine are not touched.
    2. Check the MySQL container (ruzzco-mysql, from docker-compose.yml); start it if stopped.
       If the Docker daemon itself is down it only reports that (start Docker Desktop).
    3. Run `npx prisma generate` in web/.
    4. With -Start: start `npm run dev` fully detached (via WMI, so it cannot hold the caller's output
       pipe) and wait until the port answers; prints the PID that listens on the port.

  Exit code: 0 = all good. Otherwise the first failing step: 1 = port still taken, 2 = database
  not ready, 3 = prisma generate failed, 4 = -Start did not come up.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev-reset.ps1
  powershell -ExecutionPolicy Bypass -File scripts\dev-reset.ps1 -Start
#>
param(
  [switch]$Start,
  [int]$Port = 3000,
  [string]$Container = "ruzzco-mysql",
  [int]$StartTimeoutSec = 90
)

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$web = Join-Path $repo "web"
$exitCode = 0

function Say($text) { Write-Host $text }
function Fail($code, $text) {
  Write-Host ("FAIL: " + $text)
  if ($script:exitCode -eq 0) { $script:exitCode = $code }
}

function Stop-Tree($procId, $label) {
  & taskkill.exe /F /T /PID $procId *> $null
  Say ("  killed PID " + $procId + " (" + $label + ")")
}

# ---- 1. free the port, kill this repo's node processes -------------------------------
Say ("[1/4] Dev port " + $Port + " and node processes from " + $repo)
$killed = 0

$listenerPids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique)
foreach ($listenerPid in $listenerPids) {
  if ($listenerPid -eq 0 -or $listenerPid -eq $PID) { continue }
  $p = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
  $name = "unknown"
  if ($p) { $name = $p.ProcessName }
  Stop-Tree $listenerPid ("listening on port " + $Port + ", " + $name)
  $killed++
}

$nodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)
foreach ($n in $nodes) {
  $cmd = [string]$n.CommandLine
  if ($n.ProcessId -eq $PID) { continue }
  if ($cmd -notlike ("*" + $repo + "*")) { continue }
  if ($cmd -like "*claude*") { continue }   # never touch Claude Code's own helpers
  if (-not (Get-Process -Id $n.ProcessId -ErrorAction SilentlyContinue)) { continue }  # already gone with its parent
  $short = $cmd
  if ($short.Length -gt 90) { $short = $short.Substring(0, 90) + "..." }
  Stop-Tree $n.ProcessId ("node from this repo: " + $short)
  $killed++
}
if ($killed -eq 0) { Say "  nothing to kill" }

Start-Sleep -Milliseconds 700
$still = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
if ($still.Count -gt 0) {
  $ownerIds = ($still | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
  Fail 1 ("port " + $Port + " is still taken by PID " + $ownerIds)
} else {
  Say ("  port " + $Port + " is free")
}

# ---- 2. database container -----------------------------------------------------------
Say ("[2/4] Database container " + $Container)
& docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail 2 "Docker is not running. Start Docker Desktop, then run this script again."
} else {
  $running = (& docker inspect -f "{{.State.Running}}" $Container 2>$null)
  if ($LASTEXITCODE -ne 0) {
    Fail 2 ("container " + $Container + " does not exist. From the repo root run: docker compose up -d mysql")
  } else {
    if ("$running".Trim() -ne "true") {
      Say "  container is stopped, starting it"
      & docker start $Container *> $null
      if ($LASTEXITCODE -ne 0) { Fail 2 ("docker start " + $Container + " failed") }
    } else {
      Say "  container is running"
    }
    if ($script:exitCode -ne 2) {
      $health = ""
      for ($i = 0; $i -lt 30; $i++) {
        $health = (& docker inspect -f "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}" $Container 2>$null)
        $health = "$health".Trim()
        if ($health -eq "healthy" -or $health -eq "none") { break }
        Start-Sleep -Seconds 2
      }
      if ($health -eq "healthy" -or $health -eq "none") {
        Say ("  database is ready (health: " + $health + ")")
      } else {
        Fail 2 ("container health is '" + $health + "' after 60 s")
      }
    }
  }
}

# ---- 3. prisma generate --------------------------------------------------------------
Say "[3/4] prisma generate (web/)"
Push-Location $web
try {
  & npx.cmd prisma generate
  if ($LASTEXITCODE -ne 0) { Fail 3 "prisma generate failed (a node process may still hold the engine file)" }
  else { Say "  prisma client generated" }
} finally {
  Pop-Location
}

# ---- 4. optional dev server ----------------------------------------------------------
if ($Start) {
  Say ("[4/4] Starting npm run dev and waiting for http://localhost:" + $Port)
  if ($script:exitCode -eq 1) {
    Fail 4 "not starting: the port is still taken"
  } else {
    $log = Join-Path $env:TEMP "ruzzco-dev-server.log"
    Remove-Item -LiteralPath $log -ErrorAction SilentlyContinue
    # Launch through WMI (Win32_Process.Create), not as our child: the new process then inherits
    # none of our handles, so it cannot hold the caller's output pipe open after this script exits.
    # (Start-Process looked detached, but it still passes our inheritable handles to the child.)
    # Use npm.cmd's full path: with a bare name, cmd makes %~dp0 the current directory and the shim breaks.
    $npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $npmCmd) { $npmCmd = "npm.cmd" }
    $cmdLine = 'cmd.exe /d /s /c ""' + $npmCmd + '" run dev >"' + $log + '" 2>&1"'
    $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmdLine; CurrentDirectory = $web }
    if ($created.ReturnValue -ne 0) {
      Fail 4 ("could not launch npm run dev (WMI return code " + $created.ReturnValue + ")")
    }
    Say ("  launched npm run dev detached (launcher PID " + $created.ProcessId + "), log: " + $log)
    $deadline = (Get-Date).AddSeconds($StartTimeoutSec)
    $up = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $r = Invoke-WebRequest -Uri ("http://localhost:" + $Port + "/api/v1/health") -UseBasicParsing -TimeoutSec 5
        Say ("  responding: HTTP " + $r.StatusCode)
        $up = $true
        break
      } catch {
        if ($_.Exception.Response) {
          Say ("  responding: HTTP " + [int]$_.Exception.Response.StatusCode)
          $up = $true
          break
        }
        Start-Sleep -Seconds 2
      }
    }
    if (-not $up) {
      Fail 4 ("dev server did not answer on port " + $Port + " within " + $StartTimeoutSec + " s; see " + $log)
    } else {
      $serverPids = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
      Say ("  dev server PID (listening on port " + $Port + "): " + ($serverPids -join ", "))
    }
  }
} else {
  Say "[4/4] Dev server not started (pass -Start to start it)"
}

if ($exitCode -eq 0) { Say "dev-reset OK" } else { Say ("dev-reset finished with exit code " + $exitCode) }
exit $exitCode
