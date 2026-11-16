# Issue an approved connector grant

The consent endpoint identifies an authenticated member, the registered app and client, the approved scopes, and the pending request. The [VibeLang issuance shell](../packages/core/src/vibe/oauthGrantIssuanceShell.vibe) orders the effects after the member approves. The MCP handler supplies the clock, credentials, storage and audit operations and builds the response.

## Story: Connect my agent after I approve access

> As a member, I want my current consent to authorize one connector grant for the intended account and app.

### An expired request cannot begin issuance

The pending approval must still be live when issuance starts. A request expires at its deadline. An expired request gets the existing retry-from-the-agent response.

```quint
type IssuancePhase = StartApproval | AwaitingAuthority | RetryAuthority | DeniedAuthority | ExpiredApproval | AwaitingConsumption | AwaitingPersistence | AwaitingCode | AwaitingAudit | GrantIssued
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

### Authority is checked before the consent request is consumed

An unavailable authority check returns a retryable response while leaving the request unconsumed. An invalid authority check refuses the connection. Only valid authority can proceed to the single-use request operation.

```quint
pure def canCheckGrantAuthority(issuance: Issuance): bool =
  issuance.phase == AwaitingAuthority and issuance.requestLive

pure def checkGrantAuthority(issuance: Issuance, authority: AuthorityResult): Issuance =
  { ...issuance, authorityAccepted: authority == AuthorityValid,
    phase: if (authority == AuthorityValid) AwaitingConsumption
           else if (authority == AuthorityUnavailable) RetryAuthority
           else DeniedAuthority }
```

### Consumed approval must still match the owner and both deadlines

The store consumes the request once. The returned request must be for the same verified phone and person. Recheck the returned request's expiry and the proposed grant's expiry after consumption. An unavailable, changed or expired request issues no grant.

```quint
type ConsumedApproval = { ownerMatches: bool, consumedRequestLive: bool, pendingGrantLive: bool }
pure val validConsumption: ConsumedApproval = { ownerMatches: true, consumedRequestLive: true, pendingGrantLive: true }
pure val consumptionValues = Set(
  validConsumption, { ...validConsumption, ownerMatches: false },
  { ...validConsumption, consumedRequestLive: false }, { ...validConsumption, pendingGrantLive: false },
)

pure def canCheckConsumption(issuance: Issuance): bool =
  issuance.phase == AwaitingConsumption and issuance.authorityAccepted and issuance.requestLive

pure def checkConsumption(issuance: Issuance, consumption: ConsumedApproval): Issuance =
  val eligible = consumption.ownerMatches and consumption.consumedRequestLive and consumption.pendingGrantLive
  { ...issuance, sameOwner: consumption.ownerMatches, requestLive: consumption.consumedRequestLive,
    grantLive: consumption.pendingGrantLive, phase: if (eligible) AwaitingPersistence else ExpiredApproval }
```

### A successful response follows the grant, code and audit writes

Store the grant before the authorization code. Record the issuance audit after both writes. Return a success redirect only after those operations complete. The endpoint reports an error if an operation fails. The store's successful earlier writes can remain after a later failure.

```quint
pure def canRecordGrant(issuance: Issuance): bool =
  issuance.phase == AwaitingPersistence and issuance.authorityAccepted and issuance.sameOwner and
    issuance.requestLive and issuance.grantLive

pure def recordGrant(issuance: Issuance): Issuance = { ...issuance, phase: AwaitingCode }

pure def canRecordCode(issuance: Issuance): bool = issuance.phase == AwaitingCode
pure def recordCode(issuance: Issuance): Issuance = { ...issuance, phase: AwaitingAudit }

pure def canRecordIssuance(issuance: Issuance): bool = issuance.phase == AwaitingAudit
pure def recordIssuance(issuance: Issuance): Issuance = { ...issuance, phase: GrantIssued }

pure def stepIssuanceFollowsAudit(before: Issuance, via: str, after: Issuance): bool =
  after.phase == GrantIssued implies (before.phase == AwaitingAudit and via == "recordIssuance")
```

### An issued grant had current authority, owner and deadlines

A grant can be written and returned only after the authority check and the post-consumption owner and deadline checks. Authority outages and denials cannot enter the persistence step.

```quint
pure def alwaysIssuanceRequiresCurrentApproval(issuance: Issuance): bool =
  (issuance.phase == AwaitingPersistence or issuance.phase == AwaitingCode or
    issuance.phase == AwaitingAudit or issuance.phase == GrantIssued) implies
    (issuance.authorityAccepted and issuance.sameOwner and issuance.requestLive and issuance.grantLive)

pure def sometimesIssuesGrant(issuance: Issuance): bool = issuance.phase == GrantIssued
pure def sometimesRetriesAuthority(issuance: Issuance): bool = issuance.phase == RetryAuthority
pure def sometimesDeniesAuthority(issuance: Issuance): bool = issuance.phase == DeniedAuthority
pure def sometimesExpiresApproval(issuance: Issuance): bool = issuance.phase == ExpiredApproval
```
