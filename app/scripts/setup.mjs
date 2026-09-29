#!/usr/bin/env node
// Jarvis Central website setup. Run from app/ (the folder linked to your Vercel project).
// Secrets go straight to Vercel as "sensitive" env vars and are never printed — except the authenticator
// QR code in `login`, which you scan once. Settings come from ../jarvis.config.json (see docs/config.md).
//
//   node scripts/setup.mjs secrets          session secret, Mac agent token, timezone, owner name, schedule wording
//                                           (also writes ~/.config/jarvis/env for the Mac side)
//   node scripts/setup.mjs login            choose your password + pair an authenticator app   ← run in your own terminal
//   node scripts/setup.mjs google-calendar  paste your Google Calendar secret iCal address(es)  ← run in your own terminal
//   node scripts/setup.mjs apple-calendar   paste your iCloud public calendar link(s)          ← run in your own terminal
//   node scripts/setup.mjs apps-script      token + filled-in Apps Script (writes the plan into Google Calendar)
//   node scripts/setup.mjs apple-feed       copies the private subscription link for Apple Calendar
//   node scripts/setup.mjs status           which env vars are set on Vercel (names only)
//
// Env vars only take effect on the next deploy: `vercel deploy --prod` after changing them.
import { randomBytes, scryptSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import readline from "node:readline";

const ROOT = new URL("../../", import.meta.url);
const CONFIG_FILE = new URL("jarvis.config.json", ROOT);
const config = existsSync(CONFIG_FILE) ? JSON.parse(readFileSync(CONFIG_FILE, "utf8")) : null;
const cmd = process.argv[2];

/** The site's public URL: JARVIS_URL env, else site_url in jarvis.config.json. */
function siteUrl() {
  const u = (process.env.JARVIS_URL || config?.site_url || "").replace(/\/+$/, "");
  if (!/^https:\/\/[^/]+$/.test(u) || u.includes("your-jarvis")) {
    console.error("I need your site's address. Set \"site_url\" in jarvis.config.json (e.g. https://my-jarvis.vercel.app,");
    console.error("the \"Aliased\" address `vercel deploy --prod` prints), or run with JARVIS_URL=https://… in front.");
    process.exit(1);
  }
  return u;
}
function need(cond, msg) { if (!cond) { console.error(msg); process.exit(1); } }
const title = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const when = (run, fallback) => (run?.weekday && run?.time ? `every ${title(run.weekday)} at ${run.time}` : fallback);

function setEnv(name, value, envs = ["production"]) {
  for (const env of envs) {
    const r = spawnSync("vercel", ["env", "add", name, env, "--force", "--yes", ...(env === "development" ? [] : ["--sensitive"])], { input: value, encoding: "utf8" });
    if (r.status !== 0) { console.error(`Couldn't set ${name} (${env}):\n${r.stderr || r.stdout}`); process.exit(1); }
  }
  console.log(`✓ ${name} saved to Vercel (${envs.join(", ")})`);
}
function ask(q, { hidden = false } = {}) {
  return new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = (s) => { if (s.includes(q)) rl.output.write(q); else if (!s.includes("\n")) rl.output.write("•"); };
    rl.question(q, (a) => { rl.close(); if (hidden) process.stdout.write("\n"); res(a); });
  });
}
function b32(buf) {
  const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; let bits = 0, val = 0, out = "";
  for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += A[(val >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += A[(val << (5 - bits)) & 31];
  return out;
}
function hash(pw) {
  const salt = randomBytes(16), N = 16384, r = 8, p = 1;
  return `scrypt$${N}$${r}$${p}$${salt.toString("base64url")}$${scryptSync(pw, salt, 32, { N, r, p }).toString("base64url")}`;
}
const copy = (text) => spawnSync("pbcopy", { input: text }).status === 0;

if (cmd === "secrets") {
  need(config, "Create jarvis.config.json first (copy jarvis.config.example.json and fill it in).");
  const url = siteUrl();
  need(config.timezone && Intl.supportedValuesOf("timeZone").includes(config.timezone), `"timezone" in jarvis.config.json must be an IANA name like "Europe/Paris" (got ${JSON.stringify(config.timezone)}).`);
  const agentToken = randomBytes(32).toString("hex");
  setEnv("JARVIS_SESSION_SECRET", randomBytes(48).toString("base64url"));
  setEnv("JARVIS_AGENT_TOKEN", agentToken);
  setEnv("JARVIS_TZ", config.timezone, ["production", "development"]);
  if (config.owner_name) setEnv("JARVIS_OWNER", config.owner_name, ["production", "development"]);
  setEnv("JARVIS_REVIEW_WHEN", when(config.reviews?.run, "every Monday morning"), ["production", "development"]);
  setEnv("JARVIS_PLAN_WHEN", when(config.planner?.run, "every Sunday afternoon"), ["production", "development"]);
  const dir = join(homedir(), ".config", "jarvis"); mkdirSync(dir, { recursive: true });
  const f = join(dir, "env");
  const keep = existsSync(f) ? readFileSync(f, "utf8").split("\n").filter((l) => l && !/^JARVIS_(URL|AGENT_TOKEN)=/.test(l)) : [];
  writeFileSync(f, [...keep, `JARVIS_URL=${url}`, `JARVIS_AGENT_TOKEN=${agentToken}`].join("\n") + "\n", { mode: 0o600 });
  chmodSync(f, 0o600);
  console.log(`✓ Mac agent config written to ${f} (only you can read it)`);
  console.log("  Redeploy (`vercel deploy --prod`) so the site picks these up. Re-running this rotates both secrets:");
  console.log("  everyone is signed out and the Mac agent uses the new token automatically.");
} else if (cmd === "login") {
  const pw = await ask("Choose a password (12+ characters): ", { hidden: true });
  need(pw.length >= 12, "Use at least 12 characters.");
  need((await ask("Type it again: ", { hidden: true })) === pw, "They don't match.");
  const secret = b32(randomBytes(20));
  const label = encodeURIComponent(config?.owner_name ? `Jarvis Central (${config.owner_name})` : "Jarvis Central");
  const uri = `otpauth://totp/${label}?secret=${secret}&issuer=Jarvis&algorithm=SHA1&digits=6&period=30`;
  const QR = (await import("qrcode")).default;
  console.log("\nScan this with your authenticator app (Google Authenticator, 1Password, Authy…):\n");
  console.log(await QR.toString(uri, { type: "terminal", small: true }));
  console.log(`Can't scan? Add it manually with this key: ${secret.match(/.{1,4}/g).join(" ")}\n`);
  const { totpNow } = await import("./totp.mjs");
  const code = await ask("Enter the 6-digit code the app shows now, to confirm: ");
  need(totpNow(secret).includes(code.replace(/\s/g, "")), "That code doesn't match. Run this again and re-scan.");
  setEnv("JARVIS_PASSWORD_HASH", hash(pw));
  setEnv("JARVIS_TOTP_SECRET", secret);
  console.clear();
  console.log("✓ Password and authenticator saved. Clear this terminal's scrollback (⌘K) so the QR code isn't left on screen.");
  console.log("  Redeploy (or tell Claude you're done) so the new login takes effect.");
} else if (cmd === "google-calendar" || cmd === "calendar") {
  console.log("In Google Calendar on the web: Settings → click your calendar on the left → 'Integrate calendar' →");
  console.log("copy 'Secret address in iCal format'. Several calendars: paste them separated by commas.");
  console.log("Don't include the \"Jarvis · work plan\" calendar (it would count your plan as busy time).\n");
  const v = (await ask("Secret iCal address(es): ", { hidden: true })).trim();
  need(v.split(",").every((u) => /^https:\/\/calendar\.google\.com\/calendar\/ical\/.+\.ics$/.test(u.trim())),
    "That doesn't look like a Google secret iCal address (https://calendar.google.com/calendar/ical/…/basic.ics).");
  setEnv("GOOGLE_ICS_URLS", v);
  console.log("  Redeploy (or tell Claude you're done) so the calendar shows up.");
} else if (cmd === "apple-calendar") {
  console.log("In the Calendar app on your Mac: right-click an iCloud calendar in the sidebar → Share Calendar… →");
  console.log("tick 'Public Calendar' → copy the webcal:// link. Several calendars: paste them separated by commas.");
  console.log("This replaces the whole list, so paste every calendar you want, not just the new one.\n");
  const v = (await ask("Apple calendar link(s): ", { hidden: true })).trim();
  const list = v.split(",").map((u) => u.trim().replace(/^webcals?:\/\//i, "https://"));
  need(list.every((u) => /^https:\/\/p\d+-caldav\.icloud\.com\/published\/.+/.test(u)),
    "That doesn't look like an iCloud public calendar link (webcal://p…-caldav.icloud.com/published/…).");
  setEnv("APPLE_ICS_URLS", list.join(","));
  console.log("  Redeploy (or tell Claude you're done) so your Apple events show up.");
} else if (cmd === "apps-script") {
  const url = siteUrl();
  const tz = config?.timezone || "UTC";
  const tok = randomBytes(32).toString("hex");
  setEnv("JARVIS_CAL_TOKEN", tok);
  const tpl = readFileSync(new URL("google/Code.template.gs", ROOT), "utf8");
  const out = new URL("google/Code.gs", ROOT);
  writeFileSync(out, tpl.replace("__JARVIS_URL__", url).replace("__JARVIS_CAL_TOKEN__", tok).replace("__JARVIS_TZ__", tz), { mode: 0o600 });
  console.log(`✓ Apps Script written to google/Code.gs (gitignored)${copy(readFileSync(out, "utf8")) ? " and copied to your clipboard" : ""}.`);
  console.log("  Redeploy so the site accepts the new token. Re-running this rotates the token: paste the script again.");
} else if (cmd === "apple-feed") {
  const url = siteUrl();
  // The feed key is the calendar token already on Vercel; read it back from the local Apps Script copy.
  const gsFile = new URL("google/Code.gs", ROOT);
  const tok = existsSync(gsFile) ? readFileSync(gsFile, "utf8").match(/const TOKEN = "([a-f0-9]{64})"/)?.[1] : null;
  need(tok, "Run `node scripts/setup.mjs apps-script` first: the Apple feed uses the same read-only calendar token.");
  const link = `${url.replace(/^https:/, "webcal:")}/api/cal/jarvis.ics?key=${tok}`;
  console.log(copy(link) ? "✓ Subscription link copied to your clipboard (not printed: it's private)." : "Couldn't copy to the clipboard (pbcopy is macOS-only).");
} else if (cmd === "status") {
  const r = spawnSync("vercel", ["env", "ls", "production"], { encoding: "utf8" });
  need(r.status === 0, `Couldn't list env vars. Is this folder linked to a Vercel project (\`vercel link\`)?\n${r.stderr}`);
  const have = new Set([...r.stdout.matchAll(/^\s*([A-Z][A-Z0-9_]+)\s/gm)].map((m) => m[1]));
  const want = [
    ["DATABASE_URL", "database (Neon integration)", true], ["JARVIS_SESSION_SECRET", "secrets", true], ["JARVIS_AGENT_TOKEN", "secrets", true],
    ["JARVIS_TZ", "secrets", true], ["JARVIS_OWNER", "secrets (optional)", false], ["JARVIS_REVIEW_WHEN", "secrets", false], ["JARVIS_PLAN_WHEN", "secrets", false],
    ["JARVIS_PASSWORD_HASH", "login", true], ["JARVIS_TOTP_SECRET", "login", true],
    ["GOOGLE_ICS_URLS", "google-calendar (optional)", false], ["APPLE_ICS_URLS", "apple-calendar (optional)", false], ["JARVIS_CAL_TOKEN", "apps-script (optional)", false],
  ];
  for (const [name, step, required] of want) console.log(`${have.has(name) ? "✓" : required ? "✗" : "·"} ${name.padEnd(22)} ${have.has(name) ? "" : `missing → setup step: ${step}`}`);
  const env = join(homedir(), ".config", "jarvis", "env");
  console.log(`${existsSync(env) ? "✓" : "✗"} ${"~/.config/jarvis/env".padEnd(22)} ${existsSync(env) ? "" : "missing → setup step: secrets"}`);
} else {
  console.log("Usage: node scripts/setup.mjs secrets | login | google-calendar | apple-calendar | apps-script | apple-feed | status");
}
