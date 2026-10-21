// One overdue queue across projects (Home box "Overdue" and the Today panel). Pure: no imports, so `npm test` loads it.
// The queue is every open item (todo or in progress) due before today: critical first, then the oldest due date.

export type Triage = "due" | "later" | "claude" | "done";
export const TRIAGE: readonly Triage[] = ["due", "later", "claude", "done"];
/** How many items one click may change. */
export const MAX_TRIAGE = 200;

type Q = { project_id: string; id: string; status: string; due: string | null; critical: boolean };
const open = (i: { status: string }) => i.status === "todo" || i.status === "doing";

export function overdueQueue<T extends Q>(items: T[], today: string): T[] {
  return items.filter((i) => open(i) && !!i.due && i.due < today)
    .sort((a, b) => Number(b.critical) - Number(a.critical) || a.due!.localeCompare(b.due!) || a.project_id.localeCompare(b.project_id) || a.id.localeCompare(b.id));
}

/** "Later" moves the due date to next Monday (a Monday moves a full week), like the → Mon chip on the Week board. */
export function laterDate(today: string): string {
  const d = new Date(today + "T12:00:00Z"), n = (8 - d.getUTCDay()) % 7 || 7;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const ID = /^[a-z0-9][a-z0-9_-]{0,60}$/i;
/** What the browser sends, cleaned: `project/id` keys, well-formed, once each, at most MAX_TRIAGE. */
export function parseKeys(raw: unknown): { project_id: string; id: string }[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>(), out: { project_id: string; id: string }[] = [];
  for (const k of raw) {
    if (typeof k !== "string" || seen.has(k)) continue;
    const [project_id, id, extra] = k.split("/");
    if (extra !== undefined || !ID.test(project_id || "") || !ID.test(id || "")) continue;
    seen.add(k);
    out.push({ project_id, id });
    if (out.length >= MAX_TRIAGE) break;
  }
  return out;
}
