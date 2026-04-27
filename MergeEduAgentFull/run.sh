#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

version_of() {
  local pybin="$1"
  "$pybin" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")' 2>/dev/null
}

is_supported_py() {
  local version="$1"
  local major="${version%%.*}"
  local minor="${version#*.}"
  [[ "$major" == "3" ]] || return 1
  [[ "$minor" =~ ^[0-9]+$ ]] || return 1
  (( minor >= 11 && minor <= 13 ))
}

has_python_bin() {
  local pybin="$1"
  if [[ "$pybin" == */* ]]; then
    [[ -x "$pybin" ]]
  else
    command -v "$pybin" >/dev/null 2>&1
  fi
}

pick_python() {
  local candidates=()
  if [ -n "${PYTHON_BIN:-}" ]; then
    candidates+=("$PYTHON_BIN")
  fi
  candidates+=("python3.13" "python3.12" "python3.11" "python3")

  for pybin in "${candidates[@]}"; do
    if ! has_python_bin "$pybin"; then
      continue
    fi

    local ver
    ver="$(version_of "$pybin" || true)"
    if [ -z "$ver" ]; then
      continue
    fi

    if is_supported_py "$ver"; then
      echo "$pybin"
      return 0
    fi

    if [ -n "${PYTHON_BIN:-}" ] && [ "$pybin" = "$PYTHON_BIN" ]; then
      echo "[run.sh] PYTHON_BIN=$PYTHON_BIN is Python $ver (unsupported)." >&2
      echo "[run.sh] Supported range is Python 3.11 ~ 3.13." >&2
      return 1
    fi
  done

  echo "[run.sh] No compatible Python found." >&2
  echo "[run.sh] Install python3.13 or python3.12, then rerun." >&2
  echo "[run.sh] Optionally set PYTHON_BIN=/path/to/python3.13" >&2
  return 1
}

if [ ! -f .env ]; then
  echo "[run.sh] .env not found. Creating from .env.example"
  if [ ! -f .env.example ]; then
    echo "[run.sh] .env.example missing. Please restore it and retry."
    exit 1
  fi
  cp .env.example .env
  echo "[run.sh] Fill GOOGLE_API_KEY in .env and rerun."
  exit 1
fi

set -a
source .env
set +a

required=(PORT WEB_PORT AI_BRIDGE_PORT MODEL_NAME GOOGLE_API_KEY PASS_SCORE_RATIO CONTEXT_MAX_CHARS RECENT_MESSAGES_N DATA_DIR UPLOAD_DIR)
for key in "${required[@]}"; do
  if [ -z "${!key:-}" ]; then
    echo "[run.sh] Missing required env: $key"
    exit 1
  fi
done

if [ "$GOOGLE_API_KEY" = "YOUR_KEY_HERE" ]; then
  echo "[run.sh] GOOGLE_API_KEY is placeholder. Update .env first."
  exit 1
fi

mkdir -p "$DATA_DIR/sessions" "$UPLOAD_DIR"

SELECTED_PYTHON="$(pick_python)"
SELECTED_VERSION="$(version_of "$SELECTED_PYTHON")"
echo "[run.sh] Selected Python: $SELECTED_PYTHON ($SELECTED_VERSION)"

if [ -d .venv ]; then
  if [ ! -x .venv/bin/python ]; then
    backup=".venv.invalid.bak.$(date +%Y%m%d%H%M%S)"
    echo "[run.sh] Existing .venv is invalid. Backing up to $backup"
    mv .venv "$backup"
  else
    venv_version="$(version_of .venv/bin/python || true)"
    if [ -z "$venv_version" ] || ! is_supported_py "$venv_version"; then
      suffix="${venv_version:-unknown}"
      suffix="${suffix/./}"
      backup=".venv.py${suffix}.bak.$(date +%Y%m%d%H%M%S)"
      echo "[run.sh] Existing .venv uses unsupported Python (${venv_version:-unknown})."
      echo "[run.sh] Backing up current .venv to $backup"
      mv .venv "$backup"
    else
      echo "[run.sh] Reusing existing compatible .venv (Python $venv_version)"
    fi
  fi
fi

if [ ! -d .venv ]; then
  echo "[run.sh] Creating .venv with $SELECTED_PYTHON"
  "$SELECTED_PYTHON" -m venv .venv
fi

source .venv/bin/activate
ACTIVE_PY="$(command -v python)"
ACTIVE_VERSION="$(version_of python || true)"
if [ -z "$ACTIVE_VERSION" ] || ! is_supported_py "$ACTIVE_VERSION"; then
  echo "[run.sh] Active virtualenv Python is unsupported: ${ACTIVE_VERSION:-unknown}" >&2
  echo "[run.sh] Expected Python 3.11 ~ 3.13. Remove .venv and rerun." >&2
  exit 1
fi

echo "[run.sh] Installing Python dependencies with $ACTIVE_PY ($ACTIVE_VERSION)"
if ! python -m pip install --upgrade pip >/dev/null; then
  echo "[run.sh] Failed to upgrade pip using $ACTIVE_PY ($ACTIVE_VERSION)" >&2
  exit 1
fi

if ! python -m pip install -r apps/ai-bridge/requirements.txt >/dev/null; then
  echo "[run.sh] Failed to install ai-bridge requirements." >&2
  echo "[run.sh] Python: $ACTIVE_PY ($ACTIVE_VERSION)" >&2
  echo "[run.sh] If network was unstable, retry ./run.sh" >&2
  exit 1
fi

echo "[run.sh] Installing Node dependencies"
npm install

echo "[run.sh] Web: http://localhost:${WEB_PORT}"
echo "[run.sh] Server: http://localhost:${PORT}"
echo "[run.sh] AI Bridge: http://localhost:${AI_BRIDGE_PORT}"
npm run dev
