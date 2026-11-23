# Available seats in Friends plans

## Story: Use a seat only for a plan it can serve

> As a Friends member, I want a repeat or partner recommendation that fits my chosen format and a time we can meet.

### Check the final format and meeting availability

Use the final roster for participant fields and the repeat key. Keep at most
six members. If screening a group leaves two members, both must allow a
one-to-one meeting and pass its member rules. A repeat roster needs a shared
meeting window. Choose an activity partner from candidates who share a meeting
window before taking the highest-ranked match.

```quint
pure def friendsSeatFitsFormat(startsAsGroup: bool, finalPair: bool, pairEligible: bool): bool =
  not(startsAsGroup and finalPair) or pairEligible

pure def friendsCandidateCanMeet(compatible: bool, sharesTime: bool): bool =
  compatible and sharesTime

pure def lawFriendsTwoSeatsNeedPairEligibility(pairEligible: bool): bool =
  friendsSeatFitsFormat(true, true, pairEligible) == pairEligible

pure def lawFriendsCandidateNeedsCommonMeeting(compatible: bool): bool =
  not(friendsCandidateCanMeet(compatible, false))
```
