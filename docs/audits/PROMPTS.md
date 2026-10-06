# The audit prompts

Run against the main branch every 3 days (a scheduled Claude Code routine set up by the maintainer, or by hand) and whenever a large
change lands. Each run writes `docs/audits/YYYY-MM-DD-audit.md` in this folder: every check with PASS, FAIL or CAN'T
TELL, regressions against the previous report ranked first. Fixes come as pull requests, one per CRITICAL. Nothing
merges on its own.

This repo is a self-hosted tool with exactly one user per install (the owner). There are no customer accounts, no
payments, no marketing emails and no public content, so most of SUED is about the tool's own docs and defaults. Run
it against the main branch of this repo, not against anyone's instance: instance settings and data are never in git.

Known and intentional, never a FAIL:
- **One user, no sign-up.** No user table, email verification or password reset: the owner's password hash and TOTP
  secret live in env vars (`JARVIS_PASSWORD_HASH`, `JARVIS_TOTP_SECRET`, set by `app/scripts/setup.mjs`). Login is password + TOTP with 5 failed
  attempts per IP per 15 minutes (`app/app/api/auth/login/route.ts`).
- **No RLS.** The database (Postgres) is reached only from server code with one connection string (`app/lib/db.ts`);
  there is one owner, so there are no per-user rows to isolate. Ownership checks don't apply.
- **Dev sign-in route.** `app/app/api/auth/dev/route.ts` signs in without a password, but only when
  `NODE_ENV=development` and `JARVIS_DEV_LOGIN` is set and matches; any production build returns 404.
- **Routes skipped by the session proxy.** `app/proxy.ts` lets `/login`, `/api/auth/*`, `/api/agent/*` and `/api/cal/*`
  through: the agent API checks a bearer token (`agentOk` in `app/lib/auth.ts`, constant-time) and the calendar API its
  own read-only token (`app/app/api/cal/[...path]/route.ts`). Every page and server action also calls
  `requireSession()`.
- **Calendar token in a URL.** The Apple subscription feed (`/api/cal/jarvis.ics`) takes its key as a query parameter
  because calendar apps can't send headers (`app/app/api/cal/[...path]/route.ts`). That token can only read the week
  plan; `docs/security.md` tells the owner to treat the link as private and how to rotate it.
- **Agent writes pick fields.** PATCH on items copies only the whitelisted `ITEM_FIELDS` (`app/lib/data.ts`), not the
  whole request body. SQL goes through tagged templates or `q(text, params)` placeholders (`app/lib/db.ts`).
- **Markdown, not HTML.** Reviews and replies render with react-markdown, which escapes raw HTML (`app/components/Markdown.tsx`).
- **localStorage holds UI state only** (checklist filters and unsent note drafts, `app/components/Checklist.tsx`), never
  a token. The session is an HttpOnly cookie.
- **No rate limit on the agent API.** It is reachable only with the 64-hex agent token; there are no public AI routes
  (Claude runs on the owner's Mac through their own plan, `agent/claude.mjs`).
- **Claude runs headless with `--permission-mode dontAsk`** and an allow-list (`agent/claude.mjs`, `agent/worker.mjs`):
  build runs edit and commit only in a throwaway git worktree; `git push`, `gh pr merge`, `rm -rf`, `curl` and deploy
  CLIs are denied to Claude. The worker script itself pushes branches and opens PRs, and merges a PR **only** after
  the owner pressed merge on that item (`mergeApproved` in `agent/worker.mjs`). That is the "nothing merges on its own"
  rule, not a breach of it.
- **AI output is labelled as Claude's** in the UI (refine notes, replies, reviews) and is advice for the owner only;
  nothing AI-written is shown to third parties.
- **Transcripts stay on the Mac.** Reviews read Claude Code transcripts locally and post summaries and short quotes of
  the owner's own messages (`docs/security.md`). No analytics, pixels or cookies besides the session cookie;
  the site is `noindex` (`app/app/layout.tsx`) and sends security headers (`app/next.config.ts`).
- **The privacy guard** (`agent/guard.mjs`, hooks from `agent/install-hooks.mjs`) builds its block-list at run time from
  the gitignored `jarvis.config.json`, so the list of private terms is never in the repo.
- **No file uploads, payments or inbound webhooks.** The site takes no files, handles no money and receives no
  third-party callbacks, so those Prompt 2 checks are a PASS marked "not present", citing the search that shows it.
- **`npm run build` in `app/` runs database migrations** (`app/package.json`, `app/scripts/migrate.mjs`) because Vercel
  deploys run it; migrations are additive and idempotent (`app/lib/schema.sql`). Audits must not run it.

## Prompt 1 (SUED)

Audit this codebase like someone looking to sue me. Check every item below. For each one: PASS, FAIL, or CAN'T TELL.
For every FAIL, cite the file and line, rate it CRITICAL, HIGH, or LOW, and give me the fix. Report first. Don't change
anything yet.

SUED
1. Privacy: a missing or incomplete privacy policy (data collected, AI use, third parties), pixels or trackers firing
   before consent, a cookie banner with no reject, health data sent to analytics, face ID with no consent, unencrypted
   personal data, public storage buckets, deleted uploads still stored
2. Content: unlicensed images, no report button or takedown route, no DMCA agent, no age gate, missing alt text
3. Sales: fake testimonials or fake urgency, cancelling harder than signing up, trials that charge with no reminder,
   texts without opt-in, emails with no unsubscribe, pricing based on user data with no label
4. AI: unproven "AI-powered" claims, AI output with no label, a chatbot with no self-harm response, acting as a
   therapist, or quoting prices and policies on its own

Then rank the fails by how likely each one is to hurt me, and give me the fix order.

## Prompt 2 (HACKED)

Audit this codebase like someone trying to hack it. Check every item below. For each one: PASS, FAIL, or CAN'T TELL.
For every FAIL, cite the file and line, rate it CRITICAL, HIGH, or LOW, and give me the fix. Report first. Don't change
anything yet.

HACKED
1. Secrets: hardcoded keys, a committed .env, keys in git history or the frontend bundle
2. Auth: routes with no session check, permission checks only in the frontend, user IDs trusted from the request,
   tokens in localStorage, no email verification or password rules, admin or debug routes (`/admin`, `/debug`,
   `/api/dev*`, seed or test routes) reachable without a session and a role check in server code
3. Sessions: logout that only deletes the cookie while the session stays valid on the server, sessions that survive a
   password change or reset (look for a session version, a revocation list or a rotated signing secret), session
   cookies without `HttpOnly`, `Secure` and `SameSite=Lax` or `Strict` (find every `cookies.set` / `Set-Cookie`), no
   expiry on the session
4. Accounts: password-reset links that last more than an hour or still work a second time (the token must be stored
   hashed and deleted or marked used on first use), login, reset and sign-up answers that differ between a known and
   an unknown email (message text, status code or timing), no lockout or growing delay after repeated failed logins
   per account and per IP
5. Database: tables with RLS off, policies that let user A read user B's rows, IDs with no ownership check, updates
   that save the whole request body, the app connecting as the database owner or a superuser (it needs only select,
   insert, update and delete on its own tables; migrations run with a separate role)
6. Input: SQL built from strings, user content rendered as raw HTML (`dangerouslySetInnerHTML`, `innerHTML`,
   markdown with HTML on), user text put unescaped into HTML, emails, CSV, shell commands or file paths, no
   server-side validation (types, lengths, allowed values) on every route and server action, no request body size
   limit (look for a length check before `req.json()` / `req.text()` / `formData()`, and `bodySizeLimit` for server
   actions)
7. Uploads, money and webhooks: uploads not checked on the server against an allow-list of types (by content, not by
   file name) and a maximum size, uploads stored inside the web root or a public bucket and served from the app's own
   origin, prices, totals, discounts or credits taken from the request instead of computed on the server from the
   database, webhook routes that act before verifying the provider's signature over the raw body (with a timestamp
   or event id check against replays)
8. AI: user or third-party text (form input, emails, web pages, issues, files) placed in a prompt that can also call
   tools, write data or reach secrets, with no separation or allow-list (prompt injection), model output trusted as
   code, SQL, HTML or a URL to fetch, AI routes with no per-user or per-day usage cap and no spending limit (in code,
   or in provider settings the docs tell the owner to set)
9. Exposure: no rate limits on login, sign-up, reset, AI or email-sending routes, CORS set to `*` or reflecting any
   `Origin` on routes that use cookies or tokens, state-changing GET routes, cookie-authenticated POST routes with
   no CSRF defence (SameSite cookies plus an `Origin` / `Host` check, or a token; Next.js server actions check the
   origin themselves), no `Strict-Transport-Security` header with a `max-age` of at least a year (find the headers
   config), directory listing or source maps served in production, stack traces or raw error messages in responses,
   outdated dependencies
10. Logging: failed and successful logins, lockouts, password and secret changes, token use and admin actions not
    recorded with time and IP, or logs that hold passwords, tokens or full request bodies

For every PASS, FAIL or CAN'T TELL, give the file and line you checked. A check for something the code doesn't have
(no uploads, no payments) is a PASS marked "not present", with the search that shows it. If only a host or provider
setting can prove it, answer CAN'T TELL and say where to look. Rate a FAIL CRITICAL when anyone on the internet can
use it without signing in or it leaks secrets or money, HIGH when it needs a session or a second mistake, LOW when it
is defence in depth.

Then rank the fails by how likely each one is to hurt me, and give me the fix order.
