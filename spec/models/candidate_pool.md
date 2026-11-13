# Candidate retrieval and groups

## Story: Candidate retrieval and groups

A member needs recommendations and groups that respect consent, blocks, and location.

### Safety rules and reachability

Check pool eligibility, pair exclusions, group sizes, and seat uniqueness. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [candidate exposure floor](../exposureFloor.md) supplies the generated allocation transitions used by the engine’s intent and embedding retrieval paths. The model below treats the combined retrieval channels as an oracle.

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
//     (packs/network/rules.ts:67-69) is the hard gate. The friends pack excludes the romance lane
//     (packs/friends/rules.ts romance_excluded).
//   - group composition (packages/engine/src/group.ts composeGroup): minors leave the pool, compat is
//     -Infinity for a pair that pairReason refuses, the primary group is minSize..maxSize members with
//     a common city, and each alternate is compatible with each primary member. The ConsentNetwork
//     then filters the alternates (packages/network/src/network.ts:4271 distinctAlternates, called at 2222).
//   - the friends planner (packages/engine/src/packs/friends/planner.ts planFriendsWeek) in its pass
//     order: 1 crew sessions, 2 crew offers (plans.ts detectCrews), 3 same table again (repeats),
//     4 new plans (tables and planProposals), 5 activity partners. `taken` (passes 1-3) and `used`
//     (passes 4-5) are the code's sets. The default policy has spreadNew=false, so `busy` is empty.
//     Pass 4 can also give a partner plan of two (run() -> planProposals with partnerPlans =
//     pol.partnerFallback, default true; planner.ts:400) for members who attended a group meetup
//     (an oracle here).
//
// ABSTRACTIONS (quint/README.md rule 7)
//   - Scores, embeddings, the channels, venue choice and transit times are oracles. finish()
//     (planner.ts:196-226) drops invitees for transit as an oracle and fills from alternates, as the code.
//   - Six adults a..f and one member k aged 15. Any member can state a lower age later (minor).
//   - Group sizes are scaled: the friends group bound 3..6 (rules.ts group_size, FRIENDS_PLANS.size)
//     is MIN_G..MAX_G = 3..4 here, so that the upper bound can be reached with six adults.
//     pos.slice(0, 6) in the repeat pass is "any MAX_G of them" (an over-approximation).
//   - Activities are "run" and "dinner". A crew is (activity, members). Handed-off crews are not live.
//   - Each flag in `h` is set at the moment the code emits a pool, candidate, group or plan, and it
//     uses the facts of that moment (blocks, holds, ages, opt-in, cities).
//
// VALUES THAT ARE NOT IN `safety` (each one is a defect that this model found; the code is not changed;
// each has a run test that reaches it):
//   noAltPairBlockedEngine   group.ts:137-146: composeGroup checks each alternate against the primary
//                            group only, not against the other alternates (plans.ts:348-355 checks both).
//                            The ConsentNetwork repairs it (network.ts:4279), so `blockedApart` holds for the submitted group.
//   noSessionBlocked         planner.ts:244-255: a crew session invites every eligible crew member and
//                            has no block check. A block made after the crew formed is not seen.
//   noOfferBlocked           planner.ts:266-279 and plans.ts:662 detectCrews: a crew offer has no block check.
//   noRepeatBlocked          planner.ts:287-298: the repeat pass checks blocks among `ids` only; the
//                            alternates (o.attended, line 298) are not checked, and finish() moves an
//                            alternate into `invited` when an invitee is dropped for transit.
//   oneCrewPerWeek           planner.ts:244-255: the crew session pass does not read `taken`, so a
//                            member in two live crews gets two crew sessions in one week. Two live
//                            crews are possible: detectCrews keys "already in a crew" by activity,
//                            and a crew session that finish() refuses leaves the member out of `taken`.
//   sessionSizeOk            planner.ts:247: a crew session needs only 2 eligible members, below the
//                            friends group bound of 3 (rules.ts group_size). This can be intended.
//
// RUN (from the repository root; quint 0.33.1)
//   bun run quint:check quint/candidate_pool.qnt
module candidate_pool {

  // ------------------------------------------------------------------ constants
  pure val ADULTS = Set("a", "b", "c", "d", "e", "f")
  pure val MEMBERS = Set("a", "b", "c", "d", "e", "f", "k")
  pure val START_AGE = Map("a" -> 30, "b" -> 28, "c" -> 33, "d" -> 41, "e" -> 25, "f" -> 36, "k" -> 15)
  pure val CITIES = Set("nyc", "la")
  pure val ACTS = Set("run", "dinner")
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
  }
  type Count = { scores: int, intros: int, romanceIntros: int, groups: int, sessions: int, offers: int, repeats: int, plans: int, pairPlans: int, partners: int, weeks: int }

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
  }

  // filters.ts memberReason core prefix (minors, holds) plus the pack rule for the lane: networkPack
  // romance_opt_out (packs/network/rules.ts:20), friendsPack romance_excluded (packs/friends/rules.ts).
  def memberOk(m: str, lane: str): bool = all {
    not(minor.get(m)), not(held.get(m)),
    lane == "romance" implies (pack == "network" and optIn.get(m)),
  }
  // filters.ts pairReason: duplicate, minors, blocks, then romance_incompatible (both opted in) and,
  // for friends, romance_excluded on the lane.
  def pairOk(x: str, y: str, lane: str): bool = all {
    x != y, not(minor.get(x)), not(minor.get(y)), not(isBlocked(blocked, x, y)),
    lane == "romance" implies (pack == "network" and optIn.get(x) and optIn.get(y)),
  }
  // group.ts makeCompat: -Infinity (false here) when pairReason refuses the pair.
  def compat(x: str, y: str, lane: str): bool = pairOk(x, y, lane)
  // complementarity.ts romanceMutual: both opted in (the orientation and age-range checks are an oracle
  // that can only remove).
  def romanceMutual(x: str, y: str): bool = optIn.get(x) and optIn.get(y)
  // The pack ontology mutualPreferenceMatch that complementarity.ts:71 satisfy calls: networkPack uses
  // romanceMutual (packs/network/ontology.ts:72), friendsPack is always false (packs/friends/index.ts:89).
  def romanceSat(x: str, y: str): bool = if (pack == "network") romanceMutual(x, y) else false
  // plans.ts planMemberReason, as the planner's `eligible` (planner.ts:192): not a minor, no hold.
  def planEligible(m: str): bool = not(minor.get(m)) and not(held.get(m))
  // retrieval.ts twoHop: the intermediary is a direct warm neighbour of `a` with no hold (paused is a hold here).
  def viaCandidates(a: str, b: str): Set[str] =
    MEMBERS.filter(x => POSITIVE.contains(Set(a, x)) and POSITIVE.contains(Set(x, b)) and not(held.get(x)) and x != b)

  // ------------------------------------------------------------------ init
  action initWith(p: str): bool = all {
    pack' = p,
    minor' = MEMBERS.mapBy(m => START_AGE.get(m) < 18),
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
    n' = { scores: 0, intros: 0, romanceIntros: 0, groups: 0, sessions: 0, offers: 0, repeats: 0, plans: 0, pairPlans: 0, partners: 0, weeks: 0 },
    lastAction' = "init",
  }
  action init = {
    nondet p = PACKS.oneOf()
    initWith(p)
  }

  action keepPlanner = all { crews' = crews, offered' = offered, outcomes' = outcomes, wk' = wk }
  action keepWorld = all { pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city, blocked' = blocked }
  action keepPool = all { pool' = pool, anchor' = anchor }

  // ================================================================== world changes (other actors)
  action blockPair(x: str, y: str): bool = all {
    x != y, not(isBlocked(blocked, x, y)),
    blocked' = blocked.union(Set(Set(x, y))),
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, city' = city,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "blockPair",
  }
  // AGENTS.md platform decision 1: the lowest age ever stated wins.
  action statesMinorAge(m: str): bool = all {
    not(minor.get(m)), minor' = minor.set(m, true),
    pack' = pack, held' = held, optIn' = optIn, city' = city, blocked' = blocked,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "statesMinorAge",
  }
  action setHold(m: str, v: bool): bool = all {
    held' = held.set(m, v),
    pack' = pack, minor' = minor, optIn' = optIn, city' = city, blocked' = blocked,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "setHold",
  }
  action setOptIn(m: str, v: bool): bool = all {
    optIn.get(m) != v, optIn' = optIn.set(m, v),
    pack' = pack, minor' = minor, held' = held, city' = city, blocked' = blocked,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "setOptIn",
  }
  // geo.ts location: a dated trip overrides home.
  action travel(m: str, c: str): bool = all {
    city.get(m) != c, city' = city.set(m, c),
    pack' = pack, minor' = minor, held' = held, optIn' = optIn, blocked' = blocked,
    keepPool, keepPlanner, h' = h, n' = n, lastAction' = "travel",
  }

  // ================================================================== retrieval (retrieval.ts)
  // eligibleMembers then the channel union: `kept` is the channels' oracle subset of the eligible members.
  action retrieve(a: str, lane: str, kept: Set[str]): bool = {
    val eligible = MEMBERS.filter(m => m != a and memberOk(m, lane))
    all {
      kept.subseteq(eligible),
      pool' = kept, anchor' = a,
      h' = { ...h, poolUnsafe: h.poolUnsafe or kept.exists(m => minor.get(m) or held.get(m)) },
      keepWorld, keepPlanner, n' = n, lastAction' = "retrieve",
    }
  }

  // One intro candidate from the pool, through candidateReason. `useVia`: the graph channel names an
  // intermediary (twoHop); candidateReason drops a minor, held or blocked `via`.
  action intro(b: str, lane: str, useVia: bool, v: str): bool = {
    val a = anchor
    val viaOk = if (useVia) all {
      viaCandidates(a, b).contains(v), not(minor.get(v)), not(held.get(v)),
      not(isBlocked(blocked, a, v)), not(isBlocked(blocked, b, v)),
    } else true
    val viaBad = if (useVia) held.get(v) or isBlocked(blocked, a, v) or isBlocked(blocked, b, v) else false
    val involved = if (useVia) Set(a, b, v) else Set(a, b)
    all {
      a != NO_ONE, pool.contains(b),
      not(involved.exists(m => minor.get(m))),          // filters.ts:175 involvesMinor
      viaOk,                                            // filters.ts:178-184
      memberOk(a, lane), memberOk(b, lane),             // filters.ts:185-193 memberReason
      pairOk(a, b, lane),                               // filters.ts:194-197 pairReason
      city.get(a) == city.get(b),                       // filters.ts:203-209 presence overlap (geo.ts overlap)
      // complementarity.ts satisfy: a romance want scores SAT.romance only when romanceMutual holds.
      val romanceScore = lane == "romance" and romanceSat(a, b)
      all {
        h' = { ...h,
          introMinor: h.introMinor or involved.exists(m => minor.get(m)),
          introBlocked: h.introBlocked or isBlocked(blocked, a, b),
          introViaUnsafe: h.introViaUnsafe or viaBad,
          introRomanceOneSided: h.introRomanceOneSided or (lane == "romance" and not(optIn.get(a) and optIn.get(b))),
          introApart: h.introApart or city.get(a) != city.get(b),
          romanceScoredOneSided: h.romanceScoredOneSided or (romanceScore and not(optIn.get(a) and optIn.get(b))),
          friendsRomance: h.friendsRomance or (pack == "friends" and lane == "romance"),
        },
        n' = { ...n, intros: n.intros + 1, romanceIntros: n.romanceIntros + (if (lane == "romance") 1 else 0) },
      },
      keepWorld, keepPool, keepPlanner, lastAction' = "intro",
    }
  }

  // complementarity.ts:124 complementarity: the score of a pool pair, with no hard filter before it
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
  // composeGroup on the current pool: minors leave the pool (group.ts:82-83), the primary group is
  // pairwise compatible (evaluateGroup -> null on -Infinity), MIN_G..MAX_G members (the beam stops at
  // maxSize; `complete` needs minSize) with a common city (overlap). Alternates (group.ts:137-146):
  // each is compatible with each primary member and in the group's city. Then candidateReason
  // (group_size for friends, involvesMinor, memberReason, pairReason over participants), and the
  // ConsentNetwork distinctAlternates (network.ts:4271): `kept` is its result. distinctAlternates also
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

  // Pass 1 (planner.ts:244-255): members = crew.members.filter(eligible); at least 2; crewSessionPlan;
  // finish() may drop invitees for transit (`invited`) and returns null under the quorum min(3, n).
  // `refused`: crewSessionPlan or finish() returned null (no session, nobody taken).
  action crewSession(c: Crew, invited: Set[str], refused: bool): bool = {
    val members = c.members.filter(m => planEligible(m))
    val ok = not(refused) and members.size() >= 2
    all {
      wk.phase == "sessions", crews.contains(c), not(wk.sessionsDone.contains(c)),
      if (ok) all { invited.subseteq(members), invited.size() >= (if (members.size() < 3) members.size() else 3) } else invited == Set(),
      wk' = { ...wk, sessionsDone: wk.sessionsDone.union(Set(c)),
              taken: wk.taken.union(invited),
              crewCount: if (ok) MEMBERS.mapBy(m => wk.crewCount.get(m) + (if (invited.contains(m)) 1 else 0)) else wk.crewCount },
      h' = if (not(ok)) h else { ...h,
        sessionMinor: h.sessionMinor or invited.exists(m => minor.get(m)),
        sessionBlocked: h.sessionBlocked or not(pairwiseOk(blocked, invited)),
        sessionUnderMin: h.sessionUnderMin or invited.size() < MIN_G,
        crewTwice: h.crewTwice or invited.exists(m => wk.crewCount.get(m) >= 1),
      },
      n' = if (ok) { ...n, sessions: n.sessions + 1 } else n,
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "crewSession",
    }
  }

  // Pass 2 (planner.ts:266-279, plans.ts:662 detectCrews with minPlans 1): the positive members of a
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
      if (ok) all { invited.subseteq(members), invited.size() >= MIN_G } else invited == Set(),
      wk' = { ...wk, outcomesDone: wk.outcomesDone.union(Set(o.id)), taken: wk.taken.union(invited),
              detected: if (pos.size() >= MIN_G) wk.detected.union(Set({ act: o.act, members: pos })) else wk.detected,
              // The offered crew is c2 (all `members`), so every member of it is in that crew this week.
              crewCount: if (ok) MEMBERS.mapBy(m => wk.crewCount.get(m) + (if (members.contains(m)) 1 else 0)) else wk.crewCount },
      offered' = if (ok) offered.union(Set({ act: o.act, members: members })) else offered,
      h' = if (not(ok)) h else { ...h,
        offerMinor: h.offerMinor or members.exists(m => minor.get(m)),
        offerBlocked: h.offerBlocked or not(pairwiseOk(blocked, members)),
        offerInvitedTwice: h.offerInvitedTwice or invited.exists(m => wk.taken.contains(m)),
        offerSizeBad: h.offerSizeBad or invited.size() < MIN_G,
        crewTwice: h.crewTwice or members.exists(m => wk.crewCount.get(m) >= 1),
      },
      n' = if (ok) { ...n, offers: n.offers + 1 } else n,
      crews' = crews, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "crewOffer",
    }
  }

  // Pass 3 (planner.ts:280-306): pos = positive, eligible, not taken; at least 2; ids = up to MAX_G of
  // them (slice); skip when a pair in ids is blocked; alternates = attended - ids, eligible, not taken
  // (none for a partner pair, up to 2 for a group), with no block check; finish() drops `dropped` for
  // transit and fills the seats from the alternates; taken += invited + alternates.
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
      pairwiseOk(blocked, ids),
      alts.subseteq(altPool), alts.size() == (if (partner) 0 else (if (altPool.size() < 2) altPool.size() else 2)),
      dropped.subseteq(ids), fill.subseteq(alts),
      fill.size() == (if (partner) 0 else (if (dropped.size() < alts.size()) dropped.size() else alts.size())),
      invited.size() >= quorum,
      wk' = { ...wk, repeatsDone: wk.repeatsDone.union(Set(o.id)), taken: wk.taken.union(invited).union(altsLeft) },
      h' = { ...h,
        repeatMinor: h.repeatMinor or invited.union(altsLeft).exists(m => minor.get(m)),
        repeatBlocked: h.repeatBlocked or not(pairwiseOk(blocked, invited.union(altsLeft))),
        repeatSizeBad: h.repeatSizeBad or (if (partner) invited.size() != 2 else (invited.size() < MIN_G or invited.size() > MAX_G)),
      },
      n' = { ...n, repeats: n.repeats + 1 },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "repeatPlan",
    }
  }

  // Pass 4 (planner.ts:324-410 tables and run): the pool is eligible members not `used` (busy is empty
  // with spreadNew=false); scorePlanGroup is null for a -Infinity pair (plans.ts:176), so the whole
  // table (primary and alternates) is pairwise compatible; primary MIN_G..MAX_G (slice to size.max);
  // finish() keeps at least size.min invitees; used += invited + alternates. `partner`: run() gives a
  // partner plan of two with no alternates (planProposals partnerPlans; finish() quorum 2).
  action newPlan(primary: Set[str], alts: Set[str], partner: bool): bool = {
    val cand = MEMBERS.filter(m => planEligible(m) and not(wk.used.contains(m)))
    val g = primary.union(alts)
    all {
      wk.phase == "new",
      primary.subseteq(cand), alts.subseteq(cand.exclude(primary)),
      if (partner) primary.size() == 2 and alts == Set() else primary.size() >= MIN_G and primary.size() <= MAX_G,
      g.forall(x => g.forall(y => x == y or compat(x, y, "social"))),
      wk' = { ...wk, used: wk.used.union(g) },
      h' = { ...h,
        planMinor: h.planMinor or g.exists(m => minor.get(m)),
        planBlocked: h.planBlocked or not(pairwiseOk(blocked, g)),
        planSizeBad: h.planSizeBad or (if (partner) primary.size() != 2 else (primary.size() < MIN_G or primary.size() > MAX_G)),
        planSeatTwice: h.planSeatTwice or g.exists(m => wk.used.contains(m)),
      },
      n' = { ...n, plans: n.plans + 1, pairPlans: n.pairPlans + (if (partner) 1 else 0) },
      crews' = crews, offered' = offered, outcomes' = outcomes,
      keepWorld, keepPool, lastAction' = "newPlan",
    }
  }

  // Pass 5 (planner.ts:451-477): activityPartner candidates passed candidateReason (pairReason,
  // memberReason, presence overlap); at most partnerIntros per member this run.
  action partnerPlan(x: str, y: str): bool = all {
    wk.phase == "new",
    pairOk(x, y, "social"), memberOk(x, "social"), memberOk(y, "social"), city.get(x) == city.get(y),
    wk.partnerCount.get(x) < PARTNER_INTROS, wk.partnerCount.get(y) < PARTNER_INTROS,
    wk' = { ...wk, partnerCount: wk.partnerCount.setBy(x, v => v + 1).setBy(y, v => v + 1) },
    h' = { ...h,
      partnerMinor: h.partnerMinor or minor.get(x) or minor.get(y),
      partnerBlocked: h.partnerBlocked or isBlocked(blocked, x, y),
      partnerOverCap: h.partnerOverCap or wk.partnerCount.get(x) >= PARTNER_INTROS or wk.partnerCount.get(y) >= PARTNER_INTROS,
    },
    n' = { ...n, partners: n.partners + 1 },
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
    any { blockPair(x, y), statesMinorAge(x), setHold(x, v), setOptIn(x, v), travel(x, c) },
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
      val alts = validAlts(lane, p)
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
      newPlan(s1, s2, false),
      newPlan(s3.filter(m => planEligible(m)), Set(), false),
      newPlan(s1, Set(), true),
      partnerPlan(x, y),
      crewOptIn(off, s1),
      meetup(oid, act, s1, s2),
    }
  }
  action step = any { worldStep, poolStep, plannerStep, stutter }

  // ------------------------------------------------------------------ invariants
  // AGENTS.md code invariants (age policy) and platform decision 1: minors (13-17) are never matched or
  // connected, in any app. retrieval.ts:27 eligibleMembers (memberReason underage), filters.ts:175
  // involvesMinor (participants, alternates, via), group.ts:82-83, planner.ts:192 `eligible`.
  val noMinorEnters = not(h.poolUnsafe or h.introMinor or h.groupMinor or h.sessionMinor or h.offerMinor
                          or h.repeatMinor or h.planMinor or h.partnerMinor)
  // AGENTS.md hard rule "blocks" (PRD 40, keep every safety guard): a blocked pair is never put together.
  // filters.ts:71-73 pairReason (blocks win), group.ts:32 makeCompat, plans.ts:176 scorePlanGroup,
  // network.ts:4279 distinctAlternates. The engine-level gaps are the values below `safety`.
  val blockedApart = not(h.introBlocked or h.introViaUnsafe or h.groupBlocked or h.groupAltBlockedWithPrimary
                         or h.submittedBlocked or h.planBlocked or h.partnerBlocked)
  // Romance needs mutual opt-in: packs/network/rules.ts:67-69 romance_incompatible, rules.ts:20
  // romance_opt_out, complementarity.ts:63 romanceMutual (the score gate, also for a pool pair that
  // no hard filter saw: scorePair); friends.help never matches romance
  // (packs/friends/rules.ts romance_excluded).
  val romanceMutualOptIn = not(h.introRomanceOneSided or h.romanceScoredOneSided or h.groupRomanceOneSided or h.friendsRomance)
  // geo.ts cityBucketGeo overlap: members meet only in one common city (filters.ts:207, group.ts:62-64).
  val coLocated = not(h.introApart or h.groupApart)
  // packs/friends/rules.ts group_size (3..6, scaled to MIN_G..MAX_G), FRIENDS_PLANS.size, planner.ts
  // finish() (repeat quorum, `invited.length < pcfg.size.min` for new plans), group.ts minSize/maxSize.
  val groupSizeBounds = not(h.groupSizeBad or h.offerSizeBad or h.repeatSizeBad or h.planSizeBad)
  // One crew per member per week, the part that holds: a crew offer never invites a member who is
  // already taken this week (planner.ts:269 `!taken.has(id)`); new plans never seat a member twice
  // (planner.ts:326, 389 and 407 `used`); partner intros keep partnerIntros (planner.ts:456).
  val seatsOnce = not(h.offerInvitedTwice or h.planSeatTwice or h.partnerOverCap)

  val safety = all { noMinorEnters, blockedApart, romanceMutualOptIn, coLocated, groupSizeBounds, seatsOnce }

  // Defects (not in safety; see the header). Each is reached by a run test below.
  val noAltPairBlockedEngine = not(h.altPairBlockedEngine)
  val noSessionBlocked = not(h.sessionBlocked)
  val noOfferBlocked = not(h.offerBlocked)
  val noRepeatBlocked = not(h.repeatBlocked)
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

  // A group of three in nyc with two alternates; the engine keeps alternates d and e although they
  // blocked each other (group.ts:137-146), and distinctAlternates keeps only one of them.
  run altPairTest = initWith("network")
    .then(blockPair("d", "e"))
    .then(retrieve("a", "social", Set("b", "c", "d", "e")))
    .then(retrieve("f", "social", Set("a", "b", "c", "d", "e")))
    .then(composeGroup("social", Set("a", "b", "c"), Set("d", "e"), Set("d")))
    .expect(safety and not(noAltPairBlockedEngine))

  // A blocked pair cannot be in the primary group.
  run groupBlockTest = initWith("network")
    .then(blockPair("a", "b"))
    .then(retrieve("f", "social", Set("a", "b", "c", "d", "e")))
    .then(composeGroup("social", Set("a", "b", "c"), Set(), Set()))
    .fail()

  // a blocks b after the run crew formed: the crew session still invites both (planner.ts:244-255).
  run sessionBlockTest = initWith("friends")
    .then(blockPair("a", "b"))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .expect(safety and not(noSessionBlocked))

  // A crew of 3 with one member on a hold: the session goes out to 2 (planner.ts:247).
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

  // Repeat of o2: a, b and e would do it again, d attended and did not; d blocked e after it. ids is
  // {a, b, e} (no blocked pair), and d, an attendee, is an alternate with no block check.
  run repeatBlockTest = initWith("friends")
    .then(meetup("o2", "dinner", Set("a", "b", "d", "e"), Set("a", "b", "e")))
    .then(blockPair("d", "e"))
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set(), true))
    .then(nextPhase)
    .then(nextPhase)
    // b is dropped for transit; finish() moves the alternate d into `invited` next to e.
    .then(repeatPlan({ id: "o2", act: "dinner", attended: Set("a", "b", "d", "e"), positive: Set("a", "b", "e") },
                     Set("a", "b", "e"), Set("d"), Set("b"), Set("d")))
    .expect(safety and not(noRepeatBlocked))

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

  // A crew offer never invites a member who has a crew session this week (planner.ts:269).
  run offerTakenTest = initWith("friends")
    .then(startWeek)
    .then(crewSession({ act: "run", members: Set("a", "b", "c") }, Set("a", "b", "c"), false))
    .then(nextPhase)
    .then(crewOffer({ id: "o1", act: "dinner", attended: Set("a", "d", "e", "f"), positive: Set("a", "d", "e") }, Set("a", "d", "e"), false))
    .fail()

  // A new table of four, then the same members cannot get a second table this week.
  run newPlanTest = initWith("friends")
    .then(startWeek).then(nextPhase).then(nextPhase).then(nextPhase)
    .then(newPlan(Set("a", "b", "c", "d"), Set("e"), false))
    .expect(n.plans == 1 and safety)
    .then(newPlan(Set("a", "e", "f"), Set(), false))
    .fail()

  // The friends pack never makes a romance intro.
  run friendsRomanceTest = initWith("friends")
    .then(retrieve("a", "romance", Set("b")))
    .fail()
}
```
