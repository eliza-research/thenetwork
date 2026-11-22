// peon.biz features for generic matching (AppPack.vectors; packages/engine/src/match), lane Hire
// (TwoSided): an open job seat of a verified employer is Offering, an adult candidate is Seeking,
// once per role family they seek (a candidate wants any one of their families, not all of them).
// Tags carry skill levels as one tag per level ("skill:sql:1".."skill:sql:3"), so coverage counts
// the levels a candidate brings toward each must-have, with credit for a near miss. Standing is the
// role level on both sides, private. The pack value is pay, directed.
// Inputs are profile.ts fields only, so nothing here can see a sealed attribute or a proxy.
import type { MemberId } from "@thenetwork/core";
import { laneLimits, standingCeiling } from "../../../../core/src/generated/matchLane.ts";
import { standingFromEvidence, standingUncertaintyFor } from "../../../../core/src/generated/memberStanding.ts";
import { pairValueScale } from "../../../../core/src/generated/pairValue.ts";
import { memberReason } from "../../filters.ts";
import type { EntityStanding, EntityTags, MatchEntity, MatchProfile, Membership, PackVectors } from "../../match/profile.ts";
import type { World } from "../../world.ts";
import { networkVectors } from "../network/vectors.ts";
import { peonCofounderMembership, peonCofounderTags } from "./cofounder.ts";
import { candidateOf, jobOf, profileOf, type CandidateProfile, type JobProfile } from "./profile.ts";
import { peonMarkets } from "./rules.ts";

/** Whole-number skill level an employer can rely on: an unverified claim counts one level lower. */
export function effectiveLevel(c: CandidateProfile, skill: string): number {
  const s = c.skills.get(skill);
  if (!s) return 0;
  return s.evidence === "claimed" ? Math.max(0, s.level - 1) : s.level;
}

/** Per must-have: met (effective level >= min), partial (within one level) or missing. */
export function mustChecks(c: CandidateProfile, j: JobProfile, claimedOnly = false): { skill: string; status: "met" | "partial" | "missing" }[] {
  return j.must.map(m => {
    const lvl = claimedOnly ? (c.skills.get(m.skill)?.level ?? 0) : effectiveLevel(c, m.skill);
    return { skill: m.skill, status: lvl >= m.min ? "met" as const : lvl >= m.min - 1 && lvl > 0 ? "partial" as const : "missing" as const };
  });
}

/** A nice-to-have counts up to this level. */
const NICE_LEVEL = 2;
/** Seniority runs 1 (entry) .. TOP_LEVEL (principal). */
const TOP_LEVEL = 5;

const levels = (skill: string, upTo: number): string[] => Array.from({ length: Math.max(0, upTo) }, (_, k) => `skill:${skill}:${k + 1}`);
const family = (f: string) => `family:${f}`;
const known = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

/** A job entity's id in a market: the job intent id, suffixed by the market for a remote job seen in several. */
export function jobEntityId(j: JobProfile, market: string, markets: number): string {
  const id = j.intentId ?? j.id;
  return markets > 1 ? `${id}@${market}` : id;
}
/** A candidate entity's id: the member id for one sought family, else the member id and the family. */
const candidateEntityId = (c: CandidateProfile, f: string): string => (c.families.length > 1 ? `${c.id}#${f}` : c.id);
const familyOfEntity = (c: CandidateProfile, e: MatchEntity): string => (e.id === c.id ? c.families[0]! : e.id.slice(c.id.length + 1));

const memberOk = (w: World, id: MemberId, role: "seeker" | "provider") =>
  memberReason(w, id, { lane: "Hire", category: "professional", role, format: "one_to_one", timeSensitive: false }) === null;

// A seat or a candidate without a stated level, family or pay has no membership: the lane band is the
// level rule only when both levels exist, and the pay value needs both the range and the floor.
function hireMemberships(w: World, id: MemberId): Membership[] {
  const p = profileOf(w, id);
  if (!p || !known(p.seniority)) return [];
  if (p.kind === "job") {
    if (!p.family || !known(p.payMin) || !known(p.payMax) || !memberOk(w, id, "provider")) return [];
    const markets = peonMarkets(w, id);
    // spec/peonCapacity.md, "The next slate stays within remaining openings"
    const capacity = p.seatCap ?? p.openings;
    return markets.map(market => ({ id: jobEntityId(p, market, markets.length), lane: "Hire" as const, side: "Offering" as const, market, capacity }));
  }
  if (!known(p.floor) || !memberOk(w, id, "seeker")) return [];
  const capacity = laneLimits("Hire").weeklyCapacity;
  return p.families.map(f => ({ id: candidateEntityId(p, f), lane: "Hire" as const, side: "Seeking" as const, market: p.market, capacity }));
}

function memberships(w: World, id: MemberId): Membership[] {
  const hire = hireMemberships(w, id);
  const cofounder = peonCofounderMembership(w, id);
  return cofounder ? [...hire, cofounder] : hire;
}

const heldSkills = (c: CandidateProfile) => [...c.skills.keys()].flatMap(s => levels(s, effectiveLevel(c, s)));

// Work mode and location are hard rules (rules.ts), so they are not sought here: a candidate who
// accepts more modes must not get less value from a job. The role family is the shared field
// (affinity, both sides) and, for the candidate, what they seek.
function tags(w: World, e: MatchEntity): EntityTags {
  if (e.lane === "Cofounder") return peonCofounderTags(w, e.memberId);
  const j = jobOf(w, e.memberId);
  if (j) {
    return {
      offers: [family(j.family!)],
      seeks: [...j.must.flatMap(m => levels(m.skill, m.min)), ...j.nice.flatMap(s => levels(s, NICE_LEVEL))],
      interests: [family(j.family!)],
    };
  }
  const c = candidateOf(w, e.memberId)!;
  const f = family(familyOfEntity(c, e));
  return { offers: heldSkills(c), seeks: [f], interests: [f] };
}

/** Role level 1..TOP_LEVEL on the standing scale (0..standingCeiling). */
const levelPoints = (level: number): number => Math.floor((Math.min(TOP_LEVEL, Math.max(1, Math.round(level))) - 1) * standingCeiling / (TOP_LEVEL - 1));

// spec/memberStanding.md: role level and track record only; never a reply, acceptance or popularity count.
// The level is a categorical fact on both sides, so both count it in full and sit on one scale; how
// well the candidate's level is backed shows only in the uncertainty.
function standing(w: World, e: MatchEntity): EntityStanding {
  if (e.lane === "Cofounder") return networkVectors.standing(w, e);
  const p = profileOf(w, e.memberId)!;
  const level = [{ points: levelPoints(p.seniority!), reviewed: true }];
  const reviewed = p.kind === "job" ? new Set<string>() : new Set([
    p.seniorityReviewedIn,
    ...[...p.skills.values()].filter(s => s.level >= p.seniority!).map(s => s.reviewedIn),
  ].filter(id => id !== undefined));
  const evidenceIds = [...new Set([p.seniorityFacetId, ...reviewed])].filter(id => id !== undefined);
  return { standing: standingFromEvidence(level), uncertainty: standingUncertaintyFor(reviewed.size, p.kind === "job"), evidenceIds };
}

const clampValue = (v: number) => Math.max(0, Math.min(pairValueScale, v));
/** Pay headroom for a candidate: 500 at their floor, 1000 at 20% above it (the floor itself is a hard rule). */
function payHeadroom(floor: number, payMax: number): number {
  return clampValue(pairValueScale / 2 + Math.floor((payMax - floor) * pairValueScale * 5 / (2 * Math.max(20, floor))));
}
/** Pay fit for a seat: 1000 when the candidate's floor is at or below the range's minimum, 500 at its maximum. */
function payFit(payMin: number, payMax: number, floor: number): number {
  if (floor <= payMin) return pairValueScale;
  if (payMax <= payMin) return pairValueScale / 2;
  return clampValue(pairValueScale - Math.floor((floor - payMin) * (pairValueScale / 2) / (payMax - payMin)));
}

// Both sides of every Hire profile have a known floor or range (memberships), so no default applies.
function packValue(w: World, a: MatchProfile, b: MatchProfile): number {
  if (a.lane === "Cofounder" || b.lane === "Cofounder") return 0;
  const ja = jobOf(w, a.memberId), cb = candidateOf(w, b.memberId);
  if (ja && cb) return payFit(ja.payMin!, ja.payMax!, cb.floor!);
  const ca = candidateOf(w, a.memberId), jb = jobOf(w, b.memberId);
  return ca && jb ? payHeadroom(ca.floor!, jb.payMax!) : 0;
}

export const peonVectors: PackVectors = { memberships, tags, standing, packValue };
