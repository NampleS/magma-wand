# Magma 마법봉 설치
# - 파일을 %LOCALAPPDATA%\MagmaWand 에 넣고
# - Magma 앱 바로가기가 마법봉을 거쳐 열리도록 연결하고
# - 로그인할 때마다 업데이트 확인 + 바로가기 재연결을 하도록 등록한다
param(
  [string]$Source = '',   # 시험용: 이 폴더에서 파일을 복사 (비우면 인터넷에서 받음)
  [string]$Base = 'https://github.com/NampleS/magma-wand/releases/latest/download/',
  [switch]$NoSystem,      # 시험용: 바로가기·시작프로그램·등록 정보는 건드리지 않음
  [switch]$Quiet          # 질문 없이 진행
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }

$Root = if ($env:MAGMAWAND_ROOT) { $env:MAGMAWAND_ROOT } else { Join-Path $env:LOCALAPPDATA 'MagmaWand' }
$Cache = Join-Path $Root 'cache'
$Port = 39271

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Ask($q) { if ($Quiet) { return $false }; $a = Read-Host "$q (Y/N)"; return ($a -match '^[yYㅛ]') }

Say ''
Say '  ┌──────────────────────────────┐' 'Magenta'
Say '  │   Magma 마법봉 설치          │' 'Magenta'
Say '  └──────────────────────────────┘' 'Magenta'
Say ''

function Get-File($name, $dest) {
  if ($Source) { Copy-Item -Force (Join-Path $Source $name) $dest }
  else { Invoke-WebRequest -Uri ($Base + $name) -OutFile $dest -TimeoutSec 60 -UseBasicParsing }
  try { Unblock-File -Path $dest } catch { }
}

try {
  # 실행 중인 마법봉 실행기는 잠시 멈춤 (파일 교체를 위해)
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'MagmaWand' -and $_.CommandLine -match 'boot\.ps1|launcher\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  Say '파일 받는 중…'
  New-Item -ItemType Directory -Force -Path $Root, $Cache | Out-Null
  foreach ($f in @('boot.ps1', 'run.vbs', 'uninstall.ps1')) { Get-File $f (Join-Path $Root $f) }
  Get-File 'version.json' (Join-Path $Cache 'version.json')
  $ver = Get-Content (Join-Path $Cache 'version.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($name in $ver.files.PSObject.Properties.Name) {
    $dest = Join-Path $Cache $name
    Get-File $name $dest
    if ((Get-FileHash $dest -Algorithm SHA256).Hash -ne [string]$ver.files.$name) { throw "파일이 손상됐어요: $name" }
  }
  $zip = Join-Path $Root 'chrome.zip'
  Get-File 'magma-wand-chrome.zip' $zip
  $ext = Join-Path $Root 'chrome-extension'
  if (Test-Path $ext) { Remove-Item -Recurse -Force $ext }
  Expand-Archive -Path $zip -DestinationPath $ext -Force
  Remove-Item $zip -Force

  # Magma 찾기
  $magma = $null
  $cands = @(Join-Path $env:LOCALAPPDATA 'Programs\magma-app\Magma.exe')
  foreach ($hive in @('HKCU:', 'HKLM:')) {
    foreach ($k in Get-ChildItem "$hive\Software\Microsoft\Windows\CurrentVersion\Uninstall" -ErrorAction SilentlyContinue) {
      $p = Get-ItemProperty $k.PSPath -ErrorAction SilentlyContinue
      if ($p.DisplayName -like 'Magma*' -and $p.InstallLocation) { $cands += (Join-Path $p.InstallLocation 'Magma.exe') }
    }
  }
  foreach ($c in $cands) { if ($c -and (Test-Path $c)) { $magma = $c; break } }

  $cfg = [ordered]@{ base = $Base; port = $Port; magma = $(if ($magma) { $magma } else { '' }) }
  [IO.File]::WriteAllText((Join-Path $Root 'config.json'), ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

  $vbs = Join-Path $Root 'run.vbs'
  $wscript = Join-Path $env:WINDIR 'System32\wscript.exe'
  if (-not $NoSystem) {
    $shell = New-Object -ComObject WScript.Shell
    # 로그인할 때마다: 업데이트 확인 + Magma 바로가기 다시 연결
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Magma 마법봉 (업데이트 확인).lnk'
    $s = $shell.CreateShortcut($startup)
    $s.TargetPath = $wscript; $s.Arguments = '"' + $vbs + '" /repair'; $s.WorkingDirectory = $Root
    $s.Save()

    # 앱 목록(설정 > 앱)에 제거 항목 등록
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagmaWand'
    New-Item -Path $key -Force | Out-Null
    $un = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'uninstall.ps1') + '"'
    Set-ItemProperty $key DisplayName 'Magma 마법봉'
    Set-ItemProperty $key DisplayVersion ([string]$ver.version)
    Set-ItemProperty $key Publisher 'NampleS'
    Set-ItemProperty $key UninstallString $un
    Set-ItemProperty $key InstallLocation $Root
    Set-ItemProperty $key NoModify 1 -Type DWord
    Set-ItemProperty $key NoRepair 1 -Type DWord
    if ($magma) { Set-ItemProperty $key DisplayIcon "$magma,0" }

    if ($magma) {
      # Magma 바로가기(바탕화면·시작 메뉴·작업 표시줄)를 마법봉 경유로 연결
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Cache 'launcher.ps1') -Repair
      # 바로가기가 하나도 없으면 시작 메뉴에 하나 만든다
      $progs = [Environment]::GetFolderPath('Programs')
      $linked = Get-ChildItem $progs, ([Environment]::GetFolderPath('Desktop')) -Filter '*.lnk' -Recurse -Depth 2 -ErrorAction SilentlyContinue |
        Where-Object { $shell.CreateShortcut($_.FullName).Arguments -like "*$vbs*" }
      if (-not $linked) {
        $s = $shell.CreateShortcut((Join-Path $progs 'Magma (마법봉).lnk'))
        $s.TargetPath = $wscript; $s.Arguments = '"' + $vbs + '"'; $s.IconLocation = "$magma,0"
        $s.WorkingDirectory = Split-Path $magma -Parent
        $s.Save()
      }
    }
  }

  Say ''
  Say "설치 완료! (v$($ver.version))" 'Green'
  Say ''
  if ($magma) {
    Say '이제 평소처럼 Magma를 열면 마법봉이 함께 켜져요.' 'White'
    Say '새 버전이 나오면 자동으로 받아요. 따로 할 일은 없어요.'
    if (-not $NoSystem) {
      if (Get-Process -Name Magma -ErrorAction SilentlyContinue) {
        if (Ask '지금 켜져 있는 Magma를 다시 열어서 바로 쓸까요?') {
          & taskkill.exe /IM Magma.exe 2>$null | Out-Null
          Start-Sleep -Seconds 2
          & taskkill.exe /IM Magma.exe /F 2>$null | Out-Null
          Start-Sleep -Milliseconds 800
          Start-Process $wscript -ArgumentList ('"' + $vbs + '"')
        }
      } elseif (Ask '지금 Magma를 열어 볼까요?') {
        Start-Process $wscript -ArgumentList ('"' + $vbs + '"')
      }
    }
  } else {
    Say 'Magma 앱이 없어서 앱 연결은 건너뛰었어요.' 'Yellow'
    Say '나중에 Magma 앱을 설치하면, 다음 로그인 때 자동으로 연결돼요.'
  }
  Say ''
  Say '크롬(웹 magma.com)에서도 쓰고 싶다면:' 'White'
  Say "  1) 크롬 주소창에 chrome://extensions 입력"
  Say "  2) 오른쪽 위 '개발자 모드' 켜기"
  Say "  3) '압축해제된 확장 프로그램을 로드합니다' → 아래 폴더 선택"
  Say "     $ext"
  if (-not $NoSystem -and (Ask '그 폴더를 지금 열어 둘까요?')) { Start-Process explorer.exe $ext }
  Say ''
  Say '지우고 싶으면: 설정 > 앱 > 설치된 앱 > "Magma 마법봉" > 제거'
} catch {
  Say ''
  Say "설치 중 문제가 생겼어요: $_" 'Red'
  Say '인터넷 연결을 확인하고 다시 실행해 주세요.'
}
if (-not $Quiet) { Say ''; Read-Host '엔터를 누르면 창이 닫혀요' | Out-Null }
