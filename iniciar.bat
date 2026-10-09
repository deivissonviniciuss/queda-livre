@echo off
title Queda Livre - servidor
cd /d "%~dp0"
if not exist node_modules (
  echo Instalando dependencias...
  call npm install
)
rem abre o navegador 2 segundos depois, quando o servidor ja esta no ar
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start "" http://localhost:3001"
node server\index.js
pause
