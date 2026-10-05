# Landing page copy (draft for approval)

_Draft for the one-page site. Grounded in `PRD.md` and `README.md`. No numbers, users or testimonials until they exist._

## Headline options

1. **Every project you run, in one place that plans your week.**
   Sub: A self-hosted command centre for solo founders who build with Claude Code: checklists, deadlines, your
   calendar and an agent that turns ready items into pull requests.
2. **Run five projects without losing the thread.**
   Sub: See them all, pick what deserves this week, and let Claude plan it, review it on Monday and build the parts you approve.
3. **Your projects, your calendar, your Claude. One dashboard.**
   Sub: An open-source command centre that runs on your own accounts and works the way you already work in Claude Code.

**Recommended: 1.** It names the problem the PRD is built on, "which project deserves this week, and what do I do
next?", and the one thing nobody else combines: a portfolio of projects plus planning plus an agent. Option 2 is
punchier but promises a number of projects. Option 3 leans on ownership, which is a reason to trust it, not a reason to want it.

## Three benefits

**See every project at once.**
Each project's checklist, deadlines from its PRD, finances and metrics sit on one private site, with a timeline across all of them. You stop opening ten folders to find out where things stand.

**A week that fits your calendar.**
On Sunday it plans next week's work around your real appointments and writes the blocks into Google or Apple
Calendar. On Monday, an advisor review per project tells you what shipped, what slipped and what to do next.

**Claude builds what you mark ready.**
Set a checklist item to in progress and Claude builds it on its own branch and opens a pull request. You approve and merge it from the same page, or send it back with a note. Nothing merges without you.

## How it works

1. **Clone the repo** and open it in Claude Code.
2. **Say "Set up Jarvis Central."** Claude walks you through it: it finds your projects, drafts a plan file for each,
   deploys your private site to your own Vercel and database accounts, and connects your calendar. You type every password and secret yourself.
3. **Run your week from it.** Sunday: a plan in your calendar. Monday: a review of each project. Any day: message
   Claude from the site, or mark an item ready to build.
4. **Approve what comes back.** Pull requests wait for your "Approve & merge". Answers wait in your inbox.

## Calls to action

| | Button | Supporting line |
|---|---|---|
| Primary | **Install from GitHub** | Free and open source. Runs on your Mac with your Claude plan, plus free Vercel and Neon accounts. |
| Secondary note under the primary button | **Hosted version: join the waitlist** | A hosted plan is coming. It will run on your own Anthropic API key, so you never hand over your Claude account. |
| Waitlist (its own section) | **Join the waitlist** | Want it without running anything? Leave your email and we'll write once, when the hosted version opens. |
| Demo | **Watch the demo** | A short walk-through, recorded on a demo instance with sample projects and no private data. |

## What it is not

- **Not hosted yet.** Today you install it on your own accounts. That's the point (your data stays with you), and it takes setup time.
- **Mac + Claude Code required.** The background worker runs on your Mac and uses your Claude plan. Linux works with cron; Windows doesn't.
- **Not for teams yet.** It's built for one person running several projects. Sharing and roles aren't there.
- **Not an autopilot.** Claude plans, reviews and builds on branches. You decide, approve and merge.

## How it compares

Agent boards such as Vibe Kanban and Linear's coding sessions are great at running one task through an agent.
Calendar planners such as Motion and Reclaim are great at fitting tasks into your day. Sentient Dash puts the two
together for a single person across all their projects, adds a weekly review of each one, and runs on your own accounts.

## FAQ

**Is it free?**
Yes. The self-hosted version is open source (MIT). You use your existing Claude plan, and Vercel's and Neon's free tiers are enough for one person.

**What do I need?**
A Mac, Node 20+, git, Claude Code signed in, and a Vercel account. The GitHub CLI is optional; you need it for the "build it" pull requests.

**Does my data leave my accounts?**
Your checklists, plans and reviews live in your own Vercel site and database. Claude runs through your own Claude
plan, and your session transcripts are read on your Mac only. Nothing is sent to us, because there is no "us"
server in the self-hosted version.

**What does Claude get access to?**
Your project folders on your Mac, through a worker with a fixed list of allowed tools. It works on throwaway
branches, opens pull requests and never merges, deploys, pays or messages anyone on its own. The site is behind your password and an authenticator code.

**What about the hosted version?**
It's planned for after 1.0. It will run on your own Anthropic API key, so you stay in control of AI usage and cost. Join the waitlist to hear when it opens.
