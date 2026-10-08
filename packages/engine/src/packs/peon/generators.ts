// Two-way retrieval for peon.biz (AppPack.retrieval.directions: candidate -> job and job -> candidate).
// Both directions score the same hard-filtered pair table; candidate -> jobs gives every searching
// candidate their best few roles, job -> candidates gives every open job (above all the
// under-applied ones, Horton 2017) its best few candidates, even when those candidates have better
// options elsewhere. The union goes to the engine's filters, scoring and selection.
import type { MemberId } from "@thenetwork/core";
import { memberReason, pairReason } from "../../filters.ts";
import { makeCandidate, type GenCtx } from "../../genkit.ts";
import type { GeneratorSpec } from "../../pack.ts";
import { countExclusion } from "../../retrieval.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { mustFloor, pairScore, type PairScore } from "./match.ts";
import { candidates, jobs, worldScratch, type CandidateProfile, type JobProfile } from "./profile.ts";

/** Roles per candidate and candidates per job retrieved before selection. */
export const RETRIEVAL = { jobsPerCandidate: 8, candidatesPerJob: 14 };

export interface PairRow { cand: CandidateProfile; job: JobProfile; s: PairScore; value: number }

const harmonic = (a: number, b: number) => (a <= 0 || b <= 0 ? 0 : (2 * a * b) / (a + b));

/** Every hard-filtered (candidate, job) pair above the must-have floor, with its reciprocal value. Cached per World. */
export function pairTable(ctx: Pick<GenCtx, "w" | "memberExclusions">): PairRow[] {
  const w = ctx.w;
  return worldScratch(w, "pairs", () => {
    const ok = (id: MemberId, role: "seeker" | "provider") => {
      const r = memberReason(w, id, { category: "professional", role, format: "one_to_one", timeSensitive: false });
      if (r) countExclusion(ctx, r);
      return !r;
    };
    const js = jobs(w).filter(j => ok(j.id, "provider"));
    const cs = candidates(w).filter(c => ok(c.id, "seeker"));
    const rows: PairRow[] = [];
    for (const c of cs) for (const j of js) {
      if (pairReason(w, c.id, j.id, "professional")) continue;
      const s = pairScore(c, j);
      if (s.coverage < mustFloor()) continue;
      rows.push({ cand: c, job: j, s, value: harmonic(s.need, s.want) });
    }
    return rows;
  });
}

/** Number of hard-filtered candidates above the must-have floor per job (small pool = under-applied). */
export function poolSize(w: World, jobId: MemberId): number {
  const m = worldScratch(w, "pool", () => {
    const out = new Map<MemberId, number>();
    for (const r of pairTable({ w, memberExclusions: {} })) out.set(r.job.id, (out.get(r.job.id) ?? 0) + 1);
    return out;
  });
  return m.get(jobId) ?? 0;
}

function toCandidate(w: World, generator: string, r: PairRow): Candidate {
  const { cand, job } = r;
  const ev = job.must.map(m => cand.skills.get(m.skill)?.facetId).filter((x): x is string => !!x);
  return makeCandidate({
    kind: "intro", generator, category: "professional",
    participants: [cand.id, job.id], roles: { [cand.id]: "seeker", [job.id]: "provider" }, format: "one_to_one",
    objective: `Interview intro: ${job.title}`,
    anchor: { type: "intent", id: job.intentId ?? job.id, label: job.title },
    evidence: { [cand.id]: ev, [job.id]: job.shareFacetIds.slice(0, 3) },
    fit: r.s.need, benefit: { [cand.id]: r.s.want, [job.id]: r.s.need },
    channels: new Set(["need", "tag"]),
  });
}

const byValue = (a: PairRow, b: PairRow) => (b.value - a.value) || (a.cand.id < b.cand.id ? -1 : a.cand.id > b.cand.id ? 1 : a.job.id < b.job.id ? -1 : 1);

export const PEON_GENERATORS: readonly GeneratorSpec[] = [
  {
    name: "candidate_to_jobs",
    run(ctx) {
      const by = new Map<MemberId, PairRow[]>();
      for (const r of pairTable(ctx)) { if (!by.has(r.cand.id)) by.set(r.cand.id, []); by.get(r.cand.id)!.push(r); }
      const out: Candidate[] = [];
      for (const id of [...by.keys()].sort()) for (const r of by.get(id)!.sort(byValue).slice(0, RETRIEVAL.jobsPerCandidate)) out.push(toCandidate(ctx.w, "candidate_to_jobs", r));
      return out;
    },
  },
  {
    name: "job_to_candidates",
    run(ctx) {
      const by = new Map<MemberId, PairRow[]>();
      for (const r of pairTable(ctx)) { if (!by.has(r.job.id)) by.set(r.job.id, []); by.get(r.job.id)!.push(r); }
      const out: Candidate[] = [];
      for (const id of [...by.keys()].sort()) for (const r of by.get(id)!.sort(byValue).slice(0, RETRIEVAL.candidatesPerJob)) out.push(toCandidate(ctx.w, "job_to_candidates", r));
      return out;
    },
  },
];
