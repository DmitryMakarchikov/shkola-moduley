@echo off
chcp 65001 >nul
title Школа модулей — разработка
cd /d "%~dp0"
if not exist node_modules call npm install
start "Сервер" cmd /k npm run dev:server
start "" http://localhost:5173
call npm run dev
