// Applies lib/schema.sql (idempotent). Runs before every build; skips quietly when no database is configured.
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
if (!url) { console.log("migrate: no DATABASE_URL, skipping"); process.exit(0); }
const sql = neon(url);
const stmts = readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8")
  .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n")
  .split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);
for (const s of stmts) await sql.query(s);
console.log(`migrate: ${stmts.length} statements applied`);
