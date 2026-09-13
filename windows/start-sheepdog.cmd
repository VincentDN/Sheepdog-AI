@echo off
setlocal
cd /d "%~dp0..\service"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo First run - fetching dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Dependency install failed.
    pause
    exit /b 1
  )
)

title Sheepdog
node src\index.js
pause
