"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "./auth";
import { sql } from "./db";
import * as D from "./data";
import { isDate } from "./time";

const done = () => revalidatePath("/", "layout");
const NEXT = { todo: "doing", doing: "done", done: "todo" } as const;

/* ---------- checklist ---------- */
export async function cycleItem(project_id: string, id: string) {
  await requireSession();
  const [it] = await sql()`select status from items where project_id = ${project_id} and id = ${id}`;
  if (!it) return;
  const status = NEXT[it.status as keyof typeof NEXT];
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
export async function setDue(project_id: string, id: string, due: string | null) {
  await requireSession();
  if (due && !isDate(due)) return;
  await D.updateItem(project_id, id, { due });
  await D.logActivity("item_due", `/p/${project_id}`, { id, due });
  done();
}
export async function newItem(project_id: string, section: string, title: string, due: string | null) {
  await requireSession();
  const t = title.trim().slice(0, 300);
  if (!t) return;
  const p = await D.getProject(project_id);
  const sec = p?.sections.find((s) => s.id === section);
  // Claude refines items you add by hand (steps, section, priority, estimate, a due date that doesn't clash).
  await D.addItem({ project_id, section, title: t, due: due && isDate(due) ? due : null, owner: sec?.owner_default || "founder", refine: process.env.JARVIS_REFINE_ITEMS === "off" ? null : "pending" });
  await D.logActivity("item_add", `/p/${project_id}`, { section });
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
  if (t?.project_id && t.item_id) await D.updateItem(t.project_id, t.item_id, { status: t.done ? "done" : "doing" });
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
