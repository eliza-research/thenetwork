// slop.date judge (pass 2 only, PRD 40.4): a dating rubric on a pseudonymous context. It runs only
// when an LLM is wired (the service's NETWORK_ENGINE_JUDGE=1); without one runEngine never calls it,
// so the simulator's slop gates do not move. The judge can only remove a pair: hard filters (minors,
// blocks, holds, mutual orientation, age ranges, radius, dealbreakers) ran before it in code.
// The context carries what each person STATED (who they are and seek, age range, goal, dealbreakers,
// stated values), an age band and a distance band, shared interests, and safety signals (cues,
// verification, the Network's own records). Never a name, an exact age, a zip, a photo, an
// appearance rating, a body type or a learned attraction score.
import type { MemberId } from "@thenetwork/core";
import type { JudgePack } from "../../pack.ts";
import type { Candidate } from "../../types.ts";
import type { World } from "../../world.ts";
import { ageBand } from "./copy.ts";
import { mutualMarkets } from "./geo.ts";
import type { SlopPackOptions } from "./options.ts";
import { slopProfiles, type SlopProfile } from "./profile.ts";
import { distanceBand } from "./zips.ts";

export const SLOP_JUDGE_VERSION = "slop-judge-0.1";

export const SLOP_JUDGE_SYSTEM = `You review one proposed first date between two adults (P1 and P2) for slop.date, a dating matchmaker that texts each person an anonymous suggestion and reveals nobody until both say yes. A human reviewer approves every suggestion; you only check fit and safety.
Use ONLY the context: what each person stated (who they are and who they want to meet, the age range they want, what they are looking for, dealbreakers, stated values), their age band, the distance band between them, interests, and safety signals.
Stated preferences come first: a pair where either person's stated wants are not met is a "no", even if everything else looks good. Unknown values never count against anyone.
Safety: any safety cue, failed verification, reports, blocks, no-shows or back-outs in the context lower social_comfort and raise red_flags; a serious one (scam pattern, age signal, hostile language) is a dealbreaker.
Never use, infer or mention appearance, attractiveness, body, photos, race, ethnicity, religion beyond the stated value, health, income, or any score. The "why" sentences are shown to the members: one warm, plain sentence each, only about stated, shareable things (shared_interests, the planned first date, the distance band); never a score, a rating, a percentage, appearance, an exact age or anything from the safety section.
Score 1-5: fit = the stated wants of both are met; mutual_value = both would likely enjoy a first date (shared interests, compatible goals); capacity_realism = distance and timing are realistic; timing = both are actively looking; social_comfort = a calm, safe first meeting; red_flags = safety concerns; certainty = how sure you are.
Return JSON only: {"reasoning": "...", "cited_facts": [{"ref": "P1", "field": "...", "fact": "..."}], "fit": n, "mutual_value": n, "capacity_realism": n, "timing": n, "social_comfort": n, "red_flags": n, "certainty": n, "dealbreaker": false, "dealbreaker_reason": "", "verdict": "yes" | "no", "match_probability": 0-1, "why": {"P1": "one sentence for P1", "P2": "one sentence for P2"}}`;

const sorted = (xs: readonly string[]) => [...xs].sort();

/** One side of the context: stated fields and safety signals only. */
function side(p: SlopProfile) {
  const h = p.history;
  return {
    age_band: ageBand(p.age),
    is: p.is ?? null, seeks: sorted(p.seeks), wants_age_range: p.ageRange ?? null, goal: p.goal ?? null,
    dealbreakers: sorted(p.dealbreakers),
    stated_values: Object.fromEntries(Object.entries(p.values).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1))),
    interests: sorted(p.interests), activities: sorted(p.activities),
    safety: {
      cues: sorted(p.safety), verification: sorted(p.verification), review: p.review ?? null,
      no_shows: h.noShows, backouts: h.backouts, negative_feedback_from: h.negativeFrom, blocked_by: h.blockedBy, dates: h.dates,
    },
  };
}

/** Pseudonymous judge context for a dating pair. */
export function slopJudgeContext(w: World, c: Candidate, o: SlopPackOptions): { context: object; refs: Record<string, MemberId> } {
  const P = slopProfiles(w.input, w.canonical);
  const [a, b] = c.participants as [MemberId, MemberId];
  const pa = P.get(a), pb = P.get(b);
  if (c.participants.length !== 2 || !pa || !pb) return { context: { error: "not a dating pair" }, refs: {} };
  const mm = mutualMarkets(pa, pb, o, w.pack.geo.markets(w.cfg));
  const shared = sorted(pa.shareableInterests.filter(t => pb.shareableInterests.includes(t)));
  return {
    refs: { P1: a, P2: b },
    context: {
      lane: "first date", P1: side(pa), P2: side(pb),
      distance_band: mm.length ? distanceBand(mm[0]!.miles) : null,
      shared_interests: shared,
      mutual_preferences: !!pa.is && !!pb.is && pa.seeks.includes(pb.is) && pb.seeks.includes(pa.is),
    },
  };
}

/** The dating judge for a pack's options (slop/index.ts wires it). */
export function slopJudge(o: SlopPackOptions): JudgePack {
  return {
    rubric: { compact: { version: SLOP_JUDGE_VERSION, system: SLOP_JUDGE_SYSTEM }, matchable: { version: SLOP_JUDGE_VERSION, system: SLOP_JUDGE_SYSTEM } },
    rubricKeys: ["fit", "mutual_value", "capacity_realism", "timing", "social_comfort", "red_flags", "certainty"],
    buildContext: (w, c) => slopJudgeContext(w, c, o),
    // After the model: still two adults who are each in the other's stated seeking set.
    hardGate: (w, c) => {
      if (c.participants.length !== 2 || c.category !== "romance") return "not_one_to_one";
      const P = slopProfiles(w.input, w.canonical);
      const [pa, pb] = c.participants.map(id => P.get(id));
      if (!pa?.adult || !pb?.adult) return "underage";
      return pa.is && pb.is && pa.seeks.includes(pb.is) && pb.seeks.includes(pa.is) ? null : "orientation_mismatch";
    },
  };
}
