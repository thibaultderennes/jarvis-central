// Analysis reports (lib/analysis.ts): cleaning a posted report, reading stored ones back, grouping charts, and the
// connected-tools list. The two fixtures are different kinds of project (a video channel's cohort digest and a SaaS
// growth review): both go through the same code with nothing project-specific, which is the point.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { cleanAnalysis, parseAnalysis, latestBySource, charts, connectedTools, isAnalysis } from "../lib/analysis.ts";
import { hubKind } from "../lib/docsHub.ts";

const fixture = (f) => { const { title, headline, body_md, ...meta } = JSON.parse(fs.readFileSync(new URL(`../../agent/fixtures/${f}`, import.meta.url), "utf8")); return { title, headline, body_md, meta: { ...meta, kind: "analysis" } }; };
const row = (f, o = {}) => { const r = fixture(f); return { id: f, type: "doc", created_at: "2026-10-27T09:00:00Z", acked_at: null, ...r, ...o, meta: { ...r.meta, ...(o.meta || {}) } }; };

test("cleanAnalysis: both fixtures survive whole, with no code that knows either project", () => {
  for (const f of ["analysis-channel.json", "analysis-saas.json"]) {
    const { meta } = fixture(f), a = cleanAnalysis(meta);
    assert.ok(a, f);
    assert.equal(a.series.length, meta.series.length, f);
    assert.equal(a.tools.length, meta.tools.length, f);
    assert.equal(a.markers.length, meta.markers.length, f);
    assert.deepEqual(Object.keys(a.numbers), Object.keys(meta.numbers), f);
    assert.equal(a.file, `analysis/${meta.source}/${meta.date}`);
  }
});

test("cleanAnalysis: drops what's invalid, keeps the rest, needs a source", () => {
  assert.equal(cleanAnalysis({ date: "2026-10-01" }), null);
  assert.equal(cleanAnalysis(null), null);
  const a = cleanAnalysis({
    source: "My Digest!", numbers: { ok: "3.456", Bad: 1, nan: "x" },
    period: { from: "2026-10-10", to: "2026-10-01" },
    series: [
      { key: "r", label: "R", unit: "pct", points: [{ x: "2026-10-08", v: 2 }, { x: "2026-10-01", v: 1, n: 5 }, { x: "nope", v: 3 }, { x: "2026-10-09", v: "y" }] },
      { key: "r", points: [{ x: "2026-10-01", v: 1 }] },        // duplicate key
      { key: "Empty", points: [{ x: "2026-10-01", v: 1 }] },    // bad key
      { key: "none", points: [] },                              // no points
    ],
    markers: [{ x: "2026-10-05", label: "shipped" }, { x: "2026-10-05" }],
    tools: [{ name: "Discord", role: "destination", status: "weird" }, { role: "source" }],
  }, "2026-10-12");
  assert.equal(a.source, "my-digest");
  assert.equal(a.date, "2026-10-12", "falls back to the posting day");
  assert.deepEqual(a.period, { from: "2026-10-01", to: "2026-10-10" });
  assert.deepEqual(a.numbers, { ok: 3.46 });
  assert.equal(a.series.length, 1);
  assert.deepEqual(a.series[0].points, [{ x: "2026-10-01", v: 1, n: 5 }, { x: "2026-10-08", v: 2 }], "sorted, invalid points dropped");
  assert.equal(a.series[0].chart, "R");
  assert.deepEqual(a.markers, [{ x: "2026-10-05", label: "shipped" }]);
  assert.deepEqual(a.tools, [{ name: "Discord", role: "destination" }]);
});

test("parseAnalysis and the Docs hub: only doc rows with meta.kind analysis", () => {
  const r = row("analysis-channel.json");
  assert.ok(isAnalysis(r));
  assert.equal(hubKind(r), "analysis");
  assert.equal(parseAnalysis({ ...r, type: "project" }), null);
  assert.equal(parseAnalysis({ ...r, meta: { kind: "project-plan" } }), null);
  assert.equal(parseAnalysis(r).review, r);
});

test("latestBySource: newest report per source, newest source first", () => {
  const old = row("analysis-channel.json", { id: "old", meta: { date: "2026-10-07" } });
  const cur = row("analysis-channel.json", { id: "cur" });
  const saas = row("analysis-saas.json");
  const out = latestBySource([old, saas, cur, { id: "x", type: "doc", created_at: "2026-10-30T00:00:00Z", meta: {} }]);
  assert.deepEqual(out.map((a) => a.review.id), ["analysis-saas.json", "cur"]);
});

test("charts: series sharing `chart` draw together; a cohort chart keeps its unit", () => {
  const c = charts(cleanAnalysis(fixture("analysis-channel.json").meta).series);
  assert.equal(c.length, 1);
  assert.equal(c[0].title, "Retention by publish week");
  assert.equal(c[0].unit, "pct");
  assert.equal(c[0].series.length, 2);
  assert.deepEqual(charts(cleanAnalysis(fixture("analysis-saas.json").meta).series).map((x) => x.title), ["Activation by signup week", "Revenue"]);
});

test("connectedTools: one row per tool, newest status wins, sources first, plus the metrics feed", () => {
  const a = cleanAnalysis({ source: "digest", date: "2026-10-01", tools: [{ name: "YouTube Analytics", status: "failed" }, { name: "Discord", role: "destination" }] });
  const b = cleanAnalysis({ source: "digest", date: "2026-10-15", tools: [{ name: "youtube analytics", status: "ok" }] });
  const c = cleanAnalysis({ source: "music", date: "2026-10-10", tools: [{ name: "YouTube Analytics", status: "degraded" }] });
  const t = connectedTools([b, a, c], { date: "2026-10-20", source: "command" });
  assert.deepEqual(t.map((x) => [x.role, x.name, x.status, x.last]), [
    ["source", "Product metrics", "ok", "2026-10-20"],
    ["source", "youtube analytics", "ok", "2026-10-15"],
    ["destination", "Discord", undefined, "2026-10-01"],
  ]);
  assert.deepEqual(t[1].via, ["digest", "music"]);
  assert.deepEqual(connectedTools([]), []);
});
