# Pi configuration repository

Treat this repository as the source of truth for the local Pi setup.

Edit the repository files directly.
The local Pi installation uses symlinks to these files.

Keep credentials, sessions, caches, and `node_modules` outside this repository.
Do not add `auth.json`, session files, cache files, or literal credentials.

If you change a configuration file, review the change with `git diff`.
Run `/reload` in Pi after a resource change.

Before each commit, run:

```bash
./scripts/check-secrets.sh
git diff --cached --check
```
