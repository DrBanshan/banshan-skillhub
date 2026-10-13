@echo off
setlocal enabledelayedexpansion

rem Runs test.cmd against the stand in client so the harness itself gets checked. Anything given here
rem is forwarded to test.cmd, so a vault can be passed through:  run-stub-test.cmd vault=C:\my\vault

set "ROOTX=%TEMP%\skillhub-cli-test"
set "FAKEVAULT=%TEMP%\skillhub-fake-vault"

rmdir /s /q "%FAKEVAULT%" >nul 2>&1
mkdir "%FAKEVAULT%\Skill\writing-plans" >nul 2>&1
>"%FAKEVAULT%\Skill\writing-plans\SKILL.md" echo body text of the vault copy

set "OBSIDIAN_CMD=D:\Projects\banshan-skillhub\tools\cli-harness\stub.cmd"
set "STUB_ROOT=%ROOTX%"
set "STUB_VAULT=%FAKEVAULT%"
set "IMPORTX=%ROOTX%\import-me"
set "STUB_TARGET=%ROOTX%\agent"
set "STUB_TARGET2=%ROOTX%\agent2"
set "STUB_FOREIGN=%ROOTX%\foreign"
set "STUB_HOME=%USERPROFILE%"
set "VAULT=%FAKEVAULT%"

call "D:\Projects\banshan-skillhub\test.cmd" %*
set "CODE=%errorlevel%"

echo.
echo harness exit code %CODE%
if not "%CODE%"=="0" (
  echo.
  echo lines still standing in the scratch area:
  dir /s /b "%ROOTX%" 2>nul | findstr /i /c:"skills"
)
exit /b %CODE%
