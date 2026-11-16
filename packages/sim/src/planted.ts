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
//   - Offers and seeks come from a circle pool. In a peer lane they rotate, so exchange inside a
//     circle is balanced; in a two-sided lane the Offering side offers what the Seeking side seeks
//     and the reverse. Levels follow standing, so exchange across a standing gap is lopsided.
//   - Small circle traits (friends.help free slots and social energy, slop.date wants_kids) follow
//     the circle with probability `purity`, else a random value, like interests and skills.
//   - Directed utility = interest fit and exchange received, plus a same-circle bonus, minus a
//     standing-gap penalty. A pair is judged by its worse side.
// Each app sees the same hidden structure through its own member inputs (plantedEngineInput).
// Seeded and deterministic (Rng forks only). Work is linear in members: no step compares all pairs.
import type { AppId, Facet, Intent, Member, MemberId, Presence } from "@thenetwork/core";
import { DAY, Rng, canBeMatched, hash32 } from "@thenetwork/core";
import { laneCategory } from "@thenetwork/engine/src/match/profile.ts";
import { NEIGHBORHOODS as FRIENDS_NEIGHBORHOODS } from "@thenetwork/engine/src/packs/friends/geo.ts";
import { FT, FRIENDS_SLOTS, VERIFY_PASS } from "@thenetwork/engine/src/packs/friends/info.ts";
import { FRIENDS_ACTIVITY_TAGS } from "@thenetwork/engine/src/packs/friends/vectors.ts";
import { NEIGHBORHOODS } from "@thenetwork/engine/src/packs/network/vocabulary.ts";
import { JOB_INTENT, SEARCH_INTENT, T as PEON } from "@thenetwork/engine/src/packs/peon/schema.ts";
import { appearanceFacet } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { SLOTS as DATE_SLOTS } from "@thenetwork/engine/src/packs/slop/profile.ts";
import { ZIPS } from "@thenetwork/engine/src/packs/slop/zips.ts";
import type { EngineInput } from "@thenetwork/engine/src/types.ts";
import { laneLimits, laneOffered, laneShape } from "../../core/src/generated/matchLane.ts";
import { FIRST_NAMES } from "./taxonomy.ts";

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
// Engine-only planted world: one app, one lane, the member inputs that app reads

/** Relationship lanes (spec/matchLane.md names). Hire, Mentor and Invest are two-sided. */
export const PLANTED_LANES = ["Friend", "Date", "Cofounder", "Intro", "Hire", "Mentor", "Invest"] as const;
export type PlantedLane = (typeof PLANTED_LANES)[number];
export type PlantedSide = "Peer" | "Offering" | "Seeking";
export type PlantedGender = "woman" | "man";
/** The one market of a planted world (friends.help serves only NYC). */
const MARKET = "nyc" as const;
/** What a member of ntwrk says they want in each lane and side (the pack reads lane and side from these). */
const NTWRK_OBJECTIVE: Record<PlantedLane, Record<PlantedSide, string>> = {
  Friend: { Peer: "meet a few new friends who share my interests", Offering: "", Seeking: "" },
  Date: { Peer: "", Offering: "", Seeking: "" },
  Cofounder: { Peer: "find a cofounder", Offering: "", Seeking: "" },
  Intro: { Peer: "meet people who work on what I work on", Offering: "", Seeking: "" },
  Hire: { Peer: "", Offering: "", Seeking: "" },
  Mentor: { Peer: "", Offering: "mentor someone earlier in their career", Seeking: "find a mentor" },
  Invest: { Peer: "", Offering: "invest in early-stage companies", Seeking: "raise money for my company" },
};
/** First-date activities slop.date plans around (packs/slop/score.ts dateActivity). */
const DATE_ACTIVITIES = ["coffee", "drinks", "walk", "museum", "dinner", "live_music", "comedy", "climbing", "cooking_class", "hike"] as const;
const DATE_PLANS: readonly string[] = [...DATE_ACTIVITIES.map(a => `activity:${a}`), ...DATE_SLOTS.map(s => `free:${s}`)];
const FRIENDS_ACTIVITIES: readonly string[] = [...FRIENDS_ACTIVITY_TAGS].sort();
const FRIENDS_ENERGY = ["low", "mid", "high"] as const;
const NYC_ZIPS: readonly string[] = ZIPS.filter(z => z.market === MARKET).map(z => z.zip);
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
  /** The app, and the one lane of it that every member joins. */
  app: AppId;
  lane: PlantedLane;
  /** Share of members aged 13-17 (default 0.02). They join circles never. */
  minorShare?: number;
  /** Share of adults on the Offering side of a two-sided lane (default 0.5). Minors are always Seeking. */
  offeringShare?: number;
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
  /** The standing the member's evidence implies (noisy; never shown to members). */
  observed: number;
  /** Reviewed evidence items (0 = newcomer). */
  reviewed: number;
}
export interface PlantedMember {
  id: MemberId; ordinal: number; adult: boolean;
  /** Planted circle index, -1 when none. */
  circle: number;
  /** Hidden truth: interests, what the member offers and seeks (hidden levels). */
  topics: readonly string[]; offers: readonly PlantedSkill[]; seeks: readonly PlantedSkill[];
  /** The lane membership; none for a minor in Date (dating is adults only). */
  membership?: PlantedMembership;
  /** Date only: who the member is and who they seek (a mutual hard rule). */
  gender?: PlantedGender; seeksGender?: PlantedGender;
}
export interface PlantedTruth {
  app: AppId; lane: PlantedLane;
  /** Intended standing of Offering above Seeking (the lane's standingOffset). */
  offset: number;
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
const other = (g: PlantedGender): PlantedGender => (g === "woman" ? "man" : "woman");

/** Planted tags of one member: interests and the skill indices they offer and seek. */
interface Plan { topics: readonly string[]; offers: readonly number[]; seeks: readonly number[] }
/** One member as an app's input writer needs it. */
interface Seated {
  id: MemberId; age: number; adult: boolean;
  r: Rng; area: string; m?: PlantedMembership; truth: PlantedMember;
  /** Stated skills: the planted skills at the level the member's evidence implies. */
  offers: readonly PlantedSkill[]; seeks: readonly PlantedSkill[];
}
type Add = (kind: Facet["kind"], value: string, tags: readonly string[], scope: Facet["scope"], provenance?: Facet["provenance"]) => void;

/**
 * A planted EngineInput snapshot for one app and lane, and its hidden truth. The snapshot carries
 * only the inputs a real member of that app would give (see the writers below); the hidden labels
 * (circle, standing, the planted pools) stay in the truth.
 */
export function plantedEngineInput(o: PlantedWorldOptions): { input: EngineInput; truth: PlantedTruth } {
  if (!(Number.isInteger(o.n) && o.n >= 1)) throw new RangeError(`planted: n ${o.n}`);
  const { app, lane } = o;
  // spec/matchLane.md, "laneOffered": a world tests a lane its app offers.
  if (!laneOffered(app, lane)) throw new RangeError(`planted: app ${app} does not offer lane ${lane}`);
  const twoSided = laneShape(lane) === "TwoSided";
  const offset = laneLimits(lane).standingOffset;
  const now = o.now ?? PLANTED_EPOCH;
  const minorShare = o.minorShare ?? 0.02, offeringShare = o.offeringShare ?? 0.5, newcomerShare = o.newcomerShare ?? 0.15;
  const utility = { ...PLANTED_UTILITY, ...o.utility };
  if (utility.interestWeight < 0 || utility.exchangeWeight < 0 || utility.interestWeight + utility.exchangeWeight <= 0) throw new RangeError("planted: utility weights");
  const purity = o.purity ?? PLANTED_DEFAULTS.purity;
  const root = new Rng(hash32("planted-world", o.seed, app, lane));

  // Seats: id and age. Minors never join a circle.
  const width = Math.max(4, String(o.n - 1).length);
  const seats: (PlantedSeat & { age: number })[] = [];
  for (let i = 0; i < o.n; i++) {
    const r = root.fork("seat", i);
    const age = r.bool(minorShare) ? r.int(13, 17) : clampInt(r.normal(33, 8), 18, 70);
    seats.push({ id: `p${String(i).padStart(width, "0")}`, market: MARKET, age, eligible: canBeMatched(age) });
  }
  // Interests: friends.help's activity tags; a peon role family (one per member); else topic names,
  // about two circles per topic so that circles rarely share a topic set.
  const spec: PlantedSpec = app === "peon" ? { ...o, topicsPerCircle: 1, interestsPerMember: [1, 1] } : o;
  const topicsPerCircle = spec.topicsPerCircle ?? PLANTED_DEFAULTS.topicsPerCircle;
  const vocabSize = Math.max(48, Math.ceil((o.n * topicsPerCircle) / 9));
  const topicVocab = app === "friends" ? FRIENDS_ACTIVITIES : names(app === "peon" ? "family" : "topic", vocabSize);
  const skillVocab = app === "friends" ? FRIENDS_ACTIVITIES : app === "slop" ? DATE_PLANS : names("skill", vocabSize);
  const latent = plantLatent({ ...spec, seed: o.seed, dimensions: 1 }, seats, topicVocab, `${o.seed}`);
  const areas = app === "friends" ? FRIENDS_NEIGHBORHOODS.map(h => h.name) : app === "slop" ? NYC_ZIPS : NEIGHBORHOODS[MARKET];

  const pools = latent.circles.map((ids, c) => distinctIndices(root.fork("skills", c), Math.max(4, ids.length), skillVocab.length));
  const position = new Map<MemberId, number>();
  latent.circles.forEach(ids => ids.forEach((id, j) => position.set(id, j)));
  const circleArea = latent.circles.map((_, c) => root.fork("area", c).pick(areas));

  const members: Member[] = [], facets: Facet[] = [], intents: Intent[] = [], presence: Presence[] = [];
  const truthMembers: PlantedMember[] = [];
  const ordinalOf = new Map<MemberId, number>();
  const write = WRITERS[app];
  for (let i = 0; i < seats.length; i++) {
    const seat = seats[i]!, id = seat.id, adult = seat.eligible;
    const r = root.fork("member", i);
    const mark = latent.marks.get(id)!;
    const newcomer = r.bool(newcomerShare);
    const side: PlantedSide = !twoSided ? "Peer" : adult && r.bool(offeringShare) ? "Offering" : "Seeking";
    const up = Math.ceil(offset / 2);
    const standing = clampStanding(mark.standing[0]! + (side === "Offering" ? up : side === "Seeking" ? up - offset : 0));
    const reviewed = newcomer ? 0 : r.int(1, 3);
    const observed = clampStanding(r.normal(standing, OBSERVATION_SD[reviewed]!));
    const m: PlantedMembership | undefined = lane === "Date" && !adult ? undefined : { side, standing, observed, reviewed };

    // Planned skills: a peer rotates over the circle pool (position j offers j, j+1 and seeks j+2,
    // j+3); in a two-sided lane Offering offers pool 0, 1 and seeks 2, 3, and Seeking the reverse;
    // a date plan is the circle's four plans (offered and sought alike). Each planned tag is replaced
    // by a random one with P = 1 - purity; a member outside every circle draws them all.
    const pool = mark.circle >= 0 ? pools[mark.circle]! : undefined;
    const j = position.get(id) ?? 0;
    const at = (k: number) => (pool ? pool[k % pool.length] : undefined);
    const plannedOffers = side === "Offering" ? [at(0), at(1)] : side === "Seeking" ? [at(2), at(3)] : [at(j), at(j + 1)];
    const plannedSeeks = side === "Offering" ? [at(2), at(3)] : side === "Seeking" ? [at(0), at(1)] : [at(j + 2), at(j + 3)];
    const taken = new Set<number>();
    const pickSkill = (planned: number | undefined) => {
      const k = planned !== undefined && !taken.has(planned) && r.bool(purity) ? planned : freshIndex(r, skillVocab.length, taken);
      taken.add(k);
      return k;
    };
    const plan: Plan = app === "slop"
      ? (() => { const plans = [0, 1, 2, 3].map(k => pickSkill(at(k))); return { topics: mark.topics, offers: plans, seeks: plans }; })()
      : { topics: mark.topics, offers: plannedOffers.map(pickSkill), seeks: plannedSeeks.map(pickSkill) };
    const hidden = plantedLevel(standing), stated = plantedLevel(observed);
    const skillsAt = (ks: readonly number[], level: number) => ks.map(k => ({ skill: skillVocab[k]!, level }));
    // Date: within a circle positions alternate woman / man (so a circle can pair up); seeking the other.
    const gender: PlantedGender | undefined = lane !== "Date" ? undefined
      : mark.circle >= 0 ? (j % 2 === 0 ? "woman" : "man") : r.bool(0.5) ? "woman" : "man";
    // peon: a seat offers its role family and seeks skills; a candidate the reverse.
    const family = { skill: mark.topics[0]!, level: 1 };
    const truthOffers = app === "peon" && side === "Offering" ? [family] : skillsAt(plan.offers, app === "slop" ? 1 : hidden);
    const truthSeeks = app === "peon" && side === "Seeking" ? [family] : skillsAt(plan.seeks, app === "slop" ? 1 : hidden);
    const truth: PlantedMember = {
      id, ordinal: i, adult, circle: mark.circle, topics: plan.topics, offers: truthOffers, seeks: truthSeeks,
      ...(m ? { membership: m } : {}), ...(gender ? { gender, seeksGender: other(gender) } : {}),
    };
    const area = mark.circle >= 0 && r.bool(0.7) ? circleArea[mark.circle]! : r.pick(areas);
    const joinedAt = now - (newcomer ? r.int(0, 13) : r.int(14, 400)) * DAY;
    const romance = lane === "Date" && adult;
    members.push({
      id, name: `${r.pick(FIRST_NAMES)} ${i}`, homeCity: MARKET, state: "normal",
      prefs: {
        categoriesOptIn: lane === "Date" && !adult ? [] : [laneCategory(lane)], quietHours: [22, 8], romanceOptIn: romance,
        formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false,
      },
      // A peon snapshot carries 18 for every confirmed adult (packs/peon/schema.ts, "AGE").
      joinedAt, age: app === "peon" && adult ? 18 : seat.age, unansweredProactive: 0, apps: [app],
    });
    let f = 0;
    const add: Add = (kind, value, tags, scope, provenance = "said") =>
      facets.push({ id: `${id}-f${String(f++).padStart(2, "0")}`, memberId: id, kind, value, tags: [...tags], scope, provenance, confidence: 0.9, app });
    const seatedMember: Seated = {
      id, age: seat.age, adult, r, area, m, truth,
      offers: app === "peon" && side === "Offering" ? [family] : skillsAt(plan.offers, stated),
      seeks: app === "peon" && side === "Seeking" ? [family] : skillsAt(plan.seeks, stated),
    };
    // A circle trait: value k of the circle (index c) with P = purity, else a random value.
    const trait = (size: number, k = 0) => (mark.circle >= 0 && r.bool(purity) ? mark.circle + k : r.int(0, size - 1)) % size;
    const objective = write({ lane, now, add, s: seatedMember, gender, trait });
    presence.push({ memberId: id, city: MARKET, type: "home", areas: [area] });
    if (objective) intents.push({ id: `${id}-i`, memberId: id, ...objective, horizonDays: 60, status: "active", createdAt: Math.max(joinedAt, now - r.int(0, 20) * DAY) });
    ordinalOf.set(id, i);
    truthMembers.push(truth);
  }
  return {
    input: { now, members, facets, intents, presence, edges: [], recentProposals: [], events: [] },
    truth: { app, lane, offset, utility, members: truthMembers, ordinalOf, circles: latent.circles },
  };
}

/** The intent a writer states (objective, category and, for peon, the posting or search detail). */
type Objective = Pick<Intent, "objective" | "category" | "details">;
interface WriteCtx {
  lane: PlantedLane; now: number; add: Add; s: Seated; gender?: PlantedGender;
  /** A circle trait in 0..size-1: the circle's value (shifted by k) with P = purity, else random. */
  trait: (size: number, k?: number) => number;
}

/**
 * ntwrk: interests, offers and seeks, the lane goal (`lane:<Lane>`, `side:<Side>`) and agent_private
 * evidence facts whose points sum to the observed standing (packs/network/vectors.ts standing).
 */
function writeNtwrk({ lane, add, s }: WriteCtx): Objective | undefined {
  add("interest", `into ${s.truth.topics.join(", ")}`, s.truth.topics, "shareable");
  for (const k of s.offers) add("offer", `can help with ${k.skill}`, [k.skill, `level:${k.level}`], "shareable");
  for (const k of s.seeks) add("desire", `looking for help with ${k.skill}`, [k.skill, `level:${k.level}`], "matchable");
  const m = s.m!;
  const objective = NTWRK_OBJECTIVE[lane][m.side];
  add("goal", objective, [`lane:${lane}`, `side:${m.side}`], "matchable");
  for (const e of evidenceItems(m.observed, m.reviewed))
    add("fact", "track record", [`lane:${lane}`, `evidence:${e.points}`, e.reviewed ? "reviewed" : "unreviewed"], "agent_private", e.reviewed ? "vouched" : "said");
  return { objective, category: laneCategory(lane) };
}

/**
 * slop.date (packs/slop/profile.ts tag schema): orientation and age range, a known zip, a distance
 * limit, the goal and lifestyle, interests, date plans (activities and free slots) and, once the
 * member has photos, the private appearance rating as the platform stores it. Adults only.
 */
function writeSlop({ now, add, s, gender, trait }: WriteCtx): Objective | undefined {
  if (!s.adult || !s.m || !gender) return undefined;
  add("preference", "dating preferences", [`romance:is:${gender}`, `romance:seeks:${other(gender)}`, `romance:age:${Math.max(18, s.age - 8)}-${s.age + 8}`], "matchable");
  add("fact", "home zip", [`slop:zip:${s.area}`], "agent_private");
  add("preference", "distance", ["slop:max_miles:25"], "matchable");
  add("goal", "looking for something long term", ["slop:goal:long_term"], "matchable");
  const kids = trait(2) === 0 ? "yes" : "no";
  add("fact", "lifestyle", ["slop:smoking:never", "slop:drinking:sometimes", `slop:wants_kids:${kids}`, "slop:religion_importance:1", "slop:politics:moderate"], "matchable");
  for (const t of s.truth.topics) add("interest", t, [t], "shareable");
  for (const k of s.offers) {
    const [kind, value] = k.skill.split(":") as [string, string];
    add(kind === "free" ? "availability_pattern" : "preference", value, [`slop:${kind}:${value}`], "matchable");
  }
  // spec/memberStanding.md, "A private photo rating maps onto the standing scale for dating": the
  // overall score whose permille rating lands in the middle of the observed standing point.
  if (s.m.reviewed > 0) {
    const z = Number((((s.m.observed * 10 + 5) * 6) / 1000 - 3).toFixed(3));
    add("fact", "photo rating (internal)", appearanceFacet(s.id, { age: s.age }, { face: z, body: z, overall: z, confidence: 0.8, photos: s.m.reviewed, model: "planted" }, now).tags, "agent_private", "inferred");
  }
  return { objective: "meet someone to date", category: laneCategory("Date") };
}

/**
 * friends.help (packs/friends/info.ts): a home neighborhood (presence), liveness and age checks
 * passed, activity interests, what the member wants a partner for and brings, free slots and social
 * energy shared with their circle.
 */
function writeFriends({ add, s, trait }: WriteCtx): Objective | undefined {
  add("interest", `into ${s.truth.topics.join(", ")}`, s.truth.topics, "shareable");
  for (const k of s.seeks) add("desire", `looking for someone to do ${k.skill} with`, [k.skill], "matchable");
  for (const k of s.offers) add("offer", `can show people ${k.skill}`, [k.skill], "shareable");
  add("fact", "verification", [`${FT.liveness}${VERIFY_PASS}`, `${FT.age}${VERIFY_PASS}`], "agent_private", "connected_source");
  const slots = [...new Set([trait(FRIENDS_SLOTS.length), trait(FRIENDS_SLOTS.length, 3)])].map(k => `${FT.free}${FRIENDS_SLOTS[k]!}`);
  add("availability_pattern", "usually free", slots, "agent_private");
  add("preference", "social energy", [`${FT.energy}${FRIENDS_ENERGY[trait(FRIENDS_ENERGY.length)]!}`], "agent_private");
  return { objective: "meet a few new friends who share my interests", category: laneCategory("Friend") };
}

/**
 * peon.biz (packs/peon/schema.ts): an Offering member is a verified employer's open job seat with a
 * role family, level, pay range, hybrid site and must-have skills at the level; a Seeking member is
 * a candidate with the family, level and skills (reviewed by a connected source unless a newcomer),
 * a pay floor, hybrid commute areas and work authorization. A Cofounder member is a candidate who
 * says they want a cofounder.
 */
function writePeon({ lane, add, s }: WriteCtx): Objective | undefined {
  const m = s.m!, level = plantedLevel(m.observed), family = s.truth.topics[0]!;
  const base = 50 + 25 * level;
  const proof = m.reviewed > 0 ? "connected_source" : "said";
  if (m.side === "Offering") {
    add("fact", "Hiring role", [`${PEON.entity}job`, PEON.verified, `${PEON.company}${s.id}`, `${PEON.family}${family}`, `${PEON.seniority}${level}`,
      `${PEON.pay}${base}-${base + 30}`, `${PEON.mode}hybrid`, `${PEON.market}${MARKET}`, `${PEON.area}${s.area}`, `${PEON.openings}${s.r.int(1, 3)}`], "matchable");
    add("fact", "must-have skills", s.seeks.map(k => `${PEON.must}${k.skill}:${k.level}`), "shareable");
    return { objective: `Hire: ${family} level ${level}`, category: "professional", details: JOB_INTENT };
  }
  // A candidate commutes to their own area and names two more.
  const commute = [...new Set([s.area, s.r.pick(NEIGHBORHOODS[MARKET]), s.r.pick(NEIGHBORHOODS[MARKET])])].map(a => `${PEON.area}${a}`);
  add("fact", "candidate", [`${PEON.entity}candidate`, `${PEON.family}${family}`, `${PEON.floor}${base + s.r.int(-5, 15)}`, `${PEON.mode}hybrid`, ...commute, `${PEON.auth}yes`], "matchable");
  add("fact", "level", [`${PEON.seniority}${level}`], "matchable", proof);
  for (const k of s.offers) add("skill", k.skill, [`${PEON.skill}${k.skill}:${k.level}`], "shareable", proof);
  return { objective: lane === "Cofounder" ? "find a cofounder" : "find a new job", category: "professional", details: SEARCH_INTENT };
}

const WRITERS: Record<AppId, (c: WriteCtx) => Objective | undefined> = { ntwrk: writeNtwrk, slop: writeSlop, friends: writeFriends, peon: writePeon };

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

/**
 * Hidden directed utility of `to` for `from`, 0..1000. 0 for a minor, a missing membership,
 * incompatible sides or (Date) a member who does not seek the other's gender.
 */
export function plantedUtility(truth: PlantedTruth, from: MemberId, to: MemberId): number {
  const a = memberOf(truth, from), b = memberOf(truth, to);
  const ma = a.membership, mb = b.membership;
  if (a === b || !a.adult || !b.adult || !ma || !mb || !sidesFit(ma.side, mb.side)) return 0;
  if (a.seeksGender !== b.gender || b.seeksGender !== a.gender) return 0;
  const u = truth.utility;
  const base = Math.floor((u.interestWeight * overlapPermille(a.topics, b.topics) + u.exchangeWeight * exchangePermille(a.seeks, b.offers)) / (u.interestWeight + u.exchangeWeight));
  const offset = ma.side === "Offering" ? truth.offset : ma.side === "Seeking" ? -truth.offset : 0;
  const gap = Math.abs(ma.standing - mb.standing - offset);
  const bonus = a.circle >= 0 && a.circle === b.circle ? u.sameCircleBonus : 0;
  return clampInt(base + bonus - u.gapPenaltyPerPoint * Math.max(0, gap - u.freeGap), 0, 1000);
}

/** Reciprocal ground truth: the worse side's directed utility. */
export function plantedPairTruth(truth: PlantedTruth, a: MemberId, b: MemberId): number {
  return Math.min(plantedUtility(truth, a, b), plantedUtility(truth, b, a));
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

/** Hidden standing with the lane offset removed from the Offering side; undefined without a membership. */
export function levelStanding(truth: PlantedTruth, id: MemberId): number | undefined {
  const m = memberOf(truth, id).membership;
  return m && m.standing - (m.side === "Offering" ? truth.offset : 0);
}

/**
 * Correlation of hidden standing across matched pairs of the world's lane, after the lane offset is
 * removed from the Offering side (so a two-sided pair at the intended offset counts as level). Each
 * pair counts in both orders, so the result does not depend on who is listed first. Pairs without a
 * membership are skipped; NaN with fewer than two pairs.
 */
export function matchedStandingCorrelation(truth: PlantedTruth, pairs: readonly (readonly [MemberId, MemberId])[], method: "pearson" | "spearman" = "spearman"): number {
  const xs: number[] = [], ys: number[] = [];
  for (const [a, b] of pairs) {
    const sa = levelStanding(truth, a), sb = levelStanding(truth, b);
    if (sa === undefined || sb === undefined) continue;
    xs.push(sa, sb); ys.push(sb, sa);
  }
  // One pair in both orders always gives -1: the correlation needs two pairs.
  if (xs.length < 4) return NaN;
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
