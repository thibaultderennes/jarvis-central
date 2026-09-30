# Jarvis Central

A personal command centre for people who run several projects with Claude Code.

Point it at the folder that holds your projects and it gives you:

- **A private website** (password + authenticator app) with your top 3 projects up front (drag to swap), a full
  page per project (checklist, weekly reviews, strategy, and switches for calendar planning, weekly hours and
  reviews), deadlines and progress charts, a daily list that mixes work and personal todos, and a week view with your Google/Apple calendar in it.
- **A Sunday planner** that estimates what's due next week, fits it around your appointments and writes the
  blocks into your Google and Apple calendars.
- **Monday reviews**: a CEO, a CMO and a product-owner advisor review each active project (what shipped, what
  slipped, a security/quality audit, risks, your top 3), plus a recap of the week, a note on how you work with
  Claude, and a review of how you use Jarvis itself.
- **Comment on any checklist item**: tell Claude what to change from the item itself; it adjusts the item the way
  it refines a new one.
- **Plan this project**: one button and Claude reviews a project folder, writes where it stands, and fills the
  checklist with what has to happen next — dated on days that still have room.
- **An inbox to Claude that works without a terminal**: leave a message on the site; a worker on your Mac answers
  it inside the right project, or builds it on a new branch and opens a pull request. Reply in the thread to keep going. It never merges or deploys.

Everything runs on your own accounts: your Claude plan, a free Vercel project, a free Neon Postgres database.

## Set it up

You need a Mac (the schedules use launchd; Linux works with cron, see `agent/README.md`), Node 20+, git,
[Claude Code](https://claude.com/claude-code) signed in, and a Vercel account. GitHub CLI is optional (needed for
"Build it" pull requests).

```bash
git clone <this repo> jarvis-central
cd jarvis-central
claude
```

Then tell Claude: **"Set up Jarvis Central."** It follows [`SETUP.md`](SETUP.md) step by step: it checks your
machine, asks where your projects live, writes a `CLAUDE.md` and a `PRD.md` for every project that lacks one,
deploys your site, connects your calendars, installs the schedules and runs a security check. Anything that
involves a password, a secret or accepting terms, you type yourself in your own terminal; Claude tells you when.

Setup takes about 30–45 minutes, most of it reviewing the drafted PRDs.

## How your projects are organised

One folder holds all your projects; each subfolder is a project with a `CLAUDE.md` (how to work in it) and a
`PRD.md` (what you're building, milestones with dates). That's the only rule. Details:
[`docs/conventions.md`](docs/conventions.md).

## What it costs
- **Claude**: runs on your Claude plan through the `claude` CLI; nothing is billed per message. A discussion
  uses little (the worker uses Sonnet for it); a Monday review of several projects with web research uses more.
- **Vercel and Neon**: the free tiers are enough for one person.

## Security, in short
Login needs your password and a 6-digit code. The Mac worker talks to the site with its own token; the calendar
script has a read-only token. The worker can only use an allow-list of tools, works on throwaway branches, and
never merges, deploys, pays or messages anyone. Your Claude session transcripts are read on your Mac only.
Full model and checklist: [`docs/security.md`](docs/security.md).

## Keeping it up to date, and improving it
Your settings live in `jarvis.config.json` (not in git); everything else is shared code. Every Monday, Jarvis
reviews how you used it and proposes changes, labelled either **your settings** or **tool change**. Tool changes
come out as ready-to-file issues for this repo. To update your copy: [`docs/updating.md`](docs/updating.md).
Found a bug or have an idea? Open an issue: see [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Repository map
| Path | What |
|---|---|
| `app/` | The website: Next.js on Vercel, Postgres (Neon) |
| `agent/` | The Mac side: CLI, inbox worker, Sunday planner, Monday reviews, project scaffolding, doctor, security check |
| `personas/` | Default CEO / CMO / PO advisor prompts (projects can override them) |
| `templates/` | `CLAUDE.md` and `PRD.md` templates for your projects |
| `skills/` | The `jarvis` skill for Claude Code sessions |
| `google/` | Apps Script that writes the week plan into Google Calendar |
| `docs/` | Architecture and API, conventions, configuration, security, updating |

MIT licensed.
