#!/usr/bin/env node
// Jarvis as an MCP server for Claude Code: triage from the terminal where the work is.
// Tools: what's overdue, tick an item or a todo, read this week's digest, list and push a review's proposals.
// Talks to the same agent API as jarvis.mjs (JARVIS_URL / JARVIS_AGENT_TOKEN in ~/.config/jarvis/env). No dependencies:
// MCP over stdio is newline-delimited JSON-RPC 2.0.
//   claude mcp add --scope user jarvis -- node /path/to/jarvis/agent/mcp.mjs
import readline from "node:readline";
import { api as realApi, qs, todayTZ, addDays } from "./lib.mjs";

const PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const VERSION = "1";

const str = (description, extra = {}) => ({ type: "string", description, ...extra });
const bool = (description) => ({ type: "boolean", description });
const schema = (properties, required = []) => ({ type: "object", properties, required, additionalProperties: false });

export const TOOLS = [
  {
    name: "jarvis_overdue",
    description: "Open checklist items due today or earlier (overdue first, critical first), and the owner's unticked todos from the last 14 days up to today, with the ids the tick tools take.",
    inputSchema: schema({ project: str("Only this project id (default: every project)"), owner: str("Only items with this owner", { enum: ["founder", "claude", "both"] }) }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "jarvis_tick_item",
    description: "Mark a checklist item done (or reopen it with done=false). Todos linked to it follow, as on the site.",
    inputSchema: schema({ project: str("Project id"), id: str("Item code, e.g. auth-login"), done: bool("false reopens it (status todo). Default true") }, ["project", "id"]),
  },
  {
    name: "jarvis_tick_todo",
    description: "Tick a todo (or untick it with done=false). A todo linked to a checklist item ticks the item too, as on the Today page.",
    inputSchema: schema({ id: str("Todo id (a uuid, from jarvis_overdue)"), done: bool("false unticks it. Default true") }, ["id"]),
  },
  {
    name: "jarvis_digest",
    description: "This week's digest: the latest weekly recap in full and every report of that week (id, project, verdict, headline, unread). With project: that project's latest review in full instead.",
    inputSchema: schema({ project: str("A project id: its latest review in full") }),
    annotations: { readOnlyHint: true },
  },
  {
    name: "jarvis_proposals",
    description: "The tasks a review proposes and their state: already on the checklist, pushed, or to push (with the key jarvis_push_proposal takes).",
    inputSchema: schema({ review_id: str("Review id (from jarvis_digest)") }, ["review_id"]),
    annotations: { readOnlyHint: true },
  },
  {
    name: "jarvis_push_proposal",
    description: "Push a review's proposal onto the project's checklist (never twice). Give a key, or all=true for every proposal not on the checklist yet.",
    inputSchema: schema({
      review_id: str("Review id"), key: str("Proposal key from jarvis_proposals"), all: bool("Push every pushable proposal, each with its own defaults"),
      section: str("Section id to put it in (default: the proposal's own)"), owner: str("Owner", { enum: ["founder", "claude", "both"] }),
      estimate_minutes: { type: "integer", minimum: 1, description: "Estimate in minutes" },
    }, ["review_id"]),
  },
];

const itemLine = (i, today) => `[${i.project_id}/${i.id}] ${i.due}${i.due < today ? ` (${Math.round((Date.parse(today) - Date.parse(i.due)) / 864e5)} d late)` : ""} · ${i.status} · ${i.owner || "—"}${i.critical ? " · CRITICAL" : ""} — ${i.title}`;
const todoLine = (t) => `${t.id}  ${t.date}${t.time ? " " + t.time : ""} — ${t.title}${t.kind === "life" ? " (life)" : t.project_id ? ` (${t.project_id}${t.item_id ? "/" + t.item_id : ""})` : ""}${t.rollovers ? ` · carried ${t.rollovers}×` : ""}`;
const reviewLine = (r) => `${r.id}  ${r.acked_at ? "    " : "new "}${r.type}${r.project_id ? ` · ${r.project_id}` : ""}${r.verdict ? ` · ${r.verdict}` : ""} — ${r.title}${r.headline ? `: ${r.headline}` : ""}`;

class ToolError extends Error {}
const need = (v, what) => { if (typeof v !== "string" || !v.trim()) throw new ToolError(`${what} is required.`); return v.trim(); };

/** The tools, against an api(method, path, body) like lib.mjs's. `today()` gives YYYY-MM-DD in the owner's timezone. */
export function makeTools({ api = realApi, today = todayTZ } = {}) {
  return {
    async jarvis_overdue({ project, owner } = {}) {
      const d = today();
      const [items, todos] = await Promise.all([
        api("GET", "/api/agent/items" + qs({ project, open: 1 })),
        api("GET", "/api/agent/todos" + qs({ from: addDays(d, -14), to: d })),
      ]);
      const due = items
        .filter((i) => (i.status === "todo" || i.status === "doing") && i.due && i.due <= d && (!owner || i.owner === owner))
        .sort((a, b) => a.due.localeCompare(b.due) || (b.critical ? 1 : 0) - (a.critical ? 1 : 0));
      const late = due.filter((i) => i.due < d), now = due.filter((i) => i.due === d);
      const open = todos.filter((t) => !t.done && (!project || t.project_id === project))
        .sort((a, b) => a.date.localeCompare(b.date) || (a.sort ?? 0) - (b.sort ?? 0));
      const L = [`Today is ${d}.`, "", `## Overdue items (${late.length})`, ...(late.length ? late.map((i) => itemLine(i, d)) : ["None."]),
        "", `## Items due today (${now.length})`, ...(now.length ? now.map((i) => itemLine(i, d)) : ["None."]),
        "", `## Unticked todos, last 14 days to today (${open.length})`, ...(open.length ? open.map(todoLine) : ["None."])];
      return L.join("\n");
    },
    async jarvis_tick_item({ project, id, done = true } = {}) {
      const body = { project_id: need(project, "project"), id: need(id, "id"), status: done === false ? "todo" : "done" };
      const { item } = await api("PATCH", "/api/agent/items", body);
      return `${item.status === "done" ? "Done" : "Reopened"}: [${item.project_id}/${item.id}] ${item.title}`;
    },
    async jarvis_tick_todo({ id, done = true } = {}) {
      const { todo } = await api("PATCH", "/api/agent/todos", { id: need(id, "id"), done: done !== false });
      return `${todo.done ? "Ticked" : "Unticked"}: ${todo.title}${todo.item_id ? ` (its item ${todo.project_id}/${todo.item_id} follows)` : ""}`;
    },
    async jarvis_digest({ project } = {}) {
      if (project) {
        const [r] = await api("GET", "/api/agent/reviews" + qs({ type: "project", project, limit: 1 }));
        if (!r) return `No review for ${project} yet.`;
        return [reviewLine(r), r.week_start ? `Week of ${r.week_start}` : "", "", r.body_md || ""].join("\n").trim();
      }
      const [recap] = await api("GET", "/api/agent/reviews" + qs({ type: "recap", limit: 1 }));
      if (!recap) return "No weekly recap yet: the Monday reviews haven't run.";
      const week = recap.week_start ? await api("GET", "/api/agent/reviews" + qs({ week: recap.week_start, limit: 100 })) : [recap];
      return [`# ${recap.title}`, recap.headline || "", "", `## Reports this week (${week.length})`, ...week.map(reviewLine),
        "", "Read one in full with jarvis_digest {project}; see what a review proposes with jarvis_proposals {review_id}.",
        "", "## Recap", recap.body_md || ""].join("\n").trim();
    },
    async jarvis_proposals({ review_id } = {}) {
      const ps = await api("GET", "/api/agent/proposals" + qs({ review: need(review_id, "review_id") }));
      if (!ps.length) return "This review proposes no tasks.";
      const LABEL = { pushable: "to push", pushed: "pushed", "on-checklist": "on the checklist", text: "text only" };
      return ps.map((p) => `${LABEL[p.state] || p.state}${p.state === "pushable" ? ` · key ${p.key}` : ""} — ${p.title || p.text}${p.items?.length ? ` → ${p.items.join(", ")}` : ""}${p.state === "pushable" && (p.section || p.owner) ? ` (${[p.section && "section " + p.section, p.owner].filter(Boolean).join(", ")})` : ""}`).join("\n");
    },
    async jarvis_push_proposal({ review_id, key, all, section, owner, estimate_minutes } = {}) {
      const review = need(review_id, "review_id");
      if (all === true) {
        const r = await api("POST", "/api/agent/proposals", { review_id: review, all: true });
        return [...r.items.map((i) => `Added to ${i.project_id}/${i.section}: [${i.id}] ${i.title}`),
          `${r.items.length} added${r.already ? `, ${r.already} already on the checklist` : ""}${r.failed?.length ? `, ${r.failed.length} failed: ${r.failed[0]}` : ""}.`].join("\n");
      }
      try {
        const { item } = await api("POST", "/api/agent/proposals", { review_id: review, key: need(key, "key (or all=true)"), section, owner, estimate_minutes });
        return `Added to ${item.project_id}/${item.section}: [${item.id}] ${item.title}`;
      } catch (e) {
        if (e.status === 409) throw new ToolError(`Not pushed: ${e.body?.error || e.message}`);
        throw e;
      }
    },
  };
}

/** One JSON-RPC message in, the response out (null for notifications). */
export function makeServer(deps) {
  const tools = makeTools(deps);
  const ok = (id, result) => ({ jsonrpc: "2.0", id, result });
  const err = (id, code, message) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  return async function handle(msg) {
    if (!msg || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") return msg && "id" in msg && !("result" in msg || "error" in msg) ? err(msg.id, -32600, "Invalid request") : null;
    const { id, method, params = {} } = msg;
    const notification = id === undefined;
    switch (method) {
      case "initialize": {
        const asked = params.protocolVersion;
        return ok(id, {
          protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
          capabilities: { tools: {} },
          serverInfo: { name: "jarvis", version: VERSION },
          instructions: "Jarvis Central: the owner's checklists and todos. Start triage with jarvis_overdue; tick what's finished; read the week with jarvis_digest.",
        });
      }
      case "ping": return notification ? null : ok(id, {});
      case "tools/list": return ok(id, { tools: TOOLS });
      case "tools/call": {
        const fn = tools[params.name];
        if (!fn) return err(id, -32602, `Unknown tool ${params.name}`);
        try {
          return ok(id, { content: [{ type: "text", text: await fn(params.arguments || {}) }] });
        } catch (e) {
          // Tool failures go back to the model as a result it can read, not a protocol error.
          return ok(id, { content: [{ type: "text", text: e instanceof ToolError ? e.message : `Jarvis: ${e.message}` }], isError: true });
        }
      }
      default:
        return notification ? null : err(id, -32601, `Method not found: ${method}`);
    }
  };
}

if (process.argv[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const handle = makeServer();
  const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { return send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); }
    const res = await handle(msg).catch((e) => ({ jsonrpc: "2.0", id: msg?.id ?? null, error: { code: -32603, message: e.message } }));
    if (res) send(res);
  });
  rl.on("close", () => process.exit(0));
}
