@echo off
cd /d "%~dp0"
echo Iniciando el rastreador de tokens de Chaturbate...
echo No cierres esta ventana mientras lo uses.
echo.
node server.js
echo.
echo El servidor se detuvo o hubo un error. Revisa el mensaje de arriba.
pause
