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
`gh auth login` if they want pull requests). Re-run until only optional items remain.

## Phase 2 — Settings
Ask, in one message, with sensible defaults shown:
1. The folder that holds all their projects (default `~/Projects`).
2. Their first name (used in reviews) and timezone (default: the Mac's, `readlink /etc/localtime`).
3. Working days and hours, and any weekly cap per project (e.g. a side project at 6 h/week).
4. Calendars: Google and/or Apple, read (show appointments) and/or write (planned blocks).
5. When the planner and the reviews run (defaults: Sunday 17:00, Monday 05:00).
Copy `jarvis.config.example.json` to `jarvis.config.json`, fill it in, show it, and confirm.

## Phase 3 — Projects
1. `node agent/projects.mjs list` and confirm the list with the owner (adjust `projects.include`/`exclude`,
   and `overrides` for names, kinds `checklist`/`running`, colours).
2. `node agent/projects.mjs scaffold --dry-run` to show which files will be drafted, then `scaffold`. (Once the worker
   runs, projects started or loaded later get the full setup session instead: `agent/setup.mjs`.)
3. Ask the owner to review each new `PRD.md`, especially the **milestones table** (its dates become deadlines,
   drive the burn-up charts and the planner). Offer to fill `TODO(owner)` items with them, one project at a time.

## Phase 4 — The website
1. `cd app && npm ci`.
2. Ask for a project name, then `vercel project add <name>` and `vercel link --yes --project <name>`.
   `app/vercel.json` already sets the Next.js framework (without it every page 404s).
3. Database: the owner runs `cd app && vercel integration add neon --name <name>-db` in their terminal
   (an agent can't accept Neon's terms). It adds `DATABASE_URL` to the project.
4. First deploy: `vercel deploy --prod --yes` → note the URL, write it to `site_url` in `jarvis.config.json`.
5. `node scripts/setup.mjs secrets` (session secret, agent token, timezone, owner, schedules; writes
   `~/.config/jarvis/env` for the Mac side).
6. The owner runs `node scripts/setup.mjs login` in their terminal: chooses a password, scans the QR code.
7. `vercel deploy --prod --yes` again (applies the env and runs the database migrations), then check
   `node scripts/setup.mjs status`.

## Phase 5 — Register projects and first checklists
1. `node agent/projects.mjs sync` registers every project on the site.
2. For each `checklist` project: `node agent/projects.mjs checklist <id> --dry-run`, show the draft, adjust
   with the owner, then run it without `--dry-run`. Keep checklists short and sized to the next milestone.

## Phase 6 — Calendars (only what they chose)
- Read Google: the owner runs `node app/scripts/setup.mjs google-calendar` (it explains where the secret iCal
  address is: calendar.google.com → Settings → the calendar → Integrate calendar).
- Read Apple: `node app/scripts/setup.mjs apple-calendar` (Calendar app → right-click an iCloud calendar →
  Share Calendar… → Public Calendar → copy the webcal link). Warn: anyone with that link can read the calendar.
- Write Google: `node app/scripts/setup.mjs apps-script` copies a filled-in script to the clipboard; the owner
  pastes it into a new project at script.google.com, runs `install`, allows access.
- Write Apple: `node app/scripts/setup.mjs apple-feed` copies a subscription link; the owner adds it in the Calendar
  app (File → New Calendar Subscription, location iCloud, refresh every hour).
Redeploy after changing any env var.

## Phase 7 — Claude integration
`node agent/install-skill.mjs` installs the `jarvis` skill and prints a short block for `~/.claude/CLAUDE.md`.
Ask before running it again with `--write` (it only edits between `<!-- jarvis:start -->` markers).

## Phase 7b — Privacy guard (recommended)
`node agent/install-hooks.mjs` installs git hooks that block commits or pushes containing the owner's details
or secrets. Useful for anyone who keeps their own changes in a fork.

## Phase 8 — Schedules
Explain: an inbox worker every minute, the planner weekly, the reviews weekly; the Mac must be awake (a missed run
happens at the next wake). With consent, run `agent/install.sh`. On Linux, give the cron lines from `agent/README.md`.

## Phase 9 — Security check
Run `node agent/security-check.mjs`; every line must pass. Walk the owner through the checklist in
`docs/security.md` (what the worker may do, what data leaves the Mac, how to rotate secrets, what to do if a
calendar link leaks).

## Phase 10 — Prove it works
1. The owner signs in on the site.
2. They send "What should I do first tomorrow?" from the Inbox; the worker answers within a minute or two.
3. `node agent/plan.mjs --dry-run` shows next week's plan without saving it.
4. `node agent/weekly.mjs --dry-run --only <id>` builds one review bundle without calling Claude.
Finish with the site URL, what runs when, and where the logs are (`~/Library/Logs/jarvis/`).
