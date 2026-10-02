# Jarvis Central — Product requirements

_Last updated: 2026-10-02 · Owner: the maintainer_

## Problem
People who run several projects with Claude Code have no single place to see them all. Each project's checklist, deadlines, reviews and planning sit in separate folders and terminal sessions, and nothing fits that work around their calendar. Jarvis Central is a personal command centre they install on their own accounts (their Claude plan, a free Vercel project, a free Neon Postgres database). It is pointed at the folder that holds their projects.

TODO(owner): How often does this problem come up for the target user, and what do they use today instead (spreadsheets, Notion, nothing)?

## Users
- **Primary:** One person running several projects with Claude Code on a Mac, who installs and runs their own copy. The maintainer is the first such user: their personal instance is a working copy of this repo.
- **Secondary:** Other people who clone the public MIT repo and set it up through `SETUP.md`. They can change their own copy, but ideas reach this repo only as GitHub issues, and outside pull requests are closed automatically.

## Goals
1. A new user goes from `git clone` to a deployed, secured site with calendars and schedules connected by asking Claude "Set up Jarvis Central." The README estimates 30–45 minutes.
2. All projects can be seen and steered from one private website: top-3 projects, a page per project, deadlines from each PRD, a daily list and a week view with the user's calendar.
3. Claude does planning and review work without a terminal: the Sunday planner, Monday advisor reviews, "Plan this project" / "Refresh this project checklist", item comments, and inbox messages answered or built by the Mac worker.
4. The tool stays generic and private: no instance data or secrets in the repo, which the privacy guard enforces on every commit and push.
5. TODO(owner): Which measurable outcome matters most (e.g. number of installs, weekly active use by you, share of checklist items Claude completes)?

## Non-goals
- The worker never merges, deploys, pays or messages anyone on its own. The exception is merging a build-item PR after the owner clicks "Approve & merge".
- No hosted or multi-tenant service: every install runs on the user's own accounts.
- No outside code contributions: other accounts' pull requests are closed, and ideas come in as issues.
- Finance is manual entry only, with no bank or billing integrations.
- No per-message billing: Claude runs on the user's plan through the `claude` CLI.
- TODO(owner): Anything else deliberately out of scope for v1 (e.g. Windows support, mobile app, teams)?

## Scope — v1
Shipped so far (releases 0.1.0–0.5.0, per CHANGELOG):
- Self-installing setup through Claude following `SETUP.md`, plus a privacy guard installed as pre-commit and pre-push hooks.
- A private website (password + authenticator code): top 3 projects with drag-to-swap, a project page with a left menu (Dashboard, Checklists, Project, Reviews, Finances, Statistics), checklist filters, cancel, and duplicate detection.
- Today and Week views with the Google/Apple calendar, load against a day of focus, and a "Decide now" strip.
- A Sunday planner that writes time blocks into Google and Apple calendars.
- Monday reviews from CEO, CMO and product-owner advisors, plus a weekly recap, a note on how the owner works with Claude, and a Jarvis-usage review that turns tool changes into GitHub issues.
- Claude refines new checklist items and handles comments on them; "Plan this project" and "Refresh this project checklist".
- An inbox to Claude handled by a Mac worker, with New/Pending/Treated groups and replies. Claude builds in-progress items on its own branch, returns a PR, and the owner can approve-and-merge or send it back.
- A Security tab that syncs audit reports from each project's `docs/audits`.
- Finance (recurring costs), an Admin page, daily stats, and the `jarvis` agent CLI and Claude Code skill.

TODO(owner): What must still land before you'd call it v1 / 1.0? (0.6.0: see CHANGELOG.)

## Milestones
Jarvis reads this table: each row becomes a deadline on the dashboard.

| Date | Milestone |
|---|---|
| TODO(owner): YYYY-MM-DD | TODO(owner): first milestone |

## Success metrics
- TODO(owner): Metric — target — by when (e.g. setup completed by a new user in ≤ 45 min — N test installs — date)
- TODO(owner): Metric for your own usage (e.g. weeks in a row with a Monday review read and acted on)

## Risks
- Instance data or secrets leaking into the public repo. Mitigation: `agent/guard.mjs` hooks (never bypassed with `--no-verify`) and the generic-ness grep before each PR. TODO(owner): likelihood?
- The worker acting beyond its remit on the owner's Mac or repos. Mitigation: tool allow-list, throwaway branches, merges only on explicit approval, `agent/security-check.mjs`. TODO(owner): likelihood?
- Dependence on Claude plan limits and on the free tiers of Vercel and Neon. Heavy Monday reviews with web research use more of the plan. TODO(owner): likelihood, and what would reduce it?
- Mac-only schedules (launchd) limit who can install it; Linux needs cron, per `agent/README.md`. TODO(owner): likelihood / importance?
- TODO(owner): Any other risk you're tracking?

## Open questions
- TODO(owner): Who is the target audience beyond yourself, and how will they hear about it?
- TODO(owner): What defines 1.0, and when?
- TODO(owner): Users and visitors statistics wait for an analytics source. Which source, and when is it decided?
