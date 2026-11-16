// Current Peon baselines, pack and ablations. Each ablation changes one pack slot or harness setting.
import { laneLimits } from "@thenetwork/core/src/generated/matchLane.ts";
import type { AppPack } from "@thenetwork/engine/src/pack.ts";
import { peonPack } from "@thenetwork/engine/src/packs/peon/index.ts";
import { sides } from "@thenetwork/engine/src/packs/peon/profile.ts";
import { SAFETY, T } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { greedyPopular, keywordMatcher, keywordMatcherN, oracleMatcher, packMatcher } from "./baselines.ts";
import type { PeonSnapshot } from "./snapshot.ts";
import { CAND_CAP, type Intro, type PeonMatcher, type PeonWorld } from "./world.ts";

export interface Arm {
  name: string; about: string;
  matcher: PeonMatcher | ((w: PeonWorld) => PeonMatcher);
}

const withPack = (over: Partial<AppPack>): AppPack => ({ ...peonPack, ...over });

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
    name: "pack: no congestion control", about: "no slate cap (candidate cap kept)",
    matcher: packMatcher({ name: "pack-no-congestion", pack: withPack({ selection: { ...peonPack.selection, adjust: (w, candidate, value, times) => {
      const match = sides(w, candidate.participants);
      return match && times(match.cand.id) < laneLimits("Hire").weeklyCapacity ? value : -Infinity;
    } } }) }),
  },
  "one-way": {
    name: "pack: one-way retrieval", about: "candidate -> jobs only",
    matcher: packMatcher({ name: "pack-one-way", pack: withPack({ generators: peonPack.generators.filter(g => g.name === "candidate_to_jobs") }) }),
  },
  "audit-hold": { name: "pack: audit holds", about: "companies the audit flags are suspended at once (no human review)", matcher: packMatcher({ name: "pack-audit-hold", audit: "hold" }) },
  unblinded: { name: "pack: unblinded review", about: "employers see the full resume before saying yes", matcher: packMatcher({ name: "pack-unblinded", blindReview: false }) },
  "no-safety": {
    name: "pack: no employer checks", about: "verified-employer, scam-cue and pay-range rules removed",
    matcher: packMatcher({ name: "pack-no-safety", pack: withPack({ eligibility: { ...peonPack.eligibility, memberRules: peonPack.eligibility.memberRules.filter(r => !["employer_unverified", "employer_scam_signal", "no_pay_range"].includes(r.id)) } }) }),
  },
  "floor-on": { name: "pack: exposure floor on", about: "core exposure floor (now calls the pack hook) at 25%", matcher: packMatcher({ name: "pack-floor-on", cfg: { selection: { exposureFloorShare: 0.25 } } as never }) },
  "proxy-leak": { name: "pack + proxy screen", about: "honours 'young only' requests via graduation year (what the firewall forbids)", matcher: packMatcher({ name: "pack-proxy-leak", post: proxyLeak }) },
};
