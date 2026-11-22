# Available seats in Friends plans

## Story: Use a seat only for a plan it can serve

> As a member, I want a repeat or partner recommendation I can attend without getting called as the alternate for two different plans.

### Check the final format and meeting availability

Check the formats allowed by the final roster. If only two members
remain, both need one-to-one eligibility. Check common presence before
ranking and before emitting a candidate. A pair with no common meeting
window cannot displace a pair that has one.

```quint
pure def friendsSeatFitsFormat(startsAsGroup: bool, finalPair: bool, pairEligible: bool): bool =
  not(startsAsGroup and finalPair) or pairEligible

pure def friendsCandidateCanMeet(compatible: bool, sharesTime: bool): bool =
  compatible and sharesTime

pure def lawFriendsTwoSeatsNeedPairEligibility(pairEligible: bool): bool =
  friendsSeatFitsFormat(true, true, pairEligible) == pairEligible
```

### Retain an alternate for at most one plan in the week

An alternate on the published weekly slate has no primary invitation
anywhere on that slate. Keep the alternate on the first eligible plan
in normal plan order. Remove later copies.

```quint
pure def friendsAlternateMayRemain(invited: bool, alreadyAlternate: bool): bool =
  not(invited or alreadyAlternate)

pure def lawFriendsAlternateIsExclusive(invited: bool, alreadyAlternate: bool): bool =
  friendsAlternateMayRemain(invited, alreadyAlternate) implies not(invited) and not(alreadyAlternate)
```
