@echo off
rem Drives the harness against the stand in that says the command was not found, so the
rem early exit path can be checked without a live Obsidian.
setlocal
set "FAKE=%TEMP%\skillhub-fake-vault"
if not exist "%FAKE%\Skill\writing-plans" mkdir "%FAKE%\Skill\writing-plans" >nul 2>&1
>"%FAKE%\Skill\writing-plans\SKILL.md" echo name: writing-plans
set "VAULT=%FAKE%"
set "OBSIDIAN_CMD=D:\Projects\banshan-skillhub\tools\cli-harness\stub-notfound.cmd"
call "D:\Projects\banshan-skillhub\test.cmd"
set "CODE=%ERRORLEVEL%"
echo.
echo EXITCODE=%CODE%
if not "%CODE%"=="3" echo EXPECTED 3, GOT %CODE%
endlocal
exit /b 0
