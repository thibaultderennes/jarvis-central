// The overdue queue (lib/overdue.ts): which items, in what order, where "Later" lands, what the browser may send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { laterDate, MAX_TRIAGE, overdueQueue, parseKeys } from "../lib/overdue.ts";

const T = "2026-10-14"; // a Wednesday
const it = (project_id, id, o = {}) => ({ project_id, id, status: "todo", due: "2026-10-10", critical: false, ...o });

test("open items due before today only, across projects", () => {
  const q = overdueQueue([
    it("a", "late"), it("b", "doing", { status: "doing" }), it("a", "today", { due: T }), it("a", "soon", { due: "2026-10-20" }),
    it("a", "nodate", { due: null }), it("a", "done", { status: "done" }), it("b", "cancelled", { status: "cancelled" }),
  ], T);
  assert.deepEqual(q.map((i) => i.id).sort(), ["doing", "late"]);
});

test("critical first, then the oldest due date, then project and id", () => {
  const q = overdueQueue([it("b", "x", { due: "2026-10-01" }), it("a", "y", { due: "2026-10-12", critical: true }), it("a", "z", { due: "2026-10-01" }), it("a", "w", { due: "2026-09-01", critical: true })], T);
  assert.deepEqual(q.map((i) => `${i.project_id}/${i.id}`), ["a/w", "a/y", "a/z", "b/x"]);
});

test("Later is next Monday; on a Monday it is a week out", () => {
  assert.equal(laterDate(T), "2026-10-19");
  assert.equal(laterDate("2026-10-18"), "2026-10-19"); // Sunday
  assert.equal(laterDate("2026-10-19"), "2026-10-26"); // Monday
  assert.equal(laterDate("2026-12-29"), "2027-01-04"); // across the year
});

test("parseKeys keeps well-formed project/id keys, once each, capped", () => {
  assert.deepEqual(parseKeys(["a/x", "a/x", "b/y-2", "nope", "a/b/c", "../x", "a/", 3, null, "a/<s>"]), [{ project_id: "a", id: "x" }, { project_id: "b", id: "y-2" }]);
  assert.deepEqual(parseKeys("a/x"), []);
  assert.equal(parseKeys(Array.from({ length: 500 }, (_, i) => `p/i${i}`)).length, MAX_TRIAGE);
});
