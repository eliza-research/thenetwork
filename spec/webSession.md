# App-bound web sessions

The [auth model](models/auth_edge.md) covers the browser, phone proof, account binding, and signed requests. This module owns session timing and authentication decisions. The platform creates the token and looks up, hashes, revokes, and stores it.

## Story: Stay signed in to the app where I proved my phone

> As a member, I want the session on this app to stay usable during routine renewal and to end at its expiry.

### A session has an absolute limit from sign-in

A session lasts at most thirty days. Rotation preserves the sign-in time. The whole chain lasts at most ninety days. A Cloud session also ends by its proof deadline. Store the earliest applicable deadline.

```quint
pure val sessionTtlMs: int = 30 * 24 * 3600000
pure val sessionRotateMs: int = 24 * 3600000
pure val sessionMaxMs: int = 90 * 24 * 3600000
pure val sessionGraceMs: int = 60000
pure val sessionStepUpMs: int = 10 * 60000

pure def sessionDeadline(createdAt: int, startedAt: int, ttl: int, maxAge: int, limited: bool, expiresBefore: int): int = {
  val untilTtl = createdAt + ttl
  val untilMax = startedAt + maxAge
  val local = if (untilTtl < untilMax) untilTtl else untilMax
  if (limited and expiresBefore < local) expiresBefore else local
}

pure def lawCloudDeadlineCapsSession(createdAt: int, startedAt: int, ttl: int, maxAge: int, expiresBefore: int): bool =
  sessionDeadline(createdAt, startedAt, ttl, maxAge, true, expiresBefore) <= expiresBefore
```

### Only a live token on the requested app can authenticate

A token must be present and at most 128 characters. A missing row, another app's row, or a row at or past expiry or revocation is refused. A current ban of the session's phone or person also refuses the row, even when staff banned the person after the session started. The shell reads the ban at each use of the token. When rotation is requested, a token with no pending revocation rotates at one day by default. A token in the grace period still works without another rotation. The shell schedules old-token revocation for one minute later and persists the replacement before returning it. The revocation and the replacement are one write under the phone's binding lock, and that write reads the old row again first: a row that is gone, expired or already revoked as of now refuses the token, and a row that another request rotated in the meantime stays usable without a second replacement. Changed on 2026-11-21 (audit AE-6): the replacement was written without a re-read, so a request in flight during "delete everything" could create a session for the erased number.

```quint
type SessionPhase = Beginning | LookingUp | Refused | Usable | RevokingOld | IssuingReplacement | Rotated
type SessionFlow = { phase: SessionPhase, revokeAt: int }

pure val initial: SessionFlow = { phase: Beginning, revokeAt: 0 }

pure def canReadToken(flow: SessionFlow): bool = flow.phase == Beginning
pure def readToken(flow: SessionFlow, tokenPresent: bool, tokenLength: int): SessionFlow =
  { ...flow, phase: if (tokenPresent and tokenLength <= 128) LookingUp else Refused }

pure def canReadRow(flow: SessionFlow): bool = flow.phase == LookingUp
pure def readRow(flow: SessionFlow, sameAppRow: bool, expired: bool, hasRevocation: bool, revocationDue: bool, banned: bool,
  rotationRequested: bool, oldEnough: bool, at: int): SessionFlow =
  if (not(sameAppRow) or expired or revocationDue or banned) { ...flow, phase: Refused }
  else if (not(rotationRequested) or hasRevocation or not(oldEnough)) { ...flow, phase: Usable }
  else { phase: RevokingOld, revokeAt: at + sessionGraceMs }

pure def canRecordRevocation(flow: SessionFlow): bool = flow.phase == RevokingOld
pure def recordRevocation(flow: SessionFlow, rowLive: bool, rotatedMeanwhile: bool): SessionFlow =
  if (not(rowLive)) { ...flow, phase: Refused }
  else if (rotatedMeanwhile) { ...flow, phase: Usable }
  else { ...flow, phase: IssuingReplacement }

pure def canRecordReplacement(flow: SessionFlow): bool = flow.phase == IssuingReplacement
pure def recordReplacement(flow: SessionFlow): SessionFlow = { ...flow, phase: Rotated }

pure def stepRotationRequiresAReplacement(before: SessionFlow, via: str, after: SessionFlow): bool =
  after.phase == Rotated implies (before.phase == IssuingReplacement and via == "recordReplacement")

pure def sometimesRotates(flow: SessionFlow): bool = flow.phase == Rotated

pure def lawErasedRowIssuesNoReplacement(rotatedMeanwhile: bool, revokeAt: int): bool =
  recordRevocation({ phase: RevokingOld, revokeAt: revokeAt }, false, rotatedMeanwhile).phase == Refused

pure def lawBannedSessionIsRefused(sameAppRow: bool, expired: bool, hasRevocation: bool, revocationDue: bool,
  rotationRequested: bool, oldEnough: bool, at: int): bool =
  readRow({ phase: LookingUp, revokeAt: 0 }, sameAppRow, expired, hasRevocation, revocationDue, true,
    rotationRequested, oldEnough, at).phase == Refused
```

### Sensitive account changes require a fresh sign-in

The session sign-in must be no more than ten minutes old. Rotation keeps that original sign-in time.

```quint
pure def freshSignIn(elapsed: int): bool = elapsed <= sessionStepUpMs
```

## Story: Keep an earlier holder's sign-in away from my new account

> As a person who got a number that someone else used before, I want an earlier sign-in on that number to have no access to the account I create.

### A session without a person never outlives its number getting a person

A session that proved a number before the number had a person has no person. A number gets a person by a join on any app (web, text or connector), by a staff or member invitation, or by a number change that moves a person to it. At that moment, in the same transaction, a session of the number without a person that proved the number after that moment takes the person: that is the joining session, or a sign-in that finished while the person arrived. Every other session of the number without a person ends, because the shell cannot tell whether an earlier holder of a recycled number proved it. A rotation copies the person of the row it re-reads. A person-bound session never changes person. New rule on 2026-11-21 (audit AE-3): before, every session of the number without a person took the new person at admission. Changed again on 2026-11-21 (review of AE-3): the rule first covered only a membership admission, so a number change or an invitation left an earlier holder's session live on the person's number.

```quint
pure def unboundSessionTakesNewPerson(numberHasPerson: bool, provedSinceArrival: bool): bool =
  numberHasPerson and provedSinceArrival

pure def unboundSessionEnds(numberHasPerson: bool, provedSinceArrival: bool): bool =
  numberHasPerson and not(provedSinceArrival)

pure def lawNoUnboundSessionBesideAPerson(numberHasPerson: bool, provedSinceArrival: bool): bool =
  (numberHasPerson implies (unboundSessionTakesNewPerson(numberHasPerson, provedSinceArrival) != unboundSessionEnds(numberHasPerson, provedSinceArrival)))
    and (not(numberHasPerson) implies not(unboundSessionTakesNewPerson(numberHasPerson, provedSinceArrival) or unboundSessionEnds(numberHasPerson, provedSinceArrival)))
```
