@echo off
chcp 65001 > nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0runner\win_launcher.ps1"
if errorlevel 1 (
  echo.
  echo Launcher failed to start. Is PowerShell available?
  pause
)
