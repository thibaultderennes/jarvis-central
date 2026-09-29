# Changelog

All notable changes to Jarvis Central. Versions follow semver; see `CLAUDE.md` for what counts as what.

## Unreleased

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
