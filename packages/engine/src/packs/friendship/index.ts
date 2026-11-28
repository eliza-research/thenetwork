// friendsPack: friends.help (app id "friends"; formerly buddies.nyc), NYC first, as an AppPack.
// docs/results/2026-10-08-friends-pack.md has the design, the simulator and the gate results.
import { getCity } from "@thenetwork/core";
import { DEFAULT_ATTENTION } from "../../config.ts";
import { cityBucketGeo } from "../../geo.ts";
import type { AppPack, EligibilityPolicy, GeneratorSpec, GeoModel } from "../../pack.ts";
import { CONTRIBUTOR_ROLES } from "../../types.ts";
import { ACTIVITIES } from "../network/activities.ts";
import { networkConstraints } from "../network/ontology.ts";
import { objectivesFor, OBJECTIVES } from "../network/taxonomy.ts";
import { FRIENDS_ACTIVITY, FRIENDS_ASK_QUESTIONS, FRIENDS_KIND_PHRASE, FRIENDS_SAFE_FALLBACK, friendsKindBits, friendsProbeText } from "./copy.ts";
import { FRIENDS_GENERATORS } from "./generators.ts";
import { FRIENDS_CITY, FRIENDS_EXCLUDED_ACTIVITIES, transitMinutesInCity, withinTransitTolerance } from "./geo.ts";
import { friendsInfo } from "./info.ts";
import { FRIENDS_CANDIDATE_POST_RULES, FRIENDS_CANDIDATE_PRE_RULES, friendsMemberRules, friendsPairRules } from "./rules.ts";
import { friendsVectors } from "./vectors.ts";

export const FRIENDSHIP_PACK_VERSION = "friends-pack-0.1.0";
export const FRIENDS_PACK_VERSION = FRIENDSHIP_PACK_VERSION;

export const friendshipGeo: GeoModel = {
  markets: cfg => cfg.cities.filter(c => !!getCity(c)),
  location: (w, id, start, end) => cityBucketGeo.location(w, id, start, end),
  overlap: (w, ids, start, end) => cityBucketGeo.overlap(w, ids, start, end),
  sharesArea: (w, ids, market, window) => cityBucketGeo.sharesArea(w, ids, market, window),
  pairReason: (w, a, b) => {
    const info = friendsInfo(w);
    const ia = info.get(a), ib = info.get(b);
    if (!ia?.home || !ib?.home) return null;
    if (ia.city && ib.city && ia.city !== ib.city) return null;
    const city = ia.city ?? ib.city ?? FRIENDS_CITY;
    return withinTransitTolerance(transitMinutesInCity(city, ia.home, ib.home), ia.tolerance, ib.tolerance) ? null : "beyond_transit_tolerance";
  },
};
export const friendsGeo = friendshipGeo;

let elig: EligibilityPolicy | undefined;
const eligibility = (): EligibilityPolicy => (elig ??= {
  minMatchAge: 18,
  accountTiers: [{ minAge: 13, maxAge: 17, matchable: false, label: "personal agent (13-17)" }],
  memberRules: friendsMemberRules(),
  pairRules: friendsPairRules(),
  candidatePreRules: FRIENDS_CANDIDATE_PRE_RULES,
  candidatePostRules: FRIENDS_CANDIDATE_POST_RULES,
});

const FRIEND_OBJECTIVES = OBJECTIVES.filter(o => !o.romance);

export const friendshipPack: AppPack = {
  id: "friends",
  version: FRIENDSHIP_PACK_VERSION,
  ontology: {
    // No romance lane: friends.help never matches for dating ("friends, not dates").
    lanes: [
      { id: "social", minors: "teenFriendship" },
      { id: "hobby", minors: "teenFriendship" },
    ],
    contributorRoles: CONTRIBUTOR_ROLES,
    // Familiar = someone the member said they'd see again (or already knows); a bare "met" is not warm.
    warmEdges: new Set(["would_interact_again", "enjoyed", "knows", "vouched_for", "invited_by"]),
    funnelProbe: { lane: "social", role: "peer" },
    objectives: FRIEND_OBJECTIVES,
    objectivesFor: (text, details, lane) => (lane === "romance" ? [] : objectivesFor(text, details, lane).filter(o => !o.romance)),
    constraints: b => ({ dealbreakers: networkConstraints(b).dealbreakers }),
    isHost: match => match.some(f => f.tags.some(t => t.toLowerCase() === "host")),
  },
  get eligibility(): EligibilityPolicy { return eligibility(); },
  geo: friendshipGeo,
  get generators(): readonly GeneratorSpec[] { return FRIENDS_GENERATORS; },
  // One Friend membership per adult member (Peers; the band is the full range, so standing does not gate).
  vectors: friendsVectors,
  scoring: {},
  selection: { askQuestions: FRIENDS_ASK_QUESTIONS },
  consent: {
    // Activity-first anonymous probes; a pair is asked in parallel and named only on mutual yes; groups at quorum.
    default: { kind: "probe_first", order: "parallel", reveal: "confirm", anonymousProbe: true },
    byKind: { group: { kind: "group_rsvp", quorum: 3, lateJoinHours: 6 }, second_encounter: { kind: "probe_first", order: "parallel", reveal: "confirm", anonymousProbe: true } },
  },
  attention: {
    config: DEFAULT_ATTENTION,
    noWarmMentionLanes: [],
    itemGate: (_m, it) => (it.category === "romance" ? "romance_excluded" : null),
    probeAllowed: lane => lane !== "romance",
    laneActivity: FRIENDS_ACTIVITY,
    probeText: (ctx, activity, a, ar) => friendsProbeText(ctx, activity, a, ar),
  },
  explain: {
    facetPhrase: FRIENDS_KIND_PHRASE,
    kindBits: (_w, c) => friendsKindBits(c),
    safeFallback: FRIENDS_SAFE_FALLBACK,
  },
  plans: { lane: "social", activities: ACTIVITIES.filter(a => !FRIENDS_EXCLUDED_ACTIVITIES.has(a.id)) },
};
export const friendsPack = friendshipPack;

export { FRIENDSHIP_PLANS, FRIENDS_PLANS, DEFAULT_FRIENDSHIP_POLICY, DEFAULT_FRIENDS_POLICY, friendshipPartnerEligible, friendsPartnerEligible, planFriendshipWeek, planFriendsWeek, nextSameSlot, type FriendshipPolicy, type FriendsPolicy, type FriendshipPlan, type FriendsPlan, type FriendshipWeek, type FriendsWeek, type FriendshipWeekInput, type FriendsWeekInput } from "./planner.ts";
export * from "./geo.ts";
export * from "./info.ts";
export { ROMANCE_FRAMING, friendshipProbeText, friendsProbeText } from "./copy.ts";
export { attendedGroup } from "./rules.ts";
export { FRIENDSHIP_ACTIVITY_TAGS, FRIENDS_ACTIVITY_TAGS, friendshipVectors, friendsVectors } from "./vectors.ts";
