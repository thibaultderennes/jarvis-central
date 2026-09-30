#!/usr/bin/env node
// Jarvis CLI: lets Claude Code sessions (and the worker) read and edit checklists, todos, inbox and reviews.
import { api, qs, todayTZ, addDays, TZ } from "./lib.mjs";
import { AUDITS_DIR, newestFirst } from "./audits.mjs";

const HELP = `jarvis — Jarvis Central Dashboard from the terminal

  projects                                        list projects
  items <project> [--open] [--section S]          checklist items
  item <project> <id>                             one item in full
  set <project> <id> key=value ...                status|due|title|detail|note|section|owner|critical=true/false
  add <project> <section> "title" [--due D] [--owner founder|claude|both] [--detail T] [--critical]
  inbox [--project P] [--all]                     messages (default: new/seen/working)
  reply <message-id> "text" [--status answered|done|needs_you]
  todo add "title" [--date D|today|tomorrow] [--time HH:MM] [--project P] [--item ID] [--life]
  todos [--from D] [--to D]                       default: today → +6 days
  reviews [--type project|recap|coaching|jarvis|doc|security] [--project P] [--limit N] [--full]
  audits <project>                                security audit reports synced from ${AUDITS_DIR}/ (newest first)

  --json on any read command prints raw JSON. Dates are YYYY-MM-DD (${TZ}).
  owner "founder" means you, the person who owns the dashboard.`;

function parse(argv) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--") && !["open", "all", "json", "critical", "life", "full"].includes(k)) { flags[k] = next; i++; }
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
  const bits = [`[${i.id}]`, pad(i.status, 5), pad(i.due || "—", 10), pad(i.owner || "—", 7), i.critical ? "CRIT" : "    ", "—", i.title];
  let s = bits.join(" ");
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
        if (!["status", "due", "title", "detail", "note", "section", "owner", "critical"].includes(k)) { out(`Unknown field ${k}`); process.exit(2); }
        if (k === "critical") v = v === "true";
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
      const { item } = await api("POST", "/api/agent/items", body);
      return out(json ? JSON.stringify(item, null, 2) : "Added " + itemLine(item));
    }
    case "inbox": {
      let ms = [];
      if (flags.all) ms = await api("GET", "/api/agent/messages" + qs({ since: new Date(Date.now() - 14 * 864e5).toISOString() }));
      else for (const s of ["new", "seen", "working"]) ms.push(...(await api("GET", "/api/agent/messages" + qs({ status: s, limit: 50 }))));
      if (flags.project) ms = ms.filter((m) => !m.project_id || m.project_id === flags.project);
      if (json) return out(JSON.stringify(ms, null, 2));
      if (!ms.length) return out("Inbox empty.");
      for (const m of ms) {
        out(`${m.id}  ${pad(m.status, 9)} ${m.project_id || "any"}  ${m.created_at}`);
        out(`  ${m.text.replace(/\n/g, "\n  ")}`);
        if (m.reply) out(`  ↳ ${m.reply.slice(0, 400).replace(/\n/g, "\n    ")}`);
      }
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
        out(`${t.done ? "[x]" : "[ ]"} ${t.time ? t.time + " " : ""}${t.title}${t.kind === "life" ? "  (life)" : t.project_id ? `  (${t.project_id}${t.item_id ? "/" + t.item_id : ""})` : ""}`);
      }
      if (!ts.length) out("No todos in that range.");
      return;
    }
    case "reviews": {
      const rs = await api("GET", "/api/agent/reviews" + qs({ type: flags.type, project: flags.project, limit: flags.limit || 5 }));
      if (json) return out(JSON.stringify(rs, null, 2));
      for (const r of rs) out(`${r.id}  ${pad(r.type, 8)} ${pad(r.project_id || "—", 10)} ${r.week_start || ""} ${r.verdict ? `[${r.verdict}] ` : ""}${r.title}${r.headline ? ` — ${r.headline}` : ""}`);
      if (flags.full && rs[0]) out(`\n${rs[0].body_md}`);
      if (!rs.length) out("No reviews.");
      return;
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
    case undefined: case "help": case "-h":
      return out(HELP);
    default:
      out(`Unknown command "${cmd}".\n\n${HELP}`); process.exit(2);
  }
}

main().catch((e) => { process.stderr.write(`jarvis: ${e.message}\n`); process.exit(1); });
