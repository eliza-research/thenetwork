// slopPack hard filters (AppPack.eligibility). They run AFTER the core prefixes (members: unknown,
// underage, safety_hold, paused; pairs: duplicate, underage, blocked) and only ever remove. The
// mutual radius is the geo model's pairReason (geo.ts), checked last. ORDER IS THE FUNNEL CONTRACT:
// the first failing rule names the reason in the run report.
//
// Stated preferences are filters only (PRD 40.5): mutual gender / orientation inclusion, age ranges
// both ways, stated dealbreakers, radius or cities. There is no race or ethnicity rule (no field).
// Safety: observed safety cues and the Network's own records hold a member for human review.
import { DAY } from "@thenetwork/core";
import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import { pairKey, type World } from "../../world.ts";
import { limitMiles } from "./geo.ts";
import type { SlopPackOptions } from "./options.ts";
import { slopProfiles, type SlopProfile } from "./profile.ts";
import { appearanceGap, statedDealbreaker } from "./score.ts";

export const SLOP_LANE = "romance" as const;
const prof = (w: World) => slopProfiles(w.input, w.canonical);

/** A member's age range: stated; else the narrow fallback after a silent ask; else (asks off) the default guess; undefined = ask. */
export function ageRangeOf(p: SlopProfile, o: SlopPackOptions): [number, number] | undefined {
  if (p.ageRange) return p.ageRange;
  if (!o.asks) return [Math.max(18, p.age - o.unknownDefaults.ageSpread), p.age + o.unknownDefaults.ageSpread];
  return o.silentFallback.enabled && p.silentAsks.includes("age_range") ? [Math.max(18, p.age - o.silentFallback.ageSpread), p.age + o.silentFallback.ageSpread] : undefined;
}

/** Hard-filter fields that are missing (ask instead of proposing; one message asks them all). */
export function missingFields(p: SlopProfile, o: SlopPackOptions): ("orientation" | "age_range" | "distance" | "zip")[] {
  const out: ("orientation" | "age_range" | "distance" | "zip")[] = [];
  if (!p.is || !p.seeks.length) out.push("orientation");
  if (!o.asks) return out;
  if (!ageRangeOf(p, o)) out.push("age_range");
  if (limitMiles(p, o) === undefined) out.push("distance");
  // A zip we cannot place: ask for a nearby zip or neighborhood rather than fail or guess. After a
  // week without an answer the market's anchor cell stands in (profile.cellIn), never a lockout.
  if (p.zipUnknown && !p.silentAsks.includes("zip")) out.push("zip");
  return out;
}

/** The basics (goal, dealbreakers or at least the lifestyle answers) are not known yet. */
export function needsBasics(p: SlopProfile): boolean {
  return !p.goal || (!p.dealbreakers.length && p.values.politics === undefined);
}

/** Why a member is held for review (safety cue or the Network's own records), or null. */
export function reviewReason(p: SlopProfile, o: SlopPackOptions): string | null {
  // Human review: a confirmed hold stays; a cleared one (a false positive) lifts the cue / check hold.
  if (p.review === "confirmed") return "review_confirmed";
  const cleared = p.review === "cleared";
  if (!cleared && p.verification.some(t => t.endsWith(":fail"))) return "verification_failed";
  if (o.verification.required && !(p.verification.includes("verify:liveness:pass") && p.verification.includes("verify:age:pass"))) return "unverified";
  if (!cleared && o.safetyGate && p.safety.some(t => o.safetyCues.includes(t))) return "safety_review";
  const T = o.trust;
  if (T.enabled) {
    const h = p.history;
    if (T.negativeFrom > 0 && h.negativeFrom >= T.negativeFrom) return "trust_review";
    if (T.blockedBy > 0 && h.blockedBy >= T.blockedBy) return "trust_review";
    if (T.noShows > 0 && h.noShows >= T.noShows && h.noShows > h.dates) return "trust_review";
    if (T.eagerYes > 0 && h.yes >= T.eagerYes && h.no === 0 && h.silent === 0) return "trust_review";
  }
  return null;
}

export function slopMemberRules(o: SlopPackOptions): MemberRule[] {
  return [
    // The only lane slop.date offers is dating; members must have opted in (adults only: core).
    { id: "lane", check: (_w, _id, _mi, c) => (c.category !== SLOP_LANE ? "lane_not_offered" : null) },
    { id: "romance_opt_out", check: (w, id) => (prof(w).get(id)?.optedIn ? null : "romance_opt_out") },
    // Safety cues and records: held for human review, never matched while held.
    { id: "review_hold", check: (w, id) => reviewReason(prof(w).get(id)!, o) },
    // Unknown orientation / age range / distance: ask, do not guess (asks.ts emits the question).
    { id: "needs_answer", check: (w, id) => { const f = missingFields(prof(w).get(id)!, o)[0]; return f ? `needs_${f}` : null; } },
    // Optional: the first intro waits for the open basics question (answered, or 7 days of silence).
    { id: "basics_pending", check: (w, id) => { const p = prof(w).get(id)!; return o.holdForBasics && o.compatAsks && needsBasics(p) && !p.silentAsks.includes("basics") ? "needs_basics" : null; } },
    // "Your turn" limit: nothing new while a mutual yes or a booked date waits on this member.
    { id: "your_turn", check: (_w, _id, mi) => (mi.inOpenOpportunity ? "your_turn" : null) },
    // Receptivity pacing (Rios, Saban & Zheng): no new probe right after a date the member liked.
    {
      id: "recently_matched", check: (w, id) => {
        const h = prof(w).get(id)!.history;
        return o.pacing.likedDateDays > 0 && h.lastDateAt !== undefined && h.lastDateLiked && w.now - h.lastDateAt < o.pacing.likedDateDays * DAY ? "recently_matched" : null;
      },
    },
  ];
}

export function slopPairRules(o: SlopPackOptions): PairRule[] {
  return [
    // Never introduce the same two people twice once they were revealed to each other (booked, backed
    // out, met). An anonymous probe that ended before the reveal may be retried after a cooldown.
    {
      id: "already_introduced", check: (w, a, b) => {
        if (w.edgeHas(a, b, "met")) return "already_introduced";
        for (const r of w.pairInteractions.get(pairKey(a, b)) ?? []) {
          const preReveal = r.outcome === "declined" || r.outcome === "expired";
          if (!preReveal || o.reprobeAfterDays <= 0) return "already_introduced";
          if (w.now - r.at < o.reprobeAfterDays * DAY) return "reprobe_cooldown";
        }
        return null;
      },
    },
    { id: "unknown_member", check: (_w, _a, _b, _lane, ma, mb) => (!ma || !mb ? "unknown_member" : null) },
    {
      // Mutual gender / orientation inclusion: each is in the other's seeking set.
      id: "orientation_mismatch", check: (w, a, b) => {
        const P = prof(w), pa = P.get(a)!, pb = P.get(b)!;
        if (!pa.is || !pb.is) return "orientation_mismatch";
        return pa.seeks.includes(pb.is) && pb.seeks.includes(pa.is) ? null : "orientation_mismatch";
      },
    },
    {
      // Age ranges both ways (claimed age; minors never get here: core).
      id: "age_range", check: (w, a, b) => {
        const P = prof(w), pa = P.get(a)!, pb = P.get(b)!;
        const ra = ageRangeOf(pa, o), rb = ageRangeOf(pb, o);
        if (!ra || !rb) return "age_range_unknown";
        return pb.age >= ra[0] && pb.age <= ra[1] && pa.age >= rb[0] && pa.age <= rb[1] ? null : "age_range";
      },
    },
    {
      // Iteration 3: appearance band (only when both ratings are usable).
      id: "appearance_band", check: (w, a, b) => {
        if (o.appearance.mode !== "band") return null;
        const d = appearanceGap(prof(w).get(a)!, prof(w).get(b)!, o);
        return d !== undefined && d > o.appearance.band ? "appearance_band" : null;
      },
    },
    {
      // Stated dealbreakers, both ways, on the other's known values (unknown values never count as a hit).
      id: "dealbreaker", check: (w, a, b) => {
        const P = prof(w), pa = P.get(a)!, pb = P.get(b)!;
        return statedDealbreaker(pa, pb) || statedDealbreaker(pb, pa) ? "dealbreaker" : null;
      },
    },
  ];
}

/** Configuration rules: dating is one-to-one in the dating lane, between two members. */
export const SLOP_CANDIDATE_PRE_RULES: readonly CandidateRule[] = [
  { id: "one_to_one", check: (_w, c) => (c.participants.length !== 2 || c.category !== SLOP_LANE || c.via ? "not_one_to_one" : null) },
];
