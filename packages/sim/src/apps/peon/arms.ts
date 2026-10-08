// The arms compared in docs/results/2026-10-08-peon-pack.md: baselines, the pack, and ablations.
// An ablation changes ONE thing about the pack (a module-level tuning knob, a pack slot or the
// harness setting) and restores it afterwards.
import type { AppPack } from "@thenetwork/engine/src/pack.ts";
import { peonPack } from "@thenetwork/engine/src/packs/peon/index.ts";
import { MATCH_TUNING } from "@thenetwork/engine/src/packs/peon/match.ts";
import { SAFETY, T } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { CONGESTION } from "@thenetwork/engine/src/packs/peon/selection.ts";
import { greedyPopular, keywordMatcher, keywordMatcherN, oracleMatcher, packMatcher } from "./baselines.ts";
import type { PeonSnapshot } from "./snapshot.ts";
import { CAND_CAP, type Intro, type PeonMatcher, type PeonWorld } from "./world.ts";

export interface Arm {
  name: string; about: string;
  matcher: PeonMatcher | ((w: PeonWorld) => PeonMatcher);
  setup?(): () => void;
}

const withPack = (over: Partial<AppPack>): AppPack => ({ ...peonPack, ...over });
const tune = <T extends object>(obj: T, over: Partial<T>) => () => { const old = { ...obj }; Object.assign(obj, over); return () => { Object.assign(obj, old); }; };

/** Ablation: honour an employer's discriminatory request with a proxy (graduation year as "young"), i.e. what the pack refuses to do. */
function proxyLeak(intros: Intro[], snap: PeonSnapshot): Intro[] {
  const asked = new Set(snap.facets.filter(f => f.tags.includes(SAFETY.discriminatoryRequest)).map(f => f.memberId));
  const grad = new Map<string, number>();
  for (const f of snap.facets) for (const t of f.tags) if (t.startsWith(`${T.proxy}grad_year:`)) grad.set(f.memberId, Number(t.split(":").pop()));
  // A "digital native" screen on every job (grad year 2008+), plus a hard "young only" for the employers who asked.
  return intros.filter(it => (grad.get(it.cand) ?? 2015) >= (asked.has(it.job) ? 2012 : 2004));
}

export const ARMS: Record<string, Arm> = {
  keyword: { name: "keyword", about: "job board: 10 keyword results a week, full resumes", matcher: keywordMatcher },
  keyword3: { name: "keyword-3", about: "keyword at peon's attention budget (3 a week)", matcher: keywordMatcherN(CAND_CAP, "keyword-3") },
  greedy: { name: "greedy-popular", about: "10 most popular jobs a week, no per-job cap", matcher: w => greedyPopular(w) },
  oracle: { name: "oracle", about: "upper bound with hidden truth", matcher: w => oracleMatcher(w) },
  pack: { name: "peon-pack", about: "the pack (engine-backed)", matcher: packMatcher() },
  // ---- ablations -------------------------------------------------------------------------------
  "no-congestion": {
    name: "pack: no congestion control", about: "no slate cap, spread or lifts (candidate cap kept)",
    matcher: packMatcher({ name: "pack-no-congestion", pack: withPack({ selection: { ...peonPack.selection, adjust: (w, c, v, times) => (c.participants.some(id => times(id) >= CONGESTION.candidateWeekly && id.startsWith("c-")) ? -Infinity : v) } }) }),
  },
  "one-way": {
    name: "pack: one-way retrieval", about: "candidate -> jobs only",
    matcher: packMatcher({ name: "pack-one-way", pack: withPack({ generators: peonPack.generators.filter(g => g.name === "candidate_to_jobs") }) }),
  },
  "claims-face-value": { name: "pack: claims at face value", about: "no discount on unverified skill claims", matcher: packMatcher({ name: "pack-claims" }), setup: tune(MATCH_TUNING, { claimDiscount: 0 }) },
  "audit-hold": { name: "pack: audit holds", about: "companies the audit flags are suspended at once (no human review)", matcher: packMatcher({ name: "pack-audit-hold", audit: "hold" }) },
  unblinded: { name: "pack: unblinded review", about: "employers see the full resume before saying yes", matcher: packMatcher({ name: "pack-unblinded", blindReview: false }) },
  "no-safety": {
    name: "pack: no employer checks", about: "verified-employer, scam-cue and pay-range rules removed",
    matcher: packMatcher({ name: "pack-no-safety", pack: withPack({ eligibility: { ...peonPack.eligibility, memberRules: peonPack.eligibility.memberRules.filter(r => !["employer_unverified", "employer_scam_signal", "no_pay_range"].includes(r.id)) } }) }),
  },
  "probation-interview": { name: "pack: probation until first interview", about: "new-employer limit lasts until the company's first real interview", matcher: packMatcher({ name: "pack-probation-interview" }), setup: tune(CONGESTION, { probationUntil: "interview" }) },
  "no-probation": { name: "pack: no new-employer limit", about: "no per-employer rate limit", matcher: packMatcher({ name: "pack-no-probation" }), setup: tune(CONGESTION, { probationProbes: 1000 }) },
  "floor-on": { name: "pack: exposure floor on", about: "core exposure floor (now calls the pack hook) at 25%", matcher: packMatcher({ name: "pack-floor-on", cfg: { selection: { exposureFloorShare: 0.25 } } as never }) },
  "no-pacing": { name: "pack: no deadline pacing", about: "iteration 2's pack: fixed slates, no urgent relaxation of the new-employer limit", matcher: packMatcher({ name: "pack-no-pacing" }), setup: tune(CONGESTION, { pacingSlate: 0, pacingExtraMax: 0, pacingLift: 0, probationUrgentProbes: 3 }) },
  "pacing-slates-only": { name: "pack: pacing slates only", about: "deadline-scaled slates, new-employer limit not relaxed for urgent roles", matcher: packMatcher({ name: "pack-pacing-slates" }), setup: tune(CONGESTION, { probationUrgentProbes: 3 }) },
  "proxy-leak": { name: "pack + proxy screen", about: "honours 'young only' requests via graduation year (what the firewall forbids)", matcher: packMatcher({ name: "pack-proxy-leak", post: proxyLeak }) },
};
