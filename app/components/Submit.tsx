"use client";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * One way to save typed text everywhere: Enter does what the button does, the text is cleared only once the save
 * succeeded (onOk), a failure keeps the text and shows why, and a short "Added" / "Saved" / "Sent" confirms it.
 * An action may return { error } to refuse with a message; a throw (network, server) shows a generic one.
 */
export type Sub = { pending: boolean; ok: string; err: string; submit: (fn: () => Promise<unknown>, o?: { ok?: string; onOk?: (r: unknown) => void }) => void; clear: () => void };
export function useSubmit(): Sub {
  const [pending, start] = useTransition();
  const [ok, setOk] = useState(""), [err, setErr] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const submit: Sub["submit"] = (fn, o = {}) => start(async () => {
    setErr(""); setOk(""); clearTimeout(timer.current);
    let r: unknown;
    try { r = await fn(); } catch { setErr("Couldn't save: nothing was lost, check your connection and try again."); return; }
    const refused = r && typeof r === "object" && "error" in r ? (r as { error?: string }).error : "";
    if (refused) { setErr(refused); return; }
    o.onOk?.(r);
    setOk(o.ok ?? "Saved");
    timer.current = setTimeout(() => setOk(""), 2500);
  });
  return { pending, ok, err, submit, clear: () => { setErr(""); setOk(""); } };
}

/** The pending / done / error line next to a form. */
export function Ack({ s, busy = "Saving…" }: { s: Sub; busy?: string }) {
  if (s.err) return <span className="ack err" role="alert">{s.err}</span>;
  return <span className="ack" role="status">{s.pending ? busy : s.ok ? `✓ ${s.ok}` : ""}</span>;
}

const composing = (e: React.KeyboardEvent) => e.nativeEvent.isComposing || e.keyCode === 229;
/** For chat-like textareas: Enter sends, Shift+Enter is a new line, Enter while an IME is composing does nothing. */
export function enterSends(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key !== "Enter" || e.shiftKey || composing(e)) return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}
/** For a single field that saves when you leave it: Enter saves too (by leaving it). */
export function enterCommits(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter" && !composing(e)) { e.preventDefault(); e.currentTarget.blur(); }
}
/** On a <form>: Enter that confirms an IME composition must not submit it. */
export function imeGuard(e: React.KeyboardEvent<HTMLFormElement>) {
  if (e.key === "Enter" && composing(e) && (e.target as HTMLElement).tagName === "INPUT") e.preventDefault();
}
