// peon.biz judge (pass 2 only): a job-fit rubric on a REDACTED context. Not run in the simulator
// (no LLM calls); the conformance suite exercises it with a fake model. The context is built from
// profile.ts fields only, so it carries no name, age, zip, graduation year, gap, photo, pronoun or
// sealed attribute (tested in test/peon-firewall.test.ts).
import type { MemberId } from "@thenetwork/core";
import type { JudgePack } from "../../pack.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { mustChecks } from "./match.ts";
import { sides } from "./profile.ts";
import { peonHardGate } from "./rules.ts";

export const PEON_JUDGE_VERSION = "peon-judge-0.1";

export const PEON_JUDGE_SYSTEM = `You review one proposed introduction between a job candidate (P1) and a job (P2) for peon.biz, an intro and logistics service. A human hiring manager makes every decision; you only check job-related fit.
Use ONLY the job-related criteria in the context: the job's must-have and nice-to-have skills, seniority, pay range, work model, schedule and work authorization, and the candidate's own stated skills (with their evidence: claimed, demonstrated, interview), seniority, pay floor and preferences.
Never use, infer or mention: race, colour, ethnicity, national origin, citizenship beyond work authorization, sex, gender identity, sexual orientation, pregnancy or family plans, religion, age or graduation year, disability or health, marital or caregiver status, employment gaps, name, photo, voice, address or zip code, school prestige (unless the job states a credential), criminal history, salary history. If your reasoning starts to touch any of these, stop and set red_flags to 5 and verdict "no".
Hard rules (pay range present, verified employer, location, authorization, seniority band, credentials, minors) were already enforced by code. Do not reject because of them.
Score 1-5: fit = must-haves evidenced (cite the candidate's own skills); mutual_value = the candidate's stated wants (pay, kind of work, work model) and the job's needs both served; capacity_realism = logistics (start date, schedule); timing = the job is open and the candidate is searching; social_comfort = candidate-intent fit; red_flags = scam signals on the employer side or misrepresentation signals; certainty = how sure you are.
Return JSON only: {"reasoning": "...", "cited_facts": [{"ref": "P1", "field": "...", "fact": "..."}], "fit": n, "mutual_value": n, "capacity_realism": n, "timing": n, "social_comfort": n, "red_flags": n, "certainty": n, "dealbreaker": false, "dealbreaker_reason": "", "verdict": "yes" | "no", "match_probability": 0-1, "why": {"P1": "one sentence for the candidate about the role", "P2": "one criteria-based sentence for the employer, no score, no name"}}`;

/** Redacted, pseudonymous judge context: criteria only. */
export function peonJudgeContext(w: World, c: Candidate): { context: object; refs: Record<string, MemberId> } {
  const s = sides(w, c.participants);
  if (!s) return { context: { error: "not a candidate-job intro" }, refs: {} };
  const { cand, job } = s;
  const skills = [...cand.skills.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([skill, v]) => ({ skill, level: v.level, evidence: v.evidence }));
  return {
    refs: { P1: cand.id, P2: job.id },
    context: {
      P1: {
        role: "candidate", families: cand.families, seniority: cand.seniority, skills,
        pay_floor_k: cand.floor, work_models: [...cand.modes].sort(), commute_areas: [...cand.areas].sort(),
        authorized_to_work: cand.auth, needs_sponsorship: cand.needsSponsor, credentials: [...cand.creds].sort(), start_weeks: cand.startWeeks,
      },
      P2: {
        role: "job", title: job.title, family: job.family, seniority: job.seniority, pay_range_k: [job.payMin, job.payMax],
        work_model: job.mode, site_area: job.area, must_haves: job.must, nice_to_haves: job.nice, openings: job.openings,
        sponsors_visas: job.sponsors, credential_required: job.credRequired ?? null, employer_verified: job.verified,
      },
      must_have_check: mustChecks(cand, job),
    },
  };
}

export const peonJudge: JudgePack = {
  rubric: { compact: { version: PEON_JUDGE_VERSION, system: PEON_JUDGE_SYSTEM }, matchable: { version: PEON_JUDGE_VERSION, system: PEON_JUDGE_SYSTEM } },
  rubricKeys: ["fit", "mutual_value", "capacity_realism", "timing", "social_comfort", "red_flags", "certainty"],
  buildContext: (w, c) => peonJudgeContext(w, c),
  hardGate: (w, c) => peonHardGate(w, c),
};
