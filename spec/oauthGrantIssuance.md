# Issue an approved connector grant

The consent endpoint identifies an authenticated member, the registered app and client, the approved scopes, and the pending request. The [VibeLang issuance shell](../packages/core/src/vibe/oauthGrantIssuanceShell.vibe) orders the effects after the member approves. The MCP handler supplies the clock, credentials and atomic store operation and builds the response.

## Story: Connect my agent after I approve access

> As a member, I want my current consent to authorize one connector grant for the intended account and app.

### An expired request cannot begin issuance

The pending approval must still be live when issuance starts. A request expires at its deadline. An expired request gets the existing retry-from-the-agent response.

```quint
type IssuancePhase = StartApproval | AwaitingAuthority | RetryAuthority | DeniedAuthority | ExpiredApproval | AwaitingApproval | AwaitingCommit | RetryIssuance | GrantIssued
type AuthorityResult = AuthorityValid | AuthorityInvalid | AuthorityUnavailable
type Issuance = {
  phase: IssuancePhase, authorityAccepted: bool, sameOwner: bool, requestLive: bool, grantLive: bool,
}
pure val initial: Issuance = {
  phase: StartApproval, authorityAccepted: false, sameOwner: false, requestLive: false, grantLive: false,
}

pure def requestIsLive(asOf: int, expiresAt: int): bool = asOf < expiresAt

pure def canBeginApproval(issuance: Issuance): bool = issuance.phase == StartApproval
pure def beginApproval(issuance: Issuance, requestLive: bool): Issuance =
  { ...issuance, phase: if (requestLive) AwaitingAuthority else ExpiredApproval, requestLive: requestLive }

pure def lawDeadlineExcludesExpiry(expiresAt: int): bool = not(requestIsLive(expiresAt, expiresAt))
```

### Authority is checked before the consent request is locked

An unavailable authority check returns a retryable response while leaving the request unconsumed. An invalid authority check refuses the connection. A current phone or person ban makes local authority invalid. Check that authority at approval. The [token rules](oauthTokenLifecycle.md) check it again at authorization code exchange, at refresh, and at every use of an access token. Only valid authority can proceed to the store operation.

```quint
pure def canCheckGrantAuthority(issuance: Issuance): bool =
  issuance.phase == AwaitingAuthority and issuance.requestLive

pure def checkGrantAuthority(issuance: Issuance, authority: AuthorityResult): Issuance =
  { ...issuance, authorityAccepted: authority == AuthorityValid,
    phase: if (authority == AuthorityValid) AwaitingApproval
           else if (authority == AuthorityUnavailable) RetryAuthority
           else DeniedAuthority }
```

### Locked approval must still match the owner and both deadlines

The store locks one pending, phone-verified approval. The locked request must be for the same verified phone and person. Recheck the request and proposed grant deadlines after acquiring the lock. A missing, changed or expired request issues no grant.

```quint
type LockedApproval = { ownerMatches: bool, lockedRequestLive: bool, pendingGrantLive: bool }
pure val eligibleApproval: LockedApproval = { ownerMatches: true, lockedRequestLive: true, pendingGrantLive: true }
pure val approvalValues = Set(
  eligibleApproval, { ...eligibleApproval, ownerMatches: false },
  { ...eligibleApproval, lockedRequestLive: false }, { ...eligibleApproval, pendingGrantLive: false },
)

pure def canCheckLockedApproval(issuance: Issuance): bool =
  issuance.phase == AwaitingApproval and issuance.authorityAccepted and issuance.requestLive

pure def checkLockedApproval(issuance: Issuance, approval: LockedApproval): Issuance =
  val eligible = approval.ownerMatches and approval.lockedRequestLive and approval.pendingGrantLive
  { ...issuance, sameOwner: approval.ownerMatches, requestLive: approval.lockedRequestLive,
    grantLive: approval.pendingGrantLive, phase: if (eligible) AwaitingCommit else ExpiredApproval }
```

### A successful response follows one atomic commit

Commit approval consumption, the grant, the authorization code and both audit rows as one operation. If a write fails, roll back all changes and return the existing retryable consent response. A competing approval or erasure can leave no request to issue. Start the assistant-linked notification and return a successful redirect only after the commit.

```quint
pure def canRecordCommit(issuance: Issuance, committed: bool): bool =
  issuance.phase == AwaitingCommit or
    (not(committed) and (issuance.phase == AwaitingApproval or issuance.phase == ExpiredApproval))

pure def recordCommit(issuance: Issuance, committed: bool): Issuance =
  { ...issuance, phase: if (committed) GrantIssued else ExpiredApproval }

pure def canRecordStorageFailure(issuance: Issuance): bool =
  issuance.phase == AwaitingApproval or issuance.phase == AwaitingCommit or issuance.phase == ExpiredApproval

pure def recordStorageFailure(issuance: Issuance): Issuance = { ...issuance, phase: RetryIssuance }

pure def stepIssuanceFollowsCommit(before: Issuance, via: str, after: Issuance): bool =
  after.phase == GrantIssued implies (before.phase == AwaitingCommit and via == "recordCommit")

pure def sometimesRetriesIssuance(issuance: Issuance): bool = issuance.phase == RetryIssuance
```

### An issued grant had current authority, owner and deadlines

A grant can be written and returned only after the authority check and the locked owner and deadline checks. Authority outages and denials cannot enter the persistence step.

```quint
pure def alwaysIssuanceRequiresCurrentApproval(issuance: Issuance): bool =
  (issuance.phase == AwaitingCommit or issuance.phase == GrantIssued) implies
    (issuance.authorityAccepted and issuance.sameOwner and issuance.requestLive and issuance.grantLive)

pure def sometimesIssuesGrant(issuance: Issuance): bool = issuance.phase == GrantIssued
pure def sometimesRetriesAuthority(issuance: Issuance): bool = issuance.phase == RetryAuthority
pure def sometimesDeniesAuthority(issuance: Issuance): bool = issuance.phase == DeniedAuthority
pure def sometimesExpiresApproval(issuance: Issuance): bool = issuance.phase == ExpiredApproval
```
