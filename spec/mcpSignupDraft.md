# MCP signup drafts

The [OAuth and MCP flow model](models/oauth_mcp.md) covers the connector grant, and the [site enrollment flow](siteEnrollment.md) covers the person's own Join submission. The draft passes approved name and city between these flows. The MCP shell reads the site, connector grant, phone session, canonical age policy, and stored records. It keeps the existing browser response, storage transactions, and cleanup operations.

## Story: Prepare an editable Join form after authorization

> As a person who has connected an assistant, I want it to prepare my approved first name and home city so I can review my own Join form.

### The draft belongs to the app on the connection

Expose drafts in The Network and Friends. An optional requested app must be the app receiving the tool request. The shell accepts only the approved first name and optional supported home city.

```quint
pure def signupDraftAppEnabled(appId: str): bool = appId == "ntwrk" or appId == "friends"

pure def signupDraftRequestAllowed(appId: str, appProvided: bool, matchesHost: bool): bool =
  signupDraftAppEnabled(appId) and (not(appProvided) or matchesHost)
```

### A live connection prepares one draft under the age guard

The connector must have a grant and storage. The canonical age guard and its cleanup hook must be available. Inside that guard, proceed when preparation is permitted, the grant still belongs to the phone's current owner, and the person is not joined or is invited. A successful insert prepares the draft. The ten-minute deadline is capped at the grant's expiry.

```quint
type DraftPreparationPhase = ReadConnection | CheckAge | CheckOwner | CheckMembership | WriteDraft |
  Prepared | GrantRefused | UseJoinForm | AgeRefused | ExistingProfile | WriteRefused
type DraftPreparation = { phase: DraftPreparationPhase }

pure val initial: DraftPreparation = { phase: ReadConnection }
pure val signupDraftLifetimeMs = 600000

pure def signupDraftDeadline(draftUntil: int, grantUntil: int): int =
  if (grantUntil < draftUntil) grantUntil else draftUntil

pure def signupMembershipCanDraft(status: str): bool = status == "not_joined" or status == "invited"

pure def canObserveConnection(s: DraftPreparation): bool = s.phase == ReadConnection
pure def observeConnection(s: DraftPreparation, grantReady: bool, guardReady: bool): DraftPreparation =
  { phase: if (not(grantReady)) GrantRefused else if (guardReady) CheckAge else UseJoinForm }

pure def canObserveAge(s: DraftPreparation): bool = s.phase == CheckAge
pure def observeAge(s: DraftPreparation, allowed: bool): DraftPreparation =
  { phase: if (allowed) CheckOwner else AgeRefused }

pure def canObserveOwner(s: DraftPreparation): bool = s.phase == CheckOwner
pure def observeOwner(s: DraftPreparation, ownerMatches: bool): DraftPreparation =
  { phase: if (ownerMatches) CheckMembership else GrantRefused }

pure def canObserveMembership(s: DraftPreparation): bool = s.phase == CheckMembership
pure def observeMembership(s: DraftPreparation, status: str): DraftPreparation =
  { phase: if (signupMembershipCanDraft(status)) WriteDraft else ExistingProfile }

pure def canObserveWrite(s: DraftPreparation): bool = s.phase == WriteDraft
pure def observeWrite(s: DraftPreparation, saved: bool): DraftPreparation =
  { phase: if (saved) Prepared else WriteRefused }

pure val statusValues = Set("not_joined", "invited", "active", "stopped")

pure def stepPreparedRequiresWrite(before: DraftPreparation, after: DraftPreparation): bool =
  (before.phase != Prepared and after.phase == Prepared) implies before.phase == WriteDraft

pure def sometimesPrepared(s: DraftPreparation): bool = s.phase == Prepared
```

## Story: Recover the same draft until Join or expiry

> As a person signing up on the site, I want to recover the draft in my own browser session until I use it or it expires.

### The site checks the session and membership before asking for the draft

Use a same-origin browser POST with no query and a verified app phone session that still belongs to its current owner. Under the age guard, a person who is not joined or is invited can read the draft. When the age guard refuses, return an empty draft. A deliberate discard needs the account view marker for that authorized session. The marker describes the reviewed account.

```quint
type DraftClaimRoute = RefuseClaim | ReadDraft | EmptyDraft
type DraftBrowserAction = RefuseBrowserAction | ClaimBySession | CheckDiscardView

pure def signupDraftBrowserSource(originAllowed: bool, browserVerified: bool, queryPresent: bool): bool =
  originAllowed and browserVerified and not(queryPresent)

pure def signupDraftBrowserAction(ownerMatches: bool, discardRequested: bool): DraftBrowserAction =
  if (not(ownerMatches)) RefuseBrowserAction else if (discardRequested) CheckDiscardView else ClaimBySession

pure def signupDraftDiscardAllowed(route: DraftBrowserAction, viewMatches: bool): bool =
  route == CheckDiscardView and viewMatches

pure def signupDraftClaimRoute(status: str, ageAllowed: bool): DraftClaimRoute =
  if (not(signupMembershipCanDraft(status))) RefuseClaim else if (ageAllowed) ReadDraft else EmptyDraft
```

### A compatible grant and exactly one draft are needed for a read

The store checks a live unrevoked profile-write grant with the matching app and phone. A read also checks the person binding, unconsumed draft, matching app and phone on the draft, and its deadline. Exactly one eligible row returns the fields. Repeated reads keep the fields available until expiry or cleanup. PostgreSQL checks the bindings and deadlines again while it holds the grant and draft locks.

```quint
pure def signupDraftGrantAllowed(bindingMatches: bool, grantCurrent: bool, unrevoked: bool, writeScope: bool): bool =
  bindingMatches and grantCurrent and unrevoked and writeScope

pure def signupDraftRowReadable(bindingMatches: bool, unconsumed: bool, expiresAt: int, asOf: int): bool =
  bindingMatches and unconsumed and expiresAt > asOf

pure def signupDraftUnique(matches: int): bool = matches == 1
pure def signupDraftExpired(expiresAt: int, asOf: int): bool = expiresAt <= asOf
```
