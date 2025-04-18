@echo off
setlocal EnableDelayedExpansion

echo ===================================================
echo       Solana Telegram Bot - Database Population
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

:: Set the current directory to the parent of the script location
cd %~dp0\..

:: Create logs directory if it doesn't exist
if not exist logs mkdir logs

:: Get available memory to optimize allocation
for /f "tokens=2 delims==" %%a in ('wmic OS get FreePhysicalMemory /Value ^| find "FreePhysicalMemory"') do set /a mem=%%a / 1024

:: Set memory limit based on available RAM - use max 75% of available memory
set /a memlimit=mem * 75 / 100
if %memlimit% GTR 8192 (
    set memlimit=8192
) else if %memlimit% LSS 2048 (
    set /a memlimit=2048
)

:: Display memory allocation
echo Available Memory: %mem% MB
echo Allocating: %memlimit% MB for database population
echo.

:: Verify .env file exists
if not exist ..\config\.env (
    echo ERROR: .env file not found in the config directory.
    echo Please make sure you have a valid .env file with MONGODB_URI set.
    pause
    exit /b 1
)

:: Create timestamp for log file
set datetime=%date:~-4,4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%
set datetime=%datetime: =0%
set logfile=logs\db-populate-%datetime%.log

echo Log file: %logfile%
echo.

echo Running database population script with optimized settings...
echo This may take a while for large datasets. See the log file for details.
echo.

:: Set Node.js optimization flags
set NODE_OPTIONS=--max-old-space-size=%memlimit% --expose-gc --optimize-for-size

:: Run with optimized settings and redirect output to log file
echo Starting database population at %time% > %logfile%
echo Using Node.js memory allocation: %memlimit% MB >> %logfile%

:: Enable priority boost if running as admin
net session >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Running with administrator privileges - using high priority >> %logfile%
    start /B /WAIT /HIGH node %NODE_OPTIONS% tools/populateDatabase.js >> %logfile% 2>&1
) else (
    echo Running with standard privileges >> %logfile%
    node %NODE_OPTIONS% tools/populateDatabase.js >> %logfile% 2>&1
)

:: Check if the operation completed successfully
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: Database population failed. See log file for details.
    echo Log file: %logfile%
    echo.
) else (
    echo.
    echo Database population completed successfully.
    echo Check the log file for details: %logfile%
    echo.
)

echo Database population completed at %time% >> %logfile%
pause
endlocal 