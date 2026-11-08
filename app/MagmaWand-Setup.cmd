@echo off
chcp 65001 >nul
title Magma Wand Setup
echo Downloading Magma Wand installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; $p=Join-Path $env:TEMP 'MagmaWand-install.ps1'; Invoke-WebRequest -UseBasicParsing 'https://github.com/NampleS/magma-wand/releases/latest/download/install.ps1' -OutFile $p; & $p"
if errorlevel 1 pause
