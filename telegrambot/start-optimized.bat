@echo off
setlocal EnableDelayedExpansion

echo ===================================================
echo    Solana Telegram Bot - Optimized Starter
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

:: Verify .env file exists
if not exist .env (
    echo ERROR: .env file not found in the current directory.
    echo Please make sure you have a valid .env file with BOT_TOKEN set.
    pause
    exit /b 1
)

:: Check if logs directory exists and create if needed
if not exist logs mkdir logs

:: Run npm rebuild to fix bindings issues
echo Rebuilding Node.js modules...
call npm rebuild

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo WARNING: npm rebuild returned an error. Some native modules may not work correctly.
    echo You can try running "npm install" manually to fix the issue.
    echo.
    timeout /t 5 /nobreak >nul
) else (
    echo Module rebuild completed successfully.
)

echo.
echo Starting bot with optimized settings...
echo.

:: Start the bot using optimized runner
call run-bot.bat

endlocal 