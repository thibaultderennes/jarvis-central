# Updating your Jarvis

Your settings (`jarvis.config.json`), secrets (`~/.config/jarvis/env`, Vercel env vars) and data (the database)
are never touched by an update. Only the shared code changes.

```bash
cd jarvis-central
git pull                       # or: git fetch && git merge vX.Y.Z
cat CHANGELOG.md | head -40    # read "Upgrade notes" for anything you must do
cd app && npm ci && vercel deploy --prod --yes   # migrations run during the build
cd .. && agent/install.sh      # only if the notes say the schedules changed
node agent/doctor.mjs && node agent/security-check.mjs
```

Or open Claude in the repo and say "update Jarvis": it follows the same steps and reads the upgrade notes for you.

## If you changed the code yourself
Keep your change on a branch and rebase it on each release, or better, contribute it (see `CONTRIBUTING.md`) so
you don't carry it forever. Settings belong in `jarvis.config.json`, not in code.
