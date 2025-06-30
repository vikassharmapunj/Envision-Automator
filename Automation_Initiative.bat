@echo off
cd /D "%~dp0"
echo Navigating to application directory...

set NODE_TLS_REJECT_UNAUTHORIZED=0
echo Setting NODE_TLS_REJECT_UNAUTHORIZED to 0

powershell -WindowStyle Hidden -Command "npm start"
echo Application started (running in background).