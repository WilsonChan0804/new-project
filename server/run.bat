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
REM Only if a proxy in front of the server has trouble with the compressed,
REM browser-kept page files (see README, Speed): remove the REM below.
REM set "PLAIN_ASSETS=1"

cd /d "%~dp0"

python -c "import fastapi, uvicorn" 2>nul
if errorlevel 1 (
  echo Installing dependencies, one time only...
  python -m pip install -r requirements.txt || (pause & exit /b 1)
)

REM The knowledge base (Codes > Knowledge base) is built with MkDocs.
python -c "import mkdocs, material" 2>nul
if errorlevel 1 (
  echo Installing MkDocs for the knowledge base, one time only...
  python -m pip install "mkdocs-material>=9.5,<10" || echo MkDocs could not be installed - the viewer works, but Codes ^> Knowledge base will not build.
)

REM Programme > Import of .mpp files is read by MPXJ, which needs Java (11 or later).
python -c "import importlib.util,sys; sys.exit(0 if importlib.util.find_spec('mpxj') else 1)" 2>nul
if errorlevel 1 (
  echo Installing MPXJ for reading MS Project .mpp files, one time only...
  python -m pip install "mpxj>=13" || echo MPXJ could not be installed - Programme imports MS Project XML, not .mpp.
)
where java >nul 2>nul || echo Java is not installed - to import .mpp files in the Programme, install Java 11 or later (e.g. Eclipse Temurin).

if "%ADOPT%"=="" (
  python app.py --root "%ROOT%" --pass "%PASSPHRASE%" --port %PORT%
) else (
  python app.py --root "%ROOT%" --pass "%PASSPHRASE%" --port %PORT% --adopt "%ADOPT%"
)
pause
