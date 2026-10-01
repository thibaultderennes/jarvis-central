# Changelog

All notable changes to Jarvis Central. Versions follow semver; see `CLAUDE.md` for what counts as what.

## Unreleased

## 0.5.0 — 2026-09-30
- **Project page with a left menu**: Dashboard (open / overdue / in progress / latest review / recurring costs, next up,
  in progress, deadlines, latest reports, the project settings), Checklists, Project (description + strategy documents),
  Reviews (weekly reviews and security audits), Finances, Statistics (burn-up, added/finished per day; users and
  visitors wait for an analytics source). Dashboard is the landing view; old `?tab=` links still open the right view.
- **Checklists**: done and cancelled items are hidden until "Show completed (N)"; filters are three groups combined
  (Everything / Yours / Claude's · Critical only, Show completed · Any date / Overdue / Next 7 / Next 14 days) with
  "Reset filters", remembered per project in the browser; a section with only completed items says so.
- **Cancel an item** ("Comment" → "Cancel this item", with a reason and optionally the item it duplicates): it stays
  under "Show completed" but leaves every open count, deadline, load and card. Every create path (site, API, CLI, plans)
  refuses an exact duplicate title in the same project and flags a near match; `jarvis dupes [--cancel]` lists (and
  cancels, keeping the oldest) the duplicates already there; `jarvis cancel <project> <id> [--reason] [--dup ID]`.
- **Decide: "Send to Claude"** on the answer box: the note is a draft (kept in the browser) until sent; sending saves it
  and hands it to Claude as a comment, and the box shows "Sent · Claude has not read it yet" then "Claude read it".
- **Claude builds in-progress items**: an item owned by Claude (or both) set to in progress is picked up by the Mac
  worker within a minute, built on its own branch `jarvis/item-<id>`, and comes back on the item as a PR with
  "Approve & merge" (the worker merges, squash, and marks the item done) and "Send back" (Claude continues on the same
  branch and PR with your note). Failures stay on the item with the reason and a Retry; one run at a time, sent-back
  PRs first. `jarvis builds` lists them. Upgrade notes: redeploy (new item columns); `gh` on the Mac must be allowed to
  merge in those repos.
- **Refresh this project checklist**: the plan button on a project that already has a checklist reads the folder, the
  git history and changed files since the checklist last moved and the earlier weekly reviews, then ticks items the
  folder shows are done (evidence on the item, one click to undo), flags obsolete ones (nothing removed) and adds what's
  missing. "Plan this project" stays for empty projects.
- **Daily stats** on the Overview and per project (Statistics): items added and finished per day for the last 14 days,
  finished-late in red, cancelled, and today's overdue count; days before tracking began are greyed. `GET /api/agent/stats`.
- **Inbox in three groups**: New (replies you haven't opened, work still with Claude), Pending (opened, not treated),
  Treated ("Mark treated"). The nav badge counts unopened replies. `jarvis inbox` also lists what is pending on your side.
- **Finance**: a Finance page (monthly and yearly totals per currency, breakdown per project with an Independent
  bucket, renewals in the next 30 days, add / edit / delete) and a Finances view on each project. Manual entry only.
  `jarvis costs`, `jarvis cost add|set|rm`. Upgrade notes: redeploy (new `recurring_costs` table).
- **Admin page** (top bar): Projects with "Refresh project folders" (queues a scan the Mac worker runs; new folders are
  registered, nothing is deleted; status and last scan shown) and the registered projects; Account; Subscriptions (the
  independent recurring costs); Personal info & preferences (instance values read-only with where to change them;
  "Show completed items by default"; the Finance currency).
- **Today and Week**: Today opens with a "Decide now" strip (overdue or due today and not on the list: finish, add to
  today, push to tomorrow), keeps undone above done, flags todos whose item is overdue, and shows the day's load against
  a day of focus; Week shows the overdue strip above the grid and a load bar per day, orders due items critical-first,
  and lets you move a todo to any date from its row. Design notes in `docs/today-week.md`. Upgrade notes: re-run
  `node app/scripts/setup.mjs secrets` to set `JARVIS_FOCUS_MINUTES` (default 6 h until then).
- Overview: the burn-up charts no longer overlap their labels (deadline label in its own band, value labels move away
  from the deadline line and the axis, far-off dates drop the crowded tick, long names truncate instead of wrapping).
- **Security tab**: every project page has a Security tab next to Strategy showing the project's security audit
  reports, newest first, with verdict and a one-line summary (findings by severity, first item of the fix order).
  Reports are markdown files in the project folder (`audits.dir`, default `docs/audits`, e.g.
  `2026-10-01-sued-hacked.md`, typically written by a scheduled audit that opens a PR); `agent/audits.mjs` mirrors
  them to the site as `security` reviews, one per file, and the worker runs it once an hour (`audits.sync_minutes`),
  so a merged audit PR shows up within the hour. `jarvis audits <project>` lists them from the terminal; the
  Reviews page gets a "Security audits" section. Upgrade notes: redeploy (review type `security`, a unique index on
  `meta.file`); no `agent/install.sh` re-run needed. Run `node agent/audits.mjs sync` once to pick up existing reports
  right away, or wait for the worker's first hourly pass.
- **Comment on an item**: open any checklist item ("Show more", or "Comment" on short ones) and a bar at the bottom
  sends Claude a comment or a change ("split it", "move it to Friday", "it's blocked by…"). Within a minute Claude
  reads it like a new item and adjusts only what you asked (title, steps, section, owner, priority, estimate, status,
  or a date on a day with room), or answers a question; its reply shows under the bar and in the inbox. Comments are
  answered even when `worker.refine_new_items` is off. Upgrade notes: redeploy (new `items.refine_request` column).
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
