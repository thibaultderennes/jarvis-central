// app/lib/schema.sql runs in full on every deploy. A check constraint that is dropped and re-added must list the same
// values everywhere, or an older copy (run first) rejects rows a newer feature already wrote — the 0.7.3 deploy failure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");

test("every copy of a widened check constraint lists the same values", () => {
  const byName = new Map();
  for (const m of sql.matchAll(/add constraint (\w+) check \((\w+) in \(([^)]*)\)\)/g)) {
    const [, name, col, list] = m;
    const vals = list.split(",").map((v) => v.trim()).sort().join(",");
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name).add(`${col}: ${vals}`);
  }
  for (const [name, variants] of byName) assert.equal(variants.size, 1, `${name} is re-created with different lists: ${[...variants].join("  |  ")}`);
});

test("the create-table checks match the latest widened list", () => {
  const latest = [...sql.matchAll(/add constraint reviews_type_check check \(type in \(([^)]*)\)\)/g)].pop()?.[1];
  const created = sql.match(/type text not null check \(type in \(([^)]*)\)\)/)?.[1];
  assert.equal(created, latest);
});
