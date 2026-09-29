// Per-instance wording, set on Vercel by `node scripts/setup.mjs secrets` from jarvis.config.json.
// Everything has a neutral fallback so a fresh deploy reads correctly before setup finishes.
export const OWNER = process.env.JARVIS_OWNER || "";
/** When the Monday reviews run, as a phrase: "every Monday at 05:00". */
export const REVIEW_WHEN = process.env.JARVIS_REVIEW_WHEN || "every Monday morning";
/** When the week plan is made, as a phrase: "every Sunday at 17:00". */
export const PLAN_WHEN = process.env.JARVIS_PLAN_WHEN || "every Sunday afternoon";
/** Tool version, baked in at build time from ../VERSION (see next.config.ts). */
export const VERSION = process.env.NEXT_PUBLIC_JARVIS_VERSION || "dev";
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
