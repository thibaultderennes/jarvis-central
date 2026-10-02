#!/usr/bin/env node
// Security check for a Jarvis Central Dashboard install. Safe to run any time: it only sends logged-out or
// wrong-token requests to your deployment (no brute force, no writes) and reads files in this repo.
//   node agent/security-check.mjs [--url https://your-jarvis.vercel.app]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { loadConfig, ENV_FILE, JARVIS_ROOT, CONFIG } from "./lib.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--url");
const URL_ = ((i >= 0 && argv[i + 1]) || loadConfig().JARVIS_URL || CONFIG.site_url || "").replace(/\/+$/, "");
let fails = 0, warns = 0;
const pass = (m) => console.log(`PASS  ${m}`);
const fail = (m, fix) => { fails++; console.log(`FAIL  ${m}${fix ? `\n      fix: ${fix}` : ""}`); };
const warn = (m, fix) => { warns++; console.log(`WARN  ${m}${fix ? `\n      tip: ${fix}` : ""}`); };
const get = async (p, headers = {}) => {
  try { return await fetch(URL_ + p, { redirect: "manual", headers, signal: AbortSignal.timeout(15_000) }); }
  catch (e) { return { status: 0, headers: new Headers(), error: e.message }; }
};
const git = (...a) => { try { return execFileSync("git", ["-C", JARVIS_ROOT, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; } };

console.log(`Jarvis Central Dashboard — security check\n${URL_ ? `deployment: ${URL_}` : "no deployment URL (set JARVIS_URL in ~/.config/jarvis/env or pass --url): skipping remote checks"}\n`);

/* ---------- remote: the website ---------- */
if (URL_) {
  const home = await get("/");
  if (home.status === 0) fail(`can't reach ${URL_}: ${home.error}`);
  else if ([302, 303, 307, 308].includes(home.status) && /\/login/.test(home.headers.get("location") || "")) pass("logged-out visitors are redirected to /login");
  else fail(`GET / while logged out returned ${home.status}, not a redirect to /login`, "check app/proxy.ts and that JARVIS_SESSION_SECRET is set");

  const a1 = await get("/api/agent/projects");
  a1.status === 401 ? pass("agent API refuses requests without a token") : fail(`agent API without a token returned ${a1.status}`, "every /api/agent route must call agentOk()");
  const a2 = await get("/api/agent/projects", { Authorization: "Bearer " + "0".repeat(64) });
  a2.status === 401 ? pass("agent API refuses a wrong token") : fail(`agent API with a wrong token returned ${a2.status}`);

  const c1 = await get("/api/cal/plan");
  c1.status === 401 ? pass("calendar API refuses requests without a token") : fail(`calendar API without a token returned ${c1.status}`);
  const feed = await get("/api/cal/jarvis.ics");
  [401, 404].includes(feed.status) ? pass("calendar feed refuses requests without its key") : fail(`calendar feed without a key returned ${feed.status}`);

  // the calendar token (in google/Code.gs, if generated) must not open the agent API
  let calTok = null;
  try { calTok = fs.readFileSync(path.join(JARVIS_ROOT, "google", "Code.gs"), "utf8").match(/const TOKEN = "([a-f0-9]{32,})"/)?.[1] || null; } catch {}
  if (calTok) {
    const x = await get("/api/agent/projects", { Authorization: `Bearer ${calTok}` });
    x.status === 401 ? pass("the calendar token can't read the agent API") : fail(`the calendar token opened /api/agent/projects (${x.status})`, "JARVIS_CAL_TOKEN and JARVIS_AGENT_TOKEN must be different values");
  } else warn("no google/Code.gs: skipped the calendar-token scope check", "run it again after `node app/scripts/setup.mjs apps-script`");

  // usage tracking endpoint: writes only with the owner's session (an empty batch, so nothing is stored either way)
  const u = await fetch(URL_ + "/api/usage", { method: "POST", body: '{"events":[]}', redirect: "manual", signal: AbortSignal.timeout(15_000) }).catch((e) => ({ status: 0, error: e.message }));
  [401, 302, 303, 307, 308].includes(u.status) ? pass("usage tracking endpoint refuses logged-out writes") : fail(`POST /api/usage while logged out returned ${u.status}`, "app/app/api/usage/route.ts must check the session cookie");

  const dev = await get("/api/auth/dev?key=probe");
  dev.status === 404 ? pass("the local-only dev login is off in production") : fail(`/api/auth/dev returned ${dev.status} in production`, "it must return 404 unless NODE_ENV is development");

  const login = await get("/login");
  const h = login.headers;
  const hdr = [["strict-transport-security", "HSTS"], ["x-content-type-options", "nosniff"], ["referrer-policy", "Referrer-Policy"]];
  for (const [k, label] of hdr) h.get(k) ? pass(`${label} header present`) : warn(`${label} header missing on /login`, "add it in app/next.config.ts headers()");
  const framing = h.get("x-frame-options") || /frame-ancestors/i.test(h.get("content-security-policy") || "");
  framing ? pass("clickjacking protection (X-Frame-Options or CSP frame-ancestors)") : warn("no X-Frame-Options / CSP frame-ancestors on /login", "add `X-Frame-Options: DENY` in app/next.config.ts headers()");
  /noindex/i.test(h.get("x-robots-tag") || "") || (await get("/robots.txt").then(async (r) => r.status === 200 && /Disallow:\s*\//.test(await r.text?.() || "")))
    ? pass("search engines are told not to index the site") : warn("robots noindex not found", "keep app/public/robots.txt with `Disallow: /`");
}

/* ---------- local: code and files ---------- */
const loginRoute = path.join(JARVIS_ROOT, "app", "app", "api", "auth", "login", "route.ts");
try {
  const src = fs.readFileSync(loginRoute, "utf8");
  /login_attempts/.test(src) && /MAX_FAILS|429/.test(src) ? pass("login is rate-limited (failed attempts per IP)") : fail("no login rate limit found in the login route", "count failed attempts per IP and return 429");
  /verifyTotp/.test(src) ? pass("login requires the authenticator code (TOTP)") : fail("the login route doesn't check a TOTP code");
} catch { warn("app login route not found: skipped the rate-limit and TOTP checks"); }

if (fs.existsSync(ENV_FILE)) {
  const mode = fs.statSync(ENV_FILE).mode & 0o777;
  mode & 0o077 ? fail(`${ENV_FILE} is readable by others (${mode.toString(8)})`, `chmod 600 ${ENV_FILE}`) : pass(`${ENV_FILE} is private (600)`);
} else warn(`${ENV_FILE} not found (fine before setup)`);

const isRepo = git("rev-parse", "--is-inside-work-tree") === "true";
if (!isRepo) warn("this folder isn't a git repository: skipped the ignore/tracking checks");
else {
  for (const f of ["jarvis.config.json", "google/Code.gs", "app/.env.local", ".env"]) {
    const ignored = (() => { try { execFileSync("git", ["-C", JARVIS_ROOT, "check-ignore", "-q", f]); return true; } catch { return false; } })();
    const tracked = !!git("ls-files", "--", f);
    if (tracked) fail(`${f} is committed to git`, `git rm --cached ${f} and rotate anything secret in it`);
    else if (!ignored) fail(`${f} is not gitignored`, `add ${f} to .gitignore`);
    else pass(`${f} is gitignored and not tracked`);
  }
}

// secrets in files that are (or would be) committed
const files = isRepo ? (git("ls-files", "--cached", "--others", "--exclude-standard") || "").split("\n").filter(Boolean) : [];
const PATTERNS = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/, "Anthropic API key"], [/\bgh[pousr]_[A-Za-z0-9]{30,}/, "GitHub token"], [/\bAKIA[0-9A-Z]{16}\b/, "AWS key"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"], [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "private key"],
  [/postgres(?:ql)?:\/\/[^:\s/]+:[^@\s]{6,}@/, "database URL with a password"],
  [/calendar\.google\.com\/calendar\/ical\/[^/\s]+\/private-[a-f0-9]{16,}/, "Google secret iCal address"],
  [/p\d+-caldav\.icloud\.com\/published\/\d+\/[A-Za-z0-9_-]{20,}/, "iCloud public calendar link"],
  [/(?:TOKEN|SECRET|PASSWORD)\s*[=:]\s*["']?[a-f0-9]{48,}/i, "hex secret assigned to a TOKEN/SECRET variable"],
  [/scrypt\$\d+\$\d+\$\d+\$/, "password hash"],
];
let hits = 0;
for (const f of files) {
  if (/(^|\/)(node_modules|\.next)\//.test(f) || /\.(png|jpe?g|gif|ico|woff2?|lock)$/i.test(f) || f.endsWith("package-lock.json")) continue;
  let text; try { text = fs.readFileSync(path.join(JARVIS_ROOT, f), "utf8"); } catch { continue; }
  if (text.length > 2_000_000) continue;
  for (const [re, label] of PATTERNS) if (re.test(text)) { hits++; fail(`${f}: looks like it contains a ${label}`, "move it to the environment / ~/.config/jarvis/env, then rotate it"); }
}
if (isRepo && !hits) pass(`no secrets found in ${files.length} tracked or committable files`);

console.log(`\n${fails ? `${fails} FAIL` : "No failures"}${warns ? `, ${warns} warning(s)` : ""}.`);
process.exitCode = fails ? 1 : 0;
