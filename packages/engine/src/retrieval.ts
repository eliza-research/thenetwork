import type { Category, Facet, Intent, MemberId } from "@thenetwork/core";
import { cosine } from "./embed.ts";
import { isMinor, memberReason, type FilterReason } from "./filters.ts";
import { EXACT_SCAN_THRESHOLD } from "./spatialIndex.ts";
import type { Format, Role } from "./types.ts";
import { intentText, pairKey, type World } from "./world.ts";

export interface Retrieved {
  id: MemberId;
  sim: number;
  facet?: Facet;
  channels: Set<string>;
  floor: boolean;
  rank?: number;
}

export interface RetrievalCtx {
  w: World;
  memberExclusions: Record<string, number>;
}

export interface RetrievalOptions {
  topK?: number;
  exposureFloorK?: number;
  warmMinSim?: number;
}

const DEFAULT_TOP_K = 40;
const DEFAULT_EXPOSURE_FLOOR_K = 6;
const DEFAULT_WARM_MIN_SIM = 0.15;

export function countExclusion(ctx: RetrievalCtx, r: FilterReason): void {
  ctx.memberExclusions[r] = (ctx.memberExclusions[r] ?? 0) + 1;
}

export function eligibleMembers(
  ctx: RetrievalCtx,
  category: Category,
  role: Role,
  format: Format,
  timeSensitive: boolean,
  exclude: Set<MemberId>,
): MemberId[] {
  const out: MemberId[] = [];
  for (const id of ctx.w.ids) {
    if (exclude.has(id)) continue;
    const r = memberReason(ctx.w, id, { category, role, format, timeSensitive });
    if (r) { countExclusion(ctx, r); continue; }
    out.push(id);
  }
  return out;
}

export function twoHop(w: World, a: MemberId): Map<MemberId, { via: MemberId; strength: number; adamicAdar: number }> {
  const out = new Map<MemberId, { via: MemberId; strength: number; adamicAdar: number }>();
  if (isMinor(w, a)) return out;
  const direct = w.positive.get(a);
  if (!direct || direct.size === 0) return out;
  const aaMap = w.adamicAdar.get(a);

  for (const x of [...direct.keys()].sort()) {
    if (isMinor(w, x) || w.holds.has(x) || w.get(x)?.m.state === "paused") continue;
    const sx = direct.get(x)!;
    const xNbrs = w.positive.get(x);
    if (!xNbrs) continue;
    for (const [b, sb] of [...xNbrs.entries()].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
      if (b === a || isMinor(w, b) || direct.has(b)) continue;
      if (w.blocked.has(pairKey(a, b))) continue;
      const s = sx * sb;
      const aa = aaMap?.get(b) ?? (s / Math.log(1 + Math.max(2, xNbrs.size)));
      const cur = out.get(b);
      if (!cur || s > cur.strength || (s === cur.strength && x < cur.via)) {
        out.set(b, { via: x, strength: s, adamicAdar: aa });
      }
    }
  }
  return out;
}

function hasAnyTagOverlap(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of small) if (large.has(t)) return true;
  return false;
}

export function retrieveForIntent(
  ctx: RetrievalCtx,
  intent: Intent,
  pool: MemberId[],
  facets: "caps" | "desires" | "match",
  minSim = ctx.w.cfg.retrieval.minSim,
  opts: RetrievalOptions = {},
): Retrieved[] {
  const { w } = ctx;
  if (pool.length === 0) return [];
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const exposureFloorK = opts.exposureFloorK ?? DEFAULT_EXPOSURE_FLOOR_K;
  const warmMinSim = opts.warmMinSim ?? DEFAULT_WARM_MIN_SIM;
  const ownerMinor = isMinor(w, intent.memberId);
  if (ownerMinor && !w.teenIntros) return [];

  const toks = w.intentTokenSet(intent);
  const hop = ownerMinor ? new Map<MemberId, { via: MemberId; strength: number; adamicAdar: number }>() : twoHop(w, intent.memberId);
  const q = w.intentEmb.get(intent.id) ?? w.embed(intentText(intent));

  let candidateIds: readonly MemberId[];
  let exact = true;

  if (!ownerMinor && pool.length >= EXACT_SCAN_THRESHOLD) {
    const adultPool = pool.filter(id => !isMinor(w, id));
    const minAvail = Math.max(1, Math.min(3, w.cfg.minOverlapHours));
    const res = w.spatialIndex.queryCandidates({
      queryVec: q,
      channel: facets,
      pool: adultPool,
      tags: toks,
      anchorId: intent.memberId,
      minAvailabilityOverlapHours: minAvail,
      enforceMutualAges: intent.category === "romance",
      candidateLimit: Math.max(200, topK * 5),
      exposureFloorShare: Math.max(0.15, exposureFloorK / Math.max(1, topK + exposureFloorK)),
    });
    exact = res.exact;

    if (!exact) {
      const poolSet = new Set<MemberId>(adultPool);
      const merged = new Set<MemberId>(res.ids);

      if (hop.size > 0) {
        const warmRanked = [...hop.entries()]
          .filter(([id]) => poolSet.has(id) && !isMinor(w, id))
          .sort((a, b) => (b[1].adamicAdar - a[1].adamicAdar) || (b[1].strength - a[1].strength) || (a[0] < b[0] ? -1 : 1));
        const warmCap = Math.min(40, warmRanked.length);
        for (let i = 0; i < warmCap; i++) merged.add(warmRanked[i]![0]);
      }

      const mesoCid = w.leidenMeso.communityOf.get(intent.memberId);
      if (mesoCid !== undefined) {
        const coMembers = w.leidenMeso.membersOf.get(mesoCid) ?? [];
        const stride = coMembers.length > 0 ? (intent.id.charCodeAt(0) * 31 + intent.memberId.charCodeAt(0)) % coMembers.length : 0;
        let addedComm = 0;
        for (let step = 0; step < coMembers.length && addedComm < 24; step++) {
          const cid = coMembers[(stride + step) % coMembers.length]!;
          if (cid === intent.memberId || merged.has(cid) || !poolSet.has(cid) || isMinor(w, cid)) continue;
          if (w.spatialIndex.availabilityOverlap(intent.memberId, cid) < minAvail) continue;
          merged.add(cid);
          addedComm++;
        }
      }

      candidateIds = [...merged].sort();
    } else {
      candidateIds = adultPool;
    }
  } else {
    candidateIds = pool;
  }

  const scored: Retrieved[] = [];
  for (let i = 0; i < candidateIds.length; i++) {
    const id = candidateIds[i]!;
    if (!ownerMinor && isMinor(w, id) && !w.teenIntros) continue;
    const mi = w.get(id);
    if (!mi) continue;
    const { sim, facet } = w.intentFit(intent, mi, facets);
    const channels = new Set<string>();
    if (hasAnyTagOverlap(mi.tags, toks)) channels.add("tag");
    const hopEntry = !ownerMinor && !isMinor(w, id) ? hop.get(id) : undefined;
    if (hopEntry && sim >= warmMinSim) channels.add("graph");
    if (sim < minSim && !channels.has("graph")) continue;
    const aaLift = !exact && hopEntry ? 0.01 * Math.min(1, hopEntry.adamicAdar) : 0;
    scored.push({ id, sim, facet, channels, floor: false, rank: sim + aaLift });
  }

  const byRank = (a: Retrieved, b: Retrieved) => ((b.rank ?? b.sim) - (a.rank ?? a.sim)) || (a.id < b.id ? -1 : 1);
  scored.sort(byRank);
  const out = new Map<MemberId, Retrieved>();
  for (let i = 0; i < Math.min(topK, scored.length); i++) {
    const r = scored[i]!;
    if (r.sim >= minSim) r.channels.add("semantic");
    out.set(r.id, r);
  }
  for (let i = 0; i < scored.length; i++) {
    const r = scored[i]!;
    if ((r.channels.has("tag") || r.channels.has("graph")) && !out.has(r.id)) out.set(r.id, r);
  }
  const floorCap = exact ? exposureFloorK : Math.max(exposureFloorK, Math.ceil(topK * 0.15));
  let floor = 0;
  for (let i = 0; i < scored.length; i++) {
    if (floor >= floorCap) break;
    const r = scored[i]!;
    if (out.has(r.id)) continue;
    const mi = w.get(r.id)!;
    if ((mi.lowExposure || mi.lowData || mi.newcomer) && r.sim >= minSim) {
      r.channels.add("exposure_floor");
      r.floor = true;
      out.set(r.id, r);
      floor++;
    }
  }
  return [...out.values()].sort(byRank);
}

export function retrieveByEmbedding(
  ctx: RetrievalCtx,
  q: number[],
  pool: MemberId[],
  minSim = ctx.w.cfg.retrieval.minSim,
  opts: RetrievalOptions = {},
): Retrieved[] {
  const { w } = ctx;
  if (pool.length === 0) return [];
  const topK = opts.topK ?? DEFAULT_TOP_K;
  const exposureFloorK = opts.exposureFloorK ?? DEFAULT_EXPOSURE_FLOOR_K;
  const adultPool = w.teenIntros ? pool : pool.filter(id => !isMinor(w, id));

  let candidateIds: readonly MemberId[] = adultPool;
  let exact = true;
  if (!w.teenIntros && adultPool.length >= EXACT_SCAN_THRESHOLD) {
    const res = w.spatialIndex.queryCandidates({
      queryVec: q,
      channel: "desires",
      pool: adultPool,
      candidateLimit: Math.max(200, topK * 5),
      exposureFloorShare: Math.max(0.15, exposureFloorK / Math.max(1, topK + exposureFloorK)),
    });
    candidateIds = res.ids;
    exact = res.exact;
  }

  const out: Retrieved[] = [];
  for (let i = 0; i < candidateIds.length; i++) {
    const id = candidateIds[i]!;
    const mi = w.get(id);
    if (!mi) continue;
    const r = w.bestFacet(mi, q, "desires");
    const prof = cosine(q, mi.profileEmb) * 0.8;
    const sim = Math.max(r.sim, prof);
    if (sim < minSim) continue;
    out.push({ id, sim, facet: r.facet, channels: new Set(["semantic"]), floor: false });
  }
  out.sort((a, b) => (b.sim - a.sim) || (a.id < b.id ? -1 : 1));
  const top = out.slice(0, topK);
  const floorCap = exact ? exposureFloorK : Math.max(exposureFloorK, Math.ceil(topK * 0.15));
  let floor = 0;
  for (let i = topK; i < out.length; i++) {
    if (floor >= floorCap) break;
    const r = out[i]!;
    const mi = w.get(r.id)!;
    if (mi.lowExposure || mi.lowData || mi.newcomer) {
      r.channels.add("exposure_floor");
      r.floor = true;
      top.push(r);
      floor++;
    }
  }
  return top;
}
