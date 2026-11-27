import type { Category, Facet, FacetKind, Intent, MemberId } from "@thenetwork/core";
import { cofounderIntentEligible } from "../../../../core/src/generated/cofounderDispatch.ts";
import { cofounderIntentObjective } from "../../../../core/src/generated/cofounderIntent.ts";
import { laneLimits, laneWeights, type LaneSide, type MatchLane } from "../../../../core/src/generated/matchLane.ts";
import { standingEvidencePoints, standingFacetReadable, standingFromEvidence, standingUncertainty, type StandingEvidence } from "../../../../core/src/generated/memberStanding.ts";
import { networkIntentRoute, type NetworkIntentRoute } from "../../../../core/src/generated/networkIntentLane.ts";
import { pairValueScale } from "../../../../core/src/generated/pairValue.ts";
import { standingIntentLive } from "../../../../core/src/standing-intent.ts";
import { isMinor } from "../../filters.ts";
import {
  discretionGateOk,
  humanVectorOf,
  memberMayHavePositiveVectorBonus,
  spendTierCompatible,
  spendTierRank,
  stepAheadDeltaOk,
  type HumanVector,
} from "../../humanVector.ts";
import type { EntityStanding, EntityTags, MatchEntity, MatchProfile, Membership, PackVectors, TagSet } from "../../match/profile.ts";
import type { World } from "../../world.ts";
import { cofounderFactsOf, cofounderFactTags } from "./cofounderFacts.ts";
import { parseOntologyTags } from "./ontology.ts";
import { detailProse, detailTags, objectivesFor } from "./taxonomy.ts";
import {
  ALL_INTERESTS,
  ALL_SKILLS,
  COMPLEMENTARY_ROLE_PAIRS,
  CONNECTION_ONTOLOGY_SPECS,
  type ConnectionOntologyType,
} from "./vocabulary.ts";

export const MATCH_LANES: readonly MatchLane[] = ["Friend", "Date", "Cofounder", "Intro", "Hire", "Mentor", "Invest"];
const SIDES: readonly LaneSide[] = ["Peer", "Offering", "Seeking"];

interface LaneRole { readonly lane: MatchLane; readonly side: LaneSide }
const INTRO: LaneRole = { lane: "Intro", side: "Peer" };
const FRIEND: LaneRole = { lane: "Friend", side: "Peer" };
const COFOUNDER_PEER: LaneRole = { lane: "Cofounder", side: "Peer" };

export interface Want {
  readonly roles: readonly LaneRole[];
  readonly seeks: readonly string[];
  readonly interests: readonly string[];
  readonly pools: readonly string[];
}
interface MemberTags { readonly offers: ReadonlySet<string>; readonly seeks: ReadonlySet<string>; readonly interests: ReadonlySet<string> }

const OFFER_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["skill", "offer", "resource"]);
const SEEK_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["desire", "goal"]);
const INTEREST_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["interest", "trait"]);
const STANDING_KINDS: ReadonlySet<FacetKind> = new Set<FacetKind>(["fact", "skill", "offer", "resource", "trait"]);

const PROFESSIONAL_CLUSTERS: ReadonlySet<string> = new Set(["tech", "science"]);
const PROFESSIONAL_INTERESTS: ReadonlySet<string> = new Set(ALL_INTERESTS.filter(i => PROFESSIONAL_CLUSTERS.has(i.cluster)).map(i => i.tag));
const PROFESSIONAL_SKILLS: ReadonlySet<string> = new Set(ALL_SKILLS.flatMap(s => (s.teaches !== undefined && PROFESSIONAL_INTERESTS.has(s.teaches) ? [s.tag] : [])));
const isProfessionalTag = (tag: string): boolean => PROFESSIONAL_INTERESTS.has(tag) || PROFESSIONAL_SKILLS.has(tag);

const INVEST_OFFERED = /\b(invest(ing)? in (startups?|companies|founders|early[- ]stage \w+)|angel invest\w*|(meet|find|looking for|seeking) (startups?|companies|founders) to invest in|back(ing)? (independent|research|early founders)|non[- ]dilutive patron)\b/i;
const INVEST_SOUGHT = /\b(fundrais\w*|rais(e|ing) (money|a round|capital|funds?|a seed)|seed round|(find|meet) investors?|research grant|patron(age)?|sponsor(ship)?)\b/i;
const COFOUNDER = /\b(find|get|meet|need|want|seek(ing)?|looking for) (a |another )?((potential|technical|business) )?co-?founders?\b/i;
const MENTOR_OFFERED = /\bmentor(ing)? (someone|people|others|founders|juniors?)\b/i;
const MENTOR_SOUGHT = /\b(find|get|need|want) (a )?mentor\b|\bmentorship\b|\badvice from\b|\bsomeone senior\b|\bstep[- ]ahead\b|\bone step ahead\b|\bcareer advice\b/i;
const INVESTOR_OFFER = /\b(investor|angel invest\w*|angel_patron|non_dilutive_patron|vc (fund|firm)|venture capital\w*|fund manager|general partner)\b/i;
const MENTOR_OFFER = /\bmentor\w*\b/i;

const normal = (tag: string): string => tag.trim().toLowerCase();
const plainTags = (tags: readonly string[]): string[] => tags.map(normal).filter(t => t.length > 0 && !t.includes(":"));
const tagValue = (tags: readonly string[], key: string): string | undefined =>
  tags.map(normal).find(t => t.startsWith(`${key}:`))?.slice(key.length + 1);

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

function connectionLaneRole(ct: ConnectionOntologyType, direction: "seeks" | "offers" | "mutual_pool"): LaneRole | undefined {
  switch (ct) {
    case "step_ahead_mentorship":
      return { lane: "Mentor", side: direction === "offers" ? "Offering" : "Seeking" };
    case "patronage_sponsorship":
      return { lane: "Invest", side: direction === "offers" ? "Offering" : "Seeking" };
    case "work_hiring":
    case "executive_peer_council":
      return INTRO;
    case "dating":
      return undefined;
    default:
      return FRIEND;
  }
}

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
  const professional = category === "professional" || (category === undefined && [...plainTags(tags), ...asked].some(isProfessionalTag));
  const route = networkIntentRoute(category !== "romance" && category !== "growth", specific, professional);
  return route === "NoRoute" ? [] : [INTENT_ROLES[route]];
}

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
  const dTags = detailTags(details);
  const roles = wantRoles(`${text} ${detailProse(details)}`, category, tags, [...needs, ...interests]);
  if (dTags.includes("step_ahead_peer") && !roles.some(r => r.lane === "Mentor")) {
    roles.push({ lane: "Mentor", side: "Seeking" });
  }
  return { roles, seeks: [...needs, ...pools], interests, pools };
}

interface RunCache {
  readonly intents: Map<string, Want>;
  readonly goals: Map<MemberId, ReadonlyMap<string, Want>>;
  readonly tags: Map<MemberId, MemberTags>;
  readonly friendTags: Map<MemberId, MemberTags>;
  readonly cofounderIntents: Map<MemberId, Intent | undefined>;
}
const caches = new WeakMap<World, RunCache>();
const cacheOf = (w: World): RunCache => {
  let cache = caches.get(w);
  if (!cache) { cache = { intents: new Map(), goals: new Map(), tags: new Map(), friendTags: new Map(), cofounderIntents: new Map() }; caches.set(w, cache); }
  return cache;
};

export function intentWant(w: World, intent: Intent): Want {
  const cache = cacheOf(w);
  let want = cache.intents.get(intent.id);
  if (!want) { want = wantOf(intent.objective, intent.details, intent.category, []); cache.intents.set(intent.id, want); }
  return want;
}

function goalWants(w: World, memberId: MemberId): ReadonlyMap<string, Want> {
  const cache = cacheOf(w);
  let wants = cache.goals.get(memberId);
  if (!wants) {
    wants = new Map((w.get(memberId)?.match ?? []).filter(f => f.kind === "goal")
      .map(f => [f.id, wantOf(f.value.replace(/^wants to /i, ""), undefined, undefined, f.tags)]));
    cache.goals.set(memberId, wants);
  }
  return wants;
}

const memberWants = (w: World, memberId: MemberId): readonly Want[] =>
  [...(w.get(memberId)?.intents ?? []).map(i => intentWant(w, i)), ...goalWants(w, memberId).values()];

export const wantHas = (want: Want, role: LaneRole): boolean => want.roles.some(r => r.lane === role.lane && r.side === role.side);

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

const COMPLEMENT_PARTNERS: ReadonlyMap<string, readonly string[]> = (() => {
  const map = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = map.get(a);
    if (list) { if (!list.includes(b)) list.push(b); } else map.set(a, [b]);
  };
  for (const pair of COMPLEMENTARY_ROLE_PAIRS) {
    link(pair.roleA, pair.roleB);
    link(pair.roleB, pair.roleA);
  }
  return map;
})();

export function memberTags(w: World, memberId: MemberId, lane?: MatchLane): MemberTags {
  const friend = lane === "Friend";
  const cache = cacheOf(w);
  const tagCache = friend ? cache.friendTags : cache.tags;
  const done = tagCache.get(memberId);
  if (done) return done;
  const offers = new Set<string>(), seeks = new Set<string>(), interests = new Set<string>();
  const add = (into: Set<string>, tags: readonly string[]) => { for (const t of tags) into.add(t); };
  const goals = friend ? goalWants(w, memberId) : undefined;
  const matchFacets = w.get(memberId)?.match ?? [];
  for (const f of matchFacets) {
    if (friend) {
      const tagged = taggedRole(f.tags);
      const goal = goals?.get(f.id);
      if ((tagged && tagged.lane !== lane) || (goal && !wantHas(goal, FRIEND))) continue;
    }
    if (OFFER_KINDS.has(f.kind)) add(offers, plainTags(f.tags));
    else if (SEEK_KINDS.has(f.kind)) add(seeks, plainTags(f.tags));
    else if (INTEREST_KINDS.has(f.kind)) add(interests, plainTags(f.tags));
  }
  const parsed = parseOntologyTags(matchFacets);
  for (const sc of parsed.statedConnections) {
    const role = connectionLaneRole(sc.connectionType, sc.direction);
    if (!role || (friend && role.lane !== "Friend")) continue;
    const domTag = `ont_${sc.domain}`;
    const roleTag = `ont_${sc.connectionType}_${sc.role}`;
    interests.add(domTag);
    if (sc.direction === "offers") {
      offers.add(roleTag);
      offers.add(sc.role);
      for (const comp of COMPLEMENT_PARTNERS.get(sc.role) ?? []) seeks.add(comp);
    } else if (sc.direction === "seeks") {
      seeks.add(roleTag);
      seeks.add(sc.role);
    } else {
      const poolTag = `ont_pool_${sc.connectionType}_${sc.domain}`;
      offers.add(poolTag);
      seeks.add(poolTag);
    }
  }
  for (const g of parsed.guilds) interests.add(`guild_${g}`);
  for (const lang of parsed.nativeLanguages) offers.add(`lang_${lang}`);
  for (const lang of parsed.learningLanguages) seeks.add(`lang_${lang}`);
  for (const want of memberWants(w, memberId)) {
    if (wantHas(want, COFOUNDER_PEER) || (friend && !wantHas(want, FRIEND))) continue;
    add(seeks, want.seeks); add(interests, want.interests); add(offers, want.pools);
  }
  const tags: MemberTags = { offers, seeks, interests };
  tagCache.set(memberId, tags);
  return tags;
}

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
  if (!isMinor(w, memberId)) {
    const parsed = parseOntologyTags(mi.match);
    for (const sc of parsed.statedConnections) {
      const role = connectionLaneRole(sc.connectionType, sc.direction);
      if (role && role.lane !== "Cofounder") roles.set(membershipId(memberId, role), role);
    }
  }
  if (networkCofounderIntentOf(w, memberId)) roles.set(membershipId(memberId, COFOUNDER_PEER), COFOUNDER_PEER);
  if (mi.isHost || mi.match.some(f => INTEREST_KINDS.has(f.kind))) roles.set(membershipId(memberId, FRIEND), FRIEND);
  return [...roles].map(([id, { lane, side }]) => ({
    id, lane, side, market: mi.m.homeCity, capacity: laneLimits(lane).weeklyCapacity - mi.recentProactive,
  }));
}

function cofounderTags(w: World, id: MemberId): EntityTags {
  const intent = networkCofounderIntentOf(w, id)!;
  const want = intentWant(w, intent);
  const facts = cofounderFactTags(cofounderFactsOf(w, id, "ntwrk"));
  const offers: string[] = [...facts.offers], seeks = [...want.seeks.filter(tag => !want.pools.includes(tag)), ...facts.seeks], interests = [...want.interests];
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
  const { offers, seeks, interests } = memberTags(w, entity.memberId, entity.lane);
  return { offers: [...offers], seeks: [...seeks], interests: [...interests] };
}

const ROLE_POINTS: ReadonlyMap<string, number> = new Map([["junior", 10], ["mid", 25], ["senior", 40], ["lead", 50], ["executive", 65], ["partner", 70]]);
const ROUND_POINTS: ReadonlyMap<string, number> = new Map([["pre_seed", 10], ["seed", 20], ["series_a", 35], ["series_b", 50], ["growth", 65]]);
const FUND_POINTS: ReadonlyMap<string, number> = new Map([["angel", 20], ["micro", 35], ["institutional", 55], ["large", 75]]);
const RUNG_BAND_POINTS: ReadonlyMap<string, number> = new Map([["emerging", 20], ["practitioner", 45], ["seniorcraft", 70], ["senior_craft", 70], ["principalmaster", 92], ["principal_master", 92]]);
const count = (value: string): number => (/^\d{1,6}$/.test(value) ? Number(value) : 0);
const STANDING_POINTS: ReadonlyMap<string, (value: string) => number> = new Map<string, (value: string) => number>([
  ["evidence", count],
  ["role", value => ROLE_POINTS.get(value) ?? 0],
  ["years", value => 2 * Math.min(count(value), 20)],
  ["companies_built", value => 15 * Math.min(count(value), 3)],
  ["raised", value => ROUND_POINTS.get(value) ?? 0],
  ["fund", value => FUND_POINTS.get(value) ?? 0],
  ["vouch", () => 10],
]);
const isReviewed = (f: Facet): boolean => f.provenance === "vouched" || f.provenance === "connected_source";

function standing(w: World, entity: MatchEntity): EntityStanding {
  const evidence: StandingEvidence[] = [];
  const evidenceIds = new Set<string>();
  const reviewedFacts = new Set<string>();
  const minor = isMinor(w, entity.memberId);
  for (const f of w.get(entity.memberId)?.match ?? []) {
    if (!STANDING_KINDS.has(f.kind) || (f.app ?? "ntwrk") !== w.pack.id) continue;
    const laneTag = taggedRole(f.tags)?.lane;
    const hasHvRung = !minor && f.tags.some(t => normal(t).startsWith("hv:rung:"));
    if (laneTag !== entity.lane && !(hasHvRung && (entity.lane === "Intro" || entity.lane === "Mentor" || entity.lane === "Invest"))) continue;
    if (!standingFacetReadable(f.scope, f.provenance, f.confirmedByMember === true, f.sensitive !== undefined, f.inferred === true)) continue;
    const reviewed = isReviewed(f);
    for (const tag of f.tags.map(normal)) {
      if (tag.startsWith("hv:rung:")) {
        const parts = tag.slice(8).split(":");
        const pts = RUNG_BAND_POINTS.get(parts[1] ?? "") ?? 0;
        if (pts <= 0) continue;
        evidence.push({ points: pts, reviewed });
        if (standingEvidencePoints({ points: pts, reviewed }) > 0) evidenceIds.add(f.id);
        if (reviewed) reviewedFacts.add(f.id);
        continue;
      }
      if (laneTag !== entity.lane) continue;
      const at = tag.indexOf(":");
      const key = at < 0 ? tag : tag.slice(0, at);
      if (key === "vouch" && !reviewed) continue;
      const points = STANDING_POINTS.get(key)?.(at < 0 ? "" : tag.slice(at + 1)) ?? 0;
      if (points <= 0) continue;
      evidence.push({ points, reviewed });
      if (standingEvidencePoints({ points, reviewed }) > 0) evidenceIds.add(f.id);
      if (reviewed) reviewedFacts.add(f.id);
    }
  }
  return { standing: standingFromEvidence(evidence), uncertainty: standingUncertainty(reviewedFacts.size), evidenceIds: [...evidenceIds] };
}

function sharesGuildContainer(va: HumanVector, vb: HumanVector): boolean {
  if (va.exchange.guilds.length > 0 && vb.exchange.guilds.some(g => va.exchange.guilds.includes(g))) return true;
  return va.exchange.slots.some(sa =>
    CONNECTION_ONTOLOGY_SPECS[sa.connectionType].chettyMixedSesContainer
    && vb.exchange.slots.some(sb => sb.connectionType === sa.connectionType && sb.domain === sa.domain));
}

function topRungOf(v: HumanVector): number {
  let best = 0;
  for (const c of Object.values(v.capital.domainRungs)) if (c.value > best) best = c.value;
  return best;
}

function sharedDomainRungPair(seeker: HumanVector, mentor: HumanVector): [number, number] | undefined {
  for (const [dom, sCoord] of Object.entries(seeker.capital.domainRungs)) {
    const mCoord = mentor.capital.domainRungs[dom];
    if (mCoord) return [sCoord.value, mCoord.value];
  }
  const sr = topRungOf(seeker);
  const mr = topRungOf(mentor);
  return sr > 0 && mr > 0 ? [sr, mr] : undefined;
}

function clampScale(v: number): number {
  return Math.max(0, Math.min(pairValueScale, Math.round(v)));
}

function intersectCount(a: TagSet, b: TagSet): number {
  let i = 0, j = 0, count = 0;
  while (i < a.length && j < b.length) {
    const x = a[i]!, y = b[j]!;
    if (x === y) { count++; i++; j++; } else if (x < y) i++; else j++;
  }
  return count;
}

function baseDirectedUtility(a: MatchProfile, b: MatchProfile): number {
  const weights = laneWeights(a.lane);
  const comp = a.seeks.length > 0 ? Math.floor((pairValueScale * intersectCount(a.seeks, b.offers)) / a.seeks.length) : 0;
  const aff = a.interests.length > 0 ? Math.floor((pairValueScale * intersectCount(a.interests, b.interests)) / a.interests.length) : 0;
  const wSum = weights.complement + weights.affinity;
  return wSum > 0 ? Math.floor((weights.complement * comp + weights.affinity * aff) / wSum) : 0;
}

function packValue(w: World, a: MatchProfile, b: MatchProfile): number {
  const base = baseDirectedUtility(a, b);
  if (isMinor(w, a.memberId) || isMinor(w, b.memberId)) return base;
  const va = humanVectorOf(w, a.memberId);
  const vb = humanVectorOf(w, b.memberId);
  if (!va || !vb) return base;

  const ea = va.explicitSignals;
  const eb = vb.explicitSignals;
  const sharedGuild = sharesGuildContainer(va, vb);
  const needsDiscretionCheck = ea.hypeOrExtraction || eb.hypeOrExtraction
    || va.capital.economic.value >= 0.9 || vb.capital.economic.value >= 0.9
    || va.capital.symbolic.publicityTier.value >= 0.65 || vb.capital.symbolic.publicityTier.value >= 0.65;
  if (needsDiscretionCheck) {
    const discAB = discretionGateOk(
      vb.capital.symbolic.publicityTier.value * 100,
      vb.capital.economic.value * 100,
      va.behavioral.discretionVouchScore * 100,
      va.behavioral.extractionRiskScore * 100,
      sharedGuild,
    );
    const discBA = discretionGateOk(
      va.capital.symbolic.publicityTier.value * 100,
      va.capital.economic.value * 100,
      vb.behavioral.discretionVouchScore * 100,
      vb.behavioral.extractionRiskScore * 100,
      sharedGuild,
    );
    if (!discAB || !discBA) return 0;
  }

  let delta = 0;

  if (a.lane === "Mentor" && (ea.domainRungs || eb.domainRungs)) {
    const seeker = a.side === "Seeking" ? va : vb;
    const mentor = a.side === "Seeking" ? vb : va;
    const rungs = sharedDomainRungPair(seeker, mentor);
    if (rungs) {
      const [sr, mr] = rungs;
      if (mr - sr > 4.0) return 0;
      if (stepAheadDeltaOk(sr, mr, 0.75, 2.75)) delta += 320;
      else if (mr <= sr) delta -= 180;
    }
  }

  if (ea.spendTier || eb.spendTier) {
    const tierA = va.horizontal.lifestyle.spendComfortTier;
    const tierB = vb.horizontal.lifestyle.spendComfortTier;
    const tierDiff = Math.abs(spendTierRank(tierA) - spendTierRank(tierB));
    const freeAnchor = sharedGuild || a.lane === "Mentor" || a.lane === "Intro";
    if (!spendTierCompatible(tierA, tierB, freeAnchor)) {
      return 0;
    }
    if (sharedGuild && tierDiff >= 2) {
      delta += 240;
    } else if (ea.spendTier && eb.spendTier && tierDiff === 0) {
      delta += 80;
    }
  }

  if (ea.lifeStage && eb.lifeStage && va.horizontal.lifeStage === vb.horizontal.lifeStage) delta += 110;
  if (ea.depth && eb.depth) {
    const depthDiff = Math.abs(va.horizontal.communication.depthPreference.value - vb.horizontal.communication.depthPreference.value);
    delta += Math.round(120 * (1 - depthDiff));
  }
  if (ea.humor && eb.humor && va.horizontal.communication.humorRegister.some(h => vb.horizontal.communication.humorRegister.includes(h))) delta += 100;
  if (ea.transitions && eb.transitions && va.horizontal.activeTransitions.some(t => vb.horizontal.activeTransitions.includes(t))) delta += 120;
  if (ea.languages && eb.languages) {
    const langSwap =
      va.exchange.nativeLanguages.some(l => vb.exchange.learningLanguages.includes(l))
      && vb.exchange.nativeLanguages.some(l => va.exchange.learningLanguages.includes(l));
    if (langSwap) delta += 280;
  }
  if (ea.reliabilityPenalty || eb.reliabilityPenalty) {
    const minShow = Math.min(va.behavioral.showUpRate, vb.behavioral.showUpRate);
    if (minShow < 0.75) delta -= Math.round(280 * (0.75 - minShow));
  }
  if (ea.hypeOrExtraction || eb.hypeOrExtraction) {
    const maxExt = Math.max(va.behavioral.extractionRiskScore, vb.behavioral.extractionRiskScore);
    if (maxExt > 0.3) delta -= Math.round(450 * (maxExt - 0.3));
  }

  return clampScale(base + delta);
}

function networkPackBound(w: World, a: MatchProfile, b: MatchProfile): number {
  const base = baseDirectedUtility(a, b);
  if ((a.packClass ?? 0) === 0 && (b.packClass ?? 0) === 0) return base;
  if (isMinor(w, a.memberId) || isMinor(w, b.memberId)) return base;
  const va = humanVectorOf(w, a.memberId);
  const vb = humanVectorOf(w, b.memberId);
  if (!va || !vb) return base;
  const ea = va.explicitSignals;
  const eb = vb.explicitSignals;
  let bonus = 0;
  if (a.lane === "Mentor" && (ea.domainRungs || eb.domainRungs)) bonus += 320;
  if (ea.spendTier || eb.spendTier) bonus += 240;
  if (ea.lifeStage && eb.lifeStage) bonus += 110;
  if (ea.depth && eb.depth) bonus += 120;
  if (ea.humor && eb.humor) bonus += 100;
  if (ea.transitions && eb.transitions) bonus += 120;
  if (ea.languages && eb.languages) bonus += 280;
  return bonus === 0 ? base : clampScale(base + bonus);
}

function networkPackClass(w: World, entity: MatchEntity): number {
  return memberMayHavePositiveVectorBonus(w, entity.memberId, true) ? 1 : 0;
}

function networkPackClassCap(w: World, a: MatchProfile, partnerClass: number, untouched: boolean): number {
  if (!untouched) return pairValueScale;
  if ((a.packClass ?? 0) === 0 && partnerClass === 0) return 0;
  if (isMinor(w, a.memberId)) return 0;
  const va = humanVectorOf(w, a.memberId);
  if (!va) return 0;
  const ea = va.explicitSignals;
  if (partnerClass === 0) {
    let bonus = 0;
    if (a.lane === "Mentor" && ea.domainRungs) bonus += 320;
    if (ea.spendTier) bonus += 240;
    return clampScale(bonus);
  }
  let bonus = 240;
  if (a.lane === "Mentor") bonus += 320;
  if (ea.lifeStage) bonus += 110;
  if (ea.depth) bonus += 120;
  if (ea.humor) bonus += 100;
  if (ea.transitions) bonus += 120;
  if (ea.languages) bonus += 280;
  return clampScale(bonus);
}

export const networkVectors: PackVectors = {
  memberships,
  tags,
  standing,
  packValue,
  packBound: networkPackBound,
  packClasses: { of: networkPackClass, cap: networkPackClassCap },
};
