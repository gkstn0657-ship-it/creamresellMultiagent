@echo off
setlocal
set "boardWindow=%~dp0automation\team-board\window.py"
if exist "%~dp0.venv\Scripts\pythonw.exe" (
    start "" "%~dp0.venv\Scripts\pythonw.exe" -X utf8 "%boardWindow%"
    exit /b
)
where pyw.exe >nul 2>&1
if not errorlevel 1 (
    start "" pyw.exe -3 -X utf8 "%boardWindow%"
    exit /b
)
where pythonw.exe >nul 2>&1
if not errorlevel 1 (
    start "" pythonw.exe -X utf8 "%boardWindow%"
    exit /b
)
echo Python for Windows is required. Install Python and run Setup-Other-PC.ps1.
pause
exit /b 1
