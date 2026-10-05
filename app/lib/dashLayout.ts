// The dashboard's tabs and boxes (Home = Overview · Timeline · Stats). Pure: no imports, so `npm test` loads it.
// A layout is, per tab, the boxes on it with their place on a 12-column grid: x (0–11), y (row), w (columns), h (rows of
// at least 48px; a row grows with its content), and whether it is folded to its title. Saved in kv `dashboard.layout`.

export const TABS = ["overview", "timeline", "stats"] as const;
export type Tab = (typeof TABS)[number];
export type Place = { id: string; x: number; y: number; w: number; h: number; min?: boolean };
export type Layout = Record<Tab, Place[]>;

/** Every box: which tab it belongs to, its title, what it shows (the "Add box" library) and where it starts. */
export const BOXES: Record<string, { tab: Tab; title: string; what: string; at: [number, number, number, number] }> = {
  needs: { tab: "overview", title: "Needs you", what: "Decisions, pull requests to approve, replies you haven't opened", at: [0, 0, 7, 6] },
  reviews: { tab: "overview", title: "This week's reviews", what: "The Monday reviews, recap and coaching", at: [7, 0, 5, 3] },
  sprints: { tab: "overview", title: "Sprints this week", what: "Sprints running or starting this week, across projects", at: [7, 3, 5, 3] },
  top3: { tab: "overview", title: "Your top 3", what: "Your three main projects with pace against their next milestone", at: [0, 6, 12, 6] },
  inbox: { tab: "overview", title: "Inbox", what: "The latest messages with Claude and where they stand", at: [0, 12, 12, 3] },
  timeline: { tab: "timeline", title: "Timeline", what: "Milestones, due dates, sprints and planned blocks, 10 weeks", at: [0, 0, 12, 8] },
  milestones: { tab: "timeline", title: "Upcoming milestones", what: "The next dated milestones from each PRD", at: [0, 8, 7, 4] },
  calendar: { tab: "timeline", title: "This week", what: "Calendar events and planned focus, 7 days", at: [7, 8, 5, 4] },
  burnups: { tab: "stats", title: "Will each project make its next deadline?", what: "Burn-ups against each next milestone", at: [0, 0, 12, 4] },
  pace: { tab: "stats", title: "Pace vs needed", what: "Items finished per week against what the next deadline needs", at: [0, 4, 6, 5] },
  owners: { tab: "stats", title: "Who it's waiting on", what: "Open checklist items by owner", at: [6, 4, 6, 5] },
  finished: { tab: "stats", title: "Finished per week", what: "Checklist items done, last 4 weeks", at: [0, 9, 6, 5] },
  daily: { tab: "stats", title: "Added and finished", what: "Items added and finished per day, week or month", at: [6, 9, 6, 5] },
  rhythm: { tab: "stats", title: "Your rhythm", what: "Items finished, todos ticked and messages sent per day", at: [0, 14, 6, 4] },
  ahead: { tab: "stats", title: "Work ahead", what: "Open items due in the next 4 weeks", at: [6, 14, 6, 5] },
  time: { tab: "stats", title: "Where your time went", what: "Active minutes in Claude sessions per project, last week", at: [0, 18, 6, 4] },
};

export const isTab = (t: unknown): t is Tab => typeof t === "string" && (TABS as readonly string[]).includes(t);
export const defaultTab = (tab: Tab): Place[] => Object.entries(BOXES).filter(([, b]) => b.tab === tab).map(([id, b]) => ({ id, x: b.at[0], y: b.at[1], w: b.at[2], h: b.at[3] }));
export const defaultLayout = (): Layout => ({ overview: defaultTab("overview"), timeline: defaultTab("timeline"), stats: defaultTab("stats") });

const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

/** Clean one tab's layout from the browser or the database: known boxes of that tab only, once each, on the grid. */
export function sanitizeTab(tab: Tab, raw: unknown): Place[] {
  if (!Array.isArray(raw)) return defaultTab(tab);
  const seen = new Set<string>(), out: Place[] = [];
  for (const r of raw.slice(0, 40)) {
    const id = typeof r?.id === "string" ? r.id : "";
    if (!BOXES[id] || BOXES[id].tab !== tab || seen.has(id)) continue;
    seen.add(id);
    const w = int(r.w, 2, 12, BOXES[id].at[2]);
    out.push({ id, w, x: int(r.x, 0, 12 - w, 0), y: int(r.y, 0, 200, 0), h: int(r.h, 1, 40, BOXES[id].at[3]), ...(r.min ? { min: true } : {}) });
  }
  return out;
}
export function sanitizeLayout(raw: unknown): Layout {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return { overview: o.overview ? sanitizeTab("overview", o.overview) : defaultTab("overview"), timeline: o.timeline ? sanitizeTab("timeline", o.timeline) : defaultTab("timeline"), stats: o.stats ? sanitizeTab("stats", o.stats) : defaultTab("stats") };
}

const hOf = (p: Place) => (p.min ? 1 : p.h);
const hit = (a: Place, b: Place) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + hOf(b) && b.y < a.y + hOf(a);
/** Place `moved` where it was dropped, push the boxes it lands on down, then float everything up into free space. */
export function settle(list: Place[], movedId: string | null): Place[] {
  const items = list.map((p) => ({ ...p }));
  const moved = items.find((p) => p.id === movedId) || null;
  const order = [...items].sort((a, b) => (a === moved ? -1 : b === moved ? 1 : a.y - b.y || a.x - b.x));
  const placed: Place[] = [];
  for (const it of order) {
    if (it !== moved) it.y = 0;
    while (placed.some((p) => hit(p, it))) it.y++;
    placed.push(it);
  }
  for (const it of [...items].sort((a, b) => a.y - b.y)) {
    if (it === moved) continue;
    while (it.y > 0 && !items.some((o) => o !== it && hit(o, { ...it, y: it.y - 1 }))) it.y--;
  }
  return items;
}
