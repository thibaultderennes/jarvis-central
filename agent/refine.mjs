// Refines checklist items the owner adds on the website: steps, section, owner, priority, estimate, and a due date
// that doesn't pile onto an already-full day. Run by the inbox worker each pass (worker.refine_new_items).
// The model proposes; a deterministic check makes sure the chosen day has room (items due that day + calendar).
import fs from "node:fs";
import path from "node:path";
import { api, qs, CONFIG, todayTZ, addDays, parseModelJSON, JARVIS_ROOT } from "./lib.mjs";
import { runClaude } from "./claude.mjs";

const DEFAULT_EST = 60; // minutes assumed for items without an estimate when measuring a day's load
const WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const wd = (d) => WD[new Date(d + "T12:00:00Z").getUTCDay()];

export async function refinePending(projects, log) {
  if (CONFIG.worker?.refine_new_items === false) return;
  const pending = await api("GET", "/api/agent/items" + qs({ refine: "pending" }));
  for (const it of pending.slice(0, 2)) {
    try { await refineOne(it, projects, log); }
    catch (e) {
      log("refine failed", it.project_id, it.id, e.message);
      await api("PATCH", "/api/agent/items", { project_id: it.project_id, id: it.id, refine: "error", refine_note: `Couldn't refine: ${e.message.slice(0, 300)}` }).catch(() => {});
    }
  }
}

/** Minutes already committed per day: open items due that day (estimate or a default) + timed calendar events. */
export function dailyLoad(items, events, skipKey) {
  const load = {};
  for (const i of items) {
    if (!i.due || i.status === "done" || `${i.project_id}/${i.id}` === skipKey) continue;
    load[i.due] = (load[i.due] || 0) + (i.estimate_minutes || DEFAULT_EST);
  }
  for (const e of events) {
    if (e.allDay) continue;
    const m = Math.max(0, Math.round((new Date(e.end) - new Date(e.start)) / 60000));
    load[e.date] = (load[e.date] || 0) + m;
  }
  return load;
}

/** Nearest working day with room, searching back from `want` (not before today), then forward up to `limit`. */
export function fitDay(want, minutes, load, { today, limit, cap, workDays }) {
  const ok = (d) => workDays.includes(wd(d)) && (load[d] || 0) + minutes <= cap;
  if (ok(want)) return { date: want, moved: false };
  for (let d = addDays(want, -1); d >= today; d = addDays(d, -1)) if (ok(d)) return { date: d, moved: true };
  for (let d = addDays(want, 1); d <= limit; d = addDays(d, 1)) if (ok(d)) return { date: d, moved: true };
  return { date: want, moved: false, overloaded: true };
}

async function refineOne(it, projects, log) {
  const p = projects.find((x) => x.id === it.project_id);
  if (!p) throw new Error(`unknown project ${it.project_id}`);
  const today = todayTZ(), horizon = addDays(today, 42);
  const [all, events] = await Promise.all([
    api("GET", "/api/agent/items" + qs({ open: 1 })),
    api("GET", "/api/agent/calendar" + qs({ from: today, to: horizon })).catch(() => []),
  ]);
  const cap = Number(CONFIG.planner?.max_focus_minutes_per_day) || 360;
  const workDays = CONFIG.planner?.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri"];
  const key = `${it.project_id}/${it.id}`;
  const load = dailyLoad(all, Array.isArray(events) ? events : [], key);
  const mine = all.filter((i) => i.project_id === p.id && i.id !== it.id);
  const others = all.filter((i) => i.project_id !== p.id && i.due && i.due <= addDays(today, 28));
  const deadline = (p.deadlines || []).filter((d) => d.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const days = Array.from({ length: 28 }, (_, i) => addDays(today, i)).map((d) => `${d} ${wd(d)}: ${load[d] || 0} min`).join("\n");
  const line = (i) => `- [${i.project_id}/${i.id}] ${i.title} | ${i.section} | due ${i.due || "—"} | ${i.estimate_minutes ? i.estimate_minutes + " min" : "no estimate"} | ${i.owner || "owner"}${i.critical ? " | critical" : ""}${i.status === "doing" ? " | in progress" : ""}`;
  const dir = p.dir && fs.existsSync(p.dir) ? p.dir : JARVIS_ROOT;

  const prompt = `You refine a checklist item the owner just added to their project dashboard. You run headless; nobody will answer questions.
Today: ${today}. Project: ${p.name} (${p.id}), folder ${dir}. Read its PRD.md and CLAUDE.md if they exist, and look at the code only if it helps you size the work.
${CONFIG.reviews?.stance ? `Owner's preference: ${CONFIG.reviews.stance}\n` : ""}
## The new item
[${key}] "${it.title}" · section ${it.section} · due ${it.due || "not set"} · owner ${it.owner || "owner"}${it.detail ? `\nDetail: ${it.detail}` : ""}

## Sections of this project
${(p.sections || []).map((s) => `- ${s.id}: ${s.name}${s.note ? ` (${s.note})` : ""}`).join("\n") || "- (none declared)"}
Next deadline: ${deadline ? `${deadline.label} on ${deadline.date}` : "none"}.

## This project's other open items
${mine.map(line).join("\n") || "(none)"}

## Other projects' open items due in the next 4 weeks
${others.map(line).join("\n") || "(none)"}

## Load already committed per day (items due that day + calendar), capacity ${cap} min on ${workDays.join("/")}
${days}

## Do this
1. Decide whether it duplicates or largely overlaps an existing item (this project or another). If it does, say which.
2. Otherwise make it actionable: keep the owner's wording for the title unless it's unclear; write the detail as one line of
   purpose followed by 3–7 numbered concrete steps; pick the right section; owner = "founder" (the owner), "claude" or "both";
   priority 1 (high), 2 (normal) or 3 (low); critical only if it blocks a milestone; a realistic estimate in minutes (15–480).
3. Pick a due date: before the milestone it serves and after anything it depends on, on a working day whose load plus your
   estimate stays within capacity. If the owner set a date, keep it unless that day is full or it breaks a dependency.
4. Never invent facts about the project; if something is unknown, make it a step ("Confirm …").
Output ONLY one JSON object:
{"duplicate_of": ["project/id", …], "title": "…", "detail": "…", "section": "…", "owner": "founder|claude|both", "priority": 1|2|3,
 "critical": true|false, "estimate_minutes": 45, "due": "YYYY-MM-DD", "depends_on": ["project/id"], "reason": "one or two sentences: why this date, priority and size"}`;

  log("refine", key);
  const res = await runClaude({
    prompt, cwd: dir, model: CONFIG.worker?.discuss_model || "sonnet", maxTurns: 15, timeoutMs: 8 * 60_000,
    allowedTools: ["Read", "Grep", "Glob"], disallowedTools: ["Bash", "Edit", "Write", "WebFetch", "WebSearch"], log,
  });
  const out = parseModelJSON(res.result);
  if (!out) throw new Error("the model didn't return JSON");

  if (Array.isArray(out.duplicate_of) && out.duplicate_of.length) {
    const note = `Looks like it overlaps ${out.duplicate_of.map((d) => `\`${d}\``).join(", ")}. ${out.reason || ""} Merge them or delete one.`;
    await api("PATCH", "/api/agent/items", { project_id: it.project_id, id: it.id, refine: "flagged", refine_note: note.slice(0, 1000) });
    await note2inbox(p, it.title, `**Possible duplicate.** ${note}`);
    log("refine flagged", key, out.duplicate_of);
    return;
  }

  const sections = new Set((p.sections || []).map((s) => s.id));
  const est = Math.min(480, Math.max(15, Math.round(Number(out.estimate_minutes) || DEFAULT_EST)));
  const limit = deadline && deadline.date > today ? deadline.date : horizon;
  let want = /^\d{4}-\d{2}-\d{2}$/.test(out.due || "") ? out.due : it.due || addDays(today, 7);
  if (want < today) want = today;
  const fit = fitDay(want, est, load, { today, limit, cap, workDays });
  const patch = {
    project_id: it.project_id, id: it.id,
    title: typeof out.title === "string" && out.title.trim() ? out.title.trim().slice(0, 300) : it.title,
    detail: typeof out.detail === "string" ? out.detail.slice(0, 4000) : it.detail,
    section: sections.has(out.section) ? out.section : it.section,
    owner: ["founder", "claude", "both"].includes(out.owner) ? out.owner : it.owner,
    priority: [1, 2, 3].includes(Number(out.priority)) ? Number(out.priority) : 2,
    critical: !!out.critical, estimate_minutes: est, due: fit.date, refine: "done",
  };
  const why = [out.reason, fit.moved ? `Moved to ${fit.date} (${wd(fit.date)}): ${want} was already full.` : "", fit.overloaded ? `Every day before ${limit} is already over ${cap} min: the date stays at ${want} but that week is overloaded.` : ""].filter(Boolean).join(" ");
  patch.refine_note = why.slice(0, 1000);
  await api("PATCH", "/api/agent/items", patch);
  const was = [it.due !== patch.due ? `due ${it.due || "—"} → **${patch.due}**` : `due **${patch.due}**`, `~${est} min`, `priority ${["", "high", "normal", "low"][patch.priority]}`, it.section !== patch.section ? `section ${it.section} → ${patch.section}` : "", patch.critical ? "critical" : ""].filter(Boolean).join(" · ");
  await note2inbox(p, patch.title, `${was}\n\n${patch.detail}\n\n_${why}_`);
  log("refined", key, { due: patch.due, est, moved: fit.moved, cost_usd: res.cost_usd });
}

async function note2inbox(p, title, reply) {
  await api("POST", "/api/agent/messages", { project_id: p.id, text: `New checklist item on ${p.name}: ${title}`, reply, meta: { kind: "refine" } })
    .catch(() => {}); // the inbox note is a courtesy; the item itself is already updated
}
