// networkPack.vectors: what ntwrk gives the generic match core (packages/engine/src/match). Lane
// memberships come from what a member wants and offers, tags from the pack's own vocabulary and
// objective taxonomy, and private standing from stated and verified facts only.
import type { Category, Facet, FacetKind, Intent, MemberId } from "@thenetwork/core";
import { cofounderIntentEligible } from "../../../../core/src/generated/cofounderDispatch.ts";
import { cofounderIntentObjective } from "../../../../core/src/generated/cofounderIntent.ts";
import { laneLimits, type LaneSide, type MatchLane } from "../../../../core/src/generated/matchLane.ts";
import { standingFacetReadable, standingFromEvidence, standingUncertainty, type StandingEvidence } from "../../../../core/src/generated/memberStanding.ts";
import { networkIntentRoute, type NetworkIntentRoute } from "../../../../core/src/generated/networkIntentLane.ts";
import { standingIntentLive } from "../../../../core/src/standing-intent.ts";
import type { EntityStanding, EntityTags, MatchEntity, Membership, PackVectors } from "../../match/profile.ts";
import type { World } from "../../world.ts";
import { objectivesFor } from "./taxonomy.ts";
import { INTERESTS, SKILLS } from "./vocabulary.ts";

export const MATCH_LANES: readonly MatchLane[] = ["Friend", "Date", "Cofounder", "Intro", "Hire", "Mentor", "Invest"];
const SIDES: readonly LaneSide[] = ["Peer", "Offering", "Seeking"];

export interface LaneRole { readonly lane: MatchLane; readonly side: LaneSide }
const INTRO: LaneRole = { lane: "Intro", side: "Peer" };
const FRIEND: LaneRole = { lane: "Friend", side: "Peer" };
const COFOUNDER_PEER: LaneRole = { lane: "Cofounder", side: "Peer" };

/** One stated want (a live intent or a goal facet) read through the objective taxonomy. */
export interface Want {
  readonly roles: readonly LaneRole[];
  /** What the want asks of a partner: the skills it needs and its shared-want tag. */
  readonly seeks: readonly string[];
  readonly interests: readonly string[];
  /** Shared-want tags: two members with the same one can satisfy each other. */
  readonly pools: readonly string[];
}
export interface MemberTags { readonly offers: ReadonlySet<string>; readonly seeks: ReadonlySet<string>; readonly interests: ReadonlySet<string> }

const OFFER_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["skill", "offer", "resource"]);
const SEEK_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["desire", "goal"]);
const INTEREST_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["interest", "trait"]);
const STANDING_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["fact", "skill", "offer", "resource"]);

// A professional ask or offer is one about a tech-cluster interest or a skill that teaches one.
const TECH_INTERESTS: ReadonlySet<string> = new Set(INTERESTS.filter(i => i.cluster === "tech").map(i => i.tag));
const PROFESSIONAL_SKILLS: ReadonlySet<string> = new Set(SKILLS.flatMap(s => (s.teaches !== undefined && TECH_INTERESTS.has(s.teaches) ? [s.tag] : [])));
const isProfessionalTag = (tag: string): boolean => TECH_INTERESTS.has(tag) || PROFESSIONAL_SKILLS.has(tag);

const INVEST_OFFERED = /\b(invest(ing)? in (startups?|companies|founders|early[- ]stage \w+)|angel invest\w*|(meet|find|looking for|seeking) (startups?|companies|founders) to invest in)\b/i;
const INVEST_SOUGHT = /\b(fundrais\w*|rais(e|ing) (money|a round|capital|funds?|a seed)|seed round|(find|meet) investors?)\b/i;
const COFOUNDER = /\b(find|get|meet|need|want|seek(ing)?|looking for) (a |another )?((potential|technical|business) )?co-?founders?\b/i;
const MENTOR_OFFERED = /\bmentor(ing)? (someone|people|others|founders|juniors?)\b/i;
const MENTOR_SOUGHT = /\b(find|get|need|want) (a )?mentor\b|\bmentorship\b|\badvice from\b|\bsomeone senior\b/i;
const INVESTOR_OFFER = /\b(investor|angel invest\w*|vc (fund|firm)|venture capital\w*|fund manager|general partner)\b/i;
const MENTOR_OFFER = /\bmentor\w*\b/i;

const normal = (tag: string): string => tag.trim().toLowerCase();
/** Matching tags: lower case, without structural "key:value" tags (lane, side, level, evidence). */
const plainTags = (tags: readonly string[]): string[] => tags.map(normal).filter(t => t.length > 0 && !t.includes(":"));
const tagValue = (tags: readonly string[], key: string): string | undefined =>
  tags.map(normal).find(t => t.startsWith(`${key}:`))?.slice(key.length + 1);

/** An explicit "lane:<Lane>" tag (with "side:<Side>", Peer when absent), as the onboarding agent writes it. */
function taggedRole(tags: readonly string[]): LaneRole | undefined {
  const laneTag = tagValue(tags, "lane"), sideTag = tagValue(tags, "side");
  const lane = MATCH_LANES.find(l => l.toLowerCase() === laneTag);
  const side = SIDES.find(s => s.toLowerCase() === sideTag) ?? "Peer";
  return lane ? { lane, side } : undefined;
}

const INTENT_ROLES: Readonly<Record<Exclude<NetworkIntentRoute, "NoRoute">, LaneRole>> = {
  FriendRoute: FRIEND, IntroRoute: INTRO, CofounderRoute: COFOUNDER_PEER,
  MentorOfferRoute: { lane: "Mentor", side: "Offering" }, MentorSeekRoute: { lane: "Mentor", side: "Seeking" },
  InvestOfferRoute: { lane: "Invest", side: "Offering" }, InvestSeekRoute: { lane: "Invest", side: "Seeking" },
};

/** A specific ask has one lane and side. Only a general professional ask can open Intro. */
function wantRoles(text: string, category: Category | undefined, tags: readonly string[], asked: readonly string[]): LaneRole[] {
  const tagged = taggedRole(tags);
  if (tagged) return [tagged];
  const specific: NetworkIntentRoute =
    INVEST_OFFERED.test(text) ? "InvestOfferRoute"
    : INVEST_SOUGHT.test(text) ? "InvestSeekRoute"
    : COFOUNDER.test(text) ? "CofounderRoute"
    : MENTOR_OFFERED.test(text) ? "MentorOfferRoute"
    : MENTOR_SOUGHT.test(text) ? "MentorSeekRoute"
    : "NoRoute";
  const professional = category === "professional" || [...plainTags(tags), ...asked].some(isProfessionalTag);
  const route = networkIntentRoute(category !== "romance" && category !== "growth", specific, professional);
  return route === "NoRoute" ? [] : [INTENT_ROLES[route]];
}

/** Lanes an offer opens: its explicit lane tag; else an investor offers in Invest, a mentor in Mentor; both, and any professional skill, are Peers in Intro. */
function offerRoles(f: Facet): LaneRole[] {
  const tagged = taggedRole(f.tags);
  if (tagged) return [tagged];
  const text = `${f.value} ${f.tags.join(" ")}`;
  const roles: LaneRole[] = [];
  if (INVESTOR_OFFER.test(text)) roles.push({ lane: "Invest", side: "Offering" });
  if (MENTOR_OFFER.test(text)) roles.push({ lane: "Mentor", side: "Offering" });
  return roles.length > 0 || plainTags(f.tags).some(isProfessionalTag) ? [...roles, INTRO] : [];
}

function wantOf(text: string, details: string | undefined, category: Category | undefined, tags: readonly string[]): Want {
  const objectives = objectivesFor(text, details, category);
  const needs = objectives.flatMap(o => o.needs);
  const interests = objectives.flatMap(o => o.interests);
  const pools = objectives.flatMap(o => (o.pool ? [`want_${o.pool}`] : []));
  return { roles: wantRoles(`${text} ${details ?? ""}`, category, tags, [...needs, ...interests]), seeks: [...needs, ...pools], interests, pools };
}

interface RunCache {
  readonly intents: Map<string, Want>;
  readonly goals: Map<MemberId, readonly Want[]>;
  readonly tags: Map<MemberId, MemberTags>;
  readonly cofounderIntents: Map<MemberId, Intent | undefined>;
}
const caches = new WeakMap<World, RunCache>();
const cacheOf = (w: World): RunCache => {
  let cache = caches.get(w);
  if (!cache) { cache = { intents: new Map(), goals: new Map(), tags: new Map(), cofounderIntents: new Map() }; caches.set(w, cache); }
  return cache;
};

/** The want a live intent states. */
export function intentWant(w: World, intent: Intent): Want {
  const cache = cacheOf(w);
  let want = cache.intents.get(intent.id);
  if (!want) { want = wantOf(intent.objective, intent.details, intent.category, []); cache.intents.set(intent.id, want); }
  return want;
}

function goalWants(w: World, memberId: MemberId): readonly Want[] {
  const cache = cacheOf(w);
  let wants = cache.goals.get(memberId);
  if (!wants) {
    wants = (w.get(memberId)?.match ?? []).filter(f => f.kind === "goal").map(f => wantOf(f.value.replace(/^wants to /i, ""), undefined, undefined, f.tags));
    cache.goals.set(memberId, wants);
  }
  return wants;
}

const memberWants = (w: World, memberId: MemberId): readonly Want[] =>
  [...(w.get(memberId)?.intents ?? []).map(i => intentWant(w, i)), ...goalWants(w, memberId)];

export const wantHas = (want: Want, role: LaneRole): boolean => want.roles.some(r => r.lane === role.lane && r.side === role.side);

/** The current signed standing intent is the only authority for a Cofounder profile. */
export function networkCofounderIntentOf(w: World, id: MemberId): Intent | undefined {
  const cache = cacheOf(w).cofounderIntents;
  if (cache.has(id)) return cache.get(id);
  let latest: Intent | undefined;
  for (const intent of w.get(id)?.intents ?? []) {
    if (intent.memberId !== id || intent.objective !== cofounderIntentObjective) continue;
    if (!cofounderIntentEligible(intent.app ?? "", "ntwrk", intent.category, intent.details ?? "",
      intent.createdAt <= w.now && standingIntentLive(intent, w.now))) continue;
    if (!latest || intent.createdAt > latest.createdAt || (intent.createdAt === latest.createdAt && intent.id < latest.id)) latest = intent;
  }
  cache.set(id, latest);
  return latest;
}

/** A member's matching tags from matchable or shareable facets and live wants (the same in every lane). */
export function memberTags(w: World, memberId: MemberId): MemberTags {
  const cache = cacheOf(w);
  const done = cache.tags.get(memberId);
  if (done) return done;
  const offers = new Set<string>(), seeks = new Set<string>(), interests = new Set<string>();
  const add = (into: Set<string>, tags: readonly string[]) => { for (const t of tags) into.add(t); };
  for (const f of w.get(memberId)?.match ?? []) {
    if (OFFER_KINDS.has(f.kind)) add(offers, plainTags(f.tags));
    else if (SEEK_KINDS.has(f.kind)) add(seeks, plainTags(f.tags));
    else if (INTEREST_KINDS.has(f.kind)) add(interests, plainTags(f.tags));
  }
  for (const want of memberWants(w, memberId)) {
    if (wantHas(want, COFOUNDER_PEER)) continue;
    add(seeks, want.seeks); add(interests, want.interests); add(offers, want.pools);
  }
  const tags: MemberTags = { offers, seeks, interests };
  cache.tags.set(memberId, tags);
  return tags;
}

/** The id of a member's membership in one lane and side. */
export const membershipId = (memberId: MemberId, role: LaneRole): string => `${memberId}/${role.lane}/${role.side}`;

function memberships(w: World, memberId: MemberId): Membership[] {
  const mi = w.get(memberId);
  if (!mi) return [];
  const roles = new Map<string, LaneRole>();
  for (const want of memberWants(w, memberId)) for (const role of want.roles) {
    if (role.lane !== "Cofounder") roles.set(membershipId(memberId, role), role);
  }
  for (const f of mi.match) if (OFFER_KINDS.has(f.kind)) for (const role of offerRoles(f)) {
    if (role.lane !== "Cofounder") roles.set(membershipId(memberId, role), role);
  }
  if (networkCofounderIntentOf(w, memberId)) roles.set(membershipId(memberId, COFOUNDER_PEER), COFOUNDER_PEER);
  // A host or a member with interests is a Friend peer without a stated social want (the profile
  // builder still requires the social opt-in).
  if (mi.isHost || mi.match.some(f => INTEREST_KINDS.has(f.kind))) roles.set(membershipId(memberId, FRIEND), FRIEND);
  return [...roles].map(([id, { lane, side }]) => ({
    id, lane, side, market: mi.m.homeCity, capacity: laneLimits(lane).weeklyCapacity - mi.recentProactive,
  }));
}

function cofounderTags(w: World, id: MemberId): EntityTags {
  const intent = networkCofounderIntentOf(w, id)!;
  const want = intentWant(w, intent);
  const offers: string[] = [], seeks = want.seeks.filter(tag => !want.pools.includes(tag)), interests = [...want.interests];
  for (const f of w.get(id)?.match ?? []) {
    if ((f.app ?? "ntwrk") !== "ntwrk"
      || !standingFacetReadable(f.scope, f.provenance, f.confirmedByMember === true, f.sensitive !== undefined, f.inferred === true)) continue;
    const fields = plainTags(f.tags);
    if (OFFER_KINDS.has(f.kind)) offers.push(...fields);
    if (f.kind === "desire") seeks.push(...fields);
    if (f.kind === "interest") interests.push(...fields);
  }
  return { offers, seeks, interests };
}

function tags(w: World, entity: MatchEntity): EntityTags {
  if (entity.lane === "Cofounder") return cofounderTags(w, entity.memberId);
  const { offers, seeks, interests } = memberTags(w, entity.memberId);
  return { offers: [...offers], seeks: [...seeks], interests: [...interests] };
}

// spec/memberStanding.md, "Standing adds reviewed facts in full and unreviewed facts at half".
// Recognized fact tags ("<key>:<value>") and their standing points. Nothing here reads acceptance,
// replies, warm-graph degree or any other popularity count.
const ROLE_POINTS: ReadonlyMap<string, number> = new Map([["junior", 10], ["mid", 25], ["senior", 40], ["lead", 50], ["executive", 65], ["partner", 70]]);
const ROUND_POINTS: ReadonlyMap<string, number> = new Map([["pre_seed", 10], ["seed", 20], ["series_a", 35], ["series_b", 50], ["growth", 65]]);
const FUND_POINTS: ReadonlyMap<string, number> = new Map([["angel", 20], ["micro", 35], ["institutional", 55], ["large", 75]]);
const count = (value: string): number => (/^\d{1,6}$/.test(value) ? Number(value) : 0);
const STANDING_POINTS: ReadonlyMap<string, (value: string) => number> = new Map<string, (value: string) => number>([
  ["evidence", count],                                   // points a reviewer or the onboarding agent already scored
  ["role", value => ROLE_POINTS.get(value) ?? 0],        // role level
  ["years", value => 2 * Math.min(count(value), 20)],    // years of experience
  ["companies_built", value => 15 * Math.min(count(value), 3)],
  ["raised", value => ROUND_POINTS.get(value) ?? 0],     // largest round raised
  ["fund", value => FUND_POINTS.get(value) ?? 0],        // fund managed
  ["vouch", () => 10],                                   // a vouch from a member; counts only when reviewed
]);
/** A fact counts in full only when a source verified it or a member vouched for it. */
const isReviewed = (f: Facet): boolean => f.provenance === "vouched" || f.provenance === "connected_source";

function standing(w: World, entity: MatchEntity): EntityStanding {
  const evidence: StandingEvidence[] = [];
  const reviewedFacts = new Set<string>();
  for (const f of w.get(entity.memberId)?.match ?? []) {
    if (!STANDING_KINDS.has(f.kind) || (f.app ?? "ntwrk") !== w.pack.id || taggedRole(f.tags)?.lane !== entity.lane) continue;
    if (!standingFacetReadable(f.scope, f.provenance, f.confirmedByMember === true, f.sensitive !== undefined, f.inferred === true)) continue;
    const reviewed = isReviewed(f);
    for (const tag of f.tags.map(normal)) {
      const at = tag.indexOf(":");
      const key = at < 0 ? tag : tag.slice(0, at);
      if (key === "vouch" && !reviewed) continue;
      const points = STANDING_POINTS.get(key)?.(at < 0 ? "" : tag.slice(at + 1)) ?? 0;
      if (points <= 0) continue;
      evidence.push({ points, reviewed });
      if (reviewed) reviewedFacts.add(f.id);
    }
  }
  // spec/memberStanding.md, "A member with no reviewed facts gets the widest uncertainty": one fact per facet.
  return { standing: standingFromEvidence(evidence), uncertainty: standingUncertainty(reviewedFacts.size) };
}

export const networkVectors: PackVectors = { memberships, tags, standing };
