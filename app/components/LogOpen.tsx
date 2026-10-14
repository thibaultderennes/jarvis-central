"use client";
import { useEffect } from "react";
import { track } from "@/lib/actions";
import { untracked } from "./UsageTracker";

/*
 * "Opened" events for the activity log the Monday Jarvis review reads (review_open, calendar_view): reading a report
 * or looking at the calendar changes nothing, so no other action records it. Automated browsers and ?notrack log nothing.
 */
export function logOpen(kind: "review_open" | "calendar_view", page: string, detail: Record<string, string | number | boolean> = {}) {
  if (untracked()) return;
  track(kind, page, detail).catch(() => {});
}

/** Logs once per mount and again when `id` changes (another report picked in the same view). */
export default function LogOpen({ kind, page, id, detail = {} }: { kind: "review_open" | "calendar_view"; page: string; id: string; detail?: Record<string, string | number | boolean> }) {
  const d = JSON.stringify(detail);
  useEffect(() => { logOpen(kind, page, JSON.parse(d)); }, [kind, page, id, d]);
  return null;
}
