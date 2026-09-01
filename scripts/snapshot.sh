#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PI_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

if [[ ! -f "$PI_DIR/settings.json" ]]; then
  printf 'Pi settings were not found at %s.\n' "$PI_DIR/settings.json" >&2
  exit 1
fi

ROOT="$ROOT" PI_DIR="$PI_DIR" python3 <<'PY'
import copy
import json
import os
from pathlib import Path

root = Path(os.environ["ROOT"])
pi_dir = Path(os.environ["PI_DIR"])

settings = json.loads((pi_dir / "settings.json").read_text())
settings.pop("lastChangelogVersion", None)

lock_path = pi_dir / "npm" / "package-lock.json"
if lock_path.exists():
    lock = json.loads(lock_path.read_text())
    lock_packages = lock.get("packages", {})
else:
    lock_packages = {}


def pin_source(source):
    if not isinstance(source, str) or not source.startswith("npm:"):
        return source

    raw = source[4:]
    name = raw.rsplit("@", 1)[0] if "@" in raw[1:] else raw
    version = lock_packages.get(f"node_modules/{name}", {}).get("version")
    return f"npm:{name}@{version}" if version else source


packages = settings.get("packages")
if isinstance(packages, list):
    rewritten = []
    for package in packages:
        if isinstance(package, dict):
            package = copy.deepcopy(package)
            if "source" in package:
                package["source"] = pin_source(package["source"])
        else:
            package = pin_source(package)
        rewritten.append(package)
    settings["packages"] = rewritten

(root / "settings.json").write_text(json.dumps(settings, indent=2, sort_keys=True) + "\n")
PY

if [[ -f "$PI_DIR/models.json" ]]; then
  cp "$PI_DIR/models.json" "$ROOT/models.json"
else
  rm -f "$ROOT/models.json"
fi

if [[ -f "$PI_DIR/APPEND_SYSTEM.md" ]]; then
  cp "$PI_DIR/APPEND_SYSTEM.md" "$ROOT/APPEND_SYSTEM.md"
else
  rm -f "$ROOT/APPEND_SYSTEM.md"
fi

rm -rf "$ROOT/extensions"
mkdir -p "$ROOT/extensions"
if [[ -d "$PI_DIR/extensions" ]]; then
  cp -R "$PI_DIR/extensions/." "$ROOT/extensions/"
fi

ROOT="$ROOT" python3 <<'PY'
import os
from pathlib import Path

for path in Path(os.environ["ROOT"], "extensions").rglob("*"):
    if path.suffix not in {".ts", ".js", ".json"} or not path.is_file():
        continue
    text = path.read_text()
    cleaned = "\n".join(line.rstrip(" \t") for line in text.split("\n"))
    if cleaned != text:
        path.write_text(cleaned)
PY

if [[ -f "$PI_DIR/npm/package.json" ]]; then
  cp "$PI_DIR/npm/package.json" "$ROOT/npm/package.json"
fi
if [[ -f "$PI_DIR/npm/package-lock.json" ]]; then
  cp "$PI_DIR/npm/package-lock.json" "$ROOT/npm/package-lock.json"
fi

if command -v pi >/dev/null 2>&1; then
  pi --version > "$ROOT/pi-version.txt"
fi

printf 'Captured portable Pi configuration from %s.\n' "$PI_DIR"
printf 'Review the diff and run scripts/check-secrets.sh before committing.\n'
