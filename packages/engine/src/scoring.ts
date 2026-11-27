import type { Facet, MemberId, ScoreComponents } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import { pairValueScale } from "../../core/src/generated/pairValue.ts";
import { isMinor, requiredPairValues } from "./filters.ts";
import { mfhgGeometricNsw } from "./group.ts";
import { slopHorizontalCompatibility } from "./packs/slop/score.ts";
import { worldStatusPairMultipliers } from "./status.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import { pairKey, provenanceWeight, type World } from "./world.ts";

export interface Scored {
  c: Candidate; components: ScoreComponents; score: number; threshold: number;
  eligible: boolean; reason?: string; verdict?: JudgeVerdict | null;
  memberWhy?: Record<MemberId, string>;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));

function pairTerms(w: World, c: Candidate): { fit: number; mutualBenefit: number } {
  const ids = c.participants;
  if (ids.length < 2) return { fit: clamp(c.fit), mutualBenefit: clamp(ids[0] === undefined ? 0 : c.benefit[ids[0]] ?? 0) };
  const values = (requiredPairValues(w, c) ?? [0]).map(v => Math.max(0, v));
  const fit = Math.min(...values) / pairValueScale;
  let mb = values.reduce((t, v) => t + v, 0) / values.length / pairValueScale;
  const m = ids.length;
  if (m >= 3 && values.length === (m * (m - 1)) / 2) {
    const sumOther = new Float64Array(m);
    let idx = 0;
    for (let i = 0; i < m; i++) {
      for (let j = i + 1; j < m; j++) {
        const v = values[idx++]!;
        sumOther[i] = sumOther[i]! + v;
        sumOther[j] = sumOther[j]! + v;
      }
    }
    const denom = (m - 1) * pairValueScale;
    const us: number[] = [];
    for (let i = 0; i < m; i++) us.push(sumOther[i]! / denom);
    mb = clamp(0.5 * mb + 0.5 * mfhgGeometricNsw(us));
  } else if (m === 2 && !w.minors.has(ids[0]!) && !w.minors.has(ids[1]!) && !isMinor(w, ids[0]!) && !isMinor(w, ids[1]!)) {
    const { ab, ba } = worldStatusPairMultipliers(w, ids[0]!, ids[1]!);
    const hMult = (2 * ab * ba) / Math.max(1e-6, ab + ba);
    const horMult = w.pack.id === "slop" ? slopHorizontalCompatibility(w, ids[0]!, ids[1]!) : 1;
    mb = clamp(mb * (0.90 + 0.10 * hMult) * horMult);
  }
  return { fit, mutualBenefit: mb };
}

export function thresholdFor(w: World, c: Candidate): number {
  const T = w.cfg.thresholds;
  let t = 0;
  for (const id of c.participants) t = Math.max(t, T.byState[w.get(id)!.m.state]);
  const over = T.useByGenerator ? T.byGenerator[c.generator as keyof typeof T.byGenerator] : undefined;
  if (over !== undefined) return t > T.byState.normal ? Math.max(t, over) : over;
  const cat = T.byCategory[c.category];
  if (cat !== undefined) t = Math.max(t, cat);
  return t;
}

export function explorationBar(w: World, c: Candidate, threshold: number): number {
  const T = w.cfg.thresholds;
  if (c.category === "romance" || c.participants.some(id => T.byState[w.get(id)!.m.state] > T.byState.normal)) return threshold;
  return Math.min(threshold, T.exploration);
}

export function computeComponents(w: World, c: Candidate, verdict?: JudgeVerdict | null): ScoreComponents {
  const cfg = w.cfg;
  const ids = c.participants;
  const pairs: [MemberId, MemberId][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i]!, ids[j]!]);

  const S = w.pack.scoring;
  let { fit, mutualBenefit: mb } = pairTerms(w, c);
  let warmPath = clamp(c.warm);
  if (!warmPath && pairs.some(([a, b]) => w.isWarm(a, b))) warmPath = ids.length > 2 ? 0.5 : 0.3;

  let novelty = pairs.length
    ? pairs.reduce((s, [a, b]) => s + (w.isWarm(a, b) ? 0.3 : 1) * (w.get(a)!.cluster !== w.get(b)!.cluster ? 1 : 0.6), 0) / pairs.length
    : 0.3;
  if (S.novelty) novelty = S.novelty(c, novelty);

  let timingFit = 0.5;
  if (c.window) {
    const hours = (c.window.end - c.window.start) / HOUR;
    timingFit = c.fixedWindow ? 1 : clamp(hours / 48);
    const lead = c.window.start - w.now;
    if (c.fixedWindow && lead < 12 * HOUR) timingFit *= 0.6;
    if (c.fixedWindow && lead > 10 * DAY) timingFit *= 0.8;
  }

  const shareArea = w.pack.geo.sharesArea(w, ids, c.city, c.window);
  let activationCost = ids.length === 1 ? 0.05 : shareArea ? 0.1 : 0.3;
  activationCost += 0.05 * Math.max(0, ids.length - 2);
  if (c.window && c.window.start - w.now < 12 * HOUR) activationCost += 0.15;
  if (!shareArea && ids.some(id => w.get(id)!.m.prefs.maxTravelMinutes < 20)) activationCost += 0.15;
  activationCost = clamp(activationCost);

  const interruptionCost = clamp(ids.reduce((s, id) => {
    const mi = w.get(id)!;
    const lim = Math.max(1, cfg.budgets[mi.m.state].limit);
    return s + (mi.recentProactive + 1) / lim;
  }, 0) / ids.length);

  let load = 0;
  for (const id of ids) {
    const mi = w.get(id)!;
    const role = c.roles[id];
    if (role && w.pack.ontology.contributorRoles.has(role)) load = Math.max(load, (mi.recentContribution + 1) / (cfg.contribution.limit + 1));
    load = Math.max(load, mi.recentExposure30 / 10);
  }
  load = clamp(load);

  let repetition = 0;
  for (const [a, b] of pairs) {
    const k = pairKey(a, b);
    const recent = w.recentPairs.get(k);
    if (recent !== undefined && w.now - recent < 30 * DAY) repetition = Math.max(repetition, 0.6);
    for (const r of w.pairInteractions.get(k) ?? []) {
      if (r.outcome === "completed" && r.kind === c.kind && w.now - r.at < 30 * DAY && c.kind !== "second_encounter") repetition = Math.max(repetition, 0.4);
    }
  }
  const clusters = new Set(ids.map(id => w.get(id)!.cluster));
  if (ids.length > 2 && clusters.size === 1) repetition = Math.max(repetition, 0.15);
  repetition = clamp(repetition);

  const fmt = c.format;
  const mismatch = ids.filter(id => !w.get(id)!.m.prefs.formats.includes(fmt)).length / ids.length;
  let socialRisk = 0.5 * mismatch;
  if (ids.length > 2 && !pairs.some(([a, b]) => w.isWarm(a, b))) socialRisk += 0.1;
  if (c.safetyClass === "medium") socialRisk += 0.2;
  if (S.socialRisk) socialRisk = S.socialRisk(c, socialRisk);

  const evFacets: Facet[] = ids.flatMap(id => (c.evidence[id] ?? []).map(fid => w.get(id)!.match.find(f => f.id === fid)).filter((f): f is Facet => !!f));
  const evidence = c.confidenceHint ?? (evFacets.length ? evFacets.reduce((s, f) => s + provenanceWeight(f), 0) / evFacets.length : 0.7);
  const agreement = clamp(0.75 + 0.1 * (c.channels.size - 1), 0.5, 1);
  const multiHome = ids.some(id => w.get(id)!.presence.some(p => p.type === "home" && p.city !== w.get(id)!.m.homeCity && p.from === undefined));
  let confidence = clamp(evidence * agreement * (multiHome ? 0.9 : 1));

  if (verdict) {
    const jw = cfg.judge.weight;
    fit = clamp((1 - jw) * fit + jw * verdict.fit);
    mb = clamp((1 - jw) * mb + jw * verdict.mutualValue);
    timingFit = clamp((1 - jw) * timingFit + jw * verdict.timing);
    socialRisk = Math.max(socialRisk, verdict.redFlags, 0.5 * (1 - verdict.socialComfort));
    confidence = clamp(confidence * (0.7 + 0.3 * verdict.certainty));
  }
  return {
    fit, mutualBenefit: mb, warmPath, novelty, timingFit, activationCost, interruptionCost, load,
    repetition, socialRisk: clamp(socialRisk), confidence,
  };
}

export function netValue(w: World, k: ScoreComponents): number {
  const W = w.cfg.weights;
  const pos = W.fit * k.fit + W.mutualBenefit * k.mutualBenefit + W.warmPath * k.warmPath + W.novelty * k.novelty + W.timingFit * k.timingFit;
  const neg = W.activationCost * k.activationCost + W.interruptionCost * k.interruptionCost + W.load * k.load + W.repetition * k.repetition + W.socialRisk * k.socialRisk;
  const norm = W.fit + W.mutualBenefit + W.warmPath + W.novelty + W.timingFit;
  return ((pos - neg) / norm) * k.confidence;
}

export function floorViolation(w: World, k: ScoreComponents, verdict?: JudgeVerdict | null): string | undefined {
  const f = w.cfg.floors;
  if (verdict?.dealbreaker) return "dealbreaker";
  if (verdict?.verdict === "no" && w.cfg.judge.verdictGates) return "judge_reject";
  if (k.fit < f.fit) return "fit_floor";
  if (k.mutualBenefit < f.mutualBenefit) return "mutual_benefit_floor";
  if (k.confidence < f.confidence) return "confidence_floor";
  if (k.socialRisk > f.maxSocialRisk) return "social_risk_ceiling";
  if (verdict && Math.min(verdict.fit, verdict.mutualValue, verdict.capacityRealism, verdict.timing, verdict.socialComfort) < f.judgeDimension) return "judge_floor";
  return undefined;
}

export function scoreCandidate(w: World, c: Candidate, verdict?: JudgeVerdict | null): Scored {
  const components = computeComponents(w, c, verdict);
  const score = netValue(w, components);
  const threshold = thresholdFor(w, c);
  const fv = floorViolation(w, components, verdict);
  const thr = c.exploration ? explorationBar(w, c, threshold) : threshold;
  return {
    c, components, score, threshold: thr, verdict,
    eligible: !fv && score >= thr,
    reason: fv ?? (score < thr ? "below_threshold" : undefined),
  };
}
