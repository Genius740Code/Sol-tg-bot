@echo off
setlocal EnableDelayedExpansion

echo ===================================================
echo    Solana Telegram Bot - Troubleshooting Script
echo ===================================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Set the current directory to the script location
cd %~dp0

:: Check for common issues and fix them

:: 1. Create logs directory if missing
if not exist logs (
    echo Creating logs directory...
    mkdir logs
)

:: 2. Check if .env file exists
if not exist .env (
    echo WARNING: .env file not found in the current directory.
    echo Creating a template .env file. Please update it with your credentials.
    echo BOT_TOKEN=YOUR_BOT_TOKEN_HERE> .env
    echo MONGODB_URI=YOUR_MONGODB_URI_HERE>> .env
    echo ENCRYPTION_KEY=YOUR_ENCRYPTION_KEY_HERE>> .env
    echo HELIUS_API_KEY=YOUR_HELIUS_API_KEY_HERE>> .env
    echo NODE_ENV=production>> .env
)

:: 3. Clear node_modules and reinstall if needed
echo Would you like to completely reinstall dependencies? (y/n)
set /p reinstall=
if /i "%reinstall%"=="y" (
    echo Removing node_modules and reinstalling dependencies...
    if exist node_modules (
        rmdir /s /q node_modules
    )
    if exist package-lock.json (
        del package-lock.json
    )
    call npm install
)

:: 4. Rebuild native modules
echo Rebuilding native modules...
call npm rebuild

:: 5. Clear logs
echo Would you like to clear log files? (y/n)
set /p clearlogs=
if /i "%clearlogs%"=="y" (
    echo Clearing log files...
    del /q logs\*.log
)

:: 6. Run npm scripts
echo Running database checks...
call npm run setup-db

echo.
echo ===================================================
echo All fixes have been applied. Starting the bot...
echo ===================================================

:: Start the bot with optimized settings
call start-optimized.bat

endlocal 