# Setup playbook (for Claude)

The owner cloned this repo and asked you to set up Jarvis Central. Follow these phases **in order**. After each
phase, tell them in one or two lines what's done and what's next. Keep a checklist of the phases in your reply so
they can see progress.

## Ground rules
- **Secrets never pass through the chat.** Anything with a password, a TOTP secret, a calendar secret link or
  terms acceptance, the owner runs **in their own terminal** (not with the `!` prefix). You give the exact command.
- **Ask before anything outward-facing**: creating the Vercel project, deploying, creating a GitHub repo,
  writing to `~/.claude/CLAUDE.md`, installing launchd jobs.
- **Never invent project facts.** Drafted `CLAUDE.md`/`PRD.md` files mark unknowns `TODO(owner):`.
- If a step fails, stop, show the error, fix it or explain the fix. Don't skip ahead silently.

## Phase 0 — Read
Read `README.md`, `docs/conventions.md`, `docs/config.md`, `docs/security.md`. Skim `docs/architecture.md`.

## Phase 1 — Check the machine
Run `node agent/doctor.mjs`. For each ✗, give the owner the fix (install Node 20+, `claude` login, `vercel login`,
`gh auth login` if they want pull requests). At this stage only the tools must pass (node, git, `claude`, `vercel`):
the config, `~/.config/jarvis/env` and API checks fail until Phases 2 and 4 are done. Re-run it after Phase 5.

## Phase 2 — Settings
Ask, in one message, with sensible defaults shown:
1. The folder that holds all their projects (default `~/Projects`).
2. Their first name (used in reviews) and timezone (default: the Mac's, `readlink /etc/localtime`).
3. Working days and hours, and any weekly cap per project (e.g. a side project at 6 h/week).
4. Calendars: Google and/or Apple, read (show appointments) and/or write (planned blocks).
5. When the planner and the reviews run (defaults: Sunday 17:00, Monday 05:00).
6. Whether the worker should later run a full setup session on every project (it analyses the folder and opens a
   branch + PR in its repo). Default: off during the install, so the first inbox test answers quickly.
Copy `jarvis.config.example.json` to `jarvis.config.json` and fill it in:
- **Delete every placeholder**: the `example-*` entries in `overrides`, `project_caps` and `economics.models`, and the
  `metrics.sources` examples (example.com URLs). Left in, they show up as real projects and failing metric sources.
- Record the calendar choices in `calendars.*`. That only notes them; Phase 6 is what connects a calendar.
- Set `project_setup.auto_on_load` to `false` for now (question 6); turn it on after Phase 10 if they want it.
Show the file and confirm.

## Phase 3 — Projects
1. `node agent/projects.mjs list` and confirm the list with the owner (adjust `projects.include`/`exclude`,
   and `overrides` for names, kinds `checklist`/`running`, colours).
2. `node agent/projects.mjs scaffold --dry-run` prints each project's prompt: read the `=== <id>: would create … ===`
   headers to see which files will be drafted, then run `scaffold`. Each project is one Claude call (up to 10 min,
   one after another): to stay inside 45 minutes, do at most 2 projects now with `--only <id>`; the rest can wait.
   (Once the worker runs, projects started or loaded later get the full setup session instead: `agent/setup.mjs`.)
3. Ask the owner to review each new `PRD.md`, especially the **milestones table** (its dates become deadlines,
   drive the burn-up charts and the planner). Offer to fill `TODO(owner)` items with them, one project at a time.

## Phase 4 — The website
Steps 1–7 run **from `app/`** (the folder linked to Vercel). Go back to the repo root for Phase 5.
1. `cd app && npm ci`.
2. Ask for a project name, then `vercel project add <name>` and `vercel link --yes --project <name>`.
   `app/vercel.json` already sets the Next.js framework (without it every page 404s).
3. Database: the owner runs `vercel integration add neon --name <name>-db` in their terminal, from `app/`
   (an agent can't accept Neon's terms). It adds `DATABASE_URL` to the project.
4. First deploy: `vercel deploy --prod --yes`. Write the **Aliased** production address it prints
   (`https://<name>.vercel.app`) to `site_url` in `jarvis.config.json`, not the per-deployment URL: Vercel's
   deployment protection blocks that one.
5. `node scripts/setup.mjs secrets` (session secret, agent token, timezone, owner, schedules; writes
   `~/.config/jarvis/env` for the Mac side).
6. The owner runs `node scripts/setup.mjs login` in their terminal: chooses a password, scans the QR code.
7. `vercel deploy --prod --yes` again (applies the env and runs the database migrations), then check
   `node scripts/setup.mjs status`.

## Phase 5 — Register projects and first checklists
1. `node agent/projects.mjs sync` registers every project on the site.
2. For each `checklist` project: `node agent/projects.mjs checklist <id>` drafts the checklist and imports it (the
   `--dry-run` only prints the prompt, and a project that already has items is skipped). Then review and edit the
   items with the owner on the site. Keep checklists short and sized to the next milestone. Same time budget as
   Phase 3: the projects you scaffolded now, the rest later.
3. Re-run `node agent/doctor.mjs`: everything but optional items should pass now.

## Phase 6 — Calendars (only what they chose)
Every command here runs **from `app/`** (it sets Vercel env vars for the linked project): `cd app` first.
- Read Google: the owner runs `node scripts/setup.mjs google-calendar` (it explains where the secret iCal
  address is: calendar.google.com → Settings → the calendar → Integrate calendar).
- Read Apple: `node scripts/setup.mjs apple-calendar` (Calendar app → right-click an iCloud calendar →
  Share Calendar… → Public Calendar → copy the webcal link). Warn: anyone with that link can read the calendar.
- Write Google: `node scripts/setup.mjs apps-script` copies a filled-in script to the clipboard; the owner
  pastes it into a new project at script.google.com, runs `install`, allows access.
- Write Apple: `node scripts/setup.mjs apple-feed` copies a subscription link; the owner adds it in the Calendar
  app (File → New Calendar Subscription, location iCloud, refresh every hour). It needs `apps-script` run first
  (that creates the feed's token), even if they don't write to Google.
Redeploy after changing any env var.

## Phase 7 — Claude integration
`node agent/install-skill.mjs` installs the `jarvis` skill and prints a short block for `~/.claude/CLAUDE.md`.
Ask before running it again with `--write` (it only edits between `<!-- jarvis:start -->` markers).
Optional: `claude mcp add --scope user jarvis -- node <repo>/agent/mcp.mjs` lets any Claude Code session tick items
and todos through the Jarvis MCP server.

## Phase 7b — Privacy guard (recommended)
`node agent/install-hooks.mjs` installs git hooks that block commits or pushes containing the owner's details
or secrets. Useful for anyone who keeps their own changes in a fork.

## Phase 8 — Schedules
Explain: an inbox worker every hour (Jarvis Check Now on the Mac runs it at once), the planner weekly, the reviews weekly; the Mac must be awake (a missed run
happens at the next wake). With consent, run `agent/install.sh`. On Linux, run `node agent/schedule.mjs cron` and have the owner paste its
output into `crontab -e`. The worker's first pass runs as soon as it's loaded.

## Phase 9 — Security check
Run `node agent/security-check.mjs`: no FAIL lines. WARN lines are fine when they're about features they didn't
set up (e.g. no `google/Code.gs` without Google write). Walk the owner through the checklist in
`docs/security.md` (what the worker may do, what data leaves the Mac, how to rotate secrets, what to do if a
calendar link leaks).

## Phase 10 — Prove it works
1. The owner signs in on the site.
2. They send "What should I do first tomorrow?" from the Inbox; the worker answers at its next check; open Jarvis Check Now (Spotlight) to get the answer within a minute or two.
3. `node agent/plan.mjs --dry-run` shows next week's plan without saving it.
4. `node agent/weekly.mjs --dry-run --only <id>` builds one review bundle without calling Claude.
5. If they want the full setup session on every project (Phase 2, question 6), set `project_setup.auto_on_load`
   back to `true` now.
Finish with the site URL, what runs when, and where the logs are (`~/Library/Logs/jarvis/`).
