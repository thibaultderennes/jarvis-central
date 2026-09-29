import { q, sql } from "./db";
import { addDays, mondayOf, today, TZ } from "./time";

export type Section = { id: string; name: string; note?: string; notes?: boolean; owner_default?: string };
export type Project = {
  id: string; name: string; kind: "checklist" | "running"; color: string; tagline: string;
  state: string; status: string; dir: string; sections: Section[];
  deadlines: { date: string; label: string }[]; links: { label: string; url: string }[];
  sort: number; archived: boolean; updated_at: string;
  featured_rank: number | null; plan_enabled: boolean; weekly_minutes: number | null; reviews_enabled: boolean;
};
export type Item = {
  project_id: string; id: string; section: string; title: string; detail: string;
  status: "todo" | "doing" | "done"; due: string | null; owner: string | null; critical: boolean;
  sort: number; note: string; created_at: string; updated_at: string; done_at: string | null;
};
export type Todo = {
  id: string; date: string | null; title: string; kind: "life" | "work"; project_id: string | null;
  item_id: string | null; time: string | null; sort: number; done: boolean; done_at: string | null; created_at: string;
};
export type Message = {
  id: string; project_id: string | null; review_id: string | null; mode: "auto" | "discuss" | "build"; text: string; status: string; reply: string;
  meta: Record<string, unknown>; archived: boolean; created_at: string; updated_at: string; replied_at: string | null;
};
export type Review = {
  id: string; type: "project" | "recap" | "coaching" | "jarvis" | "doc"; project_id: string | null;
  week_start: string | null; title: string; verdict: string | null; headline: string; body_md: string;
  meta: Record<string, unknown>; created_at: string;
};

// Postgres `date` comes back as a Date or string depending on driver settings; normalise to YYYY-MM-DD.
const d10 = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ts = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const normItem = (r: Record<string, unknown>) => ({ ...r, due: d10(r.due), created_at: ts(r.created_at), updated_at: ts(r.updated_at), done_at: ts(r.done_at) }) as Item;
const normTodo = (r: Record<string, unknown>) => ({ ...r, date: d10(r.date), done_at: ts(r.done_at), created_at: ts(r.created_at) }) as Todo;
const normMsg = (r: Record<string, unknown>) => ({ ...r, created_at: ts(r.created_at), updated_at: ts(r.updated_at), replied_at: ts(r.replied_at) }) as Message;
const normReview = (r: Record<string, unknown>) => ({ ...r, week_start: d10(r.week_start), created_at: ts(r.created_at) }) as Review;
const normProject = (r: Record<string, unknown>) => ({ ...r, updated_at: ts(r.updated_at) }) as Project;

/* ---------- projects ---------- */
export async function getProjects(includeArchived = false): Promise<Project[]> {
  const rows = await q(`select * from projects ${includeArchived ? "" : "where not archived"} order by sort, name`);
  return rows.map(normProject);
}
export async function getProject(id: string): Promise<Project | null> {
  const rows = await sql()`select * from projects where id = ${id}`;
  return rows[0] ? normProject(rows[0]) : null;
}
const PROJECT_FIELDS = ["name", "kind", "color", "tagline", "state", "status", "dir", "sections", "deadlines", "links", "sort", "archived", "featured_rank", "plan_enabled", "weekly_minutes", "reviews_enabled"] as const;
export async function upsertProject(p: Partial<Project> & { id: string }): Promise<Project> {
  const cols = PROJECT_FIELDS.filter((k) => p[k] !== undefined);
  const vals = cols.map((k) => (["sections", "deadlines", "links"].includes(k) ? JSON.stringify(p[k]) : p[k]));
  const insertCols = ["id", ...cols].join(", ");
  const ph = ["$1", ...cols.map((_, i) => `$${i + 2}`)].join(", ");
  const upd = cols.map((k, i) => `${k} = $${i + 2}`).concat("updated_at = now()").join(", ");
  const rows = await q(
    `insert into projects (${insertCols}) values (${ph}) on conflict (id) do update set ${upd} returning *`,
    [p.id, ...vals],
  );
  return normProject(rows[0]);
}

/** The top 3 shown in the nav and as full cards: explicit `featured_rank` 1–3, else the first 3 checklist projects. */
export function splitFeatured(projects: Project[]): { featured: Project[]; others: Project[] } {
  const ranked = projects.filter((p) => p.featured_rank && p.featured_rank >= 1 && p.featured_rank <= 3).sort((a, b) => a.featured_rank! - b.featured_rank!);
  const featured = ranked.length ? ranked.slice(0, 3) : projects.filter((p) => p.kind === "checklist").slice(0, 3);
  const ids = new Set(featured.map((p) => p.id));
  return { featured, others: projects.filter((p) => !ids.has(p.id)) };
}
/** Colour for charts and lists: top-3 projects keep their slot, the rest share "other". */
export const displayColor = (p: Project, featuredIds: Set<string>) => (featuredIds.has(p.id) ? p.color : "other");

/* ---------- items ---------- */
export async function getItems(opts: { project?: string; open?: boolean } = {}): Promise<Item[]> {
  const where: string[] = [], params: unknown[] = [];
  if (opts.project) { params.push(opts.project); where.push(`project_id = $${params.length}`); }
  if (opts.open) where.push(`status <> 'done'`);
  const rows = await q(`select * from items ${where.length ? "where " + where.join(" and ") : ""} order by project_id, sort, created_at`, params);
  return rows.map(normItem);
}
export function slugify(s: string, max = 4): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").split("-").filter(Boolean).slice(0, max).join("-") || "item";
}
export async function addItem(i: { project_id: string; section: string; title: string; id?: string; detail?: string; due?: string | null; owner?: string | null; critical?: boolean }, actor = "founder"): Promise<Item> {
  const [m] = await sql()`select coalesce(max(sort), 0) + 1 as s from items where project_id = ${i.project_id} and section = ${i.section}`;
  let id = i.id || slugify(i.title);
  const taken = await sql()`select id from items where project_id = ${i.project_id} and (id = ${id} or id like ${id + "-%"})`;
  if (taken.some((r) => r.id === id)) id = `${id}-${taken.length + 1}`;
  const rows = await sql()`insert into items (project_id, id, section, title, detail, due, owner, critical, sort)
    values (${i.project_id}, ${id}, ${i.section}, ${i.title}, ${i.detail || ""}, ${i.due || null}, ${i.owner || null}, ${!!i.critical}, ${m.s})
    returning *`;
  await sql()`insert into item_events (project_id, item_id, field, old, new, actor) values (${i.project_id}, ${id}, 'created', null, ${i.section}, ${actor})`;
  return normItem(rows[0]);
}
const ITEM_FIELDS = ["section", "title", "detail", "status", "due", "owner", "critical", "sort", "note"] as const;
const LOGGED = new Set(["status", "due", "section", "owner", "title"]);
export async function updateItem(project_id: string, id: string, patch: Partial<Item>, actor = "founder"): Promise<Item | null> {
  const [cur] = (await sql()`select * from items where project_id = ${project_id} and id = ${id}`).map(normItem);
  if (!cur) return null;
  const cols = ITEM_FIELDS.filter((k) => patch[k] !== undefined && patch[k] !== cur[k]);
  if (!cols.length) return cur;
  const params: unknown[] = [project_id, id];
  const sets = cols.map((k) => { params.push(k === "due" ? patch.due || null : patch[k]); return `${k} = $${params.length}`; });
  sets.push("updated_at = now()");
  if (patch.status && patch.status !== cur.status) sets.push(patch.status === "done" ? "done_at = now()" : "done_at = null");
  const rows = await q(`update items set ${sets.join(", ")} where project_id = $1 and id = $2 returning *`, params);
  for (const k of cols) if (LOGGED.has(k)) {
    await sql()`insert into item_events (project_id, item_id, field, old, new, actor)
      values (${project_id}, ${id}, ${k}, ${cur[k] == null ? null : String(cur[k])}, ${patch[k] == null ? null : String(patch[k])}, ${actor})`;
  }
  return normItem(rows[0]);
}
export async function deleteItem(project_id: string, id: string) {
  await sql()`delete from items where project_id = ${project_id} and id = ${id}`;
  await sql()`insert into item_events (project_id, item_id, field, old, new, actor) values (${project_id}, ${id}, 'deleted', null, null, 'agent')`;
}
export async function getEvents(since: string) {
  return sql()`select * from item_events where at >= ${since} order by at`;
}

/* ---------- todos ---------- */
export async function getTodos(from: string | null, to: string | null, includeSomeday = false): Promise<Todo[]> {
  const rows = includeSomeday
    ? await sql()`select * from todos where (date between ${from} and ${to}) or date is null order by date nulls last, sort, created_at`
    : await sql()`select * from todos where date between ${from} and ${to} order by date, sort, created_at`;
  return rows.map(normTodo);
}
export async function addTodo(t: { date: string | null; title: string; kind?: string; project_id?: string | null; item_id?: string | null; time?: string | null }): Promise<Todo> {
  const [m] = t.date
    ? await sql()`select coalesce(max(sort), 0) + 1 as s from todos where date = ${t.date}`
    : await sql()`select coalesce(max(sort), 0) + 1 as s from todos where date is null`;
  const kind = t.kind === "work" || t.project_id ? "work" : "life";
  const rows = await sql()`insert into todos (date, title, kind, project_id, item_id, time, sort)
    values (${t.date}, ${t.title}, ${kind}, ${t.project_id || null}, ${t.item_id || null}, ${t.time || null}, ${m.s}) returning *`;
  return normTodo(rows[0]);
}

/* ---------- messages ---------- */
export async function getMessages(opts: { status?: string; limit?: number; since?: string; includeArchived?: boolean; review?: string } = {}): Promise<Message[]> {
  const lim = Math.min(opts.limit || 50, 200);
  let rows;
  if (opts.review) rows = await sql()`select * from messages where review_id = ${opts.review} order by created_at limit ${lim}`;
  else if (opts.status) rows = await sql()`select * from messages where status = ${opts.status} and not archived order by created_at limit ${lim}`;
  else if (opts.since) rows = await sql()`select * from messages where created_at >= ${opts.since} order by created_at limit ${lim}`;
  else rows = opts.includeArchived
    ? await sql()`select * from messages order by created_at desc limit ${lim}`
    : await sql()`select * from messages where not archived order by created_at desc limit ${lim}`;
  return rows.map(normMsg);
}
export async function patchMessage(id: string, p: { status?: string; reply?: string; meta?: Record<string, unknown>; archived?: boolean }): Promise<Message | null> {
  const rows = await sql()`update messages set
      status = coalesce(${p.status ?? null}, status),
      reply = coalesce(${p.reply ?? null}, reply),
      replied_at = case when ${p.reply ?? null}::text is not null then now() else replied_at end,
      meta = meta || ${JSON.stringify(p.meta || {})}::jsonb,
      archived = coalesce(${p.archived ?? null}, archived),
      updated_at = now()
    where id = ${id} returning *`;
  return rows[0] ? normMsg(rows[0]) : null;
}

/* ---------- reviews ---------- */
export async function getReviews(opts: { type?: string; project?: string; limit?: number; week?: string } = {}): Promise<Review[]> {
  const where: string[] = [], params: unknown[] = [];
  if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
  if (opts.project) { params.push(opts.project); where.push(`project_id = $${params.length}`); }
  if (opts.week) { params.push(opts.week); where.push(`week_start = $${params.length}`); }
  params.push(Math.min(opts.limit || 50, 500));
  const rows = await q(`select * from reviews ${where.length ? "where " + where.join(" and ") : ""} order by week_start desc nulls last, created_at desc limit $${params.length}`, params);
  return rows.map(normReview);
}
export async function getReview(id: string): Promise<Review | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const rows = await sql()`select * from reviews where id = ${id}`;
  return rows[0] ? normReview(rows[0]) : null;
}
export async function upsertReview(r: Partial<Review> & { type: Review["type"]; title: string; body_md: string }): Promise<Review> {
  const meta = JSON.stringify(r.meta || {});
  if (r.type !== "doc" && r.week_start) {
    const rows = await sql()`insert into reviews (type, project_id, week_start, title, verdict, headline, body_md, meta)
      values (${r.type}, ${r.project_id || null}, ${r.week_start}, ${r.title}, ${r.verdict || null}, ${r.headline || ""}, ${r.body_md}, ${meta})
      on conflict (type, coalesce(project_id, ''), week_start) where type <> 'doc'
      do update set title = excluded.title, verdict = excluded.verdict, headline = excluded.headline,
        body_md = excluded.body_md, meta = excluded.meta, created_at = now()
      returning *`;
    return normReview(rows[0]);
  }
  if (r.id) {
    const rows = await sql()`update reviews set title = ${r.title}, headline = ${r.headline || ""}, body_md = ${r.body_md}, meta = ${meta}, project_id = ${r.project_id || null}
      where id = ${r.id} returning *`;
    if (rows[0]) return normReview(rows[0]);
  }
  const rows = await sql()`insert into reviews (type, project_id, week_start, title, verdict, headline, body_md, meta)
    values (${r.type}, ${r.project_id || null}, ${r.week_start || null}, ${r.title}, ${r.verdict || null}, ${r.headline || ""}, ${r.body_md}, ${meta}) returning *`;
  return normReview(rows[0]);
}

/* ---------- kv / activity ---------- */
export async function kvGet<T = unknown>(key: string): Promise<{ value: T; updated_at: string } | null> {
  const rows = await sql()`select value, updated_at from kv where key = ${key}`;
  return rows[0] ? { value: rows[0].value as T, updated_at: ts(rows[0].updated_at)! } : null;
}
export async function kvSet(key: string, value: unknown) {
  await sql()`insert into kv (key, value) values (${key}, ${JSON.stringify(value)}) on conflict (key) do update set value = excluded.value, updated_at = now()`;
}
export async function logActivity(kind: string, page: string | null, detail: Record<string, unknown> = {}) {
  try { await sql()`insert into activity (kind, page, detail) values (${kind}, ${page}, ${JSON.stringify(detail)})`; } catch { /* never block a user action on telemetry */ }
}
export async function getActivity(since: string) {
  const rows = await sql()`select at, kind, page, detail from activity where at >= ${since} order by at limit 5000`;
  return rows.map((r) => ({ ...r, at: ts(r.at) }));
}

/* ---------- chart data ---------- */
/** Items finished per week (Mon start) and project, last `weeks` weeks including the current one. */
export async function doneByWeek(weeks = 8) {
  const start = addDays(mondayOf(today()), -7 * (weeks - 1));
  const rows = await sql()`select project_id, date_trunc('week', done_at at time zone ${TZ})::date as wk, count(*)::int as n
    from items where done_at is not null and done_at >= ${start}::date group by 1, 2`;
  return { start, rows: rows.map((r) => ({ project_id: r.project_id as string, week: d10(r.wk)!, n: r.n as number })) };
}
/** Open items by due week, next `weeks` weeks (overdue folded into the first week). */
export async function openByDueWeek(weeks = 6) {
  const start = mondayOf(today()), end = addDays(start, 7 * weeks - 1);
  const rows = await sql()`select project_id, greatest(due, ${start}::date) as d from items where status <> 'done' and due is not null and due <= ${end}`;
  return { start, rows: rows.map((r) => ({ project_id: r.project_id as string, week: mondayOf(d10(r.d)!) })) };
}
/** Todos per day for the last `days` days: planned vs done, split life/work. */
export async function todoDays(days = 14) {
  const from = addDays(today(), -(days - 1));
  const rows = await sql()`select date, kind, count(*)::int as planned, count(*) filter (where done)::int as done
    from todos where date between ${from} and ${today()} group by 1, 2`;
  return { from, rows: rows.map((r) => ({ date: d10(r.date)!, kind: r.kind as string, planned: r.planned as number, done: r.done as number })) };
}

/* ---------- insights (Overview) ---------- */
export type Insight = {
  id: string; name: string; color: string;
  days: string[]; scope: number[]; done: number[];            // burn-up, one point per day
  ratePerWeek: number; openNow: number; projected: string | null; // pace + projected finish of the whole list
  deadline: { date: string; label: string } | null; dueByDeadline: number; neededPerWeek: number;
  slips7: number; owners: { you: number; claude: number; both: number };
};
export async function insights(): Promise<{ projects: Insight[]; heat: { date: string; done: number; todos: number; msgs: number }[] }> {
  const { isoInTZ, today: tdy, addDays: add, daysBetween } = await import("./time");
  const t = tdy(), from = add(t, -27);
  const day = (v: string | null) => (v ? isoInTZ(new Date(v)) : null);
  const [projects, items, ev, td, ms] = await Promise.all([
    getProjects(), getItems(),
    sql()`select project_id, field, old, new, at from item_events where at >= ${from}::date - 1`,
    sql()`select done_at from todos where done and done_at >= ${from}::date - 1`,
    sql()`select created_at from messages where created_at >= ${from}::date - 1`,
  ]);
  const out: Insight[] = [];
  for (const p of splitFeatured(projects).featured) {
    const its = items.filter((i) => i.project_id === p.id);
    const created = its.map((i) => day(i.created_at)!).sort();
    const start = created[0] && created[0] > from ? created[0] : from;
    const days: string[] = []; for (let d = start; d <= t; d = add(d, 1)) days.push(d);
    const scope = days.map((d) => its.filter((i) => day(i.created_at)! <= d).length);
    const done = days.map((d) => its.filter((i) => i.status === "done" && i.done_at && day(i.done_at)! <= d).length);
    const windowDays = Math.max(7, days.length);
    const recent = its.filter((i) => i.status === "done" && i.done_at && day(i.done_at)! > add(t, -windowDays)).length;
    const ratePerDay = recent / windowDays, openNow = its.filter((i) => i.status !== "done").length;
    const projected = ratePerDay > 0 ? add(t, Math.ceil(openNow / ratePerDay)) : null;
    const deadline = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
    const dueByDeadline = deadline ? its.filter((i) => i.status !== "done" && i.due && i.due <= deadline.date).length : 0;
    const neededPerWeek = deadline ? dueByDeadline / Math.max(1, daysBetween(t, deadline.date)) * 7 : 0;
    const slips7 = ev.filter((e) => e.project_id === p.id && e.field === "due" && e.old && e.new && String(e.new) > String(e.old) && day(String(e.at instanceof Date ? e.at.toISOString() : e.at))! > add(t, -7)).length;
    const open = its.filter((i) => i.status !== "done");
    const owners = { you: open.filter((i) => !i.owner || i.owner === "founder").length, claude: open.filter((i) => i.owner === "claude").length, both: open.filter((i) => i.owner === "both").length };
    out.push({ id: p.id, name: p.name, color: p.color, days, scope, done, ratePerWeek: ratePerDay * 7, openNow, projected, deadline, dueByDeadline, neededPerWeek, slips7, owners });
  }
  const iso = (v: unknown) => day(v instanceof Date ? v.toISOString() : String(v));
  const heat = Array.from({ length: 28 }, (_, i) => add(from, i)).map((d) => ({
    date: d,
    done: ev.filter((e) => e.field === "status" && e.new === "done" && iso(e.at) === d).length,
    todos: td.filter((x) => iso(x.done_at) === d).length,
    msgs: ms.filter((x) => iso(x.created_at) === d).length,
  }));
  return { projects: out, heat };
}
