@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local-dev.ps1" stop
if errorlevel 1 pause
exit /b %errorlevel%
