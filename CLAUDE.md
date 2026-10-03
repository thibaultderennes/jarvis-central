# Jarvis Central — the open tool

This repo is a **tool other people install**, not one person's dashboard. Two kinds of change exist, and you must
always know which one you're making:

| | Instance change ("your settings") | Tool change |
|---|---|---|
| What | This owner's projects, schedules, hours, caps, calendars, checklists, habits | Code, templates, personas, docs, schema |
| Where | `jarvis.config.json`, Vercel env vars, the database, the owner's project folders | Files tracked in this repo |
| In git? | **Never** | Yes: branch → PR → CHANGELOG → release (maintainer only) |

## Who changes this repo
Only the maintainer. Their personal instance **is** a working copy of this repo: when they adjust Jarvis (by hand,
from the Monday Jarvis review, or with "Build it (PR)" on the `jarvis` project), tool changes are committed here and
pushed to the public repo; their settings and data never are. The privacy guard (`agent/guard.mjs`, installed as
pre-commit and pre-push hooks by `agent/install-hooks.mjs`) blocks any commit or push containing instance details
or secrets. **Never bypass it with `--no-verify`.** If it blocks, make the code generic or move the value into
`jarvis.config.json`; if a term is a false positive, rename the thing in the code rather than weakening the guard.
Other people's pull requests are closed automatically; their ideas come in as issues.

## Setting it up
If the owner asks to set up Jarvis Central, follow [`SETUP.md`](SETUP.md) phase by phase.

## Rules for tool changes
1. **Stay generic.** No names, paths, project ids, URLs, timezones or schedules in code. Read them from
   `jarvis.config.json` (via `agent/lib.mjs` `CONFIG`) or from env vars on the website. Before committing, run:
   `git grep -nEi "/Users/|toronto|@gmail|vercel\.app" -- ':!*.example.json' ':!docs/*' ':!CLAUDE.md'` → only
   obvious placeholders may remain (`your-jarvis.vercel.app`, `/Users/alex/...`).
2. **Never commit instance data**: `jarvis.config.json`, `google/Code.gs`, `.env*`, `.vercel/`, exported data,
   screenshots of someone's dashboard. They're gitignored; keep it that way.
3. **Config is backwards compatible.** New keys go in `jarvis.config.example.json` and `docs/config.md` with a
   default in `agent/lib.mjs`, so an old config keeps working.
4. **Database changes are additive and idempotent** (`create … if not exists`, `alter … add column if not exists`)
   in `app/lib/schema.sql`. They run on every deploy. Never drop or rename a column in place.
5. **API changes** update the table in `docs/architecture.md`; keep the agent CLI and the API in step.
6. **Record it**: add a line under `## Unreleased` in `CHANGELOG.md`; if an existing install must do something
   (re-run `agent/install.sh`, a new env var, a new setup step), add an **Upgrade notes** line.
7. **Check before a PR**: `cd app && npx tsc --noEmit && npx next build`, `node --check agent/*.mjs`,
   `node agent/security-check.mjs` against a test deployment, the generic-ness grep above.
8. Releases: bump `VERSION` **and** `app/package.json` `version` (Vercel builds `app/` alone and shows that version in the top bar) (semver: patch = fixes, minor = features/new config keys, major = anything that needs
   a manual migration), move `Unreleased` into a dated section, tag `vX.Y.Z`.
9. The stored owner value `founder` means "the owner" — UI copy says "you". Don't rename stored values without a migration.

## How we work
These rules are for the maintainer's sessions in this repo; someone who only installed Jarvis can skip them.
- **`PRD.md`** (repo root) is the product truth for the tool: who it's for, scope, non-negotiables. Its Milestones
  table is what Jarvis reads for this project's deadlines: change dates there, not on the dashboard.
- **The checklist lives on the maintainer's own Jarvis Central** (project id `jarvis`) and is the single source of
  truth for what's open. Item ids are the code names used in chat. Read it at session start
  (`node agent/jarvis.mjs items jarvis --open`), mark items done when they ship, add new work there.
- **The loop.** An item in `build` set to **in progress is the go**: Claude builds it on a branch, the checks in rule 7
  gate the PR, the maintainer merges. Nothing merges on its own; the Jarvis worker follows the same rule (branch
  `jarvis/<id>` + PR, merged only when the maintainer presses merge).
- **3-day audit.** The prompts in [`docs/audits/PROMPTS.md`](docs/audits/PROMPTS.md) run against `main` every 3 days
  (a scheduled Claude Code routine, or by hand). Each report is `docs/audits/YYYY-MM-DD-audit.md`; fixes come as PRs,
  regressions against the previous report first. Nothing merges on its own.
- **"Plan this project"** on Jarvis reads this file, `PRD.md`, `docs/audits/` and the checklist, then adds only missing
  items. Keep them current so it plans from reality.

## Where improvement ideas come from
The Monday **Jarvis review** reads how the owner used the site that week and splits its advice into
*your settings* and *tool changes*. Tool changes are written as ready-to-file GitHub issues for this repo.
"Build it (PR)" on the `jarvis` project opens a PR here; it goes through the rules above like any other change.

## Layout
`app/` website (Next.js 16: read `app/AGENTS.md` before touching it) · `agent/` Mac scripts · `personas/` advisor
prompts · `templates/` project file templates · `skills/` Claude Code skill · `google/` Apps Script · `docs/`.
