# {{PROJECT_NAME}}

{{ONE_LINER — one sentence: what this is and who it's for.}}

## Status
{{e.g. "Idea", "Building v1", "Live since 2026-03", "Maintenance"}} · PRD: `PRD.md`

## Stack
- {{language / framework / hosting / database — only what's actually in the folder}}

## Commands
| Task | Command |
|---|---|
| Install | `{{…}}` |
| Run locally | `{{…}}` |
| Test | `{{…}}` |
| Build / deploy | `{{…}}` |

## Structure
- `{{folder}}/` — {{what lives there}}

## Rules
- {{Things Claude must always / never do here, e.g. "never commit .env", "run tests before a PR", "French copy is the source of truth"}}
- Never invent facts, numbers or quotes in anything user-facing.

## How we work
- **`PRD.md`** (repo root) is the product truth: who it's for, scope, non-negotiables, metrics. Its Milestones table
  is what Jarvis Central reads for this project's deadlines: change dates there, not on the dashboard.
- **The checklist lives on Jarvis Central** (project id `{{PROJECT_ID}}`) and is the single source of truth for what's
  open. Item ids are the code names used in chat. Read it at session start
  (`node {{JARVIS_REPO}}/agent/jarvis.mjs items {{PROJECT_ID}} --open`), mark items done when they ship, add new work there.
- **The loop.** An item in Claude's section (`build` unless this project renamed it) set to **in progress is the go**:
  Claude builds it on a branch, tests gate the merge, the owner merges. Nothing merges on its own; the Jarvis worker
  follows the same rule (branch `jarvis/<id>` + PR).
- **3-day audit.** The prompts in `docs/audits/PROMPTS.md` run against the main branch every 3 days
  ({{how: a scheduled Claude Code routine, or by hand}}). Each report is `docs/audits/YYYY-MM-DD-audit.md`; fixes come
  as PRs, regressions against the previous report first. Nothing merges on its own.
- **"Plan this project"** on Jarvis reads this file, `PRD.md`, `docs/audits/` and the checklist, then adds only missing
  items. Keep them current so it plans from reality.

## Links
- Checklist: Jarvis Central, project id `{{PROJECT_ID}}` — `node {{JARVIS_REPO}}/agent/jarvis.mjs items {{PROJECT_ID}} --open`
- {{Repo, live site, dashboards, docs}}
