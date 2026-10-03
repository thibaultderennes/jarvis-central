/** True when the keystroke belongs to a text field (or anything editable), so global shortcuts must stay out of it. */
export function isTyping(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes((t as HTMLInputElement).type);
}
export const isMac = () => typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** Pages reachable from the palette and the g-shortcuts. `key` = the letter after "g". */
export const PAGES: { href: string; label: string; key?: string; words: string }[] = [
  { href: "/", label: "Home", key: "h", words: "overview dashboard needs you" },
  { href: "/today", label: "Today", key: "t", words: "day todos list" },
  { href: "/week", label: "Week", key: "w", words: "plan calendar" },
  { href: "/timeline", label: "Timeline", key: "l", words: "milestones deadlines gantt" },
  { href: "/inbox", label: "Inbox", key: "i", words: "messages claude replies" },
  { href: "/reviews", label: "Reviews", words: "monday weekly reports audits" },
  { href: "/finance", label: "Finance", words: "costs subscriptions money" },
  { href: "/stats", label: "Stats", key: "s", words: "charts statistics insights burn" },
  { href: "/admin", label: "Admin", words: "settings account projects preferences" },
];
