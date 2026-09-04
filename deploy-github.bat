@echo off
setlocal EnableExtensions EnableDelayedExpansion

REM ============================================================
REM Pump Trader - auto upload to GitHub
REM Usage:
REM   deploy-github.bat                (commit + push to current branch)
REM   deploy-github.bat "msg"          (custom commit message)
REM   set GH_TOKEN=ghp_xxx ^&^& deploy-github.bat
REM
REM Optional env vars:
REM   GH_TOKEN        - GitHub PAT. If set, push uses token auth (good for
REM                     unattended / scheduled runs). If unset, uses the
REM                     credential helper already configured with `git`.
REM   BRANCH_NAME     - branch to push (default: current branch)
REM   REMOTE_NAME     - remote to push to (default: origin)
REM   REPO_DIR        - project root (default: this script's folder)
REM   SKIP_INSTALL    - set to 1 to skip `npm ci`
REM ============================================================

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
set "REPO_DIR=%REPO_DIR%"
if "%REPO_DIR%"=="" set "REPO_DIR=%SCRIPT_DIR%"
set "BRANCH_NAME=%BRANCH_NAME%"
set "REMOTE_NAME=%REMOTE_NAME%"
if "%REMOTE_NAME%"=="" set "REMOTE_NAME=origin"
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Update pump-trader"
set "GH_REPO=https://github.com/Chilbill235/Pump-Trader"

cd /d "%REPO_DIR%" || (
  echo [ERROR] Could not cd to %REPO_DIR%
  exit /b 1
)

echo === Repository: %REPO_DIR% ===

where git >nul 2>&1 || (
  echo [ERROR] git is not installed or not in PATH.
  exit /b 1
)

REM --- Sanity: must be a git repo, otherwise init + add remote. ---
git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo [INFO] Not a git repo. Initialising...
  git init
  if errorlevel 1 (
    echo [ERROR] git init failed.
    exit /b 1
  )
  git checkout -b main 2>nul
)

REM --- Ensure remote exists. ---
git remote get-url %REMOTE_NAME% >nul 2>&1
if errorlevel 1 (
  echo [INFO] Remote '%REMOTE_NAME%' missing. Adding %GH_REPO%.
  git remote add %REMOTE_NAME% %GH_REPO%
  if errorlevel 1 (
    echo [ERROR] git remote add failed.
    exit /b 1
  )
)

REM --- Default branch if caller didn't override and we are unborn. ---
git symbolic-ref --short HEAD >nul 2>&1
if errorlevel 1 (
  echo [INFO] No current branch. Creating 'main'.
  git checkout -b main
)
if "%BRANCH_NAME%"=="" for /f "delims=" %%B in ('git symbolic-ref --short HEAD') do set "BRANCH_NAME=%%B"

REM --- Pull first if the remote branch exists (keeps history linear). ---
git ls-remote --heads %REMOTE_NAME% %BRANCH_NAME% >nul 2>&1
if not errorlevel 1 (
  echo === git pull --rebase --autostash %REMOTE_NAME% %BRANCH_NAME% ===
  git pull --rebase --autostash %REMOTE_NAME% %BRANCH_NAME%
  if errorlevel 1 (
    echo [WARN] pull --rebase failed, falling back to merge.
    git pull %REMOTE_NAME% %BRANCH_NAME%
  )
)

REM --- Install deps (skip if SKIP_INSTALL=1 or node_modules looks fresh). ---
if not "%SKIP_INSTALL%"=="1" (
  if not exist "node_modules" (
    echo === npm ci ===
    npm ci
    if errorlevel 1 (
      echo [WARN] npm ci failed, trying npm install.
      npm install
    )
  )
)

REM --- Verify typecheck + lint pass before committing. ---
echo === typecheck ===
call npm run typecheck
if errorlevel 1 (
  echo [ERROR] typecheck failed. Fix errors before deploying.
  exit /b 1
)

echo === lint ===
call npm run lint
if errorlevel 1 (
  echo [ERROR] lint failed. Fix errors before deploying.
  exit /b 1
)

REM --- Stage everything. ---
echo === git add -A ===
git add -A
if errorlevel 1 (
  echo [ERROR] git add failed.
  exit /b 1
)

REM --- Commit only if there's something new. ---
git diff --cached --quiet
if errorlevel 1 (
  echo === git commit -m "%COMMIT_MSG%" ===
  git commit -m "%COMMIT_MSG%"
  if errorlevel 1 (
    echo [ERROR] git commit failed.
    exit /b 1
  )
) else (
  echo [INFO] Nothing to commit, skipping commit.
)

REM --- Push, with token auth if GH_TOKEN is set. ---
if defined GH_TOKEN (
  for /f "delims=" %%R in ('git remote get-url %REMOTE_NAME%') do set "REMOTE_URL=%%R"
  set "AUTH_URL=!REMOTE_URL:https://=https://%GH_TOKEN%@!"
  echo === git push (token) %REMOTE_NAME% %BRANCH_NAME% ===
  git push "!AUTH_URL!" "%BRANCH_NAME%"
  set "RC=%ERRORLEVEL%"
  REM Strip token from any cached URL we just created.
  set "AUTH_URL=!REMOTE_URL!"
) else (
  echo === git push %REMOTE_NAME% %BRANCH_NAME% ===
  git push "%REMOTE_NAME%" "%BRANCH_NAME%"
  set "RC=%ERRORLEVEL%"
)

if not "%RC%"=="0" (
  echo [ERROR] git push failed with code %RC%.
  echo Hint: if this is an auth failure, set GH_TOKEN=ghp_xxxxxxxxxxxxxxxx
  exit /b %RC%
)

echo === done ===
endlocal
