# Connector token exchange and renewal

The [connector grant spec](oauthGrantIssuance.md) owns the user approval that precedes this flow. The [imported connector model](models/oauth_mcp.md) covers the wider authorization server. Parsing, client authentication, proof validation, storage, and audit remain in the handler and store.

## Story: Use and renew an approved connector grant

> As a member, I want the approved connector to use its consented access, renew within that consent, and lose access when I revoke it.

### Each token request must match its own credential binding

An authorization code must belong to the client and still be live. An already used code for that client revokes the grant. A first exchange also needs the original redirect, verifier, and resource. A refresh token must belong to that client, be a refresh token, be unrevoked, and still be live.

```quint
type TokenPhase = Beginning | CheckingCodeBinding | CheckingGrant | CheckingAuthority | CheckingRefreshBinding |
  AwaitingConsumption | AwaitingTokenWrite | AwaitingRotation | TokensReady | RevokeGrant | Refused | RetryAuthority
type TokenReason = NoReason | InvalidGrant | CodeExpired | RedirectMismatch | VerifierMismatch | InvalidScope | InvalidTarget
type TokenFlow = { phase: TokenPhase, reason: TokenReason, refresh: bool }

pure val initial: TokenFlow = { phase: Beginning, reason: NoReason, refresh: false }

pure def refuse(flow: TokenFlow, reason: TokenReason): TokenFlow = { ...flow, phase: Refused, reason: reason }

pure def canReadCode(flow: TokenFlow): bool = flow.phase == Beginning
pure def readCode(flow: TokenFlow, clientMatches: bool, used: bool, live: bool): TokenFlow =
  if (not(clientMatches)) refuse(flow, InvalidGrant)
  else if (used) { ...flow, phase: RevokeGrant }
  else if (not(live)) refuse(flow, CodeExpired)
  else { ...flow, phase: CheckingCodeBinding }

pure def canReadCodeBinding(flow: TokenFlow): bool = flow.phase == CheckingCodeBinding
pure def readCodeBinding(flow: TokenFlow, redirectMatches: bool, verifierMatches: bool, resourceMatches: bool): TokenFlow =
  if (not(redirectMatches)) refuse(flow, RedirectMismatch)
  else if (not(verifierMatches)) refuse(flow, VerifierMismatch)
  else if (not(resourceMatches)) refuse(flow, InvalidTarget)
  else { ...flow, phase: CheckingGrant }

pure def canReadRefresh(flow: TokenFlow): bool = flow.phase == Beginning
pure def readRefresh(flow: TokenFlow, refreshMatches: bool): TokenFlow =
  if (refreshMatches) { ...flow, phase: CheckingGrant, refresh: true } else refuse(flow, InvalidGrant)
```

### The request needs current grant authority and must stay within its consent

Use a live grant for an eligible member. Check the current authority. A current ban of the grant's phone or person makes the authority invalid, also for a grant issued before the ban. An expired credential is refused before an unavailable authority is reported as temporary. Only a current authority advances the request. Refresh allows the same or a narrower set of scopes and keeps the original resource. Check both deadlines again before using the credential in the store.

```quint
type TokenAuthority = Current | Invalid | Unavailable

pure def canReadGrant(flow: TokenFlow): bool = flow.phase == CheckingGrant
pure def readGrant(flow: TokenFlow, grantLive: bool, eligible: bool): TokenFlow =
  if (grantLive and eligible) { ...flow, phase: CheckingAuthority } else refuse(flow, InvalidGrant)

pure def canReadAuthority(flow: TokenFlow): bool = flow.phase == CheckingAuthority
pure def readAuthority(flow: TokenFlow, credentialLive: bool, authority: TokenAuthority): TokenFlow =
  if (not(credentialLive)) refuse(flow, InvalidGrant)
  else if (authority == Unavailable) { ...flow, phase: RetryAuthority }
  else if (authority == Invalid) refuse(flow, InvalidGrant)
  else { ...flow, phase: if (flow.refresh) CheckingRefreshBinding else AwaitingConsumption }

pure def canReadRefreshBinding(flow: TokenFlow): bool = flow.phase == CheckingRefreshBinding
pure def readRefreshBinding(flow: TokenFlow, scopeAllowed: bool, resourceMatches: bool, bothLive: bool): TokenFlow =
  if (not(scopeAllowed)) refuse(flow, InvalidScope)
  else if (not(resourceMatches)) refuse(flow, InvalidTarget)
  else if (not(bothLive)) refuse(flow, InvalidGrant)
  else { ...flow, phase: AwaitingRotation }

pure def codeCanBeConsumed(flow: TokenFlow, bothLive: bool): bool = flow.phase == AwaitingConsumption and bothLive
```

### Token issuance requires consumption or rotation in storage

After the store consumes the code, a previous use revokes the grant. Otherwise, both deadlines must still be in the future before writing the token pair. A refresh must rotate the stored token and persist a replacement pair atomically. The existing failed-rotation handling revokes the grant. The endpoint returns tokens only after the write or rotation completes.

```quint
type CodeConsumption = NoCode | PreviousUse | CodeConsumed

pure def canReadConsumption(flow: TokenFlow): bool = flow.phase == AwaitingConsumption
pure def readConsumption(flow: TokenFlow, consumption: CodeConsumption, bothLive: bool): TokenFlow =
  if (consumption == PreviousUse) { ...flow, phase: RevokeGrant }
  else if (consumption != CodeConsumed or not(bothLive)) refuse(flow, InvalidGrant)
  else { ...flow, phase: AwaitingTokenWrite }

pure def canRecordTokens(flow: TokenFlow): bool = flow.phase == AwaitingTokenWrite
pure def recordTokens(flow: TokenFlow): TokenFlow = { ...flow, phase: TokensReady }

pure def canRecordRotation(flow: TokenFlow): bool = flow.phase == AwaitingRotation
pure def recordRotation(flow: TokenFlow, succeeded: bool): TokenFlow =
  { ...flow, phase: if (succeeded) TokensReady else RevokeGrant }

pure def stepTokensRequireStorage(before: TokenFlow, via: str, after: TokenFlow): bool =
  after.phase == TokensReady implies
    ((via == "recordTokens" and before.phase == AwaitingTokenWrite) or (via == "recordRotation" and before.phase == AwaitingRotation))

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
