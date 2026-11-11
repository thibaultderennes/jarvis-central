// Follow-through ledger (after the decision-logger skill in alirezarezvani/claude-skills, MIT; the database is the log,
// no files): every advisor review's Top 3 is recorded, and the next review and the recap open with what happened to
// each. Pure, so `npm test` loads it; the database side is in lib/data.ts (syncAdvice, getAdvice, decideAdvice).
//
// What happened to an entry, best evidence first:
//   rejected  the owner rejected it (with an optional reason): it is never proposed again. The advisors get the list,
//             and a later Top 3 entry that matches one is recorded as rejected straight away.
//   done      the owner marked it done, or an item it names (or was pushed as) is done
//   started   an item it names is in progress
//   ignored   nothing moved (only once the review's week is over; before that it is "open")
import type { Proposal } from "./docsHub";

export type AdviceStatus = "open" | "done" | "rejected";
export const ADVICE_STATUSES: AdviceStatus[] = ["open", "done", "rejected"];
export const isAdviceStatus = (v: unknown): v is AdviceStatus => ADVICE_STATUSES.includes(v as AdviceStatus);
export type Outcome = "done" | "started" | "ignored" | "rejected" | "open";
export const OUTCOME_LABEL: Record<Outcome, string> = { done: "Done", started: "Started", ignored: "Ignored", rejected: "Rejected", open: "Open" };

export type Advice = {
  review_id: string; key: string; project_id: string | null; week_start: string | null; rank: number; text: string;
  items: string[]; status: AdviceStatus; reason: string; decided_by: string | null; decided_at: string | null;
  /** The item the entry was pushed to the checklist as (reviews.pushed), when it was. */
  pushed_item?: string | null;
};
export type Entry = Pick<Proposal, "key" | "text" | "items"> & { rank: number };

/**
 * The summary's "Top 3" list, parsed (`topEntries(body).map((e) => parseEntry(e, …))` in lib/docsHub.ts) → at most
 * three ledger entries. Same keys as the proposals, so an entry pushed to the checklist is found again.
 */
export function topThree(parsed: Pick<Proposal, "key" | "text" | "items">[]): Entry[] {
  const out: Entry[] = [];
  for (const p of parsed) {
    if (out.some((x) => x.key === p.key)) continue;
    out.push({ key: p.key, rank: out.length + 1, text: p.text.slice(0, 1000), items: p.items });
    if (out.length === 3) break;
  }
  return out;
}

/** What happened to one entry, against the live checklist. `past` = the review's week is over. */
export function outcome(a: Pick<Advice, "status" | "items" | "pushed_item">, itemStatus: Map<string, string>, past: boolean): Outcome {
  if (a.status === "rejected") return "rejected";
  if (a.status === "done") return "done";
  const st = [...new Set([...(a.items || []), ...(a.pushed_item ? [a.pushed_item] : [])])].map((id) => itemStatus.get(id));
  if (st.includes("done")) return "done";
  if (st.includes("doing")) return "started";
  return past ? "ignored" : "open";
}

const STOP = new Set("a an and are as at be by for from in into is it its of on or that the this to with week new item your you".split(" "));
const words = (s: string) => new Set(s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
/** Word overlap of two entries (Jaccard on meaningful words, 0..1). */
export function similarity(a: string, b: string): number {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n / (A.size + B.size - n);
}
/** The rejected entry a new one repeats (same key, or mostly the same words), or null. */
export function matchRejected<T extends Pick<Advice, "key" | "text">>(e: Pick<Entry, "key" | "text">, rejected: T[], threshold = 0.6): T | null {
  return rejected.find((r) => r.key === e.key || similarity(r.text, e.text) >= threshold) || null;
}
