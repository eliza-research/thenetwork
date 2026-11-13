# Participation budgets

## Story: Set how often Eliza can offer opportunities

> As a member, I want my participation state to control how many new opportunities Eliza can offer.

### A member's state sets the default initial invite cap

Open allows four initial invites in seven days. Normal allows two in seven days. Quiet allows one in thirty days. Receiving allows up to two in seven days for permitted support. Paused allows zero. A missing or unrecognized state uses the Normal default in the budget lookup. Eligibility and the actual rolling-window counts remain at the send and matching boundaries.

```quint
type OutreachBudget = { limit: int, periodDays: int }

pure def initialInviteBudget(participation: str): OutreachBudget =
  if (participation == "open") { limit: 4, periodDays: 7 }
  else if (participation == "quiet") { limit: 1, periodDays: 30 }
  else if (participation == "paused") { limit: 0, periodDays: 7 }
  else { limit: 2, periodDays: 7 }
```

### The general unsolicited state lane excludes Receiving and Paused

Receiving has a support-only initial invite allowance. The general unsolicited state budget is zero for Receiving, because the send limit and its audit do not assign that budget to a support category. Paused also has zero. The other states use their initial invite cap.

```quint
pure def unsolicitedStateBudget(participation: str): OutreachBudget =
  if (participation == "receiving") { limit: 0, periodDays: 7 }
  else initialInviteBudget(participation)

pure def lawNoGeneralUnsolicitedBudgetForReceivingOrPaused(participation: str): bool =
  (participation == "receiving" or participation == "paused") implies unsolicitedStateBudget(participation).limit == 0
```

### A minor's solo offers have a smaller default cap

The attention controller limits eligible solo offers to one initial invite per seven days for a member aged 13–17, within any stricter limit of their participation state. Age and content eligibility are separate rules.

```quint
pure val minorInitialInviteBudget: OutreachBudget = { limit: 1, periodDays: 7 }
```

## Story: Receive separately budgeted plans and check-ins

> As a member, I want a plan or a check-in I agreed to without spending a general opportunity slot.

### Each separate lane has its own weekly cap

The plan lane and the opt-in weekly check-in lane each permit one item per seven days, subject to the existing state, eligibility, consent and send checks. The lane allowance never grants permission on its own.

```quint
pure val planInviteBudget: OutreachBudget = { limit: 1, periodDays: 7 }
pure val availabilityCheckInBudget: OutreachBudget = { limit: 1, periodDays: 7 }
```
