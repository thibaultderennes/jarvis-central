# Changelog

All notable changes to Jarvis Central. Versions follow semver; see `CLAUDE.md` for what counts as what.

## Unreleased
- **The Monday Jarvis review looks wider.** Two new sections, *Projects this week* (one line per active project from
  its review) and *Pain points* (what keeps coming back in the reviews, the coaching report and the worker's failed
  runs), and, with `reviews.repo_scout` (on by default), *Repos worth adding*: up to 3 GitHub repos (agent skills,
  plugins, CLIs, DESIGN.md libraries) that address those pain points, with stars, licence, last commit and how they'd
  plug in. The scout searches read-only (WebSearch, WebFetch, `gh search repos`, `gh repo view`), skips installed
  skills and `reviews.repo_scout_skip`, treats what it reads as untrusted, and never installs anything.

## 0.7.3 — 2026-10-05
- **One dashboard: Home, Timeline and Stats are tabs of one page** (`/?tab=overview|timeline|stats`; the old `/timeline`
  and `/stats` links redirect, filters included). The **Now rail** above every tab replaces the four tiles: the next
  thing in one sentence with its button, today as a line with your place on it, and one summary line (late, due today,
  next deadline). Every section is a box: **Customize** lets you drag a box anywhere on a 12-column grid by its title
  bar, resize it from its corner, fold it, remove it and add it back from the library (arrow keys move, Shift + arrows
  resize); boxes never overlap. The layout is saved per tab on the site (kv `dashboard.layout`), so it follows you
  across devices. New boxes: Sprints this week, Inbox, the next 7 days. The sidebar drops Timeline and Stats (they are
  tabs now); `g l` and `g s` and the ⌘K palette open those tabs. Tests cover the layout cleaning and collision rules.
- **Fix: deploys failed once a screening existed.** Every deploy runs the whole `schema.sql`, and the 0.5.0 block
  re-created the review-type check without `screening`, which the first screening row then violated. Every copy of
  the check now lists `screening`; a test fails if any copy of a check is narrower than the last one.
- **Design pass from the first VibeCoded Screening** (`DESIGN.md`, new): the rules the site follows (tokens, type
  roles, a 4px spacing scale, radii, motion, copy) and a CLAUDE.md rule to run the screening before shipping UI.
  - Muted text (`--ink-3`) darkened to 4.96:1 on the light page background (was 3.6:1).
  - Labels and panel titles in sentence case; caps stay only on pills, verdicts and table headers.
  - IBM Plex Mono replaces JetBrains Mono (numbers, times, codes).
  - New project palette `--p1`…`--p7` (blue, rust, teal, plum, olive, magenta, sky), validated for adjacent slots in
    light and dark, avoiding the amber, red and green the site reserves for "now" and status.
  - Page-title icons without the tile; designed hover and pressed states for buttons and chips.
  - Removed the create-next-app SVGs from `app/public`.
  - `docs/landing-copy.md` rewritten: the decided headline, and sections that follow the week around real screenshots.

## 0.7.2 — 2026-10-05
- **Screenings: three new reviews you run on demand** (a project's Reviews → **Screenings** → Run). Claude checks the
  project folder, read-only, against a researched check list in `screenings/`, marks every check fail / warn / pass /
  n/a / needs the live site with file evidence, writes the report there, and adds what to fix to the checklist
  (blockers critical, the owner's choices in decide), scheduled like "Plan this project".
  - **VibeCoded Screening** (`screenings/vibecoded.md`, 68 checks): the tells of a generic AI-made site: default
    gradients, fonts and UI kits, stock motion, buzzword and em-dash copy, placeholder proof, builder leftovers.
  - **Website pre-launch** (`screenings/prelaunch.md`, 90 checks, 45 core): legal pages, HTTPS and security headers,
    secrets, SEO and social cards, Core Web Vitals, accessibility, 404/500, forms and spam, email authentication,
    analytics and monitoring, domains, one clear call to action.
  - **Pre-launch rights & compliance** (`screenings/rights.md`, 68 checks across Canada/Québec, the US, the EU and the
    UK): policies, consent and cookies, data minimisation, user rights, children, marketing consent, subscriptions and
    cancellation, fake reviews and claims, accessibility, licences, AI disclosure. Not legal advice.
  New message mode `screen`, review type `screening` (the type check is widened by the migration), `agent/screen.mjs`.

## 0.7.1 — 2026-10-05
- **Checklist: today + overdue in one go.** The Due filter gets **Due today** (combines with Overdue and the date
  ranges), and Select mode gets **Select all shown**: filter Overdue + Due today, select them all, then Create sprint,
  Add to sprint or Take out.
- **Removed projects leave every view.** Items and todos of archived projects (removed on Admin, or whose folder is
  gone) no longer count in the sidebar, Home, Needs you, Today, Week, Stats (all projects), the Timeline or the agent
  API's all-projects item list, so they stop showing as overdue. The project's own page still shows them, and Restore
  brings everything back. `getItems({includeArchived: true})` keeps the old behaviour where needed.

## 0.7.0 — 2026-10-05
- **Admin: approve new projects, remove old ones.** "Refresh project folders" no longer registers new folders on its
  own: each one is listed with **Approve** / **Decline**, and a declined folder isn't proposed again. Each project has
  **Remove** (two clicks), which archives it, keeps its checklist history and keeps it out of every future scan.
  **Restore** undoes either. The ignore list is kv `projects.ignored`, and `projects.mjs sync` honours it too.
  Upgrade notes: deploy the site together with the agent update. An older site doesn't show the proposals, so a refresh
  would find new folders and nothing would let you approve them.
- **Timeline moves**: ← 4 weeks / Today / 4 weeks → shift the window (`?w=`, from half a year back to a year ahead) on the
  Timeline page and a project's Timeline view. Days are at least 22 px wide, so the chart scrolls sideways on desktop too
  (before, it squeezed to fit and never scrolled). Sunday-plan blocks load for every week in range.
- **Item dependencies**: "Blocked by" in an item's comment bar takes item codes from the same project. While a blocker
  is open, the item shows a "blocked by …" badge that links to it. Loops and unknown codes are refused, and nothing is
  enforced. New column `items.blocked_by` (additive); the API and CLI accept it (`jarvis set <p> <id> blocked_by=a,b`).
- **Sprints** (one project each, per the 5 Oct decision): on a checklist, **Select** → tick items → **Create sprint**
  (name, start, end), **Add to sprint** or **Take out**. Sprint cards above the sections show the dates, done %, and the
  open estimate against the project's weekly hours; a Sprint filter chip narrows the list. On the Timeline, sprints are
  bands, items get a lead-in bar (from their sprint's start, or from their estimate), and a project's Timeline has an
  **Unscheduled** panel: drag an undated item onto a day, or pick a date. New table `sprints` and column
  `items.sprint_id` (additive); `GET/POST/PATCH/DELETE /api/agent/sprints`; CLI `sprints <p>`, `sprint add|set|rm`.
- **Planner sizes the week from what got done** (`planner.adapt`, `agent/adapt.mjs`): the plan notes show the last
  2 weeks per project (planned vs done, items closed, Claude Code minutes) and, when most of your activity falls
  outside `planner.hours`, the hours you actually work. `"apply"` also caps a project where nothing moved at
  `planner.adapt_min_todos` (3) tasks; explicit caps win. Default `"suggest"` only adds notes; `"off"` plans as before.
- **PRD.md filled in** (audience, the market gap, 1.0 = a stranger installs it in 45 min or less on 15 Nov, the north-star
  metric, dated milestones, risks) and **`docs/landing-copy.md`**: the one-page site's copy draft, with three calls to action.
- **Sidebar**: the project badge reads "within 7d" (it counts everything due in the next 7 days).
- **Tests**: `cd app && npm test` (Node's built-in runner, no new dependency) covers the query builders behind item and
  project writes (placeholder numbering, the #8 regression, the PATCH field whitelist, blocked_by) and the agent
  API's bearer check. They moved to `app/lib/sqlbuild.ts` and `app/lib/bearer.ts`. CLAUDE.md rule 7 now runs it.

## 0.6.0 — 2026-10-03
- **Sentient Dash**: the product is renamed in the UI (sidebar, login, browser title, Home, Admin), with the Lane S mark
  as favicon, app icon, sidebar and login logo. The repo, CLI, docs and calendar names keep "Jarvis" for now.
- **Identity kit**: one quiet visual language from the mark (rounded lanes, hairlines, one amber "now" dot): a Lane icon
  set for navigation (the dot turns amber on the current page), a glyph tile and a faint header drawing on every page,
  coloured section lanes on checklists (build blue, decide amber, done green), sidebar group lanes, status stickers and
  empty-state drawings. `components/icons.tsx`, `components/brand.tsx`.
- **Sidebar**: Stats and Finance move to the You section; each project shows "N late" in red, or, when nothing is late,
  "N in 7d" in yellow for items due in the next 7 days.
- **Today redesigned** around "what do I do next, and am I on track?": one ordered list with **Next up** highlighted, a
  header with "N of M done" and a load meter against your daily focus, a slim agenda rail (calendar + timed blocks, a
  now-line; a one-line strip on narrow screens), and one closed "Later" section (overdue, what the plan couldn't fit,
  the next two weeks, Someday) with counts. Quick add reads "14:00 …" as a time; Alt+↑/↓ reorders; "+ Today" and ↓
  replace dragging between the backlog, the day and Someday.
- **Project Stats rebuilt**: **Product** (users, active users, visitors, revenue, expenses, cost per active user, each
  with the change against a week earlier and a sparkline, plus users and visitors over time) and **Delivery**
  (throughput, lead time, age of open work, overdue, scope added vs finished, a 50%/85% forecast to the next milestone
  with on/off track, the oldest open items). Day-by-day added/finished stays on Stats.
- **Product metrics**: new `metrics_snapshots` table, `GET/POST /api/agent/metrics`, `jarvis metrics <project> [--set
  k=v …]`, and `agent/metrics.mjs`, which reads each project's source (`metrics.sources.<id>`: a URL with a token from
  an env var, or a command) daily through the worker. Keys in `docs/metrics.md`. The Monday project review gets the
  last 8 weekly snapshots and the project's recurring costs.
- **New navigation (UI Proposal A)**: a left sidebar replaces the top tab bar: You (Home, Today, Week, Timeline,
  Inbox), Pinned (your top 3), every project with open/late counts, and Library (Reviews, Finance, Stats, Admin). It
  collapses to an icon rail (remembered; automatic under 1100px) and becomes a bottom bar with a Menu drawer on phones.
- **⌘K / Ctrl+K (or `/`) jump palette**: pages, projects, and checklist items by code or title words (case- and
  accent-insensitive, open first), plus quick actions; new site endpoint `GET /api/search` (owner session).
  Shortcuts: `g h` Home, `g t` Today, `g w` Week, `g i` Inbox, `g l` Timeline, `g s` Stats; `?` lists them.
- **Home replaces the Overview**: four tiles (next event, today's list, overdue across projects, next deadline), a
  **Needs you** list (your decide items, PRs waiting for Approve & merge, unread replies, oldest first; its count is on
  Home in the sidebar), and the top-3 cards with pace against the next milestone. The charts moved to a new **Stats**
  page (`/stats`).
- **Project pages open on the checklist**, with an "At a glance" column (a strip on narrower screens) in place of the
  Dashboard view, and a view bar along the top instead of the left menu. Old `?v=dashboard` and `?tab=` links still work.
- **Checklist status is a checkbox** (done ↔ to do in one click); a separate "Start ▸" ("Start build ▸" on Claude's
  items) marks an item in progress, shown as "◐ In progress" with Stop. Ticking an item done can no longer queue a build
  by passing through "doing"; unticking a linked todo on Today/Week sends the item back to "to do".
- Usage tracking records the project view and checklist filter chips (codes only); the weekly aggregate groups pages by
  view, counts back-to-back views of one page as one visit, and lists the filters used.
- **Build runs can commit again**: headless build runs were denied `git -C <dir> add/commit` (the allow list only
  matched `git add …`). The worktree's own `git -C` path is now allowed (push stays denied), the prompt asks for plain
  `git add`/`git commit`, permission denials are logged and named on a failed item, and edits a run leaves uncommitted
  are committed by the worker as the last commit on the PR.
- **Worker guards**: the merge pass only touches items that are `merge_requested` with a PR (it no longer trusts the
  API filter); the build queue filters client-side too; `POST /api/agent/heartbeat` returns the site version and the
  worker pauses its build and merge passes when the agent and site differ in major.minor; repeated identical log lines
  are written once per state change.
- **Timeline drag**: drag a milestone diamond or a due-date tick to another day (mouse, touch hold, or ←/→ with Shift for
  a week, then Enter). A ghost pin shows "Oct 9 → Oct 14 (+5 d)" and a confirm popover saves only on Confirm (Esc or
  clicking away cancels); a tick with several items lists them so you pick which move. No dates before today. Items
  change due date through the logged path (a later date still shows as a slip in the Monday review). A milestone moves
  the project deadline at once, and the Mac worker writes the new date into that row of the project's PRD.md on its next
  pass (file only, no commit; `agent/milestones.mjs`); sync and plans do it first, so they no longer revert a move.
- **Timeline** (new top-level page and a "Timeline" view in each project's left menu): last week to 8 weeks out, one
  lane per project (per section on a project page). PRD milestones are diamonds, open items are due-date ticks per day
  (red overdue, amber critical, taller when more), this and next week's Sunday-plan blocks are bars, calendar events
  have their own lane, plus a line for today. "Upcoming milestones" lists days left and the open, critical and overdue
  work due before each. Built from existing data.
- **"Added and finished" chart**: switch between days (14), weeks (12, Monday start) and months (12); filter by
  project on the home page; tap or keyboard-select a bar to list the items added and completed in that period, each
  linking to the item on its project's checklist. `GET /api/agent/stats` takes `bucket=day|week|month`, `n`,
  `project` and `items=1` (defaults unchanged); new `jarvis stats` CLI command.
- **Checklist filters combine**: several sections, owners and due ranges (OR within a group, AND across groups);
  Overdue and Next 7 days can be on together; undated items match neither. Filters live in the URL, with a visible
  "Clear filters", an item count and an empty state. The project dashboard's Overdue card opens the checklist filtered.
- **Inputs**: Enter does what the button does everywhere (in the chat-like boxes Enter sends and Shift+Enter is a new
  line, IME-safe). Text is cleared only after a successful save; a failure keeps it and says why. Each save shows a
  pending state and a brief "Added" / "Saved" / "Sent", and a newly added checklist item is highlighted.
- **Project Finances: unit economics**. A project that keeps a model file (`jarvis.economics.mjs|cjs|js`, or
  `economics.models.<id>`) gets profit by users per vendor option with decision thresholds, a users × usage profit
  grid, margin per subscriber per plan (monthly/yearly), fixed vs per-user cost lines, and controls for plan, mix,
  usage and a project-specific driver. The Mac agent evaluates the model hourly (`agent/economics.mjs`) and uploads it
  (`GET/PUT /api/agent/economics`, kv `economics.<id>`). Contract: `docs/unit-economics.md`. New config keys
  `economics.files`, `economics.models`, `economics.sync_minutes`, `economics.timeout_seconds`.
- **Usage tracking for the Monday Jarvis review**: the site records your page views and clicks (first-party, in your
  own database; only the labels the tool gives its links, buttons and tabs, never what you type) in a new
  `click_events` table via `POST /api/usage`. The Jarvis review gets a weekly aggregate (top clicks, dead-end pages,
  page-to-page sequences and backtracks, rarely used features; `GET /api/agent/usage`) and files its flow suggestions
  under "Your settings" or "Tool changes". Raw events are pruned after `usage.retention_days` (default 90). Turn it off
  with `usage.track_clicks: false` (new `setup.mjs usage` command). Page views no longer go to the `activity` log.
- **Silent refine**: adding a checklist item no longer posts a "New checklist item" note to the Inbox; Claude's refine
  stays on the item. Replies to your comments on an item still go to the Inbox. New config key
  `worker.refine_inbox_notes` (default `false`) brings the old note back.
- **Plan this project / refresh**: the PRD, PRD milestones, "How we work" and audit-prompts setup items are skipped when
  you already have an open or done item with a matching title; `planproject.mjs <id> --dry-run` lists the ones skipped.
- This repo has a `PRD.md` draft, a "How we work" section in `CLAUDE.md`, and `docs/audits/PROMPTS.md` (the 3-day audit).

**Upgrade notes**
- Redeploy: the migration also creates `metrics_snapshots`; until then project Stats shows its Product empty state.
- Optional: add `metrics.sources.<project id>` to `jarvis.config.json` (tokens in `~/.config/jarvis/env`), or record numbers with `jarvis metrics <id> --set …`.
- Redeploy: the migration adds the `click_events` table (additive; tracking is silently skipped until it exists).
- `git pull` on the Mac: the worker pauses building and merging until the agent and the site run the same release.
- Refining a new item is now silent. To keep the Inbox note, set `"worker": { "refine_inbox_notes": true }`.
- Click tracking is on by default; to turn it off set `"usage": {"track_clicks": false}`, run
  `node app/scripts/setup.mjs usage` and redeploy.
- Unit economics: add a model file to a project's folder (see `docs/unit-economics.md`); nothing to do otherwise.

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
