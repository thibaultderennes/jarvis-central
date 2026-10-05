"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { sql } from "./db";
import * as D from "./data";
import { isDate, today } from "./time";
import { normBlockedBy, wouldCycle } from "./sqlbuild";
import { defaultTab, isTab, sanitizeLayout, sanitizeTab } from "./dashLayout";

const done = () => revalidatePath("/", "layout");
const ID_OK = (s: unknown) => typeof s === "string" && /^[a-z0-9][a-z0-9-]{0,60}$/.test(s);

/* ---------- checklist ---------- */
/** Set a status directly (checklist checkbox / Start / Stop, Today/Week one-click done, reopen). Todos linked to the item follow. */
export async function setItemStatus(project_id: string, id: string, status: "todo" | "doing" | "done") {
  await requireSession();
  if (!["todo", "doing", "done"].includes(status)) return;
  await D.updateItem(project_id, id, { status });
  await sql()`update todos set done = ${status === "done"}, done_at = ${status === "done" ? new Date().toISOString() : null} where project_id = ${project_id} and item_id = ${id}`;
  await D.logActivity("item_status", `/p/${project_id}`, { id, status });
  done();
}
export async function saveNote(project_id: string, id: string, note: string) {
  await requireSession();
  await D.updateItem(project_id, id, { note: note.slice(0, 5000) });
  await D.logActivity("item_note", `/p/${project_id}`, { id });
  done();
}
/** A comment on an existing item: Claude reads it on the next worker pass and adjusts the item where it asks. */
export async function commentItem(project_id: string, id: string, text: string) {
  await requireSession();
  const t = text.trim().slice(0, 2000);
  if (!t) return;
  // Comments sent before Claude got to the last one are kept together, oldest first.
  const [it] = await sql()`update items set refine_request = trim(both from concat_ws(e'\n', nullif(refine_request, ''), ${t}::text)), refine = 'pending', updated_at = now()
    where project_id = ${project_id} and id = ${id} returning id`;
  if (!it) return;
  await sql()`insert into item_events (project_id, item_id, field, old, new, actor) values (${project_id}, ${id}, 'comment', null, ${t}, 'founder')`;
  await D.logActivity("item_comment", `/p/${project_id}`, { id });
  done();
}
/** "Blocked by": item codes in the same project. Unknown codes, the item itself and loops are refused with a reason. */
export async function setBlockedBy(project_id: string, id: string, codes: string[]): Promise<{ error?: string }> {
  await requireSession();
  const want = normBlockedBy(codes);
  if (want.includes(id)) return { error: "An item can't wait on itself." };
  const items = await D.getItems({ project: project_id });
  const known = new Set(items.map((i) => i.id));
  const missing = want.filter((c) => !known.has(c));
  if (missing.length) return { error: `No item ${missing.join(", ")} in this project.` };
  if (wouldCycle(Object.fromEntries(items.map((i) => [i.id, i.blocked_by])), id, want)) return { error: "That makes a loop: one of those items already waits on this one." };
  if (!(await D.updateItem(project_id, id, { blocked_by: want }))) return { error: "That item is gone." };
  await D.logActivity("item_blocked_by", `/p/${project_id}`, { id, n: want.length });
  done();
  return {};
}
/* ---------- sprints (one project each) ---------- */
const sprintDates = (start: string, end: string) => (!isDate(start) || !isDate(end) ? "Pick a start and an end date." : end < start ? "The sprint ends before it starts." : "");
/** "Create sprint" from the checklist's selection: a dated batch of this project's items. */
export async function createSprint(project_id: string, name: string, start: string, end: string, ids: string[]): Promise<{ error?: string; id?: string }> {
  await requireSession();
  const bad = sprintDates(start, end);
  if (bad) return { error: bad };
  const nm = name.trim().slice(0, 80) || `Sprint ${start}`;
  const sprint = await D.addSprint({ project_id, name: nm, start, end });
  await D.setSprintItems(project_id, sprint.id, ids.filter(ID_OK).slice(0, 200));
  await D.logActivity("sprint_create", `/p/${project_id}`, { n: ids.length });
  done();
  return { id: sprint.id };
}
/** Add the selection to an existing sprint of the same project, or take it out (sprint null). */
export async function moveToSprint(project_id: string, sprint_id: string | null, ids: string[]): Promise<{ error?: string }> {
  await requireSession();
  if (sprint_id) { const s = await D.getSprint(sprint_id); if (!s || s.project_id !== project_id) return { error: "That sprint is gone." }; }
  await D.setSprintItems(project_id, sprint_id, ids.filter(ID_OK).slice(0, 200));
  await D.logActivity("sprint_items", `/p/${project_id}`, { n: ids.length, out: !sprint_id });
  done();
  return {};
}
export async function editSprint(id: string, p: { name?: string; start?: string; end?: string }): Promise<{ error?: string }> {
  await requireSession();
  const cur = await D.getSprint(id);
  if (!cur) return { error: "That sprint is gone." };
  const bad = sprintDates(p.start ?? cur.start, p.end ?? cur.end);
  if (bad) return { error: bad };
  await D.updateSprint(id, { name: p.name?.trim().slice(0, 80) || undefined, start: p.start, end: p.end });
  done();
  return {};
}
/** Deleting a sprint keeps its items; they only leave it. */
export async function removeSprint(id: string) {
  await requireSession();
  await D.deleteSprint(id);
  await D.logActivity("sprint_delete", null, {});
  done();
}
export async function setDue(project_id: string, id: string, due: string | null) {
  await requireSession();
  if (due && !isDate(due)) return;
  await D.updateItem(project_id, id, { due });
  await D.logActivity("item_due", `/p/${project_id}`, { id, due });
  done();
}
/** Timeline drag: one or more items (a day's cluster) to a new due date. Same logged path as setDue, so Monday reviews still see the slip. */
export async function moveItemsDue(project_id: string, ids: string[], due: string): Promise<{ error?: string }> {
  await requireSession();
  if (!isDate(due) || due < today()) return { error: "Pick today or a later day." };
  const list = ids.filter(ID_OK).slice(0, 50);
  if (!list.length) return { error: "Nothing to move." };
  for (const id of list) if (!(await D.updateItem(project_id, id, { due }))) return { error: `Item ${id} is gone.` };
  await D.logActivity("item_due", `/timeline`, { ids: list, due, via: "timeline" });
  done();
  return {};
}
/**
 * Timeline drag on a milestone: the project's deadline moves now; `prd` keeps the date PRD.md still has, and the Mac
 * worker writes the new date into that PRD.md row on its next pass (agent/milestones.mjs), so the sync doesn't revert it.
 */
export async function moveMilestone(project_id: string, label: string, from: string, to: string): Promise<{ error?: string }> {
  await requireSession();
  if (!isDate(from) || !isDate(to) || to < today()) return { error: "Pick today or a later day." };
  const p = await D.getProject(project_id);
  if (!p) return { error: "Project not found." };
  type DL = { date: string; label: string; prd?: string };
  const list = (p.deadlines || []) as DL[];
  const i = list.findIndex((d) => d.date === from && d.label === label);
  if (i < 0) return { error: "That milestone changed since the page loaded. Reload and try again." };
  const prd = list[i].prd || from;
  const deadlines = list.map((d, j) => (j !== i ? d : prd === to ? { date: to, label } : { date: to, label, prd }));
  await D.upsertProject({ id: project_id, deadlines });
  await D.logActivity("milestone_move", `/timeline`, { project_id, label, from, to });
  done();
  return {};
}
export async function newItem(project_id: string, section: string, title: string, due: string | null): Promise<{ error?: string; duplicate?: string; id?: string }> {
  await requireSession();
  const t = title.trim().slice(0, 300);
  if (!t) return { error: "Type a title first." };
  const p = await D.getProject(project_id);
  const sec = p?.sections.find((s) => s.id === section);
  let id: string;
  try {
    // Claude refines items you add by hand (steps, section, priority, estimate, a due date that doesn't clash).
    ({ id } = await D.addItem({ project_id, section, title: t, due: due && isDate(due) ? due : null, owner: sec?.owner_default || "founder", refine: process.env.JARVIS_REFINE_ITEMS === "off" ? null : "pending" }));
  } catch (e) {
    if (e instanceof D.DuplicateError) return { error: `Already on the checklist: "${e.item.title}" (${e.item.id}).`, duplicate: e.item.id };
    throw e;
  }
  await D.logActivity("item_add", `/p/${project_id}`, { section });
  done();
  return { id };
}
/** Cancel an item: it stays on the list (under "Show completed") but leaves every open count. `duplicateOf` points at the survivor. */
export async function cancelItem(project_id: string, id: string, reason: string, duplicateOf: string | null = null) {
  await requireSession();
  await D.updateItem(project_id, id, { status: "cancelled", cancel_reason: reason.trim().slice(0, 500), duplicate_of: ID_OK(duplicateOf) ? duplicateOf : null });
  await sql()`update todos set done = true, done_at = coalesce(done_at, now()) where project_id = ${project_id} and item_id = ${id} and not done`;
  await D.logActivity("item_cancel", `/p/${project_id}`, { id, duplicate: !!duplicateOf });
  done();
}
/** The note box on a decision: saving is explicit. The answer goes to Claude as a comment, so it reads it and replies. */
export async function sendNote(project_id: string, id: string, note: string): Promise<{ error?: string }> {
  await requireSession();
  const n = note.trim().slice(0, 5000);
  if (!n) return { error: "Nothing to send." };
  const [it] = await sql()`update items set note = ${n}, note_sent_at = now(),
      refine_request = trim(both from concat_ws(e'\n', nullif(refine_request, ''), ${"Decision from the owner (the note box): " + n}::text)), refine = 'pending', updated_at = now()
    where project_id = ${project_id} and id = ${id} returning id`;
  if (!it) return { error: "That item is gone." };
  await sql()`insert into item_events (project_id, item_id, field, old, new, actor) values (${project_id}, ${id}, 'note', null, ${n}, 'founder')`;
  await D.logActivity("item_note_sent", `/p/${project_id}`, { id });
  done();
  return {};
}
/* ---------- Claude builds in-progress items ---------- */
/** Approve: the Mac worker merges the PR within a minute (`gh pr merge`), then marks the item done. */
export async function approveBuild(project_id: string, id: string) {
  await requireSession();
  const [it] = await sql()`select build_status, pr_url from items where project_id = ${project_id} and id = ${id}`;
  if (!it || it.build_status !== "pr_open" || !it.pr_url) return;
  await D.updateItem(project_id, id, { build_status: "merge_requested" });
  await D.logActivity("build_approve", `/p/${project_id}`, { id });
  done();
}
/** Send back: Claude continues on the same branch and PR with this note; the item stays in progress. */
export async function sendBackBuild(project_id: string, id: string, note: string) {
  await requireSession();
  const n = note.trim().slice(0, 2000);
  const [it] = await sql()`select build_status from items where project_id = ${project_id} and id = ${id}`;
  if (!it || !["pr_open", "failed"].includes(it.build_status)) return;
  await D.updateItem(project_id, id, { build_status: "sent_back", build_note: n });
  await D.logActivity("build_send_back", `/p/${project_id}`, { id });
  done();
}
/** Retry a failed run, or stop tracking a run (the item stays in progress, unclaimed). */
export async function resetBuild(project_id: string, id: string) {
  await requireSession();
  await D.updateItem(project_id, id, { build_status: null, build_note: "" });
  done();
}

/* ---------- todos ---------- */
export async function createTodo(input: { date: string | null; title: string; time?: string | null; project_id?: string | null; item_id?: string | null; kind?: "life" | "work" }) {
  await requireSession();
  const title = input.title.trim().slice(0, 300);
  if (!title || (input.date && !isDate(input.date))) return null;
  const t = await D.addTodo({ ...input, title, time: input.time && /^\d{2}:\d{2}$/.test(input.time) ? input.time : null });
  await D.logActivity(input.item_id ? "drag_from_backlog" : "todo_add", "/today", { kind: t.kind, date: t.date });
  done();
  return t;
}
/** Move a todo to a date (or someday = null) and set its order. `order` is the full id list of the target list. */
export async function placeTodo(id: string, date: string | null, order: string[]) {
  await requireSession();
  if (date && !isDate(date)) return;
  await sql()`update todos set date = ${date} where id = ${id}`;
  const ids = order.filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 300);
  if (ids.length) await sql()`update todos t set sort = o.ord from (select unnest(${ids}::uuid[]) as id, generate_series(1, ${ids.length}) as ord) o where t.id = o.id`;
  await D.logActivity("todo_move", "/today", { date });
  done();
}
export async function toggleTodo(id: string) {
  await requireSession();
  const [t] = await sql()`update todos set done = not done, done_at = case when done then null else now() end where id = ${id} returning done, project_id, item_id`;
  // Unticking goes back to todo, never doing: doing is the go signal that queues a build on Claude's items.
  if (t?.project_id && t.item_id) await D.updateItem(t.project_id, t.item_id, { status: t.done ? "done" : "todo" });
  await D.logActivity("todo_done", "/today", { done: t?.done });
  done();
}
export async function editTodo(id: string, p: { title?: string; time?: string | null }) {
  await requireSession();
  if (p.title !== undefined && p.title.trim()) await sql()`update todos set title = ${p.title.trim().slice(0, 300)} where id = ${id}`;
  if (p.time !== undefined) await sql()`update todos set time = ${p.time && /^\d{2}:\d{2}$/.test(p.time) ? p.time : null} where id = ${id}`;
  done();
}
export async function removeTodo(id: string) {
  await requireSession();
  await sql()`delete from todos where id = ${id}`;
  done();
}

/* ---------- inbox ---------- */
export async function sendMessage(text: string, project_id: string | null, opts: { mode?: "discuss" | "build"; review_id?: string | null; review_tab?: string | null; thread_id?: string | null } = {}) {
  await requireSession();
  const t = text.trim().slice(0, 8000);
  if (!t) return;
  const mode = opts.mode === "build" ? "build" : "discuss";
  const review = opts.review_id && /^[0-9a-f-]{36}$/.test(opts.review_id) ? opts.review_id : null;
  // A reply joins its conversation: same thread, and the project of the first message unless one was picked.
  let thread = opts.thread_id && /^[0-9a-f-]{36}$/.test(opts.thread_id) ? opts.thread_id : null;
  if (thread) {
    const [root] = await sql()`select id, thread_id, project_id from messages where id = ${thread}`;
    if (!root) thread = null; else { thread = root.thread_id || root.id; project_id = project_id || root.project_id; }
  }
  await sql()`insert into messages (text, project_id, mode, review_id, thread_id, meta)
    values (${t}, ${project_id || null}, ${mode}, ${review}, ${thread}, ${JSON.stringify(opts.review_tab ? { review_tab: String(opts.review_tab).slice(0, 40) } : {})})`;
  await D.logActivity("message_sent", review ? "/review-thread" : "/inbox", { project_id, mode, review: !!review });
  done();
}
export async function archiveMessage(id: string) {
  await requireSession();
  await D.patchMessage(id, { archived: true });
  done();
}
/** Replies you have on screen move from New to Pending (called by the inbox once the page has rendered). */
export async function markOpened(ids: string[]) {
  await requireSession();
  const list = ids.filter((x) => /^[0-9a-f-]{36}$/.test(x)).slice(0, 200);
  if (!list.length) return;
  await sql()`update messages set opened_at = now() where id = any(${list}::uuid[]) and opened_at is null and status not in ('new', 'seen', 'working')`;
}
export async function markTreated(id: string, treated = true) {
  await requireSession();
  await D.patchMessage(id, { treated });
  await D.logActivity("message_treated", "/inbox", { treated });
  done();
}

/* ---------- telemetry (feeds the weekly Jarvis review) ---------- */
export async function track(kind: string, page: string, detail: Record<string, unknown> = {}) {
  await requireSession();
  await D.logActivity(kind.slice(0, 40), page.slice(0, 120), detail);
}

/* ---------- projects: top 3 and per-project settings ---------- */
const SLOTS = ["p1", "p2", "p3", "p4", "p5", "p6", "p7"];
/** Put a project in top-3 slot 1–3. A project already in the top 3 moves there; otherwise it replaces the one in that slot. */
export async function featureProject(id: string, slot: number) {
  await requireSession();
  if (![1, 2, 3].includes(slot)) return;
  const all = await D.getProjects();
  const me = all.find((p) => p.id === id);
  if (!me) return;
  const top = D.splitFeatured(all).featured.map((p) => p.id);
  const from = top.indexOf(id);
  if (from >= 0) { const other = top[slot - 1]; top[slot - 1] = id; if (other) top[from] = other; }
  else top[slot - 1] = id;
  const order = top.filter(Boolean).slice(0, 3);
  await sql()`update projects set featured_rank = null where featured_rank is not null and not (id = any(${order}))`;
  for (const [i, pid] of order.entries()) await sql()`update projects set featured_rank = ${i + 1} where id = ${pid}`;
  // A project entering the top 3 needs its own colour, distinct from the other two.
  const featured = all.filter((p) => order.includes(p.id));
  const taken = new Set(featured.filter((p) => p.id !== id).map((p) => p.color));
  if (!SLOTS.includes(me.color) || taken.has(me.color)) {
    const used = new Set(all.filter((p) => p.id !== id && SLOTS.includes(p.color)).map((p) => p.color));
    const pick = SLOTS.find((c) => !taken.has(c) && !used.has(c)) || SLOTS.find((c) => !taken.has(c))!;
    await sql()`update projects set color = ${pick} where id = ${id}`;
  }
  await D.logActivity("project_feature", "/", { id, slot });
  done();
}
export async function setProjectSettings(id: string, s: { plan_enabled?: boolean; weekly_minutes?: number | null; reviews_enabled?: boolean }) {
  await requireSession();
  const mins = s.weekly_minutes === undefined ? undefined : s.weekly_minutes === null || !Number.isFinite(s.weekly_minutes) ? null : Math.max(0, Math.min(80 * 60, Math.round(s.weekly_minutes)));
  if (s.plan_enabled !== undefined) await sql()`update projects set plan_enabled = ${!!s.plan_enabled} where id = ${id}`;
  if (mins !== undefined) await sql()`update projects set weekly_minutes = ${mins} where id = ${id}`;
  if (s.reviews_enabled !== undefined) await sql()`update projects set reviews_enabled = ${!!s.reviews_enabled} where id = ${id}`;
  await D.logActivity("project_settings", `/p/${id}`, { id, ...s });
  done();
}

/** "Plan this project": the Mac worker reviews the folder, writes a situation report and adds the missing checklist items. */
export async function requestPlanning(project_id: string) {
  await requireSession();
  const busy = await sql()`select id from messages where project_id = ${project_id} and mode = 'plan' and status in ('new', 'seen', 'working') limit 1`;
  if (busy.length) return;
  await sql()`insert into messages (text, project_id, mode) values (${"Plan this project: go through the folder, tell me where it stands, and add what needs to happen next to the checklist."}, ${project_id}, 'plan')`;
  await D.logActivity("project_plan", `/p/${project_id}`, { project_id });
  done();
}

/** Reviews → Screenings → Run: the Mac worker checks the folder against screenings/<kind>.md and adds the fixes to the checklist. */
const SCREEN_KINDS = ["vibecoded", "prelaunch", "rights"];
export async function requestScreening(project_id: string, kind: string) {
  await requireSession();
  if (!SCREEN_KINDS.includes(kind)) return;
  const busy = await sql()`select id from messages where project_id = ${project_id} and mode = 'screen' and meta->>'kind' = ${kind} and status in ('new', 'seen', 'working') limit 1`;
  if (busy.length) return;
  await D.insertMessage({ text: `Run the ${kind} screening on this project and add what to fix to the checklist.`, project_id, status: "new", mode: "screen", meta: { kind } });
  await D.logActivity("project_screening", `/p/${project_id}`, { project_id, kind });
  done();
}

/** The dashboard (Home): saves one tab's box layout after Customize. Cleaned server-side; kv `dashboard.layout`. */
export async function saveDashboardLayout(tab: string, places: unknown): Promise<{ error?: string }> {
  await requireSession();
  if (!isTab(tab)) return { error: "Unknown tab." };
  const cur = sanitizeLayout((await D.kvGet("dashboard.layout"))?.value);
  await D.kvSet("dashboard.layout", { ...cur, [tab]: sanitizeTab(tab, places) });
  await D.logActivity("dashboard_layout", "/", { tab });
  return {};
}
export async function resetDashboardTab(tab: string) {
  await requireSession();
  if (!isTab(tab)) return;
  const cur = sanitizeLayout((await D.kvGet("dashboard.layout"))?.value);
  await D.kvSet("dashboard.layout", { ...cur, [tab]: defaultTab(tab) });
  done();
}

/* ---------- finance: recurring costs ---------- */
export async function createCost(c: { project_id?: string | null; name: string; amount: number; currency?: string; period?: string; next_renewal?: string | null; notes?: string }) {
  await requireSession();
  if (!c.name.trim()) return;
  await D.addCost({ ...c, next_renewal: c.next_renewal && isDate(c.next_renewal) ? c.next_renewal : null });
  await D.logActivity("cost_add", "/finance", { project: c.project_id || null });
  done();
}
export async function editCost(id: string, p: Partial<D.Cost>) {
  await requireSession();
  if (p.next_renewal && !isDate(p.next_renewal)) p.next_renewal = null;
  await D.updateCost(id, p);
  done();
}
export async function removeCost(id: string) {
  await requireSession();
  await D.deleteCost(id);
  done();
}

/* ---------- admin ---------- */
/** "Refresh project folders": queues a scan; the Mac worker runs it (the folders are on the Mac) and reports back in kv. */
export async function requestRescan() {
  await requireSession();
  const cur = await D.kvGet<{ status?: string; requested_at?: string }>("projects.rescan");
  if (cur?.value?.status === "queued" || cur?.value?.status === "running") return;
  await D.kvSet("projects.rescan", { status: "queued", requested_at: new Date().toISOString() });
  await D.logActivity("projects_rescan", "/admin");
  done();
}
/** Folders removed or declined on the Admin page (kv `projects.ignored`): the Mac scan never registers or proposes them again. */
export type Ignored = { id: string; folder?: string; name: string; reason: "removed" | "declined"; at: string };
type Proposal = Partial<D.Project> & { id: string; name: string; folder?: string };
const getIgnored = async () => { const v = (await D.kvGet<Ignored[]>("projects.ignored"))?.value; return Array.isArray(v) ? v : []; };
const setIgnored = (list: Ignored[]) => D.kvSet("projects.ignored", list);
/** Drops one proposal from the last scan's result, so it leaves the Admin page. */
async function takeProposal(id: string): Promise<Proposal | null> {
  const cur = await D.kvGet<{ proposed?: Proposal[] }>("projects.rescan");
  const list = cur?.value?.proposed || [];
  const hit = list.find((p) => p.id === id) || null;
  if (hit) await D.kvSet("projects.rescan", { ...cur!.value, proposed: list.filter((p) => p.id !== id) });
  return hit;
}
/** Remove a project from Jarvis: archived (its checklist and history are kept) and ignored by every future scan. */
export async function removeProject(id: string) {
  await requireSession();
  const p = await D.getProject(id);
  if (!p) return;
  await D.upsertProject({ id, name: p.name, archived: true, featured_rank: null });
  const dir = p.dir ? p.dir.replace(/\/+$/, "") : "";
  const folder = dir ? dir.slice(dir.lastIndexOf("/") + 1) : undefined;
  await setIgnored([...(await getIgnored()).filter((x) => x.id !== id), { id, folder, name: p.name, reason: "removed", at: new Date().toISOString() }]);
  await D.logActivity("project_remove", "/admin", { project: id });
  done();
}
/** Undo a remove or a decline: the folder is scanned again. A removed project comes back as it was; a declined one is proposed on the next refresh. */
export async function restoreProject(id: string) {
  await requireSession();
  const list = await getIgnored();
  const hit = list.find((x) => x.id === id);
  await setIgnored(list.filter((x) => x.id !== id));
  const p = await D.getProject(id);
  if (p && hit?.reason === "removed") await D.upsertProject({ id, name: p.name, archived: false });
  await D.logActivity("project_restore", "/admin", { project: id });
  done();
}
/** A new folder found by "Refresh project folders" joins the dashboard only when the owner approves it. */
export async function approveProject(id: string) {
  await requireSession();
  const p = await takeProposal(id);
  if (!p) return;
  const { folder: _folder, ...project } = p;
  await D.upsertProject({ ...project, archived: false });
  await D.logActivity("project_approve", "/admin", { project: id });
  done();
}
export async function declineProject(id: string) {
  await requireSession();
  const p = await takeProposal(id);
  if (!p) return;
  await setIgnored([...(await getIgnored()).filter((x) => x.id !== id), { id, folder: p.folder, name: p.name, reason: "declined", at: new Date().toISOString() }]);
  await D.logActivity("project_decline", "/admin", { project: id });
  done();
}
export type Prefs = { show_done_default?: boolean; finance_currency?: string };
export async function savePrefs(p: Prefs) {
  await requireSession();
  const cur = (await D.kvGet<Prefs>("prefs"))?.value || {};
  const next: Prefs = { ...cur };
  if (p.show_done_default !== undefined) next.show_done_default = !!p.show_done_default;
  if (p.finance_currency !== undefined) next.finance_currency = String(p.finance_currency).toUpperCase().slice(0, 3);
  await D.kvSet("prefs", next);
  done();
}
