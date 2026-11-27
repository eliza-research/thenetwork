import type { MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";

const canonicalPairKey = (a: MemberId, b: MemberId): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface CsrAdultGraph {
  readonly ids: readonly MemberId[];
  readonly idToIdx: ReadonlyMap<MemberId, number>;
  readonly rowPtr: Int32Array;
  readonly colIdx: Int32Array;
  readonly weights: Float32Array;
  readonly degrees: Float64Array;
  readonly totalEdgeWeight: number;
}

export interface LeidenPartition {
  readonly gamma: number;
  readonly modularity: number;
  readonly communityOf: ReadonlyMap<MemberId, number>;
  readonly membersOf: ReadonlyMap<number, readonly MemberId[]>;
  readonly communityCount: number;
}

export interface AdultGraphMemberInput {
  id: MemberId;
  age: number;
  city: string;
  desireTags: readonly string[];
}

export function buildAdultCsrGraph(
  members: readonly AdultGraphMemberInput[],
  positive: ReadonlyMap<MemberId, ReadonlyMap<MemberId, number>>,
  blocked: ReadonlySet<string>,
  minors: ReadonlySet<MemberId>,
): CsrAdultGraph {
  const adults = [...members]
    .filter(m => !minors.has(m.id) && canBeMatched(m.age))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const V = adults.length;
  const ids = adults.map(a => a.id);
  const idToIdx = new Map<MemberId, number>();
  for (let i = 0; i < V; i++) idToIdx.set(ids[i]!, i);

  const adj: Map<number, number>[] = Array.from({ length: V }, () => new Map<number, number>());
  const addUndirected = (u: number, v: number, w: number) => {
    if (u === v || w <= 0) return;
    const iu = ids[u]!, iv = ids[v]!;
    if (blocked.has(canonicalPairKey(iu, iv))) return;
    const next = (adj[u]!.get(v) ?? 0) + w;
    adj[u]!.set(v, next);
    adj[v]!.set(u, next);
  };

  for (let u = 0; u < V; u++) {
    const iu = ids[u]!;
    const nbrs = positive.get(iu);
    if (!nbrs) continue;
    for (const [iv, strength] of nbrs) {
      const v = idToIdx.get(iv);
      if (v === undefined || u >= v) continue;
      if (blocked.has(canonicalPairKey(iu, iv))) continue;
      addUndirected(u, v, Math.max(0.1, Math.min(1, strength)));
    }
  }

  const byCityTag = new Map<string, number[]>();
  const globalTagCount = new Map<string, number>();
  for (let u = 0; u < V; u++) {
    const a = adults[u]!;
    const seen = new Set<string>();
    for (let t = 0; t < a.desireTags.length; t++) {
      const tag = a.desireTags[t]!.toLowerCase();
      if (seen.has(tag)) continue;
      seen.add(tag);
      globalTagCount.set(tag, (globalTagCount.get(tag) ?? 0) + 1);
      const ck = `${a.city}|${tag}`;
      let list = byCityTag.get(ck);
      if (!list) { list = []; byCityTag.set(ck, list); }
      list.push(u);
    }
  }

  const RING_K = 4;
  for (const ck of [...byCityTag.keys()].sort()) {
    const group = byCityTag.get(ck)!;
    if (group.length < 2) continue;
    const tag = ck.slice(ck.indexOf("|") + 1);
    const freq = globalTagCount.get(tag) ?? group.length;
    const w = 0.22 / (1 + Math.log(1 + freq));
    const len = group.length;
    const maxStep = Math.min(RING_K, len - 1);
    for (let i = 0; i < len; i++) {
      const u = group[i]!;
      for (let step = 1; step <= maxStep; step++) {
        const j = i + step;
        if (j >= len && len <= RING_K + 1) break;
        const v = group[j % len]!;
        if (u < v) addUndirected(u, v, w);
      }
    }
  }

  const rowPtr = new Int32Array(V + 1);
  let totalDirected = 0;
  for (let u = 0; u < V; u++) {
    rowPtr[u] = totalDirected;
    totalDirected += adj[u]!.size;
  }
  rowPtr[V] = totalDirected;

  const colIdx = new Int32Array(totalDirected);
  const weights = new Float32Array(totalDirected);
  const degrees = new Float64Array(V);
  let totalWeight2 = 0;

  for (let u = 0; u < V; u++) {
    const entries = [...adj[u]!.entries()].sort((a, b) => a[0] - b[0]);
    let pos = rowPtr[u]!;
    let deg = 0;
    for (let k = 0; k < entries.length; k++) {
      const [v, w] = entries[k]!;
      colIdx[pos] = v;
      weights[pos] = w;
      deg += w;
      pos++;
    }
    degrees[u] = deg;
    totalWeight2 += deg;
  }

  return { ids, idToIdx, rowPtr, colIdx, weights, degrees, totalEdgeWeight: totalWeight2 * 0.5 };
}

interface InternalGraph {
  V: number;
  rowPtr: Int32Array;
  colIdx: Int32Array;
  weights: Float32Array;
  nodeWeight: Float64Array;
  selfWeight: Float64Array;
  twoM: number;
}

function fastLocalMove(g: InternalGraph, comm: Int32Array, gamma: number, seedFrontier?: readonly number[]): boolean {
  const { V, rowPtr, colIdx, weights, nodeWeight, twoM } = g;
  if (V === 0 || twoM <= 0) return false;

  let maxComm = 0;
  for (let i = 0; i < V; i++) if (comm[i]! > maxComm) maxComm = comm[i]!;
  const sigma = new Float64Array(Math.max(V, maxComm + 1) + 1);
  for (let i = 0; i < V; i++) sigma[comm[i]!]! += nodeWeight[i]!;

  const queue = new Int32Array(V * 8 + 16);
  const inQueue = new Uint8Array(V);
  let head = 0, tail = 0;

  if (seedFrontier && seedFrontier.length > 0) {
    for (let i = 0; i < seedFrontier.length; i++) {
      const u = seedFrontier[i]!;
      if (u >= 0 && u < V && !inQueue[u]) {
        inQueue[u] = 1;
        queue[tail++] = u;
      }
    }
  } else {
    for (let u = 0; u < V; u++) {
      inQueue[u] = 1;
      queue[tail++] = u;
    }
  }

  const commWeights = new Float64Array(sigma.length);
  const touched: number[] = [];
  let movedAny = false;
  const maxPops = Math.max(V * 6, 32);
  let pops = 0;

  while (head < tail && pops < maxPops) {
    const u = queue[head++]!;
    inQueue[u] = 0;
    pops++;

    const cOld = comm[u]!;
    const ku = nodeWeight[u]!;
    if (ku <= 0) continue;

    touched.length = 0;
    touched.push(cOld);
    const start = rowPtr[u]!, end = rowPtr[u + 1]!;
    for (let e = start; e < end; e++) {
      const v = colIdx[e]!;
      const cv = comm[v]!;
      if (commWeights[cv] === 0 && cv !== cOld) touched.push(cv);
      commWeights[cv]! += weights[e]!;
    }

    const wOld = commWeights[cOld]!;
    const sigmaOldWithoutU = sigma[cOld]! - ku;
    const baseGain = wOld - gamma * ((ku * sigmaOldWithoutU) / twoM);

    let bestComm = cOld;
    let bestDelta = 1e-12;

    for (let i = 0; i < touched.length; i++) {
      const c = touched[i]!;
      if (c === cOld) continue;
      const wc = commWeights[c]!;
      const gain = wc - gamma * ((ku * sigma[c]!) / twoM);
      const delta = gain - baseGain;
      if (delta > bestDelta || (Math.abs(delta - bestDelta) <= 1e-15 && bestComm !== cOld && c < bestComm)) {
        bestDelta = delta;
        bestComm = c;
      }
    }

    for (let i = 0; i < touched.length; i++) commWeights[touched[i]!] = 0;

    if (bestComm !== cOld) {
      comm[u] = bestComm;
      sigma[cOld]! -= ku;
      sigma[bestComm]! += ku;
      movedAny = true;
      for (let e = start; e < end; e++) {
        const v = colIdx[e]!;
        if (comm[v] !== bestComm && !inQueue[v] && tail < queue.length) {
          inQueue[v] = 1;
          queue[tail++] = v;
        }
      }
    }
  }
  return movedAny;
}

function refinePartition(g: InternalGraph, comm: Int32Array, gamma: number): { refined: Int32Array; numRefined: number; refinedToParent: Int32Array } {
  const { V, rowPtr, colIdx, weights, nodeWeight, twoM } = g;
  const byParent = new Map<number, number[]>();
  for (let u = 0; u < V; u++) {
    const c = comm[u]!;
    let arr = byParent.get(c);
    if (!arr) { arr = []; byParent.set(c, arr); }
    arr.push(u);
  }

  const refined = new Int32Array(V);
  const sigmaRef = new Float64Array(V);
  for (let u = 0; u < V; u++) {
    refined[u] = u;
    sigmaRef[u] = nodeWeight[u]!;
  }

  const inS = new Uint8Array(V);
  const wToS = new Float64Array(V);
  const subWeightToOutside = new Float64Array(V);
  const subSize = new Int32Array(V);
  subSize.fill(1);
  const commWeights = new Float64Array(V);
  const touched: number[] = [];

  for (const pKey of [...byParent.keys()].sort((a, b) => a - b)) {
    const nodes = byParent.get(pKey)!;
    if (nodes.length <= 1) continue;

    let sigmaS = 0;
    for (let i = 0; i < nodes.length; i++) {
      const u = nodes[i]!;
      inS[u] = 1;
      sigmaS += nodeWeight[u]!;
    }

    for (let i = 0; i < nodes.length; i++) {
      const u = nodes[i]!;
      let ws = 0;
      for (let e = rowPtr[u]!; e < rowPtr[u + 1]!; e++) {
        if (inS[colIdx[e]!]) ws += weights[e]!;
      }
      wToS[u] = ws;
      subWeightToOutside[u] = ws;
    }

    for (let i = 0; i < nodes.length; i++) {
      const u = nodes[i]!;
      if (subSize[refined[u]!] !== 1) continue;
      const ku = nodeWeight[u]!;
      if (wToS[u]! < gamma * ((ku * (sigmaS - ku)) / twoM)) continue;

      touched.length = 0;
      for (let e = rowPtr[u]!; e < rowPtr[u + 1]!; e++) {
        const v = colIdx[e]!;
        if (!inS[v]) continue;
        const rv = refined[v]!;
        if (rv === u) continue;
        if (commWeights[rv] === 0) touched.push(rv);
        commWeights[rv]! += weights[e]!;
      }

      let bestSub = -1;
      let bestGain = 1e-12;
      for (let t = 0; t < touched.length; t++) {
        const r = touched[t]!;
        const sigR = sigmaRef[r]!;
        if (subWeightToOutside[r]! < gamma * ((sigR * (sigmaS - sigR)) / twoM)) continue;
        const gain = commWeights[r]! - gamma * ((ku * sigR) / twoM);
        if (gain > bestGain || (Math.abs(gain - bestGain) <= 1e-15 && (bestSub < 0 || r < bestSub))) {
          bestGain = gain;
          bestSub = r;
        }
      }

      if (bestSub >= 0) {
        const wUR = commWeights[bestSub]!;
        refined[u] = bestSub;
        subSize[u] = 0;
        subSize[bestSub]! += 1;
        sigmaRef[bestSub]! += ku;
        subWeightToOutside[bestSub] = subWeightToOutside[bestSub]! + wToS[u]! - 2 * wUR;
      }

      for (let t = 0; t < touched.length; t++) commWeights[touched[t]!] = 0;
    }

    for (let i = 0; i < nodes.length; i++) inS[nodes[i]!] = 0;
  }

  const remap = new Int32Array(V).fill(-1);
  const parentList: number[] = [];
  let nextId = 0;
  for (let u = 0; u < V; u++) {
    const r = refined[u]!;
    if (remap[r] < 0) {
      remap[r] = nextId++;
      parentList.push(comm[u]!);
    }
    refined[u] = remap[r]!;
  }
  const pRemap = new Map<number, number>();
  let nextP = 0;
  const refinedToParent = new Int32Array(nextId);
  for (let r = 0; r < nextId; r++) {
    const p = parentList[r]!;
    let pm = pRemap.get(p);
    if (pm === undefined) { pm = nextP++; pRemap.set(p, pm); }
    refinedToParent[r] = pm;
  }

  return { refined, numRefined: nextId, refinedToParent };
}

function aggregateGraph(g: InternalGraph, refined: Int32Array, numRefined: number): InternalGraph {
  const { V, rowPtr, colIdx, weights, nodeWeight, selfWeight, twoM } = g;
  const superNodeWeight = new Float64Array(numRefined);
  const superSelfWeight = new Float64Array(numRefined);
  const adj: Map<number, number>[] = Array.from({ length: numRefined }, () => new Map<number, number>());

  for (let u = 0; u < V; u++) {
    const ru = refined[u]!;
    superNodeWeight[ru]! += nodeWeight[u]!;
    superSelfWeight[ru]! += selfWeight[u]!;
    for (let e = rowPtr[u]!; e < rowPtr[u + 1]!; e++) {
      const rv = refined[colIdx[e]!]!;
      const w = weights[e]!;
      if (ru === rv) {
        superSelfWeight[ru]! += w;
      } else {
        adj[ru]!.set(rv, (adj[ru]!.get(rv) ?? 0) + w);
      }
    }
  }

  const sRowPtr = new Int32Array(numRefined + 1);
  let total = 0;
  for (let r = 0; r < numRefined; r++) {
    sRowPtr[r] = total;
    total += adj[r]!.size;
  }
  sRowPtr[numRefined] = total;

  const sColIdx = new Int32Array(total);
  const sWeights = new Float32Array(total);
  for (let r = 0; r < numRefined; r++) {
    const entries = [...adj[r]!.entries()].sort((a, b) => a[0] - b[0]);
    let pos = sRowPtr[r]!;
    for (let k = 0; k < entries.length; k++) {
      sColIdx[pos] = entries[k]![0];
      sWeights[pos] = entries[k]![1];
      pos++;
    }
  }

  return {
    V: numRefined,
    rowPtr: sRowPtr,
    colIdx: sColIdx,
    weights: sWeights,
    nodeWeight: superNodeWeight,
    selfWeight: superSelfWeight,
    twoM,
  };
}

function enforceConnectedCommunities(base: InternalGraph, comm: Int32Array): Int32Array {
  const { V, rowPtr, colIdx } = base;
  const out = new Int32Array(V).fill(-1);
  const bfsQueue = new Int32Array(V);
  let nextComm = 0;

  for (let start = 0; start < V; start++) {
    if (out[start]! >= 0) continue;
    const targetComm = comm[start]!;
    const cid = nextComm++;
    out[start] = cid;
    let head = 0, tail = 0;
    bfsQueue[tail++] = start;
    while (head < tail) {
      const u = bfsQueue[head++]!;
      for (let e = rowPtr[u]!; e < rowPtr[u + 1]!; e++) {
        const v = colIdx[e]!;
        if (out[v]! < 0 && comm[v] === targetComm) {
          out[v] = cid;
          bfsQueue[tail++] = v;
        }
      }
    }
  }
  return out;
}

function computeModularity(base: InternalGraph, comm: Int32Array, gamma: number): number {
  const { V, rowPtr, colIdx, weights, nodeWeight, twoM } = base;
  if (V === 0 || twoM <= 0) return 0;
  let maxC = 0;
  for (let u = 0; u < V; u++) if (comm[u]! > maxC) maxC = comm[u]!;
  const sigma = new Float64Array(maxC + 1);
  let internal2 = 0;
  for (let u = 0; u < V; u++) {
    const cu = comm[u]!;
    sigma[cu]! += nodeWeight[u]!;
    for (let e = rowPtr[u]!; e < rowPtr[u + 1]!; e++) {
      if (comm[colIdx[e]!] === cu) internal2 += weights[e]!;
    }
  }
  let expected = 0;
  for (let c = 0; c <= maxC; c++) {
    const s = sigma[c]!;
    if (s > 0) expected += (s * s) / twoM;
  }
  return (internal2 - gamma * expected) / twoM;
}

function finalizePartition(graph: CsrAdultGraph, base: InternalGraph, rawComm: Int32Array, gamma: number): LeidenPartition {
  const connected = enforceConnectedCommunities(base, rawComm);
  const communityOf = new Map<MemberId, number>();
  const buckets = new Map<number, MemberId[]>();
  for (let u = 0; u < base.V; u++) {
    const id = graph.ids[u]!;
    const cid = connected[u]!;
    communityOf.set(id, cid);
    let b = buckets.get(cid);
    if (!b) { b = []; buckets.set(cid, b); }
    b.push(id);
  }
  const modularity = computeModularity(base, connected, gamma);
  return { gamma, modularity, communityOf, membersOf: buckets, communityCount: buckets.size };
}

export function detectLeidenCommunities(graph: CsrAdultGraph, gamma = 1.0): LeidenPartition {
  const V = graph.ids.length;
  const base: InternalGraph = {
    V,
    rowPtr: graph.rowPtr,
    colIdx: graph.colIdx,
    weights: graph.weights,
    nodeWeight: graph.degrees,
    selfWeight: new Float64Array(V),
    twoM: graph.totalEdgeWeight * 2,
  };
  if (V === 0 || base.twoM <= 0) {
    const communityOf = new Map<MemberId, number>();
    const membersOf = new Map<number, readonly MemberId[]>();
    for (let u = 0; u < V; u++) {
      communityOf.set(graph.ids[u]!, u);
      membersOf.set(u, [graph.ids[u]!]);
    }
    return { gamma, modularity: 0, communityOf, membersOf, communityCount: V };
  }

  let curGraph = base;
  const nodeToCur = new Int32Array(V);
  for (let u = 0; u < V; u++) nodeToCur[u] = u;
  let curComm: Int32Array = new Int32Array(V);
  for (let u = 0; u < V; u++) curComm[u] = u;

  for (let level = 0; level < 5; level++) {
    const moved = fastLocalMove(curGraph, curComm, gamma);
    const { refined, numRefined, refinedToParent } = refinePartition(curGraph, curComm, gamma);
    for (let u = 0; u < V; u++) {
      nodeToCur[u] = refined[nodeToCur[u]!]!;
    }
    if (numRefined === curGraph.V && !moved) {
      curComm = refinedToParent;
      break;
    }
    curGraph = aggregateGraph(curGraph, refined, numRefined);
    curComm = refinedToParent;
  }

  const finalComm = new Int32Array(V);
  for (let u = 0; u < V; u++) finalComm[u] = curComm[nodeToCur[u]!]!;
  return finalizePartition(graph, base, finalComm, gamma);
}

export function updateLeidenLocalDynamic(
  prev: LeidenPartition,
  graph: CsrAdultGraph,
  dirtyMembers: readonly MemberId[],
): LeidenPartition {
  const V = graph.ids.length;
  const base: InternalGraph = {
    V,
    rowPtr: graph.rowPtr,
    colIdx: graph.colIdx,
    weights: graph.weights,
    nodeWeight: graph.degrees,
    selfWeight: new Float64Array(V),
    twoM: graph.totalEdgeWeight * 2,
  };
  if (V === 0 || base.twoM <= 0) return detectLeidenCommunities(graph, prev.gamma);

  const comm = new Int32Array(V);
  let nextNewId = prev.communityCount + 1;
  for (let u = 0; u < V; u++) {
    const existing = prev.communityOf.get(graph.ids[u]!);
    comm[u] = existing !== undefined ? existing : nextNewId++;
  }

  const frontierSet = new Uint8Array(V);
  const frontier: number[] = [];
  for (let i = 0; i < dirtyMembers.length; i++) {
    const u = graph.idToIdx.get(dirtyMembers[i]!);
    if (u === undefined) continue;
    if (!frontierSet[u]) { frontierSet[u] = 1; frontier.push(u); }
    for (let e = graph.rowPtr[u]!; e < graph.rowPtr[u + 1]!; e++) {
      const v = graph.colIdx[e]!;
      if (!frontierSet[v]) { frontierSet[v] = 1; frontier.push(v); }
    }
  }

  if (frontier.length > 0) {
    fastLocalMove(base, comm, prev.gamma, frontier);
  }
  return finalizePartition(graph, base, comm, prev.gamma);
}

export function computeBurtBrokerage(
  adultIds: readonly MemberId[],
  positive: ReadonlyMap<MemberId, ReadonlyMap<MemberId, number>>,
  minors: ReadonlySet<MemberId>,
): Map<MemberId, number> {
  const out = new Map<MemberId, number>();
  for (let idx = 0; idx < adultIds.length; idx++) {
    const i = adultIds[idx]!;
    if (minors.has(i)) continue;
    const nbrs = positive.get(i);
    if (!nbrs || nbrs.size <= 1) {
      out.set(i, 0);
      continue;
    }
    let totalI = 0;
    for (const [j, w] of nbrs) {
      if (!minors.has(j)) totalI += w;
    }
    if (totalI <= 0) {
      out.set(i, 0);
      continue;
    }

    const pFromI = new Map<MemberId, number>();
    for (const [j, w] of nbrs) {
      if (!minors.has(j)) pFromI.set(j, w / totalI);
    }

    const totalOfQ = new Map<MemberId, number>();
    for (const [q] of pFromI) {
      let sq = 0;
      const qNbrs = positive.get(q);
      if (qNbrs) for (const [k, wk] of qNbrs) if (!minors.has(k)) sq += wk;
      totalOfQ.set(q, sq);
    }

    let constraint = 0;
    for (const [j, pij] of pFromI) {
      let indirect = 0;
      for (const [q, piq] of pFromI) {
        if (q === j) continue;
        const sq = totalOfQ.get(q) ?? 0;
        if (sq <= 0) continue;
        const wqj = positive.get(q)?.get(j) ?? 0;
        if (wqj > 0) indirect += piq * (wqj / sq);
      }
      const sum = pij + indirect;
      constraint += sum * sum;
    }
    const clampedC = Math.max(0, Math.min(1, constraint));
    out.set(i, Math.round((1 - clampedC) * 1e6) / 1e6);
  }
  return out;
}

export function computeAdamicAdar(
  adultIds: readonly MemberId[],
  positive: ReadonlyMap<MemberId, ReadonlyMap<MemberId, number>>,
  holds: ReadonlySet<MemberId>,
  paused: ReadonlySet<MemberId>,
  minors: ReadonlySet<MemberId>,
  blocked: ReadonlySet<string>,
): Map<MemberId, Map<MemberId, number>> {
  const out = new Map<MemberId, Map<MemberId, number>>();
  const MAX_HUB_FANOUT = 128;

  for (let idx = 0; idx < adultIds.length; idx++) {
    const a = adultIds[idx]!;
    if (minors.has(a)) continue;
    const direct = positive.get(a);
    if (!direct || direct.size === 0) continue;

    const scores = new Map<MemberId, number>();
    for (const x of [...direct.keys()].sort()) {
      if (minors.has(x) || holds.has(x) || paused.has(x)) continue;
      const sx = direct.get(x)!;
      const xNbrs = positive.get(x);
      if (!xNbrs || xNbrs.size <= 1) continue;
      const invLogDeg = 1 / Math.log(1 + xNbrs.size);
      const entries = [...xNbrs.entries()].sort((p, q) => (q[1] - p[1]) || (p[0] < q[0] ? -1 : 1));
      const cap = Math.min(entries.length, MAX_HUB_FANOUT);
      for (let k = 0; k < cap; k++) {
        const [b, sb] = entries[k]!;
        if (b === a || minors.has(b) || direct.has(b)) continue;
        if (blocked.has(canonicalPairKey(a, b))) continue;
        scores.set(b, (scores.get(b) ?? 0) + sx * sb * invLogDeg);
      }
    }
    if (scores.size > 0) out.set(a, scores);
  }
  return out;
}
