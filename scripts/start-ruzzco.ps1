<#
.SYNOPSIS
  Starts the whole Ruzzco system with one command so phones can connect: Docker and the
  database, the forecast service, the app and the HTTPS gateway for installed phone apps.
  Offers to install what is missing.

.DESCRIPTION
  Double-click start-ruzzco.cmd in the repo root, or run this script. Steps:
    1. Tools: Node.js 20.9 or newer, Docker Desktop, and OpenSSL (part of Git for Windows) for
       the HTTPS gateway. Missing ones are installed with winget after you say yes.
    2. Docker: starts Docker Desktop when it isn't running and waits for it.
    3. Settings: creates the root .env (new database passwords) when there is no database yet,
       and fills DATABASE_URL, OWNER_SESSION_SECRET, OWNER_PIN and DEVICE_APPROVAL_PIN in
       web/.env when they are empty (asks for the two PINs, 6 to 8 digits, never the same).
       Never changes a value that is set (a PIN shorter than 6 digits is only warned about),
       and never prints one.
    4. Stops Ruzzco servers still running: Node.js on ports 3000, 3443 and 3080, and Node.js
       started from this repo (an `npm run dev` in a terminal too). Other programs are left alone.
    5. npm packages: npm ci when web/node_modules is missing or package-lock.json changed since
       the last install, then prisma generate.
    6. Database: starts MySQL, applies new migrations (prisma migrate deploy) and seeds the
       barbers and services when the database has none.
    7. Forecast: starts ml-service when a trained model exists; offers to train one when only
       the logbook is there. The POS works without it.
    8. App: production build when the code changed since the last build, then next start.
       -Dev runs next dev instead. A failed build falls back to next dev. The app listens on
       127.0.0.1 only: phones reach it through the HTTPS gateway, never over plain HTTP.
    9. HTTPS gateway (npm run https): the only way phones reach the app.
   10. Phones: checks the Windows Firewall rules (scripts\phone-firewall.ps1), then prints the
       addresses for this PC and the phones.
  It then stays open: Ctrl+C or closing the window stops the app and the gateway. MySQL and the
  forecast keep running in Docker; -Stop stops them too.

  Logs: %TEMP%\ruzzco\ (app.log, https.log and their -errors.log files).
  Exit code: 0 = stopped normally, 1 = a required step failed.

.EXAMPLE
  start-ruzzco.cmd
  powershell -ExecutionPolicy Bypass -File scripts\start-ruzzco.ps1 -Dev
  powershell -ExecutionPolicy Bypass -File scripts\start-ruzzco.ps1 -Stop
#>
param(
  [switch]$Dev,         # next dev instead of a production build
  [switch]$Rebuild,     # build even when nothing changed
  [switch]$NoHttps,     # skip the HTTPS gateway (phones then can't reach the app)
  [switch]$NoForecast,  # skip the forecast service
  [switch]$NoBrowser,   # don't open the app on this PC
  [switch]$Yes,         # install and set up without asking (the owner PIN is still asked)
  [switch]$Stop,        # stop the app, the gateway and the Docker containers, then exit
  [switch]$KeepOpen     # wait for Enter before the window closes (start-ruzzco.cmd passes it)
)

$ErrorActionPreference = "Continue"
$repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$web = Join-Path $repo "web"
$compose = Join-Path $repo "docker-compose.yml"
$appPort = 3000
$ports = @(3000, 3443, 3080)
$containers = @("ruzzco-mysql", "ruzzco-ml")
$logDir = Join-Path $env:TEMP "ruzzco"
$dockerDesktop = Join-Path $env:ProgramFiles "Docker\Docker\Docker Desktop.exe"
$localName = "ruzzco.local"
if ($env:RUZZCO_LOCAL_NAME) { $localName = $env:RUZZCO_LOCAL_NAME }
$utf8 = New-Object System.Text.UTF8Encoding $false
$env:PRISMA_HIDE_UPDATE_MESSAGE = "1"  # keep Prisma's upgrade banner out of the shop window
$script:started = @()

function Say($text) { Write-Host $text }
function Step($text) { Write-Host ""; Write-Host $text -ForegroundColor Cyan }
function Warn($text) { Write-Host ("  note: " + $text) -ForegroundColor Yellow }

function Done($code) {
  if ($KeepOpen) { try { Read-Host "Press Enter to close" | Out-Null } catch { } }
  exit $code
}

function Quit($text, $prefix = "Ruzzco did not start: ") {
  Write-Host ""
  Write-Host ($prefix + $text) -ForegroundColor Red
  Stop-Started
  Done 1
}

# Yes/no question. Without a console to ask on, the answer is no.
function Ask($question, [bool]$default) {
  if ($Yes) { return $true }
  $hint = " [y/N]"
  if ($default) { $hint = " [Y/n]" }
  try { $answer = Read-Host ($question + $hint) } catch { return $false }
  $answer = "$answer".Trim().ToLower()
  if ($answer -eq "") { return $default }
  return ($answer -eq "y" -or $answer -eq "yes")
}

function Update-Path {
  $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
  $dockerBin = Join-Path $env:ProgramFiles "Docker\Docker\resources\bin"
  if ((Test-Path -LiteralPath $dockerBin) -and -not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
    $env:Path = $dockerBin + ";" + $env:Path
  }
}

function Install-Tool($id, $what, $size) {
  if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
    Say ("  winget (the Windows app installer) isn't available, so " + $what + " can't be installed from here.")
    return $false
  }
  if (-not (Ask ("  Install " + $what + " now (" + $size + ")?") $false)) { return $false }
  & winget.exe install --id $id --exact --source winget --accept-package-agreements --accept-source-agreements | Out-Host
  $ok = ($LASTEXITCODE -eq 0)
  Update-Path
  return $ok
}

function Get-NodeVersion {
  if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { return $null }
  $text = "$(& node.exe -v 2>$null)"
  if ($text -match '^v(\d+)\.(\d+)') { return [version]($Matches[1] + "." + $Matches[2]) }
  return $null
}

# Same places web/scripts/https-proxy.mjs looks.
function Find-OpenSsl {
  $candidates = @($env:OPENSSL, "openssl.exe",
    (Join-Path $env:ProgramFiles "Git\usr\bin\openssl.exe"),
    (Join-Path $env:ProgramFiles "Git\ucrt64\bin\openssl.exe"),
    (Join-Path $env:ProgramFiles "Git\mingw64\bin\openssl.exe"))
  foreach ($candidate in $candidates) {
    if ($candidate -and (Get-Command $candidate -ErrorAction SilentlyContinue)) { return $true }
  }
  return $false
}

function Test-Docker {
  if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) { return $false }
  & docker.exe info *> $null
  return ($LASTEXITCODE -eq 0)
}

# ---- .env files: read and fill in place, UTF-8 without BOM, values never printed ----------
function Read-EnvFile($path) {
  $values = @{}
  if (-not (Test-Path -LiteralPath $path)) { return $values }
  foreach ($line in [System.IO.File]::ReadAllLines($path)) {
    if ($line -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$') {
      $key = $Matches[1]
      $value = $Matches[2]
      if ($value -match '^"(.*)"$' -or $value -match "^'(.*)'$") { $value = $Matches[1] }
      $values[$key] = $value
    }
  }
  return $values
}

function Set-EnvValue($path, $key, $value) {
  $lines = New-Object System.Collections.Generic.List[string]
  $newline = "`n"
  if (Test-Path -LiteralPath $path) {
    $text = [System.IO.File]::ReadAllText($path)
    if ($text.Contains("`r`n")) { $newline = "`r`n" }
    foreach ($line in ($text -split "\r?\n")) { $lines.Add($line) }
    while ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq "") { $lines.RemoveAt($lines.Count - 1) }
  }
  $found = $false
  for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match ('^\s*' + [regex]::Escape($key) + '\s*=')) { $lines[$i] = $key + "=" + $value; $found = $true }
  }
  if (-not $found) { $lines.Add($key + "=" + $value) }
  [System.IO.File]::WriteAllText($path, (($lines -join $newline) + $newline), $utf8)
}

function New-Secret([int]$Bytes = 18) {
  $buffer = New-Object byte[] $Bytes
  [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($buffer)
  return (($buffer | ForEach-Object { $_.ToString("x2") }) -join "")
}

function Read-Secret($prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Read-OwnerPin {
  Say "  The owner PIN (Mart) unlocks the owner pages (ledger, End-of-Day Cash, forecast, insights, payment QRs, phones). Use 6 to 8 digits."
  for ($try = 0; $try -lt 3; $try++) {
    try {
      $pin = Read-Secret "  New owner PIN (Enter to skip)"
      if ($pin -eq "") { return $null }
      if ($pin -notmatch '^\d{6,8}$') { Say "  Use 6 to 8 digits."; continue }
      $again = Read-Secret "  Same PIN again"
    } catch { return $null }
    if ($again -eq $pin) { return $pin }
    Say "  The two PINs differ, try again."
  }
  return $null
}

# The approval PIN (Bayani) only approves phones. It must differ from the owner PIN: the same
# PIN would give its holder the owner pages too.
function Read-ApprovalPin($ownerPin) {
  Say "  The approval PIN (Bayani) only approves phones to send sales; it opens no owner page. Use 6 to 8 digits, not the owner PIN."
  for ($try = 0; $try -lt 3; $try++) {
    try {
      $pin = Read-Secret "  New approval PIN (Enter to skip)"
      if ($pin -eq "") { return $null }
      if ($pin -notmatch '^\d{6,8}$') { Say "  Use 6 to 8 digits."; continue }
      if ($ownerPin -and $pin -eq $ownerPin) { Say "  That is the owner PIN. Choose a different one."; continue }
      $again = Read-Secret "  Same PIN again"
    } catch { return $null }
    if ($again -eq $pin) { return $pin }
    Say "  The two PINs differ, try again."
  }
  return $null
}

# ---- processes ------------------------------------------------------------------------
function Stop-Tree($procId) { & taskkill.exe /F /T /PID $procId *> $null }

function Get-PortOwner($port) {
  return (@(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique) | Where-Object { $_ -ne 0 } | Select-Object -First 1)
}

# Node.js on the Ruzzco ports or started from this repo; never other programs, never Claude's helpers.
function Stop-RuzzcoServers {
  $count = 0
  foreach ($port in $ports) {
    $owner = Get-PortOwner $port
    if (-not $owner -or $owner -eq $PID) { continue }
    $p = Get-Process -Id $owner -ErrorAction SilentlyContinue
    if ($p -and $p.ProcessName -eq "node") { Stop-Tree $owner; $count++ }
  }
  foreach ($n in @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue)) {
    $cmd = [string]$n.CommandLine
    if ($cmd -notlike ("*" + $repo + "*") -or $cmd -like "*claude*") { continue }
    if (-not (Get-Process -Id $n.ProcessId -ErrorAction SilentlyContinue)) { continue }  # gone with its parent
    Stop-Tree $n.ProcessId
    $count++
  }
  return $count
}

function Stop-Started {
  foreach ($p in $script:started) {
    if ($p -and -not $p.HasExited) { Stop-Tree $p.Id }
  }
  $script:started = @()
}

# Runs node with the given arguments in web/, attached to this console (Ctrl+C and closing the
# window stop it too), output in $logDir.
function Start-Server($name, $arguments) {
  $out = Join-Path $logDir ($name + ".log")
  $err = Join-Path $logDir ($name + "-errors.log")
  try {
    $p = Start-Process -FilePath $script:nodeExe -ArgumentList $arguments -WorkingDirectory $web -NoNewWindow -PassThru `
      -RedirectStandardOutput $out -RedirectStandardError $err -ErrorAction Stop
  } catch {
    Quit ("could not start the " + $name + " server: " + $_.Exception.Message)
  }
  $script:started += $p
  return $p
}

# Prints what a log gained since the last call.
$script:logPositions = @{}
function Show-NewLines($path, $prefix) {
  if (-not (Test-Path -LiteralPath $path)) { return }
  $text = ""
  try {
    $stream = [System.IO.File]::Open($path, "Open", "Read", "ReadWrite")
    try {
      $position = 0
      if ($script:logPositions.ContainsKey($path)) { $position = $script:logPositions[$path] }
      if ($stream.Length -lt $position) { $position = 0 }
      $stream.Position = $position
      $reader = New-Object System.IO.StreamReader($stream)
      $text = $reader.ReadToEnd()
      $script:logPositions[$path] = $stream.Length
    } finally { $stream.Dispose() }
  } catch { return }
  foreach ($line in ($text -split "\r?\n")) {
    if ($line.Trim()) { Write-Host ($prefix + $line) }
  }
}

function Show-LogTail($name) {
  foreach ($file in @(($name + "-errors.log"), ($name + ".log"))) {
    $path = Join-Path $logDir $file
    if (Test-Path -LiteralPath $path) {
      Say ("  last lines of " + $path + ":")
      Get-Content -LiteralPath $path -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Say ("    " + $_) }
    }
  }
}

function Test-AppAnswers {
  try {
    Invoke-WebRequest -Uri ("http://localhost:" + $appPort + "/api/v1/health") -UseBasicParsing -TimeoutSec 5 | Out-Null
    return $true
  } catch {
    return [bool]$_.Exception.Response
  }
}

# A production build is stale when anything it is made from changed after it.
function Test-BuildStale {
  $buildId = Join-Path $web ".next\BUILD_ID"
  if (-not (Test-Path -LiteralPath $buildId)) { return $true }
  $built = (Get-Item -LiteralPath $buildId).LastWriteTime
  foreach ($item in @("src", "public", "prisma\schema.prisma", "next.config.ts", "package-lock.json", "postcss.config.mjs", "tsconfig.json", ".env")) {
    $path = Join-Path $web $item
    if (-not (Test-Path -LiteralPath $path)) { continue }
    $newer = Get-ChildItem -LiteralPath $path -Recurse -File -ErrorAction SilentlyContinue |
      Where-Object { $_.LastWriteTime -gt $built } | Select-Object -First 1
    if ($newer) { return $true }
  }
  return $false
}

function Get-LanAddresses {
  $ips = @()
  foreach ($config in @(Get-NetIPConfiguration -ErrorAction SilentlyContinue)) {
    if (-not $config.IPv4DefaultGateway) { continue }
    foreach ($address in @($config.IPv4Address)) {
      if ($address.IPAddress -and $address.IPAddress -notlike "169.254.*") { $ips += $address.IPAddress }
    }
  }
  return $ips
}

# ---- -Stop ------------------------------------------------------------------------------
if ($Stop) {
  Step "Stopping Ruzzco"
  $count = Stop-RuzzcoServers
  Say ("  stopped " + $count + " Node.js process(es)")
  if (Test-Docker) {
    foreach ($c in $containers) {
      $running = "$(& docker.exe inspect -f '{{.State.Running}}' $c 2>$null)".Trim()
      if ($running -eq "true") {
        & docker.exe stop $c *> $null
        Say ("  stopped container " + $c + " (its data stays)")
      }
    }
  }
  Say "Ruzzco is stopped. Docker Desktop is still open: quit it from its tray icon to free its memory."
  Done 0
}

Write-Host "Starting Ruzzco" -ForegroundColor Green

# ---- 1. tools -----------------------------------------------------------------------------
Step "[1/10] Tools"
Update-Path
$nodeVersion = Get-NodeVersion
if (-not $nodeVersion -or $nodeVersion -lt [version]"20.9") {
  if ($nodeVersion) { Say ("  Node.js " + $nodeVersion + " is too old: the app needs 20.9 or newer.") }
  else { Say "  Node.js is missing. It runs the Ruzzco app." }
  Install-Tool "OpenJS.NodeJS.LTS" "Node.js LTS" "about 100 MB" | Out-Null
  $nodeVersion = Get-NodeVersion
  if (-not $nodeVersion -or $nodeVersion -lt [version]"20.9") {
    Quit "Node.js 20.9 or newer is needed. Install the LTS version from https://nodejs.org, then run this again."
  }
}
$script:nodeExe = (Get-Command node.exe).Source
Say ("  Node.js " + "$(& node.exe -v)")

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  Say "  Docker Desktop is missing. It runs the database (MySQL) and the forecast service."
  if (Install-Tool "Docker.DockerDesktop" "Docker Desktop" "about 3 GB of disk, about 2 GB of RAM while it runs") {
    Quit "Docker Desktop was just installed. Restart Windows, open Docker Desktop once and accept its terms, then run this again."
  }
  Quit "Docker Desktop is needed: https://www.docker.com/products/docker-desktop/ . Install it, then run this again."
}
Say "  Docker Desktop is installed"

$httpsScript = Join-Path $web "scripts\https-proxy.mjs"
$useHttps = (-not $NoHttps) -and (Test-Path -LiteralPath $httpsScript)
if ($useHttps -and -not (Find-OpenSsl)) {
  Say "  OpenSSL is missing. The HTTPS gateway for phone apps needs it; it comes with Git for Windows."
  Install-Tool "Git.Git" "Git for Windows" "about 350 MB" | Out-Null
  if (-not (Find-OpenSsl)) {
    Warn "continuing without the HTTPS gateway: phones can't reach the POS until it runs (they keep their sales). Install Git for Windows, then run this again."
    $useHttps = $false
  }
}
if ($useHttps) { Say "  OpenSSL found (for the HTTPS gateway)" }

# ---- 2. Docker ----------------------------------------------------------------------------
Step "[2/10] Docker"
if (-not (Test-Docker)) {
  if (-not (Test-Path -LiteralPath $dockerDesktop)) { Quit "Docker isn't running. Start Docker Desktop, then run this again." }
  Say "  starting Docker Desktop (this can take a minute or two)"
  Start-Process -FilePath $dockerDesktop
  $deadline = (Get-Date).AddSeconds(240)
  while (-not (Test-Docker)) {
    if ((Get-Date) -gt $deadline) {
      Quit "Docker didn't start within 4 minutes. Open Docker Desktop, wait until it says it is running, then run this again."
    }
    Start-Sleep -Seconds 3
  }
}
Say "  Docker is running"

# ---- 3. settings --------------------------------------------------------------------------
Step "[3/10] Settings (.env files; values are never shown)"
$rootEnv = Join-Path $repo ".env"
$webEnv = Join-Path $web ".env"
$project = (Split-Path $repo -Leaf).ToLower() -replace '[^a-z0-9_-]', ''
if ($env:COMPOSE_PROJECT_NAME) { $project = $env:COMPOSE_PROJECT_NAME }
& docker.exe volume inspect ($project + "_mysql_data") *> $null
$databaseExists = ($LASTEXITCODE -eq 0)

$rootValues = Read-EnvFile $rootEnv
$missing = @(@("MYSQL_ROOT_PASSWORD", "MYSQL_USER", "MYSQL_PASSWORD") | Where-Object { -not $rootValues[$_] })
if ($missing.Count -gt 0) {
  if ($databaseExists) {
    Quit (".env in the repo root has no " + ($missing -join ", ") + ", but the database already exists. Put back the passwords it was created with (copy .env.example to .env and fill them in), then run this again.")
  }
  if (-not (Test-Path -LiteralPath $rootEnv)) {
    [System.IO.File]::WriteAllText($rootEnv, "# Made by scripts/start-ruzzco.ps1. Docker Compose reads it; MySQL uses it only when the database is first created. Never commit it.`n", $utf8)
  }
  if (-not $rootValues["MYSQL_ROOT_PASSWORD"]) { Set-EnvValue $rootEnv "MYSQL_ROOT_PASSWORD" (New-Secret) }
  if (-not $rootValues["MYSQL_USER"]) { Set-EnvValue $rootEnv "MYSQL_USER" "ruzzco_user" }
  if (-not $rootValues["MYSQL_PASSWORD"]) { Set-EnvValue $rootEnv "MYSQL_PASSWORD" (New-Secret) }
  $rootValues = Read-EnvFile $rootEnv
  Say "  made new database passwords in .env (repo root)"
}

if (-not (Test-Path -LiteralPath $webEnv)) {
  $example = Join-Path $web ".env.example"
  if (Test-Path -LiteralPath $example) { Copy-Item -LiteralPath $example -Destination $webEnv }
  Say "  created web/.env"
}
$webValues = Read-EnvFile $webEnv
if (-not $webValues["DATABASE_URL"]) {
  $url = "mysql://" + [uri]::EscapeDataString($rootValues["MYSQL_USER"]) + ":" + [uri]::EscapeDataString($rootValues["MYSQL_PASSWORD"]) + "@localhost:3307/ruzzco_db"
  Set-EnvValue $webEnv "DATABASE_URL" $url
  Say "  set DATABASE_URL in web/.env (from the root .env)"
}
if (-not $webValues["OWNER_SESSION_SECRET"]) {
  Set-EnvValue $webEnv "OWNER_SESSION_SECRET" (New-Secret 32)
  Say "  made a new owner session secret in web/.env"
}
if (-not $webValues["OWNER_PIN"]) {
  $pin = Read-OwnerPin
  if ($pin) {
    Set-EnvValue $webEnv "OWNER_PIN" $pin
    Say "  saved the owner PIN in web/.env"
  } else {
    Warn "no owner PIN: the owner pages stay locked until OWNER_PIN is set in web/.env (or run this again)"
  }
}
$webValues = Read-EnvFile $webEnv
if (-not $webValues["DEVICE_APPROVAL_PIN"]) {
  $approval = Read-ApprovalPin $webValues["OWNER_PIN"]
  if ($approval) {
    Set-EnvValue $webEnv "DEVICE_APPROVAL_PIN" $approval
    Say "  saved the approval PIN in web/.env"
  } else {
    Warn "no approval PIN: only the owner PIN approves phones until DEVICE_APPROVAL_PIN is set in web/.env (or run this again)"
  }
}
$webValues = Read-EnvFile $webEnv
if ($webValues["OWNER_PIN"] -and $webValues["OWNER_PIN"] -notmatch '^\d{6,}$') {
  Warn "the owner PIN in web/.env is shorter than 6 digits. Change it to 6 to 8 digits (OWNER_PIN in web/.env)."
}
if ($webValues["DEVICE_APPROVAL_PIN"] -and $webValues["DEVICE_APPROVAL_PIN"] -notmatch '^\d{6,}$') {
  Warn "the approval PIN in web/.env is shorter than 6 digits. Change it to 6 to 8 digits (DEVICE_APPROVAL_PIN in web/.env)."
}
if ($webValues["DEVICE_APPROVAL_PIN"] -and $webValues["DEVICE_APPROVAL_PIN"] -eq $webValues["OWNER_PIN"]) {
  Warn "the approval PIN equals the owner PIN, so it is ignored: only the owner PIN approves phones. Set a different DEVICE_APPROVAL_PIN in web/.env."
}
Say "  .env files are ready"

# ---- 4. old servers -----------------------------------------------------------------------
Step "[4/10] Ruzzco servers still running"
$count = Stop-RuzzcoServers
if ($count -gt 0) { Say ("  stopped " + $count + " Node.js process(es)") } else { Say "  none" }
$deadline = (Get-Date).AddSeconds(10)
while ((Get-PortOwner $appPort) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 500 }
$owner = Get-PortOwner $appPort
if ($owner) {
  $p = Get-Process -Id $owner -ErrorAction SilentlyContinue
  $name = "another program"
  if ($p) { $name = $p.ProcessName }
  Quit ("port " + $appPort + " is used by " + $name + " (PID " + $owner + "). Close it, then run this again.")
}
if ($useHttps) {
  foreach ($port in @(3443, 3080)) {
    $owner = Get-PortOwner $port
    if ($owner) {
      Warn ("port " + $port + " is used by PID " + $owner + ": continuing without the HTTPS gateway")
      $useHttps = $false
    }
  }
}

# ---- 5. npm packages ----------------------------------------------------------------------
Step "[5/10] npm packages"
$lockFile = Join-Path $web "package-lock.json"
$stamp = Join-Path $web "node_modules\.ruzzco-lock-hash"
$hiddenLock = Join-Path $web "node_modules\.package-lock.json"
$lockHash = (Get-FileHash -LiteralPath $lockFile -Algorithm SHA256).Hash
$needInstall = $false
if (-not (Test-Path -LiteralPath (Join-Path $web "node_modules\next\package.json"))) {
  $needInstall = $true
} elseif (Test-Path -LiteralPath $stamp) {
  $needInstall = ([System.IO.File]::ReadAllText($stamp).Trim() -ne $lockHash)
} elseif (-not (Test-Path -LiteralPath $hiddenLock)) {
  $needInstall = $true
} else {
  # First run of this script: trust an install made with (or after) the current lock file.
  $needInstall = ((Get-Item -LiteralPath $lockFile).LastWriteTime -gt (Get-Item -LiteralPath $hiddenLock).LastWriteTime.AddMinutes(2))
}
Push-Location $web
try {
  if ($needInstall) {
    Say "  installing (npm ci; a few minutes the first time)"
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { Quit "npm ci failed (see above). Check the internet connection and that nothing has web\node_modules open, then run this again." }
  } else {
    Say "  up to date"
  }
  [System.IO.File]::WriteAllText($stamp, $lockHash, $utf8)
  & npx.cmd prisma generate --no-hints
  if ($LASTEXITCODE -ne 0) { Quit "prisma generate failed (see above)." }
} finally {
  Pop-Location
}

# ---- 6. database --------------------------------------------------------------------------
Step "[6/10] Database (MySQL in Docker)"
& docker.exe compose -f $compose up -d mysql
if ($LASTEXITCODE -ne 0) { Quit "docker compose could not start MySQL (see above)." }
$health = ""
$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline) {
  $health = "$(& docker.exe inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' ruzzco-mysql 2>$null)".Trim()
  if ($health -eq "healthy" -or $health -eq "none") { break }
  Start-Sleep -Seconds 3
}
if ($health -ne "healthy" -and $health -ne "none") { Quit ("MySQL isn't ready after 3 minutes (health: " + $health + "). See: docker logs ruzzco-mysql") }
Say "  MySQL is ready"

Push-Location $web
try {
  & npx.cmd prisma migrate deploy
  if ($LASTEXITCODE -ne 0) {
    Quit "prisma migrate deploy failed (see above). Check that DATABASE_URL in web/.env uses MYSQL_USER and MYSQL_PASSWORD from the root .env."
  }
  # The root password stays inside the container: the query reads it from the container's own environment.
  $query = 'MYSQL_PWD=$MYSQL_ROOT_PASSWORD mysql -uroot -N -B -e ''SELECT COUNT(*) FROM ruzzco_db.barbers'''
  $barbers = "$(& docker.exe exec ruzzco-mysql sh -c $query 2>$null)".Trim()
  if ($barbers -eq "0") {
    Say "  empty database: adding the barbers and services (prisma db seed)"
    & npx.cmd prisma db seed
    if ($LASTEXITCODE -ne 0) { Quit "prisma db seed failed (see above)." }
  } elseif ($barbers -notmatch '^\d+$') {
    Warn "couldn't count the barbers; if the POS shows none, run npx prisma db seed in web/"
  }
} finally {
  Pop-Location
}

# ---- 7. forecast --------------------------------------------------------------------------
Step "[7/10] Forecast service"
if ($NoForecast) {
  Say "  skipped (-NoForecast)"
} else {
  $model = Join-Path $repo "ml-service\artifacts\model.joblib"
  $logbook = @(Get-ChildItem -LiteralPath (Join-Path $repo "ml-service\data") -Filter *.xlsx -File -ErrorAction SilentlyContinue)
  & docker.exe image inspect ($project + "-ml-service") *> $null
  if ($LASTEXITCODE -ne 0) { Say "  first time: Docker builds the forecast service (several minutes, downloads about 500 MB)" }
  $trained = $false
  if (-not (Test-Path -LiteralPath $model) -and $logbook.Count -gt 0) {
    if (Ask "  There is no trained forecast model yet. Train it from the logbook now (a few minutes)?" $true) {
      & docker.exe compose -f $compose run --rm ml-service python train.py
      $trained = ($LASTEXITCODE -eq 0)
      if (-not $trained) { Warn "training failed (see above)" }
    }
  }
  if (Test-Path -LiteralPath $model) {
    & docker.exe compose -f $compose up -d ml-service
    if ($LASTEXITCODE -ne 0) {
      Warn "the forecast service didn't start (see above); the POS works without it"
    } else {
      if ($trained) { & docker.exe compose -f $compose restart ml-service *> $null }  # it loads the model at startup
      Say "  running on http://localhost:8001 (the owner sees it on the home page and /forecast)"
    }
  } else {
    Warn "no trained model (README, section 4): the forecast stays empty, everything else works"
  }
}

# ---- 8. app -------------------------------------------------------------------------------
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if ($Dev) {
  Step "[8/10] App (development mode, -Dev)"
} else {
  Step "[8/10] App (production)"
  if ($Rebuild -or (Test-BuildStale)) {
    Say "  the code changed since the last build: building (a few minutes)"
    Push-Location $web
    try { & npm.cmd run build } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) {
      Warn "the build failed (see above): starting in development mode instead (slower first page loads)"
      $Dev = $true
    }
  } else {
    Say "  build is up to date"
  }
}
$mode = "start"
if ($Dev) { $mode = "dev" }
$nextBin = Join-Path $web "node_modules\next\dist\bin\next"
# 127.0.0.1 only: phones reach the app through the HTTPS gateway, never over plain HTTP (slice 15).
$app = Start-Server "app" @(('"' + $nextBin + '"'), $mode, "--hostname", "127.0.0.1", "--port", "$appPort")
Say ("  next " + $mode + " started; waiting for http://localhost:" + $appPort)
$deadline = (Get-Date).AddSeconds(180)
$up = $false
while ((Get-Date) -lt $deadline) {
  if ($app.HasExited) { break }
  if (Test-AppAnswers) { $up = $true; break }
  Start-Sleep -Seconds 2
}
if (-not $up) {
  Show-LogTail "app"
  Quit "the app didn't answer on port $appPort (see the lines above)."
}
Say "  the app answers"

# ---- 9. HTTPS gateway ---------------------------------------------------------------------
Step "[9/10] HTTPS gateway for phone apps"
$gateway = $null
if (-not $useHttps) {
  Say "  skipped"
} else {
  $gateway = Start-Server "https" @(('"' + $httpsScript + '"'))
  $gatewayLog = Join-Path $logDir "https.log"
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not $gateway.HasExited) {
    if ((Test-Path -LiteralPath $gatewayLog) -and (Select-String -LiteralPath $gatewayLog -Pattern "phone setup:" -SimpleMatch -Quiet -ErrorAction SilentlyContinue)) { break }
    Start-Sleep -Milliseconds 500
  }
  if ($gateway.HasExited) {
    Show-LogTail "https"
    Warn "the HTTPS gateway stopped (see above): phones can't reach the POS until it runs again (they keep their sales)"
    $gateway = $null
  } else {
    Show-NewLines $gatewayLog "  [https] "
  }
}

# ---- 10. phones ---------------------------------------------------------------------------
Step "[10/10] Phones"
$firewallScript = Join-Path $PSScriptRoot "phone-firewall.ps1"
$rules = @(Get-NetFirewallRule -Group "Ruzzco phones" -ErrorAction SilentlyContinue)
if ($rules.Count -gt 0) {
  Say "  Windows Firewall lets phones in on any Wi-Fi (Ruzzco phones rules)"
} elseif (Test-Path -LiteralPath $firewallScript) {
  Say "  Windows Firewall may block phones on a Wi-Fi it hasn't seen before."
  if (Ask "  Let phones on the same Wi-Fi through Windows Firewall (asks for administrator rights once)?" $true) {
    & $firewallScript
  } else {
    Warn "if phones can't connect, run scripts\phone-firewall.ps1 or set this Wi-Fi to Private in Windows settings"
  }
} else {
  $public = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.NetworkCategory -eq "Public" })
  if ($public.Count -gt 0) {
    Warn ("Windows treats " + (($public | ForEach-Object { $_.Name }) -join ", ") + " as a public network and blocks phones there. Set it to Private: Settings > Network & internet > Wi-Fi > the network > Private.")
  }
}

$lan = @(Get-LanAddresses)
Write-Host ""
Write-Host ("Ruzzco is running (" + $(if ($Dev) { "development mode" } else { "production" }) + ").") -ForegroundColor Green
Say ("  On this PC:          http://localhost:" + $appPort)
if ($lan.Count -eq 0) {
  Warn "this PC isn't on a network, so phones can't reach it. Join the shop Wi-Fi."
} else {
  Say "  Phones on the same Wi-Fi as this PC (HTTPS only; plain http://<PC address>:3000 is closed):"
  if ($gateway) {
    Say ("    POS:                  https://" + $localName + ":3443  (or https://" + $lan[0] + ":3443)")
    Say ("    first-time setup:     http://" + $localName + ":3080  (or http://" + $lan[0] + ":3080): install the shop certificate, compare the fingerprint above")
    Say "    then approve each phone on the POS with the approval PIN (once per phone)"
  } else {
    Warn "the HTTPS gateway isn't running, so phones can't reach the POS. They keep their sales until it runs."
  }
}
Say "  Owner pages ask for the owner PIN."
Say ("  Logs: " + $logDir)
Write-Host "Leave this window open. Press Ctrl+C or close the window to stop Ruzzco." -ForegroundColor Green
if (-not $NoBrowser) { Start-Process ("http://localhost:" + $appPort) }

# ---- keep running ------------------------------------------------------------------------
$appErrors = Join-Path $logDir "app-errors.log"
$gatewayLog = Join-Path $logDir "https.log"
$gatewayErrors = Join-Path $logDir "https-errors.log"
try {
  while ($true) {
    Start-Sleep -Seconds 2
    Show-NewLines $appErrors "  [app] "
    if ($gateway) {
      Show-NewLines $gatewayLog "  [https] "
      Show-NewLines $gatewayErrors "  [https] "
    }
    if ($app.HasExited) {
      Show-LogTail "app"
      Quit "the app quit (see the lines above). Run this again to restart it." "Ruzzco stopped: "
    }
    if ($gateway -and $gateway.HasExited) {
      Show-LogTail "https"
      Warn "the HTTPS gateway stopped: phones can't reach the POS until it runs again (they keep their sales). Run this again to restart it."
      $gateway = $null
    }
  }
} finally {
  Stop-Started
}
