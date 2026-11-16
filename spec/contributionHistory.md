# Private contribution history

[Story F34](product/stories.md#story-f34--see-my-contribution-history) makes the adult member's own verified contributions available in conversation. The [capital ledger](capitalLedger.md) decides which events earn an entry or reverse one.

## Story: Read what I contributed

> As an adult member, I want to read a page of my own contributions without seeing a score, rank or another member's data.

### Read the current member's history in the app that owns it

An explicit, signed request can read history only for the current active adult member bound to the sender in this app. Use the lowest known age. Revalidate the binding and the answer on a replay. If the reply would change or the member can no longer read it, withhold the stored reply. This request has no enrollment, contact or matching effect.

```quint
import memberAge as Age from "./memberAge"

pure def contributionHistoryAllowed(activeOwner: bool, age: int): bool =
  activeOwner and Age::matchableAge(age)

pure def contributionHistoryReplayAllowed(activeOwner: bool, sameReply: bool): bool =
  activeOwner and sameReply

pure def lawContributionHistoryRequiresAdult(age: int): bool =
  age < Age::adultAge implies not(contributionHistoryAllowed(true, age))
```

### Show verified acts a page at a time

Rebuild credits from the committed event log for this app. For events with an equal timestamp, establish membership and age before activity, record the accepted plan and offered help before their outcomes, and record attendance before its feedback. Apply reversals after the credits they can reverse. Show the date and a fixed label for each valid contribution, newest first, with up to five items per reply. Include a verified contribution even when it earned zero credit. Omit losses, reversed entries, amounts, ranks, names, identifiers, private notes and provenance. Use the signed reply's leak checks and do not fall back to independent delivery.

```quint
pure val contributionHistoryPageSize = 5

pure def contributionHistoryEntryVisible(positive: bool, reversed: bool): bool =
  positive and not(reversed)

pure def contributionEventReplayPriority(kind: str): int =
  if (kind == "member_joined") 0
  else if (kind == "age_updated") 1
  else if (kind == "safety_flag" or kind == "abuse_confirmed") 2
  else if (kind == "plan_accepted" or kind == "help_given") 3
  else if (kind == "plan_confirmed") 4
  else if (kind == "plan_attended") 5
  else if (kind == "feedback_given") 6
  else if (kind == "member_removed" or kind == "fraud_confirmed") 8
  else 7

pure def lawContributionHistoryOmitsReversals(positive: bool): bool =
  not(contributionHistoryEntryVisible(positive, true))

pure def lawContributionEvidencePrecedesCorrection(kind: str): bool =
  (kind == "plan_accepted" or kind == "plan_attended" or kind == "feedback_given") implies
    contributionEventReplayPriority(kind) < contributionEventReplayPriority("fraud_confirmed")
```
