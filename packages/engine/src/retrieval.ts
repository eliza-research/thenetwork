// Candidate retrieval (Sections 14.2, 33.5): union of channels (semantic kNN, tag match, graph
// two-hop), member-level hard filters first, and an exposure floor that reserves slots for
// low-exposure / low-data members so they are not starved by stronger profiles.
import type { Category, Facet, Intent, MemberId } from "@thenetwork/core";
import { cosine, tokenize } from "./embed.ts";
import { memberReason, type FilterReason } from "./filters.ts";
import type { Format, Role } from "./types.ts";
import { intentText, type World } from "./world.ts";

export interface Retrieved { id: MemberId; sim: number; facet?: Facet; channels: Set<string>; floor: boolean }

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

/**
 * Retrieve members for an intent: semantic top-K + tag channel + graph channel, union, dedupe,
 * then append up to exposureFloorK low-exposure members above minSim that fell outside top-K.
 */
export function retrieveForIntent(ctx: RetrievalCtx, intent: Intent, pool: MemberId[], facets: "caps" | "desires" | "match", minSim: number): Retrieved[] {
  const { w } = ctx;
  const cfg = w.cfg.retrieval;
  const toks = new Set(tokenize(intentText(intent)));
  const hop = twoHop(w, intent.memberId);
  const scored: Retrieved[] = [];
  for (const id of pool) {
    const mi = w.get(id)!;
    const { sim, facet } = w.intentFit(intent, mi, facets);
    const channels = new Set<string>();
    const tagHit = [...mi.tags].some(t => toks.has(t));
    if (tagHit) channels.add("tag");
    if (hop.has(id) && sim >= cfg.warmMinSim) channels.add("graph");
    if (sim < minSim && !channels.has("graph")) continue;
    scored.push({ id, sim, facet, channels, floor: false });
  }
  scored.sort((a, b) => (b.sim - a.sim) || (a.id < b.id ? -1 : 1));
  const out = new Map<MemberId, Retrieved>();
  scored.slice(0, cfg.topK).forEach(r => { if (r.sim >= minSim) r.channels.add("semantic"); out.set(r.id, r); });
  for (const r of scored) if (r.channels.has("tag") || r.channels.has("graph")) if (!out.has(r.id)) out.set(r.id, r);
  // Exposure floor.
  let floor = 0;
  for (const r of scored) {
    if (floor >= cfg.exposureFloorK) break;
    if (out.has(r.id)) continue;
    const mi = w.get(r.id)!;
    if ((mi.lowExposure || mi.lowData || mi.newcomer) && r.sim >= minSim) {
      r.channels.add("exposure_floor"); r.floor = true; out.set(r.id, r); floor++;
    }
  }
  return [...out.values()].sort((a, b) => (b.sim - a.sim) || (a.id < b.id ? -1 : 1));
}

/** Members interested in a query embedding (events, themes), best desire/interest facet. */
export function retrieveByEmbedding(ctx: RetrievalCtx, q: number[], pool: MemberId[], minSim: number): Retrieved[] {
  const { w } = ctx;
  const out: Retrieved[] = [];
  for (const id of pool) {
    const mi = w.get(id)!;
    const r = w.bestFacet(mi, q, "desires");
    const prof = cosine(q, mi.profileEmb) * 0.8;
    const sim = Math.max(r.sim, prof);
    if (sim < minSim) continue;
    out.push({ id, sim, facet: r.facet, channels: new Set(["semantic"]), floor: false });
  }
  out.sort((a, b) => (b.sim - a.sim) || (a.id < b.id ? -1 : 1));
  const top = out.slice(0, w.cfg.retrieval.topK);
  let floor = 0;
  for (const r of out.slice(w.cfg.retrieval.topK)) {
    if (floor >= w.cfg.retrieval.exposureFloorK) break;
    const mi = w.get(r.id)!;
    if (mi.lowExposure || mi.lowData || mi.newcomer) { r.channels.add("exposure_floor"); r.floor = true; top.push(r); floor++; }
  }
  return top;
}
