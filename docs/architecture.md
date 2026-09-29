# Jarvis Central — architecture

## Pieces
1. **Website** `app/` — Next.js 16 on Vercel, Postgres (Neon). Login = password + TOTP, 30-day cookie.
   Single source of truth for checklists, daily todos, messages, reviews and week plans. Reads calendars from
   secret iCal links; publishes the week plan for Google (Apps Script) and Apple (subscription feed).
2. **Mac agent** `agent/` — Node scripts run by launchd (or cron) on the owner's machine:
   - `worker.mjs` every minute: picks up inbox messages, runs `claude -p` in the project, replies.
   - `plan.mjs` weekly (default Sunday 17:00): plans next week around the calendar.
   - `weekly.mjs` weekly (default Monday 05:00): advisor reviews per project, recap, coaching, Jarvis usage review.
   - `projects.mjs`: scans the projects root, scaffolds `CLAUDE.md`/`PRD.md`, registers projects, drafts checklists.
   - `jarvis.mjs`: CLI that Claude Code sessions use to read/edit checklists and answer the inbox.
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
- `projects(id text pk, name, kind 'checklist'|'running', color, tagline, state, status, dir, sections jsonb, deadlines jsonb, links jsonb, sort int, archived bool, updated_at)`
  - `sections`: `[{id, name, note, notes: bool /* show a note box for the owner */, owner_default}]`
  - `deadlines`: `[{date, label}]`, `links`: `[{label, url}]`, `dir`: absolute path on the Mac (e.g. `/Users/alex/Projects/my-app`)
- `items(project_id, id, section, title, detail, status 'todo'|'doing'|'done', due date null, owner 'founder'|'claude'|'both'|null, critical bool, sort real, note text, created_at, updated_at, done_at)` pk `(project_id, id)`
- `item_events(id bigserial, project_id, item_id, field, old, new, actor 'founder'|'agent', at)` — every status/due/section change
- `todos(id uuid, date date null /* null = someday */, title, kind 'life'|'work', project_id null, item_id null, time text null 'HH:MM', sort real, done bool, done_at, created_at)`
- `messages(id uuid, project_id null, text, status, reply, meta jsonb, created_at, updated_at, replied_at, archived bool)`
  - status flow: `new` → `seen` (worker picked it) → `working` → `answered` | `done` | `needs_you` | `error`
  - `meta`: `{branch, pr_url, cost_usd, duration_s, mode: 'answer'|'code'}`
- `reviews(id uuid, type 'project'|'recap'|'coaching'|'doc', project_id null, week_start date null, title, verdict null 'on-track'|'at-risk'|'off-track'|'idle', headline, body_md, meta jsonb, created_at)`
  - unique `(type, coalesce(project_id,''), week_start)` for weekly types → re-running a Monday overwrites.
  - `doc` = long-lived documents (strategy reviews). `meta.tabs` may hold `[{key, label, body_md}]`.
- `kv(key pk, value jsonb, updated_at)` — `worker.heartbeat`, `weekly.heartbeat`.
- `login_attempts(ip, at, ok)`.

## Agent API
All under `/api/agent/*`, header `Authorization: Bearer $JARVIS_AGENT_TOKEN`. JSON in, JSON out. Errors: `{error}` + 4xx/5xx.

| Method | Path | Body / query | Returns |
|---|---|---|---|
| GET | `/api/agent/projects` | | `[{project}]` |
| PUT | `/api/agent/projects` | `{id, ...fields}` upsert | `{project}` |
| GET | `/api/agent/items` | `?project=ID` (optional; all when absent) `&open=1` (not done only) | `[{item}]` |
| POST | `/api/agent/items` | `{project_id, section, title, id?, detail?, due?, owner?, critical?}` | `{item}` (id = slug of title if absent) |
| PATCH | `/api/agent/items` | `{project_id, id, ...fields}` | `{item}` (logs item_events with actor 'agent') |
| DELETE | `/api/agent/items` | `?project=ID&id=ITEM` | `{ok}` |
| GET | `/api/agent/events` | `?since=ISO` | `[{event}]` |
| GET | `/api/agent/todos` | `?from=DATE&to=DATE` | `[{todo}]` |
| POST | `/api/agent/todos` | `{date, title, kind?, project_id?, item_id?, time?}` | `{todo}` |
| GET | `/api/agent/messages` | `?status=new&limit=5` (oldest first) or `?since=ISO` | `[{message}]` |
| PATCH | `/api/agent/messages` | `{id, status?, reply?, meta?}` (meta merged; reply sets replied_at) | `{message}` |
| GET | `/api/agent/reviews` | `?type=&project=&limit=` newest first | `[{review}]` |
| POST | `/api/agent/reviews` | `{type, project_id?, week_start?, title, verdict?, headline?, body_md, meta?}` upsert | `{review}` |
| POST | `/api/agent/heartbeat` | `{worker: 'worker'|'weekly', info?}` | `{ok}` |
| POST | `/api/agent/import` | `{projects?:[], items?:[], reviews?:[]}` bulk upsert (migration) | `{counts}` |
| GET | `/api/agent/calendar` | `?from=DATE&to=DATE` | `[{start, end, allDay, title, location}]` |

## Worker rules
- Answers questions, researches, edits checklists/todos through the API, plans days.
- Code tasks: only inside a fresh git worktree on branch `jarvis/<short-id>`; the worker script (not Claude) pushes
  and opens the PR. Never merges, deploys, pays, emails, texts, or touches production data or secrets.
- Anything outside that → status `needs_you` with a clear explanation.

- Messages carry `mode` (`discuss` = read-only, lighter model; `build` = worktree + PR; `auto` = legacy) and an
  optional `review_id` (discussion thread under a review). `worker.allow_build: false` disables build mode.

## Week plans
- `week_plans(week_start pk, blocks jsonb, unscheduled jsonb, notes_md, version, synced_version, synced_at, synced_count, force_resync)`.
  Saving a plan replaces that week's planner-made todos (`todos.source = 'plan'`, done ones kept) and bumps `version`.
- `GET /api/agent/plan?week=` / `POST /api/agent/plan {week_start, blocks, unscheduled, notes_md, force?}`; `GET/PUT /api/agent/kv`.
- `GET /api/cal/plan` (calendar token): the plan for the current week, or next week on Sundays; the Apps Script
  rewrites a week only when `is_sunday` (true on Sundays, or after `plan.mjs --force`).
- `GET /api/cal/jarvis.ics?key=` (calendar token in the URL): iCalendar feed of planned weeks for Apple Calendar.
