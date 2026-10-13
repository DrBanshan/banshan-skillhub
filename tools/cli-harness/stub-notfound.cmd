@echo off
rem A stand in client that behaves like the one that answers when no vault was resolved,
rem which is how the harness early exit path gets exercised.
echo Error: Command "%~1" not found. It may require a plugin to be enabled.
exit /b 0
