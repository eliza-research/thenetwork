// Member-level retrieval helpers (Section 33.5). Pair candidates come from the bounded search of
// the match core (genkit.ts searchFor); these cover the member funnel and the warm graph.
import type { Category, MemberId } from "@thenetwork/core";
import { memberReason, type FilterReason } from "./filters.ts";
import type { Format, Role } from "./types.ts";
import type { World } from "./world.ts";

export interface RetrievalCtx {
  w: World;
  memberExclusions: Record<string, number>;
}

export function countExclusion(ctx: RetrievalCtx, r: FilterReason) {
  ctx.memberExclusions[r] = (ctx.memberExclusions[r] ?? 0) + 1;
}

/** Members (other than `exclude`) eligible for a role in a category: the "SQL hard filter" pass. */
export function eligibleMembers(ctx: RetrievalCtx, category: Category, role: Role, format: Format, timeSensitive: boolean, exclude: Set<MemberId>): MemberId[] {
  const out: MemberId[] = [];
  for (const id of ctx.w.ids) {
    if (exclude.has(id)) continue;
    const r = memberReason(ctx.w, id, { category, role, format, timeSensitive });
    if (r) { countExclusion(ctx, r); continue; }
    out.push(id);
  }
  return out;
}

/** Two-hop warm neighbours of `a` (excluding direct neighbours): id -> {via, strength}. */
export function twoHop(w: World, a: MemberId): Map<MemberId, { via: MemberId; strength: number }> {
  const out = new Map<MemberId, { via: MemberId; strength: number }>();
  const direct = w.positive.get(a) ?? new Map<MemberId, number>();
  for (const x of [...direct.keys()].sort()) {
    // An intermediary on a safety hold or paused never carries a warm path (hard filter on `via`).
    if (w.holds.has(x) || w.get(x)?.m.state === "paused") continue;
    const sx = direct.get(x)!;
    for (const [b, sb] of [...(w.positive.get(x) ?? new Map<MemberId, number>()).entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
      if (b === a || direct.has(b)) continue;
      const s = sx * sb;
      const cur = out.get(b);
      if (!cur || s > cur.strength) out.set(b, { via: x, strength: s });
    }
  }
  return out;
}
