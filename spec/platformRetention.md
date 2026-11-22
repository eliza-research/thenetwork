# Platform retention

The scheduled backend retention pass chooses cutoffs for platform and
inbox rows. Postgres applies the strict time comparisons inside the
store's existing transactions. The in-memory people store uses the
same rules directly.

## Story: Remove expired account data and retain necessary send history

> As a member, I want expired sign-in and pending conversation data to
> disappear while the service still honors suppression and deduplication.

### Platform rows and inbox payloads have separate cutoffs

The platform pass keeps expired challenges, revoked or expired sessions,
and unfinished text and phone change flows for two days from the
relevant time. It discards rows strictly before that cutoff. Confirmed
phone changes keep the audit record. The inbox starts scrubbing and
removing finished payloads at seven days. The
[signed inbox rule](signedInbox.md) controls the additional tombstone
retention after scrubbing.

```quint
pure val platformKeepMs: int = 172800000
pure val inboxKeepMs: int = 604800000

pure def rowBeforeCutoff(at: int, cutoff: int): bool = at < cutoff
pure def sessionPastRetention(expiresAt: int, revoked: bool, revokedAt: int, cutoff: int): bool =
  rowBeforeCutoff(expiresAt, cutoff) or (revoked and rowBeforeCutoff(revokedAt, cutoff))
pure def phoneChangePastRetention(confirmed: bool, requestedAt: int, cutoff: int): bool =
  not(confirmed) and rowBeforeCutoff(requestedAt, cutoff)

pure def lawConfirmedChangeStays(requestedAt: int, cutoff: int): bool =
  not(phoneChangePastRetention(true, requestedAt, cutoff))
pure def lawRowsAtCutoffStay(cutoff: int): bool = not(rowBeforeCutoff(cutoff, cutoff))
```

### Retain the STOP hint count for its full window

An ordinary rate counter follows the platform cutoff, with no additional time. A STOP hint may
be sent only once per app and person over thirty days. Retain that
counter for thirty additional days past the platform cutoff so routine
cleanup cannot cause an early repeat.

```quint
pure val stopHintWindowMs: int = 2592000000

pure def rateCounterCutoff(platformCutoff: int, extraKeepMs: int): int = platformCutoff - extraKeepMs
pure def stopHintCounterPastRetention(lastAt: int, platformCutoff: int): bool =
  rowBeforeCutoff(lastAt, rateCounterCutoff(platformCutoff, stopHintWindowMs))

pure def lawOrdinaryCounterFollowsPlatformCutoff(lastAt: int, platformCutoff: int): bool =
  rowBeforeCutoff(lastAt, rateCounterCutoff(platformCutoff, 0)) == rowBeforeCutoff(lastAt, platformCutoff)
pure def lawStopHintCounterStaysInWindow(lastAt: int, platformCutoff: int): bool =
  lastAt >= platformCutoff - stopHintWindowMs implies not(stopHintCounterPastRetention(lastAt, platformCutoff))
```

### Finished profile suggestions leave after the platform cutoff

A rejected, expired or withdrawn profile suggestion has no text, but it still keeps its source, kind and connection. Remove it when its batch expired strictly before the platform cutoff. A pending or accepted suggestion stays: an accepted one links a saved fact that a later disconnect or delete must find. A batch with no suggestion left is removed at the same cutoff. Changed 2026-11-21: this rule is new, because finished suggestion rows had no purge (SD-376); the window is the platform window of two days, counted from the batch expiry. An accepted suggestion whose saved fact is gone is also finished: no later disconnect or delete has a fact to find. Changed 2026-11-22: a fact removed by a path other than a fact edit left its accepted suggestion row with its source, kind and connection for all time (IPP-4).

```quint
pure def suggestionRetentionCutoff(now: int): int = now - platformKeepMs
pure def suggestionFinished(status: str, hasFact: bool): bool =
  status == "rejected" or status == "expired" or status == "withdrawn" or (status == "accepted" and not(hasFact))
pure def suggestionPastRetention(status: str, hasFact: bool, batchExpiresAt: int, cutoff: int): bool =
  suggestionFinished(status, hasFact) and rowBeforeCutoff(batchExpiresAt, cutoff)
pure def batchPastRetention(remaining: int, batchExpiresAt: int, cutoff: int): bool =
  remaining == 0 and rowBeforeCutoff(batchExpiresAt, cutoff)

pure def lawLiveSuggestionStays(hasFact: bool, batchExpiresAt: int, cutoff: int): bool =
  not(suggestionPastRetention("proposed", hasFact, batchExpiresAt, cutoff))
    and not(suggestionPastRetention("accepted", true, batchExpiresAt, cutoff))
pure def lawAcceptedWithoutFactLeaves(batchExpiresAt: int, cutoff: int): bool =
  rowBeforeCutoff(batchExpiresAt, cutoff) implies suggestionPastRetention("accepted", false, batchExpiresAt, cutoff)
pure def lawBatchWithSuggestionsStays(remaining: int, batchExpiresAt: int, cutoff: int): bool =
  remaining > 0 implies not(batchPastRetention(remaining, batchExpiresAt, cutoff))
```
