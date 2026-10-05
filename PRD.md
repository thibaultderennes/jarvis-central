# Sentient Dash (Jarvis Central) — Product requirements

_Last updated: 2026-10-05 · Owner: the maintainer · Repo and CLI keep the name "Jarvis"; the product UI is "Sentient Dash"._

## Problem
A solo founder who runs several projects with Claude Code has no single place that answers "which of my projects
deserves this week, and what exactly do I do next?". Each project's checklist, deadlines, reviews and planning sit in
separate folders and terminal sessions; nothing fits that work around their calendar, and nothing turns "this item is
ready" into code without them driving a terminal.

How often: every week, for anyone with three or more live projects. People describe it as "spinning my wheels" and
"three projects going… very poorly" ([HN](https://news.ycombinator.com/item?id=42482841),
[Indie Hackers](https://www.indiehackers.com/post/how-do-you-manage-multiple-side-projects-d7d66980f9)), and build
their own multi-project Claude Code setups by hand to cope.

What they use today: a mix that covers pieces, never the whole.
- Coding-agent boards: Vibe Kanban, Nimbalyst, Conductor, Claude Squad. They manage agent runs per repo, not a founder's portfolio.
- Team tools with agents: Linear coding sessions, GitHub Copilot coding agent. These are hosted, built for teams and billed per seat or credit.
- Calendar planners: Motion, Reclaim, Sunsama, Akiflow, Morgen. They have no code and no agent.
- Do-it-yourself "personal OS" repos built on Claude Code.

The closest combination (Linear + coding sessions + Reclaim) covers roughly 60–70% of the job for about $30–40 a month,
cloud-only and team-shaped.

**The gap this fills.** No single product combines five things:
1. one owner's portfolio of projects (checklists, deadlines from each PRD, finance, metrics, a cross-project timeline);
2. an agent that builds checklist items into pull requests the owner merges from the same site;
3. a weekly plan written into the owner's calendar;
4. weekly advisor reviews per project;
5. all of it self-hosted on the owner's own accounts.

## Users
- **Primary:** a solo founder or indie hacker running three or more projects with Claude Code on a Mac, who installs
  their own copy. The maintainer is the first such user: their personal instance is a working copy of this repo.
- **Secondary (1.0):** other solo founders who clone the public MIT repo and set it up through `SETUP.md`. Ideas reach
  this repo only as GitHub issues; outside pull requests are closed automatically.
- **Later:** people who want it without running anything, through a hosted subscription (see Open questions).
- **Not for (now):** teams. Sharing projects, roles and assignment were deferred on 2026-10-02: there is no concrete second user, and accounts plus data isolation are 25–40 hours of work with leak risk.

## Goals
1. A stranger goes from `git clone` to a deployed, secured site with calendars and schedules connected in **≤ 45
   minutes** by asking Claude "Set up Jarvis Central."
2. All projects are seen and steered from one private website: top-3 projects, a page per project, deadlines from each
   PRD, a cross-project timeline, a daily list and a week view with the owner's calendar.
3. Claude does planning, review and build work without a terminal: the Sunday planner, Monday advisor reviews,
   "Plan this project" / "Refresh this project checklist", item comments, inbox messages, and building in-progress
   items into PRs the owner approves.
4. The owner actually runs their week from it, measured by the success metric below, not just builds it.
5. The tool stays generic and private: no instance data or secrets in the repo, enforced by the privacy guard on every commit and push.

## Non-goals
- The worker never merges, deploys, pays or messages anyone on its own. The one exception is merging a build-item PR after the owner clicks "Approve & merge".
- **Calendar is read-only for meetings.** Jarvis reads events (busy time, join links, focus load) and never creates,
  moves or deletes meetings. It needs no calendar write scope; the week plan's focus blocks keep syncing through the
  existing Apps Script / iCal feed.
- **Finance connectors are read-only and limited to Anthropic (costs) and Stripe (fees, net revenue).** Keys live only
  in `~/.config/jarvis/env` on the Mac and never on the site. Other billing sources (Twilio, Vercel, banks) stay manual entry.
- **Sprints belong to one project.** There are no cross-project sprints; the week plan already spans projects.
- No outside code contributions: other accounts' pull requests are closed, and ideas come in as issues.
- No per-message billing in the self-hosted version: Claude runs on the owner's plan through the official `claude` CLI on their own machine.
- Out of scope for 1.0: teams, Windows, a native mobile app, and the hosted subscription (it comes after 1.0).

## Scope — 1.0
**Shipped (0.1.0 → 0.7.0, 29 Sep – 5 Oct 2026, per CHANGELOG):**
- **Setup and safety:** self-installing setup through Claude (`SETUP.md`); the privacy guard as pre-commit and pre-push hooks.
- **Site:** a private website (password + authenticator).
  - Projects: top 3 with drag-to-swap; a project page (checklist with filters, cancel, duplicate check and "blocked by", Timeline, Project, Reviews, Finances, Statistics).
  - Days and weeks: Today and Week with the calendar and a focus-load meter; a cross-project Timeline you can drag and move through time.
  - Navigation: a ⌘K palette and shortcuts.
- **Claude's work:**
  - Planning and reviews: the Sunday planner writes focus blocks into Google and Apple calendars; Monday reviews from CEO, CMO and product-owner advisors, plus a weekly recap, coaching and a usage review of Jarvis itself.
  - Checklist help: Claude refines new items and reads item comments; "Plan this project" and "Refresh this project checklist".
  - Inbox and builds: a Mac worker answers the inbox and builds in-progress items into PRs (approve & merge, or send back).
- **Data and admin:**
  - Data: Finance (recurring costs, unit economics), product metrics snapshots, a Security tab (audit reports), daily stats.
  - Admin: approve new project folders, remove and restore projects.
- **Tests:** `npm test` over the query builders and the agent API's bearer check.

**Must land before 1.0:**
1. The first security audit (`docs/audits/PROMPTS.md`) with no open CRITICAL, and the 3-day audit routine running.
2. A clean-machine install test: someone other than the owner follows `SETUP.md` on a fresh Mac and fresh Vercel and Neon accounts, within 45 minutes, and every snag is fixed.
3. A one-page site with three calls to action:
   - install from GitHub;
   - a waitlist (the sign-up for the hosted version);
   - a short demo video recorded on a demo instance with no private data.
4. The planner sizes the week from what actually got done, with planning hours that match the owner's real working hours. This is the precondition for the success metric.
5. The Anthropic and Stripe read-only connectors, each covered by a test, with the keys kept on the Mac only.

## Milestones
Jarvis reads this table: each row becomes a deadline on the dashboard.

| Date | Milestone |
|---|---|
| 2026-10-12 | 0.7.0 merged and deployed |
| 2026-10-27 | First audit report: no open critical; 3-day audit routine running |
| 2026-11-01 | Landing page live: GitHub install, waitlist, demo |
| 2026-11-08 | Clean-machine install test passed in 45 min or less |
| 2026-11-15 | 1.0: someone other than the owner runs it |

## Success metrics
- **North star: weekly active use by the owner.** Count the weeks in a row in which the owner both:
  - acts on the Monday review (opens it and closes or creates at least one item it names), and
  - finishes at least 50% of the todos the planner put on their days.

  Target: 4 weeks in a row by 2026-11-15. The first measured week finished far below 50%, so the planner fix in Scope item 4 comes first.
- **1.0 gate:** at least one install by someone other than the owner completes setup in 45 minutes or less, by 2026-11-15.
- **Watched, not targeted:** the share of checklist items Claude builds and the owner merges; waitlist sign-ups once the landing page is live.

## Risks
Likelihoods are the maintainer's estimates as of 2026-10-05.

**Platform: Anthropic terms and limits.** Likelihood: medium. Impact: high.
- Anthropic restricts automated use of Claude subscriptions by third-party tools, and has paused (not cancelled) a plan to bill `claude -p` / Agent SDK usage from a separate pool.
- Mitigation: the self-hosted agent runs only the official CLI on the owner's machine. A hosted version must use the customer's own API key, never their subscription. Watch Anthropic's notices.

**Platform absorbs the agent layer.** Likelihood: medium. Impact: medium.
- Claude Code Routines (scheduled cloud sessions that push to a branch) overlap with the Mac worker.
- Mitigation: the value is the portfolio layer (cross-project planning, reviews, deadlines), not the scheduler. Routines can become another runner behind the same API.

**Plan limits.** Likelihood: high. Impact: medium.
- The worker shares the owner's 5-hour and weekly caps with their interactive use; heavy Monday reviews with web research cost the most.
- Mitigation: one build at a time, lighter models for refine and discuss, and caps in config.

**Prompt injection with repo write access.** Likelihood: low. Impact: high.
- Text from the site (inbox, item titles, comments) reaches a `claude` run that can write to repos on a Mac that holds credentials.
- Mitigation:
  - a tool allow-list per job, branches only, and merges only on explicit approval;
  - no secrets in the agent's environment, and repo-scoped GitHub tokens;
  - the site behind password + TOTP;
  - the audits.

**Instance data or secrets leaking into the public repo.** Likelihood: low. Impact: high.
- Mitigation: the `agent/guard.mjs` hooks (never `--no-verify`) and the generic-ness grep before each PR.

**Name.** Likelihood: medium. Impact: medium.
- "Sentient" is crowded: a well-funded AI foundation, several AI companies, and a possible "Sentient Dash" analytics product at sentientdash.app (not verified).
- Accepted for now. Run a trademark search and a domain check before any paid or hosted launch.

**Mac-only schedules (launchd).** Likelihood: high. Impact: low for 1.0.
- This limits who can install it; Linux needs cron, per `agent/README.md`. Fine for the 1.0 audience; revisit with demand.

**Building faster than using.** Likelihood: high. Impact: medium.
- Releases outpace the owner's own use of the site.
- Mitigation: the north-star metric, and no new build items without a milestone they serve.

## Open questions
- **Hosted subscription (after 1.0):** a dashboard plan in the $15–30 a month range seen in the market. AI runs on the customer's own Anthropic API key, inside the terms. Accounts, per-user data isolation and billing are needed first. Decide after the waitlist shows demand.
- **Analytics source** for users and visitors on the landing page: pick one when the page ships, a privacy-friendly one with no cookie banner.
- **Linux support:** document cron as a supported path, or keep 1.0 Mac-only?
