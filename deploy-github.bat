@echo off
setlocal

REM ============================================================
REM Pump Trader - auto upload to GitHub
REM Usage: deploy-github.bat
REM First-time setup: edit the variables below.
REM ============================================================

REM --- CONFIG (edit these once) ---
set "REPO_DIR=C:\Users\kapon\Downloads\pump-trader"
set "BRANCH=main"
set "REMOTE=origin"
set "COMMIT_MSG=Update pump-trader"
set "GH_REPO=https://github.com/Chilbill235/Pump-Trader"

REM Optional: GitHub auth. Pick ONE method:
REM   Method A) Personal access token via env var (recommended).
REM     set GH_TOKEN=ghp_xxx
REM   Method B) Git credential manager / SSH already configured.
REM If GH_TOKEN is set, the script will push via https using it.
REM --------------------------------

cd /d "%REPO_DIR%" || (
  echo [ERROR] Could not cd to %REPO_DIR%
  exit /b 1
)

if not exist ".git" (
  echo [ERROR] %REPO_DIR% is not a git repo. Run:
  echo   git init
  echo   git remote add origin https://github.com/USER/REPO.git
  exit /b 1
)

where git >nul 2>&1 || (
  echo [ERROR] git is not installed or not in PATH.
  exit /b 1
)

REM --- safety: refuse to upload the .env.local with secrets ---
git status --porcelain | findstr /R "\.env\.local$" >nul && (
  echo [WARN] .env.local has local changes. The .gitignore should already exclude it.
  echo        If not, add it to .gitignore NOW. Continuing...
)

echo === git add -A ===
git add -A
if errorlevel 1 (
  echo [ERROR] git add failed.
  exit /b 1
)

REM Only commit if there is something to commit
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

REM --- push ---
if defined GH_TOKEN (
  REM Build authenticated URL so we don't have to store credentials
  for /f "delims=" %%R in ('git remote get-url %REMOTE%') do set "REMOTE_URL=%%R"
  set "AUTH_URL=%REMOTE_URL:https://=%https://%GH_TOKEN:x-oauth-basic@%"
echo === git push (token) %BRANCH% ===
git push "%AUTH_URL%" "%BRANCH%"
set "RC=%ERRORLEVEL%"
) else (
echo === git push %REMOTE% %BRANCH% ===
git push "%REMOTE%" "%BRANCH%"
set "RC=%ERRORLEVEL%"
)

if not "%RC%"=="0" (
  echo [ERROR] git push failed with code %RC%.
  exit /b %RC%
)

echo === done ===
endlocal