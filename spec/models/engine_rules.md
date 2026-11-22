# Matching rules and outreach budgets

## Story: Matching rules and outreach budgets

A member needs outreach and proposals to respect their settings, prior refusals, and matching preferences.

### Safety rules and reachability

Check send budgets, cooldowns, adult mutual romance opt-in, and mutual travel radius. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [matching budgets spec](../matchingBudgets.md) generates the engine’s budget and cooldown predicates. The [dating radius spec](../datingRadius.md) generates the market and distance predicates.

Imported from `quint/engine_rules.qnt` at `30d950e`. See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=16 max-samples=3000
//
// engine_rules: The Network's member and pair hard rules and the slop mutual radius, over days.
//
// WHAT THIS MODELS
//   The member and pair rules that packages/engine/src/filters.ts memberReason and pairReason ask, with the
//   generated predicates they call. Each one is a pure def here with the same name and the same decision:
//     - spec/matchingBudgets.md budgetReached, inCooldown, pairInteractionCooling (generated, re-exported by
//       @thenetwork/core), called by packs/network/rules.ts interruption_budget, category_cooldown and
//       pair_cooldown;
//     - spec/datingRadius.md sharedDatingMarket and withinAdjustedRadius (withinMutualRadius in
//       packages/core/src/dating-radius.ts adds the margin), called by packs/slop/geo.ts mutualMarkets;
//     - the romance rule packs/network/rules.ts romance_incompatible with romanceCompatible both ways. It is
//       hand code. It checks both stated age ranges. The adult requirement is the core prefix of
//       filters.ts pairReason ("underage", before every pack rule), which this model includes.
//   The shell reads the counts and the latest decline from the world, then asks the predicates. Here the
//   actions do the same: a proactive send asks the member rules, a proposal asks the pair rules.
//   Declines (of a send or of a pair) are the environment and can come at any time after the item.
//
// WHERE THE RULES SIT IN MATCHING
//   pairReason is the inner part of the one pair gate (match/pair.ts eligiblePair: the same lane with
//   compatible sides, the same market, then pairReason with the lane's category). A pair has a value only
//   through that gate (pairValueOf), and the match profiles exist only for members that pass
//   filters.ts sendTimeReason (minors, holds, pause, lane opt-in). The pair value, the bounded search and
//   the lane rules are in candidate_pool; this model keeps the rule decisions and their time behaviour.
//
// BOUNDS
//   Members A and B (adults) and K (a minor: isMinorAge is true). Categories social and romance.
//   Days 0 to MAX_DAY. Budget LIMIT sends in a WINDOW of days. Cooldowns COOL and PAIR_COOL days.
//   Home cells on a line 0..3 (distance |posA - posB|), limits 1..4 miles, margin 1.
//   Romance facts (opt-in, "a admits b") are chosen at init and stay fixed.
//
// TIME
//   A day is one tick. Days * DAY is shell arithmetic; the predicates get the window. The event counter n
//   orders the events of one day.
//
// ABSTRACTIONS
//   - recentProactive is the number of sends to the member in the last WINDOW days (world.ts counts it
//     the same way, over the budget window of the member's state; here there is one state).
//   - Of the core pair prefix (filters.ts pairReason: duplicate, underage, blocked), the model keeps
//     duplicate and underage. Blocks are in candidate_pool.
//   - One market: the shared dating market is the one market, so the radius decision is
//     sharedDatingMarket and withinAdjustedRadius. Both members are known and have a limit (the geo
//     pairReason results unknown_member and distance_unknown are not here).
//   - A pair decline stands for every cooling outcome of the pair (pairInteractionCooling: declined,
//     expired, cancelled; network.ts closes an item with at = the close time). A send decline stands for a
//     declined or an expired item (world.ts memberCategoryDeclines keeps the latest `at`).
//   - `admits` is romanceCompatible (stated age range and orientation, with
//     config.romance.requireStatedPrefs) as one fixed fact per direction. In slop the same per-direction
//     fact is datingOneWayOpen (packs/slop/rules.ts orientation_mismatch -> mutuallyOpen, spec/mutualOpenness.md:
//     stated gender, seeking set, trans status and trans answer); in friends it is friendAdmits
//     (packs/friends/rules.ts friend_openness -> friendsMutuallyOpen). Each is a pure function of stated
//     facts that do not change within a run, so one fixed fact per direction covers it.
//
// OUTSIDE THE MODEL
//   - Quotas, the contribution budget, only-when-asked, the reliability holdout, the negative feedback
//     cooldown, dealbreakers and active duplicates: the same shape of decision (budgetReached, inCooldown),
//     not repeated here.
//   - The distance arithmetic (cellMiles) and the review queue.
module engine_rules {

  pure val MEMBERS = Set("A", "B", "K")
  pure val CATS = Set("social", "romance")
  pure val LIMIT = 2
  pure val WINDOW = 3
  pure val COOL = 2
  pure val PAIR_COOL = 2
  pure val MAX_DAY = 6
  pure val MARGIN = 1

  type Send = { m: str, cat: str, day: int, n: int }
  type Decline = { m: str, cat: str, day: int, n: int }
  type Proposal = { a: str, b: str, lane: str, day: int, n: int }
  type PairDecline = { a: str, b: str, day: int, n: int }

  // ---------------------------------------------------------------- the predicates
  // spec/matchingBudgets.md budgetReached; packs/network/rules.ts interruption_budget refuses when it holds.
  pure def budgetReached(used: int, extra: int, limit: int): bool = used + extra >= limit
  pure def interruptionRefused(used: int, extra: int, limit: int): bool = budgetReached(used, extra, limit)
  // spec/matchingBudgets.md inCooldown: no event (has = false) is no cooldown. category_cooldown and
  // negative_feedback_cooldown refuse exactly when this is true.
  pure def inCooldown(now: int, has: bool, at: int, window: int): bool = has and now - at < window
  // spec/matchingBudgets.md pairInteractionCooling for a declined (cooling) outcome.
  pure def pairInteractionCooling(now: int, at: int, window: int): bool = inCooldown(now, true, at, window)
  // packs/network/rules.ts romance_incompatible, with stated age-range compatibility in each direction.
  pure def romanceRuleOk(lane: str, aOpt: bool, bOpt: bool, ab: bool, ba: bool): bool =
    lane != "romance" or (aOpt and bOpt and ab and ba)
  // spec/datingRadius.md sharedDatingMarket and withinAdjustedRadius (dating-radius.ts withinMutualRadius).
  pure def sharedDatingMarket(inFirst: bool, inSecond: bool, listed: bool): bool = inFirst and inSecond and listed
  pure def withinAdjustedRadius(adjustedMiles: int, firstLimit: int, secondLimit: int): bool =
    adjustedMiles <= firstLimit and adjustedMiles <= secondLimit

  pure def absDiff(x: int, y: int): int = if (x >= y) x - y else y - x
  pure def samePair(a1: str, b1: str, a2: str, b2: str): bool = (a1 == a2 and b1 == b2) or (a1 == b2 and b1 == a2)

  // ---------------------------------------------------------------- state
  var day: int
  var n: int
  var sends: Set[Send]
  var declines: Set[Decline]
  var proposals: Set[Proposal]
  var pairDeclines: Set[PairDecline]
  // Fixed world facts.
  var minor: str -> bool
  var optIn: str -> bool
  var admits: (str, str) -> bool
  var pos: str -> int
  var limitOf: str -> int

  // ---------------------------------------------------------------- shell reads
  def recentSends(m: str): int = sends.filter(s => s.m == m and s.day > day - WINDOW).size()
  def catDeclines(m: str, c: str): Set[Decline] = declines.filter(d => d.m == m and d.cat == c)
  // memberCategoryDeclines keeps the latest decline day of the category.
  def latestDecline(m: str, c: str): int = catDeclines(m, c).fold(-100, (acc, d) => if (d.day > acc) d.day else acc)
  def pairDeclinesOf(a: str, b: str): Set[PairDecline] = pairDeclines.filter(d => samePair(d.a, d.b, a, b))
  // packs/network/rules.ts pair_cooldown: some cooling interaction of the pair is less than the window old.
  def pairCooling(a: str, b: str): bool = pairDeclinesOf(a, b).exists(d => pairInteractionCooling(day, d.day, PAIR_COOL))

  // The member rules that filters.ts memberReason asks for a proactive send (packs/network/rules.ts:
  // interruption_budget, then category_cooldown).
  def memberOk(m: str, c: str): bool = and {
    not(interruptionRefused(recentSends(m), 0, LIMIT)),
    not(inCooldown(day, catDeclines(m, c).size() > 0, latestDecline(m, c), COOL)),
  }

  // filters.ts pairReason for a proposal: the core prefix (duplicate, underage), the pack pair rules
  // (pair_cooldown, romance_incompatible), then the pack geo rule (slop geo.ts pairReason, mutualMarkets).
  def pairOk(a: str, b: str, lane: str): bool = and {
    a != b, not(minor.get(a)), not(minor.get(b)),
    not(pairCooling(a, b)),
    romanceRuleOk(lane, optIn.get(a), optIn.get(b), admits.get((a, b)), admits.get((b, a))),
    sharedDatingMarket(true, true, true),
    withinAdjustedRadius(absDiff(pos.get(a), pos.get(b)) + MARGIN, limitOf.get(a), limitOf.get(b)),
  }

  // ---------------------------------------------------------------- actions
  action initWith(op: str -> bool, ad: (str, str) -> bool, p: str -> int, l: str -> int): bool = all {
    day' = 0, n' = 0,
    sends' = Set(), declines' = Set(), proposals' = Set(), pairDeclines' = Set(),
    minor' = MEMBERS.mapBy(m => m == "K"),
    optIn' = op, admits' = ad, pos' = p, limitOf' = l,
  }

  action init = {
    nondet op = MEMBERS.setOfMaps(Set(true, false)).oneOf()
    nondet ad = tuples(MEMBERS, MEMBERS).setOfMaps(Set(true, false)).oneOf()
    nondet p = MEMBERS.setOfMaps(0.to(3)).oneOf()
    nondet l = MEMBERS.setOfMaps(1.to(4)).oneOf()
    initWith(op, ad, p, l)
  }

  action keepFacts = all { minor' = minor, optIn' = optIn, admits' = admits, pos' = pos, limitOf' = limitOf }

  action tick = all {
    day < MAX_DAY,
    day' = day + 1, n' = n,
    sends' = sends, declines' = declines, proposals' = proposals, pairDeclines' = pairDeclines,
    keepFacts,
  }

  action send(m: str, c: str): bool = all {
    memberOk(m, c),
    sends' = sends.union(Set({ m: m, cat: c, day: day, n: n })),
    n' = n + 1, day' = day,
    declines' = declines, proposals' = proposals, pairDeclines' = pairDeclines,
    keepFacts,
  }

  action decline(m: str, c: str): bool = all {
    sends.exists(s => s.m == m and s.cat == c),
    declines' = declines.union(Set({ m: m, cat: c, day: day, n: n })),
    n' = n + 1, day' = day,
    sends' = sends, proposals' = proposals, pairDeclines' = pairDeclines,
    keepFacts,
  }

  action propose(a: str, b: str, lane: str): bool = all {
    pairOk(a, b, lane),
    proposals' = proposals.union(Set({ a: a, b: b, lane: lane, day: day, n: n })),
    n' = n + 1, day' = day,
    sends' = sends, declines' = declines, pairDeclines' = pairDeclines,
    keepFacts,
  }

  action declinePair(a: str, b: str): bool = all {
    proposals.exists(p => samePair(p.a, p.b, a, b)),
    pairDeclines' = pairDeclines.union(Set({ a: a, b: b, day: day, n: n })),
    n' = n + 1, day' = day,
    sends' = sends, declines' = declines, proposals' = proposals,
    keepFacts,
  }

  action idle = all {
    day' = day, n' = n,
    sends' = sends, declines' = declines, proposals' = proposals, pairDeclines' = pairDeclines,
    keepFacts,
  }

  action step = {
    nondet m = MEMBERS.oneOf()
    nondet o = MEMBERS.oneOf()
    nondet c = CATS.oneOf()
    any { tick, send(m, c), decline(m, c), propose(m, o, c), declinePair(m, o), idle }
  }

  // ---------------------------------------------------------------- invariants
  // PRD 40.3 interruption budget; packs/network/rules.ts interruption_budget -> budgetReached:
  // in every window of WINDOW days, a member gets at most LIMIT proactive sends.
  val budgetHeld = MEMBERS.forall(m => 0.to(day).forall(d =>
    sends.filter(s => s.m == m and s.day > d - WINDOW and s.day <= d).size() <= LIMIT))

  // packs/network/rules.ts category_cooldown -> inCooldown: no send of a category to a member
  // less than COOL days after the member declined that category.
  val categoryCooldownHeld = sends.forall(s => declines.forall(dc =>
    (dc.m == s.m and dc.cat == s.cat and dc.n < s.n) implies s.day - dc.day >= COOL))

  // packs/network/rules.ts pair_cooldown -> pairInteractionCooling (either order of the pair): no proposal
  // less than PAIR_COOL days after the pair was declined.
  val pairCooldownHeld = proposals.forall(p => pairDeclines.forall(pd =>
    (samePair(p.a, p.b, pd.a, pd.b) and pd.n < p.n) implies p.day - pd.day >= PAIR_COOL))

  // The core prefix of filters.ts pairReason refuses duplicate members and minors in every lane.
  val pairAdultsOnly = proposals.forall(p => not(minor.get(p.a)) and not(minor.get(p.b)))
  val pairDistinct = proposals.forall(p => p.a != p.b)

  // packs/network/rules.ts romance_incompatible: both opted in and each admits the other (romanceCompatible).
  val romanceMutual = proposals.forall(p => p.lane == "romance" implies
    (optIn.get(p.a) and optIn.get(p.b) and admits.get((p.a, p.b)) and admits.get((p.b, p.a))))

  // PRD 40.5 radius holds BOTH ways; slop geo.ts pairReason -> mutualMarkets -> withinAdjustedRadius.
  val radiusMutual = proposals.forall(p =>
    absDiff(pos.get(p.a), pos.get(p.b)) + MARGIN <= limitOf.get(p.a)
    and absDiff(pos.get(p.a), pos.get(p.b)) + MARGIN <= limitOf.get(p.b))

  // The pair decision does not depend on the order (spec/datingRadius.md lawPairDecisionSymmetric; the pair
  // gate needs the same in both orders, because the pair value is symmetric, spec/pairValue.md).
  val pairDecisionSymmetric = MEMBERS.forall(a => MEMBERS.forall(b => CATS.forall(c => pairOk(a, b, c) == pairOk(b, a, c))))

  val safety = and {
    budgetHeld, categoryCooldownHeld, pairCooldownHeld, pairAdultsOnly, pairDistinct, romanceMutual, radiusMutual,
    pairDecisionSymmetric,
  }

  // ---------------------------------------------------------------- witnesses (must be reachable)
  val witness_budgetFull = not(MEMBERS.exists(m => recentSends(m) == LIMIT))
  val witness_sendAfterCooldown = not(sends.exists(s => declines.exists(dc => dc.m == s.m and dc.cat == s.cat and dc.n < s.n)))
  val witness_romanceProposal = not(proposals.exists(p => p.lane == "romance"))
  val witness_pairReproposed = not(proposals.exists(p => pairDeclines.exists(pd => samePair(p.a, p.b, pd.a, pd.b) and pd.n < p.n)))

  // ---------------------------------------------------------------- runs
  pure val ALL_IN = Set("A", "B", "K").mapBy(m => true)
  pure val ALL_ADMIT = tuples(Set("A", "B", "K"), Set("A", "B", "K")).mapBy(t => true)
  pure val NEAR = Set("A", "B", "K").mapBy(m => 0)
  pure val WIDE = Set("A", "B", "K").mapBy(m => 4)

  // The third send in the window is refused; after the window it is allowed again.
  run budgetTest = initWith(ALL_IN, ALL_ADMIT, NEAR, WIDE)
    .then(send("A", "social")).then(send("A", "social"))
    .expect(not(memberOk("A", "social")))
    .then(tick).then(tick).expect(not(memberOk("A", "social")))
    .then(tick).then(send("A", "social"))
    .expect(safety)

  // A declined category is cooling for COOL days, then open again.
  run categoryCooldownTest = initWith(ALL_IN, ALL_ADMIT, NEAR, WIDE)
    .then(send("A", "social")).then(decline("A", "social"))
    .then(tick).expect(not(memberOk("A", "social")))
    .then(tick).then(send("A", "social"))
    .expect(safety)

  // Duplicate members and minors fail before the pack's eligibility checks, even outside romance.
  run romanceMinorTest = initWith(ALL_IN, ALL_ADMIT, NEAR, WIDE)
    .expect(not(pairOk("A", "K", "romance")))
    .expect(not(pairOk("K", "B", "romance")))
    .expect(not(pairOk("A", "K", "social")) and not(pairOk("A", "A", "social")))
    .then(propose("A", "B", "romance"))
    .expect(safety)

  // Radius: A at 0 with limit 4, B at 3 with limit 2: B's limit refuses in both orders.
  run radiusTest = initWith(ALL_IN, ALL_ADMIT, Map("A" -> 0, "B" -> 3, "K" -> 0), Map("A" -> 4, "B" -> 2, "K" -> 4))
    .expect(not(pairOk("A", "B", "social")))
    .expect(not(pairOk("B", "A", "social")))
    .then(idle).expect(safety and proposals.size() == 0)

  // A declined pair is cooling in either order, then can be proposed again.
  run pairCooldownTest = initWith(ALL_IN, ALL_ADMIT, NEAR, WIDE)
    .then(propose("A", "B", "social")).then(declinePair("A", "B"))
    .then(tick).expect(not(pairOk("B", "A", "social")))
    .then(tick).then(propose("B", "A", "social"))
    .expect(safety)
}
```
