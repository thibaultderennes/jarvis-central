// Jarvis as an MCP server (agent/mcp.mjs): the JSON-RPC handshake and the tools, against a fake agent API.
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeServer, TOOLS } from "../../agent/mcp.mjs";

const TODAY = "2026-10-14";
const item = (id, o = {}) => ({ project_id: "app", id, title: `Item ${id}`, section: "build", status: "todo", due: null, owner: "founder", critical: false, ...o });

function fakeApi(over = {}) {
  const calls = [];
  const api = async (method, path, body) => {
    calls.push({ method, path, body });
    const key = `${method} ${path.split("?")[0]}`;
    if (over[key]) return over[key](path, body);
    throw Object.assign(new Error(`${key} → 404: not faked`), { status: 404 });
  };
  return { api, calls };
}
const call = async (handle, name, args) => (await handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name, arguments: args } })).result;

test("initialize echoes a known protocol version, falls back otherwise, and lists the tools", async () => {
  const handle = makeServer(fakeApi());
  const a = await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } });
  assert.equal(a.result.protocolVersion, "2025-03-26");
  assert.deepEqual(a.result.capabilities, { tools: {} });
  const b = await handle({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } });
  assert.equal(b.result.protocolVersion, "2025-06-18");
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
  const l = await handle({ jsonrpc: "2.0", id: 3, method: "tools/list" });
  assert.deepEqual(l.result.tools.map((t) => t.name), TOOLS.map((t) => t.name));
  for (const t of l.result.tools) assert.equal(t.inputSchema.type, "object");
  assert.equal((await handle({ jsonrpc: "2.0", id: 4, method: "nope" })).error.code, -32601);
  assert.equal((await handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "nope" } })).error.code, -32602);
});

test("overdue: late items first, today's apart, done and undated left out, unticked todos with ids", async () => {
  const { api, calls } = fakeApi({
    "GET /api/agent/items": () => [
      item("late", { due: "2026-10-10" }), item("crit", { due: "2026-10-10", critical: true }), item("today", { due: TODAY, status: "doing" }),
      item("later", { due: "2026-10-20" }), item("nodate"), item("cancel", { due: "2026-10-01", status: "cancelled" }), item("mine", { due: "2026-10-01", owner: "claude" }),
    ],
    "GET /api/agent/todos": () => [
      { id: "t-done", title: "Done one", date: "2026-10-13", done: true },
      { id: "t-open", title: "Call the bank", date: "2026-10-13", done: false, kind: "life", rollovers: 2 },
    ],
  });
  const handle = makeServer({ api, today: () => TODAY });
  const r = await call(handle, "jarvis_overdue", { owner: "founder" });
  assert.ok(!r.isError);
  const text = r.content[0].text;
  assert.match(text, /Overdue items \(2\)/);
  assert.ok(text.indexOf("app/crit") < text.indexOf("app/late"), "critical first on the same day");
  assert.match(text, /app\/late\] 2026-10-10 \(4 d late\)/);
  assert.match(text, /Items due today \(1\)\n\[app\/today\]/);
  assert.doesNotMatch(text, /later|nodate|cancel|mine/);
  assert.match(text, /t-open {2}2026-10-13 — Call the bank \(life\) · carried 2×/);
  assert.doesNotMatch(text, /t-done/);
  assert.match(calls[1].path, /from=2026-09-30&to=2026-10-14/);
});

test("tick item and todo send the right patch; done=false reopens", async () => {
  const { api, calls } = fakeApi({
    "PATCH /api/agent/items": (_p, b) => ({ item: item(b.id, { status: b.status }) }),
    "PATCH /api/agent/todos": (_p, b) => ({ todo: { id: b.id, title: "Ship it", done: b.done, project_id: "app", item_id: "ship" } }),
  });
  const handle = makeServer({ api, today: () => TODAY });
  assert.equal((await call(handle, "jarvis_tick_item", { project: "app", id: "ship" })).content[0].text, "Done: [app/ship] Item ship");
  assert.deepEqual(calls[0].body, { project_id: "app", id: "ship", status: "done" });
  assert.match((await call(handle, "jarvis_tick_item", { project: "app", id: "ship", done: false })).content[0].text, /^Reopened/);
  assert.equal(calls[1].body.status, "todo");
  const t = await call(handle, "jarvis_tick_todo", { id: "abc" });
  assert.deepEqual(calls[2].body, { id: "abc", done: true });
  assert.match(t.content[0].text, /Ticked: Ship it \(its item app\/ship follows\)/);
  const missing = await call(handle, "jarvis_tick_item", { project: "app" });
  assert.equal(missing.isError, true);
  assert.equal(missing.content[0].text, "id is required.");
});

test("API errors come back as a tool error the model can read", async () => {
  const handle = makeServer({ ...fakeApi(), today: () => TODAY });
  const r = await call(handle, "jarvis_tick_todo", { id: "x" });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /^Jarvis: PATCH \/api\/agent\/todos → 404/);
});

test("digest: the latest recap, the week's reports; a project's latest review in full", async () => {
  const recap = { id: "r1", type: "recap", title: "Recap · week of Oct 12", headline: "Two projects slipped", week_start: "2026-10-12", body_md: "Body of the recap", acked_at: null };
  const proj = { id: "r2", type: "project", project_id: "app", title: "App review", verdict: "at-risk", headline: "Auth late", week_start: "2026-10-12", body_md: "Full app review", acked_at: "2026-10-13" };
  const { api, calls } = fakeApi({ "GET /api/agent/reviews": (p) => (p.includes("type=recap") ? [recap] : p.includes("week=") ? [recap, proj] : [proj]) });
  const handle = makeServer({ api, today: () => TODAY });
  const d = (await call(handle, "jarvis_digest", {})).content[0].text;
  assert.match(d, /^# Recap · week of Oct 12\nTwo projects slipped/);
  assert.match(d, /Reports this week \(2\)/);
  assert.match(d, /r2 {6}project · app · at-risk — App review: Auth late/);
  assert.match(d, /## Recap\nBody of the recap$/);
  assert.match(calls[1].path, /week=2026-10-12/);
  const p = (await call(handle, "jarvis_digest", { project: "app" })).content[0].text;
  assert.match(p, /Full app review$/);
  const none = makeServer({ api: async () => [], today: () => TODAY });
  assert.match((await call(none, "jarvis_digest", {})).content[0].text, /No weekly recap yet/);
});

test("proposals list keys; push one, push all, and a second push is refused", async () => {
  const { api, calls } = fakeApi({
    "GET /api/agent/proposals": () => [
      { key: "k1", state: "pushable", title: "Add rate limits", section: "build", owner: "claude", items: [] },
      { key: "k2", state: "pushed", title: "Fix login", items: ["fix-login"] },
    ],
    "POST /api/agent/proposals": (_p, b) => {
      if (b.all) return { items: [item("rate-limits", { title: "Add rate limits" })], already: 1, failed: [] };
      if (b.key === "k2") throw Object.assign(new Error("409"), { status: 409, body: { error: "Already pushed as fix-login" } });
      return { item: item("rate-limits", { title: "Add rate limits" }) };
    },
  });
  const handle = makeServer({ api, today: () => TODAY });
  const ls = (await call(handle, "jarvis_proposals", { review_id: "r2" })).content[0].text;
  assert.match(ls, /to push · key k1 — Add rate limits \(section build, claude\)/);
  assert.match(ls, /pushed — Fix login → fix-login/);
  assert.equal((await call(handle, "jarvis_push_proposal", { review_id: "r2", key: "k1", section: "ops" })).content[0].text, "Added to app/build: [rate-limits] Add rate limits");
  assert.equal(calls[1].body.section, "ops");
  assert.match((await call(handle, "jarvis_push_proposal", { review_id: "r2", all: true })).content[0].text, /1 added, 1 already on the checklist\.$/);
  const again = await call(handle, "jarvis_push_proposal", { review_id: "r2", key: "k2" });
  assert.equal(again.isError, true);
  assert.equal(again.content[0].text, "Not pushed: Already pushed as fix-login");
});
