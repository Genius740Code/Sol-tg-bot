@echo off
echo ========================================
echo      Solana Telegram Bot Optimizer
echo ========================================
echo.

:: Check if Node.js is installed
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
  echo Error: Node.js is not installed or not in the PATH.
  echo Please install Node.js from https://nodejs.org/
  echo.
  pause
  exit /b 1
)

:: Run the optimization script
echo Starting optimization process...
echo.
node scripts/setup-optimized.js

if %ERRORLEVEL% neq 0 (
  echo.
  echo Error: Optimization failed with error code %ERRORLEVEL%
  echo Please check the logs for details.
  echo.
  pause
  exit /b %ERRORLEVEL%
)

echo.
echo Optimization completed successfully!
echo.
pause 