# Advisor reviews as a Claude Code routine (trial)

The Monday reviews run on your computer (`agent/weekly.mjs`), so they need it awake, online and logged in. A
[Claude Code routine](https://code.claude.com/docs/en/routines) runs a saved prompt in a cloud session on a schedule
instead. This trial runs **one project's** advisor review that way and compares it with the run on your computer.
Routines are a research preview: limits and the API may change.

## How it works
The routine's own session is the model. `agent/routine.mjs` does the rest:

1. `start <project> --dir <clone>` reads the project from your site, builds the same bundle as `weekly.mjs`
   (checklist, changes, metrics, costs, git log, npm audit, last review) and writes one prompt per advisor.
2. `next <project>` prints the next prompt to answer; the session answers it as that advisor and writes the JSON.
   After the last advisor it writes the synthesis prompt; after the synthesis it posts the review.
3. `compare <project>` lists the routine's reviews next to your computer's.

What a cloud run can't see: your Claude Code sessions and typed messages (they stay on your computer; the bundle
says so, so the advisors don't read it as "no work"), and pull requests, since `gh pr list` uses GitHub's GraphQL
API, which cloud sessions can't reach. The recap, coaching and Jarvis reviews stay on your computer: they read your
transcripts.

By default a run posts a separate report, **Routine trial · <project> · week of …**, on the project's Docs and
reviews, so it never replaces the review your computer posts for the same week. `--as review` (in the routine's
prompt) posts it as the project's review itself, for when you switch that project over.

## Set it up (you, on claude.ai: about 10 minutes)
1. **Environment** (claude.ai/code → environments → new): network access **Custom**, allowed domains: your site's
   host, with **Also include default list of common package managers** checked.
   - Variables: `JARVIS_URL=https://your-jarvis.vercel.app`, `JARVIS_TZ=<your timezone>`,
     `JARVIS_AGENT_TOKEN=proxy-injected`.
   - **Network secret** (Pro and Max): host = your site's host, header `Authorization`, prefix `Bearer`, value = your
     agent token. The session never sees the token. On Team or Enterprise there are no network secrets: put the
     real token in `JARVIS_AGENT_TOKEN` instead, and know that anyone using the environment can read it.
2. **Routine** (claude.ai/code/routines → New routine):
   - Repositories: this repository, plus the project's repository if it's another one.
   - Instructions: the output of `node agent/routine.mjs prompt <project>` (add `--days N` for a rolling period).
   - Connectors: remove them all; the review needs none.
   - Trigger: weekly, the day your reviews run, a few minutes past the hour (e.g. 05:07).
3. **Run now** once and open the session: it should end with `posted [verdict] headline`. A green run only means
   the session started and stopped; the transcript says whether the review was posted.

## The trial: 3 Mondays
Pick a project reviewed every week on your computer. Leave its Monday run on. For three weeks, each Monday:

```
node agent/routine.mjs compare <project>
```

| Question | Where the answer is |
|---|---|
| Did it post? | `compare` (computer: runs that ended in an error; routine: count missed runs on the routine's page) |
| How long? | `compare`, minutes per review (both runners record `meta.duration_s` from this release on) |
| What did it cost? | Computer: `compare` (dollars per review from `claude -p`). Routine: no per-run price; it draws on your plan's usage, so check claude.ai/settings/usage before and after a run |
| Is it as good? | Read both reports for the same week: does the routine's miss anything the transcripts or PRs gave the computer's? |
| Limits | One review = one routine run. Runs count against your plan's usage; the docs list hourly limits per routine and account, and plans may cap runs per day (preview) |

Switch the project over (`--as review`, then turn reviews off for it in its Settings so your computer stops) only
if the routine posted all three weeks and the reports are as useful. Otherwise delete the routine.
