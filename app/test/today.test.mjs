// What Today lists (lib/today.ts): checklist items for work, todos only for personal tasks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { todayWork, workLoad, isPersonal } from "../lib/today.ts";
import { carriedOn } from "../lib/rollover.ts";

const TUE = "2026-10-06", MON = "2026-10-05", WED = "2026-10-07";
const item = (id, o = {}) => ({ project_id: "app", id, title: `Item ${id}`, status: "todo", due: null, owner: "founder", critical: false, estimate_minutes: null, done_at: null, ...o });
const todo = (o = {}) => ({ id: `t-${Math.random()}`, date: TUE, project_id: null, item_id: null, sort: 1, done: false, ...o });
const doneOn = (i) => (i.done_at ? i.done_at.slice(0, 10) : null);
const ids = (rows) => rows.map((r) => `${r.item.id}:${r.why}`);

test("today lists items due today, in progress and carried in; not Claude's builds, not cancelled, not future ones", () => {
  const items = [
    item("due", { due: TUE }), item("doing", { status: "doing", due: "2026-10-20" }), item("carried", { due: MON }),
    item("bot", { status: "doing", owner: "claude" }), item("gone", { due: TUE, status: "cancelled" }), item("later", { due: WED }),
    item("waiting", { due: MON }),
  ];
  const w = todayWork({ day: TUE, today: TUE, items, todos: [], carried: ["app/carried", "app/missing"], doneOn });
  assert.deepEqual(ids(w.open), ["carried:carried", "due:due", "doing:doing"]);
  assert.equal(w.open[0].late, true);
  assert.equal(w.done.length, 0);
});

test("critical first, then the most late, then due, in progress, planned", () => {
  const items = [item("doing", { status: "doing" }), item("due", { due: TUE }), item("crit", { due: TUE, critical: true }),
    item("late1", { due: MON }), item("late5", { due: "2026-10-01" }), item("planned")];
  const todos = [todo({ project_id: "app", item_id: "planned" })];
  const w = todayWork({ day: TUE, today: TUE, items, todos, carried: ["app/late1", "app/late5"], doneOn });
  assert.deepEqual(w.open.map((r) => r.item.id), ["crit", "late5", "late1", "due", "doing", "planned"]);
});

test("an old work todo shows as its item, once; personal todos stay todos", () => {
  const items = [item("a", { due: TUE }), item("b")];
  const todos = [todo({ project_id: "app", item_id: "a" }), todo({ project_id: "app", item_id: "b", id: "tb" }), todo({ date: WED, project_id: "app", item_id: "b" })];
  const w = todayWork({ day: TUE, today: TUE, items, todos, doneOn });
  assert.deepEqual(ids(w.open), ["a:due", "b:planned"]);
  assert.equal(w.open[1].todo, "tb");
  assert.equal(isPersonal(todos[0]), false);
  assert.equal(isPersonal(todo()), true);
  assert.equal(isPersonal(todo({ project_id: "app" })), true, "an older project todo with no item stays a todo");
});

test("done that day: due ones and ones finished that day; they count as done, not as load", () => {
  const items = [item("x", { due: TUE, status: "done", done_at: "2026-10-05T20:00:00Z" }), item("y", { status: "done", done_at: "2026-10-06T15:00:00Z" }),
    item("z", { status: "done", done_at: "2026-10-01T15:00:00Z" }), item("open", { due: TUE, estimate_minutes: 90 }), item("carried-done", { due: MON, status: "done", done_at: "2026-10-06T09:00:00Z" })];
  const w = todayWork({ day: TUE, today: TUE, items, todos: [], carried: ["app/carried-done"], doneOn });
  assert.deepEqual(w.done.map((r) => r.item.id).sort(), ["carried-done", "x", "y"]);
  assert.equal(workLoad(w.open), 90);
  assert.equal(workLoad([{ item: item("n") }]), 60, "unknown estimate: 60 min");
});

test("another day: in-progress and carried items stay on Today; due ones and planned ones show", () => {
  const items = [item("doing", { status: "doing" }), item("wed", { due: WED }), item("c", { due: MON })];
  const w = todayWork({ day: WED, today: TUE, items, todos: [], carried: [], doneOn });
  assert.deepEqual(ids(w.open), ["wed:due"]);
});

test("a carried item given a new due date since is no longer carried", () => {
  const items = [item("moved", { due: WED })];
  assert.equal(todayWork({ day: TUE, today: TUE, items, todos: [], carried: ["app/moved"], doneOn }).open.length, 0);
});

test("carriedOn: only that day's kv, only well-formed keys", () => {
  const v = { date: TUE, items: [{ key: "app/a" }, { key: "nope" }, null, { key: 3 }] };
  assert.deepEqual(carriedOn(v, TUE), ["app/a"]);
  assert.deepEqual(carriedOn(v, WED), []);
  assert.deepEqual(carriedOn({ date: TUE }, TUE), []);
  assert.deepEqual(carriedOn(null, TUE), []);
});
