@echo off
REM ============================================================================
REM  Create-Admin launcher
REM  Double-click this file to create a new admin user for the budget app.
REM  This script refreshes PATH so pnpm is found, then prompts for credentials.
REM ============================================================================

cd /d "%~dp0"
setlocal
set "PATH=%APPDATA%\npm;%PATH%"

echo.
echo  ===============================================
echo   Family Budget App  -  Create Admin User
echo  ===============================================
echo.
echo  You will be prompted for:
echo    1) Email
echo    2) Password (8+ characters, hidden as you type)
echo    3) Display name
echo.

call pnpm create-admin

echo.
echo  ===============================================
echo  Done. You can close this window.
echo  ===============================================
pause
endlocal
