@echo off
setlocal EnableDelayedExpansion

echo ===================================================
echo       Solana Telegram Bot - Production Runner
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

:: Create logs directory if it doesn't exist
if not exist logs mkdir logs

:: Get available memory to optimize allocation
for /f "tokens=2 delims==" %%a in ('wmic OS get FreePhysicalMemory /Value ^| find "FreePhysicalMemory"') do set /a mem=%%a / 1024

:: Set memory limit based on available RAM - use max 60% of available memory
set /a memlimit=mem * 60 / 100
if %memlimit% GTR 4096 (
    set memlimit=4096
) else if %memlimit% LSS 1024 (
    set /a memlimit=1024
)

:: Display memory allocation
echo Available Memory: %mem% MB
echo Allocating: %memlimit% MB for bot operation
echo.

:: Set the current directory to the script location
cd %~dp0

:: Verify .env file exists
if not exist .env (
    echo ERROR: .env file not found in the current directory.
    echo Please make sure you have a valid .env file with BOT_TOKEN set.
    pause
    exit /b 1
)

:: Create timestamp for log file
set datetime=%date:~-4,4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set datetime=%datetime: =0%
set logfile=logs\bot-%datetime%.log

echo Log file: %logfile%
echo.

:: Set Node.js optimization flags
set NODE_OPTIONS=--max-old-space-size=%memlimit% --expose-gc --optimize-for-size --no-warnings
set NODE_NO_WARNINGS=1

:: Initialize counter for restart attempts
set restart_count=0
set max_restarts=5

:start_bot
:: Increment restart counter
set /a restart_count+=1

echo [%date% %time%] Starting bot (Attempt %restart_count% of %max_restarts%) >> %logfile%
echo Starting bot (Attempt %restart_count% of %max_restarts%)...

:: Enable priority boost if running as admin
net session >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [%date% %time%] Running with administrator privileges - using high priority >> %logfile%
    start /B /WAIT /HIGH node %NODE_OPTIONS% src/index.js >> %logfile% 2>&1
) else (
    echo [%date% %time%] Running with standard privileges >> %logfile%
    node %NODE_OPTIONS% src/index.js >> %logfile% 2>&1
)

:: Check if the bot exited with an error
if %ERRORLEVEL% NEQ 0 (
    echo [%date% %time%] Bot crashed with error code: %ERRORLEVEL% >> %logfile%
    echo.
    echo Bot crashed with error code: %ERRORLEVEL%
    echo See log file for details: %logfile%
    echo.
    
    :: Check if we've reached the maximum restart attempts
    if %restart_count% LSS %max_restarts% (
        echo Restarting bot in 10 seconds...
        echo [%date% %time%] Restarting bot in 10 seconds... >> %logfile%
        timeout /t 10 /nobreak >nul
        echo.
        goto start_bot
    ) else (
        echo Maximum restart attempts (%max_restarts%) reached.
        echo [%date% %time%] Maximum restart attempts (%max_restarts%) reached. >> %logfile%
        echo Please check the logs and fix any issues before restarting manually.
        echo.
    )
) else (
    echo [%date% %time%] Bot stopped gracefully. >> %logfile%
    echo Bot stopped gracefully.
)

echo.
echo Bot session ended. Log file: %logfile%
pause
endlocal 