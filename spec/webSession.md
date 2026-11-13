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

A token must be present and at most 128 characters. A missing row, another app's row, or a row at or past expiry or revocation is refused. When rotation is requested, a token with no pending revocation rotates at one day by default. A token in the grace period still works without another rotation. The shell schedules old-token revocation for one minute later and persists the replacement before returning it.

```quint
type SessionPhase = Beginning | LookingUp | Refused | Usable | RevokingOld | IssuingReplacement | Rotated
type SessionFlow = { phase: SessionPhase, revokeAt: int }

pure val initial: SessionFlow = { phase: Beginning, revokeAt: 0 }

pure def canReadToken(flow: SessionFlow): bool = flow.phase == Beginning
pure def readToken(flow: SessionFlow, tokenPresent: bool, tokenLength: int): SessionFlow =
  { ...flow, phase: if (tokenPresent and tokenLength <= 128) LookingUp else Refused }

pure def canReadRow(flow: SessionFlow): bool = flow.phase == LookingUp
pure def readRow(flow: SessionFlow, sameAppRow: bool, expired: bool, hasRevocation: bool, revocationDue: bool,
  rotationRequested: bool, oldEnough: bool, at: int): SessionFlow =
  if (not(sameAppRow) or expired or revocationDue) { ...flow, phase: Refused }
  else if (not(rotationRequested) or hasRevocation or not(oldEnough)) { ...flow, phase: Usable }
  else { phase: RevokingOld, revokeAt: at + sessionGraceMs }

pure def canRecordRevocation(flow: SessionFlow): bool = flow.phase == RevokingOld
pure def recordRevocation(flow: SessionFlow): SessionFlow = { ...flow, phase: IssuingReplacement }

pure def canRecordReplacement(flow: SessionFlow): bool = flow.phase == IssuingReplacement
pure def recordReplacement(flow: SessionFlow): SessionFlow = { ...flow, phase: Rotated }

pure def stepRotationRequiresAReplacement(before: SessionFlow, via: str, after: SessionFlow): bool =
  after.phase == Rotated implies (before.phase == IssuingReplacement and via == "recordReplacement")

pure def sometimesRotates(flow: SessionFlow): bool = flow.phase == Rotated
```

### Sensitive account changes require a fresh sign-in

The session sign-in must be no more than ten minutes old. Rotation keeps that original sign-in time.

```quint
pure def freshSignIn(elapsed: int): bool = elapsed <= sessionStepUpMs
```
