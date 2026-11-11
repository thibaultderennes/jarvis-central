// What the map says about a project, in words: the Village type every map view draws from, each part's line and link,
// and the one status that matters now. The colony (components/Colony.tsx) and the list cards share these.
import { SOON_DAYS, type Region } from "@/lib/map";
import type { BankState, HallTier, HomesState, MapEvent, PartKey, PoliceState, ShopState, WorkshopState } from "@/lib/villages";

export type OpenItem = { id: string; title: string; due: string | null; tone: "bad" | "warn" | "ok"; owner: string | null };
export type Village = Region & {
  land: { weight: number; onTime: number; late: number; undated: number }; onTimeAll: number; top: boolean;
  paused?: boolean;
  events?: (MapEvent & { ago: string })[];
  /** Open items, the most pressing first: the crates on the square. */
  openItems?: OpenItem[];
  /** What Claude is doing here: builds running, pull requests waiting for you, builds that stopped (open items only). */
  claude?: { working: string[]; waiting: { title: string; url: string | null }[]; failed: string[] };
  /** Open items at the end of each of the last weeks, and items finished in each (oldest first). */
  series?: { date: string; open: number; done: number }[];
  /** Deadlines already behind this project. */
  milestones?: number;
  hall: { tier: HallTier; since: number; next: number | null };
  police: PoliceState; bank: BankState; shop: ShopState; homes: HomesState; workshop: WorkshopState;
};

const n = (v: number, one: string, many = one + "s") => `${v} ${v === 1 ? one : many}`;
const until = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const fmtN = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString("en-US") : String(Math.round(v * 100) / 100));
const METRIC: Record<string, string> = { visits: "Visitors", signups: "Signups", active_users: "Active users", users: "Users", paying_users: "Paying users", mrr: "MRR", revenue: "Revenue" };
const LEVEL: Record<string, string> = { calm: "all clear", amber: "warnings to fix", red: "critical or failing" };

/** The full spoken summary of one project (the list view's card). */
export function regionLabel(r: Region): string {
  const t = r.trail;
  const quiet = r.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(r.quietDays, "day")}: nothing finished`;
  return `${r.name}: ${n(r.open, "open item")}, ${r.overdue} overdue${r.next ? `, next deadline ${r.next.label} ${until(r.next.daysLeft)}` : ""}${t?.pct != null ? `, ${t.pct}% ground taken` : ""}${r.review?.verdict ? `, latest review ${r.review.verdict.replace("-", " ")}` : ""}${r.fog ? `, ${quiet.toLowerCase()}` : ""}`;
}

export function partHref(v: Village, key: PartKey): string {
  const base = `/p/${encodeURIComponent(v.id)}`;
  if (key === "police") return `${base}?v=docs&k=security`;
  if (key === "bank") return `${base}?v=finance`;
  if (key === "shop" || key === "homes") return `${base}?v=stats`;
  if (key === "workshop" && v.workshop.built && v.workshop.prUrl) return v.workshop.prUrl;
  return `${base}?v=checklist`;
}

type Tone = "bad" | "warn" | "ok" | "none";
const PART_NAME: Record<PartKey, string> = { hall: "Checklist", police: "Security", bank: "Money", shop: "Growth", homes: "Customers", workshop: "Builds" };
const PART_ORDER: PartKey[] = ["hall", "workshop", "police", "bank", "shop", "homes"];

/** What one building says in a few words, and how loud it should be. */
export function partChip(v: Village, key: PartKey): { text: string; tone: Tone } {
  switch (key) {
    case "hall": return v.overdue ? { text: `${v.open} open, ${v.overdue} overdue`, tone: "bad" } : v.dueSoon ? { text: `${v.open} open, ${v.dueSoon} due in ${SOON_DAYS} days`, tone: "warn" } : { text: `${v.open} open`, tone: "ok" };
    case "police": return !v.police.built ? { text: "No audit yet", tone: "none" } : { text: LEVEL[v.police.level].replace(/^./, (c) => c.toUpperCase()), tone: v.police.level === "red" ? "bad" : v.police.level === "amber" ? "warn" : "ok" };
    case "bank": return !v.bank.built ? { text: "Nothing recorded", tone: "none" } : { text: v.bank.costs.length ? `${v.bank.costs.map((c) => `${fmtN(c.monthly)} ${c.currency}`).join(" + ")} a month` : "No recurring costs", tone: v.bank.costSign ? "warn" : "ok" };
    case "shop": return !v.shop.built ? { text: "No numbers yet", tone: "none" } : { text: `${METRIC[v.shop.metric] || v.shop.metric} ${fmtN(v.shop.first.value)} to ${fmtN(v.shop.last.value)}`, tone: v.shop.trend === "down" ? "warn" : "ok" };
    case "homes": return !v.homes.built ? { text: "No users recorded", tone: "none" } : { text: `${fmtN(v.homes.count)} ${METRIC[v.homes.metric].toLowerCase()}`, tone: "ok" };
    case "workshop": return !v.workshop.built ? { text: "No code repository", tone: "none" } : v.workshop.failed.length ? { text: `${n(v.workshop.failed.length, "build")} stopped`, tone: "bad" } : v.workshop.waiting ? { text: `${n(v.workshop.waiting, "pull request")} waiting for you`, tone: "warn" } : { text: v.workshop.running ? `${n(v.workshop.running, "build")} running` : "Nothing building", tone: "ok" };
  }
}

/** The one thing to know about a project right now. */
export function plotStatus(v: Village): { text: string; tone: Tone } {
  if (v.paused) return { text: "Paused", tone: "none" };
  if (v.overdue) return { text: `${v.overdue} overdue`, tone: "bad" };
  if (v.dueSoon) return { text: `${v.dueSoon} due in ${SOON_DAYS} days`, tone: "warn" };
  if (v.fog) return { text: v.quietDays === null ? "Nothing finished yet" : `Quiet for ${n(v.quietDays, "day")}`, tone: "none" };
  return { text: "Nothing due this week", tone: "ok" };
}

