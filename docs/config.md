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
| `planner.max_focus_minutes_per_day` | `360` | Cap on planned focus time per day. |
| `planner.buffer_minutes` | `15` | Gap kept around appointments and between blocks. |
| `planner.weekends` | `"overflow"` | `never`, `overflow` (only when the week doesn't fit) or `always`. |
| `planner.project_caps.<id>` | — | Weekly minutes cap for a project (e.g. a side project). The "Hours per week" setting on the project's page overrides it. |
| `reviews.run` | Monday 05:00 | When the weekly reviews start. |
| `reviews.advisors` | `["ceo","cmo","po"]` | Which advisors review each active project. |
| `reviews.stance` | sceptical | Instruction given to every advisor about how hard to push back. |
| `reviews.concurrency` | `2` | Projects reviewed in parallel. |
| `worker.interval_seconds` | `60` | How often the inbox is checked. |
| `worker.allow_build` | `true` | `false` = the worker only discusses, never edits code. |
| `worker.discuss_model` | `"sonnet"` | Model for discussion messages (lighter on your plan). |
| `worker.build_model` | `null` | Model for build messages (`null` = Claude Code's default). |
| `worker.timeout_minutes` | `25` | Hard limit per message. |
| `calendars.read_google` / `read_apple` | `true` / `false` | Show those appointments and plan around them. |
| `calendars.write_google` / `write_apple_feed` | `true` / `false` | Put the week plan in those calendars. |
| `guard.deny` | `[]` | Extra words the privacy guard must never let into a commit (client names, product names…). Your name, project folders and names, site address and home path are always blocked. |
