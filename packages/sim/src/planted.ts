// Planted-structure worlds for matching validation (docs/results/2026-11-16-matching-backend-gap-analysis.md,
// "Validation plan"). The generator plants hidden circles, a hidden standing per lane, and offers
// and seeks, then shows the engine only the facets a real member would have. The hidden truth stays
// in packages/sim: network code never reads it (AGENTS.md, "Code invariants").
//
// Model (a stochastic block model on member-topic affiliations):
//   - Eligible members (adults) of one market are cut into circles of 3 to 6. A share stays outside
//     every circle. Each circle has a few topics; each member draws an interest from the circle's
//     topics with probability `purity`, else from the whole vocabulary (p_in >> p_out).
//   - Each circle has a base standing 0..100 per lane; members spread around it by `standingSpread`.
//   - Offers and seeks rotate over a circle skill pool, so exchange inside a circle is balanced.
//     Levels follow standing, so exchange across a standing gap is lopsided (the higher side gets less).
//   - Directed utility = interest fit and exchange received, plus a same-circle bonus, minus a
//     standing-gap penalty. A pair is judged by its worse side.
// Seeded and deterministic (Rng forks only). Work is linear in members: no step compares all pairs.
import type { AppId, Category, City, Facet, Intent, Member, MemberId, Presence } from "@thenetwork/core";
import { DAY, Rng, canBeMatched, hash32 } from "@thenetwork/core";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { NEIGHBORHOODS as FRIENDS_NEIGHBORHOODS } from "@thenetwork/engine/src/packs/friends/geo.ts";
import { FRIENDS_ACTIVITY_TAGS } from "@thenetwork/engine/src/packs/friends/vectors.ts";
import { appearanceFacet } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { laneOffered } from "../../core/src/generated/matchLane.ts";
import { FIRST_NAMES, NEIGHBORHOODS } from "./taxonomy.ts";
import { plantedPeonHire } from "./planted-peon.ts";

// ------------------------------------------------------------------------------------------------
// Latent layer (shared with the persona generators' opt-in `planted` option)

export interface PlantedSpec {
  /** Overrides the generator seed for the latent layer. */
  seed?: number | string;
  /** Inclusive circle size range (default [3, 6]). */
  circleSize?: readonly [number, number];
  /** Topics per circle (default 4). */
  topicsPerCircle?: number;
  /** Inclusive interest count per member (default [3, 5]). */
  interestsPerMember?: readonly [number, number];
  /** P(an interest comes from the member's circle topics) (default 0.8). */
  purity?: number;
  /** Share of eligible members outside every circle (default 0.1). */
  unplantedShare?: number;
  /** Standard deviation of standing around the circle base (default 4). */
  standingSpread?: number;
  /** Standing dimensions per member (default 1; plantedEngineInput uses one per lane). */
  dimensions?: number;
}

export const PLANTED_DEFAULTS = {
  circleSize: [3, 6] as const, topicsPerCircle: 4, interestsPerMember: [3, 5] as const,
  purity: 0.8, unplantedShare: 0.1, standingSpread: 4, dimensions: 1,
};

/** One member as the latent layer sees it. Only eligible members join circles. */
export interface PlantedSeat { id: MemberId; market: string; eligible: boolean }
/** Hidden truth for one member: circle (-1 = none), standing per dimension (0..100), interest topics. */
export interface PlantedMark { circle: number; standing: readonly number[]; topics: readonly string[] }
export interface PlantedLatent { circles: readonly (readonly MemberId[])[]; marks: ReadonlyMap<MemberId, PlantedMark> }

const STANDING_MAX = 100;
const clampInt = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(x)));
const clampStanding = (x: number) => clampInt(x, 0, STANDING_MAX);

function plantedSpec(spec: PlantedSpec): Required<Omit<PlantedSpec, "seed">> {
  const p = {
    circleSize: spec.circleSize ?? PLANTED_DEFAULTS.circleSize,
    topicsPerCircle: spec.topicsPerCircle ?? PLANTED_DEFAULTS.topicsPerCircle,
    interestsPerMember: spec.interestsPerMember ?? PLANTED_DEFAULTS.interestsPerMember,
    purity: spec.purity ?? PLANTED_DEFAULTS.purity,
    unplantedShare: spec.unplantedShare ?? PLANTED_DEFAULTS.unplantedShare,
    standingSpread: spec.standingSpread ?? PLANTED_DEFAULTS.standingSpread,
    dimensions: spec.dimensions ?? PLANTED_DEFAULTS.dimensions,
  };
  const [lo, hi] = p.circleSize, [ilo, ihi] = p.interestsPerMember;
  if (!(Number.isInteger(lo) && Number.isInteger(hi) && lo >= 2 && hi >= lo)) throw new RangeError(`planted: circleSize ${lo}..${hi}`);
  if (!(Number.isInteger(ilo) && Number.isInteger(ihi) && ilo >= 1 && ihi >= ilo)) throw new RangeError(`planted: interestsPerMember ${ilo}..${ihi}`);
  if (!(Number.isInteger(p.topicsPerCircle) && p.topicsPerCircle >= 1)) throw new RangeError(`planted: topicsPerCircle ${p.topicsPerCircle}`);
  if (!(Number.isInteger(p.dimensions) && p.dimensions >= 1)) throw new RangeError(`planted: dimensions ${p.dimensions}`);
  if (!(p.purity >= 0 && p.purity <= 1 && p.unplantedShare >= 0 && p.unplantedShare <= 1 && p.standingSpread >= 0)) throw new RangeError("planted: purity, unplantedShare or standingSpread out of range");
  return p;
}

/** A uniform index in [0, size) not in `taken`. Caller keeps taken.size < size. */
function freshIndex(r: Rng, size: number, taken: ReadonlySet<number>): number {
  for (;;) { const k = r.int(0, size - 1); if (!taken.has(k)) return k; }
}
function distinctIndices(r: Rng, count: number, size: number): number[] {
  const taken = new Set<number>();
  while (taken.size < Math.min(count, size)) taken.add(freshIndex(r, size, taken));
  return [...taken];
}

/**
 * Plant circles, standing and interests over `seats` (circles stay inside one market). Interests
 * are names from `vocabulary`. Deterministic in (spec, seats order, vocabulary, seed).
 */
export function plantLatent(spec: PlantedSpec, seats: readonly PlantedSeat[], vocabulary: readonly string[], seed: number | string): PlantedLatent {
  const p = plantedSpec(spec);
  if (!vocabulary.length) throw new RangeError("planted: empty vocabulary");
  const root = new Rng(hash32("planted", spec.seed ?? seed));
  const byMarket = new Map<string, MemberId[]>();
  for (const s of seats) if (s.eligible) { const l = byMarket.get(s.market); if (l) l.push(s.id); else byMarket.set(s.market, [s.id]); }
  const circles: MemberId[][] = [];
  const circleOf = new Map<MemberId, number>();
  const [lo, hi] = p.circleSize;
  for (const [market, ids] of byMarket) {
    const r = root.fork("circles", market);
    const order = r.shuffle(ids);
    let k = Math.round(order.length * p.unplantedShare);
    while (order.length - k >= lo) {
      const members = order.slice(k, k + Math.min(r.int(lo, hi), order.length - k));
      k += members.length;
      for (const id of members) circleOf.set(id, circles.length);
      circles.push(members);
    }
  }
  const V = vocabulary.length;
  const circleTopics = circles.map((_, c) => distinctIndices(root.fork("topics", c), p.topicsPerCircle, V));
  const circleBase = circles.map((_, c) => { const r = root.fork("base", c); return Array.from({ length: p.dimensions }, () => r.int(0, STANDING_MAX)); });
  const [ilo, ihi] = p.interestsPerMember;
  const marks = new Map<MemberId, PlantedMark>();
  for (const s of seats) {
    const r = root.fork("seat", s.id);
    const circle = circleOf.get(s.id) ?? -1;
    const base = circle >= 0 ? circleBase[circle]! : undefined;
    const standing = Array.from({ length: p.dimensions }, (_, d) => base ? clampStanding(r.normal(base[d]!, p.standingSpread)) : r.int(0, STANDING_MAX));
    const own = circle >= 0 ? circleTopics[circle]! : [];
    const taken = new Set<number>();
    const count = Math.min(V, r.int(ilo, ihi));
    while (taken.size < count) {
      const left = own.filter(t => !taken.has(t));
      taken.add(left.length && r.bool(p.purity) ? r.pick(left) : freshIndex(r, V, taken));
    }
    marks.set(s.id, { circle, standing, topics: [...taken].sort((a, b) => a - b).map(t => vocabulary[t]!) });
  }
  return { circles, marks };
}

// ------------------------------------------------------------------------------------------------
// Engine-only planted world

/** Relationship lanes (spec/matchLane.md names). Hire, Mentor and Invest are two-sided. */
export const PLANTED_LANES = ["Friend", "Date", "Cofounder", "Intro", "Hire", "Mentor", "Invest"] as const;
export type PlantedLane = (typeof PLANTED_LANES)[number];
export type PlantedSide = "Peer" | "Offering" | "Seeking";
export type PlantedCity = Exclude<City, "la">;
const TWO_SIDED: ReadonlySet<PlantedLane> = new Set<PlantedLane>(["Hire", "Mentor", "Invest"]);
const APP_OF_LANE: Record<PlantedLane, AppId> = { Friend: "friends", Date: "slop", Cofounder: "peon", Hire: "peon", Intro: "ntwrk", Mentor: "ntwrk", Invest: "ntwrk" };
const LANE_CATEGORY: Record<PlantedLane, Category> = { Friend: "social", Date: "romance", Cofounder: "professional", Intro: "professional", Hire: "professional", Mentor: "professional", Invest: "professional" };
const FRIENDS_TOPICS = [...FRIENDS_ACTIVITY_TAGS].sort();
const DATING_ZIP: Record<PlantedCity, string> = { nyc: "10001", sf: "94103" };
const LANE_OBJECTIVE: Record<PlantedLane, Record<PlantedSide, string>> = {
  Friend: { Peer: "meet a few new friends who share my interests", Offering: "", Seeking: "" },
  Date: { Peer: "meet someone to date", Offering: "", Seeking: "" },
  Cofounder: { Peer: "find a cofounder", Offering: "", Seeking: "" },
  Intro: { Peer: "meet people who work on what I work on", Offering: "", Seeking: "" },
  Hire: { Peer: "", Offering: "hire for an open role", Seeking: "find a new job" },
  Mentor: { Peer: "", Offering: "mentor someone earlier in their career", Seeking: "find a mentor" },
  Invest: { Peer: "", Offering: "meet founders to invest in", Seeking: "raise money for my company" },
};
/** Observation noise of standing evidence by reviewed item count (0 = newcomer). */
const OBSERVATION_SD = [10, 6, 4, 3] as const;
/** Sim epoch (world.ts DEFAULT_START is 2026-10-05; the engine testkit uses 16:00 UTC). */
export const PLANTED_EPOCH = Date.UTC(2026, 9, 5, 16);

export interface PlantedUtilityParams {
  interestWeight: number; exchangeWeight: number;
  /** Added to a directed utility when both members share a planted circle (permille). */
  sameCircleBonus: number;
  /** Standing gap (after the lane offset) that costs nothing, and the cost per point above it. */
  freeGap: number; gapPenaltyPerPoint: number;
}
export const PLANTED_UTILITY: PlantedUtilityParams = { interestWeight: 1, exchangeWeight: 1, sameCircleBonus: 200, freeGap: 5, gapPenaltyPerPoint: 10 };

export interface PlantedWorldOptions extends Omit<PlantedSpec, "seed" | "dimensions"> {
  seed: number | string;
  /** Members (50 to 100,000 in the gates; any n >= 1 works). */
  n: number;
  /** Lanes every member joins (default ["Friend"]). */
  lanes?: readonly PlantedLane[];
  cities?: readonly PlantedCity[];
  /** App every membership belongs to (default: each lane's own app; it must offer every lane). */
  app?: AppId;
  /** Share of members aged 13-17 (default 0.02). They join circles never. */
  minorShare?: number;
  /** Share of a two-sided lane on the Offering side (default 0.5). */
  offeringShare?: number;
  /** Intended standing offset of Offering above Seeking per lane (default Mentor 25, others 0). */
  laneOffset?: Partial<Record<PlantedLane, number>>;
  /** Share of members with no reviewed evidence, joined in the last 14 days (default 0.15). */
  newcomerShare?: number;
  utility?: Partial<PlantedUtilityParams>;
  now?: number;
}

export interface PlantedSkill { skill: string; level: number }
export interface PlantedMembership {
  side: PlantedSide;
  /** Hidden standing 0..100. */
  standing: number;
  /** The standing the evidence facets imply (noisy; never shown to members). */
  observed: number;
  /** Reviewed evidence items (0 = newcomer). */
  reviewed: number;
}
export interface PlantedMember {
  id: MemberId; ordinal: number; market: PlantedCity; adult: boolean;
  /** Planted circle index, -1 when none. */
  circle: number;
  topics: readonly string[]; offers: readonly PlantedSkill[]; seeks: readonly PlantedSkill[];
  lanes: Partial<Record<PlantedLane, PlantedMembership>>;
}
export interface PlantedTruth {
  lanes: readonly PlantedLane[];
  laneOffset: Readonly<Record<PlantedLane, number>>;
  utility: PlantedUtilityParams;
  members: readonly PlantedMember[];
  ordinalOf: ReadonlyMap<MemberId, number>;
  circles: readonly (readonly MemberId[])[];
}

/** Skill level 1..5 from standing 0..100. */
export const plantedLevel = (standing: number) => 1 + Math.floor((clampStanding(standing) * 5) / (STANDING_MAX + 1));
const names = (prefix: string, count: number) => {
  const width = String(count - 1).length;
  return Array.from({ length: count }, (_, k) => `${prefix}-${String(k).padStart(width, "0")}`);
};

/**
 * A planted EngineInput snapshot and its hidden truth. The snapshot carries only facets a real
 * member would have: interests, offers, seeks, lane goals and evidence opted into matching.
 *
 * Facet conventions (the engine's lane extraction reads these):
 *   goal   tags [`lane:<Lane>`, `side:<Side>`]                       scope matchable
 *   offer  tags [`<skill>`, `level:<1..5>`]                           scope shareable
 *   desire tags [`<skill>`, `level:<1..5>`]                           scope matchable
 *   fact   tags [`lane:<Lane>`, `evidence:<points>`, `reviewed`|`unreviewed`]  scope matchable
 * Evidence points sum to the observed standing, with unreviewed points counted at 50%
 * (spec/memberStanding.md `standingFromEvidence`).
 */
export function plantedEngineInput(o: PlantedWorldOptions): { input: EngineInput; truth: PlantedTruth } {
  if (!(Number.isInteger(o.n) && o.n >= 1)) throw new RangeError(`planted: n ${o.n}`);
  const lanes = o.lanes ?? ["Friend"];
  if (!lanes.length || new Set(lanes).size !== lanes.length) throw new RangeError("planted: lanes must be non-empty and distinct");
  const cities = o.cities ?? ["nyc"];
  if (!cities.length) throw new RangeError("planted: no cities");
  // spec/matchLane.md, "laneOffered": the engine drops a membership whose app does not offer its lane.
  const appOf = (lane: PlantedLane): AppId => o.app ?? APP_OF_LANE[lane];
  for (const lane of lanes)
    if (!laneOffered(appOf(lane), lane)) throw new RangeError(`planted: app ${appOf(lane)} does not offer lane ${lane}`);
  const apps = [...new Set(lanes.map(appOf))];
  const app = apps[0]!;
  const now = o.now ?? PLANTED_EPOCH;
  const minorShare = o.minorShare ?? 0.02, offeringShare = o.offeringShare ?? 0.5, newcomerShare = o.newcomerShare ?? 0.15;
  const utility = { ...PLANTED_UTILITY, ...o.utility };
  if (utility.interestWeight < 0 || utility.exchangeWeight < 0 || utility.interestWeight + utility.exchangeWeight <= 0) throw new RangeError("planted: utility weights");
  const laneOffset = Object.fromEntries(PLANTED_LANES.map(l => [l, o.laneOffset?.[l] ?? (l === "Mentor" ? 25 : 0)])) as Record<PlantedLane, number>;
  const purity = o.purity ?? PLANTED_DEFAULTS.purity;
  const root = new Rng(hash32("planted-world", o.seed));

  // Seats: id, market, age. Minors never join a circle.
  const width = Math.max(4, String(o.n - 1).length);
  const seats: (PlantedSeat & { market: PlantedCity; age: number })[] = [];
  for (let i = 0; i < o.n; i++) {
    const r = root.fork("seat", i);
    const market = cities.length === 1 ? cities[0]! : r.pick(cities);
    const age = r.bool(minorShare) ? r.int(13, 17) : clampInt(r.normal(33, 8), 18, 70);
    seats.push({ id: `p${String(i).padStart(width, "0")}`, market, age, eligible: canBeMatched(age) });
  }
  const topicsPerCircle = o.topicsPerCircle ?? PLANTED_DEFAULTS.topicsPerCircle;
  // About two topics per circle in the vocabulary: circles rarely share a topic set.
  const vocabSize = Math.max(48, Math.ceil((o.n * topicsPerCircle) / 9));
  const latent = plantLatent({ ...o, seed: o.seed, dimensions: lanes.length }, seats, names("topic", vocabSize), o.seed);

  // Offers and seeks: position j in a circle offers pool[j], pool[j+1] and seeks pool[j+2], pool[j+3].
  const skills = names("skill", vocabSize);
  const planned = new Map<MemberId, { offers: number[]; seeks: number[] }>();
  latent.circles.forEach((ids, c) => {
    const pool = distinctIndices(root.fork("skills", c), Math.max(4, ids.length), vocabSize);
    const at = (k: number) => pool[k % pool.length]!;
    ids.forEach((id, j) => planned.set(id, { offers: [at(j), at(j + 1)], seeks: [at(j + 2), at(j + 3)] }));
  });
  const marketOf = new Map(seats.map(s => [s.id, s.market]));
  const circleArea = latent.circles.map((ids, c) => root.fork("area", c).pick(NEIGHBORHOODS[marketOf.get(ids[0]!)!]));

  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [];
  const truthMembers: PlantedMember[] = [];
  const ordinalOf = new Map<MemberId, number>();
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i]!, id = seat.id, adult = seat.eligible;
    const r = root.fork("member", i);
    const mark = latent.marks.get(id)!;
    const newcomer = r.bool(newcomerShare);
    const memberships: Partial<Record<PlantedLane, PlantedMembership>> = {};
    lanes.forEach((lane, d) => {
      if (lane === "Date" && !adult) return; // dating is adults only; minors never hold a Date membership
      const side: PlantedSide = TWO_SIDED.has(lane) ? (r.bool(offeringShare) ? "Offering" : "Seeking") : "Peer";
      const off = laneOffset[lane], up = Math.ceil(off / 2);
      const standing = clampStanding(mark.standing[d]! + (side === "Offering" ? up : side === "Seeking" ? up - off : 0));
      const reviewed = newcomer ? 0 : r.int(1, 3);
      const observed = clampStanding(r.normal(standing, OBSERVATION_SD[reviewed]!));
      memberships[lane] = { side, standing, observed, reviewed };
    });
    // Noise: each planned tag is replaced by a random skill with P = 1 - purity; unplanted members draw all four.
    const plan = planned.get(id);
    const taken = new Set<number>();
    const pickSkill = (plannedSkill: number | undefined) => {
      const k = plannedSkill !== undefined && !taken.has(plannedSkill) && r.bool(purity) ? plannedSkill : freshIndex(r, vocabSize, taken);
      taken.add(k);
      return k;
    };
    // Latent standing without any lane offset or side: one skill level for every lane.
    const level = plantedLevel(mark.standing[0]!);
    const offerIdx = [pickSkill(plan?.offers[0]), pickSkill(plan?.offers[1])];
    const seekIdx = [pickSkill(plan?.seeks[0]), pickSkill(plan?.seeks[1])];
    const offers = offerIdx.map(k => ({ skill: skills[k]!, level }));
    const seeks = seekIdx.map(k => ({ skill: skills[k]!, level }));

    const area = mark.circle >= 0 && r.bool(0.7) ? circleArea[mark.circle]! : r.pick(NEIGHBORHOODS[seat.market]);
    const joinedAt = now - (newcomer ? r.int(0, 13) : r.int(14, 400)) * DAY;
    const categories = [...new Set(lanes.map(l => LANE_CATEGORY[l]))].filter(c => adult || c !== "romance");
    // Some cohorts are actively seeking an introduction this week. Keep the other cohorts on normal participation.
    const activeSearch = adult && mark.circle >= 0 && hash32("planted-open", o.seed, mark.circle) % 3 === 0
      && lanes.some(lane => lane === "Cofounder" || lane === "Invest");
    members.push({
      id, name: `${r.pick(FIRST_NAMES)} ${i}`, homeCity: seat.market, state: activeSearch ? "open" : "normal",
      prefs: {
        categoriesOptIn: categories, quietHours: [22, 8], romanceOptIn: adult && lanes.includes("Date"),
        formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false,
      },
      joinedAt, age: seat.age, unansweredProactive: 0, apps: [...apps],
    });
    const friendsArea = FRIENDS_NEIGHBORHOODS[hash32("friends-home", mark.circle < 0 ? id : mark.circle) % FRIENDS_NEIGHBORHOODS.length]!.id;
    presence.push({ memberId: id, city: seat.market, type: "home", areas: [app === "friends" ? friendsArea : area] });
    let f = 0;
    const add = (kind: Facet["kind"], value: string, tags: string[], scope: Facet["scope"], provenance: Facet["provenance"] = "said", facetApp: AppId = app) =>
      facets.push({ id: `${id}-f${f++}`, memberId: id, kind, value, tags, scope, provenance, confidence: 0.9, app: facetApp });
    add("interest", `into ${mark.topics.join(", ")}`, [...mark.topics], "shareable");
    for (const s of offers) add("offer", `can help with ${s.skill}`, [s.skill, `level:${s.level}`], "shareable");
    for (const s of seeks) add("desire", `looking for help with ${s.skill}`, [s.skill, `level:${s.level}`], "matchable");
    const plantedMember: PlantedMember = { id, ordinal: i, market: seat.market, adult, circle: mark.circle, topics: mark.topics, offers, seeks, lanes: memberships };
    for (const lane of lanes) {
      const m = memberships[lane];
      if (!m) continue;
      add("goal", LANE_OBJECTIVE[lane][m.side], [`lane:${lane}`, `side:${m.side}`], "matchable", "said", appOf(lane));
      for (const e of evidenceItems(m.observed, m.reviewed))
        add("fact", "track record", [`lane:${lane}`, `evidence:${e.points}`, e.reviewed ? "reviewed" : "unreviewed"], "matchable", e.reviewed ? "vouched" : "said", appOf(lane));
      const intent: Intent = { id: `${id}-i-${lane}`, memberId: id, app: appOf(lane), objective: LANE_OBJECTIVE[lane][m.side],
        category: LANE_CATEGORY[lane], horizonDays: 60, status: "active", createdAt: Math.max(joinedAt, now - r.int(0, 20) * DAY),
        ...(lane === "Cofounder" ? { details: "cofounder:member-confirmed" } : {}) };
      if (adult && app === "peon" && lane === "Hire") {
        const hire = plantedPeonHire(plantedMember, intent, area);
        intents.push(hire.intent);
        facets.push(...hire.facets);
      } else {
        intents.push(intent);
      }
    }
    if (adult && app === "friends") {
      const activities = [...new Set(mark.topics.map(topic => FRIENDS_TOPICS[hash32("friends-topic", topic) % FRIENDS_TOPICS.length]!))];
      add("interest", "Preferred activities", activities, "shareable");
      add("availability_pattern", "Available evenings and weekends", ["friends:free:fri_eve", "friends:free:sat_pm", "friends:free:sun_pm"], "agent_private");
      add("fact", "Verified by the service", ["verify:liveness:pass", "verify:age:pass"], "agent_private", "connected_source");
    }
    if (adult && app === "slop" && memberships.Date) {
      const genders = ["woman", "man", "nonbinary"] as const;
      add("preference", "Dating preferences", [`romance:is:${genders[i % genders.length]}`, ...genders.map(gender => `romance:seeks:${gender}`), "romance:age:18-70", "slop:scope:city", "slop:max_miles:8"], "agent_private");
      add("fact", "Home ZIP", [`slop:zip:${DATING_ZIP[seat.market]}`], "agent_private");
      add("goal", "Long-term dating", ["slop:goal:long_term"], "matchable");
      const overall = (memberships.Date.observed / 100) * 6 - 3;
      facets.push(appearanceFacet(id, { age: seat.age }, { face: overall, body: overall, overall, confidence: 0.9, photos: 1, model: "planted" }, joinedAt));
    }
    ordinalOf.set(id, i);
    truthMembers.push(plantedMember);
  }
  return {
    input: { now, members, facets, intents, presence, edges: [], recentProposals: [], events: [] },
    truth: { lanes, laneOffset, utility, members: truthMembers, ordinalOf, circles: latent.circles },
  };
}

/**
 * Evidence items whose weighted sum is `observed` (0..100). Each item is clamped to 100 before the
 * 50% unreviewed weight (spec/memberStanding.md, `standingEvidencePoints`), so a newcomer's 2 * observed
 * unreviewed points are split into items of at most 100.
 */
function evidenceItems(observed: number, reviewed: number): { points: number; reviewed: boolean }[] {
  if (reviewed === 0) {
    const total = 2 * observed;
    return total > STANDING_MAX
      ? [{ points: STANDING_MAX, reviewed: false }, { points: total - STANDING_MAX, reviewed: false }]
      : [{ points: total, reviewed: false }];
  }
  const share = Math.floor(observed / reviewed);
  return Array.from({ length: reviewed }, (_, k) => ({ points: share + (k === 0 ? observed - share * reviewed : 0), reviewed: true }));
}

// ------------------------------------------------------------------------------------------------
// Hidden utility (only the simulator and its gates call these)

const memberOf = (truth: PlantedTruth, id: MemberId): PlantedMember => {
  const k = truth.ordinalOf.get(id);
  if (k === undefined) throw new RangeError(`planted: unknown member ${id}`);
  return truth.members[k]!;
};
const sidesFit = (a: PlantedSide, b: PlantedSide) => (a === "Peer" && b === "Peer") || (a === "Offering" && b === "Seeking") || (a === "Seeking" && b === "Offering");

/** Share of `mine` the other member also has, permille (directional: my denominator). */
function overlapPermille(mine: readonly string[], theirs: readonly string[]): number {
  if (!mine.length) return 0;
  const set = new Set(theirs);
  return Math.floor((1000 * mine.filter(t => set.has(t)).length) / mine.length);
}
/** What `seeks` receive from `offers`, permille: per seek, min(offered level, wanted level) / wanted. */
function exchangePermille(seeks: readonly PlantedSkill[], offers: readonly PlantedSkill[]): number {
  if (!seeks.length) return 0;
  const offered = new Map(offers.map(s => [s.skill, s.level]));
  let sum = 0;
  for (const s of seeks) sum += Math.floor((1000 * Math.min(offered.get(s.skill) ?? 0, s.level)) / s.level);
  return Math.floor(sum / seeks.length);
}

/** Hidden directed utility of `to` for `from` in `lane`, 0..1000. 0 for a minor, a missing membership or incompatible sides. */
export function plantedUtility(truth: PlantedTruth, lane: PlantedLane, from: MemberId, to: MemberId): number {
  const a = memberOf(truth, from), b = memberOf(truth, to);
  const ma = a.lanes[lane], mb = b.lanes[lane];
  if (a === b || !a.adult || !b.adult || !ma || !mb || !sidesFit(ma.side, mb.side)) return 0;
  const u = truth.utility;
  const base = Math.floor((u.interestWeight * overlapPermille(a.topics, b.topics) + u.exchangeWeight * exchangePermille(a.seeks, b.offers)) / (u.interestWeight + u.exchangeWeight));
  const offset = ma.side === "Offering" ? truth.laneOffset[lane] : ma.side === "Seeking" ? -truth.laneOffset[lane] : 0;
  const gap = Math.abs(ma.standing - mb.standing - offset);
  const bonus = a.circle >= 0 && a.circle === b.circle ? u.sameCircleBonus : 0;
  return clampInt(base + bonus - u.gapPenaltyPerPoint * Math.max(0, gap - u.freeGap), 0, 1000);
}

/** Reciprocal ground truth: the worse side's directed utility. */
export function plantedPairTruth(truth: PlantedTruth, lane: PlantedLane, a: MemberId, b: MemberId): number {
  return Math.min(plantedUtility(truth, lane, a, b), plantedUtility(truth, lane, b, a));
}

/** Planted circle per member (-1 = none). */
export function plantedLabels(truth: PlantedTruth): Map<MemberId, number> {
  return new Map(truth.members.map(m => [m.id, m.circle]));
}

// ------------------------------------------------------------------------------------------------
// Metrics for the gates (pure; floats are fine in the simulator)

type Groups = readonly (readonly MemberId[])[];
type Labels = ReadonlyMap<MemberId, number>;
const choose2 = (k: number) => (k * (k - 1)) / 2;

/** Contingency of formed groups against planted labels. A member counts once (first group); an unplanted member is its own label. */
function contingency(groups: Groups, labels: Labels) {
  const seen = new Set<MemberId>();
  const cells = new Map<string, number>(), groupSize: number[] = [], labelSize = new Map<string, number>();
  let n = 0;
  groups.forEach((g, gi) => {
    let size = 0;
    for (const id of g) {
      if (seen.has(id)) continue;
      seen.add(id); size++; n++;
      const c = labels.get(id) ?? -1;
      const label = c >= 0 ? `c${c}` : `u${id}`;
      cells.set(`${gi}\u0000${label}`, (cells.get(`${gi}\u0000${label}`) ?? 0) + 1);
      labelSize.set(label, (labelSize.get(label) ?? 0) + 1);
    }
    groupSize.push(size);
  });
  return { n, cells, groupSize, labelSize };
}

/** Adjusted Rand index of formed groups against planted circles, over the grouped members. */
export function adjustedRandIndex(groups: Groups, labels: Labels): number {
  const { n, cells, groupSize, labelSize } = contingency(groups, labels);
  if (n < 2) return 0;
  let index = 0; for (const v of cells.values()) index += choose2(v);
  let a = 0; for (const v of groupSize) a += choose2(v);
  let b = 0; for (const v of labelSize.values()) b += choose2(v);
  const expected = (a * b) / choose2(n), max = (a + b) / 2;
  if (max === expected) return index === a && a === b ? 1 : 0;
  return (index - expected) / (max - expected);
}

/** Purity: share of grouped members who carry their group's most common planted label. */
export function groupPurity(groups: Groups, labels: Labels): number {
  const { n, cells } = contingency(groups, labels);
  if (!n) return 0;
  const best = new Map<string, number>();
  for (const [key, v] of cells) { const g = key.slice(0, key.indexOf("\u0000")); best.set(g, Math.max(best.get(g) ?? 0, v)); }
  let sum = 0; for (const v of best.values()) sum += v;
  return sum / n;
}

/** Pair precision: share of within-group pairs from one planted circle (0 with no pairs). */
export function pairPrecision(groups: Groups, labels: Labels): number {
  const { cells, groupSize } = contingency(groups, labels);
  let pairs = 0; for (const v of groupSize) pairs += choose2(v);
  let together = 0; for (const [key, v] of cells) if (key.includes("\u0000c")) together += choose2(v);
  return pairs ? together / pairs : 0;
}

/** Pair recall: share of planted circle pairs (over all labelled members) that share a formed group. */
export function pairRecall(groups: Groups, labels: Labels): number {
  const size = new Map<number, number>();
  for (const c of labels.values()) if (c >= 0) size.set(c, (size.get(c) ?? 0) + 1);
  let planted = 0; for (const v of size.values()) planted += choose2(v);
  const { cells } = contingency(groups, labels);
  let together = 0; for (const [key, v] of cells) if (key.includes("\u0000c")) together += choose2(v);
  return planted ? together / planted : 0;
}

/** Pearson correlation; NaN with fewer than two points or no variance. */
export function pearson(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return NaN;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]!; my += ys[i]!; }
  mx /= n; my /= n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i]! - mx, dy = ys[i]! - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Ranks with ties averaged (1-based). */
function ranks(xs: readonly number[]): number[] {
  const order = xs.map((x, i) => [x, i] as const).sort((a, b) => a[0] - b[0]);
  const out = new Array<number>(xs.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1]![0] === order[i]![0]) j++;
    for (let k = i; k <= j; k++) out[order[k]![1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/** Spearman rank correlation; NaN with fewer than two points or no variance. */
export function spearman(xs: readonly number[], ys: readonly number[]): number {
  const n = Math.min(xs.length, ys.length);
  return pearson(ranks(xs.slice(0, n)), ranks(ys.slice(0, n)));
}

/**
 * Correlation of hidden standing across matched pairs in `lane`. Each pair counts in both orders,
 * so the result does not depend on who is listed first. Pairs without the lane are skipped.
 */
export function matchedStandingCorrelation(truth: PlantedTruth, lane: PlantedLane, pairs: readonly (readonly [MemberId, MemberId])[], method: "pearson" | "spearman" = "spearman"): number {
  const xs: number[] = [], ys: number[] = [];
  for (const [a, b] of pairs) {
    const sa = memberOf(truth, a).lanes[lane]?.standing, sb = memberOf(truth, b).lanes[lane]?.standing;
    if (sa === undefined || sb === undefined) continue;
    xs.push(sa, sb); ys.push(sb, sa);
  }
  return method === "pearson" ? pearson(xs, ys) : spearman(xs, ys);
}

/**
 * Random-group baseline: groups of the same sizes drawn without replacement from `pool` (seeded).
 * Stops early when the pool runs out.
 */
export function randomGroups(sizes: readonly number[], pool: readonly MemberId[], seed: number | string): MemberId[][] {
  const order = new Rng(hash32("planted-random-groups", seed)).shuffle(pool);
  const out: MemberId[][] = [];
  let k = 0;
  for (const size of sizes) {
    if (k + size > order.length) break;
    out.push(order.slice(k, k + size));
    k += size;
  }
  return out;
}
