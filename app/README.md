# Jarvis Central — website

The dashboard: a Next.js 16 app on Vercel with a Postgres database (Neon, through the Vercel Marketplace).
One owner, signed in with a password plus an authenticator code. Read [`AGENTS.md`](AGENTS.md) before changing
code: this Next.js version differs from what most tutorials show (`proxy.ts` instead of middleware, async
`params`/`searchParams`).

## What's in it
| Path | What it does |
|---|---|
| `app/(main)/` | Pages behind the login: Overview (charts), Today, Week, one tab per project (checklist · weekly reviews · strategy), Reviews, Inbox |
| `app/login`, `app/api/auth/*` | Password + TOTP login, 30-day session cookie, rate-limited (5 failures / 15 min per IP) |
| `app/api/agent/[...path]` | JSON API for the Mac agent (`Authorization: Bearer $JARVIS_AGENT_TOKEN`). Contract: `../docs/architecture.md` |
| `app/api/cal/[...path]` | Read-only calendar endpoints: the week plan for the Google Apps Script, and an `.ics` feed for Apple Calendar (`JARVIS_CAL_TOKEN`) |
| `app/api/auth/dev` | Local-only sign-in for UI work: 404 in production builds and without `JARVIS_DEV_LOGIN` |
| `proxy.ts` | Redirects anything unauthenticated to `/login` (every page and Server Function also checks the session itself) |
| `lib/schema.sql` | The whole schema, idempotent; applied by `scripts/migrate.mjs` before every build |
| `lib/calendar.ts` | Reads Google / iCloud calendars from their private iCal links, recurring events expanded |
| `scripts/setup.mjs` | Puts secrets and settings on Vercel (see below) |
| `next.config.ts` | Security headers, and the tool version shown in the top bar |

## Environment variables
All set on Vercel by `node scripts/setup.mjs <step>` (run from this folder) unless noted. Changes take effect on the
next deploy. Check what's set with `node scripts/setup.mjs status`.

| Name | Set by | Purpose | Sensitive |
|---|---|---|---|
| `DATABASE_URL` (+ `POSTGRES_*`) | Neon integration (`vercel integration add neon`) | Postgres connection | yes |
| `JARVIS_SESSION_SECRET` | `secrets` | Signs the session cookie. Rotating it signs everyone out | yes |
| `JARVIS_AGENT_TOKEN` | `secrets` | Bearer token for the Mac agent API (also written to `~/.config/jarvis/env`) | yes |
| `JARVIS_TZ` | `secrets` (from `timezone`) | Your IANA timezone; every date on the site uses it. Default `UTC` | no |
| `JARVIS_OWNER` | `secrets` (from `owner_name`) | Your first name, for the welcome line | no |
| `JARVIS_REVIEW_WHEN`, `JARVIS_PLAN_WHEN` | `secrets` (from `reviews.run`, `planner.run`) | Wording like "every Monday at 05:00" | no |
| `JARVIS_PASSWORD_HASH` | `login` | scrypt hash of your password | yes |
| `JARVIS_TOTP_SECRET` | `login` | Authenticator secret | yes |
| `GOOGLE_ICS_URLS` | `google-calendar` | Google secret iCal address(es), comma-separated (optional) | yes |
| `APPLE_ICS_URLS` | `apple-calendar` | iCloud public calendar link(s), comma-separated (optional) | yes |
| `JARVIS_CAL_TOKEN` | `apps-script` | Read-only token for the plan endpoint and the Apple feed (optional) | yes |
| `JARVIS_DEV_LOGIN` | you, in `.env.local` only | Enables `/api/auth/dev?key=…` on `next dev` | — |

## Local development
```bash
npm ci
vercel link                                   # once: link this folder to your Vercel project
vercel env pull .env.local --environment=development
echo "JARVIS_SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))")" >> .env.local
echo "JARVIS_DEV_LOGIN=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")" >> .env.local
npx next dev -p 3100
# sign in: http://localhost:3100/api/auth/dev?key=<the JARVIS_DEV_LOGIN value>
```
Local dev talks to the same database as production unless you create a Neon branch for it: be careful with test data.

## Deploy
```bash
vercel deploy --prod
```
The build runs `scripts/migrate.mjs` first, which applies `lib/schema.sql`. That file must stay **additive and
idempotent** (`create … if not exists`, `alter table … add column if not exists`): it runs on every deploy of every
install, including ones several versions behind. Never drop or rename a column in place.

If a fresh Vercel project serves 404 on every page, its framework preset is empty: `vercel.json` sets
`"framework": "nextjs"`, so make sure it's deployed from this folder.

## Checks before a PR
```bash
npx tsc --noEmit && npx next build
node ../agent/security-check.mjs          # against a test deployment
```
