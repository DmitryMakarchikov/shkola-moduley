@echo off
chcp 65001 >nul
title Школа модулей — сервер
cd /d "%~dp0"
where node >nul 2>nul || (echo Установите Node.js 22 или новее: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (echo Установка зависимостей... & call npm install || (pause & exit /b 1))
if not exist apps\web\dist\index.html (echo Сборка сайта... & call npm run build || (pause & exit /b 1))
start "" http://localhost:3000
call npm start
pause
