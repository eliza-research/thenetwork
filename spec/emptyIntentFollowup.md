# Follow up when an intent has no match

[Story F21](product/stories.md#story-f21--hear-when-nothing-fits) uses the engine's recorded empty result. The shell owns the current member record, the matching run, the text and the existing outbound checks.

## Story: Hear when nothing fits yet

> As a member, I want an honest status and one useful next step for an intent the Network still cannot match.

### Explain an empty search after its configured wait

Use the daily run's empty result after the configured wait, normally ten days from the current statement. A new statement starts a new wait. An absent, filtered or below-threshold match can produce a follow-up. A viable match held by selection or budget is a different result. Keep the engine's reason code in the matching log and the follow-up audit. The message says the Network has no match to offer yet and points to the solo public-event request. It names neither the private intent nor other members.

```quint
pure def emptyIntentFollowupReasonAllowed(reason: str): bool =
  reason == "no_candidates" or reason == "density_gap" or reason == "below_threshold" or reason == "filtered"

pure val emptyIntentDefaultWaitDays: int = 10
pure val emptyIntentDayMs: int = 86400000

pure def emptyIntentWaitOver(statementAgeMs: int, waitDays: int): bool =
  statementAgeMs >= waitDays * emptyIntentDayMs

pure def lawNewStatementWaitsBeforeAFollowup(waitDays: int): bool =
  waitDays > 0 implies not(emptyIntentWaitOver(0, waitDays))
```

### A pending follow-up uses current permission and the same live statement

Only an active, eligible adult may receive the status. They allow its category, have no other open opportunity or question, and are outside an active turn. A deferred message expires after the day of its search. Pausing, closing or expiring the intent ends the notice. An unchanged statement has at most one committed follow-up. A new statement can qualify after another configured wait. The ordinary outbound controller checks the budget, timing and leak rules and preserves its final slot for opportunities.

```quint
pure def emptyIntentFollowupReady(liveStatement: bool, eligible: bool, categoryAllowed: bool, quietConversation: bool, sameSearchDay: bool, alreadyReported: bool): bool =
  liveStatement and eligible and categoryAllowed and quietConversation and sameSearchDay and not(alreadyReported)

pure def lawReportedIntentDoesNotRepeat(liveStatement: bool, eligible: bool, categoryAllowed: bool, quietConversation: bool, sameSearchDay: bool): bool =
  not(emptyIntentFollowupReady(liveStatement, eligible, categoryAllowed, quietConversation, sameSearchDay, true))
```
