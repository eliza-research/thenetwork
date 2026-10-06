// Scoring (Section 33.6). Components are computed and logged separately; NetValue is a
// transparent weighted sum multiplied by Confidence, with floors and a dealbreaker flag that make
// a configuration ineligible. The LLM judge is one input: load, interruption, repetition and
// safety-derived risk always apply (Soulmates pitfall: judge silently replacing them).
import type { Facet, MemberId, ScoreComponents } from "@thenetwork/core";
import { DAY, HOUR } from "@thenetwork/core";
import type { Candidate, JudgeVerdict } from "./types.ts";
import { CONTRIBUTOR_ROLES } from "./types.ts";
import { pairKey, provenanceWeight, type World } from "./world.ts";

export interface Scored {
  c: Candidate; components: ScoreComponents; score: number; threshold: number;
  eligible: boolean; reason?: string; verdict?: JudgeVerdict | null;
  /** Leak-gated member-facing text from pass 3 (deep review), preferred over pass-2 text. */
  memberWhy?: Record<MemberId, string>;
}

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, Number.isFinite(x) ? x : lo));

/** Harmonic mean: punishes lopsided matches (reciprocal recommendation, RECON). */
export function harmonic(xs: number[]): number {
  if (!xs.length) return 0;
  if (xs.some(x => x <= 0)) return 0;
  return xs.length / xs.reduce((s, x) => s + 1 / x, 0);
}

/**
 * Mutual benefit: pairs use the harmonic mean of each side's benefit; groups use
 * "average without misery" (mean, but capped by twice the least-served member).
 */
export function mutualBenefit(benefits: number[]): number {
  if (benefits.length === 0) return 0;
  if (benefits.length === 1) return clamp(benefits[0]!);
  if (benefits.length === 2) return clamp(harmonic(benefits.map(b => clamp(b))));
  const mean = benefits.reduce((s, b) => s + b, 0) / benefits.length;
  return clamp(Math.min(mean, 2 * Math.min(...benefits)));
}

export function thresholdFor(w: World, c: Candidate): number {
  let t = 0;
  for (const id of c.participants) t = Math.max(t, w.cfg.thresholds.byState[w.get(id)!.m.state]);
  const cat = w.cfg.thresholds.byCategory[c.category];
  if (cat !== undefined) t = Math.max(t, cat);
  return t;
}

export function computeComponents(w: World, c: Candidate, verdict?: JudgeVerdict | null): ScoreComponents {
  const cfg = w.cfg;
  const ids = c.participants;
  const pairs: [MemberId, MemberId][] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i]!, ids[j]!]);

  let fit = clamp(c.fit);
  let mb = mutualBenefit(ids.map(id => c.benefit[id] ?? 0));
  let warmPath = clamp(c.warm);
  if (!warmPath && pairs.some(([a, b]) => w.isWarm(a, b))) warmPath = ids.length > 2 ? 0.5 : 0.3;

  // Novelty: new people, across clusters; expansion picks are novel by construction.
  let novelty = pairs.length
    ? pairs.reduce((s, [a, b]) => s + (w.isWarm(a, b) ? 0.3 : 1) * (w.get(a)!.cluster !== w.get(b)!.cluster ? 1 : 0.6), 0) / pairs.length
    : 0.3;
  if (c.kind === "expansion") novelty = Math.max(novelty, 0.9);
  if (c.kind === "second_encounter") novelty = 0.4;

  // Timing fit: usable overlap in the window; events too soon are harder.
  let timingFit = 0.5;
  if (c.window) {
    const hours = (c.window.end - c.window.start) / HOUR;
    timingFit = c.fixedWindow ? 1 : clamp(hours / 48);
    const lead = c.window.start - w.now;
    if (c.fixedWindow && lead < 12 * HOUR) timingFit *= 0.6;
    if (c.fixedWindow && lead > 10 * DAY) timingFit *= 0.8;
  }

  // Activation cost: distance (shared area), group coordination, short lead time, travel limits.
  const areasOf = (id: MemberId) => new Set(w.get(id)!.presence.filter(p => p.city === c.city).flatMap(p => p.areas));
  const areaSets = ids.map(areasOf);
  const shareArea = areaSets.length > 1 && [...areaSets[0]!].some(a => areaSets.every(s => s.has(a)));
  let activationCost = ids.length === 1 ? 0.05 : shareArea ? 0.1 : 0.3;
  activationCost += 0.05 * Math.max(0, ids.length - 2);
  if (c.window && c.window.start - w.now < 12 * HOUR) activationCost += 0.15;
  if (!shareArea && ids.some(id => w.get(id)!.m.prefs.maxTravelMinutes < 20)) activationCost += 0.15;
  activationCost = clamp(activationCost);

  // Interruption cost: share of each participant's proactive budget this would use.
  const interruptionCost = clamp(ids.reduce((s, id) => {
    const mi = w.get(id)!;
    const lim = Math.max(1, cfg.budgets[mi.m.state].limit);
    return s + (mi.recentProactive + 1) / lim;
  }, 0) / ids.length);

  // Load: contributors' recent giving, and everyone's recent exposure (concentration).
  let load = 0;
  for (const id of ids) {
    const mi = w.get(id)!;
    const role = c.roles[id];
    if (role && CONTRIBUTOR_ROLES.has(role)) load = Math.max(load, (mi.recentContribution + 1) / (cfg.contribution.limit + 1));
    load = Math.max(load, mi.recentExposure30 / 10);
  }
  load = clamp(load);

  // Repetition: same people recently proposed or met (penalty only; never a block, ME-005).
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

  // Social risk: format mismatch, cold groups, safety class.
  const fmt = c.format;
  const mismatch = ids.filter(id => !w.get(id)!.m.prefs.formats.includes(fmt)).length / ids.length;
  let socialRisk = 0.5 * mismatch;
  if (ids.length > 2 && !pairs.some(([a, b]) => w.isWarm(a, b))) socialRisk += 0.1;
  if (c.safetyClass === "medium") socialRisk += 0.2;
  if (c.category === "romance") socialRisk += 0.1;

  // Confidence: evidence quality x retrieval agreement (x judge certainty).
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
    // Judge can only add risk, never remove the structural risk computed above.
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

/** Floors and dealbreakers (any violation => ineligible, never compensated by other terms). */
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
  const thr = c.exploration ? Math.min(threshold, w.cfg.thresholds.exploration) : threshold;
  return {
    c, components, score, threshold: thr, verdict,
    eligible: !fv && score >= thr,
    reason: fv ?? (score < thr ? "below_threshold" : undefined),
  };
}
