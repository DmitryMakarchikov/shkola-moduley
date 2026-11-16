@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist apps\web\dist-offline\index.html (
  where node >nul 2>nul || (echo Нужен Node.js 22+ для первой сборки: https://nodejs.org & pause & exit /b 1)
  if not exist node_modules call npm install
  call npm run build:offline
)
start "" "%~dp0apps\web\dist-offline\index.html"
