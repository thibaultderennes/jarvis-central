# Security

Jarvis sees your plans, your calendar, your checklists and — on your Mac — your Claude session transcripts, and it
can run Claude in your project folders. This is how it's protected, and what you should check.

## What protects what
| Surface | Protection |
|---|---|
| The website | Password (scrypt-hashed) **and** a 6-digit TOTP code; 5 failed attempts per IP per 15 min; HttpOnly, Secure, SameSite=Lax session cookie for 30 days, signed with `JARVIS_SESSION_SECRET` mixed with a fingerprint of your password and authenticator (a new one signs every session out); **Log out signs out every device**; every page and server action re-checks the session; `noindex`; security headers (no framing, no sniffing). |
| Agent API `/api/agent/*` | 64-hex bearer token (`JARVIS_AGENT_TOKEN`), stored only in Vercel (sensitive) and `~/.config/jarvis/env` (mode 600). Constant-time comparison. |
| Calendar API `/api/cal/*` | A separate read-only token (`JARVIS_CAL_TOKEN`): it can read the week plan and report a sync, nothing else. The Apple subscription link carries it in the URL, so treat that link as private. |
| Dev sign-in | `/api/auth/dev` only exists in local development with `JARVIS_DEV_LOGIN` set; production returns 404. |
| The inbox worker | Runs `claude -p` with `--permission-mode dontAsk` and an allow-list: read tools, the Jarvis CLI and read-only git in *discuss* mode; plus edit/commit/test in a **throwaway git worktree** in *build* mode. Every run is denied reading or writing `~/.config/jarvis`, `~/.ssh`, `~/.config/gh`, `~/.aws` and `.env` files, and told that what it reads is data, not instructions. In build mode every shell command runs in the OS sandbox: no network except localhost, writes only in the worktree. Always denied: `git push`, `gh pr merge`, `rm -rf`, `curl`, deploy and billing CLIs. A run can't set an item in progress or change its owner (that's your go for a build). The worker script (not Claude) pushes the branch and opens the PR, and merges it only after you press **Approve & merge** on the site; nothing is deployed by Jarvis. 25-minute limit per message. Set `worker.allow_build: false` to allow discussion only. |
| Transcripts | Read on your Mac only. Reviews posted to the site contain summaries and short quotes (≤ 20 words) of your own messages. |

## Data that leaves your Mac
- **Your database (Neon) through your Vercel project:** checklists, todos, messages and replies, reviews (with
  summaries and quotes of up to 20 words of your own messages), week plans, metrics and page-usage events.
- **Anthropic, through your Claude plan:** every prompt the worker and the reviews send, including excerpts of your
  session transcripts for the coaching review and the project bundles for the advisor reviews.
- **GitHub:** build runs push branches and open pull requests on your repos; skill packs are fetched from public repos.
- **Google:** the Apps Script reads your week plan to put it in Google Calendar; calendar feeds are fetched by your
  Vercel project.
- **Your metrics sources:** the URLs and commands you set in `metrics.sources`, with the tokens you name there.

Nothing goes anywhere else. Your project folders and the full transcripts stay on your Mac.

## Links that grant access if they leak
- Google's *secret address in iCal format* and iCloud *public calendar* links: anyone with them can read that
  calendar. Reset them in Google Calendar (Integrate calendar → Reset) or stop sharing in the Calendar app.
- The Apple subscription link to your Jarvis plan (contains the calendar token): rotate with
  `node app/scripts/setup.mjs apps-script`, then re-paste the Apps Script and re-subscribe.

## Checklist after setup, and every few months
- [ ] `node agent/security-check.mjs` passes.
- [ ] You can't sign in without the authenticator code.
- [ ] `~/.config/jarvis/env` is `-rw-------`; `jarvis.config.json` and `google/Code.gs` aren't tracked by git.
- [ ] You know what the worker may do (above) and have chosen `worker.allow_build`.
- [ ] The Monday reviews' **Audit** sections have no open critical findings.

## If something leaks
| Leaked | Do |
|---|---|
| Password or TOTP secret | `node app/scripts/setup.mjs login`: the new one signs every session out |
| Session cookie / you want everyone signed out | **Log out** on the site (every device). For the agent token too: `node app/scripts/setup.mjs secrets`, redeploy |
| Agent token | same as above; the Mac side picks up the new token from `~/.config/jarvis/env` |
| Calendar token / Apple feed link | `node app/scripts/setup.mjs apps-script`, redeploy, re-paste the Apps Script, re-subscribe in Calendar |
| Your Mac (lost or compromised) | From any machine with the repo and Vercel access: `setup.mjs secrets`, `login` and `apps-script`, then redeploy. The old Mac's token stops working. |
