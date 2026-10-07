// The dashboard: Home is one page (0.7.4.6 merged the Overview, Timeline and Stats tabs and added the Map). Pure: no
// imports, so `npm test` loads it. A layout is the boxes on the page with their place on a 12-column grid: x (0–11),
// y (row), w (columns), h (rows of at least 48px; a row grows with its content), and whether it is folded to its title.
// Saved in kv `dashboard.layout` under `home`; layouts saved per tab before 0.7.4.6 are replaced by the new default.

export const TABS = ["home"] as const;
export type Tab = (typeof TABS)[number];
export type Place = { id: string; x: number; y: number; w: number; h: number; min?: boolean };
export type Layout = Record<Tab, Place[]>;

/** The page's sections, top to bottom: the jump links above the grid point at their first box. */
export const SECTIONS = [
  { id: "overview", label: "Overview", box: "top3" },
  { id: "map", label: "Map", box: "map" },
  { id: "timeline", label: "Timeline", box: "timeline" },
  { id: "stats", label: "Stats", box: "burnups" },
] as const;

/** Every box: its section, its title, what it shows (the "Add box" library) and where it starts. Your top 3 comes first. */
export const BOXES: Record<string, { tab: Tab; section: string; title: string; what: string; at: [number, number, number, number] }> = {
  top3: { tab: "home", section: "overview", title: "Your top 3", what: "Your three main projects with pace against their next milestone", at: [0, 0, 12, 6] },
  needs: { tab: "home", section: "overview", title: "Needs you", what: "Decisions, pull requests to approve, replies you haven't opened", at: [0, 6, 7, 6] },
  reviews: { tab: "home", section: "overview", title: "This week's reviews", what: "The Monday reviews, recap and coaching", at: [7, 6, 5, 3] },
  sprints: { tab: "home", section: "overview", title: "Sprints this week", what: "Sprints running or starting this week, across projects", at: [7, 9, 5, 3] },
  map: { tab: "home", section: "map", title: "Map", what: "One region per project: open work, fog where nothing moved, the trail to the next deadline", at: [0, 12, 12, 8] },
  timeline: { tab: "home", section: "timeline", title: "Timeline", what: "Milestones, due dates, sprints and planned blocks, 10 weeks", at: [0, 20, 12, 8] },
  milestones: { tab: "home", section: "timeline", title: "Upcoming milestones", what: "The next dated milestones from each PRD", at: [0, 28, 7, 4] },
  calendar: { tab: "home", section: "timeline", title: "This week", what: "Calendar events and planned focus, 7 days", at: [7, 28, 5, 4] },
  burnups: { tab: "home", section: "stats", title: "Will each project make its next deadline?", what: "Burn-ups against each next milestone", at: [0, 32, 12, 4] },
  pace: { tab: "home", section: "stats", title: "Pace vs needed", what: "Items finished per week against what the next deadline needs", at: [0, 36, 6, 5] },
  owners: { tab: "home", section: "stats", title: "Who it's waiting on", what: "Open checklist items by owner", at: [6, 36, 6, 5] },
  finished: { tab: "home", section: "stats", title: "Finished per week", what: "Checklist items done, last 4 weeks", at: [0, 41, 6, 5] },
  daily: { tab: "home", section: "stats", title: "Added and finished", what: "Items added and finished per day, week or month", at: [6, 41, 6, 5] },
  rhythm: { tab: "home", section: "stats", title: "Your rhythm", what: "Items finished, todos ticked and messages sent per day", at: [0, 46, 6, 4] },
  ahead: { tab: "home", section: "stats", title: "Work ahead", what: "Open items due in the next 4 weeks", at: [6, 46, 6, 5] },
  time: { tab: "home", section: "stats", title: "Where your time went", what: "Active minutes in Claude sessions per project, last week", at: [0, 51, 6, 4] },
  inbox: { tab: "home", section: "overview", title: "Inbox", what: "The latest messages with Claude and where they stand", at: [6, 51, 6, 4] },
};

/** Where an old `?tab=` link lands on the one page. */
export const OLD_TAB_ANCHOR: Record<string, string> = { overview: "box-top3", timeline: "box-timeline", stats: "box-burnups", map: "box-map" };

export const isTab = (t: unknown): t is Tab => typeof t === "string" && (TABS as readonly string[]).includes(t);
export const defaultTab = (tab: Tab): Place[] => Object.entries(BOXES).filter(([, b]) => b.tab === tab).map(([id, b]) => ({ id, x: b.at[0], y: b.at[1], w: b.at[2], h: b.at[3] }));
export const defaultLayout = (): Layout => ({ home: defaultTab("home") });

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
  return { home: o.home ? sanitizeTab("home", o.home) : defaultTab("home") };
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
