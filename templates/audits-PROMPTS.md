# The audit prompts

Run against the main branch every 3 days ({{how: a scheduled Claude Code routine, or by hand}}) and whenever a large
change lands. Each run writes `docs/audits/YYYY-MM-DD-audit.md` in this folder: every check with PASS, FAIL or CAN'T
TELL, regressions against the previous report ranked first. Fixes come as pull requests, one per CRITICAL. Nothing
merges on its own.

Known and intentional, never a FAIL:
- {{what looks like a finding but is a deliberate choice here, with the file that shows it}}

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
   tokens in localStorage, no email verification or password rules
3. Database: tables with RLS off, policies that let user A read user B's rows, IDs with no ownership check, updates
   that save the whole request body
4. Input: SQL built from strings, user content rendered as raw HTML, no server-side validation, unchecked file uploads
5. Exposure: no rate limits on login or AI routes, unsigned webhooks, CORS set to *, open /admin or debug routes,
   stack traces in production, outdated dependencies

Then rank the fails by how likely each one is to hurt me, and give me the fix order.
