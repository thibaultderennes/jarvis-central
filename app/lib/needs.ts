import { sql } from "./db";
import { getMessages, getProjects, isOpen, type Item, type Message, type Project } from "./data";

/** One thing waiting on the owner. `at` = since when (oldest first); `href` = where the one primary action happens. */
export type Need = {
  key: string; kind: "decide" | "merge" | "reply"; project_id: string | null; item_id: string | null;
  title: string; at: string; href: string; action: string;
};
type ItemLite = Pick<Item, "project_id" | "id" | "section" | "title" | "status" | "owner" | "build_status" | "created_at" | "build_updated_at">;
type MsgLite = Pick<Message, "id" | "project_id" | "text" | "status" | "archived" | "opened_at" | "treated_at" | "replied_at" | "updated_at">;

/** The owner's "decide" section: id "decide", else the first one with a note box (as agent/structure.mjs picks it). */
export const decideSection = (p: Project) => p.sections.find((s) => s.id === "decide") || p.sections.find((s) => s.notes) || null;
/** Replies you haven't opened yet (same rule as the Inbox badge). */
export const unreadReply = (m: MsgLite) => ["answered", "done", "needs_you", "error"].includes(m.status) && !m.opened_at && !m.treated_at && !m.archived;

const itemHref = (i: { project_id: string; id: string }) => `/p/${i.project_id}?v=checklist#item-${encodeURIComponent(i.id)}`;
const firstLine = (s: string) => { const l = s.trim().split("\n")[0].replace(/\s+/g, " "); return l.length > 110 ? l.slice(0, 107) + "…" : l; };

/** Pure: build the list from rows already loaded (Home has them anyway). */
export function computeNeeds(projects: Project[], items: ItemLite[], msgs: MsgLite[]): { rows: Need[]; count: number } {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const rows: Need[] = [];
  for (const i of items) {
    const p = byId.get(i.project_id);
    if (!p || !isOpen(i)) continue;
    if (i.build_status === "pr_open") {
      rows.push({ key: `m:${i.project_id}:${i.id}`, kind: "merge", project_id: i.project_id, item_id: i.id, title: i.title, at: i.build_updated_at || i.created_at, href: itemHref(i), action: "Approve & merge" });
      continue;
    }
    const sec = decideSection(p);
    if (sec && i.section === sec.id && (i.owner || sec.owner_default || "founder") === "founder")
      rows.push({ key: `d:${i.project_id}:${i.id}`, kind: "decide", project_id: i.project_id, item_id: i.id, title: i.title, at: i.created_at, href: itemHref(i), action: "Decide" });
  }
  for (const m of msgs) if (unreadReply(m))
    rows.push({ key: `r:${m.id}`, kind: "reply", project_id: m.project_id, item_id: null, title: firstLine(m.text) || "Reply from Claude", at: m.replied_at || m.updated_at, href: "/inbox", action: "Read" });
  rows.sort((a, b) => a.at.localeCompare(b.at));
  return { rows, count: rows.length };
}

/** Everything waiting on you across projects, oldest first. Three queries, whatever the number of projects. */
export async function needsYou(): Promise<{ rows: Need[]; count: number }> {
  const ts = (v: unknown) => (v == null ? null : v instanceof Date ? v.toISOString() : String(v));
  const [projects, items, msgs] = await Promise.all([
    getProjects(),
    sql()`select project_id, id, section, title, status, owner, build_status, created_at, build_updated_at from items
      where status in ('todo', 'doing') and (build_status = 'pr_open' or coalesce(owner, 'founder') = 'founder') and project_id not in (select id from projects where archived)`,
    getMessages({ limit: 200 }),
  ]);
  return computeNeeds(projects, items.map((r) => ({ ...r, created_at: ts(r.created_at)!, build_updated_at: ts(r.build_updated_at) }) as ItemLite), msgs);
}
