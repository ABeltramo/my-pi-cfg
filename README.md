# Pi configuration

This repository is the source of truth for portable Pi configuration.
Symlinks connect Pi global files to this repository.

The repository does not contain credentials, sessions, caches, or `node_modules`.

## Current setup

- Default provider: `openai`
- Default model: `gpt-5.6-luna`
- Default thinking level: `xhigh`
- Theme: `dark`
- Installed Pi packages:
  - `pi-web-access@0.23.0`
  - `pi-mcp-adapter@2.26.0`
  - `pi-provider-litellm@2.3.0`
- Custom extensions: `confirm-commands` and the Pi port of [claude-status](https://github.com/ABeltramo/claude-status)
- Global output style: Simple English from [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish)

Package versions are pinned in `settings.json`.
The exact npm dependency tree is in `npm/package-lock.json`.

The `claude-status` project targets Claude Code and consumes Claude statusline JSON.
`extensions/claude-status.ts` provides the equivalent Pi footer.
Its cost segment shows `session`, `pi`, `claude`, and combined `total` monthly spend.
It uses Pi session data for the current session, model, and context values.
It uses `ccusage --by-agent` for both monthly cost values.

## Symlink layout

| Pi path | Repository path |
| --- | --- |
| `~/.pi/agent/settings.json` | `settings.json` |
| `~/.pi/agent/models.json` | `models.json` |
| `~/.pi/agent/APPEND_SYSTEM.md` | `APPEND_SYSTEM.md` |
| `~/.pi/agent/extensions` | `extensions/` |
| `~/.pi/agent/npm/package.json` | `npm/package.json` |
| `~/.pi/agent/npm/package-lock.json` | `npm/package-lock.json` |

The npm packages stay in `~/.pi/agent/npm/node_modules`.
The repository ignores that directory.

## Restore on a new machine

Install Pi first.

```bash
npm install --global --ignore-scripts @earendil-works/pi-coding-agent
```

Then create the symlinks and install the packages:

```bash
cd ~/repos/my-pi-cfg
./scripts/restore.sh
```

If the target already has Pi configuration, make a backup first.
Then run:

```bash
./scripts/restore.sh --force
```

The script moves replaced portable files to `~/.pi/agent/backups/my-pi-cfg/`.
It never changes `auth.json`.
It installs npm packages when the required versions are not present.

Authenticate separately:

```text
/login
/login litellm
```

You can also provide credentials through environment variables.

The script uses `PI_CODING_AGENT_DIR` when you set it.
Otherwise, it uses `~/.pi/agent`.

## Apply the repository to the current machine

Run this command when the repository is the source of truth:

```bash
./scripts/restore.sh --force --skip-npm-install
```

Use `/reload` in the active Pi session after the command.
Restart Pi after package changes.

## Manage the configuration

Edit files in this repository.
Pi writes changes through the symlinks into this repository.

After a change, review and commit it:

```bash
git diff
git add .
./scripts/check-secrets.sh
git diff --cached --check
git diff --cached
git commit -m "Update Pi configuration"
```

Do not run `pi update` for a pinned package if you want the pinned version.
Install a new package version explicitly when you want an update.
Commit the changed `settings.json` and lockfile after the update.

## Files

| File | Purpose |
| --- | --- |
| `settings.json` | Sanitized Pi settings with pinned package versions |
| `models.json` | Custom model overrides |
| `APPEND_SYSTEM.md` | Always-on Simple English instructions |
| `extensions/` | Custom Pi extensions |
| `npm/package.json` | Direct package dependencies |
| `npm/package-lock.json` | Exact npm dependency versions |
| `scripts/restore.sh` | Create symlinks and restore packages |
| `scripts/check-secrets.sh` | Check staged files for common credential patterns |

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
