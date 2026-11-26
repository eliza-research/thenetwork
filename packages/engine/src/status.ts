import type { AppId, Facet, MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";
import { APPEARANCE_PREFIX, canRatePhotos, parseAppearance } from "./packs/slop/appearance.ts";
import { provenanceWeight, type World } from "./world.ts";

export type StatusTuple = readonly [number, number, number, number, number, number];

export interface StatusBelief {
  readonly mu: StatusTuple;
  readonly sigma: StatusTuple;
  readonly selectivityAlpha: number;
  readonly observations: number;
}

export interface VerticalStatusKernel {
  readonly appId: AppId;
  readonly D: StatusTuple;
  readonly A: readonly { iDim: number; jDim: number; weight: number }[];
  readonly parityWeights: StatusTuple;
  readonly parityPenalty: number;
  readonly gapFree: number;
  readonly warmthFloor: number;
}

export interface SpringRankEdge {
  readonly from: MemberId;
  readonly to: MemberId;
  readonly weight: number;
}

export interface SpringRankResult {
  readonly ranks: Map<MemberId, number>;
  readonly hierarchyBeta: number;
  readonly iterations: number;
  readonly residualNorm: number;
}

const MIN_STATUS_COHORT = 20;

export function canComputeStatus(age: number, adultMin: number): boolean {
  return Number.isFinite(age) && age >= 18 && age >= adultMin && canBeMatched(age);
}

export function clampStatusZ(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return Math.max(-3, Math.min(3, x));
}

export function clampStatusSigma(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.max(0.15, Math.min(1.2, s));
}

export function physDimensionWeight(isSlop: boolean, rawWeight: number): number {
  if (!isSlop || !Number.isFinite(rawWeight) || rawWeight <= 0) return 0;
  return Math.min(1, rawWeight);
}

export function effectiveAssortativeGap(a: number, b: number, gapFree: number): number {
  const free = Number.isFinite(gapFree) && gapFree > 0 ? gapFree : 0;
  const raw = Math.abs((Number.isFinite(a) ? a : 0) - (Number.isFinite(b) ? b : 0));
  return raw > free ? raw - free : 0;
}

export function namExchangeCredit(offerA: number, offerB: number, weight: number): number {
  if (!(offerA > 0) || !(offerB > 0) || !(weight > 0)) return 0;
  const prod = weight * offerA * offerB;
  return Number.isFinite(prod) ? Math.min(0.25, prod) : 0;
}

export function warmthFloorPenalty(warmZ: number, floor: number): number {
  if (!Number.isFinite(warmZ) || !Number.isFinite(floor) || warmZ >= floor) return 0;
  const deficit = floor - warmZ;
  return Math.min(1.5, 0.8 * deficit * deficit);
}

export function explorationTargetAllowed(
  isUncalibratedExplorer: boolean,
  targetAboveP80: boolean,
  targetWelcomesNewcomers: boolean,
  priorClearsBand: boolean,
): boolean {
  return !isUncalibratedExplorer || !targetAboveP80 || targetWelcomesNewcomers || priorClearsBand;
}

export const VERTICAL_KERNELS: Readonly<Record<AppId, VerticalStatusKernel>> = {
  slop: {
    appId: "slop",
    D: [0.18, 0.02, 0.05, 0.04, 0.08, 0],
    A: [],
    parityWeights: [0.65, 0.05, 0.10, 0.10, 0.10, 0],
    parityPenalty: 0.04,
    gapFree: 0.35,
    warmthFloor: -0.6,
  },
  friends: {
    appId: "friends",
    D: [0, 0.02, 0.10, 0.08, 0.14, 0.02],
    A: [
      { iDim: 3, jDim: 4, weight: 0.08 },
      { iDim: 4, jDim: 3, weight: 0.08 },
    ],
    parityWeights: [0, 0.05, 0.35, 0.30, 0.30, 0],
    parityPenalty: 0.05,
    gapFree: 0.45,
    warmthFloor: -0.5,
  },
  peon: {
    appId: "peon",
    D: [0, 0.04, 0.16, 0.04, 0.12, 0.05],
    A: [
      { iDim: 1, jDim: 2, weight: 0.16 },
      { iDim: 2, jDim: 1, weight: 0.16 },
      { iDim: 1, jDim: 5, weight: 0.12 },
      { iDim: 5, jDim: 1, weight: 0.12 },
    ],
    parityWeights: [0, 0.35, 0.35, 0.05, 0.10, 0.15],
    parityPenalty: 0.10,
    gapFree: 0.40,
    warmthFloor: -0.5,
  },
  ntwrk: {
    appId: "ntwrk",
    D: [0, 0.04, 0.08, 0.07, 0.12, 0.04],
    A: [
      { iDim: 1, jDim: 2, weight: 0.14 },
      { iDim: 2, jDim: 1, weight: 0.14 },
      { iDim: 1, jDim: 5, weight: 0.12 },
      { iDim: 5, jDim: 1, weight: 0.12 },
      { iDim: 3, jDim: 5, weight: 0.09 },
      { iDim: 5, jDim: 3, weight: 0.09 },
    ],
    parityWeights: [0, 0.30, 0.30, 0.15, 0.10, 0.15],
    parityPenalty: 0.10,
    gapFree: 0.45,
    warmthFloor: -0.5,
  },
};

const ECON_RE = /\b(founder|ceo|cto|partner|investor|angel|patron|vp|director|principal|staff|lead|executive|hiring|seed|series|grant|sponsor)\b/i;
const CULT_RE = /\b(research|phd|scientist|engineer|architect|artist|writer|author|musician|composer|filmmaker|designer|curator|professor|fellow|published|open[\s_-]?source|craft)\b/i;
const POT_RE = /\b(building|launching|shipping|fellowship|residency|apprentic|prot[eé]g[eé]|emerging|breakout|early[\s_-]?career|portfolio)\b/i;
const WELCOME_RE = /\b(mentor|host|connector|welcome|community|teach|advise|coaching)\b/i;

const logistic = (x: number): number => 1 / (1 + Math.exp(-Math.max(-18, Math.min(18, x))));
const safeLogit = (p: number): number => {
  const c = Math.max(1e-4, Math.min(1 - 1e-4, p));
  return Math.log(c / (1 - c));
};

export function solveSpringRank(
  ids: readonly MemberId[],
  directedEdges: readonly SpringRankEdge[],
  prior: ReadonlyMap<MemberId, number> = new Map(),
  lambdaReg = 1.0,
  maxIters = 25,
  tol = 1e-7,
): SpringRankResult {
  const sorted = [...ids].sort();
  const n = sorted.length;
  const ranks = new Map<MemberId, number>();
  if (n === 0) return { ranks, hierarchyBeta: 0, iterations: 0, residualNorm: 0 };

  const idxOf = new Map<MemberId, number>();
  for (let i = 0; i < n; i++) idxOf.set(sorted[i]!, i);

  const reg = Math.max(1e-3, lambdaReg);
  const outRaw = new Float64Array(n);
  const validEdges: { u: number; v: number; w: number }[] = [];
  for (const e of directedEdges) {
    if (!(e.weight > 0) || e.from === e.to) continue;
    const u = idxOf.get(e.from), v = idxOf.get(e.to);
    if (u === undefined || v === undefined) continue;
    outRaw[u] = outRaw[u]! + e.weight;
    validEdges.push({ u, v, w: e.weight });
  }

  const dIn = new Float64Array(n);
  const dOut = new Float64Array(n);
  const pairSym = new Map<string, { u: number; v: number; w: number }>();
  const normDirected: { u: number; v: number; w: number }[] = [];
  for (const e of validEdges) {
    const scale = outRaw[e.u]! > 1 ? 1 / outRaw[e.u]! : 1;
    const w = e.w * scale;
    dOut[e.u] = dOut[e.u]! + w;
    dIn[e.v] = dIn[e.v]! + w;
    normDirected.push({ u: e.u, v: e.v, w });
    const a = e.u < e.v ? e.u : e.v, b = e.u < e.v ? e.v : e.u;
    const k = `${a}|${b}`;
    const cur = pairSym.get(k);
    if (cur) cur.w += w;
    else pairSym.set(k, { u: a, v: b, w });
  }

  const adj: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  for (const { u, v, w } of pairSym.values()) {
    adj[u]!.push({ to: v, w });
    adj[v]!.push({ to: u, w });
  }
  for (let i = 0; i < n; i++) adj[i]!.sort((x, y) => x.to - y.to);

  const diag = new Float64Array(n);
  const invDiag = new Float64Array(n);
  const rhs = new Float64Array(n);
  const r = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const r0 = prior.get(sorted[i]!) ?? 0;
    diag[i] = dIn[i]! + dOut[i]! + reg;
    invDiag[i] = 1 / diag[i]!;
    rhs[i] = dIn[i]! - dOut[i]! + reg * r0;
    r[i] = r0;
  }

  const applyM = (x: Float64Array, out: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let acc = diag[i]! * x[i]!;
      for (const nb of adj[i]!) acc -= nb.w * x[nb.to]!;
      out[i] = acc;
    }
  };

  const Mr = new Float64Array(n);
  applyM(r, Mr);
  const res = new Float64Array(n);
  const z = new Float64Array(n);
  const p = new Float64Array(n);
  let rz = 0;
  let resSq = 0;
  for (let i = 0; i < n; i++) {
    const ri = rhs[i]! - Mr[i]!;
    res[i] = ri;
    resSq += ri * ri;
    const zi = invDiag[i]! * ri;
    z[i] = zi;
    p[i] = zi;
    rz += ri * zi;
  }

  const Ap = new Float64Array(n);
  let iters = 0;
  let resNorm = Math.sqrt(resSq);
  while (iters < maxIters && resNorm > tol) {
    iters++;
    applyM(p, Ap);
    let pAp = 0;
    for (let i = 0; i < n; i++) pAp += p[i]! * Ap[i]!;
    if (!(pAp > 1e-15)) break;
    const alpha = rz / pAp;
    resSq = 0;
    for (let i = 0; i < n; i++) {
      r[i] = r[i]! + alpha * p[i]!;
      const ri = res[i]! - alpha * Ap[i]!;
      res[i] = ri;
      resSq += ri * ri;
    }
    resNorm = Math.sqrt(resSq);
    if (resNorm <= tol) break;
    let rzNext = 0;
    for (let i = 0; i < n; i++) {
      const zi = invDiag[i]! * res[i]!;
      z[i] = zi;
      rzNext += res[i]! * zi;
    }
    if (!(rz > 1e-18)) break;
    const betaCg = rzNext / rz;
    for (let i = 0; i < n; i++) p[i] = z[i]! + betaCg * p[i]!;
    rz = rzNext;
  }

  for (let i = 0; i < n; i++) ranks.set(sorted[i]!, clampStatusZ(r[i]!));

  let wTot = 0, errSq = 0;
  for (const e of normDirected) {
    const diff = r[e.v]! - r[e.u]! - 1;
    wTot += e.w;
    errSq += e.w * diff * diff;
  }
  const hierarchyBeta = wTot > 0 ? Math.min(10, wTot / Math.max(0.1, errSq)) : 0;
  return { ranks, hierarchyBeta, iterations: iters, residualNorm: resNorm };
}

export function solveEigenTrust(
  ids: readonly MemberId[],
  trustEdges: readonly SpringRankEdge[],
  seeds: ReadonlySet<MemberId>,
  alphaSeed = 0.20,
  iters = 20,
): Map<MemberId, number> {
  const sorted = [...ids].sort();
  const n = sorted.length;
  const out = new Map<MemberId, number>();
  if (n === 0) return out;

  const idxOf = new Map<MemberId, number>();
  for (let i = 0; i < n; i++) idxOf.set(sorted[i]!, i);

  const seedIdx: number[] = [];
  for (let i = 0; i < n; i++) if (seeds.has(sorted[i]!)) seedIdx.push(i);
  const pSeed = new Float64Array(n);
  if (seedIdx.length > 0) {
    const inv = 1 / seedIdx.length;
    for (const i of seedIdx) pSeed[i] = inv;
  } else {
    const inv = 1 / n;
    for (let i = 0; i < n; i++) pSeed[i] = inv;
  }

  const outEdges: { to: number; w: number }[][] = Array.from({ length: n }, () => []);
  const rowSum = new Float64Array(n);
  for (const e of trustEdges) {
    if (!(e.weight > 0) || e.from === e.to) continue;
    const u = idxOf.get(e.from), v = idxOf.get(e.to);
    if (u === undefined || v === undefined) continue;
    outEdges[u]!.push({ to: v, w: e.weight });
    rowSum[u] = rowSum[u]! + e.weight;
  }
  for (let i = 0; i < n; i++) outEdges[i]!.sort((x, y) => x.to - y.to);

  let t = new Float64Array(pSeed);
  let next = new Float64Array(n);
  const damp = Math.max(0.05, Math.min(0.95, alphaSeed));
  for (let it = 0; it < iters; it++) {
    let danglingMass = 0;
    for (let i = 0; i < n; i++) {
      next[i] = damp * pSeed[i]!;
      if (!(rowSum[i]! > 0)) danglingMass += t[i]!;
    }
    const dangShare = (1 - damp) * danglingMass;
    if (dangShare > 0) {
      for (let i = 0; i < n; i++) next[i] = next[i]! + dangShare * pSeed[i]!;
    }
    for (let u = 0; u < n; u++) {
      const rs = rowSum[u]!;
      if (!(rs > 0)) continue;
      const factor = ((1 - damp) * t[u]!) / rs;
      for (const nb of outEdges[u]!) next[nb.to] = next[nb.to]! + factor * nb.w;
    }
    const tmp = t;
    t = next;
    next = tmp;
  }

  for (let i = 0; i < n; i++) out.set(sorted[i]!, t[i]!);
  return out;
}

export function glicko2SingleUpdate(
  muI: number,
  sigmaI: number,
  muJ: number,
  sigmaJ: number,
  alphaJ: number,
  y: number,
  obsWeight = 1.0,
): { mu: number; sigma: number } {
  if (!(obsWeight > 0)) return { mu: clampStatusZ(muI), sigma: clampStatusSigma(sigmaI) };
  const sI2 = sigmaI * sigmaI;
  const sJ2 = sigmaJ * sigmaJ;
  const c = Math.sqrt(1 + 0.30396355 * (sI2 + sJ2));
  const p = logistic((alphaJ + muI - muJ) / c);
  const yClamped = Math.max(0, Math.min(1, y));
  const step = ((obsWeight * sI2) / (c * (1 + sI2 + sJ2))) * (yClamped - p);
  const precNew = 1 / Math.max(0.0225, sI2) + (obsWeight * p * (1 - p)) / (c * c);
  return {
    mu: clampStatusZ(muI + step),
    sigma: clampStatusSigma(1 / Math.sqrt(precNew)),
  };
}

function zStandardize(ids: readonly MemberId[], raw: ReadonlyMap<MemberId, number>): Map<MemberId, number> {
  const out = new Map<MemberId, number>();
  if (!ids.length) return out;
  let sum = 0;
  for (const id of ids) sum += raw.get(id) ?? 0;
  const mean = sum / ids.length;
  let sq = 0;
  for (const id of ids) {
    const d = (raw.get(id) ?? 0) - mean;
    sq += d * d;
  }
  const sd = Math.sqrt(sq / ids.length);
  for (const id of ids) {
    const v = sd > 1e-6 ? ((raw.get(id) ?? 0) - mean) / sd : 0;
    out.set(id, clampStatusZ(v));
  }
  return out;
}

function facetMatches(f: Facet, re: RegExp): boolean {
  if (re.test(f.value)) return true;
  for (const tag of f.tags) if (re.test(tag)) return true;
  return false;
}

function facetSignal(facets: readonly Facet[], re: RegExp): number {
  let acc = 0;
  for (const f of facets) {
    if (facetMatches(f, re)) acc += provenanceWeight(f);
  }
  return acc;
}

const statusCache = new WeakMap<World, ReadonlyMap<MemberId, StatusBelief>>();
const welcomesCache = new WeakMap<World, ReadonlySet<MemberId>>();

export function memberWelcomesNewcomers(w: World, id: MemberId): boolean {
  let set = welcomesCache.get(w);
  if (!set) {
    const s = new Set<MemberId>();
    const adultFloor = Math.max(18, w.pack.eligibility.minMatchAge, w.cfg.ageMin);
    for (const mid of w.ids) {
      const mi = w.get(mid)!;
      if (w.minors.has(mid) || !canComputeStatus(mi.m.age, adultFloor)) continue;
      if (mi.isHost || mi.match.some(f => facetMatches(f, WELCOME_RE))) s.add(mid);
    }
    set = s;
    welcomesCache.set(w, set);
  }
  return set.has(id);
}

export function worldStatusBeliefs(w: World): ReadonlyMap<MemberId, StatusBelief> {
  const cached = statusCache.get(w);
  if (cached) return cached;

  const adultFloor = Math.max(18, w.pack.eligibility.minMatchAge, w.cfg.ageMin);
  const adults: MemberId[] = [];
  for (const id of w.ids) {
    const mi = w.get(id);
    if (!mi || w.minors.has(id)) continue;
    if (!canComputeStatus(mi.m.age, adultFloor)) continue;
    adults.push(id);
  }
  if (adults.length < MIN_STATUS_COHORT) {
    const empty = new Map<MemberId, StatusBelief>();
    statusCache.set(w, empty);
    return empty;
  }

  const adultSet = new Set<MemberId>(adults);
  const isSlop = w.pack.id === "slop";
  const physGate = physDimensionWeight(isSlop, 1.0);

  const allFacetsBy = new Map<MemberId, Facet[]>();
  if (physGate > 0) {
    for (const f of w.input.facets) {
      if (f.validTo !== undefined && f.validTo < w.now) continue;
      if (f.validFrom !== undefined && f.validFrom > w.now) continue;
      const cid = w.canonical(f.memberId);
      if (!adultSet.has(cid)) continue;
      let list = allFacetsBy.get(cid);
      if (!list) { list = []; allFacetsBy.set(cid, list); }
      list.push(f);
    }
  }

  const seeds = new Set<MemberId>();
  const negReceived = new Set<MemberId>();
  for (const fb of w.feedback) {
    if (fb.at <= w.now && fb.sentiment === "negative") negReceived.add(fb.about);
  }
  for (const id of adults) {
    const mi = w.get(id)!;
    if (mi.inviterRoot === id && !w.holds.has(id) && !negReceived.has(id) && (!mi.newcomer || mi.degree >= 2)) {
      seeds.add(id);
    }
  }

  const trustEdges: SpringRankEdge[] = [];
  for (const id of adults) {
    const mi = w.get(id)!;
    const inv = mi.m.invitedBy ? w.canonical(mi.m.invitedBy) : undefined;
    if (inv && inv !== id && adultSet.has(inv) && !w.blocked.has(id < inv ? `${id}|${inv}` : `${inv}|${id}`)) {
      trustEdges.push({ from: inv, to: id, weight: 1.0 });
      trustEdges.push({ from: id, to: inv, weight: 0.35 });
    }
    const pos = w.positive.get(id);
    if (pos) {
      for (const [nb, str] of [...pos.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
        if (adultSet.has(nb)) trustEdges.push({ from: id, to: nb, weight: str });
      }
    }
  }
  const eigenRaw = solveEigenTrust(adults, trustEdges, seeds, 0.20, 20);
  const eigenZ = zStandardize(adults, eigenRaw);

  const srEdges: SpringRankEdge[] = [];
  for (const r of w.interactions) {
    if (r.at > w.now || r.participants.length !== 2) continue;
    const [a, b] = r.participants as [MemberId, MemberId];
    if (!adultSet.has(a) || !adultSet.has(b)) continue;
    const accA = r.acceptedBy?.includes(a) ?? false;
    const accB = r.acceptedBy?.includes(b) ?? false;
    const decA = r.declinedBy?.includes(a) ?? false;
    const decB = r.declinedBy?.includes(b) ?? false;
    if (accA && !(r.outcome === "cancelled" && decA)) srEdges.push({ from: a, to: b, weight: 0.7 });
    if (accB && !(r.outcome === "cancelled" && decB)) srEdges.push({ from: b, to: a, weight: 0.7 });
  }
  for (const fb of w.feedback) {
    if (fb.at > w.now || !adultSet.has(fb.from) || !adultSet.has(fb.about)) continue;
    if (fb.sentiment === "positive" || fb.wouldMeetAgain === true) {
      srEdges.push({ from: fb.from, to: fb.about, weight: fb.wouldMeetAgain ? 1.4 : 1.0 });
    }
  }
  const srRes = solveSpringRank(adults, srEdges, eigenZ, 1.2, 25, 1e-7);
  const springZ = zStandardize(adults, srRes.ranks);

  const econRaw = new Map<MemberId, number>();
  const cultRaw = new Map<MemberId, number>();
  const socRaw = new Map<MemberId, number>();
  const warmRaw = new Map<MemberId, number>();
  const potRaw = new Map<MemberId, number>();
  const physMu = new Map<MemberId, number>();
  const physSig = new Map<MemberId, number>();

  const posFbCount = new Map<MemberId, number>();
  const negFbCount = new Map<MemberId, number>();
  for (const fb of w.feedback) {
    if (fb.at > w.now || !adultSet.has(fb.about)) continue;
    if (fb.sentiment === "positive" || fb.wouldMeetAgain === true) posFbCount.set(fb.about, (posFbCount.get(fb.about) ?? 0) + 1);
    else if (fb.sentiment === "negative" || fb.wouldMeetAgain === false) negFbCount.set(fb.about, (negFbCount.get(fb.about) ?? 0) + 1);
  }

  for (const id of adults) {
    const mi = w.get(id)!;
    if (physGate > 0) {
      const fs = allFacetsBy.get(id) ?? [];
      const tags = fs.flatMap(f => f.tags);
      const ageFailed = tags.includes("verify:age:fail");
      const ap = canRatePhotos({ age: mi.m.age, ageVerified: ageFailed ? false : undefined })
        ? parseAppearance(fs.filter(f => f.tags.some(t => t.startsWith(APPEARANCE_PREFIX))).flatMap(f => f.tags))
        : undefined;
      if (ap && ap.confidence >= 0.3) {
        const comp = 0.25 * ap.face + 0.25 * ap.body + 0.50 * ap.overall;
        physMu.set(id, clampStatusZ(ap.confidence * comp));
        physSig.set(id, clampStatusSigma(Math.sqrt(0.15 * 0.15 + (1 - ap.confidence) * 0.75 * 0.75)));
      } else {
        physMu.set(id, 0);
        physSig.set(id, 0.95);
      }
    } else {
      physMu.set(id, 0);
      physSig.set(id, 1.0);
    }

    const econScore = facetSignal(mi.caps, ECON_RE) + 0.5 * facetSignal(mi.match, ECON_RE) + 0.2 * mi.caps.length;
    const cultScore = facetSignal(mi.caps, CULT_RE) + 0.6 * facetSignal(mi.match, CULT_RE) + 0.15 * mi.match.reduce((s, f) => s + provenanceWeight(f), 0);
    const vouchedCount = mi.match.filter(f => f.provenance === "vouched").length;
    const rel = w.reliability[id];
    const noShows = rel?.noShows ?? 0;
    const completed = rel?.completedSinceLastNoShow ?? 0;
    const warmScore = 0.8 * (posFbCount.get(id) ?? 0) - 1.4 * (negFbCount.get(id) ?? 0) + 0.4 * completed - 1.5 * noShows
      + (mi.isHost ? 0.35 : 0) - (w.holds.has(id) ? 2.5 : 0);
    const socScore = 0.55 * (eigenZ.get(id) ?? 0) + 0.45 * (springZ.get(id) ?? 0) + 0.12 * Math.log1p(mi.degree);
    const invId = mi.m.invitedBy ? w.canonical(mi.m.invitedBy) : undefined;
    const invLift = invId && adultSet.has(invId) ? 0.35 * Math.max(0, eigenZ.get(invId) ?? 0) : 0;
    const potScore = facetSignal(mi.match, POT_RE) + 0.45 * vouchedCount + invLift + 0.2 * Math.min(4, mi.caps.length);

    econRaw.set(id, econScore);
    cultRaw.set(id, cultScore);
    socRaw.set(id, socScore);
    warmRaw.set(id, warmScore);
    potRaw.set(id, potScore);
  }

  const econZ = zStandardize(adults, econRaw);
  const cultZ = zStandardize(adults, cultRaw);
  const socZ = zStandardize(adults, socRaw);
  const warmZ = zStandardize(adults, warmRaw);
  const potZ = zStandardize(adults, potRaw);

  let meanAcc = 0;
  for (const id of adults) meanAcc += w.get(id)!.acceptance;
  meanAcc = adults.length ? meanAcc / adults.length : w.cfg.acceptance.prior;
  const baseLogit = safeLogit(meanAcc);

  const muWork = new Map<MemberId, [number, number, number, number, number, number]>();
  const sigWork = new Map<MemberId, [number, number, number, number, number, number]>();
  const alphaOf = new Map<MemberId, number>();
  const obsCount = new Map<MemberId, number>();

  for (const id of adults) {
    const mi = w.get(id)!;
    const dataConf = Math.min(1, mi.match.length / 6);
    const baseSig = clampStatusSigma(0.85 - 0.30 * dataConf);
    muWork.set(id, [
      physGate > 0 ? (physMu.get(id) ?? 0) : 0,
      econZ.get(id) ?? 0,
      cultZ.get(id) ?? 0,
      socZ.get(id) ?? 0,
      warmZ.get(id) ?? 0,
      potZ.get(id) ?? 0,
    ]);
    sigWork.set(id, [
      physGate > 0 ? (physSig.get(id) ?? 0.95) : 1.0,
      baseSig,
      baseSig,
      clampStatusSigma(0.75 - 0.25 * Math.min(1, mi.degree / 4)),
      clampStatusSigma(0.80 - 0.25 * Math.min(1, (posFbCount.get(id) ?? 0) / 3)),
      baseSig,
    ]);
    alphaOf.set(id, safeLogit(mi.acceptance) - baseLogit);
    obsCount.set(id, 0);
  }

  const primaryDim = physGate > 0 ? 0 : w.pack.id === "peon" ? 2 : 3;
  const sortedInteractions = [...w.interactions]
    .filter(r => r.at <= w.now && r.participants.length === 2 && adultSet.has(r.participants[0]!) && adultSet.has(r.participants[1]!))
    .sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1));

  for (const r of sortedInteractions) {
    const [a, b] = r.participants as [MemberId, MemberId];
    for (const [judge, target] of [[a, b], [b, a]] as const) {
      const accepted = r.acceptedBy?.includes(judge) ?? false;
      const declined = r.declinedBy?.includes(judge) ?? false;
      if (!accepted && !declined) continue;
      const backedOut = r.outcome === "cancelled" && declined;
      const y = backedOut ? 0 : accepted ? 1 : 0;
      const wObs = backedOut ? 0.65 : 0.25;
      const mT = muWork.get(target)!, sT = sigWork.get(target)!;
      const mJ = muWork.get(judge)!, sJ = sigWork.get(judge)!;
      const upd = glicko2SingleUpdate(mT[primaryDim]!, sT[primaryDim]!, mJ[primaryDim]!, sJ[primaryDim]!, alphaOf.get(judge) ?? 0, y, wObs);
      mT[primaryDim] = physGate === 0 && primaryDim === 0 ? 0 : upd.mu;
      sT[primaryDim] = upd.sigma;
      obsCount.set(target, (obsCount.get(target) ?? 0) + 1);
    }
    if (r.outcome === "no_show") {
      const who = r.noShowBy?.length ? r.noShowBy : r.participants;
      for (const flaker of who) {
        if (!adultSet.has(flaker)) continue;
        const mF = muWork.get(flaker)!, sF = sigWork.get(flaker)!;
        const upd = glicko2SingleUpdate(mF[4]!, sF[4]!, 0, 0.5, 0, 0, 1.2);
        mF[4] = upd.mu;
        sF[4] = upd.sigma;
      }
    }
  }

  const sortedFb = [...w.feedback]
    .filter(fb => fb.at <= w.now && adultSet.has(fb.from) && adultSet.has(fb.about))
    .sort((a, b) => (a.at - b.at) || (a.id < b.id ? -1 : 1));
  const SENT = { positive: 1, neutral: 0.5, negative: 0 } as const;
  for (const fb of sortedFb) {
    const y = fb.wouldMeetAgain === undefined ? SENT[fb.sentiment] : 0.5 * (SENT[fb.sentiment] + (fb.wouldMeetAgain ? 1 : 0));
    const mT = muWork.get(fb.about)!, sT = sigWork.get(fb.about)!;
    const mJ = muWork.get(fb.from)!, sJ = sigWork.get(fb.from)!;
    const alpha = alphaOf.get(fb.from) ?? 0;
    const uWarm = glicko2SingleUpdate(mT[4]!, sT[4]!, mJ[4]!, sJ[4]!, alpha, y, 0.9);
    mT[4] = uWarm.mu;
    sT[4] = uWarm.sigma;
    const uPrim = glicko2SingleUpdate(mT[primaryDim]!, sT[primaryDim]!, mJ[primaryDim]!, sJ[primaryDim]!, alpha, y, 0.6);
    mT[primaryDim] = physGate === 0 && primaryDim === 0 ? 0 : uPrim.mu;
    sT[primaryDim] = uPrim.sigma;
    obsCount.set(fb.about, (obsCount.get(fb.about) ?? 0) + 1);
  }

  const out = new Map<MemberId, StatusBelief>();
  for (const id of adults) {
    const m = muWork.get(id)!, s = sigWork.get(id)!;
    out.set(id, {
      mu: [
        physGate > 0 ? clampStatusZ(m[0]) : 0,
        clampStatusZ(m[1]),
        clampStatusZ(m[2]),
        clampStatusZ(m[3]),
        clampStatusZ(m[4]),
        clampStatusZ(m[5]),
      ],
      sigma: [
        clampStatusSigma(s[0]),
        clampStatusSigma(s[1]),
        clampStatusSigma(s[2]),
        clampStatusSigma(s[3]),
        clampStatusSigma(s[4]),
        clampStatusSigma(s[5]),
      ],
      selectivityAlpha: alphaOf.get(id) ?? 0,
      observations: obsCount.get(id) ?? 0,
    });
  }

  statusCache.set(w, out);
  return out;
}

export function directionalStatusMultiplier(
  a: StatusBelief,
  b: StatusBelief,
  K: VerticalStatusKernel,
  sampleA?: readonly number[],
  sampleB?: readonly number[],
): number {
  const sA = sampleA ?? a.mu;
  const sB = sampleB ?? b.mu;
  const isSlop = K.appId === "slop";

  let pamSq = 0;
  for (let d = 0; d < 6; d++) {
    const w = d === 0 ? physDimensionWeight(isSlop, K.D[0]) : Math.max(0, K.D[d]!);
    if (w <= 0) continue;
    const effGap = effectiveAssortativeGap(sA[d] ?? 0, sB[d] ?? 0, K.gapFree);
    pamSq += w * effGap * effGap;
  }

  let namGain = 0;
  for (const { iDim, jDim, weight } of K.A) {
    const effW = iDim === 0 || jDim === 0 ? physDimensionWeight(isSlop, weight) : weight;
    namGain += namExchangeCredit(sA[iDim] ?? 0, sB[jDim] ?? 0, effW);
  }
  namGain = Math.min(0.30, namGain);

  const capNorm = (s: readonly number[]) => {
    let acc = 0;
    for (let d = 0; d < 6; d++) {
      const w = d === 0 ? physDimensionWeight(isSlop, K.parityWeights[0]) : Math.max(0, K.parityWeights[d]!);
      const pos = Math.max(0, s[d] ?? 0);
      acc += w * pos * pos;
    }
    return Math.sqrt(acc);
  };
  const parityGap = effectiveAssortativeGap(capNorm(sA), capNorm(sB), K.gapFree + 0.25);
  const parityPen = Math.max(0, K.parityPenalty) * parityGap * parityGap;

  const warmthPen = warmthFloorPenalty(sB[4] ?? 0, K.warmthFloor);

  const mult = Math.exp(-pamSq - parityPen - warmthPen + namGain);
  return Math.max(0.15, Math.min(1.35, Number.isFinite(mult) ? mult : 1));
}

export function worldStatusPairMultipliers(
  w: World,
  a: MemberId,
  b: MemberId,
  sampleA?: readonly number[],
  sampleB?: readonly number[],
): { ab: number; ba: number } {
  const beliefs = worldStatusBeliefs(w);
  const bA = beliefs.get(a), bB = beliefs.get(b);
  if (!bA || !bB) return { ab: 1, ba: 1 };
  const K = VERTICAL_KERNELS[w.pack.id] ?? VERTICAL_KERNELS.ntwrk;
  return {
    ab: directionalStatusMultiplier(bA, bB, K, sampleA, sampleB),
    ba: directionalStatusMultiplier(bB, bA, K, sampleB, sampleA),
  };
}

export function explorationPairAllowed(
  w: World,
  a: MemberId,
  b: MemberId,
  shadowPrice: ReadonlyMap<MemberId, number>,
  p80ShadowPrice: number,
): boolean {
  const beliefs = worldStatusBeliefs(w);
  const bA = beliefs.get(a), bB = beliefs.get(b);
  if (!bA || !bB) return true;
  const K = VERTICAL_KERNELS[w.pack.id] ?? VERTICAL_KERNELS.ntwrk;
  const isSlop = K.appId === "slop";
  const capOf = (s: StatusBelief) => {
    let acc = 0;
    for (let d = 0; d < 6; d++) {
      const wt = d === 0 ? physDimensionWeight(isSlop, K.parityWeights[0]) : Math.max(0, K.parityWeights[d]!);
      const pos = Math.max(0, s.mu[d]!);
      acc += wt * pos * pos;
    }
    return Math.sqrt(acc);
  };
  const meanSigma = (s: StatusBelief) => (s.sigma[1] + s.sigma[2] + s.sigma[3] + s.sigma[4]) / 4;
  const capA = capOf(bA), capB = capOf(bB);
  const uncalA = meanSigma(bA) > 0.65 && bA.observations < 2;
  const uncalB = meanSigma(bB) > 0.65 && bB.observations < 2;
  const aboveA = (shadowPrice.get(a) ?? -Infinity) > p80ShadowPrice;
  const aboveB = (shadowPrice.get(b) ?? -Infinity) > p80ShadowPrice;
  const okAToB = explorationTargetAllowed(uncalA, aboveB, memberWelcomesNewcomers(w, b), capA + K.gapFree + 0.35 >= capB);
  const okBToA = explorationTargetAllowed(uncalB, aboveA, memberWelcomesNewcomers(w, a), capB + K.gapFree + 0.35 >= capA);
  return okAToB && okBToA;
}
