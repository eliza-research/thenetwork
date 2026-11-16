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

An ordinary rate counter follows the platform cutoff. A STOP hint may
be sent only once per app and person over thirty days. Retain that
counter for thirty additional days past the platform cutoff so routine
cleanup cannot cause an early repeat.

```quint
pure val stopHintWindowMs: int = 2592000000
```
