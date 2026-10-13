@echo off
setlocal
rem  Banshan Skill Hub - command line test harness
rem
rem  Drives every registered command line action through the obsidian client and
rem  judges each reply, the filesystem, or both. Everything it creates lives under
rem  %ROOT% and is rebuilt from scratch at the start of a run, so a run is
rem  repeatable and it never writes into the vault apart from the import section,
rem  which is called out in the summary.
rem
rem  Usage:   test.cmd
if defined OPEN_REPORT start "" notepad "%REPORT"
rem
rem  Fill in the six values marked EDIT below, keep Obsidian open with the vault
rem  loaded, the plugin enabled, and Skill Hub's "Enable Skill Hub command line
rem  actions" switched on. The exit code is the number of failed checks.
rem
rem  Vault targeting, which is what most failures come down to: the client picks a
rem  vault from its current working directory, otherwise from the vault that was
rem  active last. This script changes into the vault and passes an explicit
rem  vault= selector as the first parameter, resolved from Obsidian's own vault
rem  registry by vaultsel.cjs. Set VAULTSEL by hand if the automatic one is wrong,
rem  using vault=<vault id> or vault=<vault name>.
rem
rem  Reply modes for :run
rem    expect     the reply must contain the text and must not be an error line
rem    expecterr  the reply must be an error line and must contain the text
rem    noerror    the reply must not be an error line, the text is ignored
rem
rem  Notes for anyone editing this file. Redirect targets stay unquoted, so TEMP
rem  and the client path must hold no spaces. Client replies are captured to a file
rem  and read back line by line, never through a pipe.
rem
rem  Set OBSIDIAN_CMD to point the harness at a stand in client, which is how the
rem  harness itself gets exercised without a live Obsidian.
rem ============================================================================

rem ---------------------------------------------------------------- EDIT begin
rem leave unset to have the run detect the vault, or set it here or in the environment
rem a vault given on the command line wins over both
if not defined VAULT set "VAULT="
set "VAULTSEL="
set "SKILLSFOLDER=Skill"
set "SKILL_A=writing-plans"
set "SKILL_B=using-superpowers"
set "SKILL_C=writing-skills"
rem --------------------------------------------------------------- EDIT end --

rem ------------------------------------------------------------------ arguments
rem   test.cmd                          detect the vault and run every checks
rem   test.cmd vault=^<vault folder^>             use a particular vault, the folder holding .obsidian
rem   test.cmd --vault=^<vault folder^>           the same thing
rem   test.cmd --list                     list the vaults Obsidian knows and which are ready
rem   test.cmd --open                     open the report in notepad when the run ends
rem   test.cmd --help                     show this
set "ARG_VAULT="
set "ARG_HELP="
set "OPEN_REPORT="
set "LIST_REQUESTED="
call :parse_args %*
if defined ARG_HELP goto :show_help
if defined LIST_REQUESTED goto :list_vaults
goto :args_done
:show_help
echo Banshan Skill Hub command line harness
echo.
echo   test.cmd                            detect the vault and run every checks
echo   test.cmd vault=^<vault folder^>             use a particular vault, the folder holding .obsidian
echo   test.cmd --list                     list the vaults Obsidian knows and which are ready
echo   test.cmd --open                     open the report in notepad when the run ends
echo   test.cmd --help                     show this
echo.
echo without a vault named, one is detected from the Obsidian registry, preferring the vault
echo that has banshan-skillhub installed and, between several of those, the most recently
echo opened. the report lands under %TEMP%\skillhub-cli-test and the exit code
echo is the number of failed checks.
exit /b 0
:list_vaults
node "%~dp0vaultsel.cjs" --list
exit /b %ERRORLEVEL%
:args_done

set "ROOT=%TEMP%\skillhub-cli-test"
set "TARGET=%ROOT%\agent"
set "TARGET2=%ROOT%\agent2"
set "FOREIGN=%ROOT%\foreign"
set "IMPORTSRC=%ROOT%\import-me"
set "REPORT=%ROOT%\report.txt"
set "OUT=%ROOT%\last.txt"
set "SELFILE=%ROOT%\vaultsel.txt"
set "HOME=%USERPROFILE%"
set "CLIENT=%OBSIDIAN_CMD%"
if "%CLIENT%"=="" set "CLIENT=obsidian"

set /a TOTAL=0
set /a PASS=0
set /a FAIL=0
set /a SKIP=0
set "LEFTBEHIND="

if defined VAULT if not exist "%VAULT%\" (
  echo a vault folder is not there: %VAULT%
  echo point VAULT at the folder holding your .obsidian directory, or pass one on the command line
  echo   test.cmd vault=^<vault folder^>
  echo to see what Obsidian knows about your vaults:
  echo   test.cmd --list
  exit /b 2
)

rmdir /s /q "%ROOT%" >nul 2>&1
mkdir "%ROOT%" >nul 2>&1
mkdir "%TARGET%" >nul 2>&1
mkdir "%TARGET2%" >nul 2>&1
mkdir "%FOREIGN%" >nul 2>&1
mkdir "%IMPORTSRC%\skills\cli-demo" >nul 2>&1

rem ---- work out the vault selector to hand the client -----------------------
rem ---- work out which vault to test, and the selector to hand the client -------------------
set "VAULT_SOURCE=detected from the Obsidian registry"
if not "%VAULT%"=="" set "VAULT_SOURCE=the VAULT value, from the environment or the EDIT block"
if defined ARG_VAULT (
  set "VAULT=%ARG_VAULT%"
  set "VAULT_SOURCE=passed on the command line"
)
set "VSEL=%VAULTSEL%"
if not "%VSEL%"=="" goto :vault_resolved
if not defined VAULT goto :vault_need_detect
goto :vault_have
:vault_need_detect
node "%~dp0vaultsel.cjs" --detect >%SELFILE% 2>&1
if errorlevel 1 goto :vault_detect_failed
for /f "usebackq tokens=* delims=" %%a in (%SELFILE%) do (set "VAULT=%%a"&goto :vault_first_done)
:vault_first_done
for /f "usebackq skip=1 tokens=* delims=" %%b in (%SELFILE%) do (set "VSEL=%%b"&goto :vault_second_done)
:vault_second_done
:vault_have
if not defined VAULT goto :vault_none
if "%VSEL%"=="" goto :vault_selector
goto :vault_validated
:vault_selector
node "%~dp0vaultsel.cjs" %VAULT% >%SELFILE% 2>nul
set /p VSEL=<%SELFILE%
if not "%VSEL%"=="" goto :vault_validated
for %%c in ("%VAULT%") do set "VBASE=%%~nxc"
set "VSEL=vault=%VBASE%"
goto :vault_validated
:vault_detect_failed
echo.
echo a vault could not be detected. to see what Obsidian knows about your vaults:
echo   test.cmd --list
echo or pass one on the command line:
echo   test.cmd vault=^<vault folder^>
exit /b 4
:vault_none
echo a vault was not settled on. to see what Obsidian knows about your vaults:
echo   test.cmd --list
echo or pass one on the command line:
echo   test.cmd vault=^<vault folder^>
exit /b 4
:vault_validated
if not exist "%VAULT%\" (
  echo a vault folder is not there: %VAULT%
  echo   it came from:  %VAULT_SOURCE%
  echo to see what Obsidian knows about your vaults:
  echo   test.cmd --list
  exit /b 2
)
if not exist "%VAULT%\.obsidian\" echo note: %VAULT% holds no .obsidian folder, so it may not be a vault
:vault_resolved

rem ---- fixtures the safety checks need before anything else runs -----------
set "DEMO=%IMPORTSRC%\skills\cli-demo\SKILL.md"
>"%DEMO%" echo ---
>>"%DEMO%" echo name: cli-demo
>>"%DEMO%" echo description: A skill the command line harness imports
>>"%DEMO%" echo ---
>>"%DEMO%" echo Body text for the harness.

set "GHOSTDIR=%FOREIGN%\.agents\skills\ghost"
mkdir "%GHOSTDIR%" >nul 2>&1
>"%GHOSTDIR%\SKILL.md" echo A directory that Skill Hub never installed.

set "REALDIR=%TARGET2%\.agents\skills\%SKILL_C%"
mkdir "%REALDIR%" >nul 2>&1
>"%REALDIR%\SKILL.md" echo A real directory standing where a link belongs.

pushd "%VAULT%"

> "%REPORT%" echo Banshan Skill Hub command line harness
>>"%REPORT%" echo ran %date% %time%
>>"%REPORT%" echo vault    %VAULT%
>>"%REPORT%" echo selector %VSEL%
>>%REPORT% echo source   %VAULT_SOURCE%
>>"%REPORT%" echo client   %CLIENT%
>>"%REPORT%" echo root     %ROOT%
>>"%REPORT%" echo skills   %SKILL_A%, %SKILL_B%, %SKILL_C%
>>"%REPORT%" echo.

echo ============================================================================
echo  Banshan Skill Hub command line harness
echo  vault    %VAULT%
echo  selector %VSEL%
echo  source   %VAULT_SOURCE%
echo  root     %ROOT%
echo ============================================================================

rem ---- reachability first, so a misconfigured run says so once rather than 76 times
call %CLIENT% %VSEL% banshan-skillhub:info >%OUT% 2>&1
findstr /i /c:"not found" "%OUT%" >nul 2>&1
if errorlevel 1 goto :reach_ok
echo.
echo The obsidian client could not reach the plugin, so nothing below this point can work.
echo This was the command tried, with the reply exactly as it came back:
echo.
echo    %CLIENT% %VSEL% banshan-skillhub:info
call :echoout
echo.
echo In order, check these:
echo    1  Obsidian is running and this vault is open in it.
echo    2  The selector names the right vault. It is currently:  %VSEL%
echo       List the ids with:  type "%APPDATA%\obsidian\obsidian.json"
echo       Then set it by hand at the top of this file, eg  set "VAULTSEL=vault=434750b3b4ad4f9b"
echo    3  Settings, Community plugins, Banshan Skill Hub is switched on.
echo    4  The plugin loaded without an error. Look for one in Settings, Community plugins,
echo       or run  obsidian %VSEL% open  and watch the developer console.
echo.
popd
exit /b 3
:reach_ok

call :section "A. pre flight"
call :run "usage lists the actions" "banshan-skillhub" expect "Actions:"
call :run "an unknown action is refused, by the client itself" "banshan-skillhub:not-a-real-action" expecterr "not found"
call :gatecheck

call :section "B. parameters reach the plugin"
call :run "probe echoes a parameter back" "banshan-skillhub:probe hello=world" expect "reached the command layer"
call :run "probe shows the value it received" "banshan-skillhub:probe hello=world" expect "hello=world"
call :run "probe shows a path value unmangled" "banshan-skillhub:probe target=%TARGET%" expect "target=%TARGET%"
call :jsoncheck

call :section "C. read only actions"
call :run "info answers" "banshan-skillhub:info" noerror ""
call :run "info reports a target" "banshan-skillhub:info target=%TARGET%" noerror ""
call :run "list answers" "banshan-skillhub:list" expect "skills"
call :run "list narrows by filter" "banshan-skillhub:list filter=plan" noerror ""
call :run "list narrows by source" "banshan-skillhub:list source=github" noerror ""
call :run "show reports one skill" "banshan-skillhub:show skill=%SKILL_A%" noerror ""
call :run "show refuses an unknown skill" "banshan-skillhub:show skill=definitely-not-here" expecterr "No skill named"
call :run "search ranks matches" "banshan-skillhub:search query=debug" expect "match"
call :run "search reports nothing found" "banshan-skillhub:search query=zzz-nothing-zzz" noerror ""
call :run "scan finds a skills folder" "banshan-skillhub:scan path=%IMPORTSRC%" expect "found in"
call :run "scan reports a missing skills folder" "banshan-skillhub:scan path=%ROOT%" expecterr "was found in the selected directory"
call :run "refresh answers" "banshan-skillhub:refresh" expect "redrawn from the registry"

call :section "D. install"
call :run "install one skill by copy" "banshan-skillhub:install skill=%SKILL_A% target=%TARGET% method=copy" expect "installed 1"
call :assert_dir "the copied skill is on disk" "%TARGET%\.agents\skills\%SKILL_A%"
call :run "install one skill by link" "banshan-skillhub:install skill=%SKILL_B% target=%TARGET% method=symlink" expect "installed 1"
call :run "install names the mechanism that landed" "banshan-skillhub:install skill=%SKILL_C% target=%TARGET% method=symlink" expect "mechanism"
call :run "install plans without writing" "banshan-skillhub:install skill=all target=%TARGET% dryrun=1" expect " to add,"
call :assert_dir "the plan left the target alone" "%TARGET%\.agents\skills\%SKILL_A%"
call :run "install reports a missing selection" "banshan-skillhub:install target=%TARGET%" expecterr "Pass skill=all"
call :run "install refuses an unknown method" "banshan-skillhub:install skill=%SKILL_A% target=%TARGET% method=teleport" expecterr "Unknown method"
call :run "install refuses an unknown conflict" "banshan-skillhub:install skill=%SKILL_A% target=%TARGET% conflict=smash" expecterr "Unknown conflict"
call :run "install reports an unknown skill" "banshan-skillhub:install skill=definitely-not-here target=%TARGET%" expecterr "No skill named"

call :section "E. target guards, each must refuse before touching anything"
call :run "drive root is refused" "banshan-skillhub:install skill=%SKILL_A% target=C:\" expecterr "is a filesystem root"
call :run "home directory is refused" "banshan-skillhub:install skill=%SKILL_A% target=%HOME%" expecterr "home directory"
call :run "inside the vault is refused" "banshan-skillhub:install skill=%SKILL_A% target=%VAULT%" expecterr "inside the vault"
call :run "a vault skill folder is refused" "banshan-skillhub:install skill=%SKILL_A% target=%VAULT%\%SKILLSFOLDER%" expecterr "inside the vault"
call :run "a target that does not exist is refused" "banshan-skillhub:install skill=%SKILL_A% target=%ROOT%\never-created" expecterr "does not exist yet"
call :run "uninstall refuses the drive root even with confirm" "banshan-skillhub:uninstall target=C:\ confirm=1" expecterr "is a filesystem root"
call :run "uninstall refuses the vault even with confirm" "banshan-skillhub:uninstall target=%VAULT% confirm=1" expecterr "inside the vault"
call :run "link refuses the vault" "banshan-skillhub:link skill=%SKILL_A% target=%VAULT%" expecterr "inside the vault"
call :assert_dir "the vault skill folder survived the guards" "%VAULT%\%SKILLSFOLDER%"

call :section "F. link semantics"
call :run "link again asks for force" "banshan-skillhub:link skill=%SKILL_C% target=%TARGET%" expecterr "already linked"
call :run "link replaces with force" "banshan-skillhub:link skill=%SKILL_C% target=%TARGET% force=1" expect "via "
call :run "link refuses a copy method" "banshan-skillhub:link skill=%SKILL_A% target=%TARGET% method=copy" expecterr "method=symlink"
call :run "link refuses a real directory" "banshan-skillhub:link skill=%SKILL_C% target=%TARGET2%" expecterr "does not account for"
call :assert_dir "the real directory survived" "%REALDIR%"

call :section "G. uninstall, proving it does not overreach"
call :run "uninstall asks for confirm" "banshan-skillhub:uninstall target=%TARGET%" expecterr "Re-run with confirm=1"
call :assert_dir "asking for confirm changed nothing" "%TARGET%\.agents\skills\%SKILL_A%"
call :run "uninstall plans only" "banshan-skillhub:uninstall target=%TARGET% dryrun=1" expect " to remove,"
call :assert_dir "the plan left the installs alone" "%TARGET%\.agents\skills\%SKILL_A%"
call :run "uninstall reports an unrecorded skill" "banshan-skillhub:uninstall target=%TARGET% skill=definitely-not-here confirm=1" expecterr "is recorded as installed at"
call :run "uninstall one recorded skill" "banshan-skillhub:uninstall target=%TARGET% skill=%SKILL_A% confirm=1" expect ": removed"
call :assert_absent "the copy is gone from the target" "%TARGET%\.agents\skills\%SKILL_A%"
call :assert_dir "CRITICAL the vault copy of that skill survived" "%VAULT%\%SKILLSFOLDER%\%SKILL_A%"
call :assert_file "CRITICAL the vault skill body survived" "%VAULT%\%SKILLSFOLDER%\%SKILL_A%\SKILL.md"
call :run "uninstall the rest" "banshan-skillhub:uninstall target=%TARGET% confirm=1" expect ": removed"
call :run "uninstall a tree it never made" "banshan-skillhub:uninstall target=%FOREIGN% confirm=1" expecterr "install record points at"
call :assert_dir "CRITICAL the foreign directory survived" "%GHOSTDIR%"

call :section "H. import"
call :run "import plans only" "banshan-skillhub:import path=%IMPORTSRC% dryrun=1" expect "would be imported via"
call :run "import brings one skill in" "banshan-skillhub:import path=%IMPORTSRC%" expect "imported "
call :assert_dir "CRITICAL the imported skill landed in the vault" "%VAULT%\%SKILLSFOLDER%\cli-demo"
call :run "import again is collision safe" "banshan-skillhub:import path=%IMPORTSRC%" expect "imported "
call :run "import a named folder only" "banshan-skillhub:import path=%IMPORTSRC% skill=cli-demo" expect "imported "
call :run "import reports a missing directory" "banshan-skillhub:import path=%ROOT%\never-created" expecterr "was found in the selected directory"
call :run "import refuses staging inside the vault" "banshan-skillhub:import path=%IMPORTSRC% staging=%VAULT%\staging" expecterr "Staging directory is not usable"
call :run "import refuses a non local source" "banshan-skillhub:import path=%IMPORTSRC% source=github" expecterr "cover local directories only"
set "LEFTBEHIND=%LEFTBEHIND%  imported skills named cli-demo under %VAULT%\%SKILLSFOLDER%, remove them in the Skill Hub view "

call :section "I. settings and order"
call :run "settings lists" "banshan-skillhub:settings" expect "settings"
call :run "settings reads one" "banshan-skillhub:settings key=defaultSort" noerror ""
call :run "settings write asks for confirm" "banshan-skillhub:settings key=defaultSort value=updatedAt" expecterr "Re-run with confirm=1"
call :run "settings write applies" "banshan-skillhub:settings key=defaultSort value=updatedAt confirm=1" expect " set to "
call :run "settings reads the change back" "banshan-skillhub:settings key=defaultSort" expect "updatedAt"
call :run "settings rejects a bad value" "banshan-skillhub:settings key=defaultSort value=sideways confirm=1" expecterr "Unknown defaultSort"
call :run "settings rejects an unknown key" "banshan-skillhub:settings key=definitely-not-a-setting" expecterr "Unknown setting"
call :run "settings protects cliEnabled" "banshan-skillhub:settings key=cliEnabled value=false confirm=1" expecterr "cannot be changed from"
call :run "settings protects npxExecutionEnabled" "banshan-skillhub:settings key=npxExecutionEnabled value=false confirm=1" expecterr "cannot be changed from"
call :run "settings restores the sort" "banshan-skillhub:settings key=defaultSort value=nickname confirm=1" expect " set to "
call :run "order reads" "banshan-skillhub:order" expect "curated entries"
call :run "order write asks for confirm" "banshan-skillhub:order list=%SKILL_A%,%SKILL_B%" expecterr "Re-run with confirm=1"
call :run "order write applies" "banshan-skillhub:order list=%SKILL_A%,%SKILL_B% confirm=1" expect "curated order set to"
call :run "order rejects an unknown name" "banshan-skillhub:order list=definitely-not-here confirm=1" expecterr "was not changed"

call :section "J. the gate, checked by hand"
>>%REPORT% echo SKIP  the gate itself needs the settings tab, which no command line write can reach by design.
>>%REPORT% echo       Switch "Enable Skill Hub command line actions" off, run the two lines below,
>>%REPORT% echo       then switch it back on again.
>>%REPORT% echo         obsidian %VSEL% banshan-skillhub:list    should answer that support is switched off
>>%REPORT% echo         obsidian %VSEL% banshan-skillhub:info    should still answer, reporting the gate as off
>>%REPORT% echo       Switching it back on should make list work again with no plugin reload.
set /a SKIP+=1

call :section "Results"
>>%REPORT% echo.
>>%REPORT% echo checks %TOTAL%   passed %PASS%   failed %FAIL%   skipped %SKIP%
if defined LEFTBEHIND (
  echo.
  echo Left behind on purpose, clean it up in the Skill Hub view when you are done:
  echo%LEFTBEHIND%)
echo.
echo checks %TOTAL%   passed %PASS%   failed %FAIL%   skipped %SKIP%
echo report %REPORT%

popd
if "%1"=="--open" start "" notepad "%REPORT%"
exit /b %FAIL%

rem ============================================================================
rem  harness internals
rem ============================================================================

:parse_args
if "%~1"=="" goto :eof
set "ARG=%~1"
rem both vault=^<vault folder^> and --vault=^<vault folder^> are taken
if /i "%ARG:~0,2%"=="--" set "ARG=%ARG:~2%"
if /i "%ARG:~0,1%"=="-" set "ARG=%ARG:~1%"
set KNOWN=
if /i "%ARG:~0,6%"=="vault=" (
  for /f "delims== tokens=1,*" %%k in ("%ARG%") do set "ARG_VAULT=%%l"
  set KNOWN=yes
  goto :parse_args_next
)
if /i "%ARG%"=="vault" (
set "ARG_VAULT=%~2"
  if not defined ARG_VAULT echo note: vault was given without a folder, so it is ignored
  set KNOWN=yes
  shift
  goto :parse_args_next
)
if /i "%ARG%"=="list" (
  set LIST_REQUESTED=yes
  set KNOWN=yes
  goto :parse_args_next
)
if /i "%ARG%"=="open" (
  set OPEN_REPORT=yes
  set KNOWN=yes
  goto :parse_args_next
)
if /i "%ARG%"=="help" (
  set ARG_HELP=yes
  set KNOWN=yes
  goto :parse_args_next
)
if /i "%~1"=="/?" (
  set ARG_HELP=yes
  set KNOWN=yes
  goto :parse_args_next
)
if defined KNOWN goto :parse_args_next
echo note: ignoring the argument %~1
:parse_args_next
shift
goto :parse_args


:section
echo.
echo ---------------------------------------------------------------------------
echo  %~1
>>%REPORT% echo.
>>%REPORT% echo ---------------------------------------------------------------------------
>>%REPORT% echo  %~1
goto :eof

:gatecheck
call %CLIENT% %VSEL% banshan-skillhub:info >%OUT% 2>&1
findstr /i /c:"command line support is off" "%OUT%" >nul 2>&1
if errorlevel 1 goto :gate_ok
echo.
echo Skill Hub command line support is switched off.
echo Open Settings, Community plugins, Banshan Skill Hub, and switch on
echo "Enable Skill Hub command line actions", then run this harness again.
echo.
call :echoout
popd
exit /b 3
:gate_ok
goto :eof

:run
set /a TOTAL+=1
set "RLABEL=%~1"
set "RTAIL=%~2"
set "RMODE=%~3"
set "REXPECT=%~4"
set "VERDICT=ok"
>>%REPORT% echo.
>>%REPORT% echo CHECK %TOTAL%  %RLABEL%
>>%REPORT% echo   %CLIENT% %VSEL% %RTAIL%
call %CLIENT% %VSEL% %RTAIL% >%OUT% 2>&1
call :echoout
echo   %CLIENT% %VSEL% %RTAIL%

set "ISERROR=no"
findstr /b /c:"ERROR:" "%OUT%" >nul 2>&1
if not errorlevel 1 set "ISERROR=yes"
findstr /b /c:"Error:" "%OUT%" >nul 2>&1
if not errorlevel 1 set "ISERROR=yes"

if "%RMODE%"=="expecterr" (
  if "%ISERROR%"=="no" (
    set "VERDICT=FAILED  the reply was not an error line, expected one mentioning: %REXPECT%"
  ) else (
    findstr /i /c:"%REXPECT%" "%OUT%" >nul 2>&1
    if not errorlevel 1 goto :run_report
    set "VERDICT=FAILED  the error line did not mention: %REXPECT%"
  )
  goto :run_report
)

if "%RMODE%"=="expect" (
  if "%ISERROR%"=="yes" (
    set "VERDICT=FAILED  the reply came back as an error, expected a result mentioning: %REXPECT%"
  ) else (
    findstr /i /c:"%REXPECT%" "%OUT%" >nul 2>&1
    if not errorlevel 1 goto :run_report
    set "VERDICT=FAILED  the reply did not mention: %REXPECT%"
  )
  goto :run_report
)

if "%ISERROR%"=="yes" set "VERDICT=FAILED  the reply came back as an error line"

:run_report
if not "%VERDICT%"=="ok" goto :run_bad
set /a PASS+=1
echo   ok
>>%REPORT% echo   ok
goto :eof

:run_bad
set /a FAIL+=1
echo   %VERDICT%
>>%REPORT% echo   %VERDICT%
goto :eof

:echoout
rem the reply is copied into the report line by line, never through a pipe
for /f "usebackq tokens=* delims=" %%l in (%OUT%) do >>%REPORT% echo   %%l
goto :eof

:assert_dir
set /a TOTAL+=1
>>%REPORT% echo.
>>%REPORT% echo CHECK %TOTAL%  %~1
>>%REPORT% echo   directory %~2
if exist "%~2\" goto :assert_hit
set /a FAIL+=1
echo   FAILED  the directory is missing
>>%REPORT% echo   FAILED  the directory is missing
goto :eof

:assert_file
set /a TOTAL+=1
>>%REPORT% echo.
>>%REPORT% echo CHECK %TOTAL%  %~1
>>%REPORT% echo   file %~2
if exist "%~2" goto :assert_hit
set /a FAIL+=1
echo   FAILED  the file is missing
>>%REPORT% echo   FAILED  the file is missing
goto :eof

:assert_absent
set /a TOTAL+=1
>>%REPORT% echo.
>>%REPORT% echo CHECK %TOTAL%  %~1
>>%REPORT% echo   %~2 should be gone
if exist "%~2" goto :assert_miss
set /a PASS+=1
echo   ok
>>%REPORT% echo   ok
goto :eof

:assert_hit
set /a PASS+=1
echo   ok
>>%REPORT% echo   ok
goto :eof

:assert_miss
set /a FAIL+=1
echo   FAILED  it is still there
>>%REPORT% echo   FAILED  it is still there
goto :eof

:jsoncheck
set /a TOTAL+=1
set /a LINES=0
>>%REPORT% echo.
>>%REPORT% echo CHECK %TOTAL%  json arrives indented rather than as one line that can be clipped away
>>%REPORT% echo   %CLIENT% %VSEL% banshan-skillhub:list format=json
call %CLIENT% %VSEL% banshan-skillhub:list format=json >%OUT% 2>&1
call :echoout
for /f "usebackq tokens=* delims=" %%l in (%OUT%) do set /a LINES+=1
set "VERDICT=ok"
findstr /c:"{" "%OUT%" >nul 2>&1
if errorlevel 1 set "VERDICT=FAILED  the reply holds no json"
if not "%VERDICT%"=="ok" goto :json_bad
if %LINES% geq 3 goto :json_good
set "VERDICT=FAILED  the json came back on %LINES% lines, so a long payload could still be clipped"

:json_bad
set /a FAIL+=1
echo   %VERDICT%
>>%REPORT% echo   %VERDICT%
goto :eof

:json_good
set /a PASS+=1
echo   ok  %LINES% lines
>>%REPORT% echo   ok  %LINES% lines
goto :eof
