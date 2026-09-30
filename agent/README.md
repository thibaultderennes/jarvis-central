# Jarvis agent

The scripts that run on your computer next to the Jarvis website. They read your settings from
`../jarvis.config.json` (see `../jarvis.config.example.json`) and your secrets from `~/.config/jarvis/env`.
Plain Node ESM, no dependencies (Node ≥ 20). They call the `claude` CLI (Claude Code) and, optionally, `gh`.
API contract: `../docs/architecture.md`.

| File | What it does |
|---|---|
| `jarvis.mjs` | CLI for Claude Code sessions: checklists, todos, inbox, reviews (`node jarvis.mjs help`) |
| `projects.mjs` | Your projects folder: `list`, `scaffold` (draft missing CLAUDE.md / PRD.md), `sync` (register on the site), `checklist <id>` (first checklist from the PRD) |
| `worker.mjs` | One inbox pass: picks up messages from the site, runs `claude -p` in the project, replies; once an hour also mirrors audit reports |
| `audits.mjs` | Mirrors each project's security audit reports (`audits.dir`, default `docs/audits/*.md`) to the site's Security tab; `sync [--project id] [--dry-run]` runs it by hand |
| `plan.mjs` | Weekly planner: estimates open items, packs them around your calendar → todos + calendars |
| `weekly.mjs` | Weekly reviews: CEO / CMO / PO advisors per project + synthesis, recap, "working with AI" coaching, Jarvis usage |
| `advisors.mjs` | Persona lookup and advisor prompts |
| `transcripts.mjs` | Reads `~/.claude/projects/*/*.jsonl`: your typed messages + session stats (stays on your machine) |
| `schedule.mjs` | Renders the three scheduled jobs from your config (launchd on macOS, cron lines on Linux) |
| `install.sh` / `uninstall.sh` | Load / remove the launchd jobs (macOS) |
| `doctor.mjs` | Checks prerequisites, config, secrets, API and jobs; says how to fix each problem |
| `security-check.mjs` | Probes your deployment and repo for the security basics (safe: no writes, no brute force) |
| `install-skill.mjs` | Installs the `jarvis` Claude Code skill; `--write` adds the Jarvis block to `~/.claude/CLAUDE.md` |
| `claude.mjs` / `lib.mjs` | Shared helpers (headless claude runner, config, API client, lock, log, dates) |

## Setup
Follow `../SETUP.md` (a Claude session can do it for you). In short:
```
cp jarvis.config.example.json jarvis.config.json      # then edit it
node agent/doctor.mjs                                 # what's missing
node agent/projects.mjs scaffold && node agent/projects.mjs sync
agent/install.sh                                      # macOS; Linux: node agent/schedule.mjs cron
node agent/install-skill.mjs --write
node agent/security-check.mjs
```

## Schedules
From `jarvis.config.json` — change them there, then re-run `agent/install.sh` (or re-paste the cron lines):
- worker: every `worker.interval_seconds` (default 60)
- planner: `planner.run` (default Sunday 17:00)
- reviews: `reviews.run` (default Monday 05:00)

Times are your computer's local time. Your computer has to be awake: launchd runs a missed calendar job at the
next wake; cron doesn't catch up. `node agent/schedule.mjs show` prints the current schedule.

Linux (cron):
```
node agent/schedule.mjs cron      # prints three lines
crontab -e                        # paste them
```

## Personas
The weekly advisors look for, in order: `<project>/personas/<role>.md` → `<project>/.claude/commands/*-<role>.md`
or `<project>/.claude/skills/*-<role>/SKILL.md` → `~/.claude/commands/<project-id>-<role>.md` → `../personas/<role>.md`
(roles: `ceo`, `cmo`, `po`; choose which run in `reviews.advisors`). The stance every report takes comes from
`reviews.stance`.

## Worker rules
- **Discuss** messages: read-only tools plus the Jarvis CLI (checklist and todo edits), lighter model
  (`worker.discuss_model`).
- **Build it** messages, in a project that is a git repo with an `origin` remote: a fresh worktree in
  `<projects_root>/.jarvis-worktrees/<project>-<id>` on branch `jarvis/<id>` from `origin/<default>`, `node_modules`
  symlinked, `.env*` never copied. Claude may edit, commit and run tests/lint/typecheck/build. The worker then pushes
  the branch and opens a PR (`gh`), and removes the worktree. Nothing merges. `worker.allow_build: false` turns this off.
- Always denied: `git push`, `gh pr merge`, `gh pr create` (the worker does it), `rm -rf`, `curl`, deploy and billing
  CLIs. Permission mode `dontAsk`: any tool not on the allow list is refused without a prompt.
- A reply starting with `NEEDS YOU:` marks the message `needs_you`. Errors mark it `error` with the reason.

## Running by hand
```
node worker.mjs                        # one pass       · --dry-run prints a sample prompt and the tool lists
node plan.mjs --dry-run                # plan next week without posting · --week YYYY-MM-DD · --force
node weekly.mjs                        # review last week · --week YYYY-MM-DD · --only <id> · --dry-run [--offline]
node transcripts.mjs --days 7          # session counts per folder (no message text)
node audits.mjs sync --dry-run         # which audit reports would be mirrored · --project <id>
node jarvis.mjs audits <id>            # the synced reports for a project (date, verdict, headline)
```

## Logs and state
- Logs: `~/Library/Logs/jarvis/` on macOS, `~/.local/state/jarvis/logs/` elsewhere.
- `~/.cache/jarvis/weekly/<week>/*.md`: the bundles each review read. They stay on your machine and contain your
  own messages.
- `~/.cache/jarvis/*.lock`: overlap guards.

## Privacy
Transcripts never leave your machine raw. Reviews posted to the site contain summaries and short quotes
(≤ 20 words) of your own messages; they sit behind the site's password + authenticator login.
