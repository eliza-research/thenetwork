# Candidate cache

The cache keeps the result of each member search between runs, so that the engine does not search again for every member when a few members join, leave or change. One cached search belongs to one lane membership. The [bounded candidate search](candidateSearch.md) gives the first result, and the [reciprocal pair value](pairValue.md) gives each value. The [candidate cache model](models/candidate_cache.md) runs the whole flow on a small population and compares every cached exact list with a search from nothing. The kept candidates serve [Story F11](product/stories.md#story-f11--consider-a-one-to-one-introduction), and a short or budgeted list keeps the reason of [Story F21](product/stories.md#story-f21--hear-when-nothing-fits).

For each cached search the shell keeps:

- the kept list: at most `limit` entries, each with the pair value, the canonical key of the partner, and the partner's profile version;
- the reserve: at most `reserve` more entries, the next best after the kept list, in the same form;
- the close kind of the last search, exact or budgeted;
- the cover: a rank such that every partner with a pair value that is not stored (not in the kept list or the reserve) ranks at or below it;
- the member's own profile version and the sequence number of its last search.

A search that closes with `unseenBound` and the best dropped candidate gives the cover: the higher of the best dropped rank and the rank `{ value: unseenBound, key: -1 }`. Canonical keys are not negative, so that rank is above every unchecked candidate. A cover with a negative value means that nothing with a pair value is outside the stored entries.

The reverse pass of an insertion bounds members in groups. For each group the shell keeps the group floor (the lowest worst kept entry of the members with a full kept list), the number of members whose kept list is not full, and the pending cover with the sequence number of its last raise. The shell computes the pair values, the bounds, and the worst and best stored entries. This spec makes each decision. Kept lists and edges are private, as the pair values are.

## Story: Keep cached candidates correct when members join

> As a member, I want my best candidates to stay correct when other people join, without the Network searching again for everyone.

### Candidates rank by value, then by canonical key

A higher value ranks first. Two equal values rank by canonical key, the lower key first. This is the order of the bounded candidate search, with the canonical key in place of the ordinal: a key never changes when members join or leave. Two different candidates never have the same key, so the order is total on them.

```quint
type CacheRank = { value: int, key: int }

pure val cacheNothingOutside: CacheRank = { value: -1, key: -1 }

pure def cacheRanksAbove(candidate: CacheRank, other: CacheRank): bool =
  candidate.value > other.value or (candidate.value == other.value and candidate.key < other.key)

pure def cacheHigherRank(left: CacheRank, right: CacheRank): CacheRank =
  if (cacheRanksAbove(right, left)) right else left

pure def cacheLowerRank(left: CacheRank, right: CacheRank): CacheRank =
  if (cacheRanksAbove(left, right)) right else left

pure val leftRankValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val rightRankValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val middleRankValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)

pure def lawCacheRankTotal(leftRank: CacheRank, rightRank: CacheRank): bool =
  leftRank.key != rightRank.key implies (cacheRanksAbove(leftRank, rightRank) or cacheRanksAbove(rightRank, leftRank))

pure def lawCacheRankAtOrBelowChains(leftRank: CacheRank, middleRank: CacheRank, rightRank: CacheRank): bool =
  (not(cacheRanksAbove(leftRank, middleRank)) and not(cacheRanksAbove(middleRank, rightRank)))
    implies not(cacheRanksAbove(leftRank, rightRank))
```

### An offered candidate goes into the kept list, into the reserve, or outside

The shell offers a new member `x` with its pair value. A candidate without a pair value changes nothing. When the kept list is full, `x` enters it only when `x` ranks above the worst kept entry `kth`; that entry then moves to the reserve. Otherwise `x` enters the reserve only when it ranks above the reserve threshold: the cover while the reserve has room, else the worst reserve entry, or `kth` when the reserve has no places. When the kept list is not full, `x` enters it only when it ranks above the cover. An entry that leaves the reserve because it is full, or a candidate that goes outside, raises the cover to its rank.

Let `kth` be the worst kept entry of a full kept list, and let every kept entry rank above the cover. Then the kept list after the offer still ranks above every candidate that is not kept, `x` included (`lawCacheOfferKeepsTop`). The same is true for a kept list that is not full, when every kept entry ranks above the cover (`lawCacheOfferFillsShortList`). This is the rule that kept beats dropped, applied to one new candidate. Because the kept list of an exact search holds the first `limit` partners in this order, it still holds them after the offer.

```quint
type CacheOfferPlace = CacheIntoKept | CacheIntoReserve | CacheOutside | CacheNoPair

pure def cacheReserveThreshold(reserveRoom: bool, reserveWorst: CacheRank, cover: CacheRank): CacheRank =
  if (reserveRoom) cover else reserveWorst

pure def cacheOfferPlace(keptFull: bool, kth: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): CacheOfferPlace =
  if (x.value < 0) CacheNoPair
  else if (not(keptFull)) (if (cacheRanksAbove(x, cover)) CacheIntoKept else CacheOutside)
  else if (cacheRanksAbove(x, kth)) CacheIntoKept
  else if (cacheRanksAbove(x, reserveThreshold)) CacheIntoReserve
  else CacheOutside

pure val kthValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val reserveThresholdValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val coverValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val xValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val otherKeptValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val outsideValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)

pure def lawCacheOfferKeepsTop(kth: CacheRank, otherKept: CacheRank, outside: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): bool =
  val place = cacheOfferPlace(true, kth, reserveThreshold, cover, x)
  and {
    x.value >= 0, x.key != kth.key, x.key != otherKept.key,
    cacheRanksAbove(otherKept, kth), cacheRanksAbove(kth, cover), not(cacheRanksAbove(outside, cover)),
  } implies and {
    place == CacheIntoKept implies and {
      cacheRanksAbove(x, kth), cacheRanksAbove(x, outside), cacheRanksAbove(otherKept, outside),
    },
    place != CacheIntoKept implies and { cacheRanksAbove(kth, x), cacheRanksAbove(otherKept, x) },
  }

pure def lawCacheOfferFillsShortList(kth: CacheRank, otherKept: CacheRank, outside: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): bool =
  val place = cacheOfferPlace(false, kth, reserveThreshold, cover, x)
  and {
    x.value >= 0, x.key != otherKept.key,
    cacheRanksAbove(otherKept, cover), not(cacheRanksAbove(outside, cover)),
  } implies and {
    place == CacheIntoKept implies and { cacheRanksAbove(x, outside), cacheRanksAbove(otherKept, outside) },
    place != CacheIntoKept implies cacheRanksAbove(otherKept, x),
  }
```

### A member is untouched when a bound on the new value cannot rank above its worst kept entry

The reverse pass of an insertion does not compute the pair value of a member `a` and the new member `x` when an upper bound on that value, given the key of `x`, cannot rank above `a`'s worst kept entry, and `a`'s kept list is full. It also skips `a` when the bound is negative: no pair value is possible. A skipped member's kept list does not change and stays correct, because `x` cannot enter it (`lawCacheMemberSkipSound`). Equal values rank by key, so the bound is compared as the rank of the bound and the key of `x`: a bound equal to the worst kept value can still let a lower key in.

The skipped `x` may still belong in the reserve, so the shell raises the member's cover to the bound rank. The raised cover holds `x` (`lawCacheSkipCoverHoldsX`), and an exact kept list still ranks above it (`lawCacheSkipKeepsExact`). A budgeted member stays budgeted. Its bound is updated honestly: the cover becomes the higher of the old cover and the bound rank of the member it did not check.

```quint
pure def cacheMemberMaySkip(keptFull: bool, kth: CacheRank, boundRank: CacheRank): bool =
  boundRank.value < 0 or (keptFull and not(cacheRanksAbove(boundRank, kth)))

pure val boundRankValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)

pure def lawCacheMemberSkipSound(keptFull: bool, kth: CacheRank, boundRank: CacheRank, reserveThreshold: CacheRank, cover: CacheRank, x: CacheRank): bool =
  (cacheMemberMaySkip(keptFull, kth, boundRank) and x.value <= boundRank.value and x.key == boundRank.key)
    implies cacheOfferPlace(keptFull, kth, reserveThreshold, cover, x) != CacheIntoKept

pure def lawCacheSkipCoverHoldsX(cover: CacheRank, boundRank: CacheRank, x: CacheRank): bool =
  (x.value <= boundRank.value and x.key == boundRank.key)
    implies not(cacheRanksAbove(x, cacheHigherRank(cover, boundRank)))

pure def lawCacheSkipKeepsExact(kth: CacheRank, cover: CacheRank, boundRank: CacheRank): bool =
  (cacheRanksAbove(kth, cover) and not(cacheRanksAbove(boundRank, kth)) and boundRank.key != kth.key)
    implies cacheRanksAbove(kth, cacheHigherRank(cover, boundRank))
```

### A group is untouched when its bound cannot rank above the lowest worst kept entry in the group

The shell bounds the new member's value with every member of a group at once. A group bound covers the value of `x` with each member of the group, as `lawBucketBoundSound` allows. The group floor ranks at or below the worst kept entry of every member of the group with a full kept list. The shell lowers the floor at once when a member's worst kept entry falls, and may leave it low when that entry rises. After the floor is lowered with a member's worst kept entry, a group skip is a sound skip for that member (`lawCacheLoweredFloorSkipSound`). The reverse pass skips the whole group when the bound is negative, or when every member's kept list is full and the bound rank does not rank above the floor. Then every member of the group may be skipped (`lawCacheGroupSkipSound`), and no kept list in the group changes.

For a skipped group the shell does not touch the members. It adds a raise to the group: the bound rank and the sequence number of the raise. A raise with a negative value covers no partner, and the shell does not add it. A member's effective cover is its own cover, raised by each raise of its group that came after the member's last search (`lawCacheEffectiveCoverSound`). A search after the raise saw `x`, so it does not need the raise. A new raise drops each older raise that does not rank above it, because every member that the older raise covers is also covered by the new one (`lawCachePendingPruneSound`).

Discovered by simulation: one pending cover per group, raised to the higher rank at each skip, is not enough. A member that searched between two raises then gets the first raise back with the second one. When the first raise was for a partner that the member's search kept, the raised cover holds a kept entry, and a short exact list can refuse a partner it must keep. So the shell keeps the raises with their sequence numbers.

```quint
pure def cacheGroupMaySkip(notFull: int, groupFloor: CacheRank, boundRank: CacheRank): bool =
  boundRank.value < 0 or (notFull == 0 and not(cacheRanksAbove(boundRank, groupFloor)))

pure def cacheEffectiveCover(ownCover: CacheRank, pendingCover: CacheRank, searchedSeq: int, pendingSeq: int): CacheRank =
  if (pendingSeq > searchedSeq) cacheHigherRank(ownCover, pendingCover) else ownCover

pure def cachePendingNeeded(boundRank: CacheRank): bool = boundRank.value >= 0

pure def cachePendingKeeps(older: CacheRank, newer: CacheRank): bool = cacheRanksAbove(older, newer)

pure val groupFloorValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val ownCoverValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val pendingCoverValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val notFullValues = Set(0, 1)
pure val olderValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val newerValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)
pure val searchedSeqValues = Set(0, 1, 2)
pure val olderSeqValues = Set(0, 1, 2)
pure val newerSeqValues = Set(0, 1, 2)
pure val pendingSeqValues = Set(0, 1, 2)

pure def lawCacheGroupSkipSound(notFull: int, groupFloor: CacheRank, boundRank: CacheRank, keptFull: bool, kth: CacheRank): bool =
  and {
    cacheGroupMaySkip(notFull, groupFloor, boundRank),
    not(cacheRanksAbove(groupFloor, kth)),
    keptFull or notFull > 0,
  } implies cacheMemberMaySkip(keptFull, kth, boundRank)

pure def lawCacheLoweredFloorSkipSound(groupFloor: CacheRank, kth: CacheRank, boundRank: CacheRank): bool =
  cacheGroupMaySkip(0, cacheLowerRank(groupFloor, kth), boundRank) implies cacheMemberMaySkip(true, kth, boundRank)

pure def lawCacheEffectiveCoverSound(ownCover: CacheRank, pendingCover: CacheRank, searchedSeq: int, pendingSeq: int, outside: CacheRank): bool =
  val effective = cacheEffectiveCover(ownCover, pendingCover, searchedSeq, pendingSeq)
  and {
    not(cacheRanksAbove(outside, ownCover)) implies not(cacheRanksAbove(outside, effective)),
    (pendingSeq > searchedSeq and not(cacheRanksAbove(outside, pendingCover))) implies not(cacheRanksAbove(outside, effective)),
  }

pure def lawCachePendingPruneSound(ownCover: CacheRank, older: CacheRank, newer: CacheRank, searchedSeq: int, olderSeq: int, newerSeq: int, outside: CacheRank): bool =
  (olderSeq < newerSeq and not(cachePendingKeeps(older, newer))
    and not(cacheRanksAbove(outside, cacheEffectiveCover(cacheEffectiveCover(ownCover, older, searchedSeq, olderSeq), newer, searchedSeq, newerSeq))))
    implies not(cacheRanksAbove(outside, cacheEffectiveCover(ownCover, newer, searchedSeq, newerSeq)))

pure def lawCacheUnneededRaiseCoversNoOne(boundRank: CacheRank, outside: CacheRank): bool =
  (not(cachePendingNeeded(boundRank)) and outside.value >= 0) implies cacheRanksAbove(outside, boundRank)

pure def lawCacheRaisedCoverStaysSound(cover: CacheRank, boundRank: CacheRank, outside: CacheRank): bool =
  not(cacheRanksAbove(outside, cover)) implies not(cacheRanksAbove(outside, cacheHigherRank(cover, boundRank)))
```

## Story: Repair cached candidates when members leave or change

> As a member, I want a candidate who left to leave my list at once, and my list to stay the best available or be searched again.

### Only a member whose stored list holds the removed member is affected

A member is removed from the index when the member leaves or pauses, is banned, is held, gives a minor signal, or no longer has an eligible profile. The removal never makes another candidate better, so only a member that stores the removed member changes. A removed reserve entry is dropped. A removed kept entry leaves a hole. The best reserve entry fills it when it ranks above the member's effective cover (`lawCacheRefillKeepsTop`). With no reserve entry and nothing outside, the shorter kept list holds every partner (`lawCacheShortHoldsEveryone`). Otherwise the member must search again.

```quint
type CacheRepair = CacheUntouched | CacheDropReserve | CacheRefill | CacheShort | CacheResearch

pure def cacheRemoveRepair(inKept: bool, inReserve: bool, hasReserve: bool, reserveBest: CacheRank, cover: CacheRank): CacheRepair =
  if (inKept) (
    if (hasReserve and cacheRanksAbove(reserveBest, cover)) CacheRefill
    else if (not(hasReserve) and cover.value < 0) CacheShort
    else CacheResearch
  )
  else if (inReserve) CacheDropReserve
  else CacheUntouched

pure val reserveBestValues = Set(
  { value: -1, key: -1 }, { value: -1, key: 2 }, { value: 0, key: 1 },
  { value: 3, key: 0 }, { value: 3, key: 1 }, { value: 3, key: 2 }, { value: 5, key: 1 },
)

pure def lawCacheRefillKeepsTop(hasReserve: bool, reserveBest: CacheRank, cover: CacheRank, outside: CacheRank): bool =
  (cacheRemoveRepair(true, false, hasReserve, reserveBest, cover) == CacheRefill and not(cacheRanksAbove(outside, cover)))
    implies cacheRanksAbove(reserveBest, outside)

pure def lawCacheShortHoldsEveryone(hasReserve: bool, reserveBest: CacheRank, cover: CacheRank, outside: CacheRank): bool =
  (cacheRemoveRepair(true, false, hasReserve, reserveBest, cover) == CacheShort and outside.value >= 0)
    implies cacheRanksAbove(outside, cover)
```

### A profile change is a removal and then an insertion with a new version

A change to a member's profile removes the old version from every stored list that holds it and inserts the new version: its own search runs again, and the reverse pass offers it to other members. The new version is one more than the old one.

```quint
pure def cacheNextVersion(version: int): int = version + 1
```

### A stored edge is valid only when both profile versions match

An entry that a member's list stores was computed from two profiles: the searcher's and the partner's. The shell uses the entry only when the searcher's version from the search and the partner's version in the entry both equal the current versions. A member whose own version changed must search again. Versions only grow, so after a change no stored entry of the old version is valid, and an entry stored after the change with the new version is valid while the searcher's version does not change (`lawCacheChangeRefusesOnlyOldEdges`). A shell that finds an entry that is not valid does not use the list: the member must search again.

```quint
pure def cacheEdgeValid(searchedVersion: int, searcherVersion: int, storedVersion: int, partnerVersion: int): bool =
  searchedVersion == searcherVersion and storedVersion == partnerVersion

pure def lawCacheChangeRefusesOnlyOldEdges(searchedVersion: int, searcherVersion: int, storedVersion: int, partnerVersion: int): bool =
  storedVersion <= partnerVersion implies and {
    not(cacheEdgeValid(searchedVersion, searcherVersion, storedVersion, cacheNextVersion(partnerVersion))),
    searchedVersion == searcherVersion
      implies cacheEdgeValid(searchedVersion, searcherVersion, cacheNextVersion(partnerVersion), cacheNextVersion(partnerVersion)),
  }
```
