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
  await D.addItem({ project_id, section, title: t, due: due && isDate(due) ? due : null, owner: sec?.owner_default || "founder" });
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
export async function sendMessage(text: string, project_id: string | null, opts: { mode?: "discuss" | "build"; review_id?: string | null; review_tab?: string | null } = {}) {
  await requireSession();
  const t = text.trim().slice(0, 8000);
  if (!t) return;
  const mode = opts.mode === "build" ? "build" : "discuss";
  const review = opts.review_id && /^[0-9a-f-]{36}$/.test(opts.review_id) ? opts.review_id : null;
  await sql()`insert into messages (text, project_id, mode, review_id, meta)
    values (${t}, ${project_id || null}, ${mode}, ${review}, ${JSON.stringify(opts.review_tab ? { review_tab: String(opts.review_tab).slice(0, 40) } : {})})`;
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
