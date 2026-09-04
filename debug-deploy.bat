@echo off
REM Debug version: trace the deploy-github.bat to find the parse error
setlocal EnableExtensions EnableDelayedExpansion
echo === Debug: enabling echo ===
endlocal
cmd /v /c "deploy-github.bat" 2>&1
