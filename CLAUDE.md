# Jarvis Central — the open tool

This repo is a **tool other people install**, not one person's dashboard. Two kinds of change exist, and you must
always know which one you're making:

| | Instance change ("your settings") | Tool change |
|---|---|---|
| What | This owner's projects, schedules, hours, caps, calendars, checklists, habits | Code, templates, personas, docs, schema |
| Where | `jarvis.config.json`, Vercel env vars, the database, the owner's project folders | Files tracked in this repo |
| In git? | **Never** | Yes: branch → PR → CHANGELOG → release |

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

## Where improvement ideas come from
The Monday **Jarvis review** reads how the owner used the site that week and splits its advice into
*your settings* and *tool changes*. Tool changes are written as ready-to-file GitHub issues for this repo.
"Build it (PR)" on the `jarvis` project opens a PR here; it goes through the rules above like any other change.

## Layout
`app/` website (Next.js 16: read `app/AGENTS.md` before touching it) · `agent/` Mac scripts · `personas/` advisor
prompts · `templates/` project file templates · `skills/` Claude Code skill · `google/` Apps Script · `docs/`.
