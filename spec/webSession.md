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

A token must be present and at most 128 characters. A missing row, another app's row, or a row at or past expiry or revocation is refused. A live row waits for admission. When admission chooses rotation, the shell schedules the old token to end one minute later and persists the replacement before returning it. A rotated session exists only after that replacement is recorded.

```quint
type SessionPhase = Beginning | LookingUp | Refused | CheckingAdmission | Usable | RevokingOld | IssuingReplacement | Rotated | RevokingBanned
type SessionFlow = { phase: SessionPhase, revokeAt: int }

pure val initial: SessionFlow = { phase: Beginning, revokeAt: 0 }

pure def canReadToken(flow: SessionFlow): bool = flow.phase == Beginning
pure def readToken(flow: SessionFlow, tokenPresent: bool, tokenLength: int): SessionFlow =
  { ...flow, phase: if (tokenPresent and tokenLength <= 128) LookingUp else Refused }

pure def canReadRow(flow: SessionFlow): bool = flow.phase == LookingUp
pure def readRow(flow: SessionFlow, sameAppRow: bool, expired: bool, revocationDue: bool): SessionFlow =
  { ...flow, phase: if (not(sameAppRow) or expired or revocationDue) Refused else CheckingAdmission }

pure def canRecordRevocation(flow: SessionFlow): bool = flow.phase == RevokingOld
pure def recordRevocation(flow: SessionFlow): SessionFlow = { ...flow, phase: IssuingReplacement }

pure def canRecordReplacement(flow: SessionFlow): bool = flow.phase == IssuingReplacement
pure def recordReplacement(flow: SessionFlow): SessionFlow = { ...flow, phase: Rotated }

pure def stepRotationRequiresAReplacement(before: SessionFlow, via: str, after: SessionFlow): bool =
  after.phase == Rotated implies (before.phase == IssuingReplacement and via == "recordReplacement")

pure def sometimesRotates(flow: SessionFlow): bool = flow.phase == Rotated
```

## Story: A staff ban ends a cookie I already hold

> As a person who was banned, I want a cookie that was already issued to stop on the next request, including a cookie the ban-time cleanup did not revoke.

### A banned phone or person is not admitted

Every authentication checks the ban after the row is live and before the cookie is used or rotated. The shell supplies that fact for a phone-scope ban and for a person-scope ban. A ban revokes the cookie at that moment and does not issue a replacement. A cookie the eager cleanup missed is still refused here. A cookie that is not banned keeps the previous rotation rules: rotate after a day when rotation is requested, keep a cookie that already has a pending revocation, and keep a cookie that is not yet old enough.

```quint
pure def canAdmit(flow: SessionFlow): bool = flow.phase == CheckingAdmission
pure def admit(flow: SessionFlow, banned: bool, rotationRequested: bool, hasRevocation: bool, oldEnough: bool, at: int): SessionFlow =
  if (banned) { phase: RevokingBanned, revokeAt: at }
  else if (not(rotationRequested) or hasRevocation or not(oldEnough)) { ...flow, phase: Usable }
  else { phase: RevokingOld, revokeAt: at + sessionGraceMs }

pure def canRecordBanRevocation(flow: SessionFlow): bool = flow.phase == RevokingBanned
pure def recordBanRevocation(flow: SessionFlow): SessionFlow = { ...flow, phase: Refused }

pure def lawABanNeverAdmits(banned: bool, rotationRequested: bool, hasRevocation: bool, oldEnough: bool, at: int): bool =
  banned implies (admit({ phase: CheckingAdmission, revokeAt: 0 }, banned, rotationRequested, hasRevocation, oldEnough, at).phase == RevokingBanned)

pure def lawOnlyABanRevokesAtAdmission(banned: bool, rotationRequested: bool, hasRevocation: bool, oldEnough: bool, at: int): bool =
  (admit({ phase: CheckingAdmission, revokeAt: 0 }, banned, rotationRequested, hasRevocation, oldEnough, at).phase == RevokingBanned) implies banned

pure def lawABanRevokesImmediately(at: int): bool =
  admit({ phase: CheckingAdmission, revokeAt: 0 }, true, false, false, false, at).revokeAt == at

pure def lawBanRevocationDoesNotReplaceTheCookie(at: int): bool =
  recordBanRevocation({ phase: RevokingBanned, revokeAt: at }).phase == Refused

pure def lawAFreshCookieStaysUsable(at: int): bool =
  admit({ phase: CheckingAdmission, revokeAt: 0 }, false, true, false, false, at).phase == Usable

pure def lawAnOldCookieRotates(at: int): bool =
  admit({ phase: CheckingAdmission, revokeAt: 0 }, false, true, false, true, at).phase == RevokingOld and
    admit({ phase: CheckingAdmission, revokeAt: 0 }, false, true, false, true, at).revokeAt == at + sessionGraceMs

pure def stepABannedCookieIsNotRotated(before: SessionFlow, via: str, after: SessionFlow): bool =
  before.phase == RevokingBanned implies
    ((via == "recordBanRevocation" and after.phase == Refused) or
      (not(via == "recordBanRevocation") and after.phase == before.phase))

pure def sometimesRefusesABannedCookie(flow: SessionFlow): bool = flow.phase == RevokingBanned
```

### Sensitive account changes require a fresh sign-in

The session sign-in must be no more than ten minutes old. Rotation keeps that original sign-in time.

```quint
pure def freshSignIn(elapsed: int): bool = elapsed <= sessionStepUpMs
```
