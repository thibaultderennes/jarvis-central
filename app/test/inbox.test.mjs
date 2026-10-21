// Inbox kinds (lib/inbox.ts): what "Treat all FYI" and `jarvis treat --kind` sweep up, and the id list the bulk
// update accepts. The CLI keeps its own copy of inboxKind; the last test makes sure the two lists agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FYI_KINDS, REPORT_MODES, cleanIds, inboxKind } from "../lib/inbox.ts";

const note = (kind, extra = {}) => ({ status: "answered", mode: "discuss", meta: { kind }, ...extra });

test("receipts and reports are FYI; replies to you and decisions are not", () => {
  assert.equal(inboxKind(note("refine"), note("refine")), "fyi");
  assert.equal(inboxKind(note("merged"), note("merged")), "fyi");
  const review = { status: "answered", mode: "review", meta: { kind: "scheduled" } };
  assert.equal(inboxKind(review, review), "fyi");
  const plan = { status: "done", mode: "plan", meta: {} };
  assert.equal(inboxKind(plan, plan), "fyi");
  const ask = { status: "answered", mode: "discuss", meta: {} };
  assert.equal(inboxKind(ask, ask), "reply");
  const build = { status: "done", mode: "build", meta: {} };
  assert.equal(inboxKind(build, build), "reply");
  assert.equal(inboxKind(note("refine"), { ...note("refine"), status: "needs_you" }), "decision");
  assert.equal(inboxKind(plan, { ...plan, status: "error" }), "decision");
});

test("a receipt you answered becomes a conversation, and work in flight is never treated", () => {
  assert.equal(inboxKind(note("refine"), { status: "answered", mode: "discuss", meta: {} }, 3), "reply");
  for (const status of ["new", "seen", "working"]) assert.equal(inboxKind(note("refine"), { status }), "working");
});

test("cleanIds keeps uuids only, once each, at most 200", () => {
  const a = "0b6f3c2e-1d4a-4f7e-9c1b-2a3d4e5f6a7b";
  assert.deepEqual(cleanIds([a, a, "x", 3, null, "0b6f3c2e"]), [a]);
  assert.deepEqual(cleanIds("not a list"), []);
  const many = Array.from({ length: 250 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
  assert.equal(cleanIds(many).length, 200);
});

test("the CLI's copy of the FYI rules matches the site's", () => {
  const cli = readFileSync(new URL("../../agent/jarvis.mjs", import.meta.url), "utf8");
  const list = (name) => JSON.parse(cli.match(new RegExp(`${name} = (\\[[^\\]]*\\])`))[1]);
  assert.deepEqual(list("FYI_KINDS"), FYI_KINDS);
  assert.deepEqual(list("REPORT_MODES"), REPORT_MODES);
});
