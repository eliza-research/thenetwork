// -*- mode: Bluespec; -*-
// quint-check: max-steps=16 max-samples=3000
//
// engine_rules: The Network's member and pair hard rules and the slop mutual radius, over days.
//
// WHAT THIS MODELS
//   The decisions in packages/engine/src/packs/network/rulesCore.ts (called by rules.ts) and
//   packages/engine/src/packs/slop/geoCore.ts (called by geo.ts). Each LemmaScript function is a pure
//   def here with the same name and the same decision: budgetReached, interruptionBudgetReason,
//   inCooldown, categoryCooldownReason, pairCooling, romancePairReason, marketMutual.
//   The shell reads the counts and the latest decline from the world, then asks the core. Here the
//   actions do the same: a proactive send asks the member rules, a proposal asks the pair rules.
//   Declines (of a send or of a pair) are the environment and can come at any time after the item.
//
// BOUNDS
//   Members A and B (adults) and K (a minor: isMinorAge is true). Categories social and romance.
//   Days 0 to MAX_DAY. Budget LIMIT sends in a WINDOW of days. Cooldowns COOL and PAIR_COOL days.
//   Home cells on a line 0..3 (distance |posA - posB|), limits 1..4 miles, margin 1.
//   Romance facts (opt-in, "a admits b") are chosen at init and stay fixed.
//
// TIME
//   A day is one tick. Days * DAY is shell arithmetic; the core gets the window. The event counter n
//   orders the events of one day.
//
// ABSTRACTIONS
//   - recentProactive is the number of sends to the member in the last WINDOW days (world.ts counts it
//     the same way, over the budget window of the member's state; here there is one state).
//   - The core pair prefix (filters.ts pairReason: duplicate, underage, blocked) is NOT in this model.
//     So romanceAdultsOnly checks that romancePairReason refuses a minor by itself (defense in depth).
//   - One market: mutualMarkets has at most one entry, so the radius decision is marketMutual.
//
// OUTSIDE THE MODEL
//   - Quotas, only-when-asked, the reliability holdout, dealbreakers and active duplicates: the same
//     shape of decision (proved in rulesCore.ts), not repeated here.
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

  // ---------------------------------------------------------------- the cores
  // rulesCore.ts budgetReached and interruptionBudgetReason (null is "not refused").
  pure def budgetReached(used: int, extra: int, limit: int): bool = used + extra >= limit
  pure def interruptionRefused(used: int, extra: int, limit: int): bool = budgetReached(used, extra, limit)
  // rulesCore.ts inCooldown: no event (has = false) is no cooldown. categoryCooldownReason and
  // negativeFeedbackReason refuse exactly when this is true.
  pure def inCooldown(now: int, has: bool, at: int, window: int): bool = has and now - at < window
  // rulesCore.ts romancePairReason: true when the reason is null.
  pure def romancePairOk(lane: str, aOpt: bool, bOpt: bool, aMinor: bool, bMinor: bool, ab: bool, ba: bool): bool =
    lane != "romance" or (not(aMinor) and not(bMinor) and aOpt and bOpt and ab and ba)
  // geoCore.ts marketMutual.
  pure def marketMutual(inA: bool, inB: bool, listed: bool, miles: int, margin: int, la: int, lb: int): bool =
    inA and inB and listed and miles + margin <= la and miles + margin <= lb

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
  // rulesCore.ts pairCooling: some declined interaction of the pair is less than the window old.
  def pairCooling(a: str, b: str): bool = pairDeclinesOf(a, b).exists(d => day - d.day < PAIR_COOL)

  // The member rules that rules.ts asks for a proactive send (budget, then category cooldown).
  def memberOk(m: str, c: str): bool = and {
    not(interruptionRefused(recentSends(m), 0, LIMIT)),
    not(inCooldown(day, catDeclines(m, c).size() > 0, latestDecline(m, c), COOL)),
  }

  // The pair rules that rules.ts and geo.ts ask for a proposal (cooldown, romance, radius).
  def pairOk(a: str, b: str, lane: str): bool = and {
    not(pairCooling(a, b)),
    romancePairOk(lane, optIn.get(a), optIn.get(b), minor.get(a), minor.get(b), admits.get((a, b)), admits.get((b, a))),
    marketMutual(true, true, true, absDiff(pos.get(a), pos.get(b)), MARGIN, limitOf.get(a), limitOf.get(b)),
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
    a != b,
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
  // PRD 40.3 interruption budget; rules.ts interruption_budget -> rulesCore.interruptionBudgetReason:
  // in every window of WINDOW days, a member gets at most LIMIT proactive sends.
  val budgetHeld = MEMBERS.forall(m => 0.to(day).forall(d =>
    sends.filter(s => s.m == m and s.day > d - WINDOW and s.day <= d).size() <= LIMIT))

  // rules.ts category_cooldown -> rulesCore.categoryCooldownReason: no send of a category to a member
  // less than COOL days after the member declined that category.
  val categoryCooldownHeld = sends.forall(s => declines.forall(dc =>
    (dc.m == s.m and dc.cat == s.cat and dc.n < s.n) implies s.day - dc.day >= COOL))

  // rules.ts pair_cooldown -> rulesCore.pairCooldownReason (either order of the pair): no proposal
  // less than PAIR_COOL days after the pair was declined.
  val pairCooldownHeld = proposals.forall(p => pairDeclines.forall(pd =>
    (samePair(p.a, p.b, pd.a, pd.b) and pd.n < p.n) implies p.day - pd.day >= PAIR_COOL))

  // Core policy (packages/core/src/policy.ts, minors never matched); rules.ts romance_incompatible ->
  // rulesCore.romancePairReason refuses a minor by itself.
  val romanceAdultsOnly = proposals.forall(p => p.lane == "romance" implies (not(minor.get(p.a)) and not(minor.get(p.b))))

  // rules.ts romance_incompatible -> rulesCore.romancePairReason: both opted in and each admits the other.
  val romanceMutual = proposals.forall(p => p.lane == "romance" implies
    (optIn.get(p.a) and optIn.get(p.b) and admits.get((p.a, p.b)) and admits.get((p.b, p.a))))

  // PRD 40.5 radius holds BOTH ways; geo.ts pairReason -> geoCore.marketMutual / radiusPairReason.
  val radiusMutual = proposals.forall(p =>
    absDiff(pos.get(p.a), pos.get(p.b)) + MARGIN <= limitOf.get(p.a)
    and absDiff(pos.get(p.a), pos.get(p.b)) + MARGIN <= limitOf.get(p.b))

  // rulesCore.romancePairReason and geoCore.radiusPairReason: the pair decision does not depend on the order.
  val pairDecisionSymmetric = MEMBERS.forall(a => MEMBERS.forall(b => CATS.forall(c => pairOk(a, b, c) == pairOk(b, a, c))))

  val safety = and {
    budgetHeld, categoryCooldownHeld, pairCooldownHeld, romanceAdultsOnly, romanceMutual, radiusMutual,
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

  // A minor is never in a romance proposal, even with every fact in favor; adults are.
  run romanceMinorTest = initWith(ALL_IN, ALL_ADMIT, NEAR, WIDE)
    .expect(not(pairOk("A", "K", "romance")))
    .expect(not(pairOk("K", "B", "romance")))
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
