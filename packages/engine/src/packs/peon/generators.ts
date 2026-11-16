// peon.biz candidates from the bounded match search (w.match): candidate -> jobs and job ->
// candidates in the Hire lane. Each profile reads only its own search result, so no generator
// compares every candidate with every job.
import { pairCandidate, searchFor } from "../../genkit.ts";
import type { MatchProfile } from "../../match/profile.ts";
import type { GeneratorSpec } from "../../pack.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { sides } from "./profile.ts";

function hireIntro(w: World, generator: string, own: MatchProfile, other: MatchProfile, value: number): Candidate[] {
  const s = sides(w, [own.memberId, other.memberId]);
  if (!s) return [];
  const { cand, job } = s;
  const evidence = job.must.map(m => cand.skills.get(m.skill)?.facetId).filter((x): x is string => !!x);
  return [pairCandidate(w, own, other, value, {
    kind: "intro", generator, category: "professional",
    roles: { [cand.id]: "seeker", [job.id]: "provider" }, format: "one_to_one",
    objective: `Interview intro: ${job.title}`,
    anchor: { type: "intent", id: job.intentId ?? job.id, label: job.title },
    evidence: { [cand.id]: evidence, [job.id]: job.shareFacetIds.slice(0, 3) },
    channels: new Set(["tag"]),
  })];
}

/** One generator per Hire side: every profile of it turns its kept search results into candidates. */
function fromSearch(name: string, side: MatchProfile["side"]): GeneratorSpec {
  return {
    name,
    run(ctx) {
      return ctx.w.match.profiles
        .filter(p => p.lane === "Hire" && p.side === side)
        .flatMap(p => searchFor(ctx, p).kept.flatMap(k => hireIntro(ctx.w, name, p, k.profile, k.value)));
    },
  };
}

export const PEON_GENERATORS: readonly GeneratorSpec[] = [
  fromSearch("candidate_to_jobs", "Seeking"),
  fromSearch("job_to_candidates", "Offering"),
];
