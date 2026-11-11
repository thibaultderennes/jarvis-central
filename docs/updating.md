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

## If you are the maintainer
Your instance is the working copy of the public repo. Run `node agent/install-hooks.mjs` once so the privacy guard
checks every commit and push (including the worker's "Build it" branches). Ship a tool change the same way you'd
review anyone's: branch, check, CHANGELOG, merge, tag, push.

## Uninstall
Removing Jarvis means removing it from each place it runs. In order:
1. On the Mac: `bash agent/uninstall.sh` stops and removes the worker, planner and weekly jobs.
2. Delete the Mac's settings and logs: `rm ~/.config/jarvis/env`, and the `jarvis` folder under `~/Library/Logs`.
3. In the repo: `rm .git/hooks/pre-commit .git/hooks/pre-push` (the privacy guard), then delete the folder.
4. On Vercel: delete the project (Settings → Advanced → Delete Project). That removes the site and its env vars.
5. On Neon: delete the database (or the project). This is where your checklists, reviews and quotes live.
6. On Google: in the Apps Script project, delete the time trigger, then the project; in Google Calendar, reset any
   *secret address in iCal format* you gave Jarvis.
7. On Apple: remove the Jarvis calendar subscription.
8. In Claude Code: remove the `jarvis` skill from `~/.claude/skills` and the Jarvis block from `~/.claude/CLAUDE.md`.
