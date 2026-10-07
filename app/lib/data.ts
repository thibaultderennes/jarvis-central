import { q, sql } from "./db";
import { addDays, mondayOf, today, TZ } from "./time";
import { itemUpdate, projectUpsert } from "./sqlbuild";
import type { BuildMode } from "./projectSettings";
import { pushPlan } from "./docsHub";

export type Section = { id: string; name: string; note?: string; notes?: boolean; owner_default?: string };
export type Project = {
  id: string; name: string; kind: "checklist" | "running"; color: string; tagline: string;
  state: string; status: string; dir: string; sections: Section[];
  deadlines: { date: string; label: string }[]; links: { label: string; url: string }[];
  sort: number; archived: boolean; updated_at: string;
  featured_rank: number | null; plan_enabled: boolean; weekly_minutes: number | null; reviews_enabled: boolean;
  /** Days between advisor reviews (7 = the Monday run); undefined until the 0.7.4 migration ran. */
  review_every_days?: number;
  /** How Jarvis builds this project; null = the worker's default (worker.build_mode). */
  build_mode?: BuildMode | null;
  /** Detected by agent/website.mjs on projects sync; null until the first sync after 0.8.0. */
  site?: SiteInfo | null; site_url?: string;
};
export type SiteInfo = { code: { framework: string; path: string } | null; url: string | null; source: string | null; live: boolean; deploy: string | null; checked_at: string };
export type ItemStatus = "todo" | "doing" | "done" | "cancelled";
export type BuildStatus = "working" | "pr_open" | "merge_requested" | "merged" | "failed" | "sent_back";
export type Item = {
  project_id: string; id: string; section: string; title: string; detail: string;
  status: ItemStatus; due: string | null; owner: string | null; critical: boolean;
  sort: number; note: string; created_at: string; updated_at: string; done_at: string | null;
  estimate_minutes: number | null; priority: number | null; refine: string | null; refine_note: string; refine_request: string;
  cancel_reason: string; duplicate_of: string | null; note_sent_at: string | null;
  blocked_by: string[]; // codes of items in the same project this one waits on (open ones show a "blocked" badge)
  sprint_id: string | null; // the sprint (same project) it is planned in
  build_status: BuildStatus | null; build_note: string; pr_url: string | null; build_updated_at: string | null;
};
/** A dated batch of one project's items. `start`/`end` are inclusive YYYY-MM-DD. */
export type Sprint = { id: string; project_id: string; name: string; start: string; end: string; created_at: string };
/** Open = still to be worked on. Done and cancelled items are closed: out of every count, deadline and load. */
export const isOpen = (i: { status: string }) => i.status === "todo" || i.status === "doing";
export const isClosed = (i: { status: string }) => !isOpen(i);
export type Cost = {
  id: string; project_id: string | null; name: string; amount: number; currency: string; period: "week" | "month" | "year";
  next_renewal: string | null; notes: string; active: boolean; created_at: string; updated_at: string;
};
export type Todo = {
  id: string; date: string | null; title: string; kind: "life" | "work"; project_id: string | null;
  item_id: string | null; time: string | null; sort: number; done: boolean; done_at: string | null; created_at: string;
  /** 'plan' = made by the Sunday planner, 'rollover' = added by the daily roll-forward, null = by hand. */
  source?: string | null; rollovers?: number; rolled_from?: string | null; rolled_at?: string | null;
};
export type Message = {
  id: string; project_id: string | null; review_id: string | null; thread_id: string | null; item_id: string | null; mode: "auto" | "discuss" | "build" | "plan" | "screen" | "website" | "review" | "setup"; text: string; status: string; reply: string;
  meta: Record<string, unknown>; archived: boolean; created_at: string; updated_at: string; replied_at: string | null; opened_at: string | null; treated_at: string | null;
};
export type Review = {
  id: string; type: "project" | "recap" | "coaching" | "jarvis" | "doc" | "security" | "screening"; project_id: string | null;
  week_start: string | null; title: string; verdict: string | null; headline: string; body_md: string;
  meta: Record<string, unknown>; created_at: string;
  /** When the owner marked it as read on Docs and reviews; null = new. Undefined until the 0.7.4.6 migration ran. */
  acked_at?: string | null;
  /** Proposed tasks pushed to the checklist: {proposal key: item code} (lib/docsHub.ts). */
  pushed?: Record<string, string>;
};

// Postgres `date` comes back as a Date or string depending on driver settings; normalise to YYYY-MM-DD.
const d10 = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const ts = (v: unknown): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
const normItem = (r: Record<string, unknown>) => ({ ...r, blocked_by: Array.isArray(r.blocked_by) ? r.blocked_by : [], due: d10(r.due), created_at: ts(r.created_at), updated_at: ts(r.updated_at), done_at: ts(r.done_at), note_sent_at: ts(r.note_sent_at), build_updated_at: ts(r.build_updated_at) }) as Item;
const normSprint = (r: Record<string, unknown>) => ({ id: r.id, project_id: r.project_id, name: r.name, start: d10(r.start_date), end: d10(r.end_date), created_at: ts(r.created_at) }) as Sprint;
const normCost = (r: Record<string, unknown>) => ({ ...r, amount: Number(r.amount), next_renewal: d10(r.next_renewal), created_at: ts(r.created_at), updated_at: ts(r.updated_at) }) as Cost;
const normTodo = (r: Record<string, unknown>) => ({ ...r, date: d10(r.date), done_at: ts(r.done_at), created_at: ts(r.created_at), rollovers: Number(r.rollovers) || 0, rolled_from: d10(r.rolled_from), rolled_at: d10(r.rolled_at) }) as Todo;
const normMsg = (r: Record<string, unknown>) => ({ ...r, created_at: ts(r.created_at), updated_at: ts(r.updated_at), replied_at: ts(r.replied_at), opened_at: ts(r.opened_at), treated_at: ts(r.treated_at) }) as Message;
const normReview = (r: Record<string, unknown>) => ({ ...r, week_start: d10(r.week_start), created_at: ts(r.created_at), acked_at: ts(r.acked_at), pushed: r.pushed && typeof r.pushed === "object" ? r.pushed : {} }) as Review;
/** Reviews mirrored from files (security audits) sort by the date in the file name, then by when the site saw them. */
export const newestFileFirst = (a: Review, b: Review) => String(b.meta?.date || "").localeCompare(String(a.meta?.date || "")) || b.created_at.localeCompare(a.created_at);
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
export async function upsertProject(p: Partial<Project> & { id: string }): Promise<Project> {
  const { text, params } = projectUpsert(p);
  const rows = await q(text, params);
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
/** Items. Without `project`, items of archived (removed or gone) projects are left out unless `includeArchived`. */
export async function getItems(opts: { project?: string; open?: boolean; refine?: string; build?: string; includeArchived?: boolean } = {}): Promise<Item[]> {
  const where: string[] = [], params: unknown[] = [];
  if (!opts.project && !opts.includeArchived) where.push(`project_id not in (select id from projects where archived)`);
  if (opts.refine) { params.push(opts.refine); where.push(`refine = $${params.length}`); }
  if (opts.project) { params.push(opts.project); where.push(`project_id = $${params.length}`); }
  if (opts.open) where.push(`status in ('todo', 'doing')`);
  // build=queue: in-progress items owned by Claude that no build run has claimed yet; build=<status>: runs in that state.
  if (opts.build === "queue") where.push(`status = 'doing' and coalesce(owner, 'founder') in ('claude', 'both') and build_status is null`);
  else if (opts.build) { params.push(opts.build); where.push(`build_status = $${params.length}`); }
  const rows = await q(`select * from items ${where.length ? "where " + where.join(" and ") : ""} order by project_id, sort, created_at`, params);
  return rows.map(normItem);
}
/** Open and late (open, due before `day`) items per project, in one query: the sidebar's counts. */
/** Open items per project: total, late (due before `day`) and soon (due from `day` through 7 days later). */
export async function openCounts(day: string): Promise<Record<string, { open: number; late: number; soon: number }>> {
  const rows = await sql()`select project_id, count(*)::int as open, count(*) filter (where due < ${day}::date)::int as late,
      count(*) filter (where due >= ${day}::date and due <= ${day}::date + 7)::int as soon
    from items where status in ('todo', 'doing') and project_id not in (select id from projects where archived) group by 1`;
  return Object.fromEntries(rows.map((r) => [r.project_id as string, { open: r.open as number, late: r.late as number, soon: r.soon as number }]));
}
export function slugify(s: string, max = 4): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "").split("-").filter(Boolean).slice(0, max).join("-") || "item";
}
/** Title comparison for the duplicate check: lower-case words, punctuation and filler words dropped. */
const STOP = new Set(["a", "an", "the", "to", "of", "for", "and", "or", "in", "on", "with", "it", "its", "is", "be", "this", "that", "my", "our", "your"]);
export const normTitle = (t: string) => t.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter((w) => w && !STOP.has(w)).join(" ");
const words = (t: string) => new Set(normTitle(t).split(" ").filter(Boolean));
/** Items in the project with the same normalised title (exact) or most of the same words (near). Cancelled ones don't count. */
export async function findDuplicates(project_id: string, title: string, exceptId?: string): Promise<{ exact: Item | null; near: Item | null }> {
  const mine = (await getItems({ project: project_id })).filter((x) => x.status !== "cancelled" && x.id !== exceptId);
  const key = normTitle(title), w = words(title);
  const exact = mine.find((x) => normTitle(x.title) === key) || null;
  let near: Item | null = null, best = 0;
  if (w.size >= 3) for (const x of mine) {
    const xw = words(x.title); if (xw.size < 3) continue;
    let common = 0; for (const t of w) if (xw.has(t)) common++;
    const j = common / (w.size + xw.size - common);
    if (j >= 0.7 && j > best) { best = j; near = x; }
  }
  return { exact, near: exact ? null : near };
}
export class DuplicateError extends Error { constructor(public item: Item) { super(`Already on the checklist as "${item.id}"`); } }
export async function addItem(i: { project_id: string; section: string; title: string; id?: string; detail?: string; due?: string | null; owner?: string | null; critical?: boolean; refine?: string | null; estimate_minutes?: number | null; priority?: number | null; refine_note?: string; allow_duplicate?: boolean }, actor = "founder"): Promise<Item> {
  // Every create path is checked: an exact match is refused, a near match is created but flagged for the owner.
  const dup = i.allow_duplicate ? { exact: null, near: null } : await findDuplicates(i.project_id, i.title);
  if (dup.exact) throw new DuplicateError(dup.exact);
  if (dup.near && i.refine !== "pending") { i.refine = "flagged"; i.refine_note = `Looks like it overlaps \`${dup.near.id}\` ("${dup.near.title}"). Merge them, or cancel one as a duplicate.`; }
  const [m] = await sql()`select coalesce(max(sort), 0) + 1 as s from items where project_id = ${i.project_id} and section = ${i.section}`;
  let id = i.id || slugify(i.title);
  const taken = await sql()`select id from items where project_id = ${i.project_id} and (id = ${id} or id like ${id + "-%"})`;
  const ids = new Set(taken.map((r) => r.id as string));
  for (let n = 2, base = id; ids.has(id); n++) id = `${base}-${n}`; // never reuse an existing item id
  const rows = await sql()`insert into items (project_id, id, section, title, detail, due, owner, critical, sort, refine, estimate_minutes, priority, refine_note)
    values (${i.project_id}, ${id}, ${i.section}, ${i.title}, ${i.detail || ""}, ${i.due || null}, ${i.owner || null}, ${!!i.critical}, ${m.s}, ${i.refine || null},
            ${i.estimate_minutes ?? null}, ${i.priority ?? null}, ${i.refine_note || ""})
    returning *`;
  await sql()`insert into item_events (project_id, item_id, field, old, new, actor) values (${i.project_id}, ${id}, 'created', null, ${i.section}, ${actor})`;
  return normItem(rows[0]);
}
const LOGGED = new Set(["status", "due", "section", "owner", "title", "priority", "estimate_minutes", "critical", "build_status", "pr_url", "blocked_by"]);
export async function updateItem(project_id: string, id: string, patch: Partial<Item>, actor = "founder"): Promise<Item | null> {
  const [cur] = (await sql()`select * from items where project_id = ${project_id} and id = ${id}`).map(normItem);
  if (!cur) return null;
  const u = itemUpdate(cur as unknown as Record<string, unknown>, patch as Record<string, unknown>);
  if (!u) return cur;
  const rows = await q(u.text, u.params);
  const str = (v: unknown) => (v == null ? null : Array.isArray(v) ? v.join(",") : String(v));
  for (const k of u.cols) if (LOGGED.has(k)) {
    await sql()`insert into item_events (project_id, item_id, field, old, new, actor)
      values (${project_id}, ${id}, ${k}, ${str(cur[k])}, ${str(u.values[k])}, ${actor})`;
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

/* ---------- sprints ---------- */
/** Sprints of one project (or all), optionally only those overlapping [from, to]. */
export async function getSprints(opts: { project?: string; from?: string; to?: string } = {}): Promise<Sprint[]> {
  const where: string[] = [], params: unknown[] = [];
  if (opts.project) { params.push(opts.project); where.push(`project_id = $${params.length}`); }
  if (opts.to) { params.push(opts.to); where.push(`start_date <= $${params.length}`); }
  if (opts.from) { params.push(opts.from); where.push(`end_date >= $${params.length}`); }
  const rows = await q(`select * from sprints ${where.length ? `where ${where.join(" and ")}` : ""} order by start_date, created_at`, params);
  return rows.map(normSprint);
}
export async function getSprint(id: string): Promise<Sprint | null> {
  const rows = await sql()`select * from sprints where id = ${id}`;
  return rows[0] ? normSprint(rows[0]) : null;
}
export async function addSprint(s: { project_id: string; name: string; start: string; end: string }): Promise<Sprint> {
  const rows = await sql()`insert into sprints (project_id, name, start_date, end_date) values (${s.project_id}, ${s.name}, ${s.start}, ${s.end}) returning *`;
  return normSprint(rows[0]);
}
export async function updateSprint(id: string, p: { name?: string; start?: string; end?: string }): Promise<Sprint | null> {
  const cur = await getSprint(id);
  if (!cur) return null;
  const n = { ...cur, ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== undefined)) };
  const rows = await sql()`update sprints set name = ${n.name}, start_date = ${n.start}, end_date = ${n.end} where id = ${id} returning *`;
  return normSprint(rows[0]);
}
/** Deleting a sprint keeps its items: they only leave it. */
export async function deleteSprint(id: string) {
  await sql()`update items set sprint_id = null, updated_at = now() where sprint_id = ${id}`;
  await sql()`delete from sprints where id = ${id}`;
}
/** Put items of one project in a sprint (or take them out with null). Returns how many changed. */
export async function setSprintItems(project_id: string, sprint_id: string | null, ids: string[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await sql()`update items set sprint_id = ${sprint_id}, updated_at = now()
    where project_id = ${project_id} and id = any(${ids}) and sprint_id is distinct from ${sprint_id} returning id`;
  for (const r of rows) await sql()`insert into item_events (project_id, item_id, field, old, new, actor) values (${project_id}, ${r.id}, 'sprint_id', null, ${sprint_id}, 'founder')`;
  return rows.length;
}

/* ---------- todos ---------- */
export async function getTodos(from: string | null, to: string | null, includeSomeday = false): Promise<Todo[]> {
  // Todos of archived (removed) projects stay in the database but leave every day view.
  const rows = includeSomeday
    ? await sql()`select * from todos where ((date between ${from} and ${to}) or date is null) and (project_id is null or project_id not in (select id from projects where archived)) order by date nulls last, sort, created_at`
    : await sql()`select * from todos where date between ${from} and ${to} and (project_id is null or project_id not in (select id from projects where archived)) order by date, sort, created_at`;
  return rows.map(normTodo);
}
export async function addTodo(t: { date: string | null; title: string; kind?: string; project_id?: string | null; item_id?: string | null; time?: string | null; sort?: number | null; source?: string | null; rolled_from?: string | null; rolled_at?: string | null }): Promise<Todo> {
  const [m] = typeof t.sort === "number" && Number.isFinite(t.sort) ? [{ s: t.sort }] : t.date
    ? await sql()`select coalesce(max(sort), 0) + 1 as s from todos where date = ${t.date}`
    : await sql()`select coalesce(max(sort), 0) + 1 as s from todos where date is null`;
  const kind = t.kind === "work" || t.project_id ? "work" : "life";
  const rows = await sql()`insert into todos (date, title, kind, project_id, item_id, time, sort, source, rolled_from, rolled_at)
    values (${t.date}, ${t.title}, ${kind}, ${t.project_id || null}, ${t.item_id || null}, ${t.time || null}, ${m.s}, ${t.source || null}, ${t.rolled_from || null}, ${t.rolled_at || null}) returning *`;
  return normTodo(rows[0]);
}
/** Agent edit of a todo (the daily roll-forward): only the fields given change. Returns null when there's no such todo. */
export async function patchTodo(id: string, p: { date?: string | null; sort?: number; time?: string | null; rollovers?: number; rolled_from?: string | null; rolled_at?: string | null }): Promise<Todo | null> {
  const has = (k: keyof typeof p) => p[k] !== undefined;
  const rows = await sql()`update todos set
      date = case when ${has("date")} then ${p.date ?? null}::date else date end,
      sort = case when ${has("sort")} then ${p.sort ?? null}::real else sort end,
      time = case when ${has("time")} then ${p.time ?? null}::text else time end,
      rollovers = case when ${has("rollovers")} then ${p.rollovers ?? 0}::int else rollovers end,
      rolled_from = case when ${has("rolled_from")} then ${p.rolled_from ?? null}::date else rolled_from end,
      rolled_at = case when ${has("rolled_at")} then ${p.rolled_at ?? null}::date else rolled_at end
    where id = ${id} returning *`;
  return rows[0] ? normTodo(rows[0]) : null;
}

/* ---------- messages ---------- */
export async function getMessages(opts: { status?: string; limit?: number; since?: string; includeArchived?: boolean; review?: string; thread?: string } = {}): Promise<Message[]> {
  const lim = Math.min(opts.limit || 50, 200);
  let rows;
  if (opts.thread) rows = await sql()`select * from messages where id = ${opts.thread} or thread_id = ${opts.thread} order by created_at limit ${lim}`;
  else if (opts.review) rows = await sql()`select * from messages where review_id = ${opts.review} order by created_at limit ${lim}`;
  else if (opts.status) rows = await sql()`select * from messages where status = ${opts.status} and not archived order by created_at limit ${lim}`;
  else if (opts.since) rows = await sql()`select * from messages where created_at >= ${opts.since} order by created_at limit ${lim}`;
  else rows = opts.includeArchived
    ? await sql()`select * from messages order by created_at desc limit ${lim}`
    : await sql()`select * from messages where not archived order by created_at desc limit ${lim}`;
  return rows.map(normMsg);
}
export async function patchMessage(id: string, p: { status?: string; reply?: string; meta?: Record<string, unknown>; archived?: boolean; opened?: boolean; treated?: boolean | null }): Promise<Message | null> {
  const rows = await sql()`update messages set
      status = coalesce(${p.status ?? null}, status),
      reply = coalesce(${p.reply ?? null}, reply),
      replied_at = case when ${p.reply ?? null}::text is not null then now() else replied_at end,
      opened_at = case when ${p.reply ?? null}::text is not null then null when ${!!p.opened} then coalesce(opened_at, now()) else opened_at end,
      treated_at = case when ${p.treated === undefined ? null : p.treated ? "set" : "clear"}::text = 'set' then now() when ${p.treated === undefined ? null : p.treated ? "set" : "clear"}::text = 'clear' then null else treated_at end,
      meta = meta || ${JSON.stringify(p.meta || {})}::jsonb,
      archived = coalesce(${p.archived ?? null}, archived),
      updated_at = now()
    where id = ${id} returning *`;
  return rows[0] ? normMsg(rows[0]) : null;
}
/** A message the agent leaves or queues: already answered (a note), or new work for the worker (a build run of an item). */
export async function insertMessage(m: { text: string; project_id?: string | null; status?: string; reply?: string; meta?: Record<string, unknown>; mode?: string; item_id?: string | null; thread_id?: string | null }): Promise<{ id: string }> {
  const status = m.status || "answered", mode = ["discuss", "build", "plan", "screen", "website", "review", "setup"].includes(m.mode || "") ? m.mode! : "discuss";
  const [row] = await sql()`insert into messages (text, project_id, status, reply, meta, mode, item_id, thread_id, replied_at)
    values (${m.text.slice(0, 4000)}, ${m.project_id || null}, ${status}, ${(m.reply || "").slice(0, 8000)}, ${JSON.stringify(m.meta || {})}, ${mode}, ${m.item_id || null}, ${m.thread_id || null}, ${status === "new" ? null : new Date().toISOString()}) returning id`;
  return { id: row.id as string };
}
/** Inbox groups for the owner: new (a reply they haven't opened, or work still with Claude), pending (opened, not treated), treated. */
export const inboxGroup = (m: Message): "new" | "pending" | "treated" => (m.treated_at || m.archived ? "treated" : m.opened_at && !["new", "seen", "working"].includes(m.status) ? "pending" : "new");

/* ---------- reviews ---------- */
/**
 * `light` leaves out body_md and meta.tabs (list views: a project can have hundreds of reports); `unacked` keeps only
 * the ones the owner hasn't marked as read.
 */
export async function getReviews(opts: { type?: string; project?: string; limit?: number; week?: string; unacked?: boolean; light?: boolean } = {}): Promise<Review[]> {
  const where: string[] = [], params: unknown[] = [];
  if (opts.type) { params.push(opts.type); where.push(`type = $${params.length}`); }
  if (opts.project) { params.push(opts.project); where.push(`project_id = $${params.length}`); }
  if (opts.week) { params.push(opts.week); where.push(`week_start = $${params.length}`); }
  if (opts.unacked) where.push("acked_at is null");
  params.push(Math.min(opts.limit || 50, 500));
  const cols = opts.light ? "id, type, project_id, week_start, title, verdict, headline, '' as body_md, meta - 'tabs' as meta, created_at, acked_at, pushed" : "*";
  const rows = await q(`select ${cols} from reviews ${where.length ? "where " + where.join(" and ") : ""} order by week_start desc nulls last, created_at desc limit $${params.length}`, params);
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
        body_md = excluded.body_md, meta = excluded.meta, created_at = now(),
        acked_at = case when reviews.body_md is distinct from excluded.body_md then null else reviews.acked_at end
      returning *`;
    return normReview(rows[0]);
  }
  const file = typeof r.meta?.file === "string" && r.meta.file ? r.meta.file : null;
  if (file && !r.week_start) {
    // A review mirrored from a file in the project folder (security audits): one row per (type, project, meta.file),
    // so a re-sync updates it instead of adding another.
    const rows = await sql()`insert into reviews (type, project_id, week_start, title, verdict, headline, body_md, meta)
      values (${r.type}, ${r.project_id || null}, null, ${r.title}, ${r.verdict || null}, ${r.headline || ""}, ${r.body_md}, ${meta})
      on conflict (type, coalesce(project_id, ''), (meta->>'file')) where meta->>'file' is not null
      do update set title = excluded.title, verdict = excluded.verdict, headline = excluded.headline,
        body_md = excluded.body_md, meta = excluded.meta, created_at = now(),
        acked_at = case when reviews.body_md is distinct from excluded.body_md then null else reviews.acked_at end
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
/** Mark a report as read (or new again). Null when there's no such review. */
export async function setReviewAck(id: string, acked: boolean): Promise<Review | null> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const rows = await sql()`update reviews set acked_at = ${acked ? new Date().toISOString() : null} where id = ${id} returning *`;
  return rows[0] ? normReview(rows[0]) : null;
}
export class AlreadyPushedError extends Error { constructor(public existing: string) { super(`Already on the checklist as "${existing}"`); } }
/**
 * Push one task a review proposed to the checklist. The proposal is re-read from the stored review (never taken from
 * the caller) and its key is claimed atomically before the item is created, so two clicks, or the site and the CLI,
 * can't add it twice. An exact duplicate title records the existing item instead of adding another.
 */
export async function pushProposal(review_id: string, key: string, choice: { section?: string | null; owner?: unknown; estimate_minutes?: unknown } = {}, actor = "founder"): Promise<Item> {
  const r = await getReview(review_id);
  if (!r || !r.project_id) throw new PushError("No such review", 404);
  const p = await getProject(r.project_id);
  if (!p) throw new PushError("No such project", 404);
  const items = await getItems({ project: r.project_id });
  const plan = pushPlan(r, key, items, p.sections, choice);
  if ("error" in plan) { if (plan.existing) throw new AlreadyPushedError(plan.existing); throw new PushError(plan.error, 400); }
  // The claim is "pending:<time>"; one left behind by a push that died mid-way can be taken over after two minutes.
  const [claimed] = await sql()`update reviews set pushed = coalesce(pushed, '{}'::jsonb) || jsonb_build_object(${key}::text, 'pending:' || now()::text)
    where id = ${r.id} and (not (coalesce(pushed, '{}'::jsonb) ? ${key}::text)
      or (case when pushed->>${key}::text like 'pending:%' then substr(pushed->>${key}::text, 9)::timestamptz < now() - interval '2 minutes' else false end))
    returning id`;
  if (!claimed) {
    const [cur] = await sql()`select pushed->>${key}::text as v from reviews where id = ${r.id}`;
    throw new AlreadyPushedError(String(cur?.v || "").startsWith("pending:") ? "a push still in progress" : String(cur?.v || "an earlier push"));
  }
  try {
    const item = await addItem({ project_id: r.project_id, ...plan.item }, actor);
    await sql()`update reviews set pushed = pushed || jsonb_build_object(${key}::text, ${item.id}::text) where id = ${r.id}`;
    return item;
  } catch (e) {
    if (e instanceof DuplicateError) {
      await sql()`update reviews set pushed = pushed || jsonb_build_object(${key}::text, ${e.item.id}::text) where id = ${r.id}`;
      throw new AlreadyPushedError(e.item.id);
    }
    await sql()`update reviews set pushed = pushed - ${key}::text where id = ${r.id} and pushed->>${key}::text like 'pending:%'`;
    throw e;
  }
}
export class PushError extends Error { constructor(msg: string, public status = 400) { super(msg); } }

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
    from items where done_at is not null and done_at >= ${start}::date and project_id not in (select id from projects where archived) group by 1, 2`;
  return { start, rows: rows.map((r) => ({ project_id: r.project_id as string, week: d10(r.wk)!, n: r.n as number })) };
}
/** Open items by due week, next `weeks` weeks (overdue folded into the first week). */
export async function openByDueWeek(weeks = 6) {
  const start = mondayOf(today()), end = addDays(start, 7 * weeks - 1);
  const rows = await sql()`select project_id, greatest(due, ${start}::date) as d from items where status in ('todo', 'doing') and due is not null and due <= ${end} and project_id not in (select id from projects where archived)`;
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
/** Burn-up, pace and owner split per project: the top 3 by default, or one project when `project` is given. */
export async function insights(project?: string): Promise<{ projects: Insight[]; heat: { date: string; done: number; todos: number; msgs: number }[] }> {
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
  for (const p of project ? projects.filter((x) => x.id === project) : splitFeatured(projects).featured) {
    const its = items.filter((i) => i.project_id === p.id);
    const created = its.map((i) => day(i.created_at)!).sort();
    const start = created[0] && created[0] > from ? created[0] : from;
    const days: string[] = []; for (let d = start; d <= t; d = add(d, 1)) days.push(d);
    const scope = days.map((d) => its.filter((i) => i.status !== "cancelled" && day(i.created_at)! <= d).length);
    const done = days.map((d) => its.filter((i) => i.status === "done" && i.done_at && day(i.done_at)! <= d).length);
    const windowDays = Math.max(7, days.length);
    const recent = its.filter((i) => i.status === "done" && i.done_at && day(i.done_at)! > add(t, -windowDays)).length;
    const ratePerDay = recent / windowDays, openNow = its.filter(isOpen).length;
    const projected = ratePerDay > 0 ? add(t, Math.ceil(openNow / ratePerDay)) : null;
    const deadline = p.deadlines.filter((d) => d.date >= t).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
    const dueByDeadline = deadline ? its.filter((i) => isOpen(i) && i.due && i.due <= deadline.date).length : 0;
    const neededPerWeek = deadline ? dueByDeadline / Math.max(1, daysBetween(t, deadline.date)) * 7 : 0;
    const slips7 = ev.filter((e) => e.project_id === p.id && e.field === "due" && e.old && e.new && String(e.new) > String(e.old) && day(String(e.at instanceof Date ? e.at.toISOString() : e.at))! > add(t, -7)).length;
    const open = its.filter(isOpen);
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

/* ---------- daily stats ---------- */
export type StatRef = { id: string; project_id: string; title: string; late?: boolean };
export type DayStat = { date: string; added: number; done: number; done_late: number; cancelled: number; items?: { added: StatRef[]; done: StatRef[] } };
export type StatBucket = "day" | "week" | "month";
export const STAT_BUCKETS: Record<StatBucket, { n: number; max: number }> = { day: { n: 14, max: 90 }, week: { n: 12, max: 52 }, month: { n: 12, max: 24 } };
export type DailyStats = { bucket: StatBucket; from: string; to: string; tracking_since: string | null; overdue_open: number; days: DayStat[] };
/**
 * Per bucket (day, week from Monday, or calendar month, in the owner's timezone), the last `n` buckets: items added,
 * finished (of which past their due date when finished) and cancelled; plus the open overdue count today.
 * `days[].date` is the bucket's first day. With `items`, each bucket also lists the items added and finished.
 */
export async function dailyStats(n?: number, project?: string, opts: { bucket?: StatBucket; items?: boolean } = {}): Promise<DailyStats> {
  const { addDays: add, today: tdy, isoInTZ, mondayOf } = await import("./time");
  const bucket: StatBucket = opts.bucket && opts.bucket in STAT_BUCKETS ? opts.bucket : "day";
  const count = Math.min(STAT_BUCKETS[bucket].max, Math.max(1, Math.round(n || STAT_BUCKETS[bucket].n)));
  const t = tdy();
  const month = (d: string, k: number) => { const [y, m] = d.split("-").map(Number); return new Date(Date.UTC(y, m - 1 + k, 1)).toISOString().slice(0, 10); };
  const start = (d: string) => (bucket === "week" ? mondayOf(d) : bucket === "month" ? d.slice(0, 8) + "01" : d);
  const step = (d: string, k: number) => (bucket === "week" ? add(d, 7 * k) : bucket === "month" ? month(d, k) : add(d, k));
  const from = step(start(t), -(count - 1));
  const p = project || null;
  const [rows, [first], [od]] = await Promise.all([
    sql()`select id, project_id, title, created_at, done_at, updated_at, due, status from items where ((${p}::text is null and project_id not in (select id from projects where archived)) or project_id = ${p}) and (created_at >= ${from}::date - 1 or done_at >= ${from}::date - 1 or (status = 'cancelled' and updated_at >= ${from}::date - 1)) order by created_at`,
    sql()`select min(created_at) as first from items where (${p}::text is null and project_id not in (select id from projects where archived)) or project_id = ${p}`,
    sql()`select count(*)::int as n from items where ((${p}::text is null and project_id not in (select id from projects where archived)) or project_id = ${p}) and status in ('todo', 'doing') and due is not null and due < ${t}`,
  ]);
  const day = (v: unknown) => (v == null ? null : isoInTZ(v instanceof Date ? v : new Date(String(v))));
  const out: DayStat[] = Array.from({ length: count }, (_, i) => ({ date: step(from, i), added: 0, done: 0, done_late: 0, cancelled: 0, ...(opts.items ? { items: { added: [], done: [] } } : {}) }));
  const idx: Record<string, number> = Object.fromEntries(out.map((d, i) => [d.date, i]));
  const at = (d: string | null) => (d && d >= from && d <= t ? out[idx[start(d)]] : undefined);
  for (const r of rows) {
    const ref = { id: String(r.id), project_id: String(r.project_id), title: String(r.title) };
    const dd = day(r.done_at), c = at(day(r.created_at)), d = r.status === "done" ? at(dd) : undefined, u = r.status === "cancelled" ? at(day(r.updated_at)) : undefined;
    if (c) { c.added++; c.items?.added.push(ref); }
    if (d) { const late = !!(r.due && d10(r.due)! < dd!); d.done++; if (late) d.done_late++; d.items?.done.push({ ...ref, late }); }
    if (u) u.cancelled++;
  }
  return { bucket, from, to: t, tracking_since: day(first?.first), overdue_open: Number(od?.n || 0), days: out };
}

/* ---------- recurring costs (finance) ---------- */
export async function getCosts(opts: { project?: string | null; all?: boolean } = {}): Promise<Cost[]> {
  const where: string[] = [], params: unknown[] = [];
  if (opts.project === null) where.push("project_id is null");
  else if (opts.project) { params.push(opts.project); where.push(`project_id = $${params.length}`); }
  if (!opts.all) where.push("active");
  const rows = await q(`select * from recurring_costs ${where.length ? "where " + where.join(" and ") : ""} order by project_id nulls last, name`, params);
  return rows.map(normCost);
}
const PERIODS = new Set(["week", "month", "year"]);
export async function addCost(c: { project_id?: string | null; name: string; amount: number; currency?: string; period?: string; next_renewal?: string | null; notes?: string }): Promise<Cost> {
  const rows = await sql()`insert into recurring_costs (project_id, name, amount, currency, period, next_renewal, notes)
    values (${c.project_id || null}, ${c.name.trim().slice(0, 120)}, ${Math.max(0, Number(c.amount) || 0)}, ${(c.currency || "USD").toUpperCase().slice(0, 3)}, ${PERIODS.has(c.period || "") ? c.period : "month"}, ${c.next_renewal || null}, ${(c.notes || "").slice(0, 2000)}) returning *`;
  return normCost(rows[0]);
}
export async function updateCost(id: string, p: Partial<Cost>): Promise<Cost | null> {
  const rows = await sql()`update recurring_costs set
      project_id = case when ${p.project_id === undefined} then project_id else ${p.project_id || null} end,
      name = coalesce(${p.name?.trim().slice(0, 120) ?? null}, name),
      amount = coalesce(${p.amount === undefined ? null : Math.max(0, Number(p.amount) || 0)}, amount),
      currency = coalesce(${p.currency?.toUpperCase().slice(0, 3) ?? null}, currency),
      period = coalesce(${PERIODS.has(p.period || "") ? p.period! : null}, period),
      next_renewal = case when ${p.next_renewal === undefined} then next_renewal else ${p.next_renewal || null} end,
      notes = coalesce(${p.notes?.slice(0, 2000) ?? null}, notes),
      active = coalesce(${p.active ?? null}, active),
      updated_at = now()
    where id = ${id} returning *`;
  return rows[0] ? normCost(rows[0]) : null;
}
export async function deleteCost(id: string) { await sql()`delete from recurring_costs where id = ${id}`; }
/** Monthly equivalent of a cost. */
export const monthly = (c: Cost) => (c.period === "week" ? (c.amount * 52) / 12 : c.period === "year" ? c.amount / 12 : c.amount);

/* ---------- owner preferences (kv "prefs", set on the Admin page) ---------- */
export type Prefs = { show_done_default?: boolean; finance_currency?: string };
export async function getPrefs(): Promise<Prefs> { return (await kvGet<Prefs>("prefs"))?.value || {}; }

/* ---------- unit economics (kv "economics.<project>", evaluated on the Mac by agent/economics.mjs) ---------- */
/** One evaluated model; the shape is documented in docs/unit-economics.md. Grid keys are "option.mix.usage.driver" indexes. */
export type EconomicsData = {
  v: 1; title: string; currency: string; note: string;
  options: { id: string; label: string }[]; mixes: { id: string; label: string }[];
  plans: { id: string; label: string; price: number; yearly: number | null }[];
  users: number[]; usage: number[];
  driver: { id: string; label: string; unit: string; values: number[] } | null;
  thresholds: { users: number; label: string }[];
  defaults: { option: string; mix: string; usage: number; driver: number | null; plan: string | null; users: number };
  lines: { id: string; label: string; fixed: boolean }[];
  /** Per users value: [revenue, total cost, ...one value per line]. */
  grid: Record<string, number[][]>;
  /** Key "option.usage.driver"; per plan: [monthly revenue, monthly cost, yearly revenue / 12, yearly cost / 12]. */
  planGrid: Record<string, (number | null)[][]>;
};
export type Economics = { project_id: string; file: string; sha: string | null; synced_at: string | null; error: string | null; error_at: string | null; data: EconomicsData | null };
export const ECONOMICS_MAX_BYTES = 2_000_000;
export async function getEconomics(project: string): Promise<Economics | null> {
  return (await kvGet<Economics>(`economics.${project}`))?.value || null;
}
/** A successful run replaces the data; a failed one keeps the last good data and records the error beside it. */
export async function putEconomics(project: string, b: { file: string; sha?: string; data?: EconomicsData; error?: string }) {
  const prev = await getEconomics(project);
  const now = new Date().toISOString();
  const next: Economics = b.error
    ? { project_id: project, file: b.file, sha: prev?.sha || null, synced_at: prev?.synced_at || null, data: prev?.data || null, error: b.error.slice(0, 500), error_at: now }
    : { project_id: project, file: b.file, sha: b.sha || null, synced_at: now, data: b.data || null, error: null, error_at: null };
  await kvSet(`economics.${project}`, next);
  return next;
}
