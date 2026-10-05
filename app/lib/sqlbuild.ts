// Pure query builders for the writes in data.ts, kept free of imports so `npm test` can load them without a database.
// Every value goes in as a numbered placeholder; the 0.5.x "text = integer" bug (#8) came from placeholders that drifted
// from their params.

export const PROJECT_FIELDS = ["name", "kind", "color", "tagline", "state", "status", "dir", "sections", "deadlines", "links", "sort", "archived", "featured_rank", "plan_enabled", "weekly_minutes", "reviews_enabled"] as const;
const PROJECT_JSON = new Set(["sections", "deadlines", "links"]);

/** Insert-or-update one project with only the fields given; `id` is always $1. */
export function projectUpsert(p: { id: string } & Record<string, unknown>): { text: string; params: unknown[] } {
  const cols = PROJECT_FIELDS.filter((k) => p[k] !== undefined);
  const vals = cols.map((k) => (PROJECT_JSON.has(k) ? JSON.stringify(p[k]) : p[k]));
  const insertCols = ["id", ...cols].join(", ");
  const ph = ["$1", ...cols.map((_, i) => `$${i + 2}`)].join(", ");
  const upd = cols.map((k, i) => `${k} = $${i + 2}`).concat("updated_at = now()").join(", ");
  return { text: `insert into projects (${insertCols}) values (${ph}) on conflict (id) do update set ${upd} returning *`, params: [p.id, ...vals] };
}

/** The item columns a PATCH may change: anything else in the body is ignored. */
export const ITEM_FIELDS = ["section", "title", "detail", "status", "due", "owner", "critical", "sort", "note", "estimate_minutes", "priority", "refine", "refine_note", "refine_request", "cancel_reason", "duplicate_of", "build_status", "build_note", "pr_url", "blocked_by"] as const;
export type ItemField = (typeof ITEM_FIELDS)[number];

/** blocked_by from the site (array) or the CLI ("a,b" or "" to clear): item codes, deduplicated, at most 20. */
export function normBlockedBy(v: unknown): string[] {
  const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,]+/) : [];
  return [...new Set(list.map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9-]{0,60}$/.test(x)))].slice(0, 20);
}

const same = (a: unknown, b: unknown) => (Array.isArray(a) || Array.isArray(b) ? JSON.stringify(a ?? []) === JSON.stringify(b ?? []) : a === b);

/** The update for one item: only whitelisted fields that actually change. Null when nothing changes. */
export function itemUpdate(cur: Record<string, unknown>, patch: Record<string, unknown>): { cols: ItemField[]; values: Record<string, unknown>; text: string; params: unknown[] } | null {
  const values: Record<string, unknown> = {};
  for (const k of ITEM_FIELDS) {
    if (patch[k] === undefined) continue;
    const v = k === "due" ? patch.due || null : k === "blocked_by" ? normBlockedBy(patch.blocked_by) : patch[k];
    if (!same(v, cur[k])) values[k] = v;
  }
  const cols = ITEM_FIELDS.filter((k) => k in values);
  if (!cols.length) return null;
  const params: unknown[] = [cur.project_id, cur.id];
  const sets = cols.map((k) => { params.push(values[k]); return `${k} = $${params.length}`; });
  sets.push("updated_at = now()");
  if (values.status !== undefined) sets.push(values.status === "done" ? "done_at = now()" : "done_at = null");
  if (values.build_status !== undefined) sets.push("build_updated_at = now()");
  return { cols, values, text: `update items set ${sets.join(", ")} where project_id = $1 and id = $2 returning *`, params };
}

/** True when making `id` wait on `blockers` closes a loop (A waits on B, which waits on A). `edges`: id → its blocked_by. */
export function wouldCycle(edges: Record<string, string[]>, id: string, blockers: string[]): boolean {
  const seen = new Set<string>(), stack = [...blockers];
  while (stack.length) {
    const n = stack.pop()!;
    if (n === id) return true;
    if (seen.has(n)) continue;
    seen.add(n);
    stack.push(...(edges[n] || []));
  }
  return false;
}
