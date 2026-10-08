// Iteration 2: an online revealed-preference model of attraction, learned from the Network's own
// records. Every probe answer, back-out at the reveal and post-date rating is a response of member a
// to a specific person b. The model is small and closed-form (no optimiser, deterministic):
//   y_ab ~ sigmoid(alpha_a + c_b + delta_a . self_b + cf_a(b))
//   c_b      partner effect: how often people respond well to b (shrunk to the global mean);
//   alpha_a  a's own rate of saying yes (constant across b, so it never changes a's ranking);
//   delta_a  a's revealed taste: one ridge-shrunk gradient step on a's residuals over the people's
//            self-descriptions (the 5 trait dimensions, known after the "type" question);
//   cf_a(b)  collaborative signal: members whose residuals agree with a's (they liked the same
//            people) and who responded to b.
// Without photos the probe is anonymous, so a probe answer carries no information about b; the
// model then learns only from back-outs and ratings. With photos in the probe (a sensitivity arm),
// every answer is a noisy look at attraction. Learned scores are used only inside the reciprocal
// score (never shown, never used to sort anyone's exposure: the assignment still gives every
// eligible member one proposal per tick).
import type { MemberId } from "@thenetwork/core";
import type { EngineInput } from "../../types.ts";
import type { SlopPackOptions } from "./options.ts";
import type { SlopProfile } from "./profile.ts";

export interface Obs { a: MemberId; b: MemberId; y: number; w: number }
export interface AttractionModel {
  /** Learned attraction score of a toward b (log-odds scale, 0 = no information). */
  score(a: MemberId, b: MemberId): number;
  /** Diagnostics. */
  n: number; members: number;
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(Math.max(1e-4, p) / Math.max(1e-4, 1 - p));

/** Responses of members to specific people, from interactions (probe answers, back-outs) and feedback. */
export function observations(input: EngineInput, C: (id: MemberId) => MemberId, o: SlopPackOptions): Obs[] {
  const out: Obs[] = [];
  const L = o.attraction;
  for (const r of input.interactions ?? []) {
    if (r.at > input.now || r.participants.length !== 2) continue;
    const [p, q] = r.participants.map(C) as [MemberId, MemberId];
    const other = (x: MemberId) => (x === p ? q : p);
    const declined = new Set((r.declinedBy ?? []).map(C));
    for (const x of (r.acceptedBy ?? []).map(C)) {
      if (r.outcome === "cancelled" && declined.has(x)) continue; // said yes, then backed out: below
      out.push({ a: x, b: other(x), y: 1, w: L.probeWeight });
    }
    for (const x of declined) out.push({ a: x, b: other(x), y: 0, w: r.outcome === "cancelled" ? L.backoutWeight : L.probeWeight });
  }
  const SENT = { positive: 1, neutral: 0.5, negative: 0 } as const;
  for (const f of input.feedback ?? []) {
    if (f.at > input.now) continue;
    const y = f.wouldMeetAgain === undefined ? SENT[f.sentiment] : (SENT[f.sentiment] + (f.wouldMeetAgain ? 1 : 0)) / 2;
    out.push({ a: C(f.from), b: C(f.about), y, w: L.feedbackWeight });
  }
  return out.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : x.y - y.y));
}

const cache = new WeakMap<EngineInput, Map<string, AttractionModel>>();

export function attractionModel(input: EngineInput, P: Map<MemberId, SlopProfile>, C: (id: MemberId) => MemberId, o: SlopPackOptions): AttractionModel {
  const key = JSON.stringify(o.attraction);
  let byOpt = cache.get(input);
  if (!byOpt) { byOpt = new Map(); cache.set(input, byOpt); }
  const hit = byOpt.get(key);
  if (hit) return hit;
  const m = fit(observations(input, C, o), P, o);
  byOpt.set(key, m);
  return m;
}

function fit(obs: Obs[], P: Map<MemberId, SlopProfile>, o: SlopPackOptions): AttractionModel {
  const L = o.attraction;
  if (!L.enabled || !obs.length) return { score: () => 0, n: obs.length, members: 0 };
  const W = obs.reduce((s, x) => s + x.w, 0), ybar = obs.reduce((s, x) => s + x.w * x.y, 0) / W;
  const agg = (k: (x: Obs) => MemberId) => {
    const m = new Map<MemberId, { s: number; w: number }>();
    for (const x of obs) { const e = m.get(k(x)) ?? { s: 0, w: 0 }; e.s += x.w * x.y; e.w += x.w; m.set(k(x), e); }
    return m;
  };
  const byItem = agg(x => x.b), byUser = agg(x => x.a);
  const c = new Map<MemberId, number>(), alpha = new Map<MemberId, number>();
  for (const [b, e] of byItem) c.set(b, logit((e.s + L.shrink * ybar) / (e.w + L.shrink)) - logit(ybar));
  for (const [a, e] of byUser) alpha.set(a, logit((e.s + L.shrink * ybar) / (e.w + L.shrink)));
  // Residuals and revealed taste (one ridge-shrunk gradient step on the self-description).
  const resid = new Map<MemberId, Map<MemberId, number>>();
  const delta = new Map<MemberId, number[]>();
  for (const x of obs) {
    const r = x.y - sig((alpha.get(x.a) ?? 0) + (c.get(x.b) ?? 0));
    const ra = resid.get(x.a) ?? new Map(); ra.set(x.b, (ra.get(x.b) ?? 0) + x.w * r); resid.set(x.a, ra);
    const self = P.get(x.b)?.self;
    if (self) {
      const d = delta.get(x.a) ?? [0, 0, 0, 0, 0];
      for (let i = 0; i < 5; i++) d[i]! += x.w * r * self[i]!;
      delta.set(x.a, d);
    }
  }
  for (const [a, d] of delta) { const n = byUser.get(a)!.w; delta.set(a, d.map(v => v / (n + L.ridge))); }
  // Collaborative: raters of each person; cosine of residuals between members, over common people.
  const raters = new Map<MemberId, MemberId[]>();
  for (const [a, ra] of resid) for (const b of ra.keys()) { const l = raters.get(b) ?? []; l.push(a); raters.set(b, l); }
  const norm = new Map<MemberId, number>();
  for (const [a, ra] of resid) norm.set(a, Math.sqrt([...ra.values()].reduce((s, v) => s + v * v, 0)));
  const simCache = new Map<string, number>();
  const sim = (a: MemberId, x: MemberId): number => {
    const k = a < x ? `${a}|${x}` : `${x}|${a}`;
    let v = simCache.get(k);
    if (v === undefined) {
      const ra = resid.get(a), rx = resid.get(x);
      let dot = 0;
      if (ra && rx) for (const [b, r] of ra) { const q = rx.get(b); if (q !== undefined) dot += r * q; }
      v = dot / ((norm.get(a) ?? 0) * (norm.get(x) ?? 0) + L.cfShrink);
      simCache.set(k, v);
    }
    return v;
  };
  const cf = (a: MemberId, b: MemberId): number => {
    if (!L.cfWeight || !resid.has(a)) return 0;
    let num = 0, den = 1;
    for (const x of raters.get(b) ?? []) { if (x === a) continue; const s = sim(a, x); if (!s) continue; num += s * resid.get(x)!.get(b)!; den += Math.abs(s); }
    return num / den;
  };
  return {
    n: obs.length, members: byUser.size,
    score(a: MemberId, b: MemberId): number {
      let s = L.itemWeight * (c.get(b) ?? 0);
      const d = delta.get(a), self = P.get(b)?.self;
      if (d && self) { let t = 0; for (let i = 0; i < 5; i++) t += d[i]! * self[i]!; s += L.tasteWeight * t; }
      return s + L.cfWeight * cf(a, b);
    },
  };
}
