@echo off
setlocal enabledelayedexpansion

rem Stand in obsidian client used to exercise test.cmd without a live Obsidian.
rem It answers the way the plugin does and writes to the same places, so the
rem filesystem assertions in the harness have something real to judge.
rem
rem Presence tests go through findstr, which copes with equals signs and backslashes.
rem The percent substitution trick does not, and reports a needle as present when it
rem is absent, which is what made the first drafts of this stub misfire.

set "A=%*"
set "VAULTX=%STUB_VAULT%"
set "TGT=%STUB_TARGET%"
set "TGT2=%STUB_TARGET2%"
set "FRN=%STUB_FOREIGN%"
set "ROOTX=%STUB_ROOT%"
set "HOMEX=%STUB_HOME%"
set "IMPORTX=%STUB_IMPORT%"
set "SORTFILE=%ROOTX%\sort.txt"
set "ARGSFILE=%ROOTX%\stub-args.txt"

if not defined ROOTX set "ROOTX=%TEMP%\skillhub-cli-test"
if not exist "%ROOTX%" mkdir "%ROOTX%" >nul 2>&1
> "%ARGSFILE%" echo %A%

rem ---------------------------------------------------------------- guards ---

call :has "target="
if errorlevel 1 goto :guardsdone
call :has "never-created"
if not errorlevel 1 call :saydone "ERROR: Install target does not exist yet. Create it first, or install from the Skill Hub user interface."

call :has "staging="
if errorlevel 1 goto :guardsstaging
if not defined VAULTX goto :guardsstaging
call :has "%VAULTX%"
if not errorlevel 1 call :saydone "ERROR: Staging directory is not usable: the staging path sits inside the vault."
:guardsstaging

if defined HOMEX (
  call :has "%HOMEX%"
  if not errorlevel 1 call :saydone "ERROR: Refusing the home directory as an install target because it is the home directory. Point at the directory holding your agents instead."
)

if defined VAULTX (
  call :has "%VAULTX%"
  if not errorlevel 1 call :saydone "ERROR: The install target is inside the vault. Install outside the vault so Obsidian does not index the installed links."
)

call :has "target=C:"
if errorlevel 1 goto :guardsdone
set DRIVETEST=1
findstr /i /c:"target=C:\Users" "%ARGSFILE%" >nul 2>&1
if not errorlevel 1 set DRIVETEST=
if defined DRIVETEST call :saydone "ERROR: Refusing C:\ as an install target because it is a filesystem root."
:guardsdone

call :has ":link"
if errorlevel 1 goto :guardslink
call :has "force=1"
if not errorlevel 1 goto :guardslink
:guardslink

rem ---------------------------------------------------------------- actions ---
call :has ":probe"
if not errorlevel 1 call :say "parameters reached the command layer: %A%"
call :has ":not-a-real-action"
if not errorlevel 1 call :saydone "ERROR: No Skill Hub command line action is registered for banshan-skillhub:not-a-real-action yet."
if /i "%A%"=="banshan-skillhub" (
  echo Usage: obsidian banshan-skillhub [:action] [key=value ...]
  echo.
  echo Actions:
  echo   info     Report the command line environment
  exit /b 0
)
call :has ":info"
if not errorlevel 1 (
  echo property  value
  echo installMethod  symlink
  echo skillFolder  Skill
  exit /b 0
)
call :has ":refresh"
if not errorlevel 1 (
  echo open Skill Hub views were redrawn from the registry
  exit /b 0
)
call :has ":list"
if not errorlevel 1 (
  call :has "format=json"
  if not errorlevel 1 (
    echo {
    echo   "action": "banshan-skillhub:list",
    echo   "ok": true,
    echo   "message": "15 skills",
    echo   "rows": [
    echo     { "name": "writing-plans" }
    echo   ]
    echo }
    exit /b 0
  )
  echo 15 skills
  echo name         original
  echo writing-plans  writing-plans
  exit /b 0
)
call :has ":show"
if not errorlevel 1 (
  call :has "definitely-not-here"
  if not errorlevel 1 call :saydone "ERROR: No skill named definitely-not-here. Known skills: writing-plans, using-superpowers."
  echo property  value
  echo nickname  writing-plans
  exit /b 0
)
call :has ":search"
if not errorlevel 1 (
  echo 2 matches for the search
  echo name
  echo systematic-debugging
  exit /b 0
)
call :has ":scan"
if not errorlevel 1 (
  call :has "import-me"
  if not errorlevel 1 (
    echo 1 skill found in the scanned directory
    echo folder     name
    echo cli-demo   cli-demo
    exit /b 0
  )
  echo No skills or .agents/skills folder was found in the selected directory.
  exit /b 0
)
call :has ":install"
if not errorlevel 1 call :install
call :has ":link"
if not errorlevel 1 call :link
call :has ":uninstall"
if not errorlevel 1 call :uninstall
call :has ":import"
if not errorlevel 1 call :import
call :has ":settings"
if not errorlevel 1 call :settings
call :has ":order"
if not errorlevel 1 call :order

echo %A%
:sayhome

:saysite

:sayvault

goto :fin

:install
call :has "method=teleport"
if not errorlevel 1 call :saydone "ERROR: Unknown method teleport. Use copy, symlink or junction."
call :has "conflict=smash"
if not errorlevel 1 call :saydone "ERROR: Unknown conflict smash. Use skip or replace-symlinks."
call :has "definitely-not-here"
if not errorlevel 1 call :saydone "ERROR: No skill named definitely-not-here. Known skills: writing-plans."
call :has "dryrun=1"
if not errorlevel 1 call :say "dryrun for the target using symlink: 3 to add, 0 to replace, 0 already present, 0 would fail"
call :has "method=copy"
if not errorlevel 1 (
  if defined TGT mkdir "%TGT%\.agents\skills\writing-plans" >nul 2>&1
  echo the target: installed 1, replaced 0, skipped 0, failed 0
  echo name            decision   destination
  echo writing-plans   installed  %TGT%\.agents\skills\writing-plans
  exit /b 0
)
call :has "method=symlink"
if not errorlevel 1 (
  if defined TGT mkdir "%TGT%\.agents\skills\using-superpowers" >nul 2>&1
  if defined TGT mkdir "%TGT%\.agents\skills\writing-skills" >nul 2>&1
  echo the target: installed 1, replaced 0, skipped 0, failed 0
  echo using-superpowers  installed  via junction
  exit /b 0
)
call :has "target="
if not errorlevel 1 call :saydone "ERROR: Missing required parameter skill, collection or target. Pass skill=all together with collection=^<name^> to install a whole collection."
echo the target: installed 1, replaced 0, skipped 0, failed 0
goto :fin

:link
call :has "method=copy"
if not errorlevel 1 call :saydone "ERROR: link needs method=symlink or method=junction. Use install for copies."
if defined TGT2 call :has "%TGT2%"
if not errorlevel 1 call :saydone "ERROR: the destination is a real path that the install record does not account for, so link refuses to touch it. Use another skill name, or remove that path yourself first."
call :has "force=1"
if not errorlevel 1 call :say "%TGT%\.agents\skills\writing-skills points at Skill\writing-skills via junction"
if defined TGT if exist "%TGT%\.agents\skills\writing-skills\" call :saydone "ERROR: the destination is already linked. Pass force=1 to replace the existing link."
echo %TGT%\.agents\skills\writing-skills points at Skill\writing-skills via junction
goto :fin

:uninstall
if defined FRN call :has "%FRN%"
if not errorlevel 1 call :saydone "ERROR: No Skill Hub install record points at the target, so nothing is removed. Installs made by earlier versions are deliberately left alone."
call :has "definitely-not-here"
if not errorlevel 1 call :saydone "ERROR: No selected skill is recorded as installed at the target. Recorded installs: writing-plans, using-superpowers."
call :has "dryrun=1"
if not errorlevel 1 call :say "dryrun for the target: 3 to remove, 0 already absent, 0 left alone"
call :has "confirm=1"
if not errorlevel 1 (
  call :has "skill=writing-plans"
  if not errorlevel 1 (
    if defined TGT rmdir /s /q "%TGT%\.agents\skills\writing-plans" >nul 2>&1
    echo the target: removed 1, 0 already absent, 0 left alone, 0 failed
    exit /b 0
  )
  if defined TGT rmdir /s /q "%TGT%\.agents\skills" >nul 2>&1
  echo the target: removed 2, 0 already absent, 0 left alone, 0 failed
  exit /b 0
)
call :saydone "ERROR: banshan-skillhub:uninstall removes or overwrites entries. Re-run with confirm=1 to apply, or dryrun=1 to preview."

:import
call :has "source=github"
if not errorlevel 1 call :saydone "ERROR: Command line imports cover local directories only, not github. Use the GitHub import or the npx flow inside Skill Hub for the other sources."
call :has "dryrun=1"
if not errorlevel 1 (
  echo dryrun: 1 of 1 skills under the directory would be imported via copy
  echo folder    name
  echo cli-demo  cli-demo
  exit /b 0
)
call :has "never-created"
if not errorlevel 1 call :say "imported 0 skills from the directory"
if defined VAULTX mkdir "%VAULTX%\Skill\cli-demo" >nul 2>&1
echo imported 1 skills from the directory
echo name      original
echo cli-demo  cli-demo
exit /b 0

:settings
call :has "key=cliEnabled"
if not errorlevel 1 call :saydone "ERROR: cliEnabled cannot be changed from the command line. Turn it on under Settings - Community plugins - Skill Hub."
call :has "key=npxExecutionEnabled"
if not errorlevel 1 call :saydone "ERROR: npxExecutionEnabled cannot be changed from the command line. Turn it on under Settings - Community plugins - Skill Hub."
call :has "definitely-not-a-setting"
if not errorlevel 1 call :saydone "ERROR: Unknown setting definitely-not-a-setting. Reported settings: skillFolder, installMethod."
call :has "value=sideways"
if not errorlevel 1 call :saydone "ERROR: Unknown defaultSort sideways. Use nickname, originalName, updatedAt or custom."
call :has "value=updatedAt"
if not errorlevel 1 (
  call :has "confirm=1"
  if not errorlevel 1 (
    if defined ROOTX echo updatedAt> "%SORTFILE%"
    echo defaultSort set to updatedAt
    exit /b 0
  )
  call :saydone "ERROR: banshan-skillhub:settings removes or overwrites entries. Re-run with confirm=1 to apply, or dryrun=1 to preview what would change."
)
call :has "value=nickname"
if not errorlevel 1 (
  call :has "confirm=1"
  if not errorlevel 1 (
    if defined ROOTX echo nickname> "%SORTFILE%"
    echo defaultSort set to nickname
    exit /b 0
  )
  call :saydone "ERROR: banshan-skillhub:settings removes or overwrites entries. Re-run with confirm=1 to apply, or dryrun=1 to preview what would change."
)
call :has "key=defaultSort"
if not errorlevel 1 (
  if exist "%SORTFILE%" (
    for /f "delims=" %%i in ("%SORTFILE%") do echo defaultSort  %%i
    exit /b 0
  )
  echo defaultSort  nickname
  exit /b 0
)
echo 6 settings
echo property   value
echo skillFolder  Skill
echo defaultSort  nickname
exit /b 0

:order
call :has "definitely-not-here"
if not errorlevel 1 call :saydone "ERROR: No skill named definitely-not-here is in the registry, so the curated order was not changed."
call :has "list="
if not errorlevel 1 (
  call :has "confirm=1"
  if not errorlevel 1 (
    echo curated order set to 2 entries
    exit /b 0
  )
  call :saydone "ERROR: banshan-skillhub:order removes or overwrites entries. Re-run with confirm=1 to apply, or dryrun=1 to preview what would change."
)
echo 0 curated entries
echo position  skill
exit /b 0

rem --------------------------------------------------------------- helpers ----
:say
echo %~1
goto :fin

:saydone
echo %~1
goto :fin

:fin
exit /b 0

:has
findstr /i /m /c:"%~1" "%ARGSFILE%" >nul 2>&1
goto :eof

:say
echo %~1
goto :fin

:sayhome
echo ERROR: Refusing the home directory as an install target because it is the home directory. Point at the directory holding your agents instead.
goto :fin

:saysite
echo ERROR: Staging directory is not usable: the staging path is inside the vault. Install outside the vault so Obsidian does not index the installed links.
goto :fin

:sayvault
echo ERROR: The install target is inside the vault. Install outside the vault so Obsidian does not index the installed links.
goto :fin
