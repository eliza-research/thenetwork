// peon.biz matchers: three baselines and the engine-backed pack (plus its ablations).
//   keyword          a job board: each candidate "applies" to the 3 jobs whose text best matches
//                    their stated skills and target family, in their market or remote. No pay,
//                    seniority, verification or capacity logic; employers see the full resume.
//   greedy-popular   each candidate is sent to the 3 most popular jobs in their family and reach
//                    (hidden appeal stands in for the view / application counts a board observes).
//                    No per-job cap: the congestion failure.
//   oracle           upper bound with hidden truth: greedy on P(apply) x P(employer yes) x P(pass)
//                    x P(accept) x P(retained), real verified jobs only, a per-job slate cap.
//   peon-pack        runEngine(snapshot, PEON_ENGINE_CONFIG, { pack: peonPack }), read-only snapshot.
// Every arm skips declared minors and held members (platform rules), and gets at most 3 probes per
// candidate per week from the harness.
import { canBeMatched, type MemberId } from "@thenetwork/core";
import { resolveConfig, type EngineConfigInput } from "@thenetwork/engine/src/config.ts";
import { localEmbed } from "@thenetwork/engine/src/embed.ts";
import { runEngine } from "@thenetwork/engine/src/engine.ts";
import type { AppPack } from "@thenetwork/engine/src/pack.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "@thenetwork/engine/src/packs/peon/index.ts";
import { candidates, jobs, type CandidateProfile, type JobProfile } from "@thenetwork/engine/src/packs/peon/profile.ts";
import { pairKey, World } from "@thenetwork/engine/src/world.ts";
import { hash32 } from "@thenetwork/core";
import { u01 } from "./oracle.ts";
import type { PeonSnapshot } from "./snapshot.ts";
import { CAND_CAP, JOB_BOARD_WEEKLY, type Intro, type PeonMatcher, type PeonWorld } from "./world.ts";

/** A typed read of the snapshot (the pack's own reader): every open job and searching adult, unfiltered. */
export function visibleWorld(snapshot: PeonSnapshot): World {
  return new World(snapshot, resolveConfig(PEON_ENGINE_CONFIG), localEmbed, peonPack);
}
function pool(w: World): { cs: CandidateProfile[]; js: JobProfile[]; introduced: (c: MemberId, j: MemberId) => boolean } {
  const ok = (id: MemberId) => !w.holds.has(id) && w.get(id)!.m.state !== "paused" && canBeMatched(w.get(id)!.m.age);
  return {
    cs: candidates(w).filter(c => c.searching && ok(c.id)),
    js: jobs(w).filter(j => j.open && ok(j.id)),
    introduced: (c, j) => w.pairInteractions.has(pairKey(c, j)) || w.recentPairs.has(pairKey(c, j)),
  };
}
const inReach = (c: CandidateProfile, j: JobProfile) => j.mode === "remote" || j.market === c.market;

export const keywordMatcherN = (perWeek: number, name = "keyword"): PeonMatcher => ({
  name, blindReview: false, weeklyCap: perWeek,
  propose(ctx) {
    const w = visibleWorld(ctx.snapshot);
    const { cs, js, introduced } = pool(w);
    for (const c of cs) ctx.assessed.add(c.id);
    const out: Intro[] = [];
    for (const c of ctx.rng.shuffle(cs)) {
      const words = new Set(c.skills.keys());
      const scored = js.filter(j => inReach(c, j) && !introduced(c.id, j.id)).map(j => ({
        j, s: (j.family && c.families.includes(j.family) ? 2 : 0) + [...j.must.map(m => m.skill), ...j.nice].filter(s => words.has(s)).length + 0.01 * u01(ctx.seed, "kw", c.id, j.id),
      })).filter(x => x.s >= 2).sort((a, b) => b.s - a.s);
      for (const x of scored.slice(0, perWeek)) out.push({ cand: c.id, job: x.j.id });
    }
    return out;
  },
});
/** The job-board baseline: about 10 keyword results a week per active seeker. */
export const keywordMatcher = keywordMatcherN(JOB_BOARD_WEEKLY);

export const greedyPopular = (world: PeonWorld): PeonMatcher => ({
  name: "greedy-popular", blindReview: false, weeklyCap: JOB_BOARD_WEEKLY,
  propose(ctx) {
    const w = visibleWorld(ctx.snapshot);
    const { cs, js, introduced } = pool(w);
    for (const c of cs) ctx.assessed.add(c.id);
    const out: Intro[] = [];
    for (const c of ctx.rng.shuffle(cs)) {
      const ranked = js.filter(j => inReach(c, j) && !!j.family && c.families.includes(j.family) && !introduced(c.id, j.id))
        .sort((a, b) => (world.oracle.job.get(b.id)!.hidden.appeal - world.oracle.job.get(a.id)!.hidden.appeal) || (a.id < b.id ? -1 : 1));
      for (const j of ranked.slice(0, JOB_BOARD_WEEKLY)) out.push({ cand: c.id, job: j.id });
    }
    return out;
  },
});

/** Upper bound: hidden truth (true skills, true logistics, adversary labels), greedy with the pack's slate cap. */
export const oracleMatcher = (world: PeonWorld): PeonMatcher => ({
  name: "oracle", blindReview: true,
  propose(ctx) {
    const o = world.oracle, st = world.state;
    const held = new Set(ctx.snapshot.safetyHolds.map(h => h.memberId));
    const done = new Set(ctx.snapshot.interactions.map(r => r.participants.join("|")));
    const cs = world.pop.candidates.filter(c => c.joinWeek <= ctx.week && !c.truth.isMinor && !c.truth.fake && !st.hired.has(c.id) && !st.exited.has(c.id) && !held.has(c.id));
    const js = world.pop.jobs.filter(j => j.postedWeek <= ctx.week && j.hidden.real && o.co(j).verified && o.co(j).adversary !== "discriminatory" && (st.openings.get(j.id) ?? 0) > 0 && !held.has(j.id));
    for (const c of cs) ctx.assessed.add(c.id);
    const pairs: { c: MemberId; j: MemberId; v: number }[] = [];
    for (const c of cs) for (const j of js) {
      if (done.has(`${c.id}|${j.id}`)) continue;
      const v = o.pInterested(c, j) * o.pEmployerYes(c, j, false) * o.pPass(c, j) * o.pAccept(c, j) * o.pRetain90(c, j);
      if (v > 0.002) pairs.push({ c: c.id, j: j.id, v });
    }
    pairs.sort((a, b) => (b.v - a.v) || (a.c < b.c ? -1 : a.c > b.c ? 1 : a.j < b.j ? -1 : 1));
    const perC = new Map<MemberId, number>(), perJ = new Map<MemberId, number>();
    const out: Intro[] = [];
    for (const p of pairs) {
      const capJ = world.oracle.job.get(p.j)!.hidden.reviewCap;
      if ((perC.get(p.c) ?? 0) >= CAND_CAP || (perJ.get(p.j) ?? 0) >= capJ) continue;
      perC.set(p.c, (perC.get(p.c) ?? 0) + 1); perJ.set(p.j, (perJ.get(p.j) ?? 0) + 1);
      out.push({ cand: p.c, job: p.j });
    }
    return out;
  },
});

export interface PackMatcherOptions {
  name?: string; pack?: AppPack; cfg?: EngineConfigInput;
  /** Employers review a blind summary (default true). */
  blindReview?: boolean;
  /** Monthly adverse-impact audit (default "flag": flagged companies go to human review). */
  audit?: "off" | "flag" | "hold";
  /** Employer messages go through the relay scam screen (default true). */
  relayScreen?: boolean;
  /** Post-processing of the engine's intros (ablations only, e.g. honouring a discriminatory request). */
  post?: (intros: Intro[], snapshot: PeonSnapshot) => Intro[];
}

/** The engine-backed peon pack: reads only the snapshot. */
export function packMatcher(o: PackMatcherOptions = {}): PeonMatcher {
  const pack = o.pack ?? peonPack;
  return {
    name: o.name ?? "peon-pack", blindReview: o.blindReview ?? true, audit: o.audit ?? "flag", relayScreen: o.relayScreen ?? true,
    async propose(ctx) {
      const r = await runEngine(ctx.snapshot, { ...PEON_ENGINE_CONFIG, ...(o.cfg ?? {}), seed: hash32(ctx.seed, "engine", ctx.week) }, { pack });
      // The tool's applicant pool: every candidate it scored for a job (after the hard filters).
      for (const s of r.runLog.scored) for (const id of s.participants) if (id.startsWith("c-")) ctx.assessed.add(id);
      const intros = r.proposals.map(p => {
        const cand = p.participants.find(id => p.roles[id] === "seeker")!, job = p.participants.find(id => p.roles[id] === "provider")!;
        return { cand, job };
      });
      return o.post ? o.post(intros, ctx.snapshot) : intros;
    },
  };
}

export const BASELINES = {
  keyword: keywordMatcher,
  keyword3: keywordMatcherN(CAND_CAP, "keyword-3"),
  greedy: greedyPopular,
  oracle: oracleMatcher,
  pack: packMatcher(),
} as const;
