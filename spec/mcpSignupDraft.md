# MCP signup drafts

The [OAuth and MCP flow model](models/oauth_mcp.md) covers the connector grant, and the [connector browser authorization](oauthBrowserAuthorization.md) covers the connection page and its Finish signup step. The draft keeps the approved first name and home city for the verified signup form. When the client, app, phone and person match, the form can show the draft once. The person can edit those fields before submitting signup. The MCP shell reads the site, connector grant, phone session, recorded age, ban and stored records. It keeps the browser response, storage transactions, and cleanup operations.

## Story: Prepare an editable Join form after authorization

> As a person who has connected an assistant, I want it to keep my approved first name and home city only while I can still use them to finish signup on the connection page.

### The draft belongs to the app on the connection

Expose drafts in The Network and Friends. An optional requested app must be the app receiving the tool request. The shell accepts only the approved first name and optional supported home city.

```quint
pure def signupDraftAppEnabled(appId: str): bool = appId == "ntwrk" or appId == "friends"

pure def signupDraftRequestAllowed(appId: str, appProvided: bool, matchesHost: bool): bool =
  signupDraftAppEnabled(appId) and (not(appProvided) or matchesHost)
```

### A live connection prepares one draft under the age guard

The connector must have a grant and storage. The check reads the lowest recorded age of the phone, and the join checks the stated age again. Proceed when the lowest recorded age of the phone allows the app, the grant still belongs to the phone's current owner, and the person is not joined or is invited. After a successful insert, read the lowest recorded age again. The draft is prepared only when the app still allows that age; otherwise delete the phone's drafts of the app and refuse. The read after the insert sees every age recorded before it. An age recorded after that read deletes the draft at once when the app does not allow it (see "A recorded age that the app does not allow deletes the draft at once"). The ten-minute deadline is capped at the grant's expiry. Changed (audit MCP-age-guard): the age check ran inside a phone lock with a cleanup hook that the platform no longer has, and the check and the insert were separate steps, so an age recorded between them left a draft that no check refused. Changed (2026-11-23): the step had a guard input and a `UseJoinForm` phase for a connector without the recorded-age check; every connector now has that check, so the input and the phase are removed.

```quint
type DraftPreparationPhase = ReadConnection | CheckAge | CheckOwner | CheckMembership | WriteDraft | RecheckAge |
  Prepared | GrantRefused | AgeRefused | ExistingProfile | WriteRefused
type DraftPreparation = { phase: DraftPreparationPhase }

pure val initial: DraftPreparation = { phase: ReadConnection }
pure val signupDraftLifetimeMs = 600000

pure def signupDraftDeadline(draftUntil: int, grantUntil: int): int =
  if (grantUntil < draftUntil) grantUntil else draftUntil

pure def signupMembershipCanDraft(status: str): bool = status == "not_joined" or status == "invited"

pure def canObserveConnection(s: DraftPreparation): bool = s.phase == ReadConnection
pure def observeConnection(s: DraftPreparation, grantReady: bool): DraftPreparation =
  { phase: if (grantReady) CheckAge else GrantRefused }

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

## Story: Drop the draft when I can no longer use it

> As a person who connects my assistant again to finish signup, I want a draft that I can no longer use to be deleted when I open Finish signup.

### The Finish signup step keeps the draft only for a person who can still join

A live connection first checks its verified phone session. It then uses membership, the lowest recorded age and the ban to decide whether to read the draft, leave it alone or delete it. The verified signup form can prefill only a compatible one-use draft under the connector authorization rule. The store deletes the draft when the form claims it, in the same step that returns its fields. An ineligible claim leaves it untouched. A refused session keeps the draft unless the number is banned. A ban or an age that the app does not allow deletes the draft. Other ineligible membership states leave it until expiry.

Use a same-origin browser POST with no query and a verified app phone session that still belongs to its current owner. Under the age guard, a person who is not joined or is invited can read the draft. When the age guard refuses, return an empty draft. A deliberate discard needs the account view marker for that authorized session. The marker describes the reviewed account. The JSON body can have an optional `rid` field, the ID of an OAuth authorization request. The shell reads the body only after the origin check, and at most 16 KiB of it. When the body has no `rid`, the claim and the discard are for the app of the host. When the body has a `rid`, it must be a string of 22 URL-safe base64 characters that names a stored authorization request. The host must serve the app of that request: ntwrk.party serves every app, and an app site serves only its own app. The request must also be live in this browser: its app and resource are those of this host, it has not expired, the browser cookie of the request matches, and its client exists. Then the claim and the discard are for the app of that request, with the phone session of that app. If one of these checks fails, the shell returns 403 `not_allowed`, and it does not use the app of the host. A `rid` does not authorize a request by itself, and it is not a draft ID. The app must still be one that exposes drafts.

```quint
type DraftClaimRoute = RefuseClaim | ReadDraft | DiscardDraft

type DraftBrowserAction = RefuseBrowserAction | ClaimBySession | CheckDiscardView

pure def signupDraftBrowserSource(originAllowed: bool, browserVerified: bool, queryPresent: bool): bool =
  originAllowed and browserVerified and not(queryPresent)

pure def signupDraftBrowserAction(ownerMatches: bool, discardRequested: bool): DraftBrowserAction =
  if (not(ownerMatches)) RefuseBrowserAction else if (discardRequested) CheckDiscardView else ClaimBySession

pure def signupDraftDiscardAllowed(route: DraftBrowserAction, viewMatches: bool): bool =
  route == CheckDiscardView and viewMatches

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

### A draft is written and read only under its current binding

A write needs a live unrevoked grant with the profile write scope and the matching app and phone. Postgres samples the current Clock after it locks the grant and checks the write deadline with that reading. At most one draft is written for each grant. A private flag on the grant records the first write. Deleting the draft removes its fields and binding. The flag stays with the grant until grant deletion. An upgrade sets the flag for each retained draft or old consumed record before it removes consumed records. A read needs the matching app, phone and person, one compatible grant, and a draft that is unused and current. The signup result, a recorded age that blocks enrollment, a ban, erasure, a number change and the deadline delete the draft. Postgres locks the grants, then the draft rows, before it samples the current Clock. Both recovery and Finish signup check the bindings and deadlines with that reading. An expired draft or grant returns no fields and consumes no draft.

```quint
pure def signupDraftGrantAllowed(bindingMatches: bool, grantCurrent: bool, unrevoked: bool, writeScope: bool): bool =
  bindingMatches and grantCurrent and unrevoked and writeScope

pure def signupDraftRowReadable(bindingMatches: bool, unconsumed: bool, expiresAt: int, asOf: int): bool =
  bindingMatches and unconsumed and expiresAt > asOf

pure def signupDraftCanPrepare(alreadyPrepared: bool): bool = not(alreadyPrepared)

pure def lawOneDraftPerGrant(alreadyPrepared: bool): bool =
  alreadyPrepared implies not(signupDraftCanPrepare(alreadyPrepared))

pure def signupDraftUnique(matches: int): bool = matches == 1
pure def signupDraftExpired(expiresAt: int, asOf: int): bool = expiresAt <= asOf
```

### The signup result settles the draft

A completed join uses the draft and deletes it. A join that the app refuses for the stated age deletes it; the platform records that lower age, and the lowest stated age counts from then on. A refusal for review, a ban or a changed account deletes it. A refusal that the person can correct on the form (an invitation, the text message terms, a missing field or a birth date that is not a real date) keeps it until its deadline. Erasing the account, a number change and the deadline also delete it. A staff ban of a person or a number deletes the drafts of every banned number in every app at once. The ban deletion runs after every membership is restricted and before the ban is recorded as complete, so a failure leaves the ban pending for a staff retry. Changed (audits MCP16, SIG46 and MCP-draft-ban): the Finish signup result now settles the draft and a ban deletes it at once, because a draft must not outlive its use and a banned person's number kept stored profile fields after the ban. Changed (2026-11-23): a birth date that is not a real date (`invalid_birthdate`) keeps the draft, as `invalid` does, because one mistyped date on the same form deleted the draft.

```quint
type DraftSettlement = DeleteDraft | KeepDraft

pure val signupResultValues = Set("joined", "under_age", "review", "account_changed", "invite_only", "invalid_invitation", "invalid", "invalid_birthdate", "consent_wording")

pure def signupDraftAfterSignup(signupResult: str): DraftSettlement =
  if (signupResult == "invite_only" or signupResult == "invalid_invitation" or signupResult == "invalid" or signupResult == "invalid_birthdate" or signupResult == "consent_wording") KeepDraft
  else DeleteDraft

pure def lawUsedOrRefusedForAgeDraftIsDeleted(signupResult: str): bool =
  (signupResult == "joined" or signupResult == "under_age" or signupResult == "review") implies signupDraftAfterSignup(signupResult) == DeleteDraft
```

### A recorded age that the app does not allow deletes the draft at once

Each time the platform records an age reading for a phone, the connector reads the lowest recorded age of that phone again for each app that has drafts. It deletes the phone's draft of each app that does not allow that age, and it keeps the draft of each app that still allows it. This applies to a stated age, a birth date, the age of a join, the age that a chat states, and a number change, which brings the lowest age of the person and of the old number to the new number. Only the newest connector of the service does this check. A failed check or deletion does not fail the step that recorded the age: the age is already saved, a replayed turn does not record it again, and Finish signup and the ten-minute deadline still refuse the draft, so the connector logs the failure and the step goes on. Changed (2026-11-22): an age that the platform recorded after the read that follows the insert left the draft stored for up to ten minutes, a number change did not run the check, and a failed deletion failed the join or the turn after the age was saved.

```quint
pure def signupDraftAfterAgeRecorded(ageAllowed: bool): DraftSettlement =
  if (ageAllowed) KeepDraft else DeleteDraft

pure def lawRefusedRecordedAgeDeletesDraft(ageAllowed: bool): bool =
  not(ageAllowed) implies signupDraftAfterAgeRecorded(ageAllowed) == DeleteDraft

pure def lawAllowedRecordedAgeKeepsDraft(ageAllowed: bool): bool =
  ageAllowed implies signupDraftAfterAgeRecorded(ageAllowed) == KeepDraft
```
