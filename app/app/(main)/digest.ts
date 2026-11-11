import * as D from "@/lib/data";
import { computeDigest, type DigestSeen } from "@/lib/fromClaude";
import type { FromClaudeGroup } from "@/components/FromClaude";

/** The From Claude digest with each project's name and colour, for Home and the Inbox. */
export function digestGroups(msgs: D.Message[], seen: DigestSeen | null | undefined, byId: Record<string, D.Project>, topIds: Set<string>): FromClaudeGroup[] {
  return computeDigest(msgs, seen).groups.map((g) => {
    const p = g.project_id ? byId[g.project_id] : null;
    return { ...g, name: p?.name || "General", color: p ? D.displayColor(p, topIds) : "other" };
  });
}
/** Remounts the digest when its lines change, so a "Got it" pressed earlier doesn't hide lines that arrived since. */
export const digestKey = (groups: FromClaudeGroup[]) => groups.flatMap((g) => g.lines.map((l) => l.id + l.at)).join("|");
