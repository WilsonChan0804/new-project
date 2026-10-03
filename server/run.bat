@echo off
REM Starts the LWK Viewer server on this machine.
REM
REM ROOT is the folder that holds one sub-folder per project:
REM
REM     C:\dev\lwk-viewer\exports\
REM         merged01\         <- manifest.json, model.ifc, sheets\, fragments\
REM         tower-b\          <- the next project, same layout
REM
REM Any sub-folder with a manifest.json in it appears in the viewer's
REM project list. Each project keeps its own issues.
REM
REM ADOPT: issues raised before projects existed are in data\viewer.db and
REM belong to one project. Name it here and they are copied into that
REM project the first time the server starts. The old file is kept, so a
REM wrong name loses nothing. Once it says "adopted" you can clear ADOPT.
REM
REM Leave PASSPHRASE set whenever a tunnel is running: it now protects the
REM drawings and models as well as the issues.

set "ROOT=C:\dev\lwk-viewer\exports"
set "PASSPHRASE=lwk2026"
set "ADOPT=merged01"
set "PORT=8713"

cd /d "%~dp0"

python -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 (
  echo Installing dependencies, one time only...
  python -m pip install -r requirements.txt || (pause & exit /b 1)
)

if "%ADOPT%"=="" (
  python app.py --root "%ROOT%" --pass "%PASSPHRASE%" --port %PORT%
) else (
  python app.py --root "%ROOT%" --pass "%PASSPHRASE%" --port %PORT% --adopt "%ADOPT%"
)
pause
