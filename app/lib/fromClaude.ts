import type { Message } from "./data";
import { handled, inFlight, kindLabel, laneOf, laterUntil, summaryOf, type Lane } from "./inboxLanes.ts"; // with the extension, so node --test can load it

/**
 * "From Claude" (pure, tested in test/fromclaude.test.mjs): what Claude finished since you last looked, one line per
 * conversation, grouped by project, on Home and atop the Inbox. "Got it" moves the mark for one project or for all
 * (kv `inbox.digest_at` = `{at, by: {project id | "_": time}}`). Needs-you conversations aren't in it: they are
 * Home's "Needs you" rows, which only show that lane.
 */
export const DIGEST_KEY = "inbox.digest_at";
/** Without a mark (or an old one), the digest looks back this far, so it never piles up. */
export const DIGEST_MAX_DAYS = 7;
export type DigestSeen = { at?: string | null; by?: Record<string, string> };
export type DigestLine = { id: string; lane: Lane; kind: string; line: string; at: string };
export type DigestGroup = { project_id: string | null; lines: DigestLine[]; at: string };

type Msg = Pick<Message, "id" | "thread_id" | "project_id" | "text" | "status" | "mode" | "meta" | "reply" | "archived" | "opened_at" | "treated_at" | "replied_at" | "updated_at" | "created_at">;
type Thread<T extends Msg> = { root: T; turns: T[]; last: T };

const ANSWERED = ["answered", "done", "needs_you", "error"];
const replyAt = (m: Pick<Msg, "replied_at" | "updated_at">) => m.replied_at || m.updated_at;
const pkey = (p: string | null) => p || "_";

/** Conversations from a flat list: the first message plus its replies, oldest turn first. A root outside the list → its oldest loaded turn. */
export function threadsOf<T extends Msg>(msgs: T[]): Thread<T>[] {
  const by = new Map<string, T[]>();
  for (const m of [...msgs].sort((x, y) => x.created_at.localeCompare(y.created_at))) {
    const k = m.thread_id || m.id;
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(m);
  }
  return [...by.entries()].map(([k, turns]) => ({ root: turns.find((t) => t.id === k) || turns[0], turns, last: turns[turns.length - 1] }));
}

/** Waiting on a real decision: the conversation is in the Needs-you lane, not handled, not put off until later. */
export function needsThreads<T extends Msg>(msgs: T[], now = Date.now()): (Thread<T> & { line: string; at: string })[] {
  return threadsOf(msgs)
    .filter((t) => !t.root.archived && !handled(t.last) && !laterUntil(t.last, now) && laneOf(t.root, t.last) === "needs")
    .map((t) => ({ ...t, line: summaryOf(t.last, t.root) || "Claude needs you", at: replyAt(t.last) }));
}

/** The Inbox badge: unread replies, leaving FYI out (it can wait). */
export function unreadCount(msgs: Msg[], now = Date.now()): number {
  return threadsOf(msgs).filter(({ root, last }) => ANSWERED.includes(last.status) && !last.opened_at && !handled(last) && !root.archived
    && !laterUntil(last, now) && laneOf(root, last) !== "fyi").length;
}

/** Since when a project's lines count as new: the latest of "all", that project's own "Got it", and the look-back limit. */
export function sinceFor(seen: DigestSeen | null | undefined, project_id: string | null, now = Date.now()): string {
  const floor = new Date(now - DIGEST_MAX_DAYS * 864e5).toISOString();
  return [floor, seen?.at || "", seen?.by?.[pkey(project_id)] || ""].reduce((a, b) => (b > a ? b : a));
}

/**
 * Since you last looked: per conversation, the newest answered turn after the project's mark. Skipped: hidden or
 * treated conversations, ones back with Claude (you already answered), and Needs you (Home lists those).
 * Groups come newest first, lines newest first.
 */
export function computeDigest(msgs: Msg[], seen: DigestSeen | null | undefined, now = Date.now()): { groups: DigestGroup[]; count: number } {
  const groups = new Map<string, DigestGroup>();
  for (const t of threadsOf(msgs)) {
    if (t.root.archived || handled(t.last) || inFlight(t.last)) continue;
    const turn = [...t.turns].reverse().find((m) => ANSWERED.includes(m.status));
    if (!turn) continue;
    const at = replyAt(turn), lane = laneOf(t.root, turn);
    if (lane === "needs" || lane === "claude" || at <= sinceFor(seen, t.root.project_id, now)) continue;
    const k = pkey(t.root.project_id);
    if (!groups.has(k)) groups.set(k, { project_id: t.root.project_id, lines: [], at });
    const g = groups.get(k)!;
    g.lines.push({ id: t.root.id, lane, kind: kindLabel(t.root), line: summaryOf(turn, t.root) || "Done", at });
    if (at > g.at) g.at = at;
  }
  const out = [...groups.values()].sort((a, b) => b.at.localeCompare(a.at));
  for (const g of out) g.lines.sort((a, b) => b.at.localeCompare(a.at));
  return { groups: out, count: out.reduce((n, g) => n + g.lines.length, 0) };
}

/** The mark after "Got it": everything (project undefined) or one project (null = General). Marks older than "all" are dropped. */
export function gotIt(seen: DigestSeen | null | undefined, project: string | null | undefined, nowIso: string): DigestSeen {
  if (project === undefined) return { at: nowIso, by: {} };
  const at = seen?.at || null;
  const by = Object.fromEntries(Object.entries(seen?.by || {}).filter(([, v]) => !at || v > at));
  return { at, by: { ...by, [pkey(project)]: nowIso } };
}
