@echo off
REM Creates a Windows scheduled task that runs the weekly routine every Saturday.
REM
REM   install_weekly_task.bat            Saturday 09:00
REM   install_weekly_task.bat 07:30      Saturday 07:30
REM
REM Saturday is deliberate: US markets are shut, so every name in the screen is
REM priced off the same Friday close, and a long whole-market screen does not
REM compete with anything else you are doing.
REM
REM The PC must be switched on (asleep is fine if "wake to run" is ticked in
REM Task Scheduler). Remove the task with uninstall_weekly_task.bat.
setlocal
set "TIME_AT=%~1"
if "%TIME_AT%"=="" set "TIME_AT=09:00"
set "BAT=%~dp0run_weekly.bat"

schtasks /Create /F /TN "InvestmentEngineWeekly" /SC WEEKLY /D SAT /ST %TIME_AT% /TR "\"%BAT%\""
if errorlevel 1 (
    echo.
    echo Could not create the task. Try running this file as Administrator.
    exit /b 1
)
echo.
echo Scheduled: every Saturday at %TIME_AT%.
echo Logs go to the logs\ folder in the project.
echo Run it now to test:   schtasks /Run /TN "InvestmentEngineWeekly"
endlocal
