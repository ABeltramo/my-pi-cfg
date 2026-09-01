# Pi configuration

This repository tracks the portable parts of my Pi setup.

It does not track credentials, sessions, model discovery caches, or installed `node_modules`.

## Current setup

- Pi version: `0.84.2`
- Default provider: `openai`
- Default model: `gpt-5.6-luna`
- Default thinking level: `xhigh`
- Theme: `dark`
- Installed Pi packages:
  - `pi-web-access@0.23.0`
  - `pi-mcp-adapter@2.26.0`
  - `pi-provider-litellm@2.3.0`
- Custom extension: `confirm-commands`
- Global output style: Simple English from [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish)

Package versions are pinned in `settings.json`.
The exact npm dependency tree is tracked in `npm/package-lock.json`.

## Restore on a new machine

Install Pi first.
Use the version in `pi-version.txt`.

```bash
npm install --global --ignore-scripts @earendil-works/pi-coding-agent@0.84.2
```

Then restore this configuration:

```bash
./scripts/restore.sh
```

If the target already has a Pi configuration, make a backup and use `./scripts/restore.sh --force`.

The script copies the settings, model overrides, system prompt, and extensions.
It also installs the pinned npm dependencies.

The script does not copy credentials.
Authenticate separately:

```text
/login
/login litellm
```

You can also provide credentials through environment variables.

The restore script uses `PI_CODING_AGENT_DIR` when you set it.
Otherwise, it uses `~/.pi/agent`.

## Update the tracked snapshot

After changing Pi settings or installing a package, run:

```bash
./scripts/snapshot.sh
git add .
./scripts/check-secrets.sh
git diff --cached --check
git diff --cached
git commit -m "Update Pi configuration"
```

The snapshot script reads only portable configuration.
It never reads `auth.json`.

Review the diff before every commit.

## Files

| File | Purpose |
| --- | --- |
| `settings.json` | Sanitized Pi settings with pinned package versions |
| `models.json` | Custom model overrides |
| `APPEND_SYSTEM.md` | Always-on Simple English instructions |
| `extensions/` | Custom Pi extensions |
| `npm/package.json` | Direct package dependencies |
| `npm/package-lock.json` | Exact npm dependency versions |
| `scripts/restore.sh` | Restore the configuration |
| `scripts/snapshot.sh` | Capture later local changes |
| `scripts/check-secrets.sh` | Check staged files for common credential patterns |
| `simple-english-commit.txt` | Upstream commit used for the Simple English prompt |

## Intentionally excluded

These files stay on the local machine:

- `auth.json`
- `web-search.json`
- MCP configuration files
- Session history
- `models-store.json`
- MCP caches
- `node_modules`

MCP configuration often contains credentials or private endpoints.
Add a sanitized example file if MCP servers become part of this setup.
Use environment-variable references instead of literal secrets.
