# Magma 마법봉 - 앱 실행기 (자동 업데이트되는 부분)
# 하는 일:
#  1) Magma 앱을 "원격 연결 포트"(이 컴퓨터 안에서만 열림)를 켠 채로 연다
#  2) 앱 안의 magma.com 화면마다 마법봉(wand.js)을 넣는다. 새 버전이 오면 새로고침 없이 바꿔 끼운다
#  3) Magma 바로가기들이 이 실행기를 거치도록 고친다 (-Repair)
param([switch]$Repair)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$Cache = $PSScriptRoot
$Root = Split-Path $Cache -Parent
$LogPath = Join-Path $Root 'launcher.log'

function Write-Log($msg) {
  try {
    if ((Test-Path $LogPath) -and (Get-Item $LogPath).Length -gt 512KB) { Remove-Item $LogPath -Force }
    Add-Content -Path $LogPath -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $msg) -Encoding UTF8
  } catch { }
}

function Get-Config {
  $p = Join-Path $Root 'config.json'
  $cfg = [ordered]@{ base = 'https://github.com/NampleS/magma-wand/releases/latest/download/'; port = 39271; magma = ''; checkMinutes = 5 }
  if (Test-Path $p) {
    $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($k in @('base', 'port', 'magma', 'checkMinutes')) { if ($j.$k) { $cfg[$k] = $j.$k } }
  }
  return $cfg
}
$Cfg = Get-Config
$Port = [int]$Cfg.port

# ---------------- Magma 찾기 ----------------
function Find-Magma {
  if ($Cfg.magma -and (Test-Path $Cfg.magma)) { return $Cfg.magma }
  $cands = @(Join-Path $env:LOCALAPPDATA 'Programs\magma-app\Magma.exe')
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    $keys = Get-ChildItem "$hive\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue
    foreach ($k in $keys) {
      $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
      if ($p.DisplayName -like 'Magma*' -and $p.InstallLocation) { $cands += (Join-Path $p.InstallLocation 'Magma.exe') }
    }
  }
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { return $c } }
  return $null
}

# ---------------- 바로가기 고치기 ----------------
function Get-ShortcutDirs {
  if ($env:MAGMAWAND_SHORTCUT_DIRS) { return $env:MAGMAWAND_SHORTCUT_DIRS -split ';' | Where-Object { Test-Path $_ } } # 시험용
  $dirs = @(
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('Programs'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar'),
    (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch')
  )
  return $dirs | Where-Object { $_ -and (Test-Path $_) }
}

function Repair-Shortcuts($magmaExe) {
  if (-not $magmaExe) { return }
  $shell = New-Object -ComObject WScript.Shell
  $vbs = Join-Path $Root 'run.vbs'
  $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
  $backupPath = Join-Path $Root 'shortcuts-backup.json'
  $backup = @{}
  if (Test-Path $backupPath) {
    $b = Get-Content $backupPath -Raw -Encoding UTF8 | ConvertFrom-Json
    foreach ($pr in $b.PSObject.Properties) { $backup[$pr.Name] = $pr.Value }
  }
  $changed = $false
  foreach ($dir in Get-ShortcutDirs) {
    foreach ($lnk in Get-ChildItem -Path $dir -Filter '*.lnk' -Recurse -Depth 2 -ErrorAction SilentlyContinue) {
      try {
        $s = $shell.CreateShortcut($lnk.FullName)
        $isMagma = $s.TargetPath -and ([IO.Path]::GetFileName($s.TargetPath) -ieq 'Magma.exe')
        # 다른(옛) 설치 위치의 마법봉을 가리키는 바로가기도 지금 위치로 다시 연결
        $isStale = $s.TargetPath -and ([IO.Path]::GetFileName($s.TargetPath) -ieq 'wscript.exe') -and
          ($s.Arguments -like '*run.vbs*') -and ($s.Arguments -ne ('"' + $vbs + '"')) -and ($s.IconLocation -like '*Magma.exe*')
        if ($isMagma -or $isStale) {
          if ($isMagma) {
            $backup[$lnk.FullName] = @{ target = $s.TargetPath; args = $s.Arguments; icon = $s.IconLocation; dir = $s.WorkingDirectory }
          } elseif (-not $backup.ContainsKey($lnk.FullName)) {
            $backup[$lnk.FullName] = @{ target = $magmaExe; args = ''; icon = ''; dir = (Split-Path $magmaExe -Parent) }
          }
          $s.TargetPath = $wscript
          $s.Arguments = '"' + $vbs + '"'
          $s.IconLocation = "$magmaExe,0"
          $s.WorkingDirectory = Split-Path $magmaExe -Parent
          $s.Save()
          $changed = $true
          Write-Log "바로가기 연결: $($lnk.FullName)"
        }
      } catch { Write-Log "바로가기 실패: $($lnk.FullName) $_" }
    }
  }
  if ($changed) { ($backup | ConvertTo-Json -Depth 4) | Set-Content -Path $backupPath -Encoding UTF8 }
}

# ---------------- 업데이트 ----------------
function Update-Files {
  $vurl = $Cfg.base + 'version.json?t=' + [DateTime]::UtcNow.Ticks
  $raw = (Invoke-WebRequest -Uri $vurl -TimeoutSec 10 -UseBasicParsing).Content
  if ($raw -is [byte[]]) { $raw = [Text.Encoding]::UTF8.GetString($raw) }
  $remote = $raw | ConvertFrom-Json
  $incoming = Join-Path $Cache 'incoming'
  New-Item -ItemType Directory -Force -Path $incoming | Out-Null
  $got = @()
  foreach ($name in $remote.files.PSObject.Properties.Name) {
    $want = [string]$remote.files.$name
    $dest = Join-Path $Cache $name
    if ((Test-Path $dest) -and ((Get-FileHash $dest -Algorithm SHA256).Hash -eq $want)) { continue }
    $tmp = Join-Path $incoming $name
    Invoke-WebRequest -Uri ($Cfg.base + $name) -OutFile $tmp -TimeoutSec 60 -UseBasicParsing
    if ((Get-FileHash $tmp -Algorithm SHA256).Hash -ne $want) { throw "받은 파일이 손상됐어요: $name" }
    $got += $name
  }
  foreach ($name in $got) { Move-Item -Force (Join-Path $incoming $name) (Join-Path $Cache $name) }
  [IO.File]::WriteAllText((Join-Path $Cache 'version.json'), $raw, (New-Object Text.UTF8Encoding $false))
  if ($got.Count) { Write-Log "업데이트: v$($remote.version) ($($got -join ', '))" }
  return $remote.version
}

function Get-LocalVersion {
  $p = Join-Path $Cache 'version.json'
  if (Test-Path $p) { return (Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json).version }
  return ''
}

# ---------------- 원격 연결(CDP) ----------------
$CT = [Threading.CancellationToken]::None

function Receive-Ws($ws, [datetime]$deadline) {
  $buf = New-Object byte[] 65536
  $ms = New-Object IO.MemoryStream
  do {
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $buf)
    $t = $ws.ReceiveAsync($seg, $CT)
    $remain = [int][Math]::Max(1, ($deadline - (Get-Date)).TotalMilliseconds)
    if (-not $t.Wait($remain)) { return $null }
    $r = $t.Result
    $ms.Write($buf, 0, $r.Count)
  } while (-not $r.EndOfMessage)
  return [Text.Encoding]::UTF8.GetString($ms.ToArray())
}

# 명령 여러 개를 차례로 보내고 각 응답을 돌려준다
function Invoke-Cdp([string]$wsUrl, [object[]]$commands, [int]$timeoutMs = 8000) {
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  try {
    if (-not $ws.ConnectAsync([Uri]$wsUrl, $CT).Wait($timeoutMs)) { throw '연결 시간 초과' }
    $out = @()
    $id = 0
    foreach ($c in $commands) {
      $id++
      $json = @{ id = $id; method = $c.method; params = $c.params } | ConvertTo-Json -Compress -Depth 8
      $bytes = [Text.Encoding]::UTF8.GetBytes($json)
      $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $bytes)
      $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, $CT).Wait()
      $deadline = (Get-Date).AddMilliseconds($timeoutMs)
      $resp = $null
      while ($true) {
        $m = Receive-Ws $ws $deadline
        if ($null -eq $m) { break }
        $o = $m | ConvertFrom-Json
        if ($o.id -eq $id) { $resp = $o; break }
      }
      $out += , $resp
    }
    try { $ws.CloseAsync([Net.WebSockets.WebSocketCloseStatus]::NormalClosure, '', $CT).Wait(1500) | Out-Null } catch { }
    return , $out
  } finally { $ws.Dispose() }
}

function Get-Targets {
  try { return Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/list" -TimeoutSec 2 -UseBasicParsing } catch { return $null }
}

$WandSrc = $null; $WandVer = $null
function Load-Wand {
  $p = Join-Path $Cache 'wand.js'
  $script:WandSrc = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
  $script:WandVer = Get-LocalVersion
}

function Sync-Target($t) {
  $check = @{ method = 'Runtime.evaluate'; params = @{ expression = "(window.__magmaWand && window.__magmaWand.version) || ''"; returnByValue = $true } }
  $r = Invoke-Cdp $t.webSocketDebuggerUrl @($check) 4000
  $have = $r[0].result.result.value
  if ($have -eq $WandVer) { return }
  # 아직 없거나 옛 버전이면 넣는다 (wand.js가 옛 버전을 스스로 걷어낸다)
  $inject = @{ method = 'Runtime.evaluate'; params = @{ expression = $WandSrc } }
  Invoke-Cdp $t.webSocketDebuggerUrl @($inject) 8000 | Out-Null
  Write-Log "마법봉 넣음 v$WandVer ($have → $WandVer) $($t.url)"
}

# ---------------- 창 띄우기 ----------------
function Ask-YesNo($text) {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  $r = [System.Windows.Forms.MessageBox]::Show($owner, $text, 'Magma 마법봉',
    [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
  $owner.Dispose()
  return ($r -eq [System.Windows.Forms.DialogResult]::Yes)
}
function Show-Info($text) {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }
  [System.Windows.Forms.MessageBox]::Show($owner, $text, 'Magma 마법봉') | Out-Null
  $owner.Dispose()
}

function Test-MagmaRunning { return [bool](Get-Process -Name 'Magma' -ErrorAction SilentlyContinue) }
function Test-Port { return $null -ne (Get-Targets) }

# ================= 실행 =================
$magma = Find-Magma

if ($Repair) {
  # 로그인할 때 한 번: 업데이트 확인 + Magma 업데이트로 원래대로 돌아간 바로가기 다시 연결
  try { Update-Files | Out-Null } catch { Write-Log "업데이트 확인 실패: $_" }
  Repair-Shortcuts $magma
  exit 0
}

if (-not $magma) { Show-Info "Magma 앱을 찾지 못했어요.`nMagma를 설치한 뒤 다시 실행해 주세요."; exit 1 }

# 실행기는 하나만
$created = $false
$mutex = New-Object Threading.Mutex($true, 'Local\MagmaWandLauncher', [ref]$created)
if (-not $created) {
  # 이미 실행기가 돌고 있음 → Magma 창만 앞으로
  Start-Process -FilePath $magma
  exit 0
}

try {
  Repair-Shortcuts $magma
  $magmaArgs = @("--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1')
  if (-not (Test-Port)) {
    if (Test-MagmaRunning) {
      if (-not (Ask-YesNo "Magma가 이미 켜져 있어요.`n마법봉을 쓰려면 Magma를 한 번 다시 열어야 해요. 지금 다시 열까요?")) {
        exit 0
      }
      & taskkill.exe /IM Magma.exe 2>$null | Out-Null
      for ($i = 0; $i -lt 12 -and (Test-MagmaRunning); $i++) { Start-Sleep -Milliseconds 250 }
      if (Test-MagmaRunning) { & taskkill.exe /IM Magma.exe /F 2>$null | Out-Null }
      for ($i = 0; $i -lt 20 -and (Test-MagmaRunning); $i++) { Start-Sleep -Milliseconds 250 }
      Start-Sleep -Milliseconds 500
    }
    Write-Log "Magma 열기: $magma"
    Start-Process -FilePath $magma -ArgumentList $magmaArgs
    for ($i = 0; $i -lt 60 -and -not (Test-Port); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Port)) { Write-Log 'Magma 원격 연결 실패'; Show-Info 'Magma에 연결하지 못했어요. Magma가 업데이트로 막았을 수 있어요.'; exit 1 }
  }

  Load-Wand
  $lastUpdate = Get-Date
  $misses = 0
  while ($true) {
    $targets = Get-Targets
    if ($null -eq $targets) {
      if (-not (Test-MagmaRunning)) { $misses++ } else { $misses = 0 }
      if ($misses -ge 4) { Write-Log 'Magma 종료 → 실행기 종료'; break }
    } else {
      $misses = 0
      foreach ($t in $targets) {
        if ($t.type -eq 'page' -and $t.url -match '^https://([a-z0-9-]+\.)?magma\.com/' -and $t.webSocketDebuggerUrl) {
          try { Sync-Target $t } catch { Write-Log "넣기 실패: $_" }
        }
      }
    }
    # 5분마다 새 버전 확인 → 받으면 다음 바퀴에서 열린 화면에 바로 바꿔 끼움
    if (((Get-Date) - $lastUpdate).TotalMinutes -ge [double]$Cfg.checkMinutes) {
      $lastUpdate = Get-Date
      try { Update-Files | Out-Null; Load-Wand } catch { Write-Log "업데이트 확인 실패: $_" }
    }
    Start-Sleep -Milliseconds 1500
  }
} finally {
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
