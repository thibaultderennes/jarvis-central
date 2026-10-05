#!/usr/bin/env node
// "Refresh project folders" (Admin page): the site queues a scan in kv `projects.rescan`; this runs it on the Mac,
// where the folders live, and writes the outcome back. The worker calls rescanIfRequested() every pass;
// `node agent/rescan.mjs` runs one check by hand. New folders are never registered from here: they come back as
// proposals (full project payloads) that the owner approves or declines on the Admin page.
//
// kv projects.rescan = { status: 'queued'|'running'|'done'|'failed', requested_at, started_at?, finished_at?,
//                        proposed?: [project payload + folder], archived?: [ids], total?: n, error? }
import { api, makeLog } from "./lib.mjs";
import { syncProjects } from "./projects.mjs";

const KEY = "projects.rescan";
const STALE_MS = 15 * 60_000; // a run that never reported back (Mac slept, worker killed) is retried

export async function rescanIfRequested(log = makeLog("rescan")) {
  let cur;
  try { cur = (await api("GET", `/api/agent/kv?key=${KEY}`)).value; }
  catch (e) { if (e.status === 404) return null; throw e; }
  if (!cur || typeof cur !== "object") return null;
  const stale = cur.status === "running" && (!cur.started_at || Date.now() - +new Date(cur.started_at) > STALE_MS);
  if (cur.status !== "queued" && !stale) return null;
  const put = (v) => api("PUT", "/api/agent/kv", { key: KEY, value: v });
  const base = { requested_at: cur.requested_at };
  await put({ ...base, status: "running", started_at: new Date().toISOString() });
  log("rescan start", stale ? "(retrying a stale run)" : "");
  try {
    const lines = [];
    const r = await syncProjects({ addNew: false, print: (l) => lines.push(String(l)) });
    const result = { ...base, status: "done", finished_at: new Date().toISOString(), proposed: r.proposed, archived: r.archived, total: r.upserted.length };
    await put(result);
    log("rescan done", { proposed: r.proposed.map((b) => b.id), archived: r.archived, total: r.upserted.length });
    return result;
  } catch (e) {
    const result = { ...base, status: "failed", finished_at: new Date().toISOString(), error: String(e.message || e).slice(0, 500) };
    await put(result).catch((e2) => log("could not report rescan failure", e2.message));
    log("rescan failed", e.message);
    return result;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  rescanIfRequested().then((r) => console.log(r ? `${r.status}: ${r.proposed?.length ?? 0} proposed, ${r.archived?.length ?? 0} archived${r.error ? ` — ${r.error}` : ""}` : "No refresh requested."))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
