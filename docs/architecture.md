# Jarvis Central — architecture

## Pieces
1. **Website** `app/` — Next.js 16 on Vercel, Postgres (Neon). Login = password + TOTP, 30-day cookie.
   Single source of truth for checklists, daily todos, messages, reviews and week plans. Reads calendars from
   secret iCal links; publishes the week plan for Google (Apps Script) and Apple (subscription feed).
2. **Mac agent** `agent/` — Node scripts run by launchd (or cron) on the owner's machine:
   - `worker.mjs` every minute: picks up inbox messages, runs `claude -p` in the project, replies.
   - `plan.mjs` weekly (default Sunday 17:00): plans next week around the calendar, sized from the last 2 weeks
     (`planner.adapt`, `agent/adapt.mjs`: planned vs done per project and an hours check in the plan notes; `apply` caps idle projects).
   - `rollover.mjs` daily, from the worker (first pass after `planner.rollover_at` on a work day, stamped in the cache):
     undone todos from the last 14 days and open items you own due today or earlier with no todo go to the top of today,
     critical → days overdue → priority, at most `planner.rollover_max_per_day` and within `max_focus_minutes_per_day`;
     a todo carried `planner.rollover_flag_after` times is parked in Someday and its item flagged (`refine: 'flagged'`,
     `refine_note` starting `Re-scope:`, shown as "check: re-scope"). Pure logic in `rollForward()`, tested in
     `app/test/rollover.test.mjs`; `node agent/rollover.mjs --dry-run [--date D] [--fixture F]`. Rule: `docs/config.md`.
   - `weekly.mjs` weekly (default Monday 05:00): advisor reviews per project, recap, coaching, Jarvis usage review
     (fed the week's click aggregate from `GET /api/agent/usage`), then prunes click events past `usage.retention_days`.
   - `projects.mjs`: scans the projects root, scaffolds `CLAUDE.md`/`PRD.md` (offline; the full setup is `setup.mjs`), registers projects, drafts checklists.
   - `audits.mjs`: mirrors each project's security audit reports (`<dir>/<audits.dir>/*.md`, default `docs/audits`)
     to the site as `security` reviews (the project page's **Security** tab). The worker runs it once an hour
     (`audits.sync_minutes`); `node agent/audits.mjs sync [--project id] [--dry-run]` runs it by hand.
   - `economics.mjs`: evaluates each opted-in project's unit-economics model file (`economics.files`, default
     `jarvis.economics.mjs|cjs|js`, or `economics.models.<id>`) over its grid in a child process and uploads changed
     results for the project's **Finances** tab; hourly (`economics.sync_minutes`). Contract: [`unit-economics.md`](unit-economics.md).
   - `metrics.mjs`: for each project with a source in `metrics.sources.<id>` (a URL fetched with a token from an env
     var, or a command run in the project folder, giving JSON numbers), posts the day's product-metrics snapshot for
     the project's **Stats** view and the Monday review; daily (`metrics.sync_minutes`). Keys: [`metrics.md`](metrics.md).
   - `rescan.mjs`: runs a project-folder scan when "Refresh project folders" was pressed on the Admin page (kv
     `projects.rescan`); the worker checks every pass, `node agent/rescan.mjs` runs one check by hand. It updates
     registered projects but never registers a new folder: new folders come back as `proposed` payloads that the owner
     approves (the site inserts the payload) or declines (added to `projects.ignored`). `projects.mjs sync` from the
     command line still registers new folders, since the owner runs it on purpose. Both skip `projects.ignored`.
   - `screen.mjs`: **screenings**, on-demand reviews run from a project's Docs and reviews → Screenings (message `mode: 'screen'`,
     `meta.kind` = `vibecoded` | `prelaunch` | `rights`). Claude reads the folder read-only against the researched check list in
     `screenings/<kind>.md`, marks every check fail / warn / pass / n/a / live (needs the deployed site) with file evidence, and
     proposes items; they are validated and scheduled like "Plan this project" (blockers critical, owner choices in decide). The report
     is a review of type `screening` (`meta: {kind, counts, added}`). `node agent/screen.mjs <id> <kind> --dry-run` prints the prompt.
   - `website.mjs`: **website builds**, run from a project's Docs and reviews → Screenings by **Build website** (no site yet) or
     **Try a new visual** (message `mode: 'website'`, `meta: {kind: 'new'|'redesign', ask, keep_colours}`). A redesign builds 3
     distinct home-page directions as previews under `/visuals/` (live pages untouched), with screenshots in the PR. The worker runs it like a build (a
     `jarvis/website-<id>` worktree, then a PR, never merged) with the design skills pack: taste-skill (taste, redesign,
     image-to-code), vercel-labs `web-design-guidelines` and the Playwright CLI skill, fetched at pinned commits into the cache
     and loaded with `claude --plugin-dir` (`agent/skillpacks.mjs`), plus the awesome-design-md DESIGN.md library as an extra read directory. On each
     projects sync it also detects the site: site code (a web framework in a `package.json`, or an `index.html`), an address
     (`package.json` homepage, the GitHub repo homepage, a "Website: https://…" line in PRD.md / README.md / CLAUDE.md), whether
     it answers, and a Vercel / Netlify link. `node agent/website.mjs detect [id]` prints it; `node agent/website.mjs skills` fetches the pack.
   - `reviewrun.mjs`: **advisor reviews outside the weekly run**. A project's Settings set `review_every_days` (default 7 =
     the weekly run). For any other value the worker checks hourly and queues a message `mode: 'review'`
     (`meta: {kind: 'scheduled', days}`) once the newest project review (or the last attempt) is that many days old;
     Settings → **Run now** queues `meta.kind: 'now'`. The worker runs `weekly.mjs --only <id> --days <N>`: the same
     advisors and synthesis over the last N days ending today (`week_start` = the first day, `meta.period_days` = N),
     then replies with the verdict. The weekly run skips projects on their own schedule. `node agent/reviewrun.mjs due` lists them.
   - `lugh.mjs`: **build modes**. Each project picks one in Settings (`projects.build_mode`; null = `worker.build_mode`,
     default `goibniu`). **Jarvis (Goibniu)** is the plain build run. **Jarvis (Lugh)** is the same run with engineering
     skills from addyosmani/agent-skills (MIT) at a pinned commit, loaded as the `jarvis-lugh` plugin (`agent/skillpacks.mjs`),
     plus a prompt section that says which skill to follow at each step (thin slices, tests first, debugging, frontend,
     security, then self-review, simplification and docs). Applies to code runs except website builds; Lugh gets 90 turns
     and 1.5 × `worker.timeout_minutes`. The PR body and the reply name the mode; the message `meta.build_mode` records it.
     `node agent/lugh.mjs skills` fetches the pack, `brief` prints the prompt section.
   - `setup.mjs`: the **project setup session** (message `mode: 'setup'`). Entry points: **Start new project** on the Admin page
     (`meta: {kind: 'new', name, id}`; the worker creates `<projects_root>/<id>`, refusing a name or folder in use, registers the
     project, then runs the session), a project loaded for the first time, and a project updated with a foundation gap
     (`meta: {kind: 'setup', trigger: 'load'|'update'|'manual', reason}`, queued by the worker every pass, at most one at a time).
     Claude reads the folder read-only with pinned planning/writing skills from `mattpocock/skills` (grilling, to-questionnaire,
     to-spec, domain-modeling, writing-for-agents; `agent/skillpacks.mjs`) and returns the missing foundation pieces
     (`agent/foundation.mjs`: PRD with value/pain/ICP and non-goals, CLAUDE.md, README, .gitignore, GitHub, stack, database and
     auth, env vars, staging and production, error tracking, brand, design system). The script writes them: on a
     `jarvis/setup-<id>` branch + PR in a repository with a remote (the worker's worktree flow), straight into the folder otherwise,
     new files only (in a PR, a missing section may be appended to an existing doc). Questions only the owner can answer become
     `decide` items owned by `founder`; what can't be written becomes items, the foundation ones critical; all validated and
     scheduled like "Plan this project". The report is a strategy document "Project setup · date" (`meta.kind: 'project-setup'`).
     When it re-runs is `shouldRunSetup` in `foundation.mjs` (kv `projects.setup`); `node agent/setup.mjs check` shows it.
   - `jarvis.mjs`: CLI that Claude Code sessions use to read/edit checklists, answer the inbox, list audits, manage costs.
3. **Your settings** `jarvis.config.json` (gitignored) — see `docs/config.md`.

Timezone: every date-like value uses `config.timezone` (env `JARVIS_TZ` on the website). Dates are `YYYY-MM-DD`.
In the database, an item owner of `founder` means **the owner** (you); `claude` means Claude.

## Local config
`~/.config/jarvis/env` (chmod 600):
```
JARVIS_URL=https://<deployment>.vercel.app
JARVIS_AGENT_TOKEN=<64 hex chars>
```

## Data model (Postgres)
- `projects(id text pk, name, kind 'checklist'|'running', featured_rank 1–3 null /* top 3 */, plan_enabled bool, weekly_minutes int null, reviews_enabled bool, review_every_days int default 7 /* 7 = the weekly run */, build_mode text null /* 'goibniu'|'lugh'; null = worker.build_mode */, site jsonb null /* detected: {code: {framework, path}, url, source, live, deploy, checked_at} */, site_url text /* typed by the owner; wins */, color, tagline, state, status, dir, sections jsonb, deadlines jsonb, links jsonb, sort int, archived bool, updated_at)`
  - `sections`: `[{id, name, note, notes: bool /* show a note box for the owner */, owner_default}]`
  - `deadlines`: `[{date, label, prd?}]` (`prd`: a milestone moved on the Timeline; the date PRD.md still has until the Mac worker writes the new date into that row, `agent/milestones.mjs`), `links`: `[{label, url}]`, `dir`: absolute path on the Mac (e.g. `/Users/alex/Projects/my-app`)
- `items(project_id, id, section, title, detail, status 'todo'|'doing'|'done'|'cancelled', due date null, owner 'founder'|'claude'|'both'|null, critical bool, sort real, note text, created_at, updated_at, done_at, estimate_minutes, priority 1|2|3, refine 'pending'|'done'|'flagged'|'error', refine_note, refine_request /* the owner's comment awaiting Claude */, cancel_reason, duplicate_of /* id of the item it duplicated */, note_sent_at /* the note box was sent to Claude */, build_status, build_note, pr_url, build_updated_at, blocked_by text[] /* codes of items in the same project it waits on */, sprint_id uuid null)` pk `(project_id, id)`
  - **blocked_by**: an open item with an open blocker shows "blocked by …" on the checklist; nothing is enforced. The site refuses
    unknown codes, the item itself and loops; the API and CLI take an array or `"a,b"` (`""` clears) and only normalise it.
  - **open** = `todo` or `doing`; `done` and `cancelled` are closed and leave every count, deadline, load and top-3 card.
  - Items and todos of an **archived** project are kept but leave every cross-project view and count (sidebar, Home,
    Needs you, Today/Week, Stats, Timeline, `GET /api/agent/items` without `project`); its own page still lists them.
  - Creating an item (site, API, CLI, plan) refuses an exact duplicate of a title in the same project (normalised: case,
    punctuation and filler words ignored; cancelled items don't count) → API 409 `{error, duplicate}`, `allow_duplicate: true`
    overrides; a near match (most words shared) is created but flagged (`refine: 'flagged'`).
  - **Build runs** (an in-progress item owned by `claude` or `both`): `build_status` null (queued) → `working` (the worker
    made a build message with `item_id` and runs Claude on branch `jarvis/item-<id>`) → `pr_open` (`pr_url` set, awaiting
    the owner) → `merge_requested` (Approve & merge on the site) → `merged` (the worker ran `gh pr merge --squash`, item
    `done`); or `failed` (`build_note` says why; Retry clears it); or `sent_back` (the owner's note in `build_note`; the
    next run continues on the same branch and PR). One new run per worker pass, none while another is `working`.
- `sprints(id uuid, project_id /* required: a sprint never crosses projects */, name, start_date, end_date, created_at)` —
  a dated batch of one project's items (`items.sprint_id`). Deleting a sprint only detaches its items. The checklist's
  Select mode creates one or adds to it; its card shows done %, and the open estimate against the project's `weekly_minutes`
  for the sprint's length; the Timeline draws it as a band (its project's lane, or every section lane on the project page).
- `item_events(id bigserial, project_id, item_id, field, old, new, actor 'founder'|'agent', at)` — every status/due/section change
- `todos(id uuid, date date null /* null = someday */, title, kind 'life'|'work', project_id null, item_id null, time text null 'HH:MM', sort real, done bool, done_at, created_at, source null 'plan'|'rollover', rollovers int /* times the daily roll-forward carried it */, rolled_from date null /* the day it was first meant for */, rolled_at date null /* the day it last rolled in */)`
- `messages(id uuid, project_id null, text, status, reply, meta jsonb, created_at, updated_at, replied_at, archived bool, opened_at, treated_at, item_id null)`
  - status flow: `new` → `seen` (worker picked it) → `working` → `answered` | `done` | `needs_you` | `error`
  - inbox groups on the site: **New** (a reply not yet opened, or work still with Claude) → **Pending** (`opened_at` set
    once the reply was on screen) → **Treated** (`treated_at`, "Mark treated"; hidden = `archived`). `item_id` = the
    build run of a checklist item.
  - `meta`: `{branch, pr_url, cost_usd, duration_s, mode: 'answer'|'code'|'review', build_mode?: 'goibniu'|'lugh'}`
- `reviews(id uuid, type 'project'|'recap'|'coaching'|'jarvis'|'doc'|'security'|'screening', project_id null, week_start date null, title, verdict null 'on-track'|'at-risk'|'off-track'|'idle', headline, body_md, meta jsonb, created_at, acked_at timestamptz null /* null = new on Docs and reviews */, pushed jsonb /* {proposal key: item code} */)`
  - unique `(type, coalesce(project_id,''), week_start)` for weekly types → re-running a Monday overwrites.
  - **Docs and reviews** (the project page's `?v=docs`) lists a project's reports newest first (advisor reviews, strategy
    docs, plans and refreshes, project setup, screenings, security audits), with a kind filter (`&k=`), a not-acknowledged
    filter (`&f=new`) and count, and Acknowledge per report. Proposed tasks (`app/lib/docsHub.ts`): `meta.added` (codes a
    run already added: screenings, plans, setup) show as on the checklist; `meta.proposals`
    `[{title, detail?, section?, owner?, estimate_minutes?}]` (the advisor synthesis writes them) and "new item: …"
    entries under a "Top 3" heading can be pushed; other Top 3 entries show as text. A push records the key in
    `pushed`, so the same proposal is never added twice.
  - `doc` = long-lived documents (strategy reviews). `meta.tabs` may hold `[{key, label, body_md}]`.
  - `security` = one audit report file, mirrored by `agent/audits.mjs`; `week_start` is null and
    `meta = {kind: 'security-audit', file /* path relative to the project folder */, date /* from the file name */, sha /* sha256 of the file */, counts: {critical, high, medium, low} | null}`.
    Unique `(type, coalesce(project_id,''), meta->>'file')` whenever `meta.file` is set → a re-sync updates the row.
    `title` = the file's first H1 (else the file name); `headline` = its "N critical, N high, N low" line (or those
    counts from its CRITICAL/HIGH/… sections) plus the first item of a "Ranked"/"Fix order" section; `verdict` =
    off-track (critical > 0), at-risk (high > 0), on-track, or null when the counts can't be read.
- `recurring_costs(id uuid, project_id null /* null = independent */, name, amount numeric, currency, period 'week'|'month'|'year', next_renewal date null, notes, active bool, created_at, updated_at)` — the Finance page and each project's Finances view; manual entry only.
- `metrics_snapshots(project_id, date, metrics jsonb /* {key: number}, see metrics.md */, source 'manual'|'url'|'command', created_at, updated_at)` —
  primary key `(project_id, date)`; a POST merges its keys into the day's row. Read by the project's Stats view and `weekly.mjs`.
- `kv(key pk, value jsonb, updated_at)` — `worker.heartbeat`, `dashboard.layout` (Home's box layout per tab), `weekly.heartbeat`, `prefs` (`{show_done_default, finance_currency}`, the Admin page),
  `economics.<project id>` (`{project_id, file, sha, synced_at, error, error_at, data}`, see `unit-economics.md`),
  `rollover.today` (`{date, workday, carried, load: {before, after, cap}, waiting: [{title, key, critical, overdue, reason}]}`: what
  the morning roll-forward couldn't fit; Today shows it on that date only),
  `projects.rescan` (`{status 'queued'|'running'|'done'|'failed', requested_at, started_at?, finished_at?, proposed?: [project payload + folder], archived?, total?, error?}`;
  approving or declining a proposal removes it from `proposed`),
  `projects.setup` (`{<project id>: {status 'queued'|'running'|'done'|'failed', at, trigger, missing, handled, docs, head, message_id?, pr_url?, review_id?, error?}}`:
  the last setup run per project and the folder it saw; after an upgrade every existing project gets one run, one at a time),
  `projects.ignored` (`[{id, folder?, name, reason 'removed'|'declined', at}]`: folders the scan skips. **Remove** on the
  Admin page archives the project, keeping its items and history, and adds it here; **Restore** takes it off and un-archives a removed project).
- `login_attempts(ip, at, ok)`.
- `click_events(id bigserial, at, session_id /* random per browser tab, new after 30 idle min */, kind 'click'|'view', page /* path + ?v=/?k=/?tab= + checklist filter codes ?sec=/?own=/?due=/?crit=/?done= */, label, target /* link, button, tab, checkbox… */, section /* the region's aria-label or heading */, href null /* a link's destination path */)` —
  first-party usage tracking for the Monday Jarvis review. `components/UsageTracker.tsx` (mounted once in the `(main)`
  layout, one delegated click listener) batches events to `POST /api/usage` (owner session cookie, same origin;
  sendBeacon, at most every 15 s or 25 events, and when the tab is hidden). Labels come from `data-track`, else
  aria-label/title/short button text with the row's own text (item and todo titles) replaced by `…` and numbers by `#`;
  content links are stored by path only; inputs are never read. `data-track-section="…"` names a region, `data-track-off`
  excludes one. Off when `JARVIS_TRACK_CLICKS=off` (`usage.track_clicks: false`); rows older than
  `usage.retention_days` (90) are deleted by the Monday run. `activity` keeps the server-side action log.

## Agent API
All under `/api/agent/*`, header `Authorization: Bearer $JARVIS_AGENT_TOKEN`. JSON in, JSON out. Errors: `{error}` + 4xx/5xx.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/agent/projects` | | `[{project}]` |
| PUT | `/api/agent/projects` | `{id, ...fields}` upsert | `{project}` |
| GET | `/api/agent/items` | `?project=ID` (optional; all when absent) `&open=1` (todo/doing only) `&refine=pending` `&build=queue|working|pr_open|merge_requested|sent_back|…` | `[{item}]` |
| POST | `/api/agent/items` | `{project_id, section, title, id?, detail?, due?, owner?, critical?, allow_duplicate?}` | `{item}` (id = slug of title if absent); 409 `{error, duplicate}` on an exact duplicate title |
| GET | `/api/agent/duplicates` | `?project=ID` (optional) | `[[{item}, …]]` groups of exact duplicates, oldest first |
| PATCH | `/api/agent/items` | `{project_id, id, ...fields}` (status may be `cancelled`; `build_status`, `pr_url`, `build_note`, `cancel_reason`, `duplicate_of`, `blocked_by`; fields outside `ITEM_FIELDS` in `app/lib/sqlbuild.ts` are ignored) | `{item}` (logs item_events with actor 'agent') |
| DELETE | `/api/agent/items` | `?project=ID&id=ITEM` | `{ok}` |
| GET | `/api/agent/sprints` | `?project=ID&from=DATE&to=DATE` (overlapping the range) | `[{sprint}]` (`{id, project_id, name, start, end, created_at}`) |
| POST | `/api/agent/sprints` | `{project_id, name, start, end, items?: [ids]}` | `{sprint, items /* how many joined */}` 201 |
| PATCH | `/api/agent/sprints` | `{id, name?, start?, end?, add?: [ids], remove?: [ids]}` | `{sprint}` |
| DELETE | `/api/agent/sprints` | `?id=UUID` (items stay, just leave it) | `{ok}` |
| GET | `/api/agent/events` | `?since=ISO` | `[{event}]` |
| GET | `/api/agent/todos` | `?from=DATE&to=DATE` (`&someday=1` adds undated ones) | `[{todo}]` |
| POST | `/api/agent/todos` | `{date, title, kind?, project_id?, item_id?, time?, sort?, source? 'plan'|'rollover', rolled_from?, rolled_at?}` | `{todo}` |
| PATCH | `/api/agent/todos` | `{id, date? /* null = Someday */, sort?, time? /* null = untimed */, rollovers?, rolled_from?, rolled_at?}` (the daily roll-forward; only given fields change) | `{todo}`; 404 when there's no such todo |
| GET | `/api/agent/messages` | `?status=new&limit=5` (oldest first) or `?since=ISO` | `[{message}]` |
| POST | `/api/agent/messages` | `{text, project_id?, status? 'answered'|'new'|…, reply?, meta?, mode?, item_id?, thread_id?}` a note already answered, or (`status: 'new'`) work queued for the worker | `{message: {id}}` |
| PATCH | `/api/agent/messages` | `{id, status?, reply?, meta?, opened?, treated?}` (meta merged; reply sets replied_at and clears opened_at) | `{message}` |
| GET | `/api/agent/stats` | `?bucket=day\|week\|month` (default `day`) `&n=` buckets (default 14 days / 12 weeks from Monday / 12 months, owner's timezone; `days=` still works) `&project=ID` `&items=1` | `{bucket, from, to, tracking_since, overdue_open, days: [{date (bucket start), added, done, done_late, cancelled, items?: {added: [{id, project_id, title}], done: [{id, project_id, title, late}]}}]}` |
| GET | `/api/agent/costs` | `?project=ID` (`project=` empty = independent only; absent = all) `&all=1` (inactive too) | `[{cost}]` |
| POST | `/api/agent/costs` | `{name, amount, currency?, period?, project_id?, next_renewal?, notes?}` | `{cost}` |
| PATCH | `/api/agent/costs` | `{id, ...fields}` | `{cost}` |
| DELETE | `/api/agent/costs` | `?id=UUID` | `{ok}` |
| GET | `/api/agent/reviews` | `?type=&project=&limit=` newest first; `&unacked=1` only the ones not acknowledged yet | `[{review}]` (with `acked_at`, `pushed`) |
| POST | `/api/agent/reviews` | `{type, project_id?, week_start?, title, verdict?, headline?, body_md, meta?}` upsert (key: `week_start` for weekly types, else `meta.file` when set, else `id`, else insert); an upsert that changes `body_md` makes it new again (`acked_at` cleared) | `{review}` |
| PATCH | `/api/agent/reviews` | `{id, acked: true\|false}` acknowledge a report, or make it new again | `{review}`; 404 when there's no such review |
| GET | `/api/agent/proposals` | `?review=UUID` | `[{key, state 'pushable'\|'pushed'\|'on-checklist'\|'text', title?, text, detail?, section?, owner?, estimate_minutes?, source, items: [codes]}]` (`app/lib/docsHub.ts`) |
| POST | `/api/agent/proposals` | `{review_id, key, section?, owner?, estimate_minutes?}` push one pushable proposal to the checklist (the proposal is re-read from the review; the key is claimed atomically) | `{item}` 201; 409 `{error, existing}` when it was already pushed or its title is already an item; 400 for a text-only proposal |
| GET | `/api/agent/economics` | `?project=ID` (`&full=1` includes `data`) | `{project_id, file, sha, synced_at, error, error_at}`; 404 when none synced |
| PUT | `/api/agent/economics` | `{project_id, file, sha, data}` (an evaluated model, `data.v = 1`, ≤ 2 MB) or `{project_id, file, error}` (keeps the last good data) | `{economics}` without `data` |
| GET | `/api/agent/metrics` | `?project=ID&since=YYYY-MM-DD&limit=N` (default 400, newest kept) | `[{project_id, date, metrics, source, updated_at}]` oldest first; `[]` before the table exists |
| POST | `/api/agent/metrics` | `{project_id, date? /* default today, never future */, metrics: {key: number \| null /* null removes the key */}, source?}` upsert by project + date, keys merged | `{snapshot}` |
| POST | `/api/agent/heartbeat` | `{worker: 'worker'|'weekly', info?}` | `{ok}` |
| POST | `/api/agent/import` | `{projects?:[], items?:[], reviews?:[]}` bulk upsert (migration) | `{counts}` |
| GET | `/api/agent/calendar` | `?from=DATE&to=DATE` | `[{start, end, allDay, title, location}]` |
| GET | `/api/agent/activity` | `?since=ISO` | `[{at, kind, page, detail}]` server-side action log |
| GET | `/api/agent/usage` | `?since=ISO&until=ISO` (default: the last 7 days) | `{totals: {events, clicks, views, sessions, active_days}, top_clicks: [{page, label, target, section, n}], pages: [{page, views, clicks, dead_ends, exits}], dead_end_pages, sequences: [{from, to, n}], paths: [{path, n}], filters: [{page, filters, n}], backtracks: [{page, via, n}], rarely_used: [{page, label, before, now}], truncated}` aggregate of `click_events`: pages group by path + view (filter codes counted apart in `filters`), and consecutive views of one page count as one visit; 503 when the table is missing |
| DELETE | `/api/agent/usage` | `?days=90` | `{deleted}` raw click events older than that (retention) |

Site endpoint (owner session cookie, not the agent token): `POST /api/usage` — body (text/plain JSON)
`{sid, events: [{t /* ms */, k 'click'|'view', p /* page */, l /* label */, g /* element kind */, s /* section */, h /* href */}]}`,
≤ 100 events and 64 KB; always `204` once signed in (dropped silently when tracking is off or the table is missing),
`401` logged out, `403` from another origin.
Site endpoint for the ⌘K palette (owner session cookie): `GET /api/search?q=TEXT[&projects=1]` →
`{items: [{project_id, id, title, status, due, section}], projects?: [{id, name, color, tagline}]}` — items whose id or
title contain every word (case- and accent-insensitive, archived projects left out), open first, ≤ 20; `401` logged out.

## Worker rules
- Answers questions, researches, edits checklists/todos through the API, plans days.
- Code tasks: only inside a fresh git worktree on branch `jarvis/<short-id>` (`jarvis/item-<id>` for a checklist
  item's build run); the worker script (not Claude) pushes and opens the PR. Claude never merges, deploys, pays, emails,
  texts, or touches production data or secrets. The only merge the worker script does is `gh pr merge` of a PR the
  owner approved on the item ("Approve & merge"); the item is then done.
- Every pass, before the inbox: refine new items, sync audits, evaluate unit-economics models (hourly), fetch product metrics (daily), run a requested folder rescan, queue at most one project setup run, once a day the roll-forward (`rollover.mjs`), merge approved PRs, then
  queue advisor reviews that are due on a project's own schedule (hourly), then
  queue at most one build run (in-progress items owned by Claude, sent-back PRs first, critical first).
- Anything outside that → status `needs_you` with a clear explanation.

- Messages carry `mode` (`discuss` = read-only, lighter model; `build` = worktree + PR; `website` = a website build, see `website.mjs` above; `setup` = the project setup session, see `setup.mjs` above; `plan` = "Plan this project", `agent/planproject.mjs`:
  reads CLAUDE.md, PRD.md, `docs/audits/` and the checklist, adds items only to existing sections under new ids, due
  before the PRD milestone they serve; on a project that already has a checklist the same button reads "Refresh this
  project checklist" and the run also reads the git history and changed files since the checklist last moved plus the
  earlier weekly reviews, then reconciles: ticks items verified done (evidence in `refine_note`, one click to undo),
  flags obsolete ones (`refine: 'flagged'`, nothing removed), adds what's missing; the report is a strategy document
  "Checklist refresh · date"; `node agent/planproject.mjs <id> --dry-run` shows what it would read;
  `review` = an advisor review of one project, see `reviewrun.mjs` above; `auto` = legacy), an optional `review_id` (discussion under a review) and `thread_id` (first message of an inbox
  conversation; `GET /api/agent/messages?thread=ID`). `worker.allow_build: false` disables build mode.

## Week plans
- `week_plans(week_start pk, blocks jsonb, unscheduled jsonb, notes_md, version, synced_version, synced_at, synced_count, force_resync)`.
  Saving a plan replaces that week's planner-made todos (`todos.source = 'plan'`, done ones kept) and bumps `version`.
- `GET /api/agent/plan?week=` / `POST /api/agent/plan {week_start, blocks, unscheduled, notes_md, force?}`; `GET/PUT /api/agent/kv`.
- `GET /api/cal/plan` (calendar token): the plan for the current week, or next week on Sundays; the Apps Script
  rewrites a week only when `is_sunday` (true on Sundays, or after `plan.mjs --force`).
- `GET /api/cal/jarvis.ics?key=` (calendar token in the URL): iCalendar feed of planned weeks for Apple Calendar.

## Site pages
- `/` Home (0.7.3): one page, three tabs, `?tab=overview|timeline|stats` (`/timeline` and `/stats` redirect there,
  keeping `?w=`, `?bucket=`, `?proj=`). The **Now rail** above every tab: the next thing (the oldest Needs you row,
  else the most overdue item), today's timed events and todos with "now" among them, one summary line. Below it the tab's
  boxes on a 12-column grid (`components/DashCanvas.tsx`, boxes rendered on the server in `app/(main)/boxes.tsx`, list
  and defaults in `lib/dashLayout.ts`): **Customize** to drag a box by its title bar, resize from its corner, fold,
  remove, add back from the library, arrow keys to move and Shift + arrows to resize; boxes settle so they never overlap.
  The layout is saved per tab in kv `dashboard.layout` (`{overview|timeline|stats: [{id, x, y, w, h, min?}]}`, cleaned by
  `sanitizeLayout`). Overview boxes: Needs you (`app/lib/needs.ts` `needsYou()` → `{rows, count}`: open items in each
  project's decide section owned by you, items with a PR waiting for Approve & merge, replies you haven't opened; oldest
  first), the top-3 project cards with pace, this week's reviews, sprints this week, inbox. Timeline: the timeline,
  upcoming milestones, the next 7 days. Stats: every cross-project chart. Everywhere: ⌘K / Ctrl+K or `/` opens the jump palette
  (`components/CommandPalette.tsx`, also on `window` event `jarvis:palette`), `g h|t|w|i|l|s` jump to Home, Today, Week,
  Inbox, the Timeline tab, the Stats tab and `?` lists the shortcuts (`components/Shortcuts.tsx`) · `/today` · `/week` · the Timeline tab (ten weeks, last week → 8 weeks out by default; `?w=<weeks>` moves it from −26 to +52 with ← / Today / → controls, also on a project's Timeline view; days are at least 22 px wide so the chart scrolls sideways; one lane per project: PRD milestones,
  open items' due dates per day, the Sunday-plan blocks of every planned week in range, calendar events; built in `app/lib/timeline.ts`
  from existing data, no table of its own) · `/p/<id>` (views: Checklist with At a glance, Timeline (one lane per section),
  Docs and reviews, Finances, Stats, Settings; `?v=` picks the view, old `?tab=`, `?v=project` and `?v=reviews` links still work) · `/reviews` · `/finance` (recurring costs across projects) ·
  `/inbox` (New / Pending / Treated) · `/admin` (projects: "Refresh project folders" with Approve / Decline for new folders, Remove per project, removed and declined
  folders with Restore; account, subscriptions, preferences).
- Env vars the site reads beyond the secrets: `JARVIS_TZ`, `JARVIS_OWNER`, `JARVIS_REVIEW_WHEN`, `JARVIS_PLAN_WHEN`,
  `JARVIS_FOCUS_MINUTES` (a day of focus for the Today/Week load bars; written from `planner.max_focus_minutes_per_day`
  by `node app/scripts/setup.mjs secrets`), `JARVIS_TRACK_CLICKS` (`on`/`off`, from `usage.track_clicks`; missing = on;
  `setup.mjs secrets` or `setup.mjs usage`).
