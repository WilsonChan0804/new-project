@echo off
REM Publishes the local server on a temporary public HTTPS address.
REM
REM Run this in a second window, after run.bat is already serving.
REM
REM Cloudflare calls these quick tunnels. They need no account and no
REM domain, but they are explicitly for development: no uptime guarantee,
REM a 200 in-flight request limit, and a new random URL every restart.
REM Do not build anything around the address it prints.

set "PORT=8713"
set "CF=%~dp0cloudflared.exe"

if not exist "%CF%" (
  echo cloudflared.exe is not in this folder.
  echo.
  echo Download the Windows amd64 build from:
  echo   https://github.com/cloudflare/cloudflared/releases/latest
  echo Save it next to this file as cloudflared.exe
  pause
  exit /b 1
)

"%CF%" tunnel --url http://localhost:%PORT%
pause
