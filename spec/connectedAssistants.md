# Connected assistants page

This spec owns the view layer of the "Connected assistants" page at `/oauth/consents` on each site. On an app site, the page lists the assistants that can use the person's account in that app. On ntwrk.party, which serves the connector of every app, one page lists the assistants of every app whose own session is in this browser on ntwrk.party. On each page the person can remove access. The handler owns the session check, the origin check, the grant lookup, the revocation and its audit. The [connector token spec](oauthTokenLifecycle.md) owns what a removed grant means for tokens. The page is not an account portal: no public site links to it, and it offers no sign-in form or sign-in link. A person gets a site session only through the phone confirmation or the Cloud sign-in of signup or of connector authorization.

## Story: See which assistants can use my account

> As a person who connected an assistant to an app, I want to see each assistant that can use my account in that app, so that I know who has access.

### The page lists live grants only for a signed-in session

The page first checks the site sessions. A site session is for one app. An app site reads only the session of its own app. ntwrk.party reads the session of each app that it serves, and each app has its own session cookie there. Without a session of a served app, the page shows "Sign in first". When a session check is not available, it shows "Please try again". With sessions, it lists each live grant of the current verified person and phone of each session, in the app of that session. A session never shows the grants of another app. A grant with no person belongs only to a verified phone that still has no person. Check Cloud authority for the person's Cloud grants before showing them. A denied grant is absent. When a current grant's check is temporarily unavailable, offer a retry of the list. Recheck the local grant and owner after checking authority. With no live grant the page shows the empty state.

```quint
type ConsentsView = Loading | SignInFirstView | RetryLaterView | NotAllowedView | ListView | EmptyView | ConfirmingRemoval
type LoadReply = LoadedSignedOut | LoadedUnavailable | LoadedList
type ConsentsPage = { view: ConsentsView, grants: int, signedIn: bool, notice: bool }

pure val initial: ConsentsPage = { view: Loading, grants: 0, signedIn: false, notice: false }
pure val grantsValues = Set(0, 1, 2)

pure def viewForGrants(grants: int): ConsentsView = if (grants > 0) ListView else EmptyView

pure def browserOwnsLiveGrant(sameApp: bool, samePhone: bool, samePerson: bool, active: bool, asOf: int, grantExpiresAt: int): bool =
  sameApp and samePhone and samePerson and active and asOf < grantExpiresAt

pure def lawAnEarlierPhoneOwnerHasNoGrant(sameApp: bool, samePhone: bool, active: bool, asOf: int, grantExpiresAt: int): bool =
  not(browserOwnsLiveGrant(sameApp, samePhone, false, active, asOf, grantExpiresAt))

pure def consentsPageReadsSession(siteIsHub: bool, sessionForSiteApp: bool): bool = siteIsHub or sessionForSiteApp

pure def lawAppSiteReadsOnlyItsOwnSession(sessionForSiteApp: bool): bool =
  consentsPageReadsSession(false, sessionForSiteApp) iff sessionForSiteApp

pure def lawHubReadsTheSessionOfEveryApp(sessionForSiteApp: bool): bool = consentsPageReadsSession(true, sessionForSiteApp)

pure def lawASessionShowsOnlyItsOwnApp(samePhone: bool, samePerson: bool, active: bool, asOf: int, grantExpiresAt: int): bool =
  not(browserOwnsLiveGrant(false, samePhone, samePerson, active, asOf, grantExpiresAt))

type BrowserGrantVisibility = ShowBrowserGrant | HideBrowserGrant | RetryBrowserGrantList

pure def browserGrantVisibility(ownedLiveGrant: bool, authority: str): BrowserGrantVisibility =
  if (not(ownedLiveGrant) or authority == "invalid") HideBrowserGrant
  else if (authority == "valid") ShowBrowserGrant
  else RetryBrowserGrantList

pure def lawShownGrantHasCurrentAuthority(ownedLiveGrant: bool, authority: str): bool =
  (browserGrantVisibility(ownedLiveGrant, authority) == ShowBrowserGrant) implies (ownedLiveGrant and authority == "valid")

pure def canLoad(page: ConsentsPage, grants: int): bool = page.view == Loading and grants >= 0
pure def load(page: ConsentsPage, loaded: LoadReply, grants: int): ConsentsPage =
  if (loaded == LoadedSignedOut) { view: SignInFirstView, grants: 0, signedIn: false, notice: false }
  else if (loaded == LoadedUnavailable) { view: RetryLaterView, grants: 0, signedIn: false, notice: false }
  else { view: viewForGrants(grants), grants: grants, signedIn: true, notice: false }

pure def alwaysGrantsShowOnlyWithSession(page: ConsentsPage): bool =
  (page.view == ListView or page.view == EmptyView or page.view == ConfirmingRemoval) implies page.signedIn

pure def alwaysListMatchesGrants(page: ConsentsPage): bool =
  page.grants >= 0
    and (page.view == ListView implies page.grants > 0)
    and (page.view == EmptyView implies page.grants == 0)
    and (page.view == ConfirmingRemoval implies page.grants > 0)
```

### A grant card names the assistant as its claim and shows its date and scopes

Each card shows the assistant's name, or an unnamed label when it gave none, and says that the name is the assistant's own claim. It shows the date of the approval, the approved scopes and a "Remove access" button. On ntwrk.party, the card also names the app of the grant after the assistant's name, because the page can list grants of more than one app. An app site does not name the app.

```quint
type AssistantLabel = NamedByItself | UnnamedAssistant
type GrantCard = { assistant: AssistantLabel, claimNote: bool, allowedDate: bool, scopeList: bool, removeButton: bool }

pure def grantCard(named: bool): GrantCard =
  { assistant: if (named) NamedByItself else UnnamedAssistant, claimNote: true, allowedDate: true, scopeList: true, removeButton: true }

pure def lawGrantCardShowsClaimDateAndScopes(named: bool): bool =
  val card = grantCard(named)
  card.claimNote and card.allowedDate and card.scopeList and card.removeButton

pure def grantCardNamesItsApp(siteIsHub: bool): bool = siteIsHub

pure def lawOnlyTheHubCardNamesTheApp(siteIsHub: bool): bool = grantCardNamesItsApp(siteIsHub) iff siteIsHub
```

### A page without a session offers no sign-in control

"Sign in first" tells the person to connect the app in the agent and to confirm the phone there. It and "Not allowed" offer no control. "Please try again" offers only a link that loads the page again. Only the list offers "Remove access". Each view except the first load shows the brand mark and the Privacy and Terms links.

```quint
type ConsentsOffers = { removeAccess: bool, confirmRemove: bool, keepAccess: bool, retryLink: bool }
type PageChrome = { brandMark: bool, legalLinks: bool }

pure val noConsentsOffers: ConsentsOffers = { removeAccess: false, confirmRemove: false, keepAccess: false, retryLink: false }

pure def offersFor(view: ConsentsView): ConsentsOffers = {
  removeAccess: view == ListView,
  confirmRemove: view == ConfirmingRemoval,
  keepAccess: view == ConfirmingRemoval,
  retryLink: view == RetryLaterView,
}

pure def chromeFor(view: ConsentsView): PageChrome = { brandMark: view != Loading, legalLinks: view != Loading }

pure def lawSignedOutPageOffersNoControl(view: ConsentsView): bool =
  (view == SignInFirstView or view == NotAllowedView) implies offersFor(view) == noConsentsOffers

pure def lawEveryPageShowsBrandAndLegalLinks(view: ConsentsView): bool =
  view != Loading implies (chromeFor(view).brandMark and chromeFor(view).legalLinks)

pure def canReloadPage(page: ConsentsPage): bool = offersFor(page.view).retryLink
pure def reloadPage(page: ConsentsPage): ConsentsPage = { ...page, view: Loading, grants: 0, signedIn: false, notice: false }
```

## Story: Remove an assistant's access

> As a person who connected an assistant to an app, I want to remove its access and see that it is gone, so that it cannot act for me any more.

### Removal needs a confirmation

"Remove access" on a card asks the person to confirm. The person can confirm or keep the access. Keeping the access shows the list again with no change. A new choice clears an earlier "Access removed." notice. Only a confirmed removal, a load or a reload changes the listed grants.

```quint
pure def canChooseRemoval(page: ConsentsPage): bool = page.view == ListView and page.grants > 0
pure def chooseRemoval(page: ConsentsPage): ConsentsPage = { ...page, view: ConfirmingRemoval, notice: false }

pure def canKeepAccess(page: ConsentsPage): bool = page.view == ConfirmingRemoval
pure def keepAccess(page: ConsentsPage): ConsentsPage = { ...page, view: ListView }

pure def stepKeepAccessChangesNothing(before: ConsentsPage, via: str, after: ConsentsPage): bool =
  via == "keepAccess" implies (after.view == ListView and after.grants == before.grants and after.signedIn == before.signedIn)

pure def stepOnlyConfirmedRemovalChangesGrants(before: ConsentsPage, via: str, after: ConsentsPage): bool =
  (after.grants != before.grants) implies
    (via == "load" or via == "reloadPage" or (via == "confirmRemoval" and before.view == ConfirmingRemoval))
```

### A confirmed removal shows its result

The confirmation page binds the chosen grant to the current browser session of the grant's app. The confirmation ends five minutes after issuance or at the grant's expiry, whichever comes first. A POST authenticates the current session and checks the grant owner and this exact confirmation again. If the session rotated while the form was open, its new token can submit a confirmation made for the immediate predecessor recorded on that session. The previous token cannot authenticate once its grace period ends. An independent sign-in, an expired confirmation or a confirmation for another grant leaves the grant as it is. When the access ends, the page lists the grants that stay and shows "Access removed.". An unavailable check of the remaining grants still shows the completed removal notice and offers a link to retry the list. When the grant was already gone or is not the person's, the page lists the grants with no notice. Without a session it shows "Sign in first". When the session check is not available, it shows "Please try again". A form from another site gets "Not allowed". Only a confirmed removal shows the notice.

```quint
pure val removeConfirmationMs = 300000

pure def removalConfirmationEndsAt(issuedAt: int, grantExpiresAt: int): int =
  if (issuedAt + removeConfirmationMs < grantExpiresAt) issuedAt + removeConfirmationMs else grantExpiresAt

pure def lawConfirmationLastsAtMostFiveMinutes(ownedLiveGrant: bool, issuedAt: int, grantExpiresAt: int, asOf: int): bool =
  removalFormMayRevoke(ownedLiveGrant, true, asOf, removalConfirmationEndsAt(issuedAt, grantExpiresAt))
    implies (asOf < issuedAt + removeConfirmationMs and asOf < grantExpiresAt)

pure def browserRemovalProofMatches(currentVerified: bool, exactBinding: bool, exactDirectPredecessor: bool): bool =
  currentVerified and (exactBinding or exactDirectPredecessor)

pure def lawRemovalProofRequiresCurrentSession(exactBinding: bool, exactDirectPredecessor: bool): bool =
  not(browserRemovalProofMatches(false, exactBinding, exactDirectPredecessor))

pure def lawAnotherBrowserSessionCannotConfirm(currentVerified: bool): bool =
  not(browserRemovalProofMatches(currentVerified, false, false))

pure def removalFormMayRevoke(ownedLiveGrant: bool, exactBrowserConfirmation: bool, asOf: int, confirmationEndsAt: int): bool =
  ownedLiveGrant and exactBrowserConfirmation and asOf < confirmationEndsAt

pure def lawCannotRevokeWithoutConfirmation(ownedLiveGrant: bool, asOf: int, confirmationEndsAt: int): bool =
  not(removalFormMayRevoke(ownedLiveGrant, false, asOf, confirmationEndsAt))

type RemoveReply = Removed | NothingRemoved | RemoveSignedOut | RemoveUnavailable | RemoveRefused | RemovedListUnavailable

pure def removalListRetry(removal: str): RemoveReply =
  if (removal == "Removed") RemovedListUnavailable else RemoveUnavailable

pure def canConfirmRemoval(page: ConsentsPage, grants: int): bool = page.view == ConfirmingRemoval and grants >= 0
pure def confirmRemoval(page: ConsentsPage, removal: RemoveReply, grants: int): ConsentsPage =
  if (removal == RemoveSignedOut) { view: SignInFirstView, grants: 0, signedIn: false, notice: false }
  else if (removal == RemoveUnavailable) { view: RetryLaterView, grants: 0, signedIn: false, notice: false }
  else if (removal == RemovedListUnavailable) { view: RetryLaterView, grants: 0, signedIn: true, notice: true }
  else if (removal == RemoveRefused) { view: NotAllowedView, grants: 0, signedIn: false, notice: false }
  else { view: viewForGrants(grants), grants: grants, signedIn: true, notice: removal == Removed }

pure def alwaysNoticeOnlyForSignedInRemoval(page: ConsentsPage): bool =
  page.notice implies (page.signedIn and (page.view == ListView or page.view == EmptyView or page.view == RetryLaterView))

pure def stepNoticeFollowsConfirmedRemoval(before: ConsentsPage, via: str, after: ConsentsPage): bool =
  (after.notice and not(before.notice)) implies (via == "confirmRemoval" and before.view == ConfirmingRemoval)
```

### Each page and each outcome can occur

A person can reach each message page, the list, the empty state, the confirmation and the notice after the last removal.

```quint
pure def sometimesSignInFirst(page: ConsentsPage): bool = page.view == SignInFirstView
pure def sometimesRetryLater(page: ConsentsPage): bool = page.view == RetryLaterView
pure def sometimesNotAllowed(page: ConsentsPage): bool = page.view == NotAllowedView
pure def sometimesEmpty(page: ConsentsPage): bool = page.view == EmptyView and not(page.notice)
pure def sometimesListed(page: ConsentsPage): bool = page.view == ListView
pure def sometimesConfirming(page: ConsentsPage): bool = page.view == ConfirmingRemoval
pure def sometimesAccessRemoved(page: ConsentsPage): bool = page.view == ListView and page.notice
pure def sometimesLastAccessRemoved(page: ConsentsPage): bool = page.view == EmptyView and page.notice
```
