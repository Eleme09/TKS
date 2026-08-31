@echo off
cd /d "%~dp0"
if exist env.bat (
  call env.bat
) else (
  echo Falta el archivo env.bat con las credenciales de Supabase.
  echo Pidele a Claude que te lo vuelva a crear si no lo tienes.
  pause
  exit /b 1
)
echo Iniciando el rastreador de tokens de Chaturbate...
echo No cierres esta ventana mientras lo uses.
echo.
node server.js
echo.
echo El servidor se detuvo o hubo un error. Revisa el mensaje de arriba.
pause
