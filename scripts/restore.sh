#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
FORCE=false
SKIP_NPM_INSTALL=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --skip-npm-install) SKIP_NPM_INSTALL=true ;;
    *)
      printf 'Usage: %s [--force] [--skip-npm-install]\n' "$0" >&2
      exit 2
      ;;
  esac
done

mkdir -p "$PI_DIR"
BACKUP_DIR="$PI_DIR/backups/my-pi-cfg/$(date +%Y%m%d-%H%M%S)"
BACKUP_CREATED=false

backup_existing() {
  local target="$1"
  local relative="$2"

  if [[ ! -e "$target" && ! -L "$target" ]]; then
    return
  fi

  if [[ "$FORCE" != true ]]; then
    printf 'Refusing to replace %s. Use --force after making a backup.\n' "$target" >&2
    exit 1
  fi

  if [[ "$BACKUP_CREATED" != true ]]; then
    mkdir -p "$BACKUP_DIR"
    BACKUP_CREATED=true
  fi

  mkdir -p "$BACKUP_DIR/$(dirname "$relative")"
  mv "$target" "$BACKUP_DIR/$relative"
}

link_path() {
  local relative="$1"
  local source="$ROOT/$relative"
  local target="$PI_DIR/$relative"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    return
  fi

  backup_existing "$target" "$relative"
  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
}

link_external_path() {
  local relative="$1"
  local target="$2"
  local source="$ROOT/$relative"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    return
  fi

  backup_existing "$target" "global-mcp.json"
  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
}

link_path "settings.json"
link_path "models.json"
link_path "APPEND_SYSTEM.md"
link_path "extensions"
link_path "npm/package.json"
link_path "npm/package-lock.json"
link_external_path "mcp.json" "$HOME/.config/mcp/mcp.json"

if [[ "$SKIP_NPM_INSTALL" == true ]]; then
  printf 'Skipped npm package installation.\n'
elif ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required to install Pi packages.\n' >&2
  exit 1
else
  if python3 - "$PI_DIR/npm/package.json" "$PI_DIR/npm/package-lock.json" "$PI_DIR/npm/node_modules" <<'PY'
import json
import pathlib
import sys

package_path, lock_path, modules_path = map(pathlib.Path, sys.argv[1:])
try:
    package = json.loads(package_path.read_text())
    lock = json.loads(lock_path.read_text())
except (OSError, json.JSONDecodeError):
    raise SystemExit(1)

for name in package.get("dependencies", {}):
    installed_path = modules_path / name / "package.json"
    locked = lock.get("packages", {}).get(f"node_modules/{name}", {}).get("version")
    try:
        installed = json.loads(installed_path.read_text()).get("version")
    except (OSError, json.JSONDecodeError):
        raise SystemExit(1)
    if not locked or installed != locked:
        raise SystemExit(1)
PY
  then
    printf 'Existing npm package versions match the lockfile.\n'
  else
    (
      cd "$PI_DIR/npm"
      npm ci --omit=dev --legacy-peer-deps
    )
  fi
fi

if [[ "$BACKUP_CREATED" == true ]]; then
  printf 'Backed up replaced files to %s.\n' "$BACKUP_DIR"
fi
printf 'Pi now uses symlinks from %s.\n' "$ROOT"
printf 'Credentials were not changed. Run /login in Pi when needed.\n'
