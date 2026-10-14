// Inbox kinds, so messages can be treated in bulk. Pure: no database, so the tests and the CLI's copy agree.
// agent/jarvis.mjs `treat --kind` repeats inboxKind: keep the two in step.

/** Agent notes that only repeat what already lives elsewhere (the checklist, a report, GitHub). */
export const FYI_KINDS = ["refine", "comment", "merged", "scheduled", "now"];
/** Modes whose reply is a report saved on the project page. */
export const REPORT_MODES = ["review", "plan", "screen"];
const ACTIVE = ["new", "seen", "working"];

type Lite = { status: string; mode?: string | null; meta?: Record<string, unknown> | null };
export type InboxKind = "decision" | "fyi" | "reply" | "working";

/**
 * decision: Claude needs you or the run failed. fyi: a receipt or a report on its own (no one replied in it).
 * reply: an answer to something you asked. working: still with Claude, can't be treated yet.
 */
export function inboxKind(root: Lite, last: Lite, turns = 1): InboxKind {
  if (ACTIVE.includes(last.status)) return "working";
  if (["needs_you", "error"].includes(last.status)) return "decision";
  const kind = String((root.meta || {}).kind || "");
  if (turns === 1 && (FYI_KINDS.includes(kind) || REPORT_MODES.includes(root.mode || ""))) return "fyi";
  return "reply";
}

/** Clean a list of message ids from the browser or the API: uuids only, no repeats, at most 200. */
export const cleanIds = (ids: unknown): string[] =>
  Array.isArray(ids) ? [...new Set(ids.filter((x): x is string => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(x)))].slice(0, 200) : [];
