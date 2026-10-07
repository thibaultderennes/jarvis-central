// Docs and reviews (the project page's one place for every report): kinds, the acknowledged filter, and the tasks a
// review proposes. Pure, so `npm test` loads it; the database side is in lib/data.ts (setReviewAck, pushProposal).
//
// Where proposed tasks come from, best first:
//   1. meta.added: item codes the run already put on the checklist (screenings, plans and refreshes, project setup).
//   2. meta.proposals: structured tasks [{title, detail?, section?, owner?, estimate_minutes?}] (the advisor synthesis).
//   3. Free text: the "Top 3 for this week" list of an advisor review. An entry that names an existing item code in
//      backticks is already on the checklist; one marked "new item:" with a readable title can be pushed; anything
//      else is shown as text only, never guessed into an item.
// `pushed` on the review maps a proposal key to the item it created, so the same proposal can't be pushed twice.

export type HubKind = "review" | "strategy" | "plan" | "setup" | "screening" | "security";
export const HUB_KINDS: { id: HubKind; label: string; one: string }[] = [
  { id: "review", label: "Advisor reviews", one: "Advisor review" },
  { id: "strategy", label: "Strategy", one: "Strategy doc" },
  { id: "plan", label: "Plans", one: "Plan" },
  { id: "setup", label: "Project setup", one: "Project setup" },
  { id: "screening", label: "Screenings", one: "Screening" },
  { id: "security", label: "Security audits", one: "Security audit" },
];
export const isHubKind = (v: unknown): v is HubKind => HUB_KINDS.some((k) => k.id === v);

/** The minimum a hub row needs (lib/data.ts `Review` fits). */
export type HubReview = {
  id: string; type: string; title: string; created_at: string; body_md?: string;
  meta?: Record<string, unknown> | null; acked_at?: string | null; pushed?: Record<string, string> | null;
};

/** Which hub kind a review is, or null for the cross-project ones (recap, coaching, Jarvis) that don't belong here. */
export function hubKind(r: Pick<HubReview, "type" | "title" | "meta">): HubKind | null {
  if (r.type === "project") return "review";
  if (r.type === "security") return "security";
  if (r.type === "screening") return "screening";
  if (r.type !== "doc") return null;
  const k = String(r.meta?.kind || "");
  if (k === "project-setup") return "setup";
  if (k === "project-plan" || k === "checklist-refresh" || /^(Project plan|Checklist refresh)\b/.test(r.title)) return "plan";
  return "strategy";
}

/** The date a row sorts and shows by: the file's own date for mirrored reports, else when it reached the site. */
export const hubDate = (r: Pick<HubReview, "created_at" | "meta">) =>
  (typeof r.meta?.date === "string" && /^\d{4}-\d{2}-\d{2}/.test(r.meta.date) ? r.meta.date.slice(0, 10) : "") || r.created_at.slice(0, 10);

export const isAcked = (r: Pick<HubReview, "acked_at">) => !!r.acked_at;

/** Newest first (by hubDate, then created_at), only the kinds this page shows. */
export function hubList<T extends HubReview>(list: T[]): T[] {
  return list.filter((r) => hubKind(r) !== null)
    .sort((a, b) => hubDate(b).localeCompare(hubDate(a)) || b.created_at.localeCompare(a.created_at));
}
export function filterHub<T extends HubReview>(list: T[], f: { kind?: string | null; unacked?: boolean }): T[] {
  return list.filter((r) => (!f.kind || !isHubKind(f.kind) || hubKind(r) === f.kind) && (!f.unacked || !isAcked(r)));
}
export const unackedCount = (list: HubReview[]) => list.filter((r) => hubKind(r) !== null && !isAcked(r)).length;

/* ---------- proposed tasks ---------- */

export type Owner = "founder" | "claude" | "both";
export const OWNERS: { id: Owner; label: string }[] = [{ id: "founder", label: "You" }, { id: "claude", label: "Claude" }, { id: "both", label: "Both" }];
export const isOwner = (v: unknown): v is Owner => v === "founder" || v === "claude" || v === "both";

export type ProposalState = "pushed" | "on-checklist" | "pushable" | "text";
export type Proposal = {
  key: string; state: ProposalState; text: string; source: string;
  title?: string; detail?: string; section?: string; owner?: Owner; estimate_minutes?: number | null;
  /** Item codes it maps to: the pushed item, the items a run added, or existing codes the text names. */
  items: string[];
};
type ItemRef = { id: string; title: string };
type SectionRef = { id: string; name: string; owner_default?: string };

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
/** A short stable key for a proposal: the same task in the summary and an advisor's tab gets the same key. */
export function proposalKey(s: string): string {
  let h = 5381;
  for (const c of norm(s)) h = ((h << 5) + h + c.charCodeAt(0)) >>> 0;
  return "p" + h.toString(36);
}
const CODE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const clean = (s: string) => s.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();

/** "~2h", "90 min", "3 hours" in the text → minutes (5 min to 40 h), else null. */
export function parseEstimate(s: string): number | null {
  const m = s.match(/~?\s*(\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)\b/i);
  if (!m) return null;
  const n = Number(m[1]) * (/^h/i.test(m[2]) ? 60 : 1);
  return n >= 5 && n <= 2400 ? Math.round(n) : null;
}
export function normEstimate(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 5 && n <= 2400 ? n : null;
}

/** The list entries under each "Top 3 …" heading of a markdown report (continuation lines folded in). */
export function topEntries(md: string): string[] {
  const out: string[] = [];
  let inTop = false, cur: string | null = null;
  const flush = () => { if (cur !== null && cur.trim()) out.push(cur.trim()); cur = null; };
  for (const line of String(md || "").split("\n")) {
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) { flush(); inTop = /^top\s*(3|three)\b/i.test(clean(h[1])); continue; }
    if (!inTop) continue;
    const li = line.match(/^\s{0,3}(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (li) { flush(); cur = li[1]; }
    else if (cur !== null && line.trim()) cur += " " + line.trim();
    else flush();
  }
  flush();
  return out;
}

/** One free-text entry → a proposal, conservatively. Only an entry marked "new item" with a readable title is pushable. */
export function parseEntry(entry: string, source: string, itemIds: Set<string>): Proposal {
  const text = clean(entry);
  const codes = [...entry.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim()).filter((c) => CODE.test(c) && itemIds.has(c));
  const marked = /\bnew item\b/i.test(text);
  let title: string | undefined;
  const after = text.match(/\bnew item\s*:\s*(.+)$/i);
  if (after) {
    title = after[1].replace(/`/g, "").split(/\s[—–-]\s|\.\s|;\s|\s\(/)[0].replace(/[.:,;]+$/, "").trim();
  } else if (marked) {
    const bold = entry.match(/^\s*\*\*([^*]+)\*\*/); // "**Add a pricing page** (new item) — …"
    if (bold) title = clean(bold[1]).replace(/`/g, "").replace(/[.:,;]+$/, "").trim();
  }
  if (title && (title.length < 4 || title.length > 120 || title.split(" ").length < 2 || /new item/i.test(title))) title = undefined;
  if (marked && title) return { key: proposalKey(title), state: "pushable", text, source, title, detail: text, estimate_minutes: parseEstimate(text), items: [] };
  if (codes.length) return { key: proposalKey(text), state: "on-checklist", text, source, items: [...new Set(codes)] };
  return { key: proposalKey(text), state: "text", text, source, items: [] };
}

/** meta.proposals, validated: anything without a usable title is dropped. */
export function structuredProposals(meta: Record<string, unknown> | null | undefined, source = "Summary"): Proposal[] {
  const raw = Array.isArray(meta?.proposals) ? (meta!.proposals as unknown[]) : [];
  const out: Proposal[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    const title = typeof o.title === "string" ? clean(o.title).slice(0, 200) : "";
    if (title.length < 4) continue;
    const detail = typeof o.detail === "string" ? o.detail.slice(0, 4000) : "";
    out.push({ key: proposalKey(title), state: "pushable", text: detail ? `${title}: ${clean(detail)}` : title, source, title, detail,
      section: typeof o.section === "string" ? o.section : undefined, owner: isOwner(o.owner) ? o.owner : undefined, estimate_minutes: normEstimate(o.estimate_minutes), items: [] });
  }
  return out;
}

/** The item a proposal was pushed as, or null. A "pending:<time>" value is a push still running (lib/data.ts). */
export function pushedAs(r: Pick<HubReview, "pushed">, key: string): string | null {
  const v = r.pushed?.[key];
  return typeof v === "string" && v && !v.startsWith("pending:") ? v : null;
}

/**
 * Every task a review proposes, with its state against the live checklist. Pushed (by `pushed`) beats everything; a
 * pushable title that is already an item's title (or code) counts as on the checklist, so it is never offered twice.
 */
export function reviewProposals(r: HubReview, items: ItemRef[]): Proposal[] {
  const ids = new Set(items.map((i) => i.id));
  const byTitle = new Map(items.map((i) => [norm(i.title), i.id]));
  const seen = new Set<string>(), out: Proposal[] = [];
  const add = (p: Proposal) => {
    if (seen.has(p.key)) return;
    seen.add(p.key);
    const done = pushedAs(r, p.key);
    if (done) { out.push({ ...p, state: "pushed", items: [done] }); return; }
    if (p.state === "pushable" && p.title) {
      const hit = byTitle.get(norm(p.title));
      if (hit) { out.push({ ...p, state: "on-checklist", items: [hit] }); return; }
    }
    out.push(p);
  };
  const added = Array.isArray(r.meta?.added) ? (r.meta!.added as unknown[]).filter((x): x is string => typeof x === "string" && CODE.test(x)) : [];
  for (const id of added) {
    const t = items.find((i) => i.id === id)?.title;
    add({ key: "added:" + id, state: "on-checklist", text: t || id, source: "Added by the run", items: [id] });
  }
  for (const p of structuredProposals(r.meta)) add(p);
  for (const e of topEntries(r.body_md || "")) add(parseEntry(e, "Summary", ids));
  const tabs = Array.isArray(r.meta?.tabs) ? (r.meta!.tabs as { label?: unknown; body_md?: unknown }[]) : [];
  for (const t of tabs) for (const e of topEntries(typeof t.body_md === "string" ? t.body_md : "")) add(parseEntry(e, typeof t.label === "string" ? t.label : "Advisor", ids));
  return out;
}

/** The section a pushed task goes to: the one it names (id or name), else the first section. */
export function pickSection(sections: SectionRef[], hint?: string | null): SectionRef | null {
  const h = norm(hint || "");
  return (h && sections.find((s) => norm(s.id) === h || norm(s.name) === h)) || sections[0] || null;
}

/**
 * The item a push creates, or why it can't: the double-push guard lives here (and again, atomically, in the database).
 * `choice` is what the owner picked on the page (section, owner, estimate); the proposal fills the rest.
 */
export function pushPlan(r: HubReview, key: string, items: ItemRef[], sections: SectionRef[], choice: { section?: string | null; owner?: unknown; estimate_minutes?: unknown } = {}):
  { error: string; existing?: string } | { item: { section: string; title: string; detail: string; owner: Owner; estimate_minutes: number | null } } {
  const done = pushedAs(r, key);
  if (done) return { error: `Already pushed as "${done}".`, existing: done };
  const p = reviewProposals(r, items).find((x) => x.key === key);
  if (!p) return { error: "That proposal isn't in this review." };
  if (p.state === "pushed" || p.state === "on-checklist") return { error: `Already on the checklist as "${p.items[0]}".`, existing: p.items[0] };
  if (p.state !== "pushable" || !p.title) return { error: "This proposal has no clear title: add it by hand." };
  const sec = pickSection(sections, choice.section || p.section);
  if (!sec) return { error: "This project has no checklist sections yet." };
  const owner = isOwner(choice.owner) ? choice.owner : p.owner || (isOwner(sec.owner_default) ? sec.owner_default : "founder");
  const est = choice.estimate_minutes !== undefined && choice.estimate_minutes !== "" ? normEstimate(choice.estimate_minutes) : p.estimate_minutes ?? null;
  const detail = [p.detail && p.detail !== p.title ? p.detail : "", `From "${r.title}"${p.source && p.source !== "Summary" ? ` (${p.source})` : ""}.`].filter(Boolean).join("\n\n");
  return { item: { section: sec.id, title: p.title.slice(0, 300), detail: detail.slice(0, 5000), owner, estimate_minutes: est } };
}
