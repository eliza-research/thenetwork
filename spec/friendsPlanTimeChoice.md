# Agree on a time for a Friends activity partner plan

The [weekly Friends planner](friendsWeek.md) submits compatible activity partners for staff review. A reviewed partner plan can carry two or three viable windows for the same public activity and venue. The ordinary [plan dispatch](planDispatch.md) and [reply](planDecision.md) gates still apply.

## Story: Choose a time privately with my activity partner

> As a participant in a reviewed activity-partner plan, I want to pick the times that actually work for me before the meeting is set.

### Review fixes the available windows

The reviewed list has two or three windows with positive duration and distinct starts in chronological order. It includes the proposal's primary window. The plan keeps the same activity and public venue for all options. The existing fixed-time journey remains available when the proposal has a single window and no reviewed options list.

```quint
type FriendsPlanWindow = { start: int, end: int }
type FriendsPlanWindowCheck = { valid: bool, previousStart: int }
pure val noFriendsPlanWindow: FriendsPlanWindow = { start: -1, end: -1 }

pure val earlyPlanWindow: FriendsPlanWindow = { start: 10, end: 12 }
pure val latePlanWindow: FriendsPlanWindow = { start: 20, end: 22 }
pure val lastPlanWindow: FriendsPlanWindow = { start: 30, end: 31 }
pure val differentPlanWindow: FriendsPlanWindow = { start: 10, end: 13 }
pure val reviewedValues = Set(List(), List(earlyPlanWindow), List(earlyPlanWindow, latePlanWindow),
  List(earlyPlanWindow, latePlanWindow, lastPlanWindow), List(latePlanWindow, earlyPlanWindow), List(earlyPlanWindow, differentPlanWindow))
pure val firstPicksValues = Set(List(), List(earlyPlanWindow), List(latePlanWindow), List(earlyPlanWindow, latePlanWindow), List(differentPlanWindow))
pure val secondPicksValues = firstPicksValues
pure val viableWindowsValues = firstPicksValues

pure def friendPlanWindowOrder(reviewed: List[FriendsPlanWindow]): FriendsPlanWindowCheck =
  reviewed.foldl({ valid: true, previousStart: -1 }, (data, window) =>
    { valid: data.valid and data.previousStart < window.start and window.start < window.end, previousStart: window.start })

pure def friendPlanReviewedWindowsValid(reviewed: List[FriendsPlanWindow]): bool =
  reviewed.length() >= 2 and reviewed.length() <= 3 and friendPlanWindowOrder(reviewed).valid

pure def friendPlanHasWindow(windows: List[FriendsPlanWindow], startAt: int, endAt: int): bool =
  windows.some(window => window.start == startAt and window.end == endAt)
```

### Only explicit picks from the delivered invitation count

The first person sees the viable reviewed options. When they pick times, the second sees only the still-viable options they picked. Labels (A, B and C) keep their meaning even if an option disappears. Ordinals such as “the second one” use the order in the person's own delivered message. Accept explicit keys, unambiguous offered times, or an explicit choice of any offered option. Every positive key in a list must be present in the delivered invitation. An unqualified yes, an unoffered time, a counter or a reply without picks cannot accept any slot, even when the invitation presents a single remaining choice. A direct no or “none of those work” declines the invitation.

```quint
pure val friendPlanProbeDeliveryPrefix = "friends-plan-probe:"

pure def friendPlanOfferSlotAllowed(reviewedSlot: bool, firstOffer: bool, firstPicked: bool, viable: bool): bool =
  reviewedSlot and (firstOffer or firstPicked) and viable

pure def lawSecondFriendOfferNeedsTheFirstPick(reviewedSlot: bool, viable: bool): bool =
  not(friendPlanOfferSlotAllowed(reviewedSlot, false, false, viable))

type FriendsPlanTimeReply = AcceptTimeChoices | DeclineTimeChoices | ClarifyTimeChoices

pure def friendPlanReplyChoice(affirmative: bool, negative: bool, explicitPick: bool, counter: bool, pickedCount: int): FriendsPlanTimeReply =
  if (counter) ClarifyTimeChoices
  else if (affirmative and not(negative) and explicitPick and pickedCount > 0) AcceptTimeChoices
  else if (negative and not(affirmative)) DeclineTimeChoices
  else ClarifyTimeChoices

pure def lawFriendPlanBareYesCannotPick(pickedCount: int): bool =
  friendPlanReplyChoice(true, false, false, false, pickedCount) == ClarifyTimeChoices
```

### Book the earliest current window both chose

Check the exact start and end against the reviewed options and each person's accepted picks. The earliest mutually selected option that still fits wins. With no common current option, leave the plan unbooked. The same reviewed venue, current eligibility, allowance, and consent gates still apply.

```quint
pure def friendPlanEarliestCommon(reviewed: List[FriendsPlanWindow], firstPicks: List[FriendsPlanWindow],
    secondPicks: List[FriendsPlanWindow], viableWindows: List[FriendsPlanWindow]): FriendsPlanWindow =
  if (secondPicks.length() == 0 or not(friendPlanReviewedWindowsValid(reviewed))) noFriendsPlanWindow
  else reviewed.foldl(noFriendsPlanWindow, (earliest, window) =>
    if (earliest.start < 0 and friendPlanHasWindow(firstPicks, window.start, window.end)
      and friendPlanHasWindow(secondPicks, window.start, window.end)
      and friendPlanHasWindow(viableWindows, window.start, window.end)) window
    else earliest)

pure def lawFriendPlanCannotBookWithoutSecondPick(reviewed: List[FriendsPlanWindow], firstPicks: List[FriendsPlanWindow],
    viableWindows: List[FriendsPlanWindow]): bool =
  friendPlanEarliestCommon(reviewed, firstPicks, List(), viableWindows).start < 0
```
