# MCP signup drafts

The [OAuth and MCP flow model](models/oauth_mcp.md) covers the connector grant, and the [connector browser authorization](oauthBrowserAuthorization.md) covers the connection page and its Finish signup step. The draft passes the approved first name and home city from the agent to that step. The MCP shell reads the site, connector grant, phone session, recorded age, ban and stored records. It keeps the browser response, storage transactions, and cleanup operations.

## Story: Prepare an editable Join form after authorization

> As a person who has connected an assistant, I want it to prepare my approved first name and home city so I can review them when I finish signup on the connection page.

### The draft belongs to the app on the connection

Expose drafts in The Network and Friends. An optional requested app must be the app receiving the tool request. The shell accepts only the approved first name and optional supported home city.

```quint
pure def signupDraftAppEnabled(appId: str): bool = appId == "ntwrk" or appId == "friends"

pure def signupDraftRequestAllowed(appId: str, appProvided: bool, matchesHost: bool): bool =
  signupDraftAppEnabled(appId) and (not(appProvided) or matchesHost)
```

### A live connection prepares one draft under the age guard

The connector must have a grant and storage. The recorded-age check must be available. Changed: the age check used to run inside a phone lock with a cleanup hook that the platform no longer has; it now reads the lowest recorded age of the phone, and the join checks the stated age again. Proceed when the lowest recorded age of the phone allows the app, the grant still belongs to the phone's current owner, and the person is not joined or is invited. After a successful insert, read the lowest recorded age again. The draft is prepared only when the app still allows that age; otherwise delete the phone's drafts of the app and refuse. Changed again (audit MCP-age-guard): the check and the insert were separate steps, so an age that the platform recorded between them left a draft that no check refused; the read after the insert sees every age recorded before it. An age recorded after that read leaves the row until the Finish signup read deletes it or its deadline passes. The ten-minute deadline is capped at the grant's expiry.

```quint
type DraftPreparationPhase = ReadConnection | CheckAge | CheckOwner | CheckMembership | WriteDraft | RecheckAge |
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
  { phase: if (saved) RecheckAge else WriteRefused }

pure def canObserveAgeAfterWrite(s: DraftPreparation): bool = s.phase == RecheckAge
pure def observeAgeAfterWrite(s: DraftPreparation, allowed: bool): DraftPreparation =
  { phase: if (allowed) Prepared else AgeRefused }

pure val statusValues = Set("not_joined", "invited", "active", "stopped")

pure def stepPreparedRequiresAgeAfterWrite(before: DraftPreparation, after: DraftPreparation): bool =
  (before.phase != Prepared and after.phase == Prepared) implies before.phase == RecheckAge

pure def sometimesPrepared(s: DraftPreparation): bool = s.phase == Prepared
```

## Story: Review the draft when I finish signup on the connection page

> As a person who connects my assistant again to finish signup, I want the connection page to show the draft my assistant saved, so I can approve or correct it before I join.

### The Finish signup step reads the draft only for a person who can still join

Changed: a same-origin `/oauth/signup-draft` route used to read the draft for a Join page that no site has, so nothing read it (audit MCP16 and SIG46); the Finish signup step of the connection page now reads it, and the rules of that browser route are gone. The shared signup view does not show the draft fields yet, so no reply, skill or page may say that the page shows them until it does. When the person opens Finish signup on a live connection request with a verified phone, the server decides from the request's membership status, the lowest recorded age of the phone and the ban of the number. A banned number reads no draft, and its draft is deleted. A person who is not joined or invited, whose lowest recorded age the app allows, reads the draft. A lowest recorded age that the app does not allow deletes the draft. Any other membership reads no draft and keeps the row. The server reads the draft only after the browser session matches the request. A refused session reads no draft; when the number is banned, the refusal deletes the number's draft of the app, because a ban also ends the session. Changed (audit MCP-draft-before-session): the read and its deletion ran before the session check, so a post without a matching session could make the server read or delete a draft.

```quint
type DraftClaimRoute = RefuseClaim | ReadDraft | DiscardDraft

pure def signupDraftClaimRoute(status: str, ageAllowed: bool, banned: bool): DraftClaimRoute =
  if (banned) DiscardDraft
  else if (not(signupMembershipCanDraft(status))) RefuseClaim
  else if (ageAllowed) ReadDraft else DiscardDraft

pure def lawBannedNumberNeverReadsDraft(status: str, ageAllowed: bool): bool =
  signupDraftClaimRoute(status, ageAllowed, true) == DiscardDraft

pure def lawDraftReadNeedsJoinableAge(status: str, ageAllowed: bool, banned: bool): bool =
  signupDraftClaimRoute(status, ageAllowed, banned) == ReadDraft implies
    (ageAllowed and not(banned) and signupMembershipCanDraft(status))

pure def signupDraftRefusedRoute(banned: bool): DraftClaimRoute =
  if (banned) DiscardDraft else RefuseClaim

pure def lawRefusedSessionReadsNoDraft(banned: bool): bool =
  signupDraftRefusedRoute(banned) != ReadDraft

pure def lawRefusedBannedSessionDeletesDraft(banned: bool): bool =
  banned implies signupDraftRefusedRoute(banned) == DiscardDraft
```

### A draft is read only by the phone, app and person that saved it

Changed: a read used to need the saving grant to be live, so the disconnect that the not-joined next step asks for hid the draft before Finish signup could show it; a read now checks the draft's own binding and deadline, and the draft still lives at most ten minutes. A write needs a live unrevoked grant with the profile write scope and the matching app and phone. A read needs a draft with the request's app and phone, a saving grant bound to the request's person (no person on both sides for a person who has not joined) and a deadline after now. A used draft is deleted, so no read returns it again. Exactly one eligible row returns the fields. PostgreSQL checks the bindings and the deadline in the statement that reads the row.

```quint
pure def signupDraftGrantAllowed(bindingMatches: bool, grantCurrent: bool, unrevoked: bool, writeScope: bool): bool =
  bindingMatches and grantCurrent and unrevoked and writeScope

pure def signupDraftRowReadable(bindingMatches: bool, expiresAt: int, asOf: int): bool =
  bindingMatches and expiresAt > asOf

pure def signupDraftUnique(matches: int): bool = matches == 1
pure def signupDraftExpired(expiresAt: int, asOf: int): bool = expiresAt <= asOf
```

### The signup result settles the draft

New: the Finish signup result now decides what happens to the draft, because the draft must not outlive its use (audit MCP16 and SIG46). A completed join uses the draft and deletes it. A join that the app refuses for the stated age deletes it; the platform records that lower age, and the lowest stated age counts from then on. A refusal for review, a ban or a changed account deletes it. A refusal that the person can correct on the form (an invitation, the text message terms or a missing field) keeps it until its deadline. Erasing the account, a number change and the deadline also delete it. A staff ban of a person or a number deletes the drafts of every banned number in every app at once. Changed (audit MCP-draft-ban): a ban used to leave the draft until Finish signup opened or the deadline passed, so the number of a banned person kept stored profile fields after the ban. Changed (review of MCP-draft-ban): the deletion ran before the memberships were restricted, so a connector store error stopped the ban before the restriction; the deletion now runs after every membership is restricted and before the ban is recorded as complete, so a failure still leaves the ban pending for a staff retry.

```quint
type DraftSettlement = DeleteDraft | KeepDraft

pure val signupResultValues = Set("joined", "under_age", "review", "account_changed", "invite_only", "invalid_invitation", "invalid", "consent_wording")

pure def signupDraftAfterSignup(signupResult: str): DraftSettlement =
  if (signupResult == "invite_only" or signupResult == "invalid_invitation" or signupResult == "invalid" or signupResult == "consent_wording") KeepDraft
  else DeleteDraft

pure def lawUsedOrRefusedForAgeDraftIsDeleted(signupResult: str): bool =
  (signupResult == "joined" or signupResult == "under_age" or signupResult == "review") implies signupDraftAfterSignup(signupResult) == DeleteDraft
```
