@echo off
REM Runs the weekly routine. Used by the scheduled task; also fine to double-click.
REM Uses the project's .venv if there is one, otherwise whatever "python" is.
cd /d "%~dp0\..\.."
if exist ".venv\Scripts\python.exe" (
    set "PY=.venv\Scripts\python.exe"
) else (
    set "PY=python"
)
"%PY%" scripts\weekly.py %*
