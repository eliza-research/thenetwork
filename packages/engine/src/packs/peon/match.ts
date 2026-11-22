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

function effectiveLevel(c: CandidateProfile, skill: string): number {
  const s = c.skills.get(skill);
  if (!s) return 0;
  return s.evidence === "claimed" ? Math.max(0, s.level - 1) : s.level;
}

export function mustChecks(c: CandidateProfile, j: JobProfile, claimedOnly = false): { skill: string; status: "met" | "partial" | "missing" }[] {
  return j.must.map(m => {
    const lvl = claimedOnly ? (c.skills.get(m.skill)?.level ?? 0) : effectiveLevel(c, m.skill);
    return { skill: m.skill, status: lvl >= m.min ? "met" as const : lvl >= m.min - 1 && lvl > 0 ? "partial" as const : "missing" as const };
  });
}

const NICE_LEVEL = 2;
const TOP_LEVEL = 5;

const levels = (skill: string, upTo: number): string[] => Array.from({ length: Math.max(0, upTo) }, (_, k) => `skill:${skill}:${k + 1}`);
const family = (f: string) => `family:${f}`;
const known = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

function jobEntityId(j: JobProfile, market: string, markets: number): string {
  const id = j.intentId ?? j.id;
  return markets > 1 ? `${id}@${market}` : id;
}
const candidateEntityId = (c: CandidateProfile, f: string): string => (c.families.length > 1 ? `${c.id}#${f}` : c.id);
const familyOfEntity = (c: CandidateProfile, e: MatchEntity): string => (e.id === c.id ? c.families[0]! : e.id.slice(c.id.length + 1));

const memberOk = (w: World, id: MemberId, role: "seeker" | "provider") =>
  memberReason(w, id, { lane: "Hire", category: "professional", role, format: "one_to_one", timeSensitive: false }) === null;

function hireMemberships(w: World, id: MemberId): Membership[] {
  const p = profileOf(w, id);
  if (!p || !known(p.seniority)) return [];
  if (p.kind === "job") {
    if (!p.family || !known(p.payMin) || !known(p.payMax) || !memberOk(w, id, "provider")) return [];
    const markets = peonMarkets(w, id);
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

const levelPoints = (level: number): number => Math.floor((Math.min(TOP_LEVEL, Math.max(1, Math.round(level))) - 1) * standingCeiling / (TOP_LEVEL - 1));

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
function payHeadroom(floor: number, payMax: number): number {
  return clampValue(pairValueScale / 2 + Math.floor((payMax - floor) * pairValueScale * 5 / (2 * Math.max(20, floor))));
}
function payFit(payMin: number, payMax: number, floor: number): number {
  if (floor <= payMin) return pairValueScale;
  if (payMax <= payMin) return pairValueScale / 2;
  return clampValue(pairValueScale - Math.floor((floor - payMin) * (pairValueScale / 2) / (payMax - payMin)));
}

function packValue(w: World, a: MatchProfile, b: MatchProfile): number {
  if (a.lane === "Cofounder" || b.lane === "Cofounder") return 0;
  const ja = jobOf(w, a.memberId), cb = candidateOf(w, b.memberId);
  if (ja && cb) return payFit(ja.payMin!, ja.payMax!, cb.floor!);
  const ca = candidateOf(w, a.memberId), jb = jobOf(w, b.memberId);
  return ca && jb ? payHeadroom(ca.floor!, jb.payMax!) : 0;
}

export const peonVectors: PackVectors = { memberships, tags, standing, packValue };
