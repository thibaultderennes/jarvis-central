#!/usr/bin/env node
// Milestones moved on the Timeline: the site saves the new date in the project's deadlines with `prd` = the date
// PRD.md still has. This writes the new date into that PRD.md row (the file only: never a commit or a push) and clears
// the flag, so the next `projects.mjs sync` or plan reads the moved date instead of reverting it. The worker runs it
// every pass; sync and plan run it first. `node agent/milestones.mjs` runs one pass by hand.
import fs from "node:fs";
import path from "node:path";
import { api, makeLog } from "./lib.mjs";
import { moveMilestoneRows, parseMilestones } from "./structure.mjs";

export const pendingMoves = (p) => (p?.deadlines || []).some((d) => d?.prd);

/** Apply pending moves for the given projects (default: all). Updates `p.deadlines` in place; returns the ids changed. */
export async function applyMilestoneMoves(projects, log = makeLog("milestones")) {
  const list = (projects || await api("GET", "/api/agent/projects")).filter(pendingMoves);
  const done = [];
  for (const p of list) {
    if (!p.dir || !fs.existsSync(p.dir)) continue; // folder not on this Mac: stays pending
    let deadlines = p.deadlines.map(({ prd, ...d }) => d);
    try {
      const file = path.join(p.dir, "PRD.md");
      const r = moveMilestoneRows(fs.readFileSync(file, "utf8"), p.deadlines);
      if (r.moved) fs.writeFileSync(file, r.text);
      // The file stays the source of truth: a row edited by hand since the move wins (and is logged).
      const ms = parseMilestones(r.text);
      if (ms.length) deadlines = ms;
      log("moved milestones written to PRD.md", p.id, { moved: r.moved, unmatched: r.unmatched.map((d) => `${d.prd} ${d.label}`) });
    } catch (e) {
      if (e.code !== "ENOENT") { log("milestone write-back failed", p.id, e.message); continue; }
    }
    await api("PUT", "/api/agent/projects", { id: p.id, deadlines });
    p.deadlines = deadlines;
    done.push(p.id);
  }
  return done;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  applyMilestoneMoves().then((r) => console.log(r.length ? `Updated: ${r.join(", ")}` : "No moved milestones waiting."))
    .catch((e) => { console.error(e.message); process.exitCode = 1; });
}
