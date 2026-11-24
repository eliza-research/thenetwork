import { DAY, type City, type MemberId } from "@thenetwork/core";
import { slopPairConstraintsCurrent } from "../../../../core/src/generated/datingRadius.ts";
import { mutuallyOpen } from "../../../../core/src/generated/mutualOpenness.ts";
import type { MatchLane } from "../../../../core/src/generated/matchLane.ts";
import type { CandidateRule, MemberRule, PairRule } from "../../pack.ts";
import type { EngineInput } from "../../types.ts";
import { pairKey, type World } from "../../world.ts";
import { limitMiles, mutualMarkets } from "./geo.ts";
import { SLOP_DEFAULT_OPTIONS, type SlopPackOptions } from "./options.ts";
import { datingStatementOf, slopProfiles, type SlopProfile } from "./profile.ts";
import { statedDealbreaker } from "./score.ts";

export const SLOP_LANE = "romance" as const;
export const SLOP_MATCH_LANE: MatchLane = "Date";
const prof = (w: World) => slopProfiles(w.input);

export function ageRangeOf(p: SlopProfile, o: SlopPackOptions): [number, number] | undefined {
  if (p.ageRange) return p.ageRange;
  if (!o.asks) return [Math.max(18, p.age - o.unknownDefaults.ageSpread), p.age + o.unknownDefaults.ageSpread];
  return o.silentFallback.enabled && p.silentAsks.includes("age_range") ? [Math.max(18, p.age - o.silentFallback.ageSpread), p.age + o.silentFallback.ageSpread] : undefined;
}

export function missingFields(p: SlopProfile, o: SlopPackOptions): ("orientation" | "age_range" | "distance" | "zip")[] {
  const out: ("orientation" | "age_range" | "distance" | "zip")[] = [];
  if (!p.is || !p.seeks.length) out.push("orientation");
  if (!o.asks) return out;
  if (!ageRangeOf(p, o)) out.push("age_range");
  if (limitMiles(p, o) === undefined) out.push("distance");
  if (p.zipUnknown && !p.silentAsks.includes("zip")) out.push("zip");
  return out;
}

export function needsBasics(p: SlopProfile): boolean {
  return !p.goal || (!p.dealbreakers.length && p.values.politics === undefined);
}

export function reviewReason(p: SlopProfile, o: SlopPackOptions): string | null {
  if (p.review === "confirmed") return "review_confirmed";
  const cleared = p.review === "cleared";
  if (!cleared && p.verification.some(t => t.endsWith(":fail"))) return "verification_failed";
  if (o.verification.required && !(p.verification.includes("verify:liveness:pass") && p.verification.includes("verify:age:pass"))) return "unverified";
  if (!cleared && o.safetyGate && p.safety.some(t => o.safetyCues.includes(t))) return "safety_review";
  const T = o.trust;
  if (T.enabled) {
    const h = p.history;
    if (T.negativeFrom > 0 && h.negativeFrom >= T.negativeFrom) return "trust_review";
    if (T.blockedBy > 0 && h.contextualBlocks >= T.blockedBy) return "trust_review";
    if (T.noShows > 0 && h.noShows >= T.noShows && h.noShows > h.dates) return "trust_review";
    if (T.eagerYes > 0 && h.yes >= T.eagerYes && h.no === 0 && h.silent === 0) return "trust_review";
  }
  return null;
}

export function seekingMatches(a: SlopProfile, b: SlopProfile): boolean {
  return mutuallyOpen(datingStatementOf(a), datingStatementOf(b));
}

function ageRangeReason(a: SlopProfile, b: SlopProfile, o: SlopPackOptions): string | null {
  const ra = ageRangeOf(a, o), rb = ageRangeOf(b, o);
  if (!ra || !rb) return "age_range_unknown";
  return b.age >= ra[0] && b.age <= ra[1] && a.age >= rb[0] && a.age <= rb[1] ? null : "age_range";
}

export function slopHardPairCurrent(input: EngineInput, pair: readonly MemberId[], market: City, options: SlopPackOptions = SLOP_DEFAULT_OPTIONS): boolean {
  const [first, second] = pair;
  if (pair.length !== 2 || first === undefined || second === undefined || first === second) return false;
  const profiles = slopProfiles(input);
  const a = profiles.get(first), b = profiles.get(second);
  if (!a || !b) return false;
  return slopPairConstraintsCurrent({
    adults: a.adult && b.adult,
    optedIn: a.optedIn && b.optedIn && !a.paused && !b.paused,
    safetyClear: !reviewReason(a, options) && !reviewReason(b, options),
    complete: missingFields(a, options).length === 0 && missingFields(b, options).length === 0,
    seeksMutually: seekingMatches(a, b),
    agesFit: ageRangeReason(a, b, options) === null,
    dealbreakersClear: !statedDealbreaker(a, b) && !statedDealbreaker(b, a),
    radiusFits: mutualMarkets(a, b, options, [market]).length !== 0,
  });
}

export function slopMemberRules(o: SlopPackOptions): MemberRule[] {
  return [
    { id: "lane", check: (_w, _id, _mi, c) => (c.category !== SLOP_LANE ? "lane_not_offered" : null) },
    { id: "romance_opt_out", check: (w, id) => (prof(w).get(id)?.optedIn ? null : "romance_opt_out") },
    { id: "review_hold", check: (w, id) => reviewReason(prof(w).get(id)!, o) },
    { id: "needs_answer", check: (w, id) => { const f = missingFields(prof(w).get(id)!, o)[0]; return f ? `needs_${f}` : null; } },
    { id: "basics_pending", check: (w, id) => { const p = prof(w).get(id)!; return o.holdForBasics && o.compatAsks && needsBasics(p) && !p.silentAsks.includes("basics") ? "needs_basics" : null; } },
    { id: "your_turn", check: (_w, _id, mi) => (mi.inOpenOpportunity ? "your_turn" : null) },
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
      id: "orientation_mismatch", check: (w, a, b) => {
        const P = prof(w), pa = P.get(a)!, pb = P.get(b)!;
        return seekingMatches(pa, pb) ? null : "orientation_mismatch";
      },
    },
    {
      id: "age_range", check: (w, a, b) => {
        const P = prof(w), pa = P.get(a)!, pb = P.get(b)!;
        return ageRangeReason(pa, pb, o);
      },
    },
    {
      id: "dealbreaker", check: (w, a, b) => {
        const P = prof(w), pa = P.get(a)!, pb = P.get(b)!;
        return statedDealbreaker(pa, pb) || statedDealbreaker(pb, pa) ? "dealbreaker" : null;
      },
    },
  ];
}

export const SLOP_CANDIDATE_PRE_RULES: readonly CandidateRule[] = [
  { id: "one_to_one", check: (_w, c) => (c.participants.length !== 2 || c.category !== SLOP_LANE || c.via ? "not_one_to_one" : null) },
];
