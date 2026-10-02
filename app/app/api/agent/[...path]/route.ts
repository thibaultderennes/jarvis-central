import { NextResponse, type NextRequest } from "next/server";
import { agentOk } from "@/lib/auth";
import * as D from "@/lib/data";
import { getEvents as getCalendar } from "@/lib/calendar";
import { isDate } from "@/lib/time";
import { getPlan, savePlan } from "@/lib/plan";

type Ctx = { params: Promise<{ path: string[] }> };
const J = (v: unknown, status = 200) => NextResponse.json(v, { status });
const bad = (msg: string, status = 400) => J({ error: msg }, status);

async function handle(req: NextRequest, ctx: Ctx) {
  if (!agentOk(req)) return bad("Unauthorized", 401);
  const [res] = (await ctx.params).path;
  const m = req.method, sp = req.nextUrl.searchParams;
  const body = m === "GET" || m === "DELETE" ? {} : await req.json().catch(() => null);
  if (body === null) return bad("Body must be JSON");
  const b = body as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

  switch (`${m} ${res}`) {
    case "GET projects": return J(await D.getProjects(sp.get("all") === "1"));
    case "PUT projects": if (!b.id) return bad("id required"); return J({ project: await D.upsertProject(b as D.Project) });

    case "GET items": return J(await D.getItems({ project: sp.get("project") || undefined, open: sp.get("open") === "1", refine: sp.get("refine") || undefined, build: sp.get("build") || undefined }));
    case "POST items": {
      if (!b.project_id || !b.section || !b.title) return bad("project_id, section and title are required");
      if (b.due && !isDate(b.due)) return bad("due must be YYYY-MM-DD");
      try { return J({ item: await D.addItem(b as never, "agent") }, 201); }
      catch (e) { if (e instanceof D.DuplicateError) return J({ error: e.message, duplicate: e.item }, 409); throw e; }
    }
    case "GET duplicates": {
      // Exact duplicates (same normalised title) within each project, oldest first; cancelled items excluded.
      const items = (await D.getItems({ project: sp.get("project") || undefined })).filter((i) => i.status !== "cancelled");
      const groups = new Map<string, D.Item[]>();
      for (const i of items) { const k = `${i.project_id}\u0000${D.normTitle(i.title)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(i); }
      return J([...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((a, b) => a.created_at.localeCompare(b.created_at))));
    }
    case "PATCH items": {
      if (!b.project_id || !b.id) return bad("project_id and id are required");
      if (b.status && !["todo", "doing", "done", "cancelled"].includes(b.status)) return bad("status must be todo, doing, done or cancelled");
      if (b.build_status !== undefined && b.build_status !== null && !["working", "pr_open", "merge_requested", "merged", "failed", "sent_back"].includes(b.build_status)) return bad("bad build_status");
      if (b.due && !isDate(b.due)) return bad("due must be YYYY-MM-DD");
      const { project_id, id, ...patch } = b;
      const it = await D.updateItem(project_id, id, patch, "agent");
      return it ? J({ item: it }) : bad("No such item", 404);
    }
    case "DELETE items": {
      const p = sp.get("project"), id = sp.get("id");
      if (!p || !id) return bad("project and id are required");
      await D.deleteItem(p, id); return J({ ok: true });
    }
    case "GET events": return J(await D.getEvents(sp.get("since") || new Date(Date.now() - 7 * 864e5).toISOString()));

    case "GET todos": {
      const from = sp.get("from"), to = sp.get("to");
      if (!isDate(from) || !isDate(to)) return bad("from and to (YYYY-MM-DD) are required");
      return J(await D.getTodos(from, to, sp.get("someday") === "1"));
    }
    case "POST todos": {
      if (!b.title) return bad("title required");
      if (b.date && !isDate(b.date)) return bad("date must be YYYY-MM-DD");
      return J({ todo: await D.addTodo({ ...b, date: b.date || null } as never) }, 201);
    }

    case "GET messages": return J(await D.getMessages({ thread: sp.get("thread") || undefined, review: sp.get("review") || undefined, status: sp.get("status") || undefined, limit: +(sp.get("limit") || (sp.get("since") ? 200 : 20)), since: sp.get("since") || undefined, includeArchived: true }));
    case "POST messages": {
      // The agent can leave a note in the inbox (e.g. "I refined your new item"), already answered — or queue work for
      // the worker (status 'new', mode 'build', item_id): the build run of an in-progress item.
      if (!b.text) return bad("text required");
      if (b.status && !["new", "answered", "done", "needs_you"].includes(b.status)) return bad("bad status");
      return J({ message: await D.insertMessage({ text: String(b.text), project_id: b.project_id, status: b.status, reply: b.reply, meta: b.meta, mode: b.mode, item_id: b.item_id, thread_id: b.thread_id }) }, 201);
    }
    case "PATCH messages": {
      if (!b.id) return bad("id required");
      const msg = await D.patchMessage(b.id, b);
      return msg ? J({ message: msg }) : bad("No such message", 404);
    }
    case "GET stats": {
      const bucket = sp.get("bucket") || "day";
      if (!(bucket in D.STAT_BUCKETS)) return bad("bucket must be day, week or month");
      return J(await D.dailyStats(+(sp.get("n") || sp.get("days") || 0) || undefined, sp.get("project") || undefined, { bucket: bucket as D.StatBucket, items: sp.get("items") === "1" }));
    }

    case "GET costs": return J(await D.getCosts({ project: sp.has("project") ? sp.get("project") || null : undefined, all: sp.get("all") === "1" }));
    case "POST costs": {
      if (!b.name || b.amount === undefined) return bad("name and amount are required");
      if (b.next_renewal && !isDate(b.next_renewal)) return bad("next_renewal must be YYYY-MM-DD");
      return J({ cost: await D.addCost(b as never) }, 201);
    }
    case "PATCH costs": {
      if (!b.id) return bad("id required");
      if (b.next_renewal && !isDate(b.next_renewal)) return bad("next_renewal must be YYYY-MM-DD");
      const c = await D.updateCost(b.id, b);
      return c ? J({ cost: c }) : bad("No such cost", 404);
    }
    case "DELETE costs": { const id = sp.get("id"); if (!id) return bad("id required"); await D.deleteCost(id); return J({ ok: true }); }

    case "GET reviews": if (sp.get("id")) { const r = await D.getReview(sp.get("id")!); return r ? J([r]) : J([]); }
      return J(await D.getReviews({ type: sp.get("type") || undefined, project: sp.get("project") || undefined, limit: +(sp.get("limit") || 20), week: sp.get("week") || undefined }));
    case "POST reviews": {
      if (!b.type || !b.title || typeof b.body_md !== "string") return bad("type, title and body_md are required");
      if (!["project", "recap", "coaching", "jarvis", "doc", "security"].includes(b.type)) return bad("unknown review type");
      if (b.week_start && !isDate(b.week_start)) return bad("week_start must be YYYY-MM-DD");
      return J({ review: await D.upsertReview(b as never) }, 201);
    }

    case "POST heartbeat": {
      const w = b.worker === "weekly" ? "weekly" : "worker";
      await D.kvSet(`${w}.heartbeat`, { at: new Date().toISOString(), info: b.info || {} });
      return J({ ok: true });
    }
    case "GET activity": return J(await D.getActivity(sp.get("since") || new Date(Date.now() - 7 * 864e5).toISOString()));
    case "GET calendar": {
      const from = sp.get("from"), to = sp.get("to");
      if (!isDate(from) || !isDate(to)) return bad("from and to (YYYY-MM-DD) are required");
      const r = await getCalendar(from, to);
      return r.error ? J({ error: r.error, events: [] }, 502) : J(r.events);
    }

    case "GET kv": {
      const k = sp.get("key"); if (!k) return bad("key required");
      const v = await D.kvGet(k); return v ? J({ key: k, ...v }) : bad("No such key", 404);
    }
    case "PUT kv": if (!b.key) return bad("key required"); await D.kvSet(b.key, b.value ?? null); return J({ ok: true });
    case "GET plan": {
      const w = sp.get("week"); if (!isDate(w)) return bad("week (YYYY-MM-DD, a Monday) required");
      const pl = await getPlan(w); return pl ? J(pl) : bad("No plan for that week", 404);
    }
    case "POST plan": {
      if (!isDate(b.week_start) || !Array.isArray(b.blocks)) return bad("week_start and blocks are required");
      return J({ plan: await savePlan(b as never) }, 201);
    }
    case "POST import": {
      const counts = { projects: 0, items: 0, reviews: 0 };
      for (const p of b.projects || []) { await D.upsertProject(p); counts.projects++; }
      for (const it of b.items || []) {
        const { sql } = await import("@/lib/db");
        await sql()`insert into items (project_id, id, section, title, detail, status, due, owner, critical, sort, note, created_at, updated_at, done_at)
          values (${it.project_id}, ${it.id}, ${it.section}, ${it.title}, ${it.detail || ""}, ${it.status || "todo"}, ${it.due || null},
                  ${it.owner || null}, ${!!it.critical}, ${it.sort ?? 100}, ${it.note || ""}, ${it.created_at || new Date().toISOString()},
                  ${it.updated_at || new Date().toISOString()}, ${it.done_at || null})
          on conflict (project_id, id) do update set section = excluded.section, title = excluded.title, detail = excluded.detail,
            status = excluded.status, due = excluded.due, owner = excluded.owner, critical = excluded.critical, sort = excluded.sort,
            note = excluded.note, updated_at = excluded.updated_at, done_at = excluded.done_at`;
        counts.items++;
      }
      for (const r of b.reviews || []) { await D.upsertReview(r); counts.reviews++; }
      return J({ counts });
    }
  }
  return bad(`No route ${m} /api/agent/${res}`, 404);
}

export const GET = handle, POST = handle, PUT = handle, PATCH = handle, DELETE = handle;
export const maxDuration = 60;
