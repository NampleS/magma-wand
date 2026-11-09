# Magma Extension - 앱 실행기 (자동 업데이트되는 부분)
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

# 받아 둔 크롬 확장 묶음(zip)이 바뀌었으면 설치 폴더의 확장도 새로 풀어 둔다 (크롬을 다시 켜면 적용)
function Sync-ChromeExtension {
  $zip = Join-Path $Cache 'magma-wand-chrome.zip'
  if (-not (Test-Path $zip)) { return }
  $ext = Join-Path $Root 'chrome-extension'
  $mark = Join-Path $Root 'chrome-extension.sha'
  $h = (Get-FileHash $zip -Algorithm SHA256).Hash
  if ((Test-Path $mark) -and ((Get-Content $mark -Raw).Trim() -eq $h) -and (Test-Path $ext)) { return }
  $tmp = Join-Path $Root 'chrome-extension.new'
  if (Test-Path $tmp) { Remove-Item -Recurse -Force $tmp }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  if (Test-Path $ext) { Remove-Item -Recurse -Force $ext }
  Move-Item $tmp $ext
  Set-Content -Path $mark -Value $h -Encoding ASCII
  Write-Log "크롬 확장 폴더 갱신"
}

# 이름 바꾸기(마법봉 → Magma Extension): 예전에 설치한 컴퓨터도 앱 목록·바로가기 이름을 새 이름으로
function Update-Branding {
  $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagmaWand'
  if ((Test-Path $key) -and ((Get-ItemProperty $key -ErrorAction SilentlyContinue).DisplayName -ne 'Magma Extension')) {
    Set-ItemProperty $key DisplayName 'Magma Extension'; Write-Log '앱 목록 이름 → Magma Extension'
  }
  foreach ($pair in @(
      @([Environment]::GetFolderPath('Startup'), 'Magma 마법봉 (업데이트 확인).lnk', 'Magma Extension (업데이트 확인).lnk'),
      @([Environment]::GetFolderPath('Programs'), 'Magma (마법봉).lnk', 'Magma (Extension).lnk'))) {
    $old = Join-Path $pair[0] $pair[1]; $new = Join-Path $pair[0] $pair[2]
    if ((Test-Path -LiteralPath $old) -and -not (Test-Path -LiteralPath $new)) { Rename-Item -LiteralPath $old -NewName $pair[2]; Write-Log "바로가기 이름 → $($pair[2])" }
  }
  # 제거 도구도 새 이름을 알게 (예전·새 이름 바로가기 모두 지움)
  $un = Join-Path $Cache 'uninstall.ps1'; $unRoot = Join-Path $Root 'uninstall.ps1'
  if ((Test-Path $un) -and (-not (Test-Path $unRoot) -or (Get-FileHash $un).Hash -ne (Get-FileHash $unRoot).Hash)) { Copy-Item $un $unRoot -Force }
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

# ---------------- Better Magma 연동 (광고 숨기기) ----------------
# 사용자가 크롬에 'Better Magma' 확장을 설치해 두었으면, 그 확장의 코드를 데스크톱 앱에도 그대로 적용한다.
# (남의 코드를 이 프로젝트에 복사·배포하지 않고, 사용자가 이미 설치한 것을 쓴다)
# 이 코드는 페이지가 시작되기 전에 들어가야 제대로 동작하므로, 화면(타깃)마다 연결을 열어 둔 채
# '새 문서마다 실행' 스크립트로 등록한다. 연결을 닫으면 등록이 풀리므로 Magma가 켜져 있는 동안 유지한다.
function Find-BetterMagma {
  $roots = @(
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\User Data'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\User Data')
  )
  foreach ($root in $roots) {
    if (-not (Test-Path $root)) { continue }
    $mans = Get-ChildItem -Path $root -Filter 'manifest.json' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -match '\\Extensions\\' }
    foreach ($m in $mans) {
      try {
        $j = Get-Content $m.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($j.name -ne 'Better Magma') { continue }
        $dir = Split-Path $m.FullName -Parent
        $src = ''
        foreach ($cs in $j.content_scripts) {
          foreach ($f in $cs.js) { $src += [IO.File]::ReadAllText((Join-Path $dir $f), [Text.Encoding]::UTF8) + "`n;`n" }
        }
        if ($src) { Write-Log "Better Magma 찾음: v$($j.version)"; return $src }
      } catch { }
    }
  }
  return $null
}
$BMSrc = $null
$Persist = @{}   # 타깃 id → 열어 둔 연결
$StartedAt = $null; $Reloaded = @{}
function Ensure-StartScript($t) {
  if (-not $BMSrc) { return }
  $p = $Persist[$t.id]
  if ($p -and $p.ws.State -eq [Net.WebSockets.WebSocketState]::Open) { return }
  $ws = New-Object System.Net.WebSockets.ClientWebSocket
  if (-not $ws.ConnectAsync([Uri]$t.webSocketDebuggerUrl, $CT).Wait(4000)) { $ws.Dispose(); return }
  $id = 0
  # '새 문서마다 실행' 등록은 Page 기능이 켜져 있어야 동작하고, 끄면 풀린다(실측). 그래서 켜 둔 채 유지한다.
  foreach ($c in @(
      @{ method = 'Page.enable'; params = @{} },
      @{ method = 'Page.addScriptToEvaluateOnNewDocument'; params = @{ source = $BMSrc } },
      @{ method = 'Runtime.evaluate'; params = @{ expression = $BMSrc } })) {
    $id++
    $json = @{ id = $id; method = $c.method; params = $c.params } | ConvertTo-Json -Compress -Depth 8
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, [Text.Encoding]::UTF8.GetBytes($json))
    $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, $CT).Wait()
  }
  # 실행기가 방금 Magma를 열었다면(아직 그림을 그리기 전) 한 번 새로고침해서 처음부터 적용
  # (첫 화면이 등록보다 먼저 떠 버리면 광고 칸 자리가 화면 배치에 남는다)
  if ($script:StartedAt -and ((Get-Date) - $script:StartedAt).TotalSeconds -lt 30 -and -not $script:Reloaded.ContainsKey($t.id)) {
    $script:Reloaded[$t.id] = $true
    $id++
    $json = @{ id = $id; method = 'Page.reload'; params = @{} } | ConvertTo-Json -Compress
    $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, [Text.Encoding]::UTF8.GetBytes($json))
    $ws.SendAsync($seg, [Net.WebSockets.WebSocketMessageType]::Text, $true, $CT).Wait()
    Write-Log '광고 숨기기 적용을 위해 첫 화면 한 번 새로고침'
  }
  $Persist[$t.id] = @{ ws = $ws; task = $null; buf = (New-Object byte[] 65536) }
  Drain-Persist
  Write-Log "광고 숨기기 등록: $($t.url)"
}
# 켜 둔 Page 기능이 보내는 알림 메시지를 계속 비워 준다 (안 읽으면 메모리에 쌓임)
function Drain-Persist {
  foreach ($k in @($Persist.Keys)) {
    $p = $Persist[$k]
    try {
      for ($n = 0; $n -lt 2000; $n++) {
        if ($p.task -and -not $p.task.IsCompleted) { break }
        if ($p.task -and ($p.task.IsFaulted -or $p.task.IsCanceled -or $p.task.Result.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close)) { throw 'closed' }
        $seg = New-Object 'System.ArraySegment[byte]' -ArgumentList (, $p.buf)
        $p.task = $p.ws.ReceiveAsync($seg, $CT)
      }
    } catch {
      try { $p.ws.Dispose() } catch { }
      $Persist.Remove($k)
    }
  }
}
function Close-Persist {
  foreach ($p in $Persist.Values) { try { $p.ws.Dispose() } catch { } }
  $Persist.Clear()
}

$WandSrc = $null; $WandVer = $null
function Load-Wand {
  $p = Join-Path $Cache 'wand.js'
  $script:WandSrc = [IO.File]::ReadAllText($p, [Text.Encoding]::UTF8)
  $script:WandVer = Get-LocalVersion
}

function Sync-Target($t) {
  # 끝까지 시작된(ready) 경우만 '들어 있음'으로 본다 (시작하다 멈췄으면 다시 넣음)
  $check = @{ method = 'Runtime.evaluate'; params = @{ expression = "(window.__magmaWand && window.__magmaWand.ready && window.__magmaWand.version) || ''"; returnByValue = $true } }
  $r = Invoke-Cdp $t.webSocketDebuggerUrl @($check) 4000
  $have = $r[0].result.result.value
  if ($have -eq $WandVer) { return }
  # 화면에 이미 더 높은 버전이 들어 있으면(시험용 등) 넣지 않는다 — 넣어도 옛 버전은 스스로 물러나서 1.5초마다 헛되이 다시 넣게 됨
  if ($have -match '^\d+\.\d+\.\d+$') { try { if ([version]$have -gt [version]$WandVer) { return } } catch { } }
  # 아직 없거나 옛 버전이면 넣는다 (wand.js가 옛 버전을 스스로 걷어낸다)
  $inject = @{ method = 'Runtime.evaluate'; params = @{ expression = $WandSrc } }
  Invoke-Cdp $t.webSocketDebuggerUrl @($inject) 8000 | Out-Null
  Write-Log "마법봉 넣음 v$WandVer ($have → $WandVer) $($t.url)"
}

# ---------------- 창 띄우기 ----------------
# 확인 창이 다른 창 뒤에 숨지 않게: 화면 밖의 아주 작은 '맨 위' 창을 실제로 띄워 주인으로 삼는다 (안 띄운 주인 창이면 뒤에 숨는 일이 있었음)
function New-Owner {
  Add-Type -AssemblyName System.Windows.Forms, System.Drawing
  $o = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true; ShowInTaskbar = $false; StartPosition = 'Manual'; Location = (New-Object System.Drawing.Point(-3000, -3000)); Size = (New-Object System.Drawing.Size(1, 1)); FormBorderStyle = 'None' }
  $o.Show(); $o.Activate()
  return $o
}
function Ask-YesNo($text) {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Owner
  $r = [System.Windows.Forms.MessageBox]::Show($owner, $text, 'Magma Extension',
    [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Question)
  $owner.Dispose()
  return ($r -eq [System.Windows.Forms.DialogResult]::Yes)
}
function Show-Info($text) {
  Add-Type -AssemblyName System.Windows.Forms
  $owner = New-Owner
  [System.Windows.Forms.MessageBox]::Show($owner, $text, 'Magma Extension') | Out-Null
  $owner.Dispose()
}

function Test-MagmaRunning { return [bool](Get-Process -Name 'Magma' -ErrorAction SilentlyContinue) }
# Magma 끄기: 새 Magma는 창을 닫아도 뒤에서 계속 돈다 → 정상 종료를 청한 뒤 안 꺼지면 강제로.
# taskkill이 내는 경고(stderr)는 PowerShell 5.1에서 오류로 바뀌어 실행기가 멈췄다($ErrorActionPreference Stop) → 경고는 무시.
function Stop-Magma {
  $old = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try {
    & cmd.exe /c "taskkill /IM Magma.exe >nul 2>&1"
    for ($i = 0; $i -lt 12 -and (Test-MagmaRunning); $i++) { Start-Sleep -Milliseconds 250 }
    if (Test-MagmaRunning) { & cmd.exe /c "taskkill /IM Magma.exe /F >nul 2>&1" }
    for ($i = 0; $i -lt 20 -and (Test-MagmaRunning); $i++) { Start-Sleep -Milliseconds 250 }
    Start-Sleep -Milliseconds 500
  } finally { $ErrorActionPreference = $old }
}
function Test-Port { return $null -ne (Get-Targets) }

# ================= 실행 =================
$magma = Find-Magma

if ($Repair) {
  # 로그인할 때 한 번: 업데이트 확인 + Magma 업데이트로 원래대로 돌아간 바로가기 다시 연결
  try { Update-Files | Out-Null } catch { Write-Log "업데이트 확인 실패: $_" }
  try { Sync-ChromeExtension } catch { Write-Log "크롬 확장 갱신 실패: $_" }
  try { Update-Branding } catch { Write-Log "이름 바꾸기 실패: $_" }
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
  try { Update-Branding } catch { Write-Log "이름 바꾸기 실패: $_" }
  Repair-Shortcuts $magma
  $magmaArgs = @("--remote-debugging-port=$Port", '--remote-debugging-address=127.0.0.1')
  if (-not (Test-Port)) {
    if (Test-MagmaRunning) {
      if (-not (Ask-YesNo "Magma가 이미 켜져 있어요.`nMagma Extension을 쓰려면 Magma를 한 번 다시 열어야 해요. 지금 다시 열까요?")) {
        exit 0
      }
      Stop-Magma
    }
    Write-Log "Magma 열기: $magma"
    Start-Process -FilePath $magma -ArgumentList $magmaArgs
    $StartedAt = Get-Date
    for ($i = 0; $i -lt 60 -and -not (Test-Port); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Port)) { Write-Log 'Magma 원격 연결 실패'; Show-Info 'Magma에 연결하지 못했어요. Magma가 업데이트로 막았을 수 있어요.'; exit 1 }
  }

  Load-Wand
  try { $BMSrc = Find-BetterMagma } catch { $BMSrc = $null }
  $lastUpdate = Get-Date
  $misses = 0
  while ($true) {
    $targets = Get-Targets
    if ($null -eq $targets) {
      if (-not (Test-MagmaRunning)) { $misses++ } else { $misses = 0 }
      if ($misses -ge 4) {
        # Magma 앱 업데이트는 앱을 껐다가 '스스로' 다시 켠다(실행기를 거치지 않아 원격 연결 포트가 없음).
        # 2분 동안 지켜보다가 다시 켜지면: 업데이트가 덮어쓴 바로가기를 고치고, 다시 열어 Magma Extension을 켤지 묻는다.
        Write-Log 'Magma 종료 → 다시 켜지는지 2분 지켜봄'
        $back = $false
        for ($w = 0; $w -lt 120 -and -not $back; $w++) { Start-Sleep -Seconds 1; $back = Test-MagmaRunning }
        if (-not $back) { Write-Log 'Magma 종료 → 실행기 종료'; break }
        Start-Sleep -Seconds 4
        if (Test-Port) { $misses = 0; continue }   # 포트가 있으면(실행기를 거쳐 켜짐) 그대로 이어서
        Write-Log 'Magma가 업데이트 등으로 실행기 없이 다시 켜짐'
        $magma = Find-Magma
        try { Repair-Shortcuts $magma } catch { Write-Log "바로가기 고치기 실패: $_" }
        if (-not (Ask-YesNo "Magma가 업데이트로 다시 켜졌어요.`nMagma Extension을 쓰려면 Magma를 한 번 다시 열어야 해요. 지금 다시 열까요?")) { break }
        Stop-Magma
        Write-Log "Magma 다시 열기: $magma"
        Start-Process -FilePath $magma -ArgumentList $magmaArgs
        for ($i = 0; $i -lt 60 -and -not (Test-Port); $i++) { Start-Sleep -Milliseconds 500 }
        if (-not (Test-Port)) { Write-Log 'Magma 원격 연결 실패'; break }
        $misses = 0; Load-Wand; continue
      }
    } else {
      $misses = 0
      foreach ($t in $targets) {
        if ($t.type -eq 'page' -and $t.url -match '^https://([a-z0-9-]+\.)?magma\.com/' -and $t.webSocketDebuggerUrl) {
          try { Drain-Persist; Ensure-StartScript $t } catch { Write-Log "광고 숨기기 실패: $_" }
          try { Sync-Target $t } catch { Write-Log "넣기 실패: $_" }
        }
      }
    }
    # 5분마다 새 버전 확인 → 받으면 다음 바퀴에서 열린 화면에 바로 바꿔 끼움
    if (((Get-Date) - $lastUpdate).TotalMinutes -ge [double]$Cfg.checkMinutes) {
      $lastUpdate = Get-Date
      try { Update-Files | Out-Null; Load-Wand; Sync-ChromeExtension } catch { Write-Log "업데이트 확인 실패: $_" }
    }
    Start-Sleep -Milliseconds 1500
  }
} finally {
  Close-Persist
  $mutex.ReleaseMutex(); $mutex.Dispose()
}
