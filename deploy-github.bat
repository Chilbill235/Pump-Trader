@echo off
setlocal EnableExtensions

REM ============================================================
REM Direct Git Push - No Auth Checks, No NPM Checks
REM Usage:
REM    deploy-github.bat                 (commit + push to current branch)
REM    deploy-github.bat "your msg"      (custom commit message)
REM ============================================================

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
if "%REPO_DIR%"=="" set "REPO_DIR=%SCRIPT_DIR%"
if "%REMOTE_NAME%"=="" set "REMOTE_NAME=origin"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Update project"
set "GH_REPO=https://github.com/Chilbill235/Pump-Trader.git"

cd /d "%REPO_DIR%"
if errorlevel 1 (
  echo [ERROR] Could not navigate to %REPO_DIR%
  exit /b 1
)

REM --- Ensure local git repo exists ---
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [INFO] Initializing git repository...
  git init
  git branch -M main
)

REM --- Ensure remote origin exists ---
git remote get-url "%REMOTE_NAME%" >nul 2>&1
if errorlevel 1 (
  echo [INFO] Adding remote %REMOTE_NAME%...
  git remote add "%REMOTE_NAME%" "%GH_REPO%"
)

REM --- Determine current branch name ---
for /f "delims=" %%B in ('git rev-parse --abbrev-ref HEAD 2^>nul') do set "BRANCH_NAME=%%B"
if "%BRANCH_NAME%"=="" set "BRANCH_NAME=main"

echo === Staging files ===
git add -A

echo === Committing changes ===
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "%COMMIT_MSG%"
) else (
  echo [INFO] Nothing new to commit.
)

echo === Pushing to %REMOTE_NAME%/%BRANCH_NAME% ===
git push -u "%REMOTE_NAME%" "%BRANCH_NAME%"

if errorlevel 1 (
  echo [ERROR] Push failed.
  exit /b 1
)

echo === Successfully uploaded to GitHub ===
endlocal