# Candidate retrieval and groups

## Story: Candidate retrieval and groups

A member needs recommendations and groups that respect consent, blocks, and location.

### Safety rules and reachability

Check pool eligibility, pair exclusions, group sizes, and seat uniqueness. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

Retrieval and intro candidates admit a minor only in a friendship lane (the `social` lane of friends.help and the Friend lane of The Network, `friendshipLane`), only while staff have not stopped teen introductions (`teenStopped`, false at the start), and only when every pair of the roster passes the pair rule of `groupAgeAllowed` ([friend introductions with a minor](../friendIntroAge.md); `teenFriendAgeRule`, and `teenSwitchOffNoMinor` for the stopped case). An intro with a minor also needs a generator that [relationship lanes](../matchLane.md) `teenGenerator` names and the friendship shape `teenIntroShape` (no via, no event anchor): `introBy` takes the generator, and `intro` gives a pair with no via `intent_to_capability` (network) or `activity_partner` (friends), and a pair with a via `warm_path`. `event_anchor`, `newcomer_welcome`, `help_request` and `second_encounter` never make an intro with a minor. Group composition in `group.ts` (`composeGroup`) stays adult-only, so its flags count every minor.

The friends planner passes (crew sessions, crew offers, same table again, new plans, activity partners) seat a minor only in a roster that passes `teenPlanOk`, as `planMemberReason` (`teenPlanSeat`), `teenGroupReason`, `crewSessionPlan`, `friendsPartnerEligible` and `teenPlanReason` do: friends.help only (`teenGroupPlanApp`), 2 to `TEEN_MAX` people (`teenRosterSizeAllowed`), every pair passes the pair rule, and the activity and place are all-ages (`planActivityOffered`, `planPlaceOffered`). The planner flags count a minor in a roster that fails this rule.

Not in this model: the teen `friend_circle` and `group_composer` circles of 3 or more from `match/circles.ts` and the teen `activity_partner` intros in the `hobby` category; `packages/engine/test/teen-friend-age.integration.test.ts` covers them. Changed (owner decision 2026-11-22, answers A2 to A5): retrieval and the friends planner admit a minor under the rule, because the owner allowed teen friendship introductions and small teen groups.

The [group formation spec](../groupFormation.md) generates the beam composer’s admission decisions, primary selection, and alternate reservations. This model treats retrieval channels as an oracle and follows groups into the service.

The [bounded candidate search spec](../candidateSearch.md) defines the posting and pair-check limits, exact termination, and the certificate for a budgeted result. The model below begins with the candidates returned by retrieval.

The [candidate screening spec](../candidateScreening.md) generates the ordered hard-check transitions and the first refusal used before scoring.

The [travel presence spec](../travelPresence.md) supplies bounded intervals for the production city check. This model abstracts them to one city per member.

Imported from `quint/candidate_pool.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=2000 verify-steps=6
//
// candidate_pool: how the engine builds a pool of members and then a group, from retrieval to the
// friends.help weekly planner.
//
// WHAT THIS MODELS (the parts that quint/matching_engine.qnt on wave2/matching_engine does not have;
// that model has the slop and peon flows, the hard-filter chain order and the plan seat rule
// planMemberReason, so this model uses those decisions as given and does not model them again)
//   - retrieval (packages/engine/src/retrieval.ts): eligibleMembers (the member hard filter pass,
//     filters.ts memberReason core prefix), the channel union (semantic, tag, graph, exposure floor:
//     an oracle subset of the eligible members) and twoHop (an intermediary on a hold never carries a
//     warm path). An intro candidate then goes through filters.ts candidateReason (involvesMinor,
//     the `via` checks, memberReason, pairReason, the presence overlap).
//   - geo (packages/engine/src/geo.ts cityBucketGeo): a member is in one city now; a pair or a group
//     needs a common city (overlap). Hours and intervals are abstracted to "same city".
//   - complementarity (packages/engine/src/complementarity.ts): romanceMutual gives a romance score
//     only when both members opted in; the networkPack pair rule romance_incompatible
// (packs/network/rules.ts) is the hard gate. The friends pack excludes the romance lane
//     (packs/friends/rules.ts romance_excluded).
//   - group composition (packages/engine/src/group.ts composeGroup): minors leave the pool, compat is
//     -Infinity for a pair that pairReason refuses, the primary group is minSize..maxSize members with
//     a common city, and each alternate is compatible with each primary member. The ConsentNetwork
// then filters the alternates (packages/network/src/network.ts distinctAlternates, called at 2222).
//   - the friends planner (packages/engine/src/packs/friends/planner.ts planFriendsWeek) in its pass
//     order: 1 crew sessions, 2 crew offers (plans.ts detectCrews), 3 same table again (repeats),
//     4 new plans (tables and planProposals), 5 activity partners. `taken` (passes 1-3) and `used`
//     (passes 4-5) are the code's sets. The default policy has spreadNew=false, so `busy` is empty.
//     Pass 4 can also give a partner plan of two (run() -> planProposals with partnerPlans =
// pol.partnerFallback, default true; planner.ts) for members who attended a group meetup
//     (an oracle here).
//
// ABSTRACTIONS (quint/README.md rule 7)
//   - Scores, embeddings, the channels, venue choice and transit times are oracles. finish()
// (planner.ts) drops invitees for transit as an oracle and fills from alternates, as the code.
//   - Six adults a..f, one member k aged 15, and the teen-rule members t (17), u (18), v (19), w (16) and
//     y (17). Any member can state a lower age later (minor).
//   - The friends planner's activity and place are one value: "run" is an all-ages activity at an
//     all-ages public place (a park), "dinner" is an entry for adults only (ageMin 18). The planner's
//     slot, venue and transit choices stay oracles; finish() and teenPlanReason are `teenPlanOk`.
//   - planner.ts valuedSubset (the largest subset of a crew or of the positive attendees in which every pair
//     has a pair value) is not modeled. A crew session or crew offer whose members with a minor fail
//     teenPlanOk is refused here (the `refused` branch); the code can seat a smaller valued subset instead.
//     The model has fewer teen traces than the code there.
//   - The teen roster bound teenRosterMaximum 6 (spec/friendIntroAge.md) is scaled to TEEN_MAX = 3, so
//     that a roster one over the bound can be built from four members who pass every pair (t, u, w, y).
//   - Group sizes are scaled: the friends group bound 3..6 (rules.ts group_size, FRIENDS_PLANS.size)
//     is MIN_G..MAX_G = 3..4 here, so that the upper bound can be reached with six adults.
//     pos.slice(0, 6) in the repeat pass is "any MAX_G of them" (an over-approximation).
//   - Activities are "run" and "dinner". A crew is (activity, members). Handed-off crews are not live.
//   - Each flag in `h` is set at the moment the code emits a pool, candidate, group or plan, and it
//     uses the facts of that moment (blocks, holds, ages, opt-in, cities).
//
// VALUES THAT ARE NOT IN `safety` (each one is a defect that this model found; the code is not changed;
// each has a run test that reaches it):
// The ConsentNetwork repairs it (network.ts), so `blockedApart` holds for the submitted group.
// noSessionBlocked planner.ts: a crew session invites every eligible crew member and
//                            has no block check. A block made after the crew formed is not seen.
// noOfferBlocked planner.ts and plans.ts detectCrews: a crew offer has no block check.
// oneCrewPerWeek planner.ts: the crew session pass does not read `taken`, so a
//                            member in two live crews gets two crew sessions in one week. Two live
//                            crews are possible: detectCrews keys "already in a crew" by activity,
//                            and a crew session that finish() refuses leaves the member out of `taken`.
// sessionSizeOk planner.ts: a crew session needs only 2 eligible members, below the
//                            friends group bound of 3 (rules.ts group_size). This can be intended.
//
// TEEN FRIEND INTRODUCTIONS (owner decision 2026-11-22, spec/friendIntroAge.md, teenFriendAgeRule)
//   - `teenStopped` is the stored staff stop (default false: on from the start; teenStop and teenResume).
//   - Ages come from fixed birth keys on one day key (DAY): minDay = maxDay = DAY. The birthday rise
//     and the sweep of open items are in the opportunity and relay models; here every flag is set at
//     the moment of emission with the facts of that moment.
//   - k (15), t (17), u (18), v (19), w (16) and y (17) have exact birth dates (`ready`, no staff step).
//     k and t are 2 years and 1 day apart; t, u, w and y are within 2 years of each other; t and v are
//     within 2 years, but v is 19.
//   - A lost readiness (a report, a signal, a conflict, a bar) is `loseReady`. A stated minor age also
//     clears readiness (no exact birth date agrees with it).
//   - The friendship lane is `social` in the friends pack and in the network pack (spec/matchLane.md
//     teenFriendCategory; the friends `hobby` category is the same decision and is not modeled separately).
//   - The generator of an intro (spec/matchLane.md teenGenerator) and its shape (spec/friendIntroAge.md
//     teenIntroShape) are checked for a roster with a minor (filters.ts candidateAgeReason).
//   - The friends planner seats a minor (plans.ts planMemberReason with teenPlanSeat) only in a roster
//     that passes `teenPlanOk`: plans.ts crewSessionPlan and teenPlanReason, planner.ts teenGroupReason
//     in compatibleAlternates and growTable, friendsPartnerEligible and finish().
//   - Not modeled: the teen friend_circle groups of match/circles.ts buildCircles (3 or more members,
//     candidateAgeReason = groupAgeAllowed over participants and alternates) and the teen activity_partner
//     intros. composeGroup here is group.ts, which drops every minor. The engine integration test
//     packages/engine/test/teen-friend-age.integration.test.ts covers the circle and partner paths.
//
// RUN (from the repository root; quint 0.33.1)
//   pnpm run quint:check quint/candidate_pool.qnt
module candidate_pool {

  // ------------------------------------------------------------------ constants
  pure val MEMBERS = Set("a", "b", "c", "d", "e", "f", "k", "t", "u", "v", "w", "y")
  pure val START_AGE = Map("a" -> 30, "b" -> 28, "c" -> 33, "d" -> 41, "e" -> 25, "f" -> 36, "k" -> 15,
                           "t" -> 17, "u" -> 18, "v" -> 19, "w" -> 16, "y" -> 17)
  pure val DAY = 20261122
  pure val BIRTH = Map("a" -> 19960101, "b" -> 19980101, "c" -> 19930101, "d" -> 19850101, "e" -> 20010101,
                       "f" -> 19900101, "k" -> 20110102, "t" -> 20090101, "u" -> 20081122, "v" -> 20071122,
                       "w" -> 20100301, "y" -> 20090601)
  pure val START_READY = Set("k", "t", "u", "v", "w", "y")
  pure val CITIES = Set("nyc", "la")
  pure val ACTS = Set("run", "dinner")
  pure val ALL_AGES_ACTS = Set("run")  // activityAllAges and venueAllAges (packs/network/activities.ts)
  pure val TEEN_MAX = 3                // teenRosterMaximum 6, scaled (see ABSTRACTIONS)
  pure val LANES = Set("social", "romance")
  pure val PACKS = Set("network", "friends")
  // Warm edges (World.positive) for twoHop: a-b-c, a-k-d (k is the minor), c-e.
  pure val POSITIVE = Set(Set("a", "b"), Set("b", "c"), Set("a", "k"), Set("k", "d"), Set("c", "e"))
  pure val MIN_G = 3                 // rules.ts group_size min 3; FRIENDS_PLANS.size.min 3
  pure val MAX_G = 4                 // rules.ts group_size max 6, scaled (see ABSTRACTIONS)
  pure val PARTNER_INTROS = 1        // DEFAULT_FRIENDS_POLICY.partnerIntros
  pure val NO_ONE = ""

  // ------------------------------------------------------------------ types
  type Crew = { act: str, members: Set[str] }
  type Outcome = { id: str, act: str, attended: Set[str], positive: Set[str] }
  type Week = {
    phase: str,                       // "idle", "sessions", "offers", "repeats", "new"
    taken: Set[str], used: Set[str],
    detected: Set[Crew],              // crews that detectCrews found this week (its own inCrew set)
    sessionsDone: Set[Crew], outcomesDone: Set[str], repeatsDone: Set[str],
    crewCount: str -> int,            // crews (session or offer) this member is in this week
    partnerCount: str -> int,
  }
  type Hist = {
    // retrieval and intro candidates
    poolUnsafe: bool, introMinor: bool, introBlocked: bool, introViaUnsafe: bool,
    introRomanceOneSided: bool, introApart: bool, romanceScoredOneSided: bool, friendsRomance: bool,
    // group composition
    groupMinor: bool, groupBlocked: bool, groupAltBlockedWithPrimary: bool, groupSizeBad: bool,
    groupApart: bool, groupRomanceOneSided: bool, submittedBlocked: bool, altPairBlockedEngine: bool,
    // friends planner
    sessionMinor: bool, sessionBlocked: bool, sessionUnderMin: bool,
    offerMinor: bool, offerBlocked: bool, offerInvitedTwice: bool, offerSizeBad: bool,
    repeatMinor: bool, repeatBlocked: bool, repeatSizeBad: bool,
    planMinor: bool, planBlocked: bool, planSizeBad: bool, planSeatTwice: bool,
    partnerMinor: bool, partnerBlocked: bool, partnerOverCap: bool,
    crewTwice: bool,
    introViaMinor: bool, minorWhileOff: bool,
  }
  type Count = { scores: int, intros: int, romanceIntros: int, groups: int, sessions: int, offers: int, repeats: int, plans: int, pairPlans: int, partners: int, weeks: int, teenIntros: int, teenPlans: int }

  // ------------------------------------------------------------------ state
  var pack: str
  var minor: str -> bool
  var held: str -> bool
  var optIn: str -> bool
  var city: str -> str
  var blocked: Set[Set[str]]
  var pool: Set[str]
  var anchor: str
  var crews: Set[Crew]
  var offered: Set[Crew]
  var outcomes: Set[Outcome]
  var wk: Week
  var h: Hist
  var n: Count
  var lastAction: str
  var teenStopped: bool
  var ready: str -> bool

  // ------------------------------------------------------------------ pure helpers (the decisions)
  pure def isBlocked(bl: Set[Set[str]], x: str, y: str): bool = bl.contains(Set(x, y))
  pure def pairwiseOk(bl: Set[Set[str]], s: Set[str]): bool =
    s.forall(x => s.forall(y => x == y or not(isBlocked(bl, x, y))))
  pure def crossOk(bl: Set[Set[str]], s: Set[str], t: Set[str]): bool =
    s.forall(x => t.forall(y => x == y or not(isBlocked(bl, x, y))))
  pure def sameCity(c: str -> str, s: Set[str]): bool = s.forall(x => s.forall(y => c.get(x) == c.get(y)))
  pure def anyIn(s: Set[str], f: str -> bool): bool = s.exists(x => f.get(x))

  pure val emptyWeek: Week = {
    phase: "idle", taken: Set(), used: Set(), detected: Set(), sessionsDone: Set(), outcomesDone: Set(), repeatsDone: Set(),
    crewCount: MEMBERS.mapBy(m => 0), partnerCount: MEMBERS.mapBy(m => 0),
  }
  pure val noHist: Hist = {
    poolUnsafe: false, introMinor: false, introBlocked: false, introViaUnsafe: false,
    introRomanceOneSided: false, introApart: false, romanceScoredOneSided: false, friendsRomance: false,
    groupMinor: false, groupBlocked: false, groupAltBlockedWithPrimary: false, groupSizeBad: false,
    groupApart: false, groupRomanceOneSided: false, submittedBlocked: false, altPairBlockedEngine: false,
    sessionMinor: false, sessionBlocked: false, sessionUnderMin: false,
    offerMinor: false, offerBlocked: false, offerInvitedTwice: false, offerSizeBad: false,
    repeatMinor: false, repeatBlocked: false, repeatSizeBad: false,
    planMinor: false, planBlocked: false, planSizeBad: false, planSeatTwice: false,
    partnerMinor: false, partnerBlocked: false, partnerOverCap: false,
    crewTwice: false,
    introViaMinor: false, minorWhileOff: false,
  }

  // spec/memberAge.md ageOnDay and spec/friendIntroAge.md teenPartnerAge, birthKeysWithinTwoYears.
  pure def ageOnDay(birthKey: int, dayKey: int): int = if (dayKey >= birthKey) (dayKey - birthKey) / 10000 else -1
  pure def teenAgesOk(birthKey: int): bool = ageOnDay(birthKey, DAY) >= 13 and ageOnDay(birthKey, DAY) <= 18
  pure def withinTwoYears(x: int, y: int): bool = if (x >= y) x - y <= 20000 else y - x <= 20000
  // spec/matchLane.md teenFriendCategory: friends.help, category social (or hobby), and The Network, category
  // social (the Friend lane, owner decision 2026-11-22, answer A2).
  def friendshipLane(lane: str): bool = (pack == "friends" or pack == "network") and lane == "social"
  // spec/matchLane.md teenGenerator: the allow-list of friendship generators that may make a teen item.
  pure def teenGenerator(app: str, generator: str): bool =
    (app == "ntwrk" and (generator == "intent_to_capability" or generator == "group_composer" or generator == "request"))
      or (app == "friends" and (generator == "friend_circle" or generator == "activity_partner" or generator == "request"
        or generator == "plan" or generator == "friends_repeat" or generator == "crew"))
  pure def appOf(p: str): str = if (p == "network") "ntwrk" else p
  // spec/friendIntroAge.md teenIntroShape for a pair intro: one_to_one (an event anchor is the event format),
  // every role peer, no via.
  pure def teenIntroShape(friendshipLaneOk: bool, format: str, everyRoleTeen: bool, hasVia: bool, eventAnchored: bool): bool =
    friendshipLaneOk and (format == "one_to_one" or format == "small_group") and everyRoleTeen and not(hasVia) and not(eventAnchored)
  pure def formatOf(gen: str): str = if (gen == "event_anchor") "event" else "one_to_one"
  // filters.ts candidateAgeReason: the roster rule, and for a roster with a minor the generator, the shape and
  // the size (a pair is size 2).
  def teenIntroOk(involved: Set[str], lane: str, useVia: bool, gen: str): bool =
    rosterOk(involved, lane) and (not(involved.exists(m => minor.get(m)))
      or (teenGenerator(appOf(pack), gen) and teenIntroShape(friendshipLane(lane), formatOf(gen), true, useVia, gen == "event_anchor")))
  // spec/friendIntroAge.md pairAgeAllowed, with adult = not(minor) and the stored switch.
  def sideOk(x: str, y: str, lane: str): bool =
    (not(minor.get(x)) and not(minor.get(y)))
      or (not(teenStopped) and friendshipLane(lane) and ready.get(x) and ready.get(y)
          and teenAgesOk(BIRTH.get(x)) and teenAgesOk(BIRTH.get(y))
          and (ageOnDay(BIRTH.get(x), DAY) < 18 or ageOnDay(BIRTH.get(y), DAY) < 18)
          and withinTwoYears(BIRTH.get(x), BIRTH.get(y)))
  // spec/friendIntroAge.md groupAgeAllowed over the whole roster (each pair, self included).
  def rosterOk(s: Set[str], lane: str): bool = s.forall(x => s.forall(y => sideOk(x, y, lane)))
  // spec/friendIntroAge.md teenFriendCandidate (filters.ts teenCandidateIn).
  def teenCandidate(m: str, lane: str): bool = all {
    minor.get(m), not(teenStopped), friendshipLane(lane), ready.get(m),
    teenAgesOk(BIRTH.get(m)), ageOnDay(BIRTH.get(m), DAY) < 18,
  }

  // filters.ts memberReason core prefix (minors, holds) plus the pack rule for the lane: networkPack
  // romance_opt_out (packs/network/rules.ts), friendsPack romance_excluded (packs/friends/rules.ts).
  // The age prefix is skipped only for a teen friend candidate (P1).
  def memberOk(m: str, lane: str): bool = all {
    not(minor.get(m)) or teenCandidate(m, lane), not(held.get(m)),
    lane == "romance" implies (pack == "network" and optIn.get(m)),
  }
  // filters.ts pairReason: duplicate, the pair age rule (pairAgeAllowed, P2), blocks, then
  // romance_incompatible (both opted in) and, for friends, romance_excluded on the lane.
  def pairOk(x: str, y: str, lane: str): bool = all {
    x != y, sideOk(x, y, lane), not(isBlocked(blocked, x, y)),
    lane == "romance" implies (pack == "network" and optIn.get(x) and optIn.get(y)),
  }
  // group.ts makeCompat: -Infinity (false here) when pairReason refuses the pair.
  def compat(x: str, y: str, lane: str): bool = pairOk(x, y, lane)
  // complementarity.ts romanceMutual: both opted in (the orientation and age-range checks are an oracle
  // that can only remove).
  def romanceMutual(x: str, y: str): bool = optIn.get(x) and optIn.get(y)
  // The pack ontology mutualPreferenceMatch that complementarity.ts satisfy calls: networkPack uses
  // romanceMutual (packs/network/ontology.ts), friendsPack is always false (packs/friends/index.ts).
  def romanceSat(x: str, y: str): bool = if (pack == "network") romanceMutual(x, y) else false
  // plans.ts planMemberReason, as the planner's `eligible`: an adult, or a teen plan seat (teenPlanSeat:
  // friends.help and a teen friend candidate in the plans lane), and no hold.
  def planEligible(m: str): bool = (not(minor.get(m)) or (pack == "friends" and teenCandidate(m, "social"))) and not(held.get(m))
  // plans.ts teenPlanReason and crewSessionPlan, planner.ts teenGroupReason and finish(): a roster with a
  // minor is a friends.help plan (teenGroupPlanApp) of 2..TEEN_MAX people (teenRosterSizeAllowed) in which
  // every pair passes the pair rule (groupAgeAllowed), at an all-ages activity and place
  // (planActivityOffered, planPlaceOffered).
  def teenPlanOk(g: Set[str], act: str): bool =
    not(g.exists(m => minor.get(m)))
      or (pack == "friends" and g.size() >= 2 and g.size() <= TEEN_MAX and rosterOk(g, "social") and ALL_AGES_ACTS.contains(act))
  def minorSeated(g: Set[str]): bool = g.exists(m => minor.get(m))
  // retrieval.ts twoHop: the intermediary is a direct warm neighbour of `a` with no hold (paused is a hold here).
  def viaCandidates(a: str, b: str): Set[str] =
    MEMBERS.filter(x => POSITIVE.contains(Set(a, x)) and POSITIVE.contains(Set(x, b)) and not(held.get(x)) and x != b)

  // ------------------------------------------------------------------ init
  action initWith(p: str): bool = all {
    pack' = p,
    minor' = MEMBERS.mapBy(m => START_AGE.get(m) < 18),
    teenStopped' = false,
    ready' = MEMBERS.mapBy(m => START_READY.contains(m)),
    held' = MEMBERS.mapBy(m => false),
    optIn' = MEMBERS.mapBy(m => m == "a" or m == "b" or m == "c"),
    city' = MEMBERS.mapBy(m => if (m == "f") "la" else "nyc"),
    blocked' = Set(),
    pool' = Set(), anchor' = NO_ONE,
    // One live crew and one recent great plan, so that each pass has work at once.
    crews' = Set({ act: "run", members: Set("a", "b", "c") }),
    offered' = Set(),
    outcomes' = Set({ id: "o1", act: "dinner", attended: Set("a", "d", "e", "f"), positive: Set("a", "d", "e") }),
    wk' = emptyWeek, h' = noHist,
    n' = { scores: 0, intros: 0, romanceIntros: 0, groups: 0, sessions: 0, offers: 0, repeats: 0, plans: 0, pairPlans: 0, partners: 0, weeks: 0, teenIntros: 0, teenPlans: 0 },
    lastAction' = "init",
  }
  action init = {
    nondet p = PACKS.oneOf()
    initWith(p)
  }

  action keepPlanner = all { crews' = crews, offered' = offered, outcomes' = outcomes, wk' = wk }
  action keepWorld = all { pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city, blocked' = blocked,
                           teenStopped' = teenStopped, ready' = ready }
  action keepPool = all { pool' = pool, anchor' = anchor }

  // ================================================================== world changes (other actors)
  action blockPair(x: str, y: str): bool = all {
    x != y, not(isBlocked(blocked, x, y)),
    blocked' = blocked.union(Set(Set(x, y))),
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city,
    teenStopped' = teenStopped, ready' = ready,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "blockPair",
  }
  // AGENTS.md platform decision 1: the lowest age ever stated wins. A stated minor age that no exact
  // birth date agrees with is an age conflict: the member is no longer teen ready.
  action statesMinorAge(m: str): bool = all {
    not(minor.get(m)), minor' = minor.set(m, true), ready' = ready.set(m, false),
    pack' = pack, held' = held, optIn' = optIn, city' = city, blocked' = blocked, teenStopped' = teenStopped,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "statesMinorAge",
  }
  // spec/friendIntroAge.md teenReady: a report, an open signal, a conflict or a bar ends readiness at once.
  action loseReady(m: str): bool = all {
    ready.get(m), ready' = ready.set(m, false),
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city, blocked' = blocked, teenStopped' = teenStopped,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "loseReady",
  }
  // spec/teenIntroSwitch.md: teen introductions are on from the start; one staff member stops them and one admin
  // turns them on again (the staff roles are in review_desk and opportunity).
  action teenStop: bool = all {
    not(teenStopped), teenStopped' = true,
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city, blocked' = blocked, ready' = ready,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "teenStop",
  }
  action teenResume: bool = all {
    teenStopped, teenStopped' = false,
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city, blocked' = blocked, ready' = ready,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "teenResume",
  }
  action setHold(m: str, v: bool): bool = all {
    held' = held.set(m, v),
    pack' = pack, minor' = minor, optIn' = optIn, city' = city, blocked' = blocked,
    teenStopped' = teenStopped, ready' = ready,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "setHold",
  }
  action setOptIn(m: str, v: bool): bool = all {
    optIn.get(m) != v, optIn' = optIn.set(m, v),
    pack' = pack, minor' = minor, held' = held, city' = city, blocked' = blocked,
    teenStopped' = teenStopped, ready' = ready,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "setOptIn",
  }
  // geo.ts location: a dated trip overrides home.
  action travel(m: str, c: str): bool = all {
    city.get(m) != c, city' = city.set(m, c),
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, blocked' = blocked,
    teenStopped' = teenStopped, ready' = ready,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "travel",
  }

  // ================================================================== retrieval (retrieval.ts)
  // eligibleMembers then the channel union: `kept` is the channels' oracle subset of the eligible members.
  action retrieve(a: str, lane: str, kept: Set[str]): bool = {
    val eligible = MEMBERS.filter(m => m != a and memberOk(m, lane))
    all {
      kept.subseteq(eligible),
      pool' = kept, anchor' = a,
      h' = { ...h,
        poolUnsafe: h.poolUnsafe or kept.exists(m => (minor.get(m) and not(teenCandidate(m, lane))) or held.get(m)),
        minorWhileOff: h.minorWhileOff or (teenStopped and kept.exists(m => minor.get(m))),
      },
      keepWorld, keepPlanner, n' = n, lastAction' = "retrieve",
    }
  }

  // One intro candidate from the pool, through candidateReason. `useVia`: the graph channel names an
  // intermediary (twoHop, the warm_path generator); candidateReason drops a minor, held or blocked `via`, and
  // any `via` for a roster with a minor (viaAllowedForRoster, P3 and P4). `gen` is the generator: a pair with
  // no via comes from intent_to_capability (network) or activity_partner (friends).
  pure def defaultGen(p: str, useVia: bool): str =
    if (useVia) "warm_path" else if (p == "network") "intent_to_capability" else "activity_partner"
  action intro(b: str, lane: str, useVia: bool, v: str): bool = introBy(b, lane, useVia, v, defaultGen(pack, useVia))
  action introBy(b: str, lane: str, useVia: bool, v: str, gen: str): bool = {
    val a = anchor
    val viaOk = if (useVia) all {
      viaCandidates(a, b).contains(v), not(minor.get(v)), not(held.get(v)),
      not(isBlocked(blocked, a, v)), not(isBlocked(blocked, b, v)),
      not(minor.get(a)), not(minor.get(b)),
    } else true
    val viaBad = if (useVia) held.get(v) or isBlocked(blocked, a, v) or isBlocked(blocked, b, v) else false
    val involved = if (useVia) Set(a, b, v) else Set(a, b)
    all {
      a != NO_ONE, pool.contains(b),
      teenIntroOk(involved, lane, useVia, gen),         // filters.ts candidateAgeReason (groupAgeAllowed, teenGenerator, teenIntroShape)
      viaOk, // filters.ts
      memberOk(a, lane), memberOk(b, lane), // filters.ts memberReason
      pairOk(a, b, lane), // filters.ts pairReason
      city.get(a) == city.get(b), // filters.ts presence overlap (geo.ts overlap)
      // complementarity.ts satisfy: a romance want scores SAT.romance only when romanceMutual holds.
      val romanceScore = lane == "romance" and romanceSat(a, b)
      all {
        h' = { ...h,
          introMinor: h.introMinor or not(teenIntroOk(involved, lane, useVia, gen)),
          introViaMinor: h.introViaMinor or (useVia and involved.exists(m => minor.get(m))),
          minorWhileOff: h.minorWhileOff or (teenStopped and involved.exists(m => minor.get(m))),
          introBlocked: h.introBlocked or isBlocked(blocked, a, b),
          introViaUnsafe: h.introViaUnsafe or viaBad,
          introRomanceOneSided: h.introRomanceOneSided or (lane == "romance" and not(optIn.get(a) and optIn.get(b))),
          introApart: h.introApart or city.get(a) != city.get(b),
          romanceScoredOneSided: h.romanceScoredOneSided or (romanceScore and not(optIn.get(a) and optIn.get(b))),
          friendsRomance: h.friendsRomance or (pack == "friends" and lane == "romance"),
        },
        n' = { ...n, intros: n.intros + 1, romanceIntros: n.romanceIntros + (if (lane == "romance") 1 else 0),
               teenIntros: n.teenIntros + (if (involved.exists(m => minor.get(m))) 1 else 0) },
      },
      keepWorld, keepPool, keepPlanner, lastAction' = "intro",
    }
  }

  // complementarity.ts complementarity: the score of a pool pair, with no hard filter before it
  // (ranking runs on the pool, and the hard gate comes later). A romance want scores SAT.romance
  // only when the ontology says that both sides admit each other. This is the only gate on the
  // score, so romanceScoredOneSided depends on romanceSat alone.
  action scorePair(b: str): bool = all {
    anchor != NO_ONE, pool.contains(b), b != anchor,
    h' = { ...h, romanceScoredOneSided: h.romanceScoredOneSided or (romanceSat(anchor, b) and not(optIn.get(anchor) and optIn.get(b))) },
    n' = { ...n, scores: n.scores + 1 },
    keepWorld, keepPool, keepPlanner, lastAction' = "scorePair",
  }

  // ================================================================== group composition (group.ts)
  // composeGroup on the current pool: minors leave the pool (group.ts), the primary group is
  // pairwise compatible (evaluateGroup -> null on -Infinity), MIN_G..MAX_G members (the beam stops at
  // maxSize; `complete` needs minSize) with a common city (overlap). Alternates (group.ts):
  // each is compatible with each primary member and each retained alternate, in the group's city. Then candidateReason
  // (group_size for friends, involvesMinor, memberReason, pairReason over participants), and the
  // ConsentNetwork distinctAlternates (network.ts): `kept` is its result. distinctAlternates also
  // drops a member with unknown age or a minor signal (here: minor) and a second person with the same
  // first name as someone already in it (an oracle here), so any alternate can be dropped.
  action composeGroup(lane: str, primary: Set[str], alts: Set[str], kept: Set[str]): bool = {
    val cand = pool.filter(m => not(minor.get(m)))
    all {
      primary.subseteq(cand), primary.size() >= MIN_G, primary.size() <= MAX_G,
      primary.forall(x => primary.forall(y => x == y or compat(x, y, lane))),
      sameCity(city, primary),
      alts.subseteq(cand.exclude(primary)),
      alts.forall(y => primary.forall(x => compat(x, y, lane)) and primary.forall(x => city.get(x) == city.get(y))),
      alts.forall(x => alts.forall(y => x == y or compat(x, y, lane))),
      // candidateReason
      not(primary.union(alts).exists(m => minor.get(m))),
      primary.forall(m => memberOk(m, lane)),
      // distinctAlternates: drops minors, anyone blocked with a participant or a kept alternate, and
      // first-name duplicates (any other alternate, an oracle).
      kept.subseteq(alts), kept.forall(m => not(minor.get(m))),
      crossOk(blocked, primary, kept), pairwiseOk(blocked, kept),
      h' = { ...h,
        groupMinor: h.groupMinor or primary.union(alts).exists(m => minor.get(m)),
        groupBlocked: h.groupBlocked or not(pairwiseOk(blocked, primary)),
        groupAltBlockedWithPrimary: h.groupAltBlockedWithPrimary or not(crossOk(blocked, primary, alts)),
        groupSizeBad: h.groupSizeBad or primary.size() < MIN_G or primary.size() > MAX_G,
        groupApart: h.groupApart or not(sameCity(city, primary.union(alts))),
        groupRomanceOneSided: h.groupRomanceOneSided or (lane == "romance" and primary.exists(m => not(optIn.get(m)))),
        friendsRomance: h.friendsRomance or (pack == "friends" and lane == "romance"),
        submittedBlocked: h.submittedBlocked or not(pairwiseOk(blocked, primary.union(kept))),
        altPairBlockedEngine: h.altPairBlockedEngine or not(pairwiseOk(blocked, alts)),
      },
      n' = { ...n, groups: n.groups + 1 },
      keepWorld, keepPool, keepPlanner, lastAction' = "composeGroup",
    }
  }

  // ================================================================== friends planner (planner.ts planFriendsWeek)
  action startWeek: bool = all {
    pack == "friends", wk.phase == "idle",
    wk' = { ...emptyWeek, phase: "sessions" },
    crews' = crews, offered' = offered, outcomes' = outcomes,
    keepWorld, keepPool, h' = h, n' = n, lastAction' = "startWeek",
  }
  action nextPhase: bool = {
    val nxt = if (wk.phase == "sessions") "offers" else if (wk.phase == "offers") "repeats" else if (wk.phase == "repeats") "new" else "idle"
    all {
      pack == "friends", wk.phase != "idle",
      wk' = if (nxt == "idle") emptyWeek else { ...wk, phase: nxt },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, h' = h, n' = if (nxt == "idle") { ...n, weeks: n.weeks + 1 } else n,
      lastAction' = "nextPhase",
    }
  }

  // Pass 1 (planner.ts): members = crew.members.filter(eligible); at least 2; crewSessionPlan;
  // finish() may drop invitees for transit (`invited`) and returns null under the quorum min(3, n).
  // `refused`: crewSessionPlan or finish() returned null (no session, nobody taken). A session with a minor
  // needs teenPlanOk over the crew's seated members (crewSessionPlan) and over the invitees (finish()).
  action crewSession(c: Crew, invited: Set[str], refused: bool): bool = {
    val members = c.members.filter(m => planEligible(m))
    val ok = not(refused) and members.size() >= 2
    all {
      wk.phase == "sessions", crews.contains(c), not(wk.sessionsDone.contains(c)),
      if (ok) all {
        invited.subseteq(members), invited.size() >= (if (members.size() < 3) members.size() else 3),
        teenPlanOk(members, c.act), teenPlanOk(invited, c.act),
      } else invited == Set(),
      wk' = { ...wk, sessionsDone: wk.sessionsDone.union(Set(c)),
              taken: wk.taken.union(invited),
              crewCount: if (ok) MEMBERS.mapBy(m => wk.crewCount.get(m) + (if (invited.contains(m)) 1 else 0)) else wk.crewCount },
      h' = if (not(ok)) h else { ...h,
        sessionMinor: h.sessionMinor or not(teenPlanOk(invited, c.act)),
        minorWhileOff: h.minorWhileOff or (teenStopped and minorSeated(invited)),
        sessionBlocked: h.sessionBlocked or not(pairwiseOk(blocked, invited)),
        sessionUnderMin: h.sessionUnderMin or invited.size() < MIN_G,
        crewTwice: h.crewTwice or invited.exists(m => wk.crewCount.get(m) >= 1),
      },
      n' = if (ok) { ...n, sessions: n.sessions + 1, teenPlans: n.teenPlans + (if (minorSeated(invited)) 1 else 0) } else n,
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "crewSession",
    }
  }

  // Pass 2 (planner.ts, plans.ts detectCrews with minPlans 1): the positive members of a
  // recent outcome who are not in a crew (live or offered at the start of the week) of that activity,
  // and not in a crew that detectCrews found this week (`detected`: its inCrew set grows by every crew
  // it finds, also one that the planner then skips); then filter eligible and not taken; at least
  // minMembers (3); finish() keeps `invited` (quorum 3) or refuses.
  action crewOffer(o: Outcome, invited: Set[str], refused: bool): bool = {
    val inCrew = crews.union(offered).union(wk.detected).filter(c => c.act == o.act).fold(Set(), (s, c) => s.union(c.members))
    val pos = o.positive.exclude(inCrew)
    val members = pos.filter(m => planEligible(m) and not(wk.taken.contains(m)))
    val ok = not(refused) and pos.size() >= MIN_G and members.size() >= MIN_G
    all {
      wk.phase == "offers", outcomes.contains(o), not(wk.outcomesDone.contains(o.id)),
      if (ok) all { invited.subseteq(members), invited.size() >= MIN_G, teenPlanOk(members, o.act), teenPlanOk(invited, o.act) } else invited == Set(),
      wk' = { ...wk, outcomesDone: wk.outcomesDone.union(Set(o.id)), taken: wk.taken.union(invited),
              detected: if (pos.size() >= MIN_G) wk.detected.union(Set({ act: o.act, members: pos })) else wk.detected,
              // The offered crew is c2 (all `members`), so every member of it is in that crew this week.
              crewCount: if (ok) MEMBERS.mapBy(m => wk.crewCount.get(m) + (if (members.contains(m)) 1 else 0)) else wk.crewCount },
      offered' = if (ok) offered.union(Set({ act: o.act, members: members })) else offered,
      h' = if (not(ok)) h else { ...h,
        offerMinor: h.offerMinor or not(teenPlanOk(members, o.act)),
        minorWhileOff: h.minorWhileOff or (teenStopped and minorSeated(members)),
        offerBlocked: h.offerBlocked or not(pairwiseOk(blocked, members)),
        offerInvitedTwice: h.offerInvitedTwice or invited.exists(m => wk.taken.contains(m)),
        offerSizeBad: h.offerSizeBad or invited.size() < MIN_G,
        crewTwice: h.crewTwice or members.exists(m => wk.crewCount.get(m) >= 1),
      },
      n' = if (ok) { ...n, offers: n.offers + 1, teenPlans: n.teenPlans + (if (minorSeated(members)) 1 else 0) } else n,
      crews' = crews, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "crewOffer",
    }
  }

  // Pass 3 (planner.ts): pos = positive, eligible, not taken; at least 2; ids = up to MAX_G of
  // them (slice). Every pair in the table, including up to 2 eligible alternates from prior
  // attendees, needs a Friend value. The model abstracts value and order but keeps the block
  // and compatibility guards. finish() drops members for transit and fills from compatible alternates.
  action repeatPlan(o: Outcome, ids: Set[str], alts: Set[str], dropped: Set[str], fill: Set[str]): bool = {
    val pos = o.positive.filter(m => planEligible(m) and not(wk.taken.contains(m)))
    val partner = ids.size() == 2
    val altPool = o.attended.exclude(ids).filter(m => planEligible(m) and not(wk.taken.contains(m))
      and ids.forall(p => compat(m, p, "social")) and (minorSeated(ids) or not(minor.get(m))))
    val invited = ids.exclude(dropped).union(fill)
    val altsLeft = alts.exclude(fill)
    val quorum = if (partner) 2 else 3
    all {
      wk.phase == "repeats", outcomes.contains(o), not(wk.repeatsDone.contains(o.id)),
      pos.size() >= 2,
      ids.subseteq(pos), ids.size() == (if (pos.size() < MAX_G) pos.size() else MAX_G),
      pairwiseOk(blocked, ids),
      alts.subseteq(altPool), alts.size() <= (if (partner) 0 else 2),
      alts.forall(x => alts.forall(y => x == y or compat(x, y, "social"))),
      dropped.subseteq(ids), fill.subseteq(alts),
      fill.size() == (if (partner) 0 else (if (dropped.size() < alts.size()) dropped.size() else alts.size())),
      invited.size() >= quorum,
      teenPlanOk(ids.union(alts), o.act), teenPlanOk(invited.union(altsLeft), o.act),
      wk' = { ...wk, repeatsDone: wk.repeatsDone.union(Set(o.id)), taken: wk.taken.union(invited).union(altsLeft) },
      h' = { ...h,
        repeatMinor: h.repeatMinor or not(teenPlanOk(invited.union(altsLeft), o.act)),
        minorWhileOff: h.minorWhileOff or (teenStopped and minorSeated(invited.union(altsLeft))),
        repeatBlocked: h.repeatBlocked or not(pairwiseOk(blocked, invited.union(altsLeft))),
        repeatSizeBad: h.repeatSizeBad or (if (partner) invited.size() != 2 else (invited.size() < MIN_G or invited.size() > MAX_G)),
      },
      n' = { ...n, repeats: n.repeats + 1, teenPlans: n.teenPlans + (if (minorSeated(invited.union(altsLeft))) 1 else 0) },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "repeatPlan",
    }
  }

  // Pass 4 (planner.ts tables and run): the pool is eligible members not `used` (busy is empty
  // with spreadNew=false); scorePlanGroup is null for a -Infinity pair (plans.ts), so the whole
  // table (primary and alternates) is pairwise compatible; primary MIN_G..MAX_G (slice to size.max);
  // finish() keeps at least size.min invitees; used += invited + alternates. `partner`: run() gives a
  // partner plan of two with no alternates (planProposals partnerPlans; finish() quorum 2). `act` is the
  // activity and place. A teen table (tables with teen = true: a minor seeds it, growTable admits a member
  // only when teenGroupReason passes, at most teenRosterMaximum invitees) passes teenPlanOk (finish()).
  action newPlan(primary: Set[str], alts: Set[str], partner: bool, act: str): bool = {
    val cand = MEMBERS.filter(m => planEligible(m) and not(wk.used.contains(m)))
    val g = primary.union(alts)
    all {
      wk.phase == "new", ACTS.contains(act),
      primary.subseteq(cand), alts.subseteq(cand.exclude(primary)),
      if (partner) primary.size() == 2 and alts == Set() else primary.size() >= MIN_G and primary.size() <= MAX_G,
      g.forall(x => g.forall(y => x == y or compat(x, y, "social"))),
      teenPlanOk(g, act),
      wk' = { ...wk, used: wk.used.union(g) },
      h' = { ...h,
        planMinor: h.planMinor or not(teenPlanOk(g, act)),
        minorWhileOff: h.minorWhileOff or (teenStopped and minorSeated(g)),
        planBlocked: h.planBlocked or not(pairwiseOk(blocked, g)),
        planSizeBad: h.planSizeBad or (if (partner) primary.size() != 2 else (primary.size() < MIN_G or primary.size() > MAX_G)),
        planSeatTwice: h.planSeatTwice or g.exists(m => wk.used.contains(m)),
      },
      n' = { ...n, plans: n.plans + 1, pairPlans: n.pairPlans + (if (partner) 1 else 0),
             teenPlans: n.teenPlans + (if (minorSeated(g)) 1 else 0) },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "newPlan",
    }
  }

  // Pass 5 (planner.ts): activityPartner candidates passed candidateReason (pairReason,
  // memberReason, presence overlap); at most partnerIntros per member this run. friendsPartnerEligible
  // (memberReason with the teen seat, pairReason with the pair rule) admits a teen pair; pairActivity and
  // finish() keep it at an all-ages activity and place (teenPlanOk). `act` is the activity and place.
  action partnerPlan(x: str, y: str, act: str): bool = all {
    wk.phase == "new", ACTS.contains(act),
    planEligible(x), planEligible(y),
    pairOk(x, y, "social"), memberOk(x, "social"), memberOk(y, "social"), city.get(x) == city.get(y),
    teenPlanOk(Set(x, y), act),
    wk.partnerCount.get(x) < PARTNER_INTROS, wk.partnerCount.get(y) < PARTNER_INTROS,
    wk' = { ...wk, partnerCount: wk.partnerCount.setBy(x, v => v + 1).setBy(y, v => v + 1) },
    h' = { ...h,
      partnerMinor: h.partnerMinor or not(teenPlanOk(Set(x, y), act)),
      minorWhileOff: h.minorWhileOff or (teenStopped and minorSeated(Set(x, y))),
      partnerBlocked: h.partnerBlocked or isBlocked(blocked, x, y),
      partnerOverCap: h.partnerOverCap or wk.partnerCount.get(x) >= PARTNER_INTROS or wk.partnerCount.get(y) >= PARTNER_INTROS,
    },
    n' = { ...n, partners: n.partners + 1, teenPlans: n.teenPlans + (if (minorSeated(Set(x, y))) 1 else 0) },
    crews' = crews, offered' = offered, outcomes' = outcomes,
    keepWorld, keepPool, lastAction' = "partnerPlan",
  }

  // Between weeks: the members of an offered crew opt in (plans.ts crewOptIn: below minMembers there
  // is no crew), and a meetup ends with an outcome (who attended, who would do it again).
  action crewOptIn(c: Crew, yes: Set[str]): bool = all {
    wk.phase == "idle", offered.contains(c), yes.subseteq(c.members),
    offered' = offered.exclude(Set(c)),
    crews' = if (yes.size() >= MIN_G) crews.union(Set({ act: c.act, members: yes })) else crews,
    outcomes' = outcomes, wk' = wk,
    keepWorld, keepPool, h' = h, n' = n, lastAction' = "crewOptIn",
  }
  action meetup(id: str, act: str, attended: Set[str], positive: Set[str]): bool = all {
    wk.phase == "idle", not(outcomes.exists(o => o.id == id)),
    attended.size() >= MIN_G, positive.subseteq(attended),
    outcomes' = outcomes.union(Set({ id: id, act: act, attended: attended, positive: positive })),
    crews' = crews, offered' = offered, wk' = wk,
    keepWorld, keepPool, h' = h, n' = n, lastAction' = "meetup",
  }

  // The planner's own choices for one outcome, for random simulation (the oracle variants stay too).
  def repeatPos(o: Outcome): Set[str] = o.positive.filter(m => planEligible(m) and not(wk.taken.contains(m)))
  def repeatAlts(o: Outcome): Set[str] = o.attended.exclude(repeatPos(o)).filter(m => planEligible(m) and not(wk.taken.contains(m)))
  // These pick from a wide set on purpose; the action guards decide (a weakened guard then shows).
  def offerMembers(o: Outcome): Set[str] = {
    val inCrew = crews.union(offered).filter(c => c.act == o.act).fold(Set(), (s, c) => s.union(c.members))
    o.positive.exclude(inCrew).filter(m => planEligible(m))
  }
  // detectCrews alone (no eligibility, no `taken`): the crewOffer guard must remove the rest.
  def offerPositive(o: Outcome): Set[str] = {
    val inCrew = crews.union(offered).filter(c => c.act == o.act).fold(Set(), (s, c) => s.union(c.members))
    o.positive.exclude(inCrew)
  }

  action stutter = all { keepWorld, keepPool, keepPlanner, h' = h, n' = n, lastAction' = "stutter" }

  // ------------------------------------------------------------------ step
  action worldStep = any {
    nondet x = MEMBERS.oneOf()
    nondet y = MEMBERS.oneOf()
    nondet c = CITIES.oneOf()
    nondet v = Set(true, false).oneOf()
    any { blockPair(x, y), statesMinorAge(x), setHold(x, v), setOptIn(x, v), travel(x, c), loseReady(x) },
  }
  // The staff switch and a teen anchor, for random simulation: retrieval for a teen friend candidate
  // and an intro to a pool member whom the roster rule admits.
  action teenStep = {
    nondet a = MEMBERS.oneOf()
    val teenPool = pool.filter(b => b != anchor and rosterOk(Set(anchor, b), "social"))
    any {
      teenStop, teenResume,
      all { teenCandidate(a, "social"), retrieve(a, "social", MEMBERS.filter(m => m != a and memberOk(m, "social"))) },
      all { teenPool.size() > 0, nondet b = teenPool.oneOf() intro(b, "social", false, "") },
      // Teen tables and partners in the new-plan phase; the guards decide (refused rosters are in the set).
      {
        nondet g = Set(Set("t", "u", "w"), Set("k", "w", "y"), Set("t", "u", "w", "y"), Set("t", "u", "v"), Set("k", "t", "w")).oneOf()
        nondet act = ACTS.oneOf()
        nondet x = Set("t", "w", "k").oneOf()
        nondet y = Set("u", "y", "v").oneOf()
        any { newPlan(g, Set(), false, act), partnerPlan(x, y, act) }
      },
    }
  }
  // The composer's own choices, for random simulation: a valid primary group of the current pool,
  // every valid alternate, and one result of distinctAlternates.
  def validPrimaries(lane: str): Set[Set[str]] = {
    val cand = pool.filter(m => not(minor.get(m)) and memberOk(m, lane))
    // No city filter here on purpose: the composeGroup guard decides (a weakened guard then shows).
    cand.powerset().filter(p => p.size() >= MIN_G and p.size() <= MAX_G
      and p.forall(x => p.forall(y => x == y or compat(x, y, lane))))
  }
  def validAlts(lane: str, p: Set[str]): Set[str] =
    pool.filter(m => not(minor.get(m))).exclude(p)
      .filter(y => p.forall(x => compat(x, y, lane) and city.get(x) == city.get(y)))
  def keptOk(p: Set[str], alts: Set[str], k: Set[str]): bool = all {
    crossOk(blocked, p, k), pairwiseOk(blocked, k),
  }
  action composeGuided(lane: str): bool = {
    val ps = validPrimaries(lane)
    all {
      ps.size() > 0,
      nondet p = ps.oneOf()
      nondet alts = validAlts(lane, p).powerset().filter(a => a.forall(x => a.forall(y => x == y or compat(x, y, lane)))).oneOf()
      nondet k = alts.powerset().filter(k => keptOk(p, alts, k)).oneOf()
      composeGroup(lane, p, alts, k),
    }
  }

  action poolStep = {
    nondet a = MEMBERS.oneOf()
    nondet b = MEMBERS.oneOf()
    nondet v = MEMBERS.oneOf()
    nondet lane = LANES.oneOf()
    nondet useVia = Set(true, false).oneOf()
    nondet kept = MEMBERS.powerset().oneOf()
    nondet primary = MEMBERS.powerset().oneOf()
    nondet alts = MEMBERS.powerset().oneOf()
    nondet keptAlts = alts.powerset().oneOf()
    any {
      retrieve(a, lane, MEMBERS.filter(m => m != a and memberOk(m, lane))),
      retrieve(a, lane, kept),
      intro(b, lane, useVia, v),
      { nondet gen = Set("event_anchor", "newcomer_welcome", "help_request", "second_encounter").oneOf() introBy(b, lane, false, "", gen) },
      scorePair(b),
      composeGroup(lane, primary, alts, keptAlts),
      composeGuided(lane),
    }
  }
  action plannerStep = {
    nondet c = crews.union(Set({ act: "run", members: Set() })).oneOf()
    nondet o = outcomes.union(Set({ id: "none", act: "run", attended: Set(), positive: Set() })).oneOf()
    nondet s1 = MEMBERS.powerset().oneOf()
    nondet s2 = MEMBERS.powerset().oneOf()
    nondet s3 = MEMBERS.powerset().oneOf()
    nondet s4 = MEMBERS.powerset().oneOf()
    nondet r = Set(true, false).oneOf()
    nondet x = MEMBERS.oneOf()
    nondet y = MEMBERS.oneOf()
    nondet off = offered.union(Set({ act: "run", members: Set() })).oneOf()
    nondet act = ACTS.oneOf()
    nondet oid = Set("o2", "o3").oneOf()
    any {
      startWeek, nextPhase,
      crewSession(c, c.members.filter(m => planEligible(m)), false),
      crewSession(c, s1, r),
      crewOffer(o, offerMembers(o), false),
      crewOffer(o, offerPositive(o), false),
      crewOffer(o, s1, r),
      repeatPlan(o, repeatPos(o), repeatAlts(o), Set(), Set()),
      repeatPlan(o, s1, s2, s3, s4),
      newPlan(s1, s2, false, act),
      newPlan(s3.filter(m => planEligible(m)), Set(), false, act),
      newPlan(s1, Set(), true, act),
      partnerPlan(x, y, act),
      crewOptIn(off, s1),
      meetup(oid, act, s1, s2),
    }
  }
  action step = any { worldStep, poolStep, plannerStep, teenStep, stutter }

  // ------------------------------------------------------------------ invariants
  // Owner decision 2026-11-22 (spec/friendIntroAge.md): a minor enters a pool or an intro candidate
  // only as a teen friend candidate whose whole roster passes groupAgeAllowed, never through a via.
  // Groups (group.ts) stay adult-only. The friends planner seats a minor only in a roster that
  // passes teenPlanOk (friends.help, 2..TEEN_MAX people, every pair passes the rule, all-ages; answer A4).
  val teenFriendAgeRule = not(h.poolUnsafe or h.introMinor or h.introViaMinor or h.groupMinor or h.sessionMinor
                              or h.offerMinor or h.repeatMinor or h.planMinor or h.partnerMinor)
  // While teen introductions are stopped the old invariant holds: no minor in any pool, candidate, group or plan.
  val teenSwitchOffNoMinor = not(h.minorWhileOff)
  // AGENTS.md hard rule "blocks" (PRD 40, keep every safety guard): a blocked pair is never put together.
  // filters.ts pairReason (blocks win), group.ts makeCompat, plans.ts scorePlanGroup,
  // network.ts distinctAlternates. The engine-level gaps are the values below `safety`.
  val blockedApart = not(h.introBlocked or h.introViaUnsafe or h.groupBlocked or h.groupAltBlockedWithPrimary or h.altPairBlockedEngine
                         or h.submittedBlocked or h.repeatBlocked or h.planBlocked or h.partnerBlocked)
  // Romance needs mutual opt-in: packs/network/rules.ts romance_incompatible, rules.ts
  // romance_opt_out, complementarity.ts romanceMutual (the score gate, also for a pool pair that
  // no hard filter saw: scorePair); friends.help never matches romance
  // (packs/friends/rules.ts romance_excluded).
  val romanceMutualOptIn = not(h.introRomanceOneSided or h.romanceScoredOneSided or h.groupRomanceOneSided or h.friendsRomance)
  // geo.ts cityBucketGeo overlap: members meet only in one common city (filters.ts, group.ts).
  val coLocated = not(h.introApart or h.groupApart)
  // packs/friends/rules.ts group_size (3..6, scaled to MIN_G..MAX_G), FRIENDS_PLANS.size, planner.ts
  // finish() (repeat quorum, `invited.length < pcfg.size.min` for new plans), group.ts minSize/maxSize.
  val groupSizeBounds = not(h.groupSizeBad or h.offerSizeBad or h.repeatSizeBad or h.planSizeBad)
  // One crew per member per week, the part that holds: a crew offer never invites a member who is
  // already taken this week (planner.ts `!taken.has(id)`); new plans never seat a member twice
  // (planner.ts `used`); partner intros keep partnerIntros (planner.ts).
  val seatsOnce = not(h.offerInvitedTwice or h.planSeatTwice or h.partnerOverCap)

  val safety = all { teenFriendAgeRule, teenSwitchOffNoMinor, blockedApart, romanceMutualOptIn, coLocated, groupSizeBounds, seatsOnce }

  // Defects (not in safety; see the header). Each is reached by a run test below.
  val noSessionBlocked = not(h.sessionBlocked)
  val noOfferBlocked = not(h.offerBlocked)
  val oneCrewPerWeek = not(h.crewTwice)
  val sessionSizeOk = not(h.sessionUnderMin)

  // ------------------------------------------------------------------ witnesses (must be reachable)
  val witness_score = n.scores == 0
  val witness_intro = n.intros == 0
  val witness_romanceIntro = n.romanceIntros == 0
  val witness_group = n.groups == 0
  val witness_session = n.sessions == 0
  val witness_offer = n.offers == 0
  val witness_repeat = n.repeats == 0
  val witness_plan = n.plans == 0
  val witness_pairPlan = n.pairPlans == 0
  val witness_partner = n.partners == 0
  val witness_teenIntro = n.teenIntros == 0
  val witness_teenPlan = n.teenPlans == 0

  // ------------------------------------------------------------------ run tests
  // A two-hop intro a -> c through b (retrieval.ts twoHop), then a romance intro between two opted-in members.
  run introTest = initWith("network")
    .then(retrieve("a", "social", Set("b", "c", "d", "e")))
    .then(intro("c", "social", true, "b"))
    .expect(n.intros == 1 and safety)
    .then(retrieve("a", "romance", Set("b", "c")))
    .then(intro("b", "romance", false, ""))
    .expect(n.romanceIntros == 1 and safety)

  // The minor k is a direct warm neighbour of a and d, but never a `via`: no intro a -> d.
  run minorViaTest = initWith("network")
    .then(retrieve("a", "social", Set("b", "c", "d", "e")))
    .then(intro("d", "social", true, "k"))
    .fail()

  // Romance needs both: d did not opt in, so the pool for romance does not have d, and a pair a-d fails.
  run romanceOneSidedTest = initWith("network")
    .then(retrieve("a", "romance", Set("d")))
    .fail()

  // A group of three can keep one of two blocked alternates. The pair cannot share the same bench.
  run altPairTest = initWith("network")
    .then(blockPair("d", "e"))
    .then(retrieve("a", "social", Set("b", "c", "d", "e")))
    .then(retrieve("f", "social", Set("a", "b", "c", "d", "e")))
    .then(composeGroup("social", Set("a", "b", "c"), Set("d"), Set("d")))
    .expect(safety)
    .then(composeGroup("social", Set("a", "b", "c"), Set("d", "e"), Set("d")))
    .fail()

  // A blocked pair cannot be in the primary group.
  run groupBlockTest = initWith("network")
    .then(blockPair("a", "b"))
    .then(retrieve("f", "social", Set("a", "b", "c", "d", "e")))
    .then(composeGroup("social", Set("a", "b", "c"), Set(), Set()))
    .fail()

  // a blocks b after the run crew formed: the crew session still invites both (planner.ts).
  run sessionBlockTest = initWith("friends")
    .then(blockPair("a", "b"))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .expect(safety and not(noSessionBlocked))

  // A crew of 3 with one member on a hold: the session goes out to 2 (planner.ts).
  run sessionSizeTest = initWith("friends")
    .then(setHold("c", true))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b"), false))
    .expect(safety and not(sessionSizeOk))

  // d, e and f rated a dinner positive; d blocked e after it. The crew offer has no block check.
  run offerBlockedTest = initWith("friends")
    .then(meetup("o2", "dinner", Set("b", "d", "e", "f"), Set("d", "e", "f")))
    .then(blockPair("d", "e"))
    .then(startWeek)
    .then(nextPhase)
    .then(crewOffer({ id: "o2", act: "dinner", attended: Set("b", "d", "e", "f"), positive: Set("d", "e", "f") }, Set("d", "e", "f"), false))
    .expect(safety and not(noOfferBlocked))

  // Repeat of o2: a, b and e would do it again. d blocked e after the previous plan, so the new
  // table keeps the three compatible attendees without an alternate.
  run repeatBlockTest = initWith("friends")
    .then(meetup("o2", "dinner", Set("a", "b", "d", "e"), Set("a", "b", "e")))
    .then(blockPair("d", "e"))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set(), true))
    .then(nextPhase)
    .then(nextPhase)
    .then(repeatPlan({ id: "o2", act: "dinner", attended: Set("a", "b", "d", "e"), positive: Set("a", "b", "e") },
                     Set("a", "b", "e"), Set(), Set(), Set()))
    .expect(safety and n.repeats == 1)

  // Two live crews for a: the run session of week 1 is refused (finish() null), so a is not taken
  // and gets the dinner crew offer; a opts in; in week 2 a has two crew sessions.
  run twoCrewsTest = initWith("friends")
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set(), true))
    .then(nextPhase)
    .then(crewOffer({ id: "o1", act: "dinner", attended: Set("a", "d", "e", "f"), positive: Set("a", "d", "e") }, Set("a", "d", "e"), false))
    .then(nextPhase).then(nextPhase).then(nextPhase)
    .then(crewOptIn({ act: "dinner", members: Set("a", "d", "e") }, Set("a", "d", "e")))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .then(crewSession({ act: "dinner", members: Set("a", "d", "e") }, Set("a", "d", "e"), false))
    .expect(safety and not(oneCrewPerWeek))

  // A crew offer never invites a member who has a crew session this week (planner.ts).
  run offerTakenTest = initWith("friends")
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .then(nextPhase)
    .then(crewOffer({ id: "o1", act: "dinner", attended: Set("a", "d", "e", "f"), positive: Set("a", "d", "e") }, Set("a", "d", "e"), false))
    .fail()

  // A new table of four, then the same members cannot get a second table this week.
  run newPlanTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("a", "b", "c", "d"), Set("e"), false, "dinner"))
    .expect(n.plans == 1 and safety)
    .then(newPlan(Set("a", "e", "f"), Set(), false, "dinner"))
    .fail()

  // The friends pack never makes a romance intro.
  run friendsRomanceTest = initWith("friends")
    .then(retrieve("a", "romance", Set("b")))
    .fail()

  // Stopped: a teen-ready 17-year-old is not a candidate, so u (18) cannot be introduced to t.
  run teenSwitchOffTest = initWith("friends")
    .then(teenStop)
    .then(retrieve("u", "social", Set("t")))
    .fail()

  // On from the start: t (17) and u (18), both ready, born within 2 years, become a friendship intro.
  run teenPairTest = initWith("friends")
    .then(retrieve("t", "social", Set("u", "k", "v", "a")))
    .then(intro("u", "social", false, ""))
    .expect(n.teenIntros == 1 and safety)

  // t (17) and v (19, within 2 years) are refused by the 19 cap; t and a (30) too.
  run teenNineteenTest = initWith("friends")
    .then(retrieve("t", "social", Set("u", "k", "v", "a")))
    .then(intro("v", "social", false, ""))
    .fail()
  run teenAdultTest = initWith("friends")
    .then(retrieve("t", "social", Set("u", "k", "v", "a")))
    .then(intro("a", "social", false, ""))
    .fail()

  // k (15) and t (17) are more than 2 years apart.
  run teenGapTest = initWith("friends")
    .then(retrieve("t", "social", Set("u", "k", "v", "a")))
    .then(intro("k", "social", false, ""))
    .fail()

  // After a report u is not ready, so t and u are refused.
  run teenUnreadyTest = initWith("friends")
    .then(loseReady("u"))
    .then(retrieve("t", "social", Set("u")))
    .then(intro("u", "social", false, ""))
    .fail()

  // Answer A2: the network pack's Friend lane (social) makes the same teen pair (intent_to_capability).
  run teenNetworkPairTest = initWith("network")
    .then(retrieve("t", "social", Set("u")))
    .then(intro("u", "social", false, ""))
    .expect(n.teenIntros == 1 and safety)
  // The network pack never makes a teen intro from an adults-only generator or in the event shape.
  run teenNetworkEventTest = initWith("network")
    .then(retrieve("t", "social", Set("u")))
    .then(introBy("u", "social", false, "", "event_anchor"))
    .fail()
  run teenNetworkNewcomerTest = initWith("network")
    .then(retrieve("t", "social", Set("u")))
    .then(introBy("u", "social", false, "", "newcomer_welcome"))
    .fail()
  run teenNetworkSecondEncounterTest = initWith("network")
    .then(retrieve("t", "social", Set("u")))
    .then(introBy("u", "social", false, "", "second_encounter"))
    .fail()
  // The network pack's romance lane is never a teen lane.
  run teenNetworkRomanceTest = initWith("network")
    .then(retrieve("u", "romance", Set("t")))
    .fail()

  // A friends group from group.ts still refuses t (composeGroup stays adult-only).
  run teenGroupTest = initWith("friends")
    .then(retrieve("a", "social", Set("b", "c", "t", "u")))
    .then(composeGroup("social", Set("b", "c", "t"), Set(), Set()))
    .fail()

  // Answer A4: the friends planner seats a teen table of t (17), u (18) and w (16) at an all-ages activity.
  run teenTableTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("t", "u", "w"), Set(), false, "run"))
    .expect(n.teenPlans == 1 and safety)
  // v is 19: refused, although v is within 2 years of t.
  run teenTableNineteenTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("t", "u", "v"), Set(), false, "run"))
    .fail()
  // k and t are 2 years and 1 day apart: refused.
  run teenTableGapTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("k", "t", "w"), Set(), false, "run"))
    .fail()
  // Every pair of t, u, w and y passes, but 4 people is one over TEEN_MAX (teenRosterMaximum, scaled).
  run teenTableSizeTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("t", "u", "w", "y"), Set(), false, "run"))
    .fail()
  // The same table at an entry for adults only: refused.
  run teenTablePlaceTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("t", "u", "w"), Set(), false, "dinner"))
    .fail()
  // While teen introductions are stopped, a minor is not a plan seat.
  run teenTableStoppedTest = initWith("friends")
    .then(teenStop)
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("t", "u", "w"), Set(), false, "run"))
    .fail()
  // A teen activity partner pair t (17) and u (18); t and v (19) are refused.
  run teenPartnerTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(partnerPlan("t", "u", "run"))
    .expect(n.teenPlans == 1 and safety)
  run teenPartnerNineteenTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(partnerPlan("t", "v", "run"))
    .fail()
  // A teen crew offer after a positive all-ages run; the same offer after an adults-only dinner is refused.
  run teenOfferTest = initWith("friends")
    .then(meetup("o2", "run", Set("t", "u", "w"), Set("t", "u", "w")))
    .then(startWeek).then(nextPhase)
    .then(crewOffer({ id: "o2", act: "run", attended: Set("t", "u", "w"), positive: Set("t", "u", "w") }, Set("t", "u", "w"), false))
    .expect(n.teenPlans == 1 and safety)
  run teenOfferPlaceTest = initWith("friends")
    .then(meetup("o2", "dinner", Set("t", "u", "w"), Set("t", "u", "w")))
    .then(startWeek).then(nextPhase)
    .then(crewOffer({ id: "o2", act: "dinner", attended: Set("t", "u", "w"), positive: Set("t", "u", "w") }, Set("t", "u", "w"), false))
    .fail()
  // The same teen table again after a positive run.
  run teenRepeatTest = initWith("friends")
    .then(meetup("o2", "run", Set("t", "u", "w"), Set("t", "u", "w")))
    .then(startWeek).then(nextPhase).then(nextPhase)
    .then(repeatPlan({ id: "o2", act: "run", attended: Set("t", "u", "w"), positive: Set("t", "u", "w") }, Set("t", "u", "w"), Set(), Set(), Set()))
    .expect(n.teenPlans == 1 and safety)
}
```
