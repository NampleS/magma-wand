# Magma 마법봉 - 시작 도우미 (설치 때만 바뀌는 고정 부분)
# 새 버전이 있으면 먼저 받아 두고, 받아 둔 실행기(cache\launcher.ps1)를 실행한다.
param([switch]$Repair)

$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = $PSScriptRoot
$Cache = Join-Path $Root 'cache'

function Get-Base {
  $p = Join-Path $Root 'config.json'
  if (Test-Path $p) {
    try { $j = Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json; if ($j.base) { return $j.base } } catch { }
  }
  return 'https://github.com/NampleS/magma-wand/releases/latest/download/'
}

# 새 버전 받기 (실패해도 받아 둔 것으로 계속 실행)
try {
  $base = Get-Base
  $raw = (Invoke-WebRequest -Uri ($base + 'version.json?t=' + [DateTime]::UtcNow.Ticks) -TimeoutSec 6 -UseBasicParsing).Content
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
    Invoke-WebRequest -Uri ($base + $name) -OutFile $tmp -TimeoutSec 30 -UseBasicParsing
    if ((Get-FileHash $tmp -Algorithm SHA256).Hash -ne $want) { throw "hash mismatch: $name" }
    $got += $name
  }
  foreach ($name in $got) { Move-Item -Force (Join-Path $incoming $name) (Join-Path $Cache $name) }
  [IO.File]::WriteAllText((Join-Path $Cache 'version.json'), $raw, (New-Object Text.UTF8Encoding $false))
} catch { }

$launcher = Join-Path $Cache 'launcher.ps1'
if (Test-Path $launcher) {
  & $launcher -Repair:$Repair
} elseif (-not $Repair) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show('마법봉 파일이 없어요. 설치 파일을 다시 실행해 주세요.', 'Magma 마법봉') | Out-Null
}
