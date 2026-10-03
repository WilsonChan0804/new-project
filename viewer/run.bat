@echo off
REM Double-click this to start the viewer.
REM Edit EXPORT below to point at whichever export folder you want to open.

set EXPORT=C:\dev\lwk-viewer\exports\test01

cd /d "%~dp0"
echo Serving %EXPORT%
python serve.py "%EXPORT%"
pause
