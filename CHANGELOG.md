# Changelog

All notable changes to Jarvis Central. Versions follow semver; see `CLAUDE.md` for what counts as what.

## Unreleased
- **Security tab**: every project page has a Security tab next to Strategy showing the project's security audit
  reports, newest first, with verdict and a one-line summary (findings by severity, first item of the fix order).
  Reports are markdown files in the project folder (`audits.dir`, default `docs/audits`, e.g.
  `2026-10-01-sued-hacked.md`, typically written by a scheduled audit that opens a PR); `agent/audits.mjs` mirrors
  them to the site as `security` reviews, one per file, and the worker runs it once an hour (`audits.sync_minutes`),
  so a merged audit PR shows up within the hour. `jarvis audits <project>` lists them from the terminal; the
  Reviews page gets a "Security audits" section. Upgrade notes: redeploy (review type `security`, a unique index on
  `meta.file`); no `agent/install.sh` re-run needed. Run `node agent/audits.mjs sync` once to pick up existing reports
  right away, or wait for the worker's first hourly pass.

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
