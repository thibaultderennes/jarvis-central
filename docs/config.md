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
| `reviews.run` | Monday 05:00 | When the weekly reviews start. |
| `reviews.advisors` | `["ceo","cmo","po"]` | Which advisors review each active project. |
| `reviews.stance` | sceptical | Instruction given to every advisor about how hard to push back. |
| `reviews.concurrency` | `2` | Projects reviewed in parallel. |
| `worker.interval_seconds` | `60` | How often the inbox is checked. |
| `worker.allow_build` | `true` | `false` = the worker only discusses, never edits code. |
| `worker.refine_new_items` | `true` | Items you add on the site get steps, a section, priority, an estimate and a due date on a day with room. `false` = leave them as typed. |
| `worker.refine_inbox_notes` | `false` | `true` = also post an Inbox note each time a new item is refined (the result is always on the item itself). Replies to your comments on an item always go to the Inbox. |
| `worker.discuss_model` | `"sonnet"` | Model for discussion messages (lighter on your plan). |
| `worker.build_model` | `null` | Model for build messages (`null` = Claude Code's default). |
| `worker.timeout_minutes` | `25` | Hard limit per message. |
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
