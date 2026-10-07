# Conventions

These are the few rules the whole tool relies on. Setup enforces them; everything else is configurable.

## One projects folder
- `projects_root` in `jarvis.config.json` (e.g. `~/Projects`) holds **one folder per project**.
- Every direct subfolder is a project, except hidden folders (`.something`), anything in `projects.exclude`,
  and — when `projects.include` is non-empty — anything not listed there.
- The project **id** is the folder name lowercased and slugified (`My App` → `my-app`). `projects.overrides`, keyed by
  folder name or id, can change the display name, colour, tagline, kind, the **id** itself (`"id": "acme"` for a
  folder named `ACME-2024`) and point at a **subfolder** (`"dir": "app"` when the code lives in `MyProject/app`).
- Re-running `sync` never wipes what's on the site: deadlines change only when the PRD has a milestones table,
  and an existing tagline or status line is kept unless you override it.
- A milestone dragged to a new date on the Timeline is written back into its PRD.md row (the date cell only, no
  commit) by the Mac worker on its next pass, and by `sync` / plan before they read the file, so the move sticks.
- The Jarvis tool itself can live inside `projects_root`; it then shows up as a project like any other.

## Every project folder has two files
| File | What it is | Who reads it |
|---|---|---|
| `CLAUDE.md` | How to work in this folder: what the project is, stack, commands, rules, where things live. | Every Claude Code session opened there, the inbox worker, the Monday reviews. |
| `PRD.md` | What we're building and why: problem, users, goals and non-goals, scope, milestones with dates, success metrics, open questions. | The Monday advisors, the Sunday planner (deadlines), the first checklist draft. |

The **project setup session** creates whichever is missing, with the rest of the foundation (README, .gitignore,
`docs/architecture.md` for stack, data and auth, environments and error tracking, `.env.example`, `docs/BRAND.md`,
`DESIGN.md`): the worker runs it when you start a project from the Admin page or a folder is loaded for the first time
(`node agent/setup.mjs queue <id>` runs it by hand). Claude reads the folder (README, package files, docs, git log) and
drafts from `templates/`; anything it can't infer is marked `TODO(owner):` and asked on the checklist as a decide item.
It never invents facts, numbers or dates, and never overwrites a file: in a repository with a remote the drafts come as
a `jarvis/setup-<id>` pull request. `node agent/projects.mjs scaffold` is the offline variant (CLAUDE.md and PRD.md only).

What "Plan this project" expects, and adds checklist items to create when missing (it doesn't invent a roadmap
without a PRD):
- `PRD.md` **at the repo root** with a dated Milestones table: the plan dates items before the milestone they serve.
- A `## How we work` section in `CLAUDE.md` (in `templates/CLAUDE.md`): the checklist on Jarvis is the source of
  truth, the loop rule (an item in Claude's section set to in progress is the go; branch + PR; nothing merges on its
  own), the 3-day audit, the PRD.
- `docs/audits/PROMPTS.md` (from `templates/audits-PROMPTS.md`): the audit prompts run every 3 days, with each
  report next to it.

Optional per project:
- `personas/ceo.md`, `personas/cmo.md`, `personas/po.md` — project-specific advisor prompts. Without them the
  Monday reviews use the tool's generic `personas/` and adapt them to the project.
- `milestones` in the PRD as a table (`| date | milestone |`) — become the project's deadlines on the dashboard.
- `docs/audits/*.md` (or `audits.dir`) — security audit reports, one file per run (`YYYY-MM-DD-….md`, first line an
  H1). They appear on the project page's Docs and reviews (Security audits) within an hour; `PROMPTS.md` and `README.md` there are ignored.

## Project kinds
- `checklist` (default): active project with a checklist, deadlines, burn-up, weekly advisor review.
- `running`: live or automated, no checklist; shown as a one-line status; reviewed only in weeks with activity.

## Colours
Projects take the categorical slots `p1`…`p7` in order (validated for colour-blind readers in light and dark).
Magenta is reserved for personal (life) todos. Override with `projects.overrides.<id>.color`.

## Where things live
| What | Where | In git? |
|---|---|---|
| Code, templates, personas, docs | this repo | yes |
| Your settings | `jarvis.config.json` (repo root) | **no** (gitignored) |
| Secrets for the Mac side | `~/.config/jarvis/env` (chmod 600): `JARVIS_URL`, `JARVIS_AGENT_TOKEN` | no |
| Secrets for the website | Vercel environment variables (sensitive) | no |
| Your data (checklists, todos, messages, reviews, plans) | the Postgres database | no |
| Filled-in Apps Script | `google/Code.gs` | no (gitignored) |
