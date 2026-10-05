# Landing page copy (draft for approval)

_Draft for the one-page site, rewritten after the VibeCoded Screening (5 Oct 2026). Grounded in `PRD.md`, `README.md`
and `DESIGN.md`. No numbers, users or testimonials until they exist. Every section is built around a real screenshot
from the demo instance (checklist item `demo-instance-with-no`); the brackets name the shot._

## Headline (decided: option 2, sharpened)

**Keep all five side projects moving in the same week.**
Sub: Sentient Dash plans your week across every project you run with Claude Code, reviews each one on Monday, and
builds the checklist items you mark ready. It runs on your own Mac and accounts.

Why this one: it names who it's for (someone with several projects) and the job (keeping them all moving in the same
week), in one plain sentence: no "in one place", no staccato fragments, no list of three. "Five" is an example, not a claim.

Primary button: **Install from GitHub** · secondary link: **Watch the demo**

[Screenshot: the dashboard on a Monday morning, demo data, light mode]

## The section order follows your week, not a template

### Sunday: the week is planned before it starts
[Screenshot: Week view with the planned blocks next to calendar events]

Sentient Dash reads every project's checklist and deadlines, looks at your calendar, and writes focus blocks into
Google or Apple Calendar for the week ahead. It sizes the plan from what you actually finished in the last two weeks,
and tells you when the hours you plan in don't match the hours you work.

### Monday: each project gets an honest review
[Screenshot: a project review with its verdict and the top fixes]

A short review per project: what shipped, what slipped, whether the next deadline still holds, and what to do this
week. Screenings check a project before launch: generic AI-made design and copy, launch blockers, and legal and
consent gaps. Their fixes land on the checklist.

### Any day: Claude builds what you mark ready
[Screenshot: a checklist item with "PR ready for you" and the Approve & merge button]

Set an item to in progress. Claude builds it on its own branch in the project's folder and opens a pull request.
You approve and merge it from the same page, or send it back with a note. Nothing merges without you.

### Across all of it: one timeline
[Screenshot: the Timeline with milestones, sprints and today's line]

Milestones come from each project's PRD, due dates from the checklists, sprints from what you grouped. Drag a
milestone to move it; the PRD file is updated for you.

## Set up in one conversation
[Short clip: Claude Code running "Set up Jarvis Central", sped up]

Clone the repo, open it in Claude Code and say "Set up Jarvis Central." Claude finds your projects, drafts a plan file
for each, deploys your private site to your own Vercel and Neon accounts and connects your calendar. You type every
password and secret yourself.

## Calls to action

| | Button | Supporting line |
|---|---|---|
| Primary | **Install from GitHub** | Free and open source. Runs on your Mac with your Claude plan, plus free Vercel and Neon accounts. |
| Under the primary button | **Hosted version: join the waitlist** | A hosted plan is coming. It will run on your own Anthropic API key, so you never hand over your Claude account. |
| Waitlist (its own section) | **Join the waitlist** | Want it without running anything? Leave your email and we'll write once, when the hosted version opens. |
| Demo | **Watch the demo** | A walk-through recorded on a demo instance with sample projects and no private data. |

## What it is not

- **Not hosted yet.** Today you install it on your own accounts. Your data stays with you, and setup takes time.
- **Needs a Mac and Claude Code.** The background worker runs on your Mac and uses your Claude plan. Linux works with cron; Windows doesn't.
- **Not for teams yet.** It's built for one person running several projects. Sharing and roles aren't there.
- **Not an autopilot.** Claude plans, reviews and builds on branches. You decide, approve and merge.

## How it compares

Agent boards such as Vibe Kanban and Linear's coding sessions run one task through an agent well. Calendar planners
such as Motion and Reclaim fit tasks into your day well. Sentient Dash joins the two for one person across all their
projects, adds a weekly review of each, and runs on your own accounts.

## FAQ

**Is it free?**
Yes. The self-hosted version is open source (MIT). You use your existing Claude plan, and Vercel's and Neon's free tiers are enough for one person.

**What do I need?**
A Mac, Node 20+, git, Claude Code signed in, and a Vercel account. The GitHub CLI is optional; you need it for the pull requests Claude opens.

**Does my data leave my accounts?**
Your checklists, plans and reviews live in your own Vercel site and database. Claude runs through your own Claude
plan, and your session transcripts are read on your Mac only. There is no server of ours in the self-hosted version.

**What does Claude get access to?**
Your project folders on your Mac, through a worker with a fixed list of allowed tools. It works on throwaway
branches, opens pull requests and never merges, deploys, pays or messages anyone on its own. The site is behind your password and an authenticator code.

**What about the hosted version?**
It's planned for after 1.0. It will run on your own Anthropic API key, so you stay in control of AI usage and cost. Join the waitlist to hear when it opens.
