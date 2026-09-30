# Changelog

All notable changes to Jarvis Central. Versions follow semver; see `CLAUDE.md` for what counts as what.

## Unreleased
- **Plan this project** plans from the project's own structure: it reads CLAUDE.md, the root PRD.md, `docs/audits/`
  and the checklist; places new items only in the project's existing sections and never reuses an item id (proposals
  already on the checklist are listed, not added); dates each item before the PRD milestone it serves, defaulting to
  the milestone date when no day has room; and keeps the dashboard's deadlines in step with the PRD. A project with
  no PRD.md, no "How we work" section in CLAUDE.md or no `docs/audits/PROMPTS.md` gets decide/build items to create
  them instead of an invented roadmap. `node agent/planproject.mjs <id> --dry-run` shows what a plan would read.
- Templates: a "How we work" section in `templates/CLAUDE.md` and `templates/audits-PROMPTS.md` (the 3-day audit).
- Adding an item whose id is taken no longer risks colliding with another existing id.

## 0.4.0 — 2026-09-29
- **Plan this project**: a button on every project page. Claude reviews the folder (code, docs, git history, PRD,
  current checklist), writes a situation report (Strategy tab) and adds the missing checklist items, placed in order
  on days with room before the next deadline. Summary in the inbox.
- **Inbox replies**: every conversation has a Reply box (discuss or build); the worker reads the whole thread first.
  Upgrade notes: redeploy (new `messages.thread_id` column).

## 0.3.0 — 2026-09-29
- **Refine new items**: an item you add on a checklist is read by Claude within a minute: steps, section, owner,
  priority, estimate, and a due date before the milestone on a day that still has room (checked against every
  project's items and your calendar). Possible duplicates are flagged instead. Summary in the inbox.
  `worker.refine_new_items: false` turns it off. Upgrade notes: redeploy (new columns), then `agent/install.sh`.
- Overview: the "Swap into top 3" menu is gone from the compact cards; drag the handle, or use "Put in top 3" on
  the project's page.

## 0.2.0 — 2026-09-29
- **Top 3**: choose which three projects get full cards and nav tabs; drag a project onto a top-3 card (or use
  "Swap into top 3") to swap. Every other project gets a compact card, and every project has a full page.
- **Per-project settings** on each project page: plan into my calendar (on/off), hours per week (the planner's
  weekly cap for that project, overriding `planner.project_caps`), weekly review, strategy & audit (on/off).
- Charts colour the top 3 and group the rest as "Other projects".
- Overview: running projects show their open checklist items with a link to the project page.
- `projects.mjs sync`: the "no PRD" note no longer claims a project has no deadlines.
- Privacy guard: `agent/guard.mjs` + `agent/install-hooks.mjs` block commits/pushes containing instance details or secrets.
- `projects.overrides` can set a project's `id` and a subfolder `dir`, keyed by folder name or id.
- `projects.mjs sync` no longer wipes deadlines when a PRD has no milestones table, and keeps existing taglines/status lines.
- Pull requests from accounts other than the maintainer are closed automatically; ideas go to issues.

## 0.1.0 — 2026-09-29
First public version, extracted from a personal setup.
- Website: Overview (deadlines, burn-up per project, pace vs needed, who it's waiting on, weekly throughput,
  rhythm heatmap, work ahead, time per project), Today (calendar + daily list + backlog, drag and drop), Week,
  a tab per project (checklist, weekly reviews, strategy documents), Reviews, Inbox; discussion threads on
  every review. Login with password + TOTP.
- Mac agent: inbox worker (discuss / build-a-PR), Sunday planner (estimates + deterministic packing around your
  calendar), Monday reviews (CEO/CMO/PO advisors per project, recap, how you work with Claude, Jarvis usage),
  project scaffolding (`CLAUDE.md` + `PRD.md`), first checklists from PRDs, doctor, security check.
- Calendars: read Google (secret iCal) and Apple (iCloud public links); write the week plan to Google (Apps
  Script) and Apple (subscription feed).
