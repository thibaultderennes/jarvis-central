import { q } from "./db";
import { getProjects, splitFeatured, displayColor } from "./data";

export type SearchItem = { project_id: string; id: string; title: string; status: string; due: string | null; section: string };
export type SearchProject = { id: string; name: string; color: string; tagline: string };

/** Lower-case, accents stripped, punctuation → spaces. The same folding runs in SQL below. */
export const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const FROM = "àáâãäåāçćčèéêëēěìíîïīñńòóôõöøōùúûüūýÿžśšł", TO = "aaaaaaaccceeeeeeiiiiinnooooooouuuuuyyzssl";

/** Active projects for the palette, with the colour they show everywhere else. */
export async function paletteProjects(): Promise<SearchProject[]> {
  const ps = await getProjects(), top = new Set(splitFeatured(ps).featured.map((p) => p.id));
  return ps.map((p) => ({ id: p.id, name: p.name, color: displayColor(p, top), tagline: p.tagline || p.status || "" }));
}

/** Items whose id or title contain every word of the query (case- and accent-insensitive); open first, best match first. */
export async function searchItems(query: string, limit = 20): Promise<SearchItem[]> {
  const words = fold(query).split(" ").filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const params: unknown[] = [FROM, TO];
  const conds = words.map((w) => { params.push(`%${w}%`); return `(replace(i.id, '-', ' ') like $${params.length} or translate(lower(i.title), $1, $2) like $${params.length})`; });
  const rows = await q<Omit<SearchItem, "due"> & { due: unknown }>(`select i.project_id, i.id, i.title, i.status, i.due, i.section from items i
    join projects p on p.id = i.project_id and not p.archived
    where ${conds.join(" and ")}
    order by (i.status in ('todo', 'doing')) desc, i.updated_at desc limit 200`, params);
  const qs = words.join(" "), qid = words.join("-");
  const score = (r: SearchItem) => {
    const t = fold(r.title), open = r.status === "todo" || r.status === "doing";
    return (open ? 100 : 0) + (r.id === qid ? 60 : r.id.startsWith(qid) ? 40 : 0) + (t.startsWith(qs) ? 20 : (" " + t).includes(" " + qs) ? 10 : 0)
      + words.filter((w) => (" " + t).includes(" " + w)).length;
  };
  return rows.map((r): SearchItem => ({ ...r, due: r.due == null ? null : r.due instanceof Date ? r.due.toISOString().slice(0, 10) : String(r.due).slice(0, 10) }))
    .map((r) => ({ r, s: score(r) })).sort((a, b) => b.s - a.s || (a.r.due || "9").localeCompare(b.r.due || "9")).slice(0, limit).map((x) => x.r);
}
