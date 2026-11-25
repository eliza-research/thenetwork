# Connector token exchange and renewal

The [connector grant spec](oauthGrantIssuance.md) owns the user approval that precedes this flow. The [imported connector model](models/oauth_mcp.md) covers the wider authorization server. Parsing, client authentication, proof validation, storage, and audit remain in the handler and store.

## Story: Use and renew an approved connector grant

> As a member, I want the approved connector to use its consented access, renew within that consent, and lose access when I revoke it.

### Each token request must match its own credential binding

An authorization code must belong to the client and still be live. An already used code for that client revokes the grant. A first exchange also needs the original redirect, verifier, and resource. A refresh token must belong to that client, be a refresh token, be unrevoked, and still be live.

```quint
type TokenPhase = Beginning | CheckingCodeBinding | CheckingGrant | CheckingAuthority | CheckingRefreshBinding |
  AwaitingConsumption | AwaitingRotation | TokensReady | RevokeGrant | Refused | RetryAuthority
type TokenReason = NoReason | InvalidGrant | CodeExpired | RedirectMismatch | VerifierMismatch | InvalidScope | InvalidTarget
type TokenFlow = { phase: TokenPhase, reason: TokenReason, refresh: bool }

pure val initial: TokenFlow = { phase: Beginning, reason: NoReason, refresh: false }

pure def refuse(reason: TokenReason, flow: TokenFlow): TokenFlow = { ...flow, phase: Refused, reason: reason }

pure def canReadCode(flow: TokenFlow): bool = flow.phase == Beginning
pure def readCode(flow: TokenFlow, clientMatches: bool, used: bool, live: bool): TokenFlow =
  if (not(clientMatches)) refuse(InvalidGrant, flow)
  else if (used) { ...flow, phase: RevokeGrant }
  else if (not(live)) refuse(CodeExpired, flow)
  else { ...flow, phase: CheckingCodeBinding }

pure def canReadCodeBinding(flow: TokenFlow): bool = flow.phase == CheckingCodeBinding
pure def readCodeBinding(flow: TokenFlow, redirectMatches: bool, verifierMatches: bool, resourceMatches: bool): TokenFlow =
  if (not(redirectMatches)) refuse(RedirectMismatch, flow)
  else if (not(verifierMatches)) refuse(VerifierMismatch, flow)
  else if (not(resourceMatches)) refuse(InvalidTarget, flow)
  else { ...flow, phase: CheckingGrant }

pure def canReadRefresh(flow: TokenFlow): bool = flow.phase == Beginning
pure def readRefresh(flow: TokenFlow, refreshMatches: bool): TokenFlow =
  if (refreshMatches) { ...flow, phase: CheckingGrant, refresh: true } else refuse(InvalidGrant, flow)
```

### The request needs current grant authority and must stay within its consent

Use a live grant. Check the current authority. A current ban of the grant's phone or person makes the authority invalid, also for a grant issued before the ban. An expired credential is refused before an unavailable authority is reported as temporary. Only a current authority advances the request. Refresh allows the same or a narrower set of scopes and keeps the original resource. Check both deadlines again before using the credential in the store. Each use of an access token makes the same check: an expired token or grant is invalid, and otherwise the current authority decides. The owner decision of 2026-11-22 (D19) removed the slop.date ChatGPT allowlist, so the separate eligibility input of this check is gone and every connector uses the same live grant and current authority.

```quint
type TokenAuthority = Current | Invalid | Unavailable

pure def accessTokenAuthority(credentialLive: bool, authority: TokenAuthority): TokenAuthority =
  if (not(credentialLive)) Invalid else authority

pure def lawExpiredAccessTokenIsInvalid(authority: TokenAuthority): bool =
  accessTokenAuthority(false, authority) == Invalid

pure def lawBannedAccessTokenIsInvalid(credentialLive: bool): bool =
  accessTokenAuthority(credentialLive, Invalid) == Invalid

pure def canReadGrant(flow: TokenFlow): bool = flow.phase == CheckingGrant
pure def readGrant(flow: TokenFlow, grantLive: bool): TokenFlow =
  if (grantLive) { ...flow, phase: CheckingAuthority } else refuse(InvalidGrant, flow)

pure def canReadAuthority(flow: TokenFlow): bool = flow.phase == CheckingAuthority
pure def readAuthority(flow: TokenFlow, credentialLive: bool, authority: TokenAuthority): TokenFlow =
  if (not(credentialLive)) refuse(InvalidGrant, flow)
  else if (authority == Unavailable) { ...flow, phase: RetryAuthority }
  else if (authority == Invalid) refuse(InvalidGrant, flow)
  else { ...flow, phase: if (flow.refresh) CheckingRefreshBinding else AwaitingConsumption }

pure def canReadRefreshBinding(flow: TokenFlow): bool = flow.phase == CheckingRefreshBinding
pure def readRefreshBinding(flow: TokenFlow, scopeAllowed: bool, resourceMatches: bool, bothLive: bool): TokenFlow =
  if (not(scopeAllowed)) refuse(InvalidScope, flow)
  else if (not(resourceMatches)) refuse(InvalidTarget, flow)
  else if (not(bothLive)) refuse(InvalidGrant, flow)
  else { ...flow, phase: AwaitingRotation }

pure def codeCanBeConsumed(flow: TokenFlow, bothLive: bool): bool = flow.phase == AwaitingConsumption and bothLive
```

### Token issuance requires consumption or rotation in storage

An authorization-code exchange locks the exact grant and the code it authorized. The grant must still be unrevoked and both deadlines must be in the future. The code consumption, the access and refresh token hashes, and the issuance audit commit together. A previous use of the same code revokes the grant. An unavailable or expired code or grant leaves no token pair or issuance audit. Refresh locks the exact grant and its refresh credential, checks both deadlines after the wait, and commits the rotation, replacement pair and audit together. A verified reuse of a still-live refresh credential revokes its grant. A stale, expired or revoked credential cannot rotate and does not end another live grant. The endpoint returns tokens only after the exchange or rotation commits.

```quint
type CodeExchangeResult = CodeNotCommitted | CodeAlreadyUsed | CodePairCommitted

pure def codeExchangeMayCommit(grantExactAndUnrevoked: bool, codeExact: bool, codeUnused: bool,
    at: int, grantEndsAt: int, codeEndsAt: int): bool =
  grantExactAndUnrevoked and codeExact and codeUnused and at < grantEndsAt and at < codeEndsAt

pure def lawEndedGrantCannotCommitCode(codeExact: bool, codeUnused: bool, at: int, grantEndsAt: int, codeEndsAt: int): bool =
  not(codeExchangeMayCommit(false, codeExact, codeUnused, at, grantEndsAt, codeEndsAt))

pure def canReadCodeExchange(flow: TokenFlow): bool = flow.phase == AwaitingConsumption
pure def readCodeExchange(flow: TokenFlow, result: CodeExchangeResult): TokenFlow =
  if (result == CodeAlreadyUsed) { ...flow, phase: RevokeGrant }
  else if (result == CodePairCommitted) { ...flow, phase: TokensReady }
  else refuse(InvalidGrant, flow)

type RefreshRotationResult = RefreshNotCommitted | RefreshAlreadyUsed | RefreshPairCommitted

pure def refreshStoredAuthorityCurrent(grantExactAndUnrevoked: bool, refreshExactAndUnrevoked: bool,
    at: int, grantEndsAt: int, refreshEndsAt: int): bool =
  grantExactAndUnrevoked and refreshExactAndUnrevoked and at < grantEndsAt and at < refreshEndsAt

pure def lawExpiredRefreshCannotBeCommitted(grantExactAndUnrevoked: bool, refreshExactAndUnrevoked: bool,
    at: int, grantEndsAt: int, refreshEndsAt: int): bool =
  refreshEndsAt <= at implies not(refreshStoredAuthorityCurrent(grantExactAndUnrevoked, refreshExactAndUnrevoked, at, grantEndsAt, refreshEndsAt))

pure def canRecordRotation(flow: TokenFlow): bool = flow.phase == AwaitingRotation
pure def recordRotation(flow: TokenFlow, result: RefreshRotationResult): TokenFlow =
  if (result == RefreshAlreadyUsed) { ...flow, phase: RevokeGrant }
  else if (result == RefreshPairCommitted) { ...flow, phase: TokensReady }
  else refuse(InvalidGrant, flow)

pure def lawOnlyLiveRefreshReuseEndsGrant(flow: TokenFlow, result: RefreshRotationResult): bool =
  (recordRotation(flow, result).phase == RevokeGrant) iff result == RefreshAlreadyUsed

pure def stepTokensRequireStorage(before: TokenFlow, via: str, after: TokenFlow): bool =
  after.phase == TokensReady implies
    ((via == "readCodeExchange" and before.phase == AwaitingConsumption) or (via == "recordRotation" and before.phase == AwaitingRotation))

pure def sometimesCanIssue(flow: TokenFlow): bool = flow.phase == TokensReady and not(flow.refresh)
pure def sometimesCanRefresh(flow: TokenFlow): bool = flow.phase == TokensReady and flow.refresh
```

### Revocation affects credentials owned by the authenticated client

Revoke only the access token for an access request. For an owned refresh token, revoke its grant. An unknown or unowned token gives the same successful response without an effect.

```quint
type Revocation = NoChange | EndAccess | EndGrant

pure def tokenRevocation(clientOwns: bool, refresh: bool): Revocation =
  if (not(clientOwns)) NoChange else if (refresh) EndGrant else EndAccess
```
