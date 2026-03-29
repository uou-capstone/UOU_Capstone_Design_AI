@echo off
setlocal EnableExtensions

cd /d "%~dp0"

if not exist ".env" (
  echo [run.cmd] .env not found. Creating from .env.example
  if not exist ".env.example" (
    echo [run.cmd] .env.example missing. Please restore it and retry.
    exit /b 1
  )
  copy /y ".env.example" ".env" >nul
  echo [run.cmd] Fill GOOGLE_API_KEY in .env and rerun.
  exit /b 1
)

for /f "usebackq tokens=* delims=" %%L in (".env") do call :load_env_line "%%L"

for %%K in (PORT WEB_PORT AI_BRIDGE_PORT MODEL_NAME GOOGLE_API_KEY PASS_SCORE_RATIO CONTEXT_MAX_CHARS RECENT_MESSAGES_N DATA_DIR UPLOAD_DIR) do (
  call set "VAL=%%%K%%"
  if not defined VAL (
    echo [run.cmd] Missing required env: %%K
    exit /b 1
  )
  set "VAL="
)

if /i "%GOOGLE_API_KEY%"=="YOUR_KEY_HERE" (
  echo [run.cmd] GOOGLE_API_KEY is placeholder. Update .env first.
  exit /b 1
)

if not exist "%DATA_DIR%\sessions" mkdir "%DATA_DIR%\sessions"
if not exist "%UPLOAD_DIR%" mkdir "%UPLOAD_DIR%"

set "SELECTED_PY="
set "SELECTED_VERSION="

if defined PYTHON_BIN (
  call :version_of "%PYTHON_BIN%" PYVER
  if not defined PYVER (
    echo [run.cmd] PYTHON_BIN=%PYTHON_BIN% was not executable.
    exit /b 1
  )
  call :is_supported_py "%PYVER%"
  if errorlevel 1 (
    echo [run.cmd] PYTHON_BIN=%PYTHON_BIN% is Python %PYVER% ^(unsupported^).
    echo [run.cmd] Supported range is Python 3.11 ~ 3.13.
    exit /b 1
  )
  set "SELECTED_PY=%PYTHON_BIN%"
  set "SELECTED_VERSION=%PYVER%"
)

if not defined SELECTED_PY call :try_python "py -3.13"
if not defined SELECTED_PY call :try_python "py -3.12"
if not defined SELECTED_PY call :try_python "py -3.11"
if not defined SELECTED_PY call :try_python "python3.13"
if not defined SELECTED_PY call :try_python "python3.12"
if not defined SELECTED_PY call :try_python "python3.11"
if not defined SELECTED_PY call :try_python "python"

if not defined SELECTED_PY (
  echo [run.cmd] No compatible Python found.
  echo [run.cmd] Install Python 3.13 or 3.12, then rerun.
  echo [run.cmd] Optionally set PYTHON_BIN=py -3.13
  exit /b 1
)

echo [run.cmd] Selected Python: %SELECTED_PY% ^(%SELECTED_VERSION%^)

if exist ".venv" (
  if not exist ".venv\Scripts\python.exe" (
    call :timestamp TS
    set "BACKUP=.venv.invalid.bak.%TS%"
    echo [run.cmd] Existing .venv is invalid. Backing up to %BACKUP%
    ren ".venv" "%BACKUP%"
    if errorlevel 1 (
      echo [run.cmd] Failed to back up .venv. Remove it manually and retry.
      exit /b 1
    )
  ) else (
    call :version_of ".venv\Scripts\python.exe" VENV_VER
    call :is_supported_py "%VENV_VER%"
    if errorlevel 1 (
      call :timestamp TS
      set "VENV_SUFFIX=%VENV_VER:.=%"
      if not defined VENV_SUFFIX set "VENV_SUFFIX=unknown"
      set "BACKUP=.venv.py%VENV_SUFFIX%.bak.%TS%"
      echo [run.cmd] Existing .venv uses unsupported Python ^(%VENV_VER%^).
      echo [run.cmd] Backing up current .venv to %BACKUP%
      ren ".venv" "%BACKUP%"
      if errorlevel 1 (
        echo [run.cmd] Failed to back up .venv. Remove it manually and retry.
        exit /b 1
      )
    ) else (
      echo [run.cmd] Reusing existing compatible .venv ^(Python %VENV_VER%^)
    )
  )
)

if not exist ".venv" (
  echo [run.cmd] Creating .venv with %SELECTED_PY%
  cmd /c "%SELECTED_PY% -m venv .venv"
  if errorlevel 1 (
    echo [run.cmd] Failed to create .venv using %SELECTED_PY%
    exit /b 1
  )
)

if not exist ".venv\Scripts\python.exe" (
  echo [run.cmd] Virtualenv python not found at .venv\Scripts\python.exe
  exit /b 1
)

call :version_of ".venv\Scripts\python.exe" ACTIVE_VERSION
call :is_supported_py "%ACTIVE_VERSION%"
if errorlevel 1 (
  echo [run.cmd] Active virtualenv Python is unsupported: %ACTIVE_VERSION%
  echo [run.cmd] Expected Python 3.11 ~ 3.13. Remove .venv and rerun.
  exit /b 1
)

echo [run.cmd] Installing Python dependencies with .venv\Scripts\python.exe ^(%ACTIVE_VERSION%^)
.venv\Scripts\python.exe -m pip install --upgrade pip >nul
if errorlevel 1 (
  echo [run.cmd] Failed to upgrade pip.
  exit /b 1
)

.venv\Scripts\python.exe -m pip install -r apps\ai-bridge\requirements.txt >nul
if errorlevel 1 (
  echo [run.cmd] Failed to install ai-bridge requirements.
  echo [run.cmd] Python: .venv\Scripts\python.exe ^(%ACTIVE_VERSION%^)
  echo [run.cmd] If network was unstable, retry .\run.cmd
  exit /b 1
)

echo [run.cmd] Installing Node dependencies
call npm install
if errorlevel 1 (
  echo [run.cmd] npm install failed.
  exit /b 1
)

echo [run.cmd] Web: http://localhost:%WEB_PORT%
echo [run.cmd] Server: http://localhost:%PORT%
echo [run.cmd] AI Bridge: http://localhost:%AI_BRIDGE_PORT%

call npx concurrently -n server,web,bridge -c cyan,magenta,yellow ^
  "npm run dev -w apps/server" ^
  "npm run dev -w apps/web" ^
  "\".venv\\Scripts\\python.exe\" -m uvicorn --app-dir apps/ai-bridge main:app --host 127.0.0.1 --port %AI_BRIDGE_PORT% --reload"
set "EXIT_CODE=%ERRORLEVEL%"
exit /b %EXIT_CODE%

:try_python
set "CAND=%~1"
call :version_of "%CAND%" CVER
if not defined CVER exit /b 0
call :is_supported_py "%CVER%"
if errorlevel 1 exit /b 0
set "SELECTED_PY=%CAND%"
set "SELECTED_VERSION=%CVER%"
exit /b 0

:version_of
set "PY_CMD=%~1"
set "TMP_FILE=%TEMP%\mergeedu_pyver_%RANDOM%%RANDOM%.txt"
if exist "%TMP_FILE%" del /q "%TMP_FILE%" >nul 2>nul
cmd /c "%PY_CMD% -c ^"import sys;print(str(sys.version_info.major)+'.'+str(sys.version_info.minor))^"" > "%TMP_FILE%" 2>nul
set "VER="
if exist "%TMP_FILE%" (
  set /p VER=<"%TMP_FILE%"
  del /q "%TMP_FILE%" >nul 2>nul
)
if "%VER%"=="ECHO is off." set "VER="
set "%~2=%VER%"
exit /b 0

:is_supported_py
set "MAJOR="
set "MINOR="
for /f "tokens=1,2 delims=." %%M in ("%~1") do (
  set "MAJOR=%%M"
  set "MINOR=%%N"
)
if not "%MAJOR%"=="3" exit /b 1
if not defined MINOR exit /b 1
for /f "delims=0123456789" %%X in ("%MINOR%") do if not "%%X"=="" exit /b 1
if %MINOR% LSS 11 exit /b 1
if %MINOR% GTR 13 exit /b 1
exit /b 0

:timestamp
set "TS="
for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMddHHmmss" 2^>nul') do set "TS=%%T"
if not defined TS set "TS=%RANDOM%%RANDOM%"
set "%~1=%TS%"
exit /b 0

:load_env_line
set "LINE=%~1"
if "%LINE%"=="" exit /b 0
if "%LINE:~0,1%"=="#" exit /b 0
for /f "tokens=1,* delims==" %%K in ("%LINE%") do (
  if not "%%~K"=="" set "%%~K=%%~L"
)
exit /b 0
