# Magma Extension 제거 (Magma 앱은 그대로 둔다)
$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
$Root = $PSScriptRoot

# 1) 실행기 멈추기
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'MagmaWand' -and $_.CommandLine -match 'boot\.ps1|launcher\.ps1' -and $_.ProcessId -ne $PID } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

# 2) 바로가기 원래대로
$shell = New-Object -ComObject WScript.Shell
$backupPath = Join-Path $Root 'shortcuts-backup.json'
if (Test-Path $backupPath) {
  $b = Get-Content $backupPath -Raw -Encoding UTF8 | ConvertFrom-Json
  foreach ($pr in $b.PSObject.Properties) {
    if (-not (Test-Path $pr.Name)) { continue }
    $s = $shell.CreateShortcut($pr.Name)
    if ($s.Arguments -notlike '*run.vbs*') { continue }   # 이미 다른 것으로 바뀌었으면 손대지 않음
    $s.TargetPath = $pr.Value.target; $s.Arguments = $pr.Value.args
    $s.IconLocation = $pr.Value.icon; $s.WorkingDirectory = $pr.Value.dir
    $s.Save()
  }
}
# 예전 이름(마법봉)·새 이름(Extension) 바로가기 모두
foreach ($n in @('Magma (마법봉).lnk', 'Magma (Extension).lnk')) { $own = Join-Path ([Environment]::GetFolderPath('Programs')) $n; if (Test-Path $own) { Remove-Item $own -Force } }
foreach ($n in @('Magma 마법봉 (업데이트 확인).lnk', 'Magma Extension (업데이트 확인).lnk')) { $startup = Join-Path ([Environment]::GetFolderPath('Startup')) $n; if (Test-Path $startup) { Remove-Item $startup -Force } }

# 3) 앱 목록에서 빼기
Remove-Item 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\MagmaWand' -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
Write-Host 'Magma Extension을 지웠어요. Magma 앱은 그대로예요.' -ForegroundColor Green
Write-Host 'Magma가 켜져 있다면 한 번 다시 열면 Magma Extension이 사라져요.'
Write-Host '크롬 확장을 설치했었다면 chrome://extensions 에서 직접 지워 주세요.'
Write-Host ''
Read-Host '엔터를 누르면 창이 닫혀요' | Out-Null

# 4) 폴더 지우기 (이 스크립트가 끝난 뒤)
Start-Process cmd.exe -ArgumentList '/c', "timeout /t 2 >nul & rmdir /s /q `"$Root`"" -WindowStyle Hidden
