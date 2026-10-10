@echo off
chcp 65001 >nul
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0scripts\local-manager.mjs" start %*
if errorlevel 1 (
  pause
  exit /b 1
)
timeout /t 3 /nobreak >nul 2>&1
exit /b 0
