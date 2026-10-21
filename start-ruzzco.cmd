@echo off
rem Double-click to start Ruzzco: database, forecast, app and the HTTPS gateway for phones.
rem Options go to scripts\start-ruzzco.ps1, for example: start-ruzzco.cmd -Dev   or   start-ruzzco.cmd -Stop
setlocal
where pwsh >nul 2>nul
if %errorlevel% equ 0 (set "RUZZCO_PS=pwsh") else (set "RUZZCO_PS=powershell")
start "Ruzzco" %RUZZCO_PS% -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-ruzzco.ps1" -KeepOpen %*
