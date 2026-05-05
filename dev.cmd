@echo off
REM ============================================================================
REM  Dev launcher
REM  Double-click to start everything you need to use the app:
REM    1) Postgres container (starts it if stopped)
REM    2) Web app on http://localhost:3000
REM    3) Worker on http://localhost:8080
REM
REM  Leave this window open while you work. Close it (or Ctrl+C) to stop.
REM ============================================================================

cd /d "%~dp0"
setlocal
set "PATH=%APPDATA%\npm;%PATH%"

echo.
echo  ===============================================
echo   Family Budget App  -  Dev Launcher
echo  ===============================================
echo.

REM --- Make sure Docker is up before checking Postgres ---
docker info >nul 2>&1
if errorlevel 1 (
    echo  [!] Docker Desktop isn't running. Launch Docker Desktop, wait for the
    echo      whale icon in your taskbar to be steady, then run this again.
    echo.
    pause
    exit /b 1
)

REM --- Ensure Postgres container exists and is running ---
docker ps --filter "name=budget-pg" --filter "status=running" --format "{{.Names}}" | findstr /i budget-pg >nul
if errorlevel 1 (
    docker ps -a --filter "name=budget-pg" --format "{{.Names}}" | findstr /i budget-pg >nul
    if errorlevel 1 (
        echo  Postgres container not found - creating it...
        docker run -d --name budget-pg -p 5432:5432 -e POSTGRES_DB=budget -e POSTGRES_USER=budget -e POSTGRES_PASSWORD=devpass postgres:16-alpine
    ) else (
        echo  Postgres container exists but stopped - starting it...
        docker start budget-pg
    )
    timeout /t 4 /nobreak >nul
) else (
    echo  Postgres is already running.
)

echo.
echo   Web app:  http://localhost:3000
echo   Worker:   http://localhost:8080
echo.
echo   Press Ctrl+C in this window to stop both.
echo  ===============================================
echo.

call pnpm dev
endlocal
