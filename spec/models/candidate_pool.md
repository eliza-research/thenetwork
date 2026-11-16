# Candidate retrieval and groups

## Story: Candidate retrieval and groups

A member needs recommendations and groups that respect consent, blocks, location, and value to both sides.

### Safety rules and reachability

Check the bounded candidate search, the one pair gate, candidate screening, circle admission, the global selection, and the Friends weekly planner. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [bounded candidate search](../candidateSearch.md) generates the search machine that the engine runs once for each lane membership. The [reciprocal pair value](../pairValue.md) and the [relationship lanes](../matchLane.md) give each pair its value and the lane rules. The [private member standing](../memberStanding.md) gives standing and its uncertainty. The [candidate screening spec](../candidateScreening.md) generates the ordered hard checks, the last of which asks for a lane and a pair value. The [group formation spec](../groupFormation.md) generates the circle admission (`circleCoherent`) and the alternate reservations. The [global selection spec](../selectionRun.md) generates the exposure, exploration and greedy phases, the pack refusal, and the greedy refusal. The [Friends weekly planner spec](../friendsWeek.md) generates the pass order and the reservations of the planner. This model follows those machines through one matching run and through the planner, with small integer values.

The [travel presence spec](../travelPresence.md) supplies bounded intervals for the production city check. This model abstracts them to one market for each member.

Imported from `quint/candidate_pool.qnt` at `30d950e` and rewritten for the match core of branch `vibestack-matching`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=30 max-samples=2000 verify-steps=4
//
// candidate_pool: how one matching run finds pairs and circles, screens and scores them, and selects
// proposals, and how the friends.help weekly planner seats people.
//
// WHAT THIS MODELS (packages/engine/src on branch vibestack-matching)
//   - Profiles (match/profile.ts buildProfiles): a member has a profile in a lane only when the pack offers
//     the lane (spec/matchLane.md laneOffered), the member can be matched (filters.ts sendTimeReason:
//     adult, no hold, not paused) and opted in to the lane's category. Its market is its home city.
//   - The one pair gate (match/pair.ts eligiblePair and pairValueOf): two different members, the same lane
//     and market, filters.ts pairReason (minors, blocks, the pack rules), then the lane pair value
//     (spec/pairValue.md): both directed utilities at the lane floor, the standing gap within the band plus
//     both uncertainties, and a balanced exchange where the lane requires it. Without all of them there is
//     no pair value (-1).
//   - The bounded search (match/search.ts searchCandidates, match/run.ts MatchRun.candidates): one search
//     per lane membership per run, memoized; the generated candidateSearch machine with its limit, budget,
//     kept list, best dropped rank and unseen bound; it closes Exact, or Budgeted when the check budget or
//     the posting walk (walkSpent) is spent.
//   - Edges (match/search.ts mutualEdges): a pair is an edge when either side's search kept the other.
//   - Screening (filters.ts screenCandidate with the generated candidateScreening machine): age (every
//     participant, alternate and intermediary), the intermediary, the members, the pairs (pairReason, then
//     laneReason: no_lane, no_pair_value), presence. Kept alternates have a pair value with every primary
//     participant (filters.ts keptAlternates).
//   - Scoring (scoring.ts pairTerms): fit is the lowest pair value and mutual benefit the mean of the pair
//     values. The judge (engine.ts pass 2 and 3) can only lower a score or remove a candidate.
//   - Circles (match/circles.ts buildCircles, group.ts composeGroup and poolCircles): every pair is an edge at
//     the lane's circle pair floor, the standing spread fits the band and the uncertainties, each member is
//     in at most one circle of a lane per run, and the generated circleCoherent admits the circle. Group
//     alternates have an edge with every primary member; the ConsentNetwork then applies
//     distinctAlternates (packages/network/src/network.ts distinctAlternates).
//   - Selection (policy.ts selectProposals with the generated selectionRun machine): exposure picks,
//     exploration picks, then one greedy walk in value order; the pack refusal (policy.ts hooksAllow, the
//     pack's selection.adjust returning -Infinity) holds in every phase; a greedy choice whose member has
//     no room is refused and recorded.
//   - The friends planner (packs/friends/planner.ts planFriendsWeek) in its pass order with the
//     spec/friendsWeek.md reservations: 1 crew sessions, 2 crew offers (plans.ts detectCrews), 3 same table
//     again (repeats), 4 new plans (one table per circle), 5 activity partners (the Friend lane's edges).
//     Crew sessions and offers pass the pair gate (plans.ts crewSessionPlan, requiredPairValues), and a
//     repeat needs a pair value for each pair of its invitees (packs/friends/generators.ts familiarCircle).
//
// ABSTRACTIONS (quint/README.md rule 7)
//   - Values are small integers. Directed utilities (UTIL) are 0..3, standing (ST) 0..3, uncertainty
//     (UNC) 0..1, and they are fixed facts of the world. The parity penalty is abstracted to 0 (it only
//     orders values inside the band); the exchange balance compares the two utilities (the exchange is
//     the complement term of the utility in the code). The search window, the index and the visit order
//     are abstracted: a search may check the candidates of its block in any order, the shell's unseen
//     bound is any value at least the highest pair value it has not checked (lawCandidateBoundSound,
//     lawUnseenBoundSound, lawBucketBoundSound), and the posting walk may run out (walkSpent) at any
//     point. So the model covers the generated machine for every order the index can produce, whether the
//     index is the standing-bucket scan or the tag-posting threshold walk.
//   - Lanes: Friend (floor 1, band 3, forms circles), Intro (floor 2, band 1, balanced, forms circles, only
//     ntwrk), Date (offered by neither pack here: slop.date is in matching_engine).
//   - Six adults a..f and one member k aged 15. Any member can state a lower age later (minor).
//   - Group sizes are scaled: the circle bound 3..6 is MIN_G..MAX_G = 3..4. The member room is ROOM
//     proactive proposals per run.
//   - World facts change only between runs (the engine reads one World snapshot per run). The planner
//     reads the facts of the moment, as the old model did.
//   - The "select" focus seeds six scored candidates so that every selection path is reachable; the
//     "search" focus selects among the candidates that its own run screened.
//   - Each flag in `h` is set at the moment the code emits a candidate, circle, group or plan, and it uses
//     the facts of that moment.
//
// VALUES THAT ARE NOT IN `safety` (each one is a defect or a documented design choice; each has a run test)
//   noAltPairBlockedEngine   group.ts composeGroup and filters.ts keptAlternates check each alternate
//                            against the primary group only, not against the other alternates. The
//                            ConsentNetwork repairs it (distinctAlternates), so `blockedApart` holds for the
//                            submitted group.
//   noRepeatBlocked          packs/friends/planner.ts pass 3: the repeat alternates (o.attended) have no
//                            pair check, and finish() moves an alternate into `invited` when an invitee is
//                            dropped for transit.
//   newPlanSeatsApart        packs/friends/planner.ts circleAlternates checks an alternate against each
//                            invitee with pairReason only (no pair value) and never against the other
//                            alternates; finish() fills dropped seats from the alternates. Two alternates
//                            who blocked each other can both be seated (a defect of this branch: the
//                            replaced table builder checked the whole table).
//   newPlanSeatsValued       the same path seats an alternate without a pair value with an invitee.
//   oneCrewPerWeek           spec/friendsWeek.md: crew sessions keep members of several crews (by design).
//   sessionSizeOk            planner.ts pass 1: a crew session needs only 2 eligible members, below the
//                            friends group bound of 3. This can be intended.
//
// RUN (from the repository root)
//   pnpm run quint:check candidate_pool
module candidate_pool {

  // ------------------------------------------------------------------ constants
  pure val ADULTS = Set("a", "b", "c", "d", "e", "f")
  pure val MEMBERS = Set("a", "b", "c", "d", "e", "f", "k")
  pure val ORD = Map("a" -> 0, "b" -> 1, "c" -> 2, "d" -> 3, "e" -> 4, "f" -> 5, "k" -> 6)
  pure val CITIES = Set("nyc", "la")
  pure val ACTS = Set("run", "dinner")
  pure val LANES = Set("Friend", "Intro", "Date")
  pure val PACKS = Set("network", "friends")
  pure val FOCI = Set("search", "select", "plan")
  pure val NONE = "none"
  pure val NO_VALUE = -1                 // spec/pairValue.md noPairValue
  pure val LIMIT = 3                     // laneLimits searchLimit (scaled)
  pure val BUDGET = 4                    // laneLimits searchBudget (scaled)
  pure val MIN_G = 3                     // circleMinimum, FRIENDS_PLANS.size.min
  pure val MAX_G = 4                     // circleMaximum 6, scaled
  pure val ROOM = 2                      // proactive budget limit per member (selectionRun proactiveLimit)
  pure val PARTNER_INTROS = 1            // DEFAULT_FRIENDS_POLICY.partnerIntros
  pure val BOUNDS = Set(-1, 0, 1, 2, 3)  // unseen bounds the shell can pass
  pure val GREEDY_START = 100            // selectionGreedyBoundStart (scaled)
  pure val THRESHOLD = 2                 // scoring.ts thresholdFor (scaled): below it a candidate is "below"

  // Private standing and its uncertainty (spec/memberStanding.md), fixed facts.
  pure val ST = Map("a" -> 2, "b" -> 2, "c" -> 1, "d" -> 3, "e" -> 0, "f" -> 2, "k" -> 1)
  pure val UNC = Map("a" -> 0, "b" -> 0, "c" -> 0, "d" -> 0, "e" -> 1, "f" -> 0, "k" -> 0)
  // Directed utility of y for x (spec/pairValue.md directedUtility), fixed facts. d values e highly and e
  // does not value d: a one-sided pair.
  pure def util(x: str, y: str): int =
    if (Set(x, y) == Set("a", "b")) 3
    else if (Set(x, y) == Set("a", "f")) 1
    else if (x == "d" and y == "e") 3
    else if (x == "e" and y == "d") 0
    else 2

  // spec/matchLane.md laneOffered and laneLimits, scaled.
  pure def laneOffered(pack: str, lane: str): bool = lane == "Friend" or (lane == "Intro" and pack == "network")
  pure def utilityFloor(lane: str): int = if (lane == "Friend") 1 else 2
  pure def parityBand(lane: str): int = if (lane == "Friend") 3 else 1
  pure def balanceRequired(lane: str): bool = lane == "Intro"
  pure def formsCircles(lane: str): bool = lane == "Friend" or lane == "Intro"   // group.ts formsGroups
  pure def circlePairFloor(lane: str): int = 2

  // ------------------------------------------------------------------ types
  type Search = {
    phase: str,                         // "Idle", "Scanning" (Exact and Budgeted close into `found`)
    owner: str, lane: str, checks: int, seen: Set[str], kept: Set[str],
    dropV: int, dropO: int,             // bestDropped, bestDroppedOrdinal
  }
  type Result = { owner: str, lane: str, kept: Set[str], seen: Set[str], exact: bool, checks: int, unseen: int, dropV: int }
  type Cand = {
    parts: Set[str], lane: str, alts: Set[str], fit: int, benefit: int,
    score: int, pre: int, status: str, preStatus: str,   // status: "eligible", "below", "removed"
    packNo: bool, screened: bool,
  }
  type Pick = { key: int, phase: str, value: int, seq: int }
  type Refusal = { member: str, at: int, value: int }
  type Sel = {
    phase: str,                         // "Idle", "Exposure", "Exploration", "Greedy", "Complete"
    bound: int, used: str -> int, picks: Set[Pick], refusals: Set[Refusal], decided: Set[int],
    pairsUsed: Set[Set[str]], seq: int,
  }
  type Crew = { act: str, members: Set[str] }
  type Outcome = { id: str, act: str, attended: Set[str], positive: Set[str] }
  type Week = {
    phase: str,                         // "idle", "sessions", "offers", "repeats", "new"
    taken: Set[str], used: Set[str],    // spec/friendsWeek.md recurring and newUsed
    detected: Set[Crew],
    sessionsDone: Set[Crew], outcomesDone: Set[str], repeatsDone: Set[str],
    crewCount: str -> int, partnerCount: str -> int,
  }
  type Hist = {
    // screened candidates
    candMinor: bool, candBlocked: bool, candViaUnsafe: bool, candNoLane: bool, candNoValue: bool,
    candOneSided: bool, candParity: bool, candUnbalanced: bool, candApart: bool, candLaneNotOffered: bool,
    altNoValue: bool, fitNotFromPairs: bool,
    // circles and groups
    groupMinor: bool, groupBlocked: bool, groupAltBlockedWithPrimary: bool, groupSizeBad: bool, groupApart: bool,
    groupIncoherent: bool, circleTwice: bool, submittedBlocked: bool, altPairBlockedEngine: bool,
    // friends planner
    sessionMinor: bool, sessionBlocked: bool, sessionNoValue: bool, sessionUnderMin: bool,
    offerMinor: bool, offerBlocked: bool, offerNoValue: bool, offerInvitedTwice: bool, offerSizeBad: bool,
    repeatMinor: bool, repeatInviteesNoValue: bool, repeatBlocked: bool, repeatSizeBad: bool,
    planMinor: bool, planCircleIncoherent: bool, planSeatedBlocked: bool, planSeatedNoValue: bool,
    planSizeBad: bool, planSeatTwice: bool,
    partnerMinor: bool, partnerNoValue: bool, partnerOverCap: bool,
    crewTwice: bool,
  }
  type Count = {
    searches: int, exactUnseen: int, budgeted: int, dropped: int, pairCands: int, groupCands: int,
    lowered: int, exposure: int, explore: int, greedy: int, refused: int,
    sessions: int, offers: int, repeats: int, plans: int, partners: int,
  }

  // ------------------------------------------------------------------ state
  var focus: str
  var pack: str
  var minor: str -> bool
  var held: str -> bool
  var optIn: str -> Set[str]            // lanes whose category the member opted in to
  var city: str -> str                  // market (home city)
  var blocked: Set[Set[str]]
  var runOpen: bool
  var srch: Search
  var found: Set[Result]
  var circled: Set[(str, str)]          // (member, lane) already in a circle this run
  var cands: int -> Cand
  var sel: Sel
  var crews: Set[Crew]
  var offered: Set[Crew]
  var outcomes: Set[Outcome]
  var wk: Week
  var h: Hist
  var n: Count
  var lastAction: str

  // ------------------------------------------------------------------ pure helpers
  pure def isBlocked(bl: Set[Set[str]], x: str, y: str): bool = bl.contains(Set(x, y))
  pure def pairwiseOk(bl: Set[Set[str]], s: Set[str]): bool =
    s.forall(x => s.forall(y => x == y or not(isBlocked(bl, x, y))))
  pure def crossOk(bl: Set[Set[str]], s: Set[str], t: Set[str]): bool =
    s.forall(x => t.forall(y => x == y or not(isBlocked(bl, x, y))))
  pure def sameCity(c: str -> str, s: Set[str]): bool = s.forall(x => s.forall(y => c.get(x) == c.get(y)))
  pure def absDiff(x: int, y: int): int = if (x >= y) x - y else y - x
  pure def harmonic(l: int, r: int): int = if (l > 0 and r > 0) (2 * l * r) / (l + r) else 0
  pure def maxOf(s: Set[int]): int = s.fold(NO_VALUE, (m, v) => if (v > m) v else m)
  pure def pairsOf(s: Set[str]): Set[Set[str]] = s.powerset().filter(p => p.size() == 2)
  // The two members of a pair, by ordinal.
  pure def lo(p: Set[str]): str = p.filter(x => p.forall(y => ORD.get(x) <= ORD.get(y))).fold("a", (acc, x) => x)
  pure def hi(p: Set[str]): str = p.filter(x => p.forall(y => ORD.get(x) >= ORD.get(y))).fold("a", (acc, x) => x)
  // spec/candidateSearch.md candidateRanksAbove on (value, ordinal).
  pure def ranksAbove(v1: int, o1: int, v2: int, o2: int): bool = v1 > v2 or (v1 == v2 and o1 < o2)
  // spec/pairValue.md pairAdmissible with the lane rules (parity penalty abstracted to 0).
  pure def admissible(x: str, y: str, lane: str): bool = and {
    util(x, y) >= utilityFloor(lane), util(y, x) >= utilityFloor(lane),
    absDiff(ST.get(x), ST.get(y)) <= parityBand(lane) + UNC.get(x) + UNC.get(y),
    balanceRequired(lane) implies absDiff(util(x, y), util(y, x)) <= 1,
  }

  pure val emptySearch: Search = { phase: "Idle", owner: NONE, lane: NONE, checks: 0, seen: Set(), kept: Set(), dropV: NO_VALUE, dropO: 0 }
  pure val emptySel: Sel = {
    phase: "Idle", bound: GREEDY_START, used: MEMBERS.mapBy(m => 0), picks: Set(), refusals: Set(), decided: Set(),
    pairsUsed: Set(), seq: 0,
  }
  pure val emptyWeek: Week = {
    phase: "idle", taken: Set(), used: Set(), detected: Set(), sessionsDone: Set(), outcomesDone: Set(), repeatsDone: Set(),
    crewCount: MEMBERS.mapBy(m => 0), partnerCount: MEMBERS.mapBy(m => 0),
  }
  pure val noHist: Hist = {
    candMinor: false, candBlocked: false, candViaUnsafe: false, candNoLane: false, candNoValue: false,
    candOneSided: false, candParity: false, candUnbalanced: false, candApart: false, candLaneNotOffered: false,
    altNoValue: false, fitNotFromPairs: false,
    groupMinor: false, groupBlocked: false, groupAltBlockedWithPrimary: false, groupSizeBad: false, groupApart: false,
    groupIncoherent: false, circleTwice: false, submittedBlocked: false, altPairBlockedEngine: false,
    sessionMinor: false, sessionBlocked: false, sessionNoValue: false, sessionUnderMin: false,
    offerMinor: false, offerBlocked: false, offerNoValue: false, offerInvitedTwice: false, offerSizeBad: false,
    repeatMinor: false, repeatInviteesNoValue: false, repeatBlocked: false, repeatSizeBad: false,
    planMinor: false, planCircleIncoherent: false, planSeatedBlocked: false, planSeatedNoValue: false,
    planSizeBad: false, planSeatTwice: false,
    partnerMinor: false, partnerNoValue: false, partnerOverCap: false,
    crewTwice: false,
  }
  pure val noCount: Count = {
    searches: 0, exactUnseen: 0, budgeted: 0, dropped: 0, pairCands: 0, groupCands: 0,
    lowered: 0, exposure: 0, explore: 0, greedy: 0, refused: 0,
    sessions: 0, offers: 0, repeats: 0, plans: 0, partners: 0,
  }

  // ------------------------------------------------------------------ the pair gate (state reads)
  // profile.ts buildProfiles: offered lane, sendTimeReason (adult, no hold) and the lane opt-in.
  def hasProfile(m: str, lane: str): bool =
    laneOffered(pack, lane) and not(minor.get(m)) and not(held.get(m)) and optIn.get(m).contains(lane)
  // match/pair.ts eligiblePair: not the same member, the same lane (both profiles) and market, then
  // filters.ts pairReason (minors through the profiles, blocks).
  def eligiblePair(x: str, y: str, lane: str): bool =
    x != y and hasProfile(x, lane) and hasProfile(y, lane) and city.get(x) == city.get(y) and not(isBlocked(blocked, x, y))
  // match/pair.ts pairValueOf: the lane pair value through the one gate, else -1.
  def pairValue(x: str, y: str, lane: str): int =
    if (eligiblePair(x, y, lane) and admissible(x, y, lane)) harmonic(util(x, y), util(y, x)) else NO_VALUE
  def allValued(s: Set[str], lane: str): bool = pairsOf(s).forall(p => pairValue(lo(p), hi(p), lane) >= 0)
  def pvMin(s: Set[str], lane: str): int = pairsOf(s).fold(100, (m, p) => if (pairValue(lo(p), hi(p), lane) < m) pairValue(lo(p), hi(p), lane) else m)
  def pvMean(s: Set[str], lane: str): int =
    if (pairsOf(s).size() == 0) 0 else pairsOf(s).fold(0, (t, p) => t + pairValue(lo(p), hi(p), lane)) / pairsOf(s).size()

  // The block of a search: the profiles on the partner side in the same lane and market (index.ts partnerBlock).
  def block(owner: str, lane: str): Set[str] = MEMBERS.filter(o => o != owner and hasProfile(o, lane) and city.get(o) == city.get(owner))
  def feasible(owner: str, lane: str): Set[str] = block(owner, lane).filter(o => pairValue(owner, o, lane) >= 0)
  def valueIn(owner: str, lane: str, o: str): int = pairValue(owner, o, lane)
  // bruteForceCandidates: the first LIMIT feasible partners by (value desc, ordinal asc).
  def topOk(owner: str, lane: str, kept: Set[str], pool: Set[str]): bool = and {
    kept.subseteq(pool),
    kept.size() == (if (pool.size() < LIMIT) pool.size() else LIMIT),
    kept.forall(x => pool.exclude(kept).forall(y =>
      ranksAbove(valueIn(owner, lane, x), ORD.get(x), valueIn(owner, lane, y), ORD.get(y)))),
  }
  // The edge of a pair: either side's closed search kept the other (mutualEdges).
  def edge(x: str, y: str, lane: str): bool =
    found.exists(r => r.lane == lane and ((r.owner == x and r.kept.contains(y)) or (r.owner == y and r.kept.contains(x))))
  def edgeValue(x: str, y: str, lane: str): int = if (edge(x, y, lane)) pairValue(x, y, lane) else NO_VALUE

  // Members (filters.ts memberReason core prefix and category opt-in).
  def memberOk(m: str, lane: str): bool = not(minor.get(m)) and not(held.get(m)) and (lane == NONE or optIn.get(m).contains(lane))
  // plans.ts planMemberReason, the planner's `eligible`.
  def planEligible(m: str): bool = not(minor.get(m)) and not(held.get(m))

  // ------------------------------------------------------------------ init
  action initWith(f: str, p: str): bool = all {
    focus' = f, pack' = p,
    minor' = MEMBERS.mapBy(m => m == "k"),
    held' = MEMBERS.mapBy(m => false),
    optIn' = MEMBERS.mapBy(m => if (Set("a", "b", "c", "d").contains(m)) Set("Friend", "Intro") else Set("Friend")),
    city' = MEMBERS.mapBy(m => "nyc"),
    blocked' = Set(),
    runOpen' = false, srch' = emptySearch, found' = Set(), circled' = Set(),
    // The "select" focus starts from six scored candidates (keys 1..6); the others start with none.
    cands' = if (f == "select") Map(
      1 -> { parts: Set("a", "b"), lane: "Friend", alts: Set(), fit: 3, benefit: 3, score: 3, pre: 3, status: "eligible", preStatus: "eligible", packNo: false, screened: false },
      2 -> { parts: Set("a", "c"), lane: "Friend", alts: Set(), fit: 2, benefit: 2, score: 2, pre: 2, status: "eligible", preStatus: "eligible", packNo: false, screened: false },
      3 -> { parts: Set("a", "d"), lane: "Friend", alts: Set(), fit: 2, benefit: 2, score: 2, pre: 2, status: "eligible", preStatus: "eligible", packNo: false, screened: false },
      4 -> { parts: Set("b", "e"), lane: "Friend", alts: Set(), fit: 2, benefit: 2, score: 2, pre: 2, status: "eligible", preStatus: "eligible", packNo: true, screened: false },
      5 -> { parts: Set("c", "e"), lane: "Friend", alts: Set(), fit: 1, benefit: 1, score: 1, pre: 1, status: "below", preStatus: "below", packNo: false, screened: false },
      6 -> { parts: Set("d", "e"), lane: "Friend", alts: Set(), fit: 2, benefit: 2, score: 2, pre: 2, status: "eligible", preStatus: "eligible", packNo: false, screened: false })
      else Map(),
    sel' = emptySel,
    // One live crew and one recent great plan, so that each planner pass has work at once.
    crews' = Set({ act: "run", members: Set("a", "b", "c") }),
    offered' = Set(),
    outcomes' = Set({ id: "o1", act: "dinner", attended: Set("a", "b", "e", "f"), positive: Set("a", "e", "f") }),
    wk' = emptyWeek, h' = noHist, n' = noCount,
    lastAction' = "init",
  }
  action init = {
    nondet f = FOCI.oneOf()
    nondet p = PACKS.oneOf()
    initWith(f, p)
  }

  action keepWorld = all { focus' = focus, pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city, blocked' = blocked }
  action keepRun = all { runOpen' = runOpen, srch' = srch, found' = found, circled' = circled }
  action keepSel = all { cands' = cands, sel' = sel }
  action keepPlanner = all { crews' = crews, offered' = offered, outcomes' = outcomes, wk' = wk }

  // ================================================================== world changes (other actors, between runs)
  action worldChange(nextMinor: str -> bool, nextHeld: str -> bool, nextOptIn: str -> Set[str], nextCity: str -> str, nextBlocked: Set[Set[str]], name: str): bool = all {
    not(runOpen),
    focus' = focus, pack' = pack, minor' = nextMinor, held' = nextHeld, optIn' = nextOptIn, city' = nextCity, blocked' = nextBlocked,
    keepRun, keepSel, keepPlanner, h' = h, n' = n, lastAction' = name,
  }
  action blockPair(x: str, y: str): bool = all {
    x != y, not(isBlocked(blocked, x, y)),
    worldChange(minor, held, optIn, city, blocked.union(Set(Set(x, y))), "blockPair"),
  }
  // AGENTS.md platform decision 1: the lowest age ever stated wins.
  action statesMinorAge(m: str): bool = all { not(minor.get(m)), worldChange(minor.set(m, true), held, optIn, city, blocked, "statesMinorAge") }
  action setHold(m: str, v: bool): bool = worldChange(minor, held.set(m, v), optIn, city, blocked, "setHold")
  action setOptIn(m: str, lane: str, v: bool): bool =
    worldChange(minor, held, optIn.set(m, if (v) optIn.get(m).union(Set(lane)) else optIn.get(m).exclude(Set(lane))), city, blocked, "setOptIn")
  action move(m: str, c: str): bool = all { city.get(m) != c, worldChange(minor, held, optIn, city.set(m, c), blocked, "move") }

  // ================================================================== one matching run (match/run.ts)
  action beginRun: bool = all {
    focus == "search", not(runOpen),
    runOpen' = true, srch' = emptySearch, found' = Set(), circled' = Set(),
    cands' = Map(), sel' = emptySel,
    keepWorld, keepPlanner, h' = h, n' = n, lastAction' = "beginRun",
  }
  // The run's searches, edges and circles end with it (the World of the next run is new).
  action endRun: bool = all {
    runOpen, srch.phase == "Idle",
    runOpen' = false, srch' = srch, found' = Set(), circled' = Set(),
    keepSel, keepWorld, keepPlanner, h' = h, n' = n, lastAction' = "endRun",
  }

  // ------------------------------------------------------------------ the bounded search (candidateSearch)
  // beginSearch: one search per lane membership per run (MatchRun.candidates memoizes by profile id).
  action beginSearch(m: str, lane: str): bool = all {
    runOpen, srch.phase == "Idle", hasProfile(m, lane),
    not(found.exists(r => r.owner == m and r.lane == lane)),
    srch' = { ...emptySearch, phase: "Scanning", owner: m, lane: lane },
    found' = found, runOpen' = runOpen, circled' = circled,
    keepSel, keepWorld, keepPlanner, h' = h, n' = { ...n, searches: n.searches + 1 }, lastAction' = "beginSearch",
  }
  // checkCandidate: each block position is checked at most once; every check counts; a candidate without
  // a pair value is not kept; the kept list holds the best LIMIT; a displaced or refused candidate updates
  // the best dropped rank.
  action checkCandidate(o: str): bool = all {
    runOpen, srch.phase == "Scanning", srch.checks < BUDGET,
    block(srch.owner, srch.lane).contains(o), not(srch.seen.contains(o)),
    val v = valueIn(srch.owner, srch.lane, o)
    val worst = srch.kept.filter(x => srch.kept.forall(y => x == y or
      ranksAbove(valueIn(srch.owner, srch.lane, y), ORD.get(y), valueIn(srch.owner, srch.lane, x), ORD.get(x))))
    val counted = { ...srch, checks: srch.checks + 1, seen: srch.seen.union(Set(o)) }
    val after =
      if (v < 0) counted
      else if (srch.kept.size() < LIMIT) { ...counted, kept: srch.kept.union(Set(o)) }
      else {
        val w = worst.fold("a", (acc, x) => x)
        val wv = valueIn(srch.owner, srch.lane, w)
        if (ranksAbove(v, ORD.get(o), wv, ORD.get(w))) {
          val upd = ranksAbove(wv, ORD.get(w), srch.dropV, srch.dropO)
          { ...counted, kept: srch.kept.exclude(Set(w)).union(Set(o)),
            dropV: if (upd) wv else srch.dropV, dropO: if (upd) ORD.get(w) else srch.dropO }
        } else {
          val upd = ranksAbove(v, ORD.get(o), srch.dropV, srch.dropO)
          { ...counted, dropV: if (upd) v else srch.dropV, dropO: if (upd) ORD.get(o) else srch.dropO }
        }
      }
    all {
      srch' = after,
      n' = { ...n, dropped: n.dropped + (if (after.dropV >= 0 and srch.dropV < 0) 1 else 0) },
    },
    found' = found, runOpen' = runOpen, circled' = circled,
    keepSel, keepWorld, keepPlanner, h' = h, lastAction' = "checkCandidate",
  }
  // The shell's unseen bound (lawBucketBoundSound): -1 when every block candidate was checked, else at
  // least 0 and at least every unchecked pair value.
  def boundSound(b: int): bool = {
    val unseen = block(srch.owner, srch.lane).exclude(srch.seen)
    if (unseen.size() == 0) b == NO_VALUE
    else b >= 0 and b >= maxOf(unseen.map(o => valueIn(srch.owner, srch.lane, o)))
  }
  def stopsExact(b: int): bool =
    b < 0 or (srch.kept.size() == LIMIT and srch.kept.forall(x => valueIn(srch.owner, srch.lane, x) > b))
  // closeExact, or closeBudgeted when the check budget or the posting walk (walkSpent: the touch limit
  // searchTouchesPerCheck x budget, an oracle here) is spent and the search cannot stop exactly.
  action closeSearch(b: int, exact: bool, walkSpent: bool): bool = all {
    runOpen, srch.phase == "Scanning", boundSound(b),
    if (exact) stopsExact(b) else ((srch.checks >= BUDGET or walkSpent) and not(stopsExact(b))),
    found' = found.union(Set({ owner: srch.owner, lane: srch.lane, kept: srch.kept, seen: srch.seen, exact: exact,
                               checks: srch.checks, unseen: b, dropV: srch.dropV })),
    srch' = emptySearch,
    n' = { ...n, exactUnseen: n.exactUnseen + (if (exact and b >= 0) 1 else 0), budgeted: n.budgeted + (if (exact) 0 else 1) },
    runOpen' = runOpen, circled' = circled,
    keepSel, keepWorld, keepPlanner, h' = h, lastAction' = if (exact) "closeExact" else "closeBudgeted",
  }

  // One whole search in one step, in the canonical walk: candidates in bound order with exact bounds (the
  // best case of the index), BUDGET checks, then a close with the tightest sound bound. It is the same
  // machine run that beginSearch, checkCandidate and closeSearch can produce; random simulation uses it so
  // that deep states (circles) are reachable.
  def blockRanksAbove(owner: str, lane: str, x: str, y: str): bool =
    ranksAbove(valueIn(owner, lane, x), ORD.get(x), valueIn(owner, lane, y), ORD.get(y))
  action searchWhole(m: str, lane: str): bool = {
    val blk = block(m, lane)
    val seen = blk.filter(x => blk.filter(y => y != x and blockRanksAbove(m, lane, y, x)).size() < BUDGET)
    val pool = seen.filter(x => valueIn(m, lane, x) >= 0)
    val kept = pool.filter(x => pool.filter(y => y != x and blockRanksAbove(m, lane, y, x)).size() < LIMIT)
    val unseen = blk.exclude(seen)
    val b = if (unseen.size() == 0) NO_VALUE else { val v = maxOf(unseen.map(o => valueIn(m, lane, o))) if (v < 0) 0 else v }
    val exact = b < 0 or (kept.size() == LIMIT and kept.forall(x => valueIn(m, lane, x) > b))
    all {
      runOpen, srch.phase == "Idle", hasProfile(m, lane), not(found.exists(r => r.owner == m and r.lane == lane)),
      exact or seen.size() >= BUDGET,
      found' = found.union(Set({ owner: m, lane: lane, kept: kept, seen: seen, exact: exact, checks: seen.size(), unseen: b,
                                 dropV: NO_VALUE })),
      srch' = srch, runOpen' = runOpen, circled' = circled,
      n' = { ...n, searches: n.searches + 1 },
      keepSel, keepWorld, keepPlanner, h' = h, lastAction' = "searchWhole",
    }
  }

  // ------------------------------------------------------------------ screening and scoring (filters.ts, scoring.ts)
  // One candidate from a generator (an oracle: any participants, lane, alternates and intermediary),
  // through screenCandidate in its fixed order; on a pass, kept alternates, then scoring from pair values.
  action screen(parts: Set[str], lane: str, alts: Set[str], useVia: bool, v: str, bonus: int, packNo: bool): bool = {
    val involved = parts.union(alts).union(if (useVia) Set(v) else Set())
    val multi = parts.size() >= 2
    val passed = and {
      parts.size() >= 1, parts.size() <= MAX_G, alts.intersect(parts) == Set(),
      not(involved.exists(m => minor.get(m))),                                          // Age
      useVia implies (not(held.get(v)) and not(parts.contains(v)) and parts.forall(p => not(isBlocked(blocked, p, v)))), // Intermediary
      parts.forall(m => memberOk(m, lane)),                                              // Members
      pairwiseOk(blocked, parts),                                                        // Pairs: pairReason
      multi implies lane != NONE,                                                        // laneReason: no_lane
      multi implies allValued(parts, lane),                                              // laneReason: no_pair_value
      sameCity(city, parts),                                                             // Presence
    }
    val keptAlts = if (multi and lane != NONE) alts.filter(x => parts.forall(p => pairValue(x, p, lane) >= 0)) else alts
    val fit = if (multi) pvMin(parts, lane) else 1
    val benefit = if (multi) pvMean(parts, lane) else 1
    val status = if (fit + bonus >= THRESHOLD) "eligible" else "below"
    val key = cands.keys().size() + 1
    all {
      runOpen, sel.phase == "Idle", passed,
      cands' = cands.put(key, { parts: parts, lane: lane, alts: keptAlts, fit: fit, benefit: benefit,
                                score: fit + bonus, pre: fit + bonus, status: status, preStatus: status,
                                packNo: packNo, screened: true }),
      h' = { ...h,
        candMinor: h.candMinor or involved.exists(m => minor.get(m)),
        candBlocked: h.candBlocked or not(pairwiseOk(blocked, parts)),
        candViaUnsafe: h.candViaUnsafe or (useVia and (held.get(v) or minor.get(v) or parts.exists(p => isBlocked(blocked, p, v)))),
        candNoLane: h.candNoLane or (multi and lane == NONE),
        candNoValue: h.candNoValue or (multi and not(allValued(parts, lane))),
        candOneSided: h.candOneSided or (multi and pairsOf(parts).exists(p => p.exists(x => p.exists(y => x != y and util(x, y) < utilityFloor(lane))))),
        candParity: h.candParity or (multi and pairsOf(parts).exists(p => p.exists(x => p.exists(y =>
          absDiff(ST.get(x), ST.get(y)) > parityBand(lane) + UNC.get(x) + UNC.get(y))))),
        candUnbalanced: h.candUnbalanced or (multi and balanceRequired(lane) and pairsOf(parts).exists(p => p.exists(x => p.exists(y =>
          absDiff(util(x, y), util(y, x)) > 1)))),
        candApart: h.candApart or not(sameCity(city, parts)),
        candLaneNotOffered: h.candLaneNotOffered or (multi and not(laneOffered(pack, lane))),
        altNoValue: h.altNoValue or (multi and keptAlts.exists(x => parts.exists(p => pairValue(x, p, lane) < 0))),
        fitNotFromPairs: h.fitNotFromPairs or (multi and (fit < 0 or pairsOf(parts).exists(p => pairValue(lo(p), hi(p), lane) < fit))),
      },
      n' = { ...n, pairCands: n.pairCands + (if (parts.size() == 2) 1 else 0) },
      keepWorld, keepRun, sel' = sel, keepPlanner, lastAction' = "screen",
    }
  }

  // The judge (engine.ts passes 2 and 3): it can lower the score, or remove the candidate; it never raises.
  action judge(key: int, lower: int, remove: bool): bool = all {
    sel.phase == "Idle", cands.keys().contains(key), cands.get(key).status != "removed",
    lower >= 0, lower > 0 or remove,
    val c = cands.get(key)
    cands' = cands.set(key, { ...c, score: c.score - lower,
      status: if (remove) "removed" else if (c.score - lower < THRESHOLD and c.status == "eligible") "below" else c.status }),
    sel' = sel, n' = { ...n, lowered: n.lowered + 1 },
    keepWorld, keepRun, keepPlanner, h' = h, lastAction' = "judge",
  }

  // ------------------------------------------------------------------ circles and groups (circles.ts, group.ts)
  def spreadOk(s: Set[str], lane: str): bool = {
    val lo = s.filter(x => s.forall(y => ranksAbove(ST.get(y), ORD.get(y), ST.get(x), ORD.get(x)) or x == y))
    val hi = s.filter(x => s.forall(y => ranksAbove(ST.get(x), ORD.get(x), ST.get(y), ORD.get(y)) or x == y))
    val l = lo.fold("a", (acc, x) => x)
    val u = hi.fold("a", (acc, x) => x)
    ST.get(u) - ST.get(l) <= parityBand(lane) + UNC.get(l) + UNC.get(u)
  }
  // spec/groupFormation.md circleCoherent over the circle evidence of the members (edges only).
  def circleCoherent(s: Set[str], lane: str): bool = and {
    s.size() >= MIN_G, s.size() <= MAX_G,
    pairsOf(s).forall(p => edgeValue(lo(p), hi(p), lane) >= circlePairFloor(lane)),
    spreadOk(s, lane),
  }
  // buildCircles admission: links at the pair floor, open members (one circle per lane per run), the
  // spread, then circleCoherent. composeGroup: alternates with an edge to every primary member in the
  // group's city; distinctAlternates keeps `kept` (no minors, nobody blocked with a participant or a
  // kept alternate, and first-name duplicates as an oracle).
  action composeGroup(lane: str, primary: Set[str], alts: Set[str], kept: Set[str]): bool = all {
    runOpen, sel.phase == "Idle", formsCircles(lane), laneOffered(pack, lane),
    primary.forall(m => not(circled.contains((m, lane)))),
    primary.size() >= MIN_G, primary.size() <= MAX_G,
    pairsOf(primary).forall(p => edgeValue(lo(p), hi(p), lane) >= circlePairFloor(lane)),
    spreadOk(primary, lane),
    alts.intersect(primary) == Set(),
    alts.forall(y => primary.forall(x => edgeValue(x, y, lane) >= 0 and city.get(x) == city.get(y))),
    kept.subseteq(alts), kept.forall(m => not(minor.get(m))), crossOk(blocked, primary, kept), pairwiseOk(blocked, kept),
    circled' = circled.union(primary.map(m => (m, lane))),
    cands' = cands.put(cands.keys().size() + 1, {
      parts: primary, lane: lane, alts: kept, fit: pvMin(primary, lane), benefit: pvMean(primary, lane),
      score: pvMin(primary, lane), pre: pvMin(primary, lane),
      status: "eligible", preStatus: "eligible", packNo: false, screened: true }),
    h' = { ...h,
      groupMinor: h.groupMinor or primary.union(alts).exists(m => minor.get(m)),
      groupBlocked: h.groupBlocked or not(pairwiseOk(blocked, primary)),
      groupAltBlockedWithPrimary: h.groupAltBlockedWithPrimary or not(crossOk(blocked, primary, alts)),
      groupSizeBad: h.groupSizeBad or primary.size() < MIN_G or primary.size() > MAX_G,
      groupApart: h.groupApart or not(sameCity(city, primary.union(alts))),
      groupIncoherent: h.groupIncoherent or not(circleCoherent(primary, lane)),
      circleTwice: h.circleTwice or primary.exists(m => circled.contains((m, lane))),
      submittedBlocked: h.submittedBlocked or not(pairwiseOk(blocked, primary.union(kept))),
      altPairBlockedEngine: h.altPairBlockedEngine or not(pairwiseOk(blocked, alts)),
    },
    n' = { ...n, groupCands: n.groupCands + 1 },
    runOpen' = runOpen, srch' = srch, found' = found, sel' = sel,
    keepWorld, keepPlanner, lastAction' = "composeGroup",
  }

  // ------------------------------------------------------------------ selection (policy.ts, selectionRun)
  def cKeys: Set[int] = cands.keys()
  def roomFor(m: str): bool = sel.used.get(m) + 1 <= ROOM
  def refusedMember(m: str): bool = sel.refusals.exists(r => r.member == m)
  def limitsOpen(key: int): bool =
    sel.picks.forall(p => p.key != key) and pairsOf(cands.get(key).parts).forall(p => not(sel.pairsUsed.contains(p)))
  // policy.ts shell.fits: limits, members with room, the pack hook (packAllows), no refused member.
  def fits(key: int): bool = and {
    limitsOpen(key), not(cands.get(key).packNo),
    cands.get(key).parts.forall(m => roomFor(m) and not(refusedMember(m))),
  }
  def reserved(key: int, phase: str, value: int): Sel = {
    val c = cands.get(key)
    { ...sel, picks: sel.picks.union(Set({ key: key, phase: phase, value: value, seq: sel.seq })), seq: sel.seq + 1,
      used: MEMBERS.mapBy(m => sel.used.get(m) + (if (c.parts.contains(m)) 1 else 0)),
      pairsUsed: sel.pairsUsed.union(pairsOf(c.parts)), decided: sel.decided.union(Set(key)),
      bound: if (phase == "Greedy") value else sel.bound }
  }
  action beginSelection: bool = all { sel.phase == "Idle", cKeys.size() > 0, sel' = { ...sel, phase: "Exposure" }, cands' = cands,
    keepWorld, keepRun, keepPlanner, h' = h, n' = n, lastAction' = "beginSelection" }
  action nextSelectionPhase: bool = all {
    sel.phase == "Exposure" or sel.phase == "Exploration" or sel.phase == "Greedy",
    sel' = { ...sel, phase: if (sel.phase == "Exposure") "Exploration" else if (sel.phase == "Exploration") "Greedy" else "Complete" },
    cands' = cands, keepWorld, keepRun, keepPlanner, h' = h, n' = n, lastAction' = "nextSelectionPhase",
  }
  // 1. Exposure floor: an eligible candidate that fits (the member's best option; an oracle here).
  action exposurePick(key: int): bool = all {
    sel.phase == "Exposure", cKeys.contains(key), cands.get(key).status == "eligible", fits(key),
    sel' = reserved(key, "Exposure", cands.get(key).score), cands' = cands,
    n' = { ...n, exposure: n.exposure + 1 }, keepWorld, keepRun, keepPlanner, h' = h, lastAction' = "exposurePick",
  }
  // 2. Exploration: eligible or below the threshold, never a judge removal; a seeded draw (an oracle).
  action explorePick(key: int): bool = all {
    sel.phase == "Exploration", cKeys.contains(key), cands.get(key).status != "removed", fits(key),
    sel' = reserved(key, "Exploration", cands.get(key).score), cands' = cands,
    n' = { ...n, explore: n.explore + 1 }, keepWorld, keepRun, keepPlanner, h' = h, lastAction' = "explorePick",
  }
  // 3. Greedy: one walk over the eligible candidates sorted once by (score desc, key asc). Each choice is
  // decided once: skipped (a refused member, used limits, the pack refusal), refused (a member has no
  // room: recorded with that member), or reserved.
  def greedyNext: Set[int] = {
    val open = cKeys.filter(k => cands.get(k).status == "eligible" and not(sel.decided.contains(k)))
    open.filter(k => open.forall(j => j == k or ranksAbove(cands.get(k).score, k, cands.get(j).score, j)))
  }
  action greedyStep: bool = all {
    sel.phase == "Greedy", greedyNext.size() == 1,
    val key = greedyNext.fold(0, (acc, k) => k)
    val c = cands.get(key)
    val skip = c.parts.exists(m => refusedMember(m)) or not(limitsOpen(key)) or c.packNo
    val full = c.parts.filter(m => not(roomFor(m)))
    val blockedM = full.filter(m => full.forall(x => ORD.get(m) <= ORD.get(x))).fold("a", (acc, m) => m)
    all {
      sel' = if (skip) { ...sel, decided: sel.decided.union(Set(key)) }
             else if (full.size() > 0) { ...sel, decided: sel.decided.union(Set(key)), bound: c.score,
               refusals: sel.refusals.union(Set({ member: blockedM, at: sel.used.get(blockedM), value: c.score })) }
             else reserved(key, "Greedy", c.score),
      n' = if (skip) n else if (full.size() > 0) { ...n, refused: n.refused + 1 } else { ...n, greedy: n.greedy + 1 },
    },
    cands' = cands, keepWorld, keepRun, keepPlanner, h' = h, lastAction' = "greedyStep",
  }

  // ================================================================== friends planner (planner.ts planFriendsWeek)
  action startWeek: bool = all {
    focus == "plan", pack == "friends", wk.phase == "idle",
    wk' = { ...emptyWeek, phase: "sessions" },
    crews' = crews, offered' = offered, outcomes' = outcomes,
    keepWorld, keepRun, keepSel, h' = h, n' = n, lastAction' = "startWeek",
  }
  action nextPhase: bool = {
    val nxt = if (wk.phase == "sessions") "offers" else if (wk.phase == "offers") "repeats" else if (wk.phase == "repeats") "new" else "idle"
    all {
      focus == "plan", pack == "friends", wk.phase != "idle",
      wk' = if (nxt == "idle") emptyWeek else { ...wk, phase: nxt },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepRun, keepSel, h' = h, n' = n, lastAction' = "nextPhase",
    }
  }

  // Pass 1: members = crew.members.filter(eligible); at least 2; crewSessionPlan returns null unless every
  // pair has a Friend pair value; finish() may drop invitees for transit (`invited`), quorum min(3, n).
  // `refused`: finish() returned null. Sessions do not read the recurring reservations (spec/friendsWeek.md).
  action crewSession(c: Crew, invited: Set[str], refused: bool): bool = {
    val members = c.members.filter(m => planEligible(m))
    val ok = not(refused) and members.size() >= 2 and allValued(members, "Friend")
    all {
      wk.phase == "sessions", crews.contains(c), not(wk.sessionsDone.contains(c)),
      if (ok) all { invited.subseteq(members), invited.size() >= (if (members.size() < 3) members.size() else 3) } else invited == Set(),
      wk' = { ...wk, sessionsDone: wk.sessionsDone.union(Set(c)), taken: wk.taken.union(invited),
              crewCount: if (ok) MEMBERS.mapBy(m => wk.crewCount.get(m) + (if (invited.contains(m)) 1 else 0)) else wk.crewCount },
      h' = if (not(ok)) h else { ...h,
        sessionMinor: h.sessionMinor or invited.exists(m => minor.get(m)),
        sessionBlocked: h.sessionBlocked or not(pairwiseOk(blocked, invited)),
        sessionNoValue: h.sessionNoValue or not(allValued(invited, "Friend")),
        sessionUnderMin: h.sessionUnderMin or invited.size() < MIN_G,
        crewTwice: h.crewTwice or invited.exists(m => wk.crewCount.get(m) >= 1),
      },
      n' = if (ok) { ...n, sessions: n.sessions + 1 } else n,
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepRun, keepSel, lastAction' = "crewSession",
    }
  }

  // Pass 2 (plans.ts detectCrews with minPlans 1, then crewSessionPlan): the positive members not in a crew
  // of the activity (live, offered, or found this week), eligible and not reserved; at least minMembers;
  // the pair gate on every pair; finish() keeps `invited` (quorum 3) or refuses.
  action crewOffer(o: Outcome, invited: Set[str], refused: bool): bool = {
    val inCrew = crews.union(offered).union(wk.detected).filter(c => c.act == o.act).fold(Set(), (s, c) => s.union(c.members))
    val pos = o.positive.exclude(inCrew)
    val members = pos.filter(m => planEligible(m) and not(wk.taken.contains(m)))
    val ok = not(refused) and pos.size() >= MIN_G and members.size() >= MIN_G and allValued(members, "Friend")
    all {
      wk.phase == "offers", outcomes.contains(o), not(wk.outcomesDone.contains(o.id)),
      if (ok) all { invited.subseteq(members), invited.size() >= MIN_G } else invited == Set(),
      wk' = { ...wk, outcomesDone: wk.outcomesDone.union(Set(o.id)), taken: wk.taken.union(invited),
              detected: if (pos.size() >= MIN_G) wk.detected.union(Set({ act: o.act, members: pos })) else wk.detected,
              crewCount: if (ok) MEMBERS.mapBy(m => wk.crewCount.get(m) + (if (members.contains(m)) 1 else 0)) else wk.crewCount },
      offered' = if (ok) offered.union(Set({ act: o.act, members: members })) else offered,
      h' = if (not(ok)) h else { ...h,
        offerMinor: h.offerMinor or members.exists(m => minor.get(m)),
        offerBlocked: h.offerBlocked or not(pairwiseOk(blocked, members)),
        offerNoValue: h.offerNoValue or not(allValued(members, "Friend")),
        offerInvitedTwice: h.offerInvitedTwice or invited.exists(m => wk.taken.contains(m)),
        offerSizeBad: h.offerSizeBad or invited.size() < MIN_G,
        crewTwice: h.crewTwice or members.exists(m => wk.crewCount.get(m) >= 1),
      },
      n' = if (ok) { ...n, offers: n.offers + 1 } else n,
      crews' = crews, outcomes' = outcomes,
      keepWorld, keepRun, keepSel, lastAction' = "crewOffer",
    }
  }

  // Pass 3: pos = positive, eligible, not reserved; at least 2; ids = up to MAX_G of them; familiarCircle
  // needs a pair value for every pair of ids; alternates = attended - ids, eligible, not reserved (none for
  // a pair, up to 2 for a group), with no pair check; finish() drops `dropped` for transit and fills the
  // seats from the alternates; the reservation holds invited and the remaining alternates.
  action repeatPlan(o: Outcome, ids: Set[str], alts: Set[str], dropped: Set[str], fill: Set[str]): bool = {
    val pos = o.positive.filter(m => planEligible(m) and not(wk.taken.contains(m)))
    val partner = ids.size() == 2
    val altPool = o.attended.exclude(ids).filter(m => planEligible(m) and not(wk.taken.contains(m)))
    val invited = ids.exclude(dropped).union(fill)
    val altsLeft = alts.exclude(fill)
    val quorum = if (partner) 2 else 3
    all {
      wk.phase == "repeats", outcomes.contains(o), not(wk.repeatsDone.contains(o.id)),
      pos.size() >= 2,
      ids.subseteq(pos), ids.size() == (if (pos.size() < MAX_G) pos.size() else MAX_G),
      allValued(ids, "Friend"),
      alts.subseteq(altPool), alts.size() == (if (partner) 0 else (if (altPool.size() < 2) altPool.size() else 2)),
      dropped.subseteq(ids), fill.subseteq(alts),
      fill.size() == (if (partner) 0 else (if (dropped.size() < alts.size()) dropped.size() else alts.size())),
      invited.size() >= quorum,
      wk' = { ...wk, repeatsDone: wk.repeatsDone.union(Set(o.id)), taken: wk.taken.union(invited).union(altsLeft) },
      h' = { ...h,
        repeatMinor: h.repeatMinor or invited.union(altsLeft).exists(m => minor.get(m)),
        repeatInviteesNoValue: h.repeatInviteesNoValue or not(allValued(ids, "Friend")),
        repeatBlocked: h.repeatBlocked or not(pairwiseOk(blocked, invited.union(altsLeft))),
        repeatSizeBad: h.repeatSizeBad or (if (partner) invited.size() != 2 else (invited.size() < MIN_G or invited.size() > MAX_G)),
      },
      n' = { ...n, repeats: n.repeats + 1 },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepRun, keepSel, lastAction' = "repeatPlan",
    }
  }

  // Pass 4: one table per circle of the members the week can seat (seats.match.circles("Friend"): every
  // pair at the circle pair floor, the spread, circleCoherent); circleAlternates: open members with
  // pairReason clear against each invitee (no pair value, no check between alternates); finish() drops
  // `dropped` for transit and fills seats from the alternates; reserveNewPlan holds invited and
  // alternates (openTable).
  def newOpen(m: str): bool = planEligible(m) and not(wk.used.contains(m))
  def planCircleOk(s: Set[str]): bool = and {
    s.size() >= MIN_G, s.size() <= MAX_G,
    pairsOf(s).forall(p => pairValue(lo(p), hi(p), "Friend") >= circlePairFloor("Friend")),
    spreadOk(s, "Friend"),
  }
  action newPlan(primary: Set[str], alts: Set[str], dropped: Set[str], fill: Set[str]): bool = {
    val invited = primary.exclude(dropped).union(fill)
    val altsLeft = alts.exclude(fill)
    all {
      wk.phase == "new",
      primary.forall(m => newOpen(m)), planCircleOk(primary),
      alts.intersect(primary) == Set(), alts.forall(m => newOpen(m)),
      alts.forall(x => primary.forall(p => not(isBlocked(blocked, x, p)))),
      dropped.subseteq(primary), fill.subseteq(alts),
      fill.size() == (if (dropped.size() < alts.size()) dropped.size() else alts.size()),
      invited.size() >= MIN_G,
      wk' = { ...wk, used: wk.used.union(invited).union(altsLeft) },
      h' = { ...h,
        planMinor: h.planMinor or invited.union(altsLeft).exists(m => minor.get(m)),
        planCircleIncoherent: h.planCircleIncoherent or not(planCircleOk(primary)),
        planSeatedBlocked: h.planSeatedBlocked or not(pairwiseOk(blocked, invited)),
        planSeatedNoValue: h.planSeatedNoValue or not(allValued(invited, "Friend")),
        planSizeBad: h.planSizeBad or invited.size() < MIN_G or invited.size() > MAX_G,
        planSeatTwice: h.planSeatTwice or invited.union(altsLeft).exists(m => wk.used.contains(m)),
      },
      n' = { ...n, plans: n.plans + 1 },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepRun, keepSel, lastAction' = "newPlan",
    }
  }

  // Pass 5: the Friend lane's edges (a pair value), memberReason and pairReason for one-to-one, at most
  // partnerIntros per member this week.
  action partnerPlan(x: str, y: str): bool = all {
    wk.phase == "new",
    pairValue(x, y, "Friend") >= 0, memberOk(x, NONE), memberOk(y, NONE),
    wk.partnerCount.get(x) < PARTNER_INTROS, wk.partnerCount.get(y) < PARTNER_INTROS,
    wk' = { ...wk, partnerCount: wk.partnerCount.setBy(x, v => v + 1).setBy(y, v => v + 1) },
    h' = { ...h,
      partnerMinor: h.partnerMinor or minor.get(x) or minor.get(y),
      partnerNoValue: h.partnerNoValue or pairValue(x, y, "Friend") < 0,
      partnerOverCap: h.partnerOverCap or wk.partnerCount.get(x) >= PARTNER_INTROS or wk.partnerCount.get(y) >= PARTNER_INTROS,
    },
    n' = { ...n, partners: n.partners + 1 },
    crews' = crews, offered' = offered, outcomes' = outcomes,
    keepWorld, keepRun, keepSel, lastAction' = "partnerPlan",
  }

  // Between weeks: the members of an offered crew opt in (plans.ts crewOptIn: below minMembers there is no
  // crew), and a meetup ends with an outcome (who attended, who would do it again).
  action crewOptIn(c: Crew, yes: Set[str]): bool = all {
    wk.phase == "idle", offered.contains(c), yes.subseteq(c.members),
    offered' = offered.exclude(Set(c)),
    crews' = if (yes.size() >= MIN_G) crews.union(Set({ act: c.act, members: yes })) else crews,
    outcomes' = outcomes, wk' = wk,
    keepWorld, keepRun, keepSel, h' = h, n' = n, lastAction' = "crewOptIn",
  }
  action meetup(id: str, act: str, attended: Set[str], positive: Set[str]): bool = all {
    wk.phase == "idle", not(outcomes.exists(o => o.id == id)),
    attended.size() >= MIN_G, positive.subseteq(attended),
    outcomes' = outcomes.union(Set({ id: id, act: act, attended: attended, positive: positive })),
    crews' = crews, offered' = offered, wk' = wk,
    keepWorld, keepRun, keepSel, h' = h, n' = n, lastAction' = "meetup",
  }

  // The planner's own choices, for random simulation (the oracle variants stay too).
  def repeatPos(o: Outcome): Set[str] = o.positive.filter(m => planEligible(m) and not(wk.taken.contains(m)))
  def repeatAlts(o: Outcome): Set[str] = o.attended.exclude(repeatPos(o)).filter(m => planEligible(m) and not(wk.taken.contains(m)))
  def offerMembers(o: Outcome): Set[str] = {
    val inCrew = crews.union(offered).filter(c => c.act == o.act).fold(Set(), (s, c) => s.union(c.members))
    o.positive.exclude(inCrew).filter(m => planEligible(m) and not(wk.taken.contains(m)))
  }

  action stutter = all { keepWorld, keepRun, keepSel, keepPlanner, h' = h, n' = n, lastAction' = "stutter" }

  // ------------------------------------------------------------------ step
  action worldStep = {
    nondet x = MEMBERS.oneOf()
    nondet y = MEMBERS.oneOf()
    nondet c = CITIES.oneOf()
    nondet lane = LANES.oneOf()
    nondet v = Set(true, false).oneOf()
    any { blockPair(x, y), statesMinorAge(x), setHold(x, v), setOptIn(x, lane, v), move(x, c) }
  }
  // The run's own choices, for random simulation: a search step on its block, a sound bound, a guided
  // circle, and an oracle generator.
  action searchStep = {
    nondet m = ADULTS.oneOf()
    nondet lane = Set("Friend", "Intro").oneOf()
    nondet b = BOUNDS.oneOf()
    nondet ex = Set(true, false).oneOf()
    // A spent posting walk is rare (1 in 4), so that random traces also build circles from full searches.
    nondet roll = 0.to(3).oneOf()
    val spent = roll == 0
    any {
      beginRun, endRun, beginSearch(m, lane), closeSearch(b, ex, spent), searchWhole(m, lane), searchWhole(m, lane),
      all { srch.phase == "Scanning", block(srch.owner, srch.lane).exclude(srch.seen).size() > 0,
            nondet o = block(srch.owner, srch.lane).exclude(srch.seen).oneOf()
            checkCandidate(o) },
    }
  }
  def guidedCircles(lane: str): Set[Set[str]] =
    ADULTS.powerset().filter(s => s.size() >= MIN_G and s.size() <= MAX_G
      and pairsOf(s).forall(p => edgeValue(lo(p), hi(p), lane) >= circlePairFloor(lane)))
  action candStep = {
    nondet lane = Set("Friend", "Intro", "Date").oneOf()
    nondet parts = MEMBERS.powerset().oneOf()
    nondet alts = MEMBERS.powerset().oneOf()
    nondet via = MEMBERS.oneOf()
    nondet useVia = Set(true, false).oneOf()
    nondet bonus = Set(0, 1).oneOf()
    nondet packNo = Set(true, false).oneOf()
    nondet keptAlts = MEMBERS.powerset().oneOf()
    any {
      screen(parts, lane, alts, useVia, via, bonus, packNo),
      screen(parts, NONE, alts, false, via, bonus, packNo),
      all { found.size() > 0,
            nondet r = found.oneOf()
            all { r.kept.size() > 0, nondet o = r.kept.oneOf() screen(Set(r.owner, o), r.lane, alts, false, via, bonus, packNo) } },
      all { guidedCircles(lane).size() > 0, nondet p = guidedCircles(lane).oneOf() composeGroup(lane, p, Set(), Set()) },
      composeGroup(lane, parts, alts, keptAlts),
    }
  }
  action selectStep = {
    nondet key = Set(1, 2, 3, 4, 5, 6, 7, 8).oneOf()
    nondet lower = Set(0, 1).oneOf()
    nondet remove = Set(true, false).oneOf()
    any { judge(key, lower, remove), beginSelection, nextSelectionPhase, exposurePick(key), explorePick(key), greedyStep }
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
      crewOffer(o, s1, r),
      repeatPlan(o, repeatPos(o), repeatAlts(o), Set(), Set()),
      repeatPlan(o, s1, s2, s3, s4),
      newPlan(s1, s2, s3, s4),
      newPlan(s1, Set(), Set(), Set()),
      partnerPlan(x, y),
      crewOptIn(off, s1),
      meetup(oid, act, s1, s2),
    }
  }
  action step = any {
    all { focus == "search", any { worldStep, searchStep, candStep, selectStep } },
    all { focus == "select", selectStep },
    all { focus == "plan", any { worldStep, plannerStep } },
    stutter,
  }

  // ------------------------------------------------------------------ invariants
  // spec/candidateSearch.md alwaysKeptWithinLimit, alwaysChecksWithinBudget, alwaysKeptValuesAreRealPairs and
  // alwaysKeptRankAboveDropped, for the open search and for every closed one.
  val keptWithinLimit = srch.kept.size() <= LIMIT and found.forall(r => r.kept.size() <= LIMIT)
  val checksWithinBudget = srch.checks <= BUDGET and found.forall(r => r.checks <= BUDGET)
  val keptValuesAreRealPairs =
    srch.kept.forall(x => valueIn(srch.owner, srch.lane, x) >= 0) and found.forall(r => r.kept.forall(x => valueIn(r.owner, r.lane, x) >= 0))
  val keptRankAboveDropped = srch.dropV < 0 or srch.kept.forall(x => ranksAbove(valueIn(srch.owner, srch.lane, x), ORD.get(x), srch.dropV, srch.dropO))
  // The composed theorem of spec/candidateSearch.md: an Exact search kept exactly the brute-force best
  // LIMIT of the feasible set (bruteForceCandidates).
  val exactIsBruteForce = found.forall(r => r.exact implies topOk(r.owner, r.lane, r.kept, feasible(r.owner, r.lane)))
  // A Budgeted search kept the best of what it checked, and nothing it did not check has a pair value
  // above the bound it reports (Story F21).
  val budgetedReportsBound = found.forall(r => not(r.exact) implies and {
    topOk(r.owner, r.lane, r.kept, feasible(r.owner, r.lane).intersect(r.seen)),
    feasible(r.owner, r.lane).exclude(r.seen).forall(o => valueIn(r.owner, r.lane, o) <= r.unseen),
  })
  // The cost bound: at most one search per lane membership per run, each within its budget.
  val oneSearchPerMembership = found.forall(r => found.forall(q => (q.owner == r.owner and q.lane == r.lane) implies q == r))
  val searchCostBounded = found.fold(0, (s, r) => s + r.checks) <= found.size() * BUDGET

  // AGENTS.md code invariants (age policy) and platform decision 1: minors (13-17) are never matched or
  // connected, in any app: no profile (profile.ts), the core pairReason prefix, screening Age (participants,
  // alternates and the intermediary), group.ts poolEligible, the planner's `eligible`.
  val noMinorEnters = not(h.candMinor or h.groupMinor or h.sessionMinor or h.offerMinor or h.repeatMinor
                          or h.planMinor or h.partnerMinor)
  // AGENTS.md "blocks win": a blocked pair is never put together by the engine or submitted together
  // (pairReason, the pair gate, crewSessionPlan, distinctAlternates). The engine-level and planner gaps are
  // the values below `safety`.
  val blockedApart = not(h.candBlocked or h.candViaUnsafe or h.groupBlocked or h.groupAltBlockedWithPrimary
                         or h.submittedBlocked or h.sessionBlocked or h.offerBlocked)
  // spec/pairValue.md lawNoOneSidedPair, lawParityHolds, lawBalancedExchange: every pair of a screened
  // multi-person candidate, of a crew session or offer, of a repeat's invitees and of an activity partner
  // has a pair value, so both utilities reach the floor, the gap is in the band, and the exchange is balanced.
  val noOneSidedPair = not(h.candOneSided)
  val parityHolds = not(h.candParity)
  val balancedExchange = not(h.candUnbalanced)
  val everyPairValued = not(h.candNoLane or h.candNoValue or h.altNoValue or h.sessionNoValue or h.offerNoValue
                            or h.repeatInviteesNoValue or h.partnerNoValue)
  // spec/matchLane.md laneOffered: a pack never matches in a lane it does not offer (friends.help: Friend only).
  val laneOfferedOnly = not(h.candLaneNotOffered)
  // scoring.ts pairTerms: fit is the lowest pair value of the candidate.
  val fitFromPairValues = not(h.fitNotFromPairs)
  // engine.ts pass 2 and pass 3: the judge only lowers or removes.
  val judgeOnlyLowers = cands.keys().forall(k => cands.get(k).score <= cands.get(k).pre
    and (cands.get(k).status == "eligible" implies cands.get(k).preStatus == "eligible"))
  // spec/groupFormation.md alwaysPrimaryCircleCoherent and buildCircles' one circle per member and lane per run.
  val primaryCircleCoherent = not(h.groupIncoherent or h.circleTwice or h.planCircleIncoherent)
  // Members meet only in one common market (eligiblePair, presence overlap, group.ts groupLocationAllowed).
  val coLocated = not(h.candApart or h.groupApart)
  // Group bounds: circleMinimum..circleMaximum (scaled), the planner's quorum and finish().
  val groupSizeBounds = not(h.groupSizeBad or h.offerSizeBad or h.repeatSizeBad or h.planSizeBad)
  // spec/friendsWeek.md reservations: a crew offer never invites a reserved member, new plans never seat a
  // member twice, partner intros keep partnerIntros.
  val seatsOnce = not(h.offerInvitedTwice or h.planSeatTwice or h.partnerOverCap)
  // spec/selectionRun.md: the pack refusal holds in every phase (packAllows).
  val packRefusalHonored = sel.picks.forall(p => not(cands.get(p.key).packNo))
  // Every member stays within its room (memberHasRoom), and a pair is used once.
  val roomRespected = MEMBERS.forall(m => sel.used.get(m) <= ROOM)
  // spec/selectionRun.md stepGreedyValuesNeverRise: greedy reservations come in non-increasing value order.
  val greedyValuesNeverRise = sel.picks.forall(p => sel.picks.forall(q =>
    (p.phase == "Greedy" and q.phase == "Greedy" and p.seq < q.seq) implies p.value >= q.value))
  // spec/selectionRun.md alwaysRefusedMemberStaysFull and the greedy stability claim: a refused member has no
  // room and gets no later reservation, and every greedy reservation that holds it is worth at least the
  // refused choice (no blocking pair inside the greedy phase).
  val refusedMemberStaysFull = sel.refusals.forall(r => sel.used.get(r.member) == r.at and r.at + 1 > ROOM)
  val noBlockingPairInGreedy = sel.refusals.forall(r => sel.picks.forall(p =>
    (p.phase == "Greedy" and cands.get(p.key).parts.contains(r.member)) implies p.value >= r.value))

  val safety = all {
    keptWithinLimit, checksWithinBudget, keptValuesAreRealPairs, keptRankAboveDropped, exactIsBruteForce,
    budgetedReportsBound, oneSearchPerMembership, searchCostBounded,
    noMinorEnters, blockedApart, noOneSidedPair, parityHolds, balancedExchange, everyPairValued, laneOfferedOnly,
    fitFromPairValues, judgeOnlyLowers, primaryCircleCoherent, coLocated, groupSizeBounds, seatsOnce,
    packRefusalHonored, roomRespected, greedyValuesNeverRise, refusedMemberStaysFull, noBlockingPairInGreedy,
  }

  // Defects and design choices (not in safety; see the header). Each is reached by a run test below.
  val noAltPairBlockedEngine = not(h.altPairBlockedEngine)
  val noRepeatBlocked = not(h.repeatBlocked)
  val newPlanSeatsApart = not(h.planSeatedBlocked)
  val newPlanSeatsValued = not(h.planSeatedNoValue)
  val oneCrewPerWeek = not(h.crewTwice)
  val sessionSizeOk = not(h.sessionUnderMin)

  // ------------------------------------------------------------------ witnesses (must be reachable)
  val witness_searchExactWithUnseen = n.exactUnseen == 0
  val witness_searchBudgeted = n.budgeted == 0
  val witness_searchDropped = n.dropped == 0
  val witness_pairCandidate = n.pairCands == 0
  val witness_groupCandidate = n.groupCands == 0
  val witness_judgeLowered = n.lowered == 0
  val witness_exposurePick = n.exposure == 0
  val witness_explorePick = n.explore == 0
  val witness_greedyReserved = n.greedy == 0
  val witness_greedyRefused = n.refused == 0
  val witness_session = n.sessions == 0
  val witness_offer = n.offers == 0
  val witness_repeat = n.repeats == 0
  val witness_plan = n.plans == 0
  val witness_partner = n.partners == 0

  // ------------------------------------------------------------------ run tests
  // a's Friend search: b (3), c (2), d (2), e (2), f (1). Checking b, c, d and e keeps b, c and d and drops
  // e (a tie that the ordinal breaks); the unseen f is worth 1, below every kept value: the search is exact
  // and equals the brute-force answer.
  run searchExactTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend"))
    .then(checkCandidate("b")).then(checkCandidate("c")).then(checkCandidate("d")).then(checkCandidate("e"))
    .expect(srch.dropV == 2 and srch.dropO == 4 and srch.checks == BUDGET)
    .then(closeSearch(1, true, false))
    .expect(found.exists(r => r.exact and r.kept == Set("b", "c", "d")) and safety)

  // Checking f, e, d and c leaves b unseen (worth 3): the search cannot close exact; it closes Budgeted
  // and reports the bound 3. A bound below the unseen value is refused.
  run searchNotExactTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend"))
    .then(checkCandidate("f")).then(checkCandidate("e")).then(checkCandidate("d")).then(checkCandidate("c"))
    .then(closeSearch(3, true, false)).fail()
  run searchBudgetedTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend"))
    .then(checkCandidate("f")).then(checkCandidate("e")).then(checkCandidate("d")).then(checkCandidate("c"))
    .then(closeSearch(3, false, false))
    .expect(found.exists(r => not(r.exact) and r.kept == Set("c", "d", "e") and r.unseen == 3) and safety)
  run searchUnsoundBoundTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend"))
    .then(checkCandidate("f")).then(checkCandidate("e")).then(checkCandidate("d")).then(checkCandidate("c"))
    .then(closeSearch(2, false, false)).fail()

  // The canonical walk for a: it checks b, c, d and e (bound order) and stops exact above f (1).
  run searchWholeTest = initWith("search", "network")
    .then(beginRun).then(searchWhole("a", "Friend"))
    .expect(found.exists(r => r.exact and r.kept == Set("b", "c", "d") and r.unseen == 1) and safety)

  // A spent posting walk closes the search Budgeted before the check budget, with a sound bound.
  run walkSpentTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend")).then(checkCandidate("e"))
    .then(closeSearch(3, false, false)).fail()
  run walkSpentCloseTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend")).then(checkCandidate("e"))
    .then(closeSearch(3, false, true))
    .expect(found.exists(r => not(r.exact) and r.checks == 1 and r.kept == Set("e")) and safety)

  // A search makes at most BUDGET checks, and a member gets one search per lane membership per run.
  run budgetTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend"))
    .then(checkCandidate("b")).then(checkCandidate("c")).then(checkCandidate("d")).then(checkCandidate("e"))
    .then(checkCandidate("f")).fail()
  run oneSearchTest = initWith("search", "network")
    .then(beginRun).then(beginSearch("a", "Friend"))
    .then(checkCandidate("b")).then(checkCandidate("c")).then(checkCandidate("d")).then(checkCandidate("e"))
    .then(closeSearch(1, true, false))
    .then(beginSearch("a", "Friend")).fail()

  // d values e and e does not value d: no pair value, so screening refuses the pair (no_pair_value).
  run oneSidedTest = initWith("search", "network")
    .then(beginRun).then(screen(Set("d", "e"), "Friend", Set(), false, "a", 0, false)).fail()

  // A two-person candidate without a lane is refused (no_lane); with one participant it needs none.
  run noLaneTest = initWith("search", "network")
    .then(beginRun).then(screen(Set("a", "b"), "none", Set(), false, "a", 0, false)).fail()
  run singleNoLaneTest = initWith("search", "network")
    .then(beginRun).then(screen(Set("a"), "none", Set(), false, "a", 0, false))
    .expect(cands.keys().size() == 1 and safety)

  // Intro needs parity: c (1) and d (3) differ by more than the band and the uncertainties; friends.help
  // offers no Intro lane at all; nobody has a Date profile outside slop.date.
  run introParityTest = initWith("search", "network")
    .then(beginRun).then(screen(Set("c", "d"), "Intro", Set(), false, "a", 0, false)).fail()
  run friendsNoIntroTest = initWith("search", "friends")
    .then(beginRun).then(screen(Set("a", "b"), "Intro", Set(), false, "a", 0, false)).fail()
  run noDateTest = initWith("search", "network")
    .then(beginRun).then(screen(Set("a", "b"), "Date", Set(), false, "a", 0, false)).fail()

  // An alternate without a pair value with a primary participant is dropped, not kept (e has no Intro profile).
  run altDroppedTest = initWith("search", "network")
    .then(beginRun).then(screen(Set("a", "c"), "Intro", Set("e"), false, "a", 0, false))
    .expect(cands.get(1).alts == Set() and safety)

  // A two-hop intro through a held intermediary is refused.
  run heldViaTest = initWith("search", "network")
    .then(setHold("b", true))
    .then(beginRun).then(screen(Set("a", "c"), "Friend", Set(), true, "b", 0, false)).fail()

  // The circle {a, b, c} from the searches of a, b, d and e; the alternates d and e blocked each other:
  // the engine keeps both (group.ts), distinctAlternates keeps one. The circle is used once per run.
  run circleAltTest = initWith("search", "network")
    .then(blockPair("d", "e"))
    .then(beginRun)
    .then(beginSearch("a", "Friend")).then(checkCandidate("b")).then(checkCandidate("c")).then(checkCandidate("d")).then(checkCandidate("e"))
    .then(closeSearch(1, true, false))
    .then(beginSearch("b", "Friend")).then(checkCandidate("a")).then(checkCandidate("c")).then(checkCandidate("d")).then(checkCandidate("e"))
    .then(closeSearch(2, false, false))
    .then(beginSearch("d", "Friend")).then(checkCandidate("a")).then(checkCandidate("b")).then(checkCandidate("c")).then(checkCandidate("e"))
    .then(closeSearch(2, false, false))
    .then(beginSearch("e", "Friend")).then(checkCandidate("a")).then(checkCandidate("b")).then(checkCandidate("c")).then(checkCandidate("d"))
    .then(closeSearch(2, false, false))
    .then(composeGroup("Friend", Set("a", "b", "c"), Set("d", "e"), Set("d")))
    .expect(safety and not(noAltPairBlockedEngine) and n.groupCands == 1)
    .then(composeGroup("Friend", Set("a", "b", "c"), Set(), Set())).fail()

  // The greedy walk: (a, b) 3 and (a, c) 2 fill a; (a, d) 2 is refused with a; (b, e) is a pack
  // refusal; (d, e) 2 is reserved.
  run greedyTest = initWith("select", "network")
    .then(beginSelection).then(nextSelectionPhase).then(nextSelectionPhase)
    .then(greedyStep).then(greedyStep).then(greedyStep).then(greedyStep).then(greedyStep)
    .expect(sel.refusals == Set({ member: "a", at: 2, value: 2 }) and sel.picks.size() == 3 and safety)

  // Exploration honors the pack refusal too.
  run explorePackTest = initWith("select", "network")
    .then(beginSelection).then(nextSelectionPhase).then(explorePick(4)).fail()

  // The judge lowers (a, b) from 3 to 2; it stays eligible.
  run judgeTest = initWith("select", "network")
    .then(judge(1, 1, false))
    .expect(cands.get(1).score == 2 and cands.get(1).status == "eligible" and safety)

  // A crew whose members blocked each other gets no session (crewSessionPlan, the pair gate).
  run sessionBlockTest = initWith("plan", "friends")
    .then(blockPair("a", "b"))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false)).fail()

  // A crew of 3 with one member on a hold: the session goes out to 2 (planner.ts pass 1).
  run sessionSizeTest = initWith("plan", "friends")
    .then(setHold("c", true))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b"), false))
    .expect(safety and not(sessionSizeOk))

  // b, c and f rated a dinner positive; b blocked c after it: no crew offer.
  run offerBlockedTest = initWith("plan", "friends")
    .then(meetup("o2", "dinner", Set("b", "c", "e", "f"), Set("b", "c", "f")))
    .then(blockPair("b", "c"))
    .then(startWeek).then(nextPhase)
    .then(crewOffer({ id: "o2", act: "dinner", attended: Set("b", "c", "e", "f"), positive: Set("b", "c", "f") }, Set("b", "c", "f"), false))
    .fail()

  // Repeat of o2: a, b and e would do it again, d attended and did not; d blocked e after it. d is an
  // alternate with no pair check, and finish() seats d next to e when b is dropped.
  run repeatBlockTest = initWith("plan", "friends")
    .then(meetup("o2", "dinner", Set("a", "b", "d", "e"), Set("a", "b", "e")))
    .then(blockPair("d", "e"))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set(), true))
    .then(nextPhase).then(nextPhase)
    .then(repeatPlan({ id: "o2", act: "dinner", attended: Set("a", "b", "d", "e"), positive: Set("a", "b", "e") },
                     Set("a", "b", "e"), Set("d"), Set("b"), Set("d")))
    .expect(safety and not(noRepeatBlocked))

  // Two live crews for a: the run session of week 1 is refused, so a gets the dinner crew offer; in week
  // 2 a has two crew sessions (spec/friendsWeek.md keeps members of several crews).
  run twoCrewsTest = initWith("plan", "friends")
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set(), true))
    .then(nextPhase)
    .then(crewOffer({ id: "o1", act: "dinner", attended: Set("a", "b", "e", "f"), positive: Set("a", "e", "f") }, Set("a", "e", "f"), false))
    .then(nextPhase).then(nextPhase).then(nextPhase)
    .then(crewOptIn({ act: "dinner", members: Set("a", "e", "f") }, Set("a", "e", "f")))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .then(crewSession({ act: "dinner", members: Set("a", "e", "f") }, Set("a", "e", "f"), false))
    .expect(safety and not(oneCrewPerWeek))

  // A crew offer never invites a member who has a crew session this week.
  run offerTakenTest = initWith("plan", "friends")
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .then(nextPhase)
    .then(crewOffer({ id: "o1", act: "dinner", attended: Set("a", "b", "e", "f"), positive: Set("a", "e", "f") }, Set("a", "e", "f"), false))
    .fail()

  // A new table {a, b, c} with alternates d and e, who blocked each other. a and b are dropped for
  // transit, and finish() seats both alternates: the table holds a blocked pair (planner.ts circleAlternates).
  run newPlanAltsTest = initWith("plan", "friends")
    .then(blockPair("d", "e"))
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("a", "b", "c"), Set("d", "e"), Set("a", "b"), Set("d", "e")))
    .expect(safety and not(newPlanSeatsApart))

  // Without a block: the seated alternates d and e have no pair value (one-sided); circleAlternates
  // checks pairReason only.
  run newPlanValueTest = initWith("plan", "friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("a", "b", "c"), Set("d", "e"), Set("a", "b"), Set("d", "e")))
    .expect(safety and newPlanSeatsApart and not(newPlanSeatsValued))

  // A new table of three, then the same members cannot get a second table this week.
  run newPlanTest = initWith("plan", "friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("a", "b", "c"), Set(), Set(), Set()))
    .expect(n.plans == 1 and safety)
    .then(newPlan(Set("a", "b", "e"), Set(), Set(), Set()))
    .fail()
}
```
