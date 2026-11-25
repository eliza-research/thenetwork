# MCP signup drafts

The [OAuth and MCP flow model](models/oauth_mcp.md) covers the connector grant, and the [connector browser authorization](oauthBrowserAuthorization.md) covers the connection page and its Finish signup step. The draft keeps the approved first name and home city that the agent saved for that step; the step does not show them, so the person enters the details on the page. The MCP shell reads the site, connector grant, phone session, recorded age, ban and stored records. It keeps the browser response, storage transactions, and cleanup operations.

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

When the person opens Finish signup on a live connection request with a verified phone, the server decides from the request's membership status, the lowest recorded age of the phone and the ban of the number. A banned number's draft is deleted. A person who is not joined or invited, whose lowest recorded age the app allows, keeps the draft (`ReadDraft`): the signup page then uses it once to fill in the first name and home city (the [signup prefill rule](authorizationPages.md), only for the client, app and phone of the grant that saved it, under the age guard), and the store deletes the row when it is used. A lowest recorded age that the app does not allow deletes the draft. Any other membership keeps the row until its deadline. The server decides only after the browser session matches the request. A refused session keeps the draft, except that a banned number's draft is deleted, because a ban also ends the session. Changed (audits MCP16, SIG46 and MCP-draft-before-session): a same-origin `/oauth/signup-draft` route read the draft for a Join page that no site has, and the decision ran before the session check, so a post without a matching session could make the server delete a draft; the route is gone and the decision runs after the session check. Changed (merge with develop, 2026-11-24): develop added the one-time prefill of the Finish signup page from the draft of the same client, app and phone, and an optional `rid` field on the removed route. The prefill stays; it deletes the row when it uses it, so no draft is read twice. The route stays removed, so the `rid` field has no route.

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

### A draft is written only under the grant that saves it, and only the signup prefill reads it

A write needs a live unrevoked grant with the profile write scope and the matching app and phone. Exactly one row is written for each grant. No route reads the draft fields. Only the Finish signup page reads them, once, to prefill the form, and it deletes the row when it reads it. Finish signup keeps or deletes the row, and the signup result, a recorded age, a ban, erasure, a number change and the deadline delete it. Changed (2026-11-23): the rule described a read by phone, app and person, but the only read was removed with the Join page route, so the read decision `signupDraftRowReadable` and the store read are removed.

```quint
pure def signupDraftGrantAllowed(bindingMatches: bool, grantCurrent: bool, unrevoked: bool, writeScope: bool): bool =
  bindingMatches and grantCurrent and unrevoked and writeScope

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
