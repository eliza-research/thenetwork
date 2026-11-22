# Plan a date only for a currently eligible pair

## Story: Get a public date plan for a permitted match

> As a member, I want the date planner to honor current safety and participation settings.

### Recheck both members before making a plan

Both people are distinct adults with dating turned on. Neither may be
paused. An active safety hold on either person or a block between them
prevents a plan. Resolve saved aliases before applying these decisions.
A hold starts at its start time and expires at its end time.

```quint
pure def slopDateProfilesAllowed(distinct: bool, bothAdult: bool, bothOptedIn: bool, eitherPaused: bool): bool =
  distinct and bothAdult and bothOptedIn and not(eitherPaused)

pure def slopDatePairAllowed(blocked: bool, held: bool): bool =
  not(blocked or held)

pure def lawSlopDateDoesNotPlanForYoungMembers(distinct: bool, bothOptedIn: bool, eitherPaused: bool): bool =
  not(slopDateProfilesAllowed(distinct, false, bothOptedIn, eitherPaused))

pure def lawSlopDateBlockPreventsPlan(held: bool): bool =
  not(slopDatePairAllowed(true, held))

pure def lawSlopDateHoldPreventsPlan(blocked: bool): bool =
  not(slopDatePairAllowed(blocked, true))
```
