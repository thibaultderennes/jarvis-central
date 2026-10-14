import type { Message } from "./data";

/**
 * Inbox lanes (pure, tested in test/inboxlanes.test.mjs). A conversation sits in one lane, picked from its latest turn
 * (status, meta.pr_url, meta.kind) and its first message (mode, meta.kind):
 *   needs   → Claude stopped and needs a decision (status needs_you or error, or a reply opening with "NEEDS YOU:")
 *   shipped → a pull request was opened or merged
 *   reports → reviews, screenings, project plans and setups
 *   fyi     → everything else Claude answered (discussions, new-item notes, replies to your comments)
 *   claude  → still with Claude (new, seen, working)
 * Handled (treated or hidden) and "later" (snoozed until a time) conversations leave the lanes but stay reachable.
 */
export type Lane = "needs" | "shipped" | "reports" | "fyi" | "claude";
export const LANES: { id: Lane; label: string; hint: string }[] = [
  { id: "needs", label: "Needs you", hint: "Claude stopped and needs a decision or an answer from you" },
  { id: "shipped", label: "Shipped", hint: "Pull requests opened or merged" },
  { id: "reports", label: "Reports", hint: "Reviews, screenings, project plans and setups" },
  { id: "fyi", label: "FYI", hint: "Answers and notes: read them when you have a minute" },
  { id: "claude", label: "With Claude", hint: "Waiting for the Mac worker or being worked on" },
];
type M = Pick<Message, "status" | "mode" | "meta" | "reply" | "text">;
const kind = (m: Pick<Message, "meta">) => String((m.meta as { kind?: unknown })?.kind || "");
export const inFlight = (m: Pick<Message, "status">) => ["new", "seen", "working"].includes(m.status);

export function laneOf(root: M, last: M): Lane {
  if (inFlight(last)) return "claude";
  if (["needs_you", "error"].includes(last.status) || /^\s*NEEDS YOU:/i.test(last.reply || "")) return "needs";
  if ((last.meta as { pr_url?: unknown })?.pr_url || kind(last) === "merged" || kind(root) === "merged") return "shipped";
  if (["review", "screen", "plan", "setup"].includes(root.mode) || kind(root) === "project-setup") return "reports";
  return "fyi";
}

/** Snoozed: the latest turn carries meta.later_until in the future. */
export const laterUntil = (m: Pick<Message, "meta">, now = Date.now()): string | null => {
  const u = (m.meta as { later_until?: unknown })?.later_until;
  return typeof u === "string" && +new Date(u) > now ? u : null;
};
export const handled = (m: Pick<Message, "treated_at" | "archived">) => !!(m.treated_at || m.archived);

/** What the thread is: shown as a pill before its one line. */
export function kindLabel(root: M): string {
  const k = kind(root);
  if (k === "merged") return "merged";
  if (root.mode === "build") return "build";
  if (root.mode === "website") return "website";
  if (root.mode === "plan") return "project plan";
  if (root.mode === "review") return "advisor review";
  if (root.mode === "screen") return "screening";
  if (root.mode === "setup") return "project setup";
  if (k === "refine") return "new item";
  if (k === "comment") return "your comment";
  return "discuss";
}

const clean = (s: string) => s.replace(/\*\*|__|`/g, "").replace(/^[>#\s-]+/, "").replace(/\s+/g, " ").trim();
const cut = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);
const sentence = (s: string) => { const m = s.match(/^.+?[.!?](?=\s|$)/); return m ? m[0] : s; };

/**
 * One line for a turn: the first bold sentence of the reply (a bold label like "**PR:**" takes the rest of its line),
 * the "due →" line for new-item notes, else the reply's first sentence. No reply yet → the message itself.
 */
export function summaryOf(m: M, root: M = m): string {
  const reply = (m.reply || "").replace(/^\s*NEEDS YOU:\s*/i, "").trim();
  if (!reply) return cut(clean(m.text.split("\n").find((l) => l.trim()) || ""));
  const lines = reply.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith(">"));
  if (kind(root) === "refine" || kind(m) === "refine") {
    const due = lines.find((l) => /^due\b/i.test(l) && /→|\*\*/.test(l)) || lines.find((l) => /\bdue\b.*→/i.test(l));
    if (due) return cut(clean(due));
  }
  for (const l of lines) {
    const b = l.match(/\*\*(.+?)\*\*(.*)/);
    if (!b) continue;
    const head = b[1].trim();
    if (head.length < 2 || /^PR:?$/i.test(head)) continue; // the worker's "**PR:** url" footer is not the point
    return cut(clean(/[:]$/.test(head) || head.split(/\s+/).length < 3 ? `${head} ${sentence(b[2].trim())}` : head));
  }
  return cut(clean(sentence(lines[0] || reply)));
}

/** Group threads by project inside a lane, keeping the order they come in (newest first) and the bundles in order of their newest thread. */
export function bundles<T extends { root: { project_id: string | null } }>(threads: T[]): { project_id: string | null; threads: T[] }[] {
  const out = new Map<string, { project_id: string | null; threads: T[] }>();
  for (const t of threads) {
    const k = t.root.project_id || "";
    if (!out.has(k)) out.set(k, { project_id: t.root.project_id, threads: [] });
    out.get(k)!.threads.push(t);
  }
  return [...out.values()];
}

/** "Later" = tomorrow at 8:00 in the browser's time zone. */
export function tomorrowMorning(now = new Date()): Date {
  const d = new Date(now); d.setDate(d.getDate() + 1); d.setHours(8, 0, 0, 0); return d;
}
