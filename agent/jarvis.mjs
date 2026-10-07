#!/usr/bin/env node
// Jarvis CLI: lets Claude Code sessions (and the worker) read and edit checklists, todos, inbox and reviews.
import { api, qs, todayTZ, addDays, TZ } from "./lib.mjs";
import { AUDITS_DIR, newestFirst } from "./audits.mjs";

const HELP = `jarvis — Jarvis Central Dashboard from the terminal

  projects                                        list projects
  items <project> [--open] [--section S]          checklist items
  item <project> <id>                             one item in full
  set <project> <id> key=value ...                status(todo|doing|done|cancelled)|due|title|detail|note|section|owner|critical=true/false|blocked_by=a,b
  add <project> <section> "title" [--due D] [--owner founder|claude|both] [--detail T] [--critical] [--force]
  cancel <project> <id> [--reason T] [--dup ID]   cancel an item (kept under "Show completed"); --dup = the item it duplicates
  dupes [--project P] [--cancel]                  exact duplicate titles per project; --cancel keeps the oldest, cancels the rest
  builds [--project P]                            in-progress items Claude is building (build status, PR)
  inbox [--project P] [--all]                     messages waiting for Claude, then replies you haven't treated (pending)
  reply <message-id> "text" [--status answered|done|needs_you]
  todo add "title" [--date D|today|tomorrow] [--time HH:MM] [--project P] [--item ID] [--life]
  todos [--from D] [--to D]                       default: today → +6 days
  reviews [--type project|recap|coaching|jarvis|doc|security|screening] [--project P] [--limit N] [--unacked] [--full]
                                                  "new" marks the ones not acknowledged yet (Docs and reviews on the site)
  ack <review-id> | unack <review-id>             acknowledge a report (it leaves the new count), or make it new again
  proposals <review-id>                           the tasks a review proposes: already on the checklist, pushed, or to push (with a key)
  push <review-id> <key> [--section S] [--owner founder|claude|both] [--estimate MIN]   push one proposal to the checklist (never twice)
  audits <project>                                security audit reports synced from ${AUDITS_DIR}/ (newest first)
  stats [--bucket day|week|month] [--n N] [--project P] [--items]   added / finished / cancelled per bucket (14 days, 12 weeks, 12 months)
  metrics <project> [--days N]                    product numbers per snapshot (users, active_users, visits, revenue…)
  metrics <project> --set k=v [--set k=v ...] [--date D]   record numbers by hand (merged into that day; k= with no value removes k)
  costs [--project P|none] [--all]              recurring costs (finance); "none" = independent of any project
  cost add "name" --amount N [--period week|month|year] [--currency USD] [--project P] [--renews D] [--notes T]
  cost set <id> key=value ...                     name|amount|period|currency|project|renews|notes|active=true/false
  cost rm <id>
  sprints <project>                               the project's sprints: dates, items, done, estimate
  sprint add <project> "name" --start D --end D [--items a,b]   a sprint (one project) with these items
  sprint set <id> [--name T] [--start D] [--end D] [--add a,b] [--remove a,b]
  sprint rm <id>                                  delete the sprint (its items stay, just unplanned)

  --json on any read command prints raw JSON. Dates are YYYY-MM-DD (${TZ}).
  owner "founder" means you, the person who owns the dashboard.`;

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && !["open", "all", "json", "critical", "life", "full", "force", "cancel", "items", "unacked"].includes(k)) { flags[k] = next; i++; }
      else flags[k] = true;
    } else pos.push(a);
  }
  return { pos, flags };
}
const out = (x) => process.stdout.write(x + "\n");
const pad = (s, n) => String(s ?? "").padEnd(n);
const date = (v) => (v === "today" ? todayTZ() : v === "tomorrow" ? addDays(todayTZ(), 1) : v);
const need = (v, what) => { if (v === undefined || v === true || v === "") { out(`Missing ${what}.\n\n${HELP}`); process.exit(2); } return v; };

function itemLine(i) {
  const bits = [`[${i.id}]`, pad(i.status === "cancelled" ? "cancl" : i.status, 5), pad(i.due || "—", 10), pad(i.owner || "—", 7), i.critical ? "CRIT" : "    ", "—", i.title];
  let s = bits.join(" ");
  if (i.status === "cancelled") s += `\n      cancelled${i.duplicate_of ? ` (duplicate of ${i.duplicate_of})` : ""}${i.cancel_reason ? `: ${i.cancel_reason}` : ""}`;
  if (i.build_status) s += `\n      build: ${i.build_status}${i.pr_url ? ` ${i.pr_url}` : ""}${i.build_note ? ` — ${i.build_note.replace(/\n/g, " ").slice(0, 200)}` : ""}`;
  if (i.note) s += `\n      note: ${i.note.replace(/\n/g, " ")}`;
  if (i.refine_request) s += `\n      comment for Claude (pending): ${i.refine_request.replace(/\n/g, " / ")}`;
  return s;
}

async function main() {
  const { pos, flags } = parse(process.argv.slice(2));
  const [cmd, ...rest] = pos;
  const json = !!flags.json;
  switch (cmd) {
    case "projects": {
      const ps = await api("GET", "/api/agent/projects");
      if (json) return out(JSON.stringify(ps, null, 2));
      for (const p of ps) out(`${pad(p.id, 12)} ${pad(p.kind, 9)} ${p.name}${p.dir ? `  (${p.dir})` : ""}${p.state ? `  [${p.state}]` : ""}`);
      return;
    }
    case "items": {
      const project = need(rest[0], "<project>");
      let items = await api("GET", "/api/agent/items" + qs({ project, open: flags.open ? 1 : "" }));
      if (flags.section) items = items.filter((i) => i.section === flags.section);
      if (json) return out(JSON.stringify(items, null, 2));
      let sec = null;
      for (const i of items.sort((a, b) => a.section.localeCompare(b.section) || (a.sort ?? 0) - (b.sort ?? 0))) {
        if (i.section !== sec) { sec = i.section; out(`\n# ${sec}`); }
        out(itemLine(i));
      }
      out(`\n${items.length} items`);
      return;
    }
    case "item": {
      const project = need(rest[0], "<project>"), id = need(rest[1], "<id>");
      const items = await api("GET", "/api/agent/items" + qs({ project }));
      const i = items.find((x) => x.id === id);
      if (!i) { out(`No item ${id} in ${project}.`); process.exit(1); }
      if (json) return out(JSON.stringify(i, null, 2));
      out(itemLine(i));
      out(`section: ${i.section}\nupdated: ${i.updated_at || "—"}${i.done_at ? `\ndone: ${i.done_at}` : ""}`);
      if (i.detail) out(`\n${i.detail}`);
      return;
    }
    case "set": {
      const project = need(rest[0], "<project>"), id = need(rest[1], "<id>");
      const body = { project_id: project, id };
      for (const kv of rest.slice(2)) {
        const m = kv.match(/^(\w+)=([\s\S]*)$/);
        if (!m) { out(`Bad pair "${kv}", expected key=value`); process.exit(2); }
        let [, k, v] = m;
        if (!["status", "due", "title", "detail", "note", "section", "owner", "critical", "cancel_reason", "duplicate_of", "priority", "estimate_minutes", "blocked_by"].includes(k)) { out(`Unknown field ${k}`); process.exit(2); }
        if (k === "priority" || k === "estimate_minutes") v = Number(v);
        if (k === "critical") v = v === "true";
        if (k === "blocked_by") v = v.split(",").map((x) => x.trim()).filter(Boolean); // "" clears
        if (k === "due") v = v === "" || v === "none" ? null : date(v);
        body[k] = v;
      }
      const { item } = await api("PATCH", "/api/agent/items", body);
      return out(json ? JSON.stringify(item, null, 2) : "Updated " + itemLine(item));
    }
    case "add": {
      const project = need(rest[0], "<project>"), section = need(rest[1], "<section>"), title = need(rest[2], '"title"');
      const body = { project_id: project, section, title };
      if (flags.due) body.due = date(flags.due);
      if (flags.owner) body.owner = flags.owner;
      if (flags.detail) body.detail = flags.detail;
      if (flags.critical) body.critical = true;
      if (flags.id) body.id = flags.id;
      if (flags.force) body.allow_duplicate = true;
      try {
        const { item } = await api("POST", "/api/agent/items", body);
        return out(json ? JSON.stringify(item, null, 2) : "Added " + itemLine(item));
      } catch (e) {
        if (e.status === 409 && e.body?.duplicate) { out(`Not added: already on the checklist as [${e.body.duplicate.id}] "${e.body.duplicate.title}". Use --force to add it anyway.`); process.exit(1); }
        throw e;
      }
    }
    case "cancel": {
      const project = need(rest[0], "<project>"), id = need(rest[1], "<id>");
      const body = { project_id: project, id, status: "cancelled", cancel_reason: flags.reason || "", duplicate_of: flags.dup || null };
      const { item } = await api("PATCH", "/api/agent/items", body);
      return out(json ? JSON.stringify(item, null, 2) : "Cancelled " + itemLine(item));
    }
    case "dupes": {
      const groups = await api("GET", "/api/agent/duplicates" + qs({ project: flags.project }));
      if (json) return out(JSON.stringify(groups, null, 2));
      if (!groups.length) return out("No exact duplicates.");
      for (const g of groups) {
        out(`\n${g[0].project_id}: "${g[0].title}" × ${g.length}`);
        for (const [n, i] of g.entries()) {
          const keep = n === 0;
          out(`  ${keep ? "keep  " : "cancel"} [${i.id}] ${i.status} due ${i.due || "—"} created ${String(i.created_at).slice(0, 10)}`);
          if (!keep && flags.cancel) await api("PATCH", "/api/agent/items", { project_id: i.project_id, id: i.id, status: "cancelled", cancel_reason: "Duplicate", duplicate_of: g[0].id });
        }
      }
      out(flags.cancel ? "\nDuplicates cancelled (the oldest of each group kept)." : "\nDry run: add --cancel to cancel every copy but the oldest.");
      return;
    }
    case "builds": {
      let items = await api("GET", "/api/agent/items" + qs({ project: flags.project, open: 1 }));
      items = items.filter((i) => i.status === "doing" && ["claude", "both"].includes(i.owner || ""));
      if (json) return out(JSON.stringify(items, null, 2));
      if (!items.length) return out("No in-progress items owned by Claude.");
      for (const i of items) out(`${pad(i.project_id, 12)} [${i.id}] ${pad(i.build_status || "queued", 15)} ${i.pr_url || ""}  ${i.title}`);
      return;
    }
    case "inbox": {
      let ms = [];
      if (flags.all) ms = await api("GET", "/api/agent/messages" + qs({ since: new Date(Date.now() - 14 * 864e5).toISOString() }));
      else for (const s of ["new", "seen", "working"]) ms.push(...(await api("GET", "/api/agent/messages" + qs({ status: s, limit: 50 }))));
      // Replies the owner opened but hasn't marked treated: pending on their side, shown so a session knows what's in the air.
      const recent = flags.all ? [] : await api("GET", "/api/agent/messages" + qs({ since: new Date(Date.now() - 14 * 864e5).toISOString() })).catch(() => []);
      let pending = recent.filter((m) => m.opened_at && !m.treated_at && !m.archived && !["new", "seen", "working"].includes(m.status));
      if (flags.project) { ms = ms.filter((m) => !m.project_id || m.project_id === flags.project); pending = pending.filter((m) => !m.project_id || m.project_id === flags.project); }
      if (json) return out(JSON.stringify(flags.all ? ms : { waiting: ms, pending }, null, 2));
      if (!ms.length && !pending.length) return out("Inbox empty.");
      const show = (m) => {
        out(`${m.id}  ${pad(m.status, 9)} ${m.project_id || "any"}  ${m.created_at}`);
        out(`  ${m.text.replace(/\n/g, "\n  ")}`);
        if (m.reply) out(`  ↳ ${m.reply.slice(0, 400).replace(/\n/g, "\n    ")}`);
      };
      if (ms.length) { if (!flags.all) out(`# Waiting for Claude (${ms.length})`); for (const m of ms) show(m); }
      else if (!flags.all) out("Nothing waiting for Claude.");
      if (pending.length) { out(`\n# Pending on the owner's side (${pending.length}: replied, opened, not yet marked treated)`); for (const m of pending) show(m); }
      return;
    }
    case "reply": {
      const id = need(rest[0], "<message-id>"), text = need(rest[1], '"text"');
      const status = flags.status || "answered";
      if (!["answered", "done", "needs_you", "seen", "working"].includes(status)) { out(`Bad status ${status}`); process.exit(2); }
      const { message } = await api("PATCH", "/api/agent/messages", { id, status, reply: text });
      return out(json ? JSON.stringify(message, null, 2) : `Replied to ${id} (${message.status}).`);
    }
    case "todo": {
      if (rest[0] !== "add") { out(HELP); process.exit(2); }
      const title = need(rest[1], '"title"');
      const body = { title, date: flags.date ? date(flags.date) : todayTZ(), kind: flags.life ? "life" : "work" };
      if (flags.date === "someday") body.date = null;
      if (flags.time) body.time = flags.time;
      if (flags.project) body.project_id = flags.project;
      if (flags.item) body.item_id = flags.item;
      const { todo } = await api("POST", "/api/agent/todos", body);
      return out(json ? JSON.stringify(todo, null, 2) : `Added todo for ${todo.date || "someday"}: ${todo.title}`);
    }
    case "todos": {
      const from = date(flags.from || "today"), to = date(flags.to || addDays(from, 6));
      const ts = await api("GET", "/api/agent/todos" + qs({ from, to }));
      if (json) return out(JSON.stringify(ts, null, 2));
      let d = null;
      for (const t of ts.sort((a, b) => (a.date || "9").localeCompare(b.date || "9") || (a.sort ?? 0) - (b.sort ?? 0))) {
        if (t.date !== d) { d = t.date; out(`\n# ${d || "someday"}`); }
        out(`${t.done ? "[x]" : "[ ]"} ${t.time ? t.time + " " : ""}${t.title}${t.kind === "life" ? "  (life)" : t.project_id ? `  (${t.project_id}${t.item_id ? "/" + t.item_id : ""})` : ""}${t.rollovers ? `  carried ${t.rollovers}×` : ""}`);
      }
      if (!ts.length) out("No todos in that range.");
      return;
    }
    case "reviews": {
      const rs = await api("GET", "/api/agent/reviews" + qs({ type: flags.type, project: flags.project, limit: flags.limit || 5, unacked: flags.unacked ? "1" : undefined }));
      if (json) return out(JSON.stringify(rs, null, 2));
      for (const r of rs) out(`${r.id}  ${r.acked_at ? "   " : "new"} ${pad(r.type, 8)} ${pad(r.project_id || "—", 10)} ${r.week_start || ""} ${r.verdict ? `[${r.verdict}] ` : ""}${r.title}${r.headline ? ` — ${r.headline}` : ""}`);
      if (flags.full && rs[0]) out(`\n${rs[0].body_md}`);
      if (!rs.length) out(flags.unacked ? "No reviews waiting to be acknowledged." : "No reviews.");
      return;
    }
    case "ack": case "unack": {
      const id = need(rest[0], "<review-id>");
      const { review } = await api("PATCH", "/api/agent/reviews", { id, acked: cmd === "ack" });
      if (json) return out(JSON.stringify(review, null, 2));
      return out(`${cmd === "ack" ? "Acknowledged" : "Marked as new"}: ${review.title}`);
    }
    case "proposals": {
      const id = need(rest[0], "<review-id>");
      const ps = await api("GET", "/api/agent/proposals" + qs({ review: id }));
      if (json) return out(JSON.stringify(ps, null, 2));
      if (!ps.length) return out("This review proposes no tasks.");
      const LABEL = { pushable: "to push", pushed: "pushed", "on-checklist": "on list", text: "text" };
      for (const p of ps) {
        out(`${pad(LABEL[p.state] || p.state, 8)} ${pad(p.state === "pushable" ? p.key : "", 9)} ${p.title || p.text}${p.items.length ? `  → ${p.items.join(", ")}` : ""}`);
        if (p.state === "pushable") out(`         ${p.source}${p.section ? ` · section ${p.section}` : ""}${p.owner ? ` · ${p.owner}` : ""}${p.estimate_minutes ? ` · ~${p.estimate_minutes} min` : ""}`);
      }
      return;
    }
    case "push": {
      const id = need(rest[0], "<review-id>"), key = need(rest[1], "<key> (from: jarvis proposals <review-id>)");
      try {
        const { item } = await api("POST", "/api/agent/proposals", { review_id: id, key, section: flags.section, owner: flags.owner, estimate_minutes: flags.estimate });
        return out(json ? JSON.stringify(item, null, 2) : `Added to ${item.project_id}/${item.section}: [${item.id}] ${item.title}`);
      } catch (e) { out(`Not pushed: ${e.message}`); process.exit(1); }
    }
    case "audits": {
      const project = need(rest[0], "<project>");
      const rs = (await api("GET", "/api/agent/reviews" + qs({ type: "security", project, limit: 100 }))).sort(newestFirst);
      if (json) return out(JSON.stringify(rs, null, 2));
      if (!rs.length) return out(`No audit reports synced for ${project}. Reports in ${AUDITS_DIR}/ of the project folder appear after the next sync (node agent/audits.mjs sync).`);
      for (const r of rs) {
        out(`${pad(r.meta?.date || String(r.created_at).slice(0, 10), 10)} ${pad(r.verdict || "—", 9)} ${r.title}${r.headline ? ` — ${r.headline}` : ""}`);
        out(`           ${r.meta?.file || ""}  ${r.id}`);
      }
      return;
    }
    case "stats": {
      const s = await api("GET", "/api/agent/stats" + qs({ bucket: flags.bucket, n: flags.n, project: flags.project, items: flags.items ? 1 : "" }));
      if (json) return out(JSON.stringify(s, null, 2));
      out(`${s.bucket} buckets from ${s.from}${flags.project ? ` · ${flags.project}` : ""} · tracking since ${s.tracking_since?.slice(0, 10) || "—"} · ${s.overdue_open} open overdue today`);
      for (const d of s.days) {
        out(`${d.date}  +${pad(d.added, 4)} done ${pad(d.done, 4)}${d.done_late ? `(${d.done_late} late) ` : ""}${d.cancelled ? `cancelled ${d.cancelled}` : ""}`);
        for (const i of d.items?.added || []) out(`      + [${i.project_id}/${i.id}] ${i.title}`);
        for (const i of d.items?.done || []) out(`      ✓ [${i.project_id}/${i.id}] ${i.title}${i.late ? "  (late)" : ""}`);
      }
      return;
    }
    case "metrics": {
      const project = need(rest[0], "<project>");
      const argv = process.argv.slice(2), pairs = [];
      argv.forEach((a, i) => { if (argv[i - 1] === "--set" || (i > 1 && !a.startsWith("--") && a.includes("=") && argv[i - 1] !== "--date")) pairs.push(a); });
      if (pairs.length) {
        const metrics = {};
        for (const kv of pairs) {
          const m = kv.match(/^([a-z][a-z0-9_]{0,39})=(.*)$/);
          if (!m || (m[2] !== "" && !Number.isFinite(Number(m[2].replace(/[,_]/g, ""))))) { out(`Bad pair "${kv}": expected key=number with a lowercase key like active_users=42`); process.exit(2); }
          metrics[m[1]] = m[2] === "" ? null : Number(m[2].replace(/[,_]/g, ""));
        }
        const { snapshot } = await api("POST", "/api/agent/metrics", { project_id: project, date: flags.date ? date(flags.date) : todayTZ(), metrics, source: "manual" });
        return out(json ? JSON.stringify(snapshot, null, 2) : `Recorded ${project} ${snapshot.date}: ${Object.entries(snapshot.metrics).map(([k, v]) => `${k}=${v}`).join(" ")}`);
      }
      const days = Number(flags.days) || 90;
      const ss = await api("GET", "/api/agent/metrics" + qs({ project, since: addDays(todayTZ(), -days) }));
      if (json) return out(JSON.stringify(ss, null, 2));
      if (!ss.length) return out(`No metrics for ${project} in the last ${days} days. Record some with: jarvis metrics ${project} --set users=120 --set active_users=40 --set visits=900\nor connect a source (metrics.sources.${project} in jarvis.config.json, see docs/metrics.md).`);
      for (const s of ss) out(`${s.date}  ${pad(s.source, 8)} ${Object.entries(s.metrics).map(([k, v]) => `${k}=${v}`).join("  ")}`);
      return;
    }
    case "costs": {
      const project = flags.project === "none" ? null : flags.project;
      let path = "/api/agent/costs" + qs({ all: flags.all ? 1 : "" });
      if (project !== undefined) path += (path.includes("?") ? "&" : "?") + "project=" + encodeURIComponent(project || "");
      const cs = await api("GET", path);
      if (json) return out(JSON.stringify(cs, null, 2));
      if (!cs.length) return out("No recurring costs yet.");
      const monthly = (c) => (c.period === "week" ? (c.amount * 52) / 12 : c.period === "year" ? c.amount / 12 : c.amount);
      const totals = {};
      for (const c of cs) {
        if (c.active) totals[c.currency] = (totals[c.currency] || 0) + monthly(c);
        out(`${c.id}  ${pad(c.project_id || "independent", 14)} ${pad(c.name, 28)} ${pad(`${c.amount} ${c.currency}/${c.period}`, 18)} ${c.next_renewal ? "renews " + c.next_renewal : ""}${c.active ? "" : "  (inactive)"}`);
      }
      out(`\nMonthly: ${Object.entries(totals).map(([k, v]) => `${v.toFixed(2)} ${k}`).join(" + ") || "0"}`);
      return;
    }
    case "sprints": {
      const project = need(rest[0], "<project>");
      const [sprints, items] = await Promise.all([api("GET", "/api/agent/sprints" + qs({ project })), api("GET", "/api/agent/items" + qs({ project }))]);
      if (json) return out(JSON.stringify(sprints.map((s) => ({ ...s, items: items.filter((i) => i.sprint_id === s.id).map((i) => i.id) })), null, 2));
      if (!sprints.length) return out(`No sprints on ${project}.`);
      for (const s of sprints) {
        const its = items.filter((i) => i.sprint_id === s.id && i.status !== "cancelled"), d = its.filter((i) => i.status === "done").length;
        const est = its.reduce((a, i) => a + (i.estimate_minutes || 0), 0);
        out(`${s.start} → ${s.end}  ${s.name}  ${d}/${its.length} done${est ? ` · ~${Math.round(est / 6) / 10} h estimated` : ""}  ${s.id}`);
        for (const i of its) out(`    [${i.id}] ${i.status.padEnd(5)} ${i.title}`);
      }
      return;
    }
    case "sprint": {
      const sub = rest[0], list = (v) => String(v || "").split(",").map((x) => x.trim()).filter(Boolean);
      if (sub === "add") {
        const project = need(rest[1], "<project>"), name = need(rest[2], '"name"');
        const { sprint, items } = await api("POST", "/api/agent/sprints", { project_id: project, name, start: date(need(flags.start, "--start")), end: date(need(flags.end, "--end")), items: list(flags.items) });
        return out(json ? JSON.stringify(sprint, null, 2) : `Added sprint ${sprint.name} (${sprint.start} → ${sprint.end}) with ${items} item(s)  ${sprint.id}`);
      }
      if (sub === "set") {
        const id = need(rest[1], "<id>");
        const body = { id, name: flags.name, start: flags.start ? date(flags.start) : undefined, end: flags.end ? date(flags.end) : undefined, add: flags.add ? list(flags.add) : undefined, remove: flags.remove ? list(flags.remove) : undefined };
        const { sprint } = await api("PATCH", "/api/agent/sprints", body);
        return out(json ? JSON.stringify(sprint, null, 2) : `Updated sprint ${sprint.name} (${sprint.start} → ${sprint.end})`);
      }
      if (sub === "rm") { const id = need(rest[1], "<id>"); await api("DELETE", "/api/agent/sprints" + qs({ id })); return out(`Removed sprint ${id} (its items stay)`); }
      out(HELP); process.exit(2);
    }
    case "cost": {
      const sub = rest[0];
      if (sub === "add") {
        const name = need(rest[1], '"name"'), amount = Number(need(flags.amount, "--amount"));
        const body = { name, amount, period: flags.period || "month", currency: flags.currency || "USD", project_id: flags.project || null, next_renewal: flags.renews ? date(flags.renews) : null, notes: flags.notes || "" };
        const { cost } = await api("POST", "/api/agent/costs", body);
        return out(json ? JSON.stringify(cost, null, 2) : `Added ${cost.name}: ${cost.amount} ${cost.currency}/${cost.period}${cost.project_id ? ` (${cost.project_id})` : ""}  ${cost.id}`);
      }
      if (sub === "set") {
        const id = need(rest[1], "<id>"), body = { id };
        const map = { project: "project_id", renews: "next_renewal" };
        for (const kv of rest.slice(2)) {
          const m = kv.match(/^(\w+)=([\s\S]*)$/);
          if (!m) { out(`Bad pair "${kv}", expected key=value`); process.exit(2); }
          let [, k, v] = m; k = map[k] || k;
          if (!["name", "amount", "period", "currency", "project_id", "next_renewal", "notes", "active"].includes(k)) { out(`Unknown field ${k}`); process.exit(2); }
          if (k === "amount") v = Number(v); if (k === "active") v = v === "true"; if (k === "project_id" && (v === "" || v === "none")) v = null; if (k === "next_renewal") v = v ? date(v) : null;
          body[k] = v;
        }
        const { cost } = await api("PATCH", "/api/agent/costs", body);
        return out(json ? JSON.stringify(cost, null, 2) : `Updated ${cost.name}: ${cost.amount} ${cost.currency}/${cost.period}`);
      }
      if (sub === "rm") { const id = need(rest[1], "<id>"); await api("DELETE", "/api/agent/costs" + qs({ id })); return out(`Removed ${id}`); }
      out(HELP); process.exit(2);
    }
    case undefined: case "help": case "-h":
      return out(HELP);
    default:
      out(`Unknown command "${cmd}".\n\n${HELP}`); process.exit(2);
  }
}

main().catch((e) => { process.stderr.write(`jarvis: ${e.message}\n`); process.exit(1); });
