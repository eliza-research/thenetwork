// friendsPack: friends.help (app id "friends"; formerly buddies.nyc), NYC first, as an AppPack.
// docs/results/2026-10-08-friends-pack.md has the design, the simulator and the gate results.
//
// Policy in one paragraph (PRD 40.2 / 40.6; domain research Part C): groups of 3-6 at public venues
// first, one-to-one activity partners second (only after a group meetup); an anonymous,
// activity-first probe with time options, names only at quorum; the same people again near home
// ("same table again"), a crew offered after one great plan and handed to its own chat after three
// sessions; venues minimize the group's longest transit trip; romance is excluded entirely (no lane,
// rules at member / pair / configuration level, no romance framing in any copy); members aged 13-17
// may join but are never matched (core); unverified members and members with a safety cue are held.
import { DEFAULT_ATTENTION, DEFAULT_CONFIG } from "../../config.ts";
import { cityBucketGeo } from "../../geo.ts";
import type { AppPack, EligibilityPolicy, GeneratorSpec, GeoModel } from "../../pack.ts";
import { mutualBenefit } from "../../scoring.ts";
import { CONTRIBUTOR_ROLES, type Role } from "../../types.ts";
import { ACTIVITIES } from "../network/activities.ts";
import { DEFAULT_ENJOY_BY_CATEGORY, DEFAULT_ENJOY_KNOTS } from "../network/calibrator.ts";
import { networkConstraints } from "../network/ontology.ts";
import { objectivesFor, OBJECTIVES } from "../network/taxonomy.ts";
import { FRIENDS_ACTIVITY, FRIENDS_ASK_QUESTIONS, FRIENDS_KIND_PHRASE, FRIENDS_LANE_LABEL, FRIENDS_SAFE_FALLBACK, friendsKindBits, friendsProbeText } from "./copy.ts";
import { FRIENDS_GENERATORS } from "./generators.ts";
import { displayMinutes, FRIENDS_EXCLUDED_ACTIVITIES, transitMinutes } from "./geo.ts";
import { friendsInfo } from "./info.ts";
import { FRIENDS_PLANS } from "./planner.ts";
import { FRIENDS_CANDIDATE_POST_RULES, FRIENDS_CANDIDATE_PRE_RULES, friendsMemberRules, friendsPairRules } from "./rules.ts";

export const FRIENDS_PACK_VERSION = "friends-pack-0.1.0";

/**
 * NYC neighborhoods and transit minutes. Markets: NYC only. Overlap is the city-bucket overlap held
 * to NYC. The pair rule: two homes so far apart that no venue fits both stated tolerances (the
 * estimated trip between the homes exceeds the sum of the two tolerances) never pair. Symmetric.
 */
export const friendsGeo: GeoModel = {
  kind: "city",
  markets: cfg => cfg.cities.filter(c => c === "nyc"),
  tz: (market, cfg) => cfg.timezones[market] ?? "America/New_York",
  location: (w, id, start, end) => cityBucketGeo.location(w, id, start, end),
  overlap: (w, ids, start, end) => {
    const o = cityBucketGeo.overlap(w, ids, start, end, "nyc");
    return o && o.city === "nyc" ? o : null;
  },
  sharesArea: (w, ids, market) => cityBucketGeo.sharesArea(w, ids, market),
  pairReason: (w, a, b) => {
    const info = friendsInfo(w);
    const ia = info.get(a), ib = info.get(b);
    if (!ia?.home || !ib?.home) return null;
    return transitMinutes(ia.home, ib.home) > ia.tolerance + ib.tolerance ? "beyond_transit_tolerance" : null;
  },
  displayDistance: km => displayMinutes(Math.round(8 + 2.2 * km)),
};

let elig: EligibilityPolicy | undefined;
const eligibility = (): EligibilityPolicy => (elig ??= {
  minMatchAge: 18,
  // PRD 40.3: 13-17 may join every app and get the personal agent; never matched, probed or placed in a plan.
  accountTiers: [{ minAge: 13, maxAge: 17, matchable: false, label: "personal agent (13-17)" }],
  memberRules: friendsMemberRules(),
  pairRules: friendsPairRules(),
  candidatePreRules: FRIENDS_CANDIDATE_PRE_RULES,
  candidatePostRules: FRIENDS_CANDIDATE_POST_RULES,
});

const ROLES: Role[] = ["peer", "guest", "host", "newcomer", "attendee"];
const FRIEND_OBJECTIVES = OBJECTIVES.filter(o => !o.romance);

export const friendsPack: AppPack = {
  id: "friends",
  version: FRIENDS_PACK_VERSION,
  ontology: {
    // No romance lane: friends.help never matches for dating ("friends, not dates").
    lanes: [
      { id: "social", label: "small-group meetups", optIn: "default_on", adultOnly: true },
      { id: "hobby", label: "activity buddies", optIn: "default_on", adultOnly: true },
    ],
    roles: ROLES.map(id => ({ id, contributor: CONTRIBUTOR_ROLES.has(id) })),
    kinds: [
      { id: "group", format: "small_group", size: [3, 6] },
      { id: "intro", format: "one_to_one", size: [2, 2] },
      { id: "second_encounter", format: "one_to_one", size: [2, 2] },
    ],
    contributorRoles: CONTRIBUTOR_ROLES,
    // Familiar = someone the member said they'd see again (or already knows); a bare "met" is not warm.
    warmEdges: new Set(["would_interact_again", "enjoyed", "knows", "vouched_for", "invited_by"]),
    funnelProbe: { lane: "social", role: "peer" },
    objectives: FRIEND_OBJECTIVES,
    objectivesFor: (text, details, lane) => (lane === "romance" ? [] : objectivesFor(text, details, lane).filter(o => !o.romance)),
    mutualPreferenceMatch: () => false,
    constraints: b => ({ dealbreakers: networkConstraints(b).dealbreakers }),
    isHost: match => match.some(f => f.tags.some(t => t.toLowerCase() === "host")),
  },
  get eligibility(): EligibilityPolicy { return eligibility(); },
  geo: friendsGeo,
  get generators(): readonly GeneratorSpec[] { return FRIENDS_GENERATORS; },
  retrieval: { channels: ["tag", "geo", "graph", "exposure_floor"], directions: [{ from: "member", to: "group" }] },
  scoring: { objective: "reciprocal", aggregate: b => mutualBenefit(b) },
  selection: { askQuestions: FRIENDS_ASK_QUESTIONS },
  consent: {
    // Activity-first anonymous probes; a pair is asked in parallel and named only on mutual yes; groups at quorum.
    default: { kind: "probe_first", order: "parallel", reveal: "confirm", anonymousProbe: true },
    byKind: { group: { kind: "group_rsvp", quorum: 3, lateJoinHours: 6 }, second_encounter: { kind: "probe_first", order: "parallel", reveal: "confirm", anonymousProbe: true } },
  },
  attention: {
    config: DEFAULT_ATTENTION,
    // Borrowed from networkPack until friends.help has its own labels (no live data yet).
    calibrator: { knots: DEFAULT_ENJOY_KNOTS, byLane: DEFAULT_ENJOY_BY_CATEGORY },
    noWarmMentionLanes: [],
    itemGate: (_m, it) => (it.category === "romance" ? "romance_excluded" : null),
    probeAllowed: lane => lane !== "romance",
    laneActivity: FRIENDS_ACTIVITY,
    probeText: (ctx, activity, a, ar) => friendsProbeText(ctx, activity, a, ar),
  },
  explain: {
    laneLabel: FRIENDS_LANE_LABEL,
    facetPhrase: FRIENDS_KIND_PHRASE,
    kindBits: (_w, c) => friendsKindBits(c),
    safeFallback: FRIENDS_SAFE_FALLBACK,
  },
  plans: { config: FRIENDS_PLANS, lane: "social", activities: ACTIVITIES.filter(a => !FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)) },
  capital: {
    earn: ["attendance", "organizing", "review"],
    lose: ["no_show", "ghosting", "abuse", "fraud"],
    minorsExcluded: true,
  },
  sim: { module: "packages/worlds/src/friends/index.ts", export: "friendsSim" },
  metrics: {
    primary: ["repeat_meetup_rate", "v14", "friendship_track_share", "crews_formed", "median_group_max_travel"],
    // Official gates, adopted by the founder 2026-10-08 (packages/worlds/src/friends/gates.ts computes
    // them; docs/results/2026-10-08-friends-pack.md "Gates"). Ratios are against random-within-area
    // and the hidden-truth oracle on the same seeds.
    gates: [
      { metric: "repeat_meetup_rate", op: ">=", value: 0.3, seeds: 4, blocking: true },
      { metric: "v14_vs_oracle", op: ">=", value: 0.75, seeds: 4, blocking: true },
      { metric: "v14_vs_random", op: ">=", value: 1.75, seeds: 4, blocking: true },
      { metric: "friendship_forming_vs_random", op: ">=", value: 2, seeds: 4, blocking: true },
      { metric: "median_group_max_travel_min", op: "<=", value: 35, seeds: 4, blocking: true },
      { metric: "borough_v14_ratio_min_30", op: ">=", value: 0.7, seeds: 4, blocking: true },
      { metric: "safety.declaredMinorContacts", op: "==", value: 0, seeds: 8, blocking: true },
      { metric: "safety.knownAdversaryContacts", op: "==", value: 0, seeds: 8, blocking: true },
      { metric: "total_harm_vs_random", op: "<=", value: 0.5, seeds: 4, blocking: true },
      // Tracked, non-blocking.
      { metric: "undetected_harm_vs_random", op: "<=", value: 0.5, seeds: 4, blocking: false },
      { metric: "repeat_rate_with_handoff_12w", op: ">=", value: 0.3, seeds: 4, blocking: false },
    ],


    unsafeClasses: ["minor", "adversarial", "romance"],
  },
  defaults: { engine: DEFAULT_CONFIG, attention: DEFAULT_ATTENTION, plans: FRIENDS_PLANS },
};

export { FRIENDS_PLANS, DEFAULT_FRIENDS_POLICY, planFriendsWeek, nextSameSlot, type FriendsPolicy, type FriendsPlan, type FriendsWeek, type FriendsWeekInput } from "./planner.ts";
export * from "./geo.ts";
export * from "./info.ts";
export { ROMANCE_FRAMING, friendsProbeText } from "./copy.ts";
export { attendedGroup } from "./rules.ts";
