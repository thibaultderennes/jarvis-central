// Admin → "Start new project". Pure helpers (no imports) so `npm test` can load them. The Mac worker checks the
// same rules again with agent/foundation.mjs validateProjectName (the folders are on the Mac); keep the two in step:
// app/test/foundation.test.mjs runs both on the same names.

/** Same as agent/structure.mjs slugify: lower case, accents dropped, anything else becomes "-". */
export const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/** The folder name (= project id) for a typed name, or why it can't be used. `taken` = ids and folder names in use. */
export function validateProjectName(name: unknown, taken: string[] = []): { id: string; name: string; error?: undefined } | { error: string } {
  const n = String(name ?? "").trim();
  if (!n) return { error: "Type a name for the project." };
  if (n.length > 60) return { error: "Keep the name under 60 characters." };
  if (/[\/\\]/.test(n) || n.startsWith(".")) return { error: "Use a plain name, not a path." };
  if (!/[a-z0-9]/i.test(n.normalize("NFD"))) return { error: "The name needs at least one letter or digit." };
  const id = slugify(n).slice(0, 50).replace(/-+$/, "");
  if (!id || (id === "project" && !/project/i.test(n))) return { error: "The name needs at least one letter or digit." };
  const lower = new Set(taken.map((t) => String(t).toLowerCase()));
  if (lower.has(id) || lower.has(n.toLowerCase())) return { error: `A project or folder called "${id}" already exists. Pick another name.` };
  return { id, name: n };
}
