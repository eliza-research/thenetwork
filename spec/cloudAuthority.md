# Cloud session and grant authority

The platform verifies existing Cloud authority when a site session or OAuth grant is used. The [standalone Cloud model](models/cloud_auth.md) also represents concurrent requests and storage changes. This module receives proof facts and the result of the authority check. It receives no cookie contents, phone numbers, keys, or tokens. The shell still authenticates the cookies, looks up the account, and calls Cloud.

## Story: Keep site access tied to current Cloud authority

> As a member, I want this site to recognize my current Cloud session and distinguish a temporary outage from a denied proof.

### The app's authority and proof choose how a site session is checked

An OTP app uses its local session. It refuses a Cloud token. A Cloud app requires a proof bound to this app and session, with a future expiry. Only a non-production Cloud app can reuse a current positive validation. Production asks Cloud every time.

```quint
type CheckPhase = AwaitingProof | AwaitingDelegation | AwaitingGrantOwner | AwaitingCloud | AuthorityValid | AuthorityInvalid | AuthorityUnavailable
type AuthorityCheck = { phase: CheckPhase, fromCache: bool }
pure val initial: AuthorityCheck = { phase: AwaitingProof, fromCache: false }

pure def localSessionAllowed(cloudToken: bool): bool = not(cloudToken)
pure def canUseLocalSession(check: AuthorityCheck): bool = check.phase == AwaitingProof
pure def useLocalSession(check: AuthorityCheck, cloudToken: bool): AuthorityCheck =
  { ...check, phase: if (localSessionAllowed(cloudToken)) AuthorityValid else AuthorityInvalid }

pure def canCheckSiteProof(check: AuthorityCheck): bool = check.phase == AwaitingProof
pure def checkSiteProof(check: AuthorityCheck, bindingValid: bool, proofLive: bool, productionCloud: bool, cacheLive: bool): AuthorityCheck =
  if (not(bindingValid) or not(proofLive)) { ...check, phase: AuthorityInvalid }
  else if (not(productionCloud) and cacheLive) { phase: AuthorityValid, fromCache: true }
  else { ...check, phase: AwaitingCloud }

pure def alwaysOnlyValidChecksUseCache(check: AuthorityCheck): bool = check.fromCache implies check.phase == AuthorityValid
```

### Only a positive live Cloud response updates the cache

When Cloud answers, recheck the proof expiry. A positive response to a live proof allows use and keeps the cache entry for that session (`cloudCacheKeeps`). A denial invalidates the proof. An unavailable authority produces a retryable result. Neither denial, unavailability nor an expired proof keeps a positive cache entry for that session: the shell removes it.

```quint
type CloudResponse = CloudAccepted | CloudDenied | CloudUnavailable

pure def canFinishCloudCheck(check: AuthorityCheck): bool = check.phase == AwaitingCloud
pure def finishCloudCheck(check: AuthorityCheck, answer: CloudResponse, proofLive: bool): AuthorityCheck =
  { ...check, phase: if (not(proofLive) or answer == CloudDenied) AuthorityInvalid
    else if (answer == CloudAccepted) AuthorityValid else AuthorityUnavailable }

pure def cloudCacheKeeps(answer: CloudResponse, proofLive: bool): bool = proofLive and answer == CloudAccepted

pure def lawDenialOrOutageDropsTheCache(answer: CloudResponse): bool =
  answer != CloudAccepted implies (not(cloudCacheKeeps(answer, true)) and not(cloudCacheKeeps(answer, false)))

pure def lawCachedAnswerAllowsUse(answer: CloudResponse, proofLive: bool): bool =
  cloudCacheKeeps(answer, proofLive) implies finishCloudCheck(initial, answer, proofLive).phase == AuthorityValid

pure def stepOnlyAnAuthorityResultFinishes(before: AuthorityCheck, via: str, after: AuthorityCheck): bool =
  (before.phase == AwaitingCloud and after.phase != AwaitingCloud) implies via == "finishCloudCheck"

pure def sometimesChecksCloud(check: AuthorityCheck): bool = check.phase == AwaitingCloud
pure def sometimesAcceptsAuthority(check: AuthorityCheck): bool = check.phase == AuthorityValid
pure def sometimesCloudIsUnavailable(check: AuthorityCheck): bool = check.phase == AuthorityUnavailable
```

## Story: Use a grant only for its bound identity

> As a member, I want the authorized client to retain access only while its Cloud proof and account authority are current.

### Grant validation checks envelope and owner before asking Cloud

Require production delegation, the expected grant envelope, a grant expiry that is still in the future, the sealed delegation bound to the same grant fields, and the expected phone. Validate the current owner and phone eligibility before asking Cloud: the grant's person, when it names one, must still own the phone, and the phone must not be held, banned or suppressed. An answer that arrives at or after the grant expiry cannot authorize use. When the site issues a grant authority, the resource must be the app's standard or OpenAI MCP resource on production Cloud, and the grant expires at the earlier of the site session expiry and the Cloud identity expiry.

```quint
pure def canCheckGrantEnvelope(check: AuthorityCheck): bool = check.phase == AwaitingProof
pure def checkGrantEnvelope(check: AuthorityCheck, envelopeValid: bool, grantLive: bool): AuthorityCheck =
  { ...check, phase: if (envelopeValid and grantLive) AwaitingDelegation else AuthorityInvalid }

pure def canCheckGrantDelegation(check: AuthorityCheck): bool = check.phase == AwaitingDelegation
pure def checkGrantDelegation(check: AuthorityCheck, delegationBound: bool): AuthorityCheck =
  { ...check, phase: if (delegationBound) AwaitingGrantOwner else AuthorityInvalid }

pure def canCheckGrantOwner(check: AuthorityCheck): bool = check.phase == AwaitingGrantOwner
pure def checkGrantOwner(check: AuthorityCheck, ownerCurrent: bool, phoneEligible: bool): AuthorityCheck =
  { ...check, phase: if (ownerCurrent and phoneEligible) AwaitingCloud else AuthorityInvalid }

pure def grantResourceMatches(productionCloud: bool, resource: str, standardMcp: str, openAiMcp: str): bool =
  productionCloud and (resource == standardMcp or resource == openAiMcp)

pure def grantExpiresAt(sessionExpiry: int, identityExpiry: int): int =
  if (sessionExpiry <= identityExpiry) sessionExpiry else identityExpiry

pure def lawGrantNeverOutlivesSessionOrIdentity(sessionExpiry: int, identityExpiry: int): bool =
  grantExpiresAt(sessionExpiry, identityExpiry) <= sessionExpiry and grantExpiresAt(sessionExpiry, identityExpiry) <= identityExpiry

pure def lawGrantResourceNeedsProductionCloud(resource: str, standardMcp: str, openAiMcp: str): bool =
  not(grantResourceMatches(false, resource, standardMcp, openAiMcp))

pure def lawGrantNeedsCurrentOwner(phoneEligible: bool): bool =
  checkGrantOwner(initial, false, phoneEligible).phase == AuthorityInvalid

pure def lawExpiredGrantIsInvalid(envelopeValid: bool): bool =
  checkGrantEnvelope(initial, envelopeValid, false).phase == AuthorityInvalid
```
