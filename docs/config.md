# Configuration — `jarvis.config.json`

Lives at the repo root, is gitignored, and is created during setup from `jarvis.config.example.json`. Missing keys
fall back to the defaults below, so an old file keeps working after an update. The website gets the few values it
needs (timezone, your name, schedule wording) as Vercel env vars, written by `node app/scripts/setup.mjs secrets`:
re-run it and redeploy after changing those.

| Key | Default | What it does |
|---|---|---|
| `owner_name` | `"you"` | How reviews and the worker address you. |
| `projects_root` | `"~/Projects"` | The folder whose subfolders are your projects. |
| `timezone` | `"UTC"` | IANA zone for every date, the planner and the schedules (`America/New_York`, `Europe/Paris`…). |
| `site_url` | — | Your deployment URL; written after the first deploy. |
| `projects.include` | `[]` | If non-empty, only these folder names are projects. |
| `projects.exclude` | `["node_modules", ".jarvis-worktrees"]` | Folder names to skip. |
| `projects.overrides.<id>` | — | `name`, `kind` (`checklist`/`running`), `color` (`p1`…`p7`), `tagline`, `state`, `status`. |
| `planner.run` | Sunday 17:00 | When next week is planned and written to your calendars. |
| `planner.work_days` | Mon–Fri | Days the planner fills first. |
| `planner.hours` | 09:00–12:30, 13:30–18:00 | Working intervals per day. |
| `planner.max_focus_minutes_per_day` | `360` | Cap on planned focus time per day. The site gets it as `JARVIS_FOCUS_MINUTES` (Today/Week load bars) from `setup.mjs secrets`. |
| `planner.buffer_minutes` | `15` | Gap kept around appointments and between blocks. |
| `planner.weekends` | `"overflow"` | `never`, `overflow` (only when the week doesn't fit) or `always`. |
| `planner.project_caps.<id>` | — | Weekly minutes cap for a project (e.g. a side project). The "Hours per week" setting on the project's page overrides it. |
| `planner.adapt` | `"suggest"` | Sizes the week from the last 2 weeks. `suggest` adds "planned X, done Y" per project and an hours check (when most of your site actions and typed Claude Code messages fall outside `planner.hours`, it proposes the hours you really work) to the plan notes. `apply` does that and also caps a project where nothing moved in 2 weeks (no planned task done, no item closed, no Claude Code time) at `adapt_min_todos` tasks. `off` plans as before. An explicit `project_caps` entry or "Hours per week" always wins. |
| `planner.adapt_min_todos` | `3` | Most tasks an idle project gets under `planner.adapt: "apply"`. |
| `planner.rollover` | `true` | Daily roll-forward: once a day the worker carries unfinished work to the top of today instead of letting it slip. See [Daily roll-forward](#daily-roll-forward). `false` = off. |
| `planner.rollover_at` | `"04:00"` | Earliest local time the roll-forward runs (the first worker pass after it, once a day). |
| `planner.rollover_max_per_day` | `5` | Most todos carried into one day, so one bad day doesn't bury the next. |
| `planner.rollover_flag_after` | `3` | A todo carried this many times and still not done is parked in Someday instead, and its checklist item is flagged "check: re-scope". |
| `reviews.run` | Monday 05:00 | When the weekly reviews start. A project whose Settings say "every N days" with N other than 7 is skipped here: the worker reviews it when it's due (checked hourly), over its last N days. Settings → Run now reviews one project straight away. |
| `reviews.advisors` | `["ceo","cmo","po"]` | Which advisors review each active project. |
| `reviews.stance` | sceptical | Instruction given to every advisor about how hard to push back. |
| `reviews.concurrency` | `2` | Projects reviewed in parallel. |
| `reviews.repo_scout` | `true` | The Monday Jarvis review also searches GitHub and the web (read-only) for agent skills and tools that address the week's pain points, and proposes up to 3. `false` = no web access for that review. |
| `reviews.repo_scout_skip` | `[]` | Repos (`owner/repo`) the scout should never propose again. Installed skills are skipped automatically. |
| `worker.interval_seconds` | `60` | How often the inbox is checked. |
| `worker.allow_build` | `true` | `false` = the worker only discusses, never edits code. |
| `worker.refine_new_items` | `true` | Items you add on the site get steps, a section, priority, an estimate and a due date on a day with room. `false` = leave them as typed. |
| `worker.refine_inbox_notes` | `false` | `true` = also post an Inbox note each time a new item is refined (the result is always on the item itself). Replies to your comments on an item always go to the Inbox. |
| `worker.discuss_model` | `"sonnet"` | Model for discussion messages (lighter on your plan). |
| `worker.build_model` | `null` | Model for build messages (`null` = Claude Code's default). |
| `worker.build_mode` | `"goibniu"` | Build mode for projects that haven't picked one in Settings. `"goibniu"`: Jarvis builds quick and direct, no extra skills. `"lugh"`: the same run plus engineering skills from [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) (MIT, pinned in `agent/lugh.mjs`: incremental implementation, test-driven development, debugging, code review, simplification, docs, security, frontend UI); slower and uses more tokens. Applies to item builds and "Build it (PR)", not website builds. |
| `worker.timeout_minutes` | `25` | Hard limit per message. A Lugh build gets 1.5 times this, a website build twice. |
| `project_setup.auto_on_load` | `true` | A project created with "Start new project" (Admin) always gets the setup session. `true` = a project folder loaded for the first time (approved after "Refresh project folders", or registered by `projects.mjs sync`) gets it too: Claude analyses the folder, drafts the missing foundation docs (new files only; on a branch + PR when the folder is a repository with a remote) and puts what it can't write, and its questions for you, on the checklist. See `agent/setup.mjs`. |
| `project_setup.auto_on_update` | `true` | Run it again on a project that changed (new commits or foundation docs edited) and has a foundation piece missing that no earlier run handled, at most once per `cooldown_days`. A complete folder, or one whose gaps are already drafted or on the checklist, never re-runs. `node agent/setup.mjs check` shows what it would do. |
| `project_setup.cooldown_days` | `7` | Fewest days between two automatic runs on the same project. |
| `project_setup.check_minutes` | `60` | How often the worker checks registered projects for an update run (new projects are picked up every pass). |
| `project_setup.model` | `null` | Model for the setup session (`null` = `worker.build_model`, then Claude Code's default). |
| `audits.dir` | `"docs/audits"` | Folder inside each project where security audit reports live (`*.md`, one per run, e.g. `2026-10-01-sued-hacked.md`; `PROMPTS.md` and `README.md` are ignored). They show on the project page's Security tab. |
| `audits.sync_minutes` | `60` | How often the worker mirrors those reports to the site (`0` = every worker pass). `node agent/audits.mjs sync` does it now. |
| `economics.files` | `["jarvis.economics.mjs", "jarvis.economics.cjs", "jarvis.economics.js"]` | File names, relative to each project folder, that opt a project into unit economics: the first that exists is its model. See [`unit-economics.md`](unit-economics.md). |
| `economics.models` | `{}` | A model path per project id that replaces `economics.files` for that project, e.g. `{"my-app": "docs/finance/jarvis.economics.cjs"}`. Must stay inside the project folder. |
| `economics.sync_minutes` | `60` | How often the worker evaluates the models and uploads changed results to the project's Finances tab (`0` = every worker pass). `node agent/economics.mjs sync` does it now. |
| `economics.timeout_seconds` | `30` | Time limit for evaluating one model (each runs in its own Node process). |
| `metrics.sources.<id>` | `{}` | Where a project's product numbers come from: `{"url": "https://…", "token_env": "VAR", "header": "Authorization", "map": {…}}` (GET; the token is read from that env var, in your shell or `~/.config/jarvis/env`, and sent as `Bearer <token>`, or raw when `header` is another name) or `{"command": "…", "map": {…}}` (run in the project folder). Either must give a JSON object; `map` picks numbers by dotted path (`{"visits": "results.visitors.value"}`). See [`metrics.md`](metrics.md). |
| `metrics.sync_minutes` | `1440` | How often the worker fetches the sources and posts a snapshot (`0` = every worker pass). `node agent/metrics.mjs sync` does it now. |
| `metrics.timeout_seconds` | `30` | Time limit for one source (fetch or command). |
| `calendars.read_google` / `read_apple` | `true` / `false` | Show those appointments and plan around them. |
| `calendars.write_google` / `write_apple_feed` | `true` / `false` | Put the week plan in those calendars. |
| `usage.track_clicks` | `true` | Records your page views and clicks on the site (first-party, in your own database; only the labels the tool gives its buttons, links and tabs, never what you type) so the Monday Jarvis review can base its flow advice on how you actually move around. `false` stops it: the site gets it as `JARVIS_TRACK_CLICKS` from `setup.mjs secrets` (or just `setup.mjs usage`), then redeploy. |
| `usage.retention_days` | `90` | Raw click events older than this are deleted by the Monday run. |
| `guard.deny` | `[]` | Extra words the privacy guard must never let into a commit (client names, product names…). Your name, project folders and names, site address and home path are always blocked. |

## Daily roll-forward

The Sunday planner fills next week; the daily roll-forward (`agent/rollover.mjs`) keeps today honest. Once a day, on
the first worker pass after `planner.rollover_at` on a work day (`planner.work_days`, or every day when
`planner.weekends` is `always`), it looks back 14 days:

- **What qualifies.** Undone todos dated before today, and open checklist items (to do or in progress) due today or
  earlier that you own and that have no undone todo anywhere (past, today, later or Someday). Left alone: done and
  cancelled items and their todos, Someday todos, Claude's items, and projects with "Plan into my calendar" off.
- **Order.** Critical first, then most days overdue (from the day it was first meant for, or the item's due date),
  then the item's priority, then its old day and position.
- **Caps.** At most `planner.rollover_max_per_day` carry into a day (including any that already rolled in today), and
  never past `planner.max_focus_minutes_per_day` of load, counted like the Today load bar (a todo linked to an item
  weighs its estimate, 60 min when unknown). What doesn't fit stays on its day and is first in line tomorrow.
- **Placement.** At the top of today, untimed. Each carry adds one to the todo's carry count.
- **Repeats.** A todo carried `planner.rollover_flag_after` times and still not done is parked in Someday instead, and
  its checklist item gets the "check: re-scope" flag with a note: split it, give it a realistic date, or cancel it.
- **Safe to re-run.** A second run the same day changes nothing. `node agent/rollover.mjs --dry-run` shows what today's
  run would do; `--date YYYY-MM-DD` pretends it's another day.
