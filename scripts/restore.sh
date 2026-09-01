#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
FORCE=false

if [[ "${1:-}" == "--force" ]]; then
  FORCE=true
elif [[ $# -gt 0 ]]; then
  printf 'Usage: %s [--force]\n' "$0" >&2
  exit 2
fi

if [[ -f "$PI_DIR/settings.json" && "$FORCE" != true ]]; then
  printf 'Refusing to overwrite %s. Use --force after making a backup.\n' "$PI_DIR/settings.json" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required to restore Pi packages.\n' >&2
  exit 1
fi

mkdir -p "$PI_DIR/extensions" "$PI_DIR/npm"
cp "$ROOT/settings.json" "$PI_DIR/settings.json"
if [[ -f "$ROOT/models.json" ]]; then
  cp "$ROOT/models.json" "$PI_DIR/models.json"
fi
if [[ -f "$ROOT/APPEND_SYSTEM.md" ]]; then
  cp "$ROOT/APPEND_SYSTEM.md" "$PI_DIR/APPEND_SYSTEM.md"
fi
cp -R "$ROOT/extensions/." "$PI_DIR/extensions/"
cp "$ROOT/npm/package.json" "$PI_DIR/npm/package.json"
cp "$ROOT/npm/package-lock.json" "$PI_DIR/npm/package-lock.json"

(
  cd "$PI_DIR/npm"
  npm ci --omit=dev
)

printf 'Restored Pi configuration to %s.\n' "$PI_DIR"
printf 'Credentials were not changed. Run /login in Pi when needed.\n'
