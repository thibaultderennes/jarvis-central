#!/usr/bin/env node
// "Apply" on a "Your settings" suggestion of the Monday Jarvis review: the site queues the config changes in the
// review's `decisions`; this writes them into jarvis.config.json on the Mac, where the config lives, and reports back
// (applied, or why not). The worker calls applyQueuedSettings() every pass; `node agent/settingsapply.mjs` runs one
// check by hand.
//
// The site is not trusted with the config: only the keys under ALLOWED can be written from it, a value must have the
// same type as the one it replaces, and anything that points at a file, a folder or a command (metrics.sources,
// economics, projects, guard, paths) stays a hand edit.
import fs from "node:fs";
import { api, makeLog, loadSettings, CONFIG_FILE } from "./lib.mjs";

/** Dot paths that may be written from the site: a whole section ("planner") or one key ("metrics.stale_days"). */
export const ALLOWED = ["planner", "reviews", "worker", "project_setup", "usage", "calendars",
  "metrics.sync_minutes", "metrics.timeout_seconds", "metrics.stale_days", "metrics.remind", "metrics.expect", "metrics.skip", "audits.sync_minutes"];
const KEY = /^[a-z][a-z0-9_]*(?:\.[A-Za-z0-9_-]+){1,4}$/;
const kind = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : typeof v);
const getPath = (o, parts) => parts.reduce((x, k) => (x && typeof x === "object" && !Array.isArray(x) ? x[k] : undefined), o);
const allowed = (key) => ALLOWED.some((a) => key === a || key.startsWith(a + "."));

/** Why a change can't be written, or null. `merged` is the config as the scripts see it (defaults + the owner's file). */
export function checkChange(c, merged) {
  if (!c || typeof c.key !== "string" || !KEY.test(c.key)) return `"${c?.key}" is not a config key`;
  if (!allowed(c.key)) return `${c.key} can't be set from the site: edit jarvis.config.json by hand`;
  if (c.value === undefined || JSON.stringify(c.value).length > 2000) return `${c.key}: the value is missing or too long`;
  const parts = c.key.split("."), cur = getPath(merged, parts), parent = getPath(merged, parts.slice(0, -1));
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return `${c.key}: there is no ${parts.slice(0, -1).join(".")} section to put it in`;
  const was = kind(cur), now = kind(c.value);
  if (cur === undefined) return now === "object" ? `${c.key}: a new key can't hold a whole section` : null;
  // A null default (worker.build_model) takes a string or a number; a string or number may go back to null.
  const nullable = (was === "null" && ["string", "number"].includes(now)) || (now === "null" && ["string", "number"].includes(was));
  if (was !== now && !nullable) return `${c.key} is ${was === "array" ? "a list" : `a ${was}`}, not ${now === "array" ? "a list" : `a ${now}`}`;
  if (was === "array" && cur.length && c.value.some((x) => kind(x) !== kind(cur[0]))) return `${c.key}: every entry must be like ${JSON.stringify(cur[0])}`;
  return null;
}

/** The owner's own config (not the merged one) with the changes set; throws with every reason one can't be written. */
export function applyChanges(own, changes, merged) {
  const errors = changes.map((c) => checkChange(c, merged)).filter(Boolean);
  if (!changes.length) errors.push("no config change to write");
  if (errors.length) throw new Error(errors.join("; "));
  const out = structuredClone(own || {});
  for (const c of changes) {
    const parts = c.key.split(".");
    let o = out;
    for (const k of parts.slice(0, -1)) o = o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? o[k] : (o[k] = {});
    o[parts.at(-1)] = c.value;
  }
  return out;
}

/** A one-line note for the card: what a running process won't see until it restarts. */
export const restartNote = (changes) => changes.some((c) => c.key.startsWith("worker.")) ? "The worker reads worker settings when it starts: restart it (or wait for the next login) to use them." : "";

export async function applyQueuedSettings(log = makeLog("settings")) {
  let queued;
  try { queued = await api("GET", "/api/agent/settings?queued=1"); }
  catch (e) { if (e.status === 404) return []; throw e; } // an older site has no such route
  const done = [];
  for (const q of queued || []) {
    const report = (body) => api("PATCH", "/api/agent/settings", { review_id: q.review_id, key: q.key, ...body });
    try {
      const { configExists, configError } = loadSettings();
      if (configError) throw new Error(`jarvis.config.json doesn't parse (${configError}): fix it by hand first`);
      const own = configExists ? JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")) : {};
      const next = applyChanges(own, q.changes, loadSettings().cfg);
      const tmp = CONFIG_FILE + ".tmp";
      fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
      fs.renameSync(tmp, CONFIG_FILE);
      const note = restartNote(q.changes);
      await report({ state: "applied", ...(note ? { note } : {}) });
      log("setting applied", q.key, q.changes.map((c) => c.key).join(", "));
      done.push({ ...q, state: "applied" });
    } catch (e) {
      const error = String(e.message || e).slice(0, 500);
      await report({ state: "failed", error }).catch((e2) => log("could not report setting failure", e2.message));
      log("setting not applied", q.key, error);
      done.push({ ...q, state: "failed", error });
    }
  }
  return done;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyQueuedSettings().then((r) => console.log(r.length ? r.map((x) => `${x.state}: ${x.changes.map((c) => c.key).join(", ")}${x.error ? ` (${x.error})` : ""}`).join("\n") : "Nothing to apply."))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
