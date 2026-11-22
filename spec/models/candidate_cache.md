# Candidate cache

## Story: Cached candidates under joins, leaves and changes

A member's best candidates must stay correct when other members join, leave or change their profile, without a new search for every member.

### Safety rules and reachability

The model runs the whole repair flow of the [candidate cache spec](../candidateCache.md) on a small population. Members join, leave and change their profile, and searches run in between. A profile change first only bumps the member's version (the profile store), and the cache repair runs later, so that a read in between can meet a stale stored edge. The checks are in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The main check is `exactIsBrute`: when no repair waits, every cached exact kept list equals the first `LIMIT` partners of a search from nothing over the current population. `coverSound` says that no partner outside a stored list ranks above the member's effective cover, for exact and budgeted lists. `edgesCurrent` says that, when no repair waits, every stored edge has the current versions of both members. The witnesses show a group skipped by its bound, a member skipped by its bound, a refill from the reserve, a list kept short, a forced search, a stale edge refused, and a budgeted list.

The definitions `cacheRanksAbove` to `cacheEdgeValid`, and `cachePendingNeeded` and `cachePendingKeeps`, copy the spec's generated decisions. The [reference implementation](../../packages/engine/src/match/cache.ts) uses the same decisions, and its integration test compares it with a search from nothing on populations of a few hundred members.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=24 max-samples=3000 verify-steps=5
//
// candidate_cache: the repair of cached member searches when members join, leave and change.
//
// WHAT THIS MODELS
//   - spec/candidateCache.md: every decision (offer place, member and group skip, effective cover,
//     removal repair, edge validity) is a copy of the spec's definition.
//   - packages/engine/src/match/cache.ts (CandidateCache): join = insert, leave = remove,
//     editProfile + repair = change (remove the old version, then insert the new version),
//     research = a search from nothing for a member marked to search again, serve = a read of
//     a cached list that refuses it when the member's own version or a kept or reserve edge is stale
//     (listOf).
//   - The forward search of an inserted member and every research are exact searches from nothing.
//     budgetedSearch checks any subset of the partners and reports the true largest unchecked
//     value as its unseen bound (the search spec's certificate).
//
// ABSTRACTIONS
//   - Five members with keys 0..4 in two groups ({0,1,2} and {3,4}), four profiles 0..3, and one
//     symmetric pair value table with ties and pairs without a value (pairV).
//   - LIMIT = 1 kept entry and RESERVE = 1 reserve entry (the code takes any limit and reserve).
//   - The group bound is the largest true value of the inserted member with the group's searchers,
//     the tightest sound bound. The code takes any sound bound.
//   - The group floor and the count of short lists are computed from the cached lists at the
//     reverse pass. The code may keep a floor that is lower (lawCacheLoweredFloorSkipSound).
//   - Every action is atomic. The code runs one event at a time.
//   - The code empties a group's raises after it walks the group, because each member's own cover
//     then holds them; the model keeps them, which gives the same effective covers.
//
// RUN (from the repository root)
//   corepack pnpm@10.24.0 run quint:check candidate_cache
module candidate_cache {

  // ------------------------------------------------------------------ constants
  pure val IDS = Set(0, 1, 2, 3, 4)
  pure val FEATS = Set(0, 1, 2, 3)
  pure val GROUPS = Set(0, 1)
  pure val LIMIT = 1
  pure val RESERVE = 1
  pure def groupOf(a: int): int = if (a <= 2) 0 else 1

  // A symmetric table: no pair when the profiles sum to 3, and many equal values.
  pure def pairV(f: int, g: int): int =
    if (f + g == 3) -1 else (f * g) % 3 + (if (f == g) 2 else 0)

  // ------------------------------------------------------------------ types
  type Rank = { value: int, key: int }
  type Entry = { value: int, key: int, ver: int }
  // close: "none" (not a member), "exact", "budgeted", "search" (must search again)
  type Cache = { close: str, kept: Set[Entry], reserve: Set[Entry], cover: Rank, searchedVer: int, searchedSeq: int }
  type Pending = { cover: Rank, seq: int }
  type Count = { groupSkips: int, memberSkips: int, refills: int, shorts: int, researches: int, mismatches: int, budgeted: int }

  // ------------------------------------------------------------------ spec decisions (spec/candidateCache.md)
  pure val NOTHING: Rank = { value: -1, key: -1 }
  pure def cacheRanksAbove(c: Rank, o: Rank): bool = c.value > o.value or (c.value == o.value and c.key < o.key)
  pure def cacheHigherRank(l: Rank, r: Rank): Rank = if (cacheRanksAbove(r, l)) r else l
  pure def cacheReserveThreshold(reserveRoom: bool, reserveWorst: Rank, cover: Rank): Rank =
    if (reserveRoom) cover else reserveWorst
  pure def cacheOfferPlace(keptFull: bool, kth: Rank, thr: Rank, cover: Rank, x: Rank): str =
    if (x.value < 0) "noPair"
    else if (not(keptFull)) (if (cacheRanksAbove(x, cover)) "kept" else "outside")
    else if (cacheRanksAbove(x, kth)) "kept"
    else if (cacheRanksAbove(x, thr)) "reserve"
    else "outside"
  pure def cacheMemberMaySkip(keptFull: bool, kth: Rank, b: Rank): bool =
    b.value < 0 or (keptFull and not(cacheRanksAbove(b, kth)))
  pure def cacheGroupMaySkip(notFull: int, floor: Rank, b: Rank): bool =
    b.value < 0 or (notFull == 0 and not(cacheRanksAbove(b, floor)))
  pure def cacheEffectiveCover(own: Rank, pending: Rank, searchedSeq: int, pendingSeq: int): Rank =
    if (pendingSeq > searchedSeq) cacheHigherRank(own, pending) else own
  pure def cacheRemoveRepair(inKept: bool, inReserve: bool, hasReserve: bool, best: Rank, cover: Rank): str =
    if (inKept) (
      if (hasReserve and cacheRanksAbove(best, cover)) "refill"
      else if (not(hasReserve) and cover.value < 0) "short"
      else "research"
    )
    else if (inReserve) "dropReserve"
    else "untouched"
  pure def cacheEdgeValid(searchedVer: int, searcherVer: int, storedVer: int, partnerVer: int): bool =
    searchedVer == searcherVer and storedVer == partnerVer

  // ------------------------------------------------------------------ helpers
  pure def rk(e: Entry): Rank = { value: e.value, key: e.key }
  pure val TOP_ENTRY: Entry = { value: 1000, key: -1, ver: 0 }
  pure val BOTTOM_ENTRY: Entry = { value: -1000, key: 1000, ver: 0 }
  pure def worstOf(es: Set[Entry]): Entry = es.fold(TOP_ENTRY, (w, e) => if (cacheRanksAbove(rk(w), rk(e))) e else w)
  pure def bestOf(es: Set[Entry]): Entry = es.fold(BOTTOM_ENTRY, (w, e) => if (cacheRanksAbove(rk(e), rk(w))) e else w)
  pure def topN(es: Set[Entry], n: int): Set[Entry] = es.filter(e => es.filter(c => cacheRanksAbove(rk(c), rk(e))).size() < n)
  pure def keySet(es: Set[Entry]): Set[int] = es.map(e => e.key)
  pure def bestRank(es: Set[Entry]): Rank = es.fold(NOTHING, (r, e) => cacheHigherRank(r, rk(e)))
  pure val EMPTY: Cache = { close: "none", kept: Set(), reserve: Set(), cover: NOTHING, searchedVer: 0, searchedSeq: 0 }

  // ------------------------------------------------------------------ state
  var present: Set[int]
  var feat: int -> int
  var ver: int -> int
  var dirty: Set[int]
  var cache: int -> Cache
  var pending: int -> List[Pending]
  var seq: int
  var n: Count
  var lastAction: str
  var lastMember: int

  // The partners of a with a pair value, from the current profiles and versions.
  pure def candidatesOf(a: int, pr: Set[int], ft: int -> int, vr: int -> int): Set[Entry] =
    pr.exclude(Set(a)).map(b => { value: pairV(ft.get(a), ft.get(b)), key: b, ver: vr.get(b) }).filter(e => e.value >= 0)

  // A search from nothing over the checked partners; the unchecked ones are covered by their largest value.
  pure def searchOver(cands: Set[Entry], checked: Set[int], closeKind: str, sv: int, sq: int): Cache =
    val seen = cands.filter(e => checked.contains(e.key))
    val unseen = cands.exclude(seen)
    val stored = topN(seen, LIMIT + RESERVE)
    val kept = topN(seen, LIMIT)
    val unseenTop = unseen.fold(-1, (m, e) => if (e.value > m) e.value else m)
    val cover = cacheHigherRank(bestRank(seen.exclude(stored)), { value: unseenTop, key: -1 })
    { close: closeKind, kept: kept, reserve: stored.exclude(kept), cover: cover, searchedVer: sv, searchedSeq: sq }

  pure def cachePendingNeeded(b: Rank): bool = b.value >= 0
  pure def cachePendingKeeps(older: Rank, newer: Rank): bool = cacheRanksAbove(older, newer)

  pure def effective(c: Cache, a: int, pd: int -> List[Pending]): Rank =
    pd.get(groupOf(a)).foldl(c.cover, (cov, p) => cacheEffectiveCover(cov, p.cover, c.searchedSeq, p.seq))

  // A raise without a pair value covers no one; a newer raise drops the older raises it dominates.
  pure def raise(raises: List[Pending], r: Rank, sq: int): List[Pending] =
    if (not(cachePendingNeeded(r))) raises else raises.select(p => cachePendingKeeps(p.cover, r)).append({ cover: r, seq: sq })

  // A full reserve passes its worst entry outside, which raises the cover.
  pure def trimReserve(c: Cache): Cache =
    val w = worstOf(c.reserve)
    if (c.reserve.size() > RESERVE) { ...c, reserve: c.reserve.exclude(Set(w)), cover: cacheHigherRank(c.cover, rk(w)) }
    else c

  // Offer one checked entry to a member's list (spec rule "An offered candidate goes into ...").
  pure def offerTo(c0: Cache, eff: Rank, e: Entry): Cache =
    val c = { ...c0, cover: eff }
    val keptFull = c.kept.size() >= LIMIT
    val kthE = worstOf(c.kept)
    val thr = cacheReserveThreshold(c.reserve.size() < RESERVE, rk(worstOf(c.reserve)), eff)
    val place = cacheOfferPlace(keptFull, rk(kthE), thr, eff, rk(e))
    if (place == "kept")
      if (keptFull) trimReserve({ ...c, kept: c.kept.exclude(Set(kthE)).union(Set(e)), reserve: c.reserve.union(Set(kthE)) })
      else { ...c, kept: c.kept.union(Set(e)) }
    else if (place == "reserve") trimReserve({ ...c, reserve: c.reserve.union(Set(e)) })
    else if (place == "outside") { ...c, cover: cacheHigherRank(eff, rk(e)) }
    else c

  // A searcher the reverse pass considers: a cached list from the member's current profile.
  pure def considered(a: int, x: int, pr: Set[int], cs: int -> Cache, vr: int -> int): bool =
    pr.contains(a) and a != x and (cs.get(a).close == "exact" or cs.get(a).close == "budgeted")
      and cs.get(a).searchedVer == vr.get(a)

  // ------------------------------------------------------------------ the two repair steps
  type Removed = { cs: int -> Cache, refills: int, shorts: int, researches: int }

  pure def removeStep(x: int, cs: int -> Cache, pd: int -> List[Pending]): Removed =
    IDS.fold({ cs: cs.set(x, EMPTY), refills: 0, shorts: 0, researches: 0 }, (acc, a) =>
      val c = cs.get(a)
      val inKept = keySet(c.kept).contains(x)
      val inReserve = keySet(c.reserve).contains(x)
      val eff = effective(c, a, pd)
      val best = bestOf(c.reserve)
      val repair = cacheRemoveRepair(inKept, inReserve, c.reserve.size() > 0, rk(best), eff)
      val kept = c.kept.filter(e => e.key != x)
      if (a == x or c.close == "none") acc
      else if (repair == "refill")
        { ...acc, cs: acc.cs.set(a, { ...c, kept: kept.union(Set(best)), reserve: c.reserve.exclude(Set(best)) }), refills: acc.refills + 1 }
      else if (repair == "short") { ...acc, cs: acc.cs.set(a, { ...c, kept: kept }), shorts: acc.shorts + 1 }
      else if (repair == "research")
        { ...acc, cs: acc.cs.set(a, { ...EMPTY, close: "search" }), researches: acc.researches + 1 }
      else if (repair == "dropReserve") { ...acc, cs: acc.cs.set(a, { ...c, reserve: c.reserve.filter(e => e.key != x) }) }
      else acc)

  type Inserted = { cs: int -> Cache, pd: int -> List[Pending], groupSkips: int, memberSkips: int }

  pure def insertStep(x: int, pr: Set[int], ft: int -> int, vr: int -> int, cs: int -> Cache, pd: int -> List[Pending], sq: int): Inserted =
    val f = ft.get(x)
    // The reverse pass, one group at a time.
    val reverse = GROUPS.fold({ cs: cs, pd: pd, groupSkips: 0, memberSkips: 0 }, (acc, g) =>
      val members = IDS.filter(a => groupOf(a) == g and considered(a, x, pr, cs, vr))
      val top = members.fold(-1, (m, a) => if (pairV(ft.get(a), f) > m) pairV(ft.get(a), f) else m)
      val bound = { value: top, key: x }
      val notFull = members.filter(a => cs.get(a).kept.size() < LIMIT).size()
      val floor = members.fold({ value: 1000, key: -1 }, (fl, a) =>
        val kth = rk(worstOf(cs.get(a).kept))
        if (cacheRanksAbove(fl, kth)) kth else fl)
      if (members.size() == 0) acc
      else if (cacheGroupMaySkip(notFull, floor, bound))
        { ...acc, pd: acc.pd.set(g, raise(acc.pd.get(g), bound, sq + 1)), groupSkips: acc.groupSkips + 1 }
      else members.fold(acc, (inner, a) =>
        val c = cs.get(a)
        val eff = effective(c, a, pd)
        if (cacheMemberMaySkip(c.kept.size() >= LIMIT, rk(worstOf(c.kept)), bound))
          { ...inner, cs: inner.cs.set(a, { ...c, cover: cacheHigherRank(eff, bound) }), memberSkips: inner.memberSkips + 1 }
        else
          { ...inner, cs: inner.cs.set(a, offerTo(c, eff, { value: pairV(ft.get(a), f), key: x, ver: vr.get(x) })) }))
    // The forward search of x, after the raises of its own pass.
    val own = searchOver(candidatesOf(x, pr, ft, vr), IDS, "exact", vr.get(x), sq + 2)
    { ...reverse, cs: reverse.cs.set(x, own) }

  // ------------------------------------------------------------------ actions
  action init = all {
    present' = Set(),
    feat' = IDS.mapBy(a => 0),
    ver' = IDS.mapBy(a => 0),
    dirty' = Set(),
    cache' = IDS.mapBy(a => EMPTY),
    pending' = GROUPS.mapBy(g => List()),
    seq' = 0,
    n' = { groupSkips: 0, memberSkips: 0, refills: 0, shorts: 0, researches: 0, mismatches: 0, budgeted: 0 },
    lastAction' = "init", lastMember' = -1,
  }

  action join(x: int, f: int): bool =
    val pr = present.union(Set(x))
    val ft = feat.set(x, f)
    val vr = ver.set(x, ver.get(x) + 1)
    val ins = insertStep(x, pr, ft, vr, cache, pending, seq)
    all {
      lastAction' = "join", lastMember' = x,
      not(present.contains(x)),
      present' = pr, feat' = ft, ver' = vr, dirty' = dirty,
      cache' = ins.cs, pending' = ins.pd, seq' = seq + 2,
      n' = { ...n, groupSkips: n.groupSkips + ins.groupSkips, memberSkips: n.memberSkips + ins.memberSkips },
    }

  // Leave, pause, ban, hold, minor signal or a profile that is no longer eligible.
  action leave(x: int): bool =
    val rem = removeStep(x, cache, pending)
    all {
      lastAction' = "leave", lastMember' = x,
      present.contains(x),
      present' = present.exclude(Set(x)), feat' = feat, ver' = ver, dirty' = dirty.exclude(Set(x)),
      cache' = rem.cs, pending' = pending, seq' = seq,
      n' = { ...n, refills: n.refills + rem.refills, shorts: n.shorts + rem.shorts, researches: n.researches + rem.researches },
    }

  // The profile store changes first; the cache repair runs later.
  action editProfile(x: int, f: int): bool = all {
      lastAction' = "editProfile", lastMember' = x,
    present.contains(x), f != feat.get(x),
    feat' = feat.set(x, f), ver' = ver.set(x, ver.get(x) + 1), dirty' = dirty.union(Set(x)),
    present' = present, cache' = cache, pending' = pending, seq' = seq, n' = n,
  }

  // A change is a removal of the old version and an insertion of the new version.
  action repair(x: int): bool =
    val rem = removeStep(x, cache, pending)
    val ins = insertStep(x, present, feat, ver, rem.cs, pending, seq)
    all {
      lastAction' = "repair", lastMember' = x,
      dirty.contains(x),
      dirty' = dirty.exclude(Set(x)), present' = present, feat' = feat, ver' = ver,
      cache' = ins.cs, pending' = ins.pd, seq' = seq + 2,
      n' = { ...n, refills: n.refills + rem.refills, shorts: n.shorts + rem.shorts, researches: n.researches + rem.researches,
             groupSkips: n.groupSkips + ins.groupSkips, memberSkips: n.memberSkips + ins.memberSkips },
    }

  // A member marked to search again searches from nothing.
  action research(a: int): bool = all {
      lastAction' = "research", lastMember' = a,
    present.contains(a), cache.get(a).close == "search", not(dirty.contains(a)),
    cache' = cache.set(a, searchOver(candidatesOf(a, present, feat, ver), IDS, "exact", ver.get(a), seq + 1)),
    seq' = seq + 1,
    present' = present, feat' = feat, ver' = ver, dirty' = dirty, pending' = pending, n' = n,
  }

  // A budgeted search checks only some partners.
  action budgetedSearch(a: int, checked: Set[int]): bool = all {
      lastAction' = "budgetedSearch", lastMember' = a,
    present.contains(a), not(dirty.contains(a)),
    cache' = cache.set(a, searchOver(candidatesOf(a, present, feat, ver), checked, "budgeted", ver.get(a), seq + 1)),
    seq' = seq + 1,
    n' = { ...n, budgeted: n.budgeted + 1 },
    present' = present, feat' = feat, ver' = ver, dirty' = dirty, pending' = pending,
  }

  // A read of a cached list refuses the whole list when the member's own version or one stored edge
  // (kept or reserve) has a version that is not current. The own version counts as one more edge.
  action serve(a: int): bool =
    val c = cache.get(a)
    val ownEdge = { value: 0, key: a, ver: ver.get(a) }
    val stale = (c.close == "exact" or c.close == "budgeted")
      and c.kept.union(c.reserve).union(Set(ownEdge)).exists(e => not(cacheEdgeValid(c.searchedVer, ver.get(a), e.ver, ver.get(e.key))))
    all {
      lastAction' = "serve", lastMember' = a,
      present.contains(a),
      n' = if (stale) { ...n, mismatches: n.mismatches + 1 } else n,
      present' = present, feat' = feat, ver' = ver, dirty' = dirty, cache' = cache, pending' = pending, seq' = seq,
    }

  action step = {
    nondet x = IDS.oneOf()
    nondet f = FEATS.oneOf()
    nondet checked = IDS.powerset().oneOf()
    any { join(x, f), leave(x), editProfile(x, f), repair(x), research(x), budgetedSearch(x, checked), serve(x) }
  }

  // ------------------------------------------------------------------ safety
  pure def bruteKept(a: int, pr: Set[int], ft: int -> int, vr: int -> int): Set[int] =
    keySet(topN(candidatesOf(a, pr, ft, vr), LIMIT))

  val clean = dirty == Set()

  // Every cached exact kept list equals the list of a search from nothing.
  val exactIsBrute = clean implies present.forall(a =>
    cache.get(a).close == "exact" implies (
      keySet(cache.get(a).kept) == bruteKept(a, present, feat, ver)
        and cache.get(a).kept.forall(e => e.value == pairV(feat.get(a), feat.get(e.key)))))

  // No partner outside a stored list ranks above the effective cover.
  val coverSound = clean implies present.forall(a =>
    val c = cache.get(a)
    val stored = keySet(c.kept).union(keySet(c.reserve))
    (c.close == "exact" or c.close == "budgeted") implies
      candidatesOf(a, present, feat, ver).forall(e => stored.contains(e.key) or not(cacheRanksAbove(rk(e), effective(c, a, pending)))))

  // An exact list ranks above its effective cover, and a short exact list has nothing outside.
  val exactAboveCover = clean implies present.forall(a =>
    val c = cache.get(a)
    c.close == "exact" implies and {
      c.kept.forall(e => cacheRanksAbove(rk(e), effective(c, a, pending))),
      c.kept.size() < LIMIT implies (effective(c, a, pending).value < 0 and c.reserve.size() == 0),
    })

  val sizesHold = IDS.forall(a => and {
    cache.get(a).kept.size() <= LIMIT, cache.get(a).reserve.size() <= RESERVE,
    cache.get(a).reserve.size() > 0 implies cache.get(a).kept.size() == LIMIT,
  })

  // When no repair waits, every stored edge has the current versions of both members.
  val edgesCurrent = clean implies present.forall(a =>
    val c = cache.get(a)
    (c.close == "exact" or c.close == "budgeted") implies
      c.kept.union(c.reserve).forall(e => present.contains(e.key) and cacheEdgeValid(c.searchedVer, ver.get(a), e.ver, ver.get(e.key))))

  val onlyMembersCached = IDS.forall(a => not(present.contains(a)) implies cache.get(a).close == "none")

  val safety = all { exactIsBrute, coverSound, exactAboveCover, sizesHold, edgesCurrent, onlyMembersCached }

  // ------------------------------------------------------------------ reachability (each must be violated)
  val witness_groupSkip = n.groupSkips == 0
  val witness_memberSkip = n.memberSkips == 0
  val witness_refill = n.refills == 0
  val witness_short = n.shorts == 0
  val witness_research = n.researches == 0
  val witness_mismatch = n.mismatches == 0
  val witness_budgeted = not(present.exists(a => cache.get(a).close == "budgeted" and cache.get(a).cover.value >= 0))

  // ------------------------------------------------------------------ replay traces
  // Profiles: 0 and 3 have no pair; 1 and 1 have value 3; 0 and 0 have value 2; 0 and 1 have value 0.
  // Member 1 keeps 2 (value 3) and holds 0 (value 0) in reserve. When 2 leaves, 0 refills the list.
  run refillTest = init
    .then(join(0, 0)).then(join(1, 1)).then(join(2, 1))
    .expect(safety and keySet(cache.get(1).kept) == Set(2) and keySet(cache.get(1).reserve) == Set(0))
    .then(leave(2))
    .expect(safety and n.refills >= 1 and keySet(cache.get(1).kept) == Set(0))

  // Member 3 (group 1) keeps 4 at value 3. Member 2 with profile 0 has value 0 with both, below their
  // worst kept entries, so the whole group 1 is skipped.
  run groupSkipTest = init
    .then(join(3, 1)).then(join(4, 1))
    .then(join(2, 0))
    .expect(safety and n.groupSkips >= 1 and keySet(cache.get(3).kept) == Set(4))

  // A changed member's old edges are refused until the repair runs.
  run mismatchTest = init
    .then(join(0, 1)).then(join(1, 1))
    .then(editProfile(1, 0))
    .then(serve(0))
    .expect(n.mismatches == 1)
    .then(repair(1))
    .expect(safety and dirty == Set())

  // Without a reserve that ranks above the cover, the member must search again.
  run researchTest = init
    .then(join(0, 1)).then(join(1, 1)).then(join(2, 2)).then(join(3, 2))
    .then(leave(1))
    .then(research(0))
    .expect(safety)
}
```
