@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM Pump Trader - auto upload to GitHub
REM Usage: deploy-github.bat
REM ============================================================

set "REPO_DIR=C:\Users\kapon\Downloads\pump-trader"
set "BRANCH_NAME=main"
set "REMOTE_NAME=origin"
set "COMMIT_MSG=Update pump-trader"
set "GH_REPO=https://github.com/Chilbill235/Pump-Trader"

cd /d "%REPO_DIR%" || (
  echo [ERROR] Could not cd to %REPO_DIR%
  exit /b 1
)

where git >nul 2>&1 || (
  echo [ERROR] git is not installed or not in PATH.
  exit /b 1
)

echo === git add -A ===
git add -A
if errorlevel 1 (
  echo [ERROR] git add failed.
  exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
  echo === git commit ===
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo [ERROR] git commit failed.
    exit /b 1
  )
) else (
  echo [INFO] Nothing to commit, skipping commit.
)

if defined GH_TOKEN (
  for /f "delims=" %%R in ('git remote get-url %REMOTE_NAME%') do set "REMOTE_URL=%%R"
  set "AUTH_URL=!REMOTE_URL:https://=https://%GH_TOKEN%@!"
  echo === git push (token) "%BRANCH_NAME%" ===
  git push "!AUTH_URL!" "%BRANCH_NAME%"
  set "RC=%ERRORLEVEL%"
) else (
  echo === git push %REMOTE_NAME% "%BRANCH_NAME%" ===
  git push "%REMOTE_NAME%" "%BRANCH_NAME%"
  set "RC=%ERRORLEVEL%"
)

if not "%RC%"=="0" (
  echo [ERROR] git push failed with code %RC%.
  exit /b %RC%
)

echo === done ===
endlocal