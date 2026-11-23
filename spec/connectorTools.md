# Connector tools as the agent sees them

Each app has its own MCP connector. The ntwrk.party host serves the connector of every app, each app at its own path, and each app site also serves the connector of its own app. A connection covers one app (the host app). The MCP server owns the tool list, the argument checks, the scope checks, the daily profile limit and the answers. The OAuth pages own sign-in and consent ([connector browser authorization](oauthBrowserAuthorization.md)). The platform owns the membership status, the profile intake and the single update inbox. This spec models which tools the agent can see and call, what each call does for each member status, and what the agent can observe after the call. The tokens, the grant storage and the minor rules of the inbox are in the OAuth and inbox models.

The MCP server (`packages/mcp/src/tools.ts` and `packages/mcp/src/handler.ts`) calls these decisions: `toolListed` for the tool list, `scopeFor` for the scope of each tool and its security scheme, `grantCovers` for the sign-in answer, the `canCall…` guards before each member tool call (a public tool needs no grant, and an anonymous or connected connection can call it), `profileLimitReached` for the daily limit, `appOffered` and `hostServes` for the apps and hosts of a surface, `appListed` for the apps that one connection names, `hostBindsApp` and `siteOffersOpenAi` for the app paths of each host, `grantServesApp` for the app of a token, and `toolAllowedFor` and `nextStepFor` for the member status. The shell owns these parts of the model, and does not keep them as state:

- The connection. The shell finds the host from the request host and the surface from the path (`connect`). The OAuth pages make the grant (`authorize`, [connector browser authorization](oauthBrowserAuthorization.md)). For each request, the shell makes one connection from the access token: connected with a token, anonymous without one, and with the profile write scope only when the token holds it.
- The approved profile. The agent reads the profile back and gets the person's approval before it calls `submit_profile` (`approveProfile`). The server cannot see this approval. The shell keeps a grant-bound keyed receipt for each exact profile ([profile submission](mcpProfileSubmission.md)) so retries do not repeat intake.
- The day. The store counts the profile and draft calls of one grant in a fixed window of 24 hours. The count of the earlier calls in the window is `sentToday`. A new window starts the count at zero, which is `startNewDay`. The store also counts a call that the limit refuses, but that call is in a window that is already at the limit, so the limit does not change.
- The member status, the owner change and the updates. The platform reads the status on each call (`changeMemberStatus`). Credential admission checks ownership before applying scopes, argument checks or limits, so the first authenticated call after a change ends the grant (`callAfterOwnerChange`). The platform inbox keeps the unseen updates, reads them and marks them seen (`receiveUpdate`, `readUpdates`, `callGetUpdates`).

## Story: Use my app's connector from my agent

> As a person who connected my agent to an app, I want the agent to see only the tools that fit my app and my status, so that it can check my status, send my approved profile once and read my own updates without seeing my phone number or code.

### Each surface serves every app, and only the slop.date endpoint of the OpenAI surface names slop.date

There are two surfaces. The full surface, at the app endpoint (`/mcp` or `/mcp/<app>`), offers every app. The OpenAI surface, at the same endpoint with `/openai` added (for example `/mcp/openai` or `/mcp/slop/openai`), serves ChatGPT and Codex clients. It serves the endpoint of every app, slop.date included, so that a person can sign up for each app in ChatGPT. The ntwrk.party host serves the OpenAI surface of each app. The slop.date site keeps no OpenAI surface of its own (see the next rule).

The OpenAI plugin is for people aged 13 to 17 too, and its one MCP server is the OpenAI endpoint of The Network ([agent entry](agentEntry.md)). So on the OpenAI surface, a connection to the endpoint of another app never lists slop.date as an app choice: the app list, the app argument of each tool, the public facts and their text do not name slop.date or dating. A public tool that names slop.date there answers that the app is not available. Only a connection to the slop.date endpoint of the OpenAI surface, `/mcp/slop/openai`, lists slop.date. The person adds that endpoint as a connector from the slop.date skill. Every host that a surface serves lists the public tools and the member tools. Only the friends.help and ntwrk.party hosts list the Join draft tool.

The app registry can disable an otherwise available OpenAI host. Check this setting on every request bound to the OpenAI surface, including when that surface is served at `/mcp`. A connection to a disabled OpenAI host is not available. The full surface applies the ordinary host rule. The shell refuses a request to a host that is not available before it lists or calls a tool, so the tool list of an available host uses the ordinary host rule.

```quint
type AppId = Ntwrk | Slop | Peon | Friends
type Surface = FullSurface | OpenAiSurface
type ToolName = AppInfoTool | StartSignupTool | PrepareSignupTool | CheckStatusTool | ReadProfileTool | SubmitProfileTool | GetUpdatesTool

pure def appOffered(surface: Surface, app: AppId): bool =
  (surface == FullSurface or surface == OpenAiSurface) and (app == Ntwrk or app == Slop or app == Peon or app == Friends)

pure def hostServes(surface: Surface, host: AppId): bool = appOffered(surface, host)

pure def configuredHostServes(surface: Surface, host: AppId, openAiEnabled: bool): bool =
  hostServes(surface, host) and (surface != OpenAiSurface or openAiEnabled)

pure def lawConfiguredOptOutBlocksOpenAiHost(host: AppId): bool =
  not(configuredHostServes(OpenAiSurface, host, false))

pure def toolListed(host: AppId, surface: Surface, tool: ToolName): bool =
  hostServes(surface, host) and (tool != PrepareSignupTool or host == Friends or host == Ntwrk)

pure def lawOpenAiOffersEveryApp(app: AppId): bool =
  appOffered(OpenAiSurface, app) and hostServes(OpenAiSurface, app) and toolListed(app, OpenAiSurface, AppInfoTool)

pure def appListed(surface: Surface, host: AppId, app: AppId): bool =
  appOffered(surface, app) and (surface == FullSurface or app != Slop or host == Slop)

pure def lawOpenAiListsSlopOnlyAtItsOwnEndpoint(host: AppId): bool =
  appListed(OpenAiSurface, host, Slop) iff host == Slop

pure def lawFullSurfaceListsEveryApp(host: AppId, app: AppId): bool = appListed(FullSurface, host, app)

pure def lawFullSurfaceOffersEveryApp(app: AppId): bool = appOffered(FullSurface, app)

pure def lawDraftOnlyOnFriendsAndNtwrk(host: AppId, surface: Surface): bool =
  toolListed(host, surface, PrepareSignupTool) implies (host == Friends or host == Ntwrk)
```

### The ntwrk.party host serves every app at its own path, and a grant covers only its own app

All app connectors are on one server. The skill of each app tells the agent to connect the ntwrk.party endpoint of that app: `https://ntwrk.party/mcp` for The Network, and `https://ntwrk.party/mcp/<app>` for slop, peon and friends. For ChatGPT, the agent adds `/openai` to that path. The ntwrk.party host serves each app at its own path. Each other site host serves only its own app, at `/mcp`. The path of the endpoint is the OAuth resource. The client sends this resource when authorization starts, so the authorization request, the consent page, the grant and each token are for the app of that path. The ntwrk.party host serves the OpenAI surface of every app. The slop.date site keeps its earlier rule: its own endpoint has no OpenAI surface, so ChatGPT reaches slop.date only at the ntwrk.party endpoint. The consent page names that app. A grant covers only its own app: a token for one app is refused at the endpoint of another app, a public tool included. The rules of each app stay with the app: the join mode (The Network is invite-only on the web), bans, ages, the text consent and the profile limit.

```quint
pure val hubHost: AppId = Ntwrk

pure def hostBindsApp(host: AppId, app: AppId): bool = host == app or host == hubHost

pure def siteOffersOpenAi(site: AppId, app: AppId): bool =
  hostBindsApp(site, app) and (site == hubHost or app != Slop)

pure def grantServesApp(grantApp: AppId, requestApp: AppId): bool = grantApp == requestApp

pure def lawHubServesEveryApp(app: AppId): bool = hostBindsApp(hubHost, app)

pure def lawAppSiteServesOnlyItsApp(host: AppId, app: AppId): bool =
  host != hubHost implies (hostBindsApp(host, app) iff host == app)

pure def lawHubOffersOpenAiForEveryApp(app: AppId): bool = siteOffersOpenAi(hubHost, app)

pure def lawSlopSiteKeepsNoOpenAiSurface(app: AppId): bool = not(siteOffersOpenAi(Slop, app))

pure def lawGrantNeverCrossesApps(grantApp: AppId, requestApp: AppId): bool =
  grantApp != requestApp implies not(grantServesApp(grantApp, requestApp))
```

### Public tools need no sign-in, and member tools need the person's own grant

`app_info` and `start_signup` return public facts only: what the app is, who can join, how to join, the ages and the legal links. They need no sign-in and take no personal details. `check_status` and `get_updates` need the membership read scope. `read_profile` needs its own explicitly authorized profile read scope. `submit_profile` and `prepare_signup` need the profile write scope. A grant covers a tool when the tool needs no scope, or when the grant holds the scope that the tool needs. Each grant covers the public tools, with or without scopes. A member tool without the right grant answers that the person must sign in on the app's page and allow access.

```quint
type Scope = NoScope | MembershipRead | ProfileWrite | ProfileRead

pure def scopeFor(tool: ToolName): Scope =
  if (tool == AppInfoTool or tool == StartSignupTool) NoScope
  else if (tool == CheckStatusTool or tool == GetUpdatesTool) MembershipRead
  else if (tool == ReadProfileTool) ProfileRead
  else ProfileWrite

pure def lawPublicToolsNeedNoSignIn(tool: ToolName): bool =
  (scopeFor(tool) == NoScope) iff (tool == AppInfoTool or tool == StartSignupTool)

pure def grantCovers(tool: ToolName, hasRead: bool, hasWrite: bool, hasProfileRead: bool): bool =
  scopeFor(tool) == NoScope or (scopeFor(tool) == MembershipRead and hasRead) or
  (scopeFor(tool) == ProfileWrite and hasWrite) or (scopeFor(tool) == ProfileRead and hasProfileRead)

pure def lawGrantCoversPublicTools(tool: ToolName, hasRead: bool, hasWrite: bool, hasProfileRead: bool): bool =
  scopeFor(tool) == NoScope implies grantCovers(tool, hasRead, hasWrite, hasProfileRead)

pure def lawProfileReadScopeIsSeparate(hasRead: bool, hasWrite: bool): bool =
  not(grantCovers(ReadProfileTool, hasRead, hasWrite, false))
```

### The member status decides which member tool can act

The agent sees one of six statuses: not joined, invited, onboarding, active, stopped or on hold. Every status can read its status and its updates. Only an onboarding or active member can send a profile. Only a person who is not joined or invited can prepare a Join draft. Each status has one next step that the agent tells the person: join on the site or get an invitation when not joined, accept the invitation, reply to the last text, nothing to do, text START, or email support. The connector reads the effective consent of the grant's current verified phone in its app. An explicit opt-out makes an active or onboarding membership read as stopped even while the membership update is pending. A review or restriction still reads as on hold. A missing consent record does not create a stopped status.

```quint
type MemberStatus = NotJoined | Invited | Onboarding | Active | Stopped | OnHold
type NextStep = JoinOnSite | GetInvitation | AcceptInvitation | ReplyToLastText | AlreadySignedUp | TextStart | EmailSupport

pure def liveMember(status: MemberStatus): bool = status == Active or status == Onboarding

pure def connectorMembershipStatus(storedStatus: str, reviewRequired: bool, optedOut: bool): MemberStatus =
  if (reviewRequired or storedStatus == "restricted") OnHold
  else if (storedStatus == "paused") Stopped
  else if (storedStatus == "active") (if (optedOut) Stopped else Active)
  else if (storedStatus == "onboarding") (if (optedOut) Stopped else Onboarding)
  else if (storedStatus == "invited") Invited
  else NotJoined

pure def lawStoppedMembershipCannotSubmitProfile(storedStatus: str, reviewRequired: bool): bool =
  not(liveMember(connectorMembershipStatus(storedStatus, reviewRequired, true)))

pure def toolAllowedFor(tool: ToolName, status: MemberStatus): bool =
  if (tool == SubmitProfileTool) liveMember(status)
  else if (tool == ReadProfileTool) status == Active
  else if (tool == PrepareSignupTool) (status == NotJoined or status == Invited)
  else true

pure def nextStepFor(status: MemberStatus, inviteOnly: bool): NextStep =
  if (status == NotJoined) (if (inviteOnly) GetInvitation else JoinOnSite)
  else if (status == Invited) AcceptInvitation
  else if (status == Onboarding) ReplyToLastText
  else if (status == Active) AlreadySignedUp
  else if (status == Stopped) TextStart
  else EmailSupport

pure def lawSubmitOnlyForLiveMembers(status: MemberStatus): bool =
  toolAllowedFor(SubmitProfileTool, status) iff (status == Active or status == Onboarding)

pure def lawDraftOnlyBeforeJoining(status: MemberStatus): bool =
  toolAllowedFor(PrepareSignupTool, status) iff (status == NotJoined or status == Invited)

pure def lawReadToolsServeEveryStatus(status: MemberStatus): bool =
  toolAllowedFor(AppInfoTool, status) and toolAllowedFor(StartSignupTool, status) and
  toolAllowedFor(CheckStatusTool, status) and toolAllowedFor(GetUpdatesTool, status)
```

### A connection binds to one host on one surface, and the person connects it in the browser

The agent first reaches one host on one surface. The host is fixed before any tool can save a draft. A host that the surface does not serve is not available, and the agent can call nothing on it. Only an authorized connection holds the profile write scope. The person authorizes the connection on the app's page, with or without the profile write scope. A public tool works before authorization and with a live grant, and it answers that an app is not available when the connection does not list it or when the agent names an app that is not in the app registry. A member tool without a grant, or without the scope that it needs, answers that the person must sign in on the app's page and allow access. After a grant ends, every call with the old token answers the same, a public tool included, until the person connects again.

```quint
type ConnectionPhase = Unbound | Unavailable | Anonymous | Connected | Revoked
type ToolResult =
  NoResult | PublicFacts | AppNotAvailable | SignInNeeded | StatusShown | ProfileAccepted |
  ProfileNotForStatus | DraftSaved | DraftRefused | UpdatesShown | TooManyToday | SavedProfileShown | SavedProfileUnavailable
type Connection = {
  phase: ConnectionPhase,
  host: AppId,
  surface: Surface,
  hasWrite: bool,
  hasProfileRead: bool,
  status: MemberStatus,
  profileApproved: bool,
  profileSent: bool,
  sentToday: int,
  draftPrepared: bool,
  tokenUnseen: bool,
  otherUnseen: bool,
  lastShown: int,
  lastResult: ToolResult
}
pure val initial: Connection = {
  phase: Unbound, host: Ntwrk, surface: FullSurface, hasWrite: false, hasProfileRead: false, status: NotJoined,
  profileApproved: false, profileSent: false, sentToday: 0, draftPrepared: false,
  tokenUnseen: false, otherUnseen: false, lastShown: 0, lastResult: NoResult
}

pure def bound(c: Connection): bool = c.phase == Anonymous or c.phase == Connected or c.phase == Revoked

pure def canConnect(c: Connection): bool = c.phase == Unbound

pure def connect(c: Connection, host: AppId, surface: Surface, openAiEnabled: bool): Connection =
  { ...c, host: host, surface: surface, phase: if (configuredHostServes(surface, host, openAiEnabled)) Anonymous else Unavailable }

pure def lawDisabledOpenAiHostIsUnavailable(c: Connection, host: AppId): bool =
  connect(c, host, OpenAiSurface, false).phase == Unavailable

pure def canAuthorize(c: Connection): bool = c.phase == Anonymous or c.phase == Revoked

pure def authorize(c: Connection, withWrite: bool, withProfileRead: bool): Connection =
  { ...c, phase: Connected, hasWrite: withWrite, hasProfileRead: withProfileRead, sentToday: 0, draftPrepared: false, lastResult: NoResult }

pure def canCallPublicTool(c: Connection, tool: ToolName): bool =
  (c.phase == Anonymous or c.phase == Connected) and scopeFor(tool) == NoScope

pure def callPublicTool(c: Connection, tool: ToolName, app: AppId, appRegistered: bool): Connection =
  { ...c, lastResult: if (appRegistered and appListed(c.surface, c.host, app)) PublicFacts else AppNotAvailable }

pure def lawUnregisteredAppIsNotAvailable(c: Connection, tool: ToolName, app: AppId): bool =
  callPublicTool(c, tool, app, false).lastResult == AppNotAvailable

pure def lawOpenAiPluginServerNeverNamesSlop(c: Connection, tool: ToolName): bool =
  (c.surface == OpenAiSurface and c.host != Slop) implies callPublicTool(c, tool, Slop, true).lastResult == AppNotAvailable

pure def canCallWithoutAccess(c: Connection, tool: ToolName): bool =
  bound(c) and toolListed(c.host, c.surface, tool) and
  ((c.phase == Anonymous and scopeFor(tool) != NoScope) or
   c.phase == Revoked or
   (c.phase == Connected and not(grantCovers(tool, true, c.hasWrite, c.hasProfileRead))))

pure def callWithoutAccess(c: Connection, tool: ToolName): Connection =
  { ...c, lastResult: SignInNeeded }

pure def alwaysBoundHostIsServed(c: Connection): bool =
  bound(c) implies hostServes(c.surface, c.host)

pure def alwaysWriteNeedsConnection(c: Connection): bool =
  c.hasWrite implies c.phase == Connected

pure def alwaysUnboundHasNoDraft(c: Connection): bool =
  c.phase == Unbound implies not(c.draftPrepared)
```

### A grant that no longer belongs to the phone's person ends the connection

When the phone's owner changed after the person connected, the next authenticated call ends the grant and answers that the person must sign in again. This happens before checking the requested tool's scope, arguments or quota. Changes include a person becoming attached to a phone which had no person at approval. While ownership is under staff review, the credential cannot act and the grant stays available for the ownership decision. An unavailable ownership lookup gives a temporary refusal without ending the grant. The person can connect again in the browser.

```quint
type GrantOwnerDecision = GrantOwnerMatches | GrantOwnerChanged | GrantOwnerHeld | GrantOwnerUnavailable

pure def decideGrantOwner(available: bool, held: bool, samePerson: bool): GrantOwnerDecision =
  if (not(available)) GrantOwnerUnavailable
  else if (held) GrantOwnerHeld
  else if (samePerson) GrantOwnerMatches
  else GrantOwnerChanged

pure def lawOnlyObservedOwnerChangeEndsGrant(available: bool, held: bool, samePerson: bool): bool =
  (decideGrantOwner(available, held, samePerson) == GrantOwnerChanged) iff (available and not(held) and not(samePerson))

pure def canCallAfterOwnerChange(c: Connection): bool = c.phase == Connected

pure def callAfterOwnerChange(c: Connection): Connection =
  { ...c, phase: Revoked, hasWrite: false, hasProfileRead: false, lastResult: SignInNeeded }

pure def memberResult(r: ToolResult): bool =
  r == StatusShown or r == ProfileAccepted or r == ProfileNotForStatus or r == DraftSaved or
  r == DraftRefused or r == UpdatesShown or r == TooManyToday or r == SavedProfileShown or r == SavedProfileUnavailable

pure def alwaysMemberResultsNeedConnection(c: Connection): bool =
  memberResult(c.lastResult) implies c.phase == Connected
```

### Check status shows only the person's own status in this one app

`check_status` answers with the status and its next step for the host app only. Membership changes outside the connection (a join on the site, STOP, a hold) show on the next call.

```quint
pure val newStatusValues = Set(NotJoined, Invited, Onboarding, Active, Stopped, OnHold)

pure def canCallCheckStatus(c: Connection): bool = c.phase == Connected

pure def callCheckStatus(c: Connection): Connection = { ...c, lastResult: StatusShown }

pure def canChangeMemberStatus(c: Connection, newStatus: MemberStatus): bool =
  bound(c) and newStatus != c.status

pure def changeMemberStatus(c: Connection, newStatus: MemberStatus): Connection =
  { ...c, status: newStatus }
```

### Read saved profile fields only for this app's active member

`read_profile` reads the grant owner's saved first name, about text, interests and general location for this app. The platform rechecks the current phone, member, age, restrictions and app consent. The MCP response includes only safe saved text. It excludes pending drafts, contact details, verification codes, private engine facts and photos. A refused or empty read returns a null profile. The read leaves profile and conversation state unchanged.

```quint
pure def canCallReadProfile(c: Connection): bool = c.phase == Connected and c.hasProfileRead

pure def callReadProfile(c: Connection, currentMembership: bool, safeFields: bool): Connection =
  { ...c, lastResult: if (toolAllowedFor(ReadProfileTool, c.status) and currentMembership and safeFields) SavedProfileShown else SavedProfileUnavailable }

pure def stepSavedProfileNeedsReadAuthority(before: Connection, via: str, after: Connection): bool =
  (after.lastResult == SavedProfileShown and before.lastResult != SavedProfileShown) implies
    (via == "callReadProfile" and before.phase == Connected and before.hasProfileRead and before.status == Active)

pure def sometimesSavedProfileShown(c: Connection): bool = c.lastResult == SavedProfileShown
```

### The agent sends an approved profile once, only for a live member, within the daily limit

The agent reads the profile back and the person approves it before the agent calls `submit_profile`. The profile is the person's own words, without a phone number, a code or an email address. For an onboarding or active member, the app takes the profile once. The agent does not send the same approved profile again. For any other status, nothing is sent and the answer gives the status and its next step. Check the exact phone owner and any current opt-out again before forwarding a claimed profile to the app. A grant can make at most five well-formed profile or draft calls in one day. A refused call counts too. The limit is reached when the grant made five such calls today. A further call answers that the limit is reached and sends nothing. Each authorization makes a new grant, which starts its own count.

```quint
pure val profileDailyCap = 5
pure val weight_callSubmitProfile = 20
pure val weight_approveProfile = 10

pure def profileLimitReached(sentToday: int): bool = sentToday >= profileDailyCap

pure def canApproveProfile(c: Connection): bool = not(c.profileApproved) or c.profileSent

pure def approveProfile(c: Connection): Connection = { ...c, profileApproved: true, profileSent: false }

pure def canCallSubmitProfile(c: Connection): bool =
  c.phase == Connected and c.hasWrite and c.profileApproved and not(c.profileSent)

pure def callSubmitProfile(c: Connection, accepted: bool): Connection =
  if (profileLimitReached(c.sentToday)) { ...c, lastResult: TooManyToday }
  else if (liveMember(c.status) and accepted)
    { ...c, sentToday: c.sentToday + 1, profileSent: true, lastResult: ProfileAccepted }
  else { ...c, sentToday: c.sentToday + 1, lastResult: ProfileNotForStatus }

pure def canStartNewDay(c: Connection): bool = c.sentToday > 0

pure def startNewDay(c: Connection): Connection = { ...c, sentToday: 0 }

pure def alwaysSentProfileWasApproved(c: Connection): bool = c.profileSent implies c.profileApproved

pure def alwaysDailyProfileCap(c: Connection): bool = c.sentToday >= 0 and c.sentToday <= profileDailyCap

pure def stepSubmitOnlyForLiveMember(before: Connection, via: str, after: Connection): bool =
  (after.profileSent and not(before.profileSent)) implies
    (via == "callSubmitProfile" and liveMember(before.status) and before.phase == Connected and
     before.hasWrite and before.profileApproved)

pure def stepNothingSentAtTheLimit(before: Connection, via: str, after: Connection): bool =
  (before.sentToday >= profileDailyCap and (via == "callSubmitProfile" or via == "callPrepareSignup")) implies
    (after.lastResult == TooManyToday and after.profileSent == before.profileSent and
     after.draftPrepared == before.draftPrepared and after.sentToday == before.sentToday)
```

### A Join draft holds only an approved first name and home city, once per grant

On friends.help and ntwrk.party, `prepare_signup` saves only the first name and the optional home city that the person approved. It never creates a person, a membership or text consent. It needs a join age that the app allows and a person who is not joined or invited. A grant saves at most one draft. The call counts toward the daily limit. Both sites have retired their browser Join page. The reply uses the same live app signup link as `start_signup`, selected by [site enrollment](siteEnrollment.md), and asks the person to continue in their agent. The saved draft does not prefill that flow.

```quint
pure def canCallPrepareSignup(c: Connection): bool =
  c.phase == Connected and c.hasWrite and (c.host == Friends or c.host == Ntwrk)

pure def callPrepareSignup(c: Connection, joinAgeAllowed: bool): Connection =
  if (profileLimitReached(c.sentToday)) { ...c, lastResult: TooManyToday }
  else if (joinAgeAllowed and toolAllowedFor(PrepareSignupTool, c.status) and not(c.draftPrepared))
    { ...c, sentToday: c.sentToday + 1, draftPrepared: true, lastResult: DraftSaved }
  else { ...c, sentToday: c.sentToday + 1, lastResult: DraftRefused }

pure def alwaysDraftOnlyOnFriendsOrNtwrk(c: Connection): bool =
  c.draftPrepared implies (c.host == Friends or c.host == Ntwrk)
```

### Reading updates shows the person's own new updates and marks them seen

`get_updates` shows the host app's unseen updates and marks them seen. An update reference from a text, such as T-7F3K9Q, narrows the answer to that update. The reference is not a credential: a reference of another person, or an unknown or expired one, shows nothing and marks nothing, the same as an empty inbox. The agent never asks for a reference.

```quint
type UpdateRead = { shown: int, tokenLeft: bool, otherLeft: bool }

pure def readUpdates(tokenUnseen: bool, otherUnseen: bool, tokenGiven: bool, tokenOwn: bool): UpdateRead =
  if (not(tokenGiven))
    { shown: (if (tokenUnseen) 1 else 0) + (if (otherUnseen) 1 else 0), tokenLeft: false, otherLeft: false }
  else if (tokenOwn) { shown: if (tokenUnseen) 1 else 0, tokenLeft: false, otherLeft: otherUnseen }
  else { shown: 0, tokenLeft: tokenUnseen, otherLeft: otherUnseen }

pure def canCallGetUpdates(c: Connection): bool = c.phase == Connected

pure def callGetUpdates(c: Connection, tokenGiven: bool, tokenOwn: bool): Connection =
  val r = readUpdates(c.tokenUnseen, c.otherUnseen, tokenGiven, tokenOwn)
  { ...c, tokenUnseen: r.tokenLeft, otherUnseen: r.otherLeft, lastShown: r.shown, lastResult: UpdatesShown }

pure def canReceiveUpdate(c: Connection): bool = bound(c)

pure def receiveUpdate(c: Connection, forReference: bool): Connection =
  if (forReference) { ...c, tokenUnseen: true } else { ...c, otherUnseen: true }

pure def lawUntokenedReadMarksAllSeen(tokenUnseen: bool, otherUnseen: bool, tokenOwn: bool): bool =
  val r = readUpdates(tokenUnseen, otherUnseen, false, tokenOwn)
  not(r.tokenLeft) and not(r.otherLeft)

pure def lawForeignReferenceShowsNothing(tokenUnseen: bool, otherUnseen: bool): bool =
  val r = readUpdates(tokenUnseen, otherUnseen, true, false)
  r.shown == 0 and r.tokenLeft == tokenUnseen and r.otherLeft == otherUnseen

pure def alwaysShownCountIsSmall(c: Connection): bool = c.lastShown >= 0 and c.lastShown <= 2

pure def stepReadingNeverAddsUnseen(before: Connection, via: str, after: Connection): bool =
  via == "callGetUpdates" implies
    ((after.tokenUnseen implies before.tokenUnseen) and (after.otherUnseen implies before.otherUnseen))
```

### A connection can reach every tool result

The supported paths include a sent profile, a refused profile, the daily limit, a saved and a refused draft, shown updates, a sign-in request, an unavailable host and an ended grant.

```quint
pure def sometimesProfileAccepted(c: Connection): bool = c.lastResult == ProfileAccepted
pure def sometimesProfileNotForStatus(c: Connection): bool = c.lastResult == ProfileNotForStatus
pure def sometimesTooManyToday(c: Connection): bool = c.lastResult == TooManyToday
pure def sometimesDraftSaved(c: Connection): bool = c.lastResult == DraftSaved
pure def sometimesDraftRefused(c: Connection): bool = c.lastResult == DraftRefused
pure def sometimesTwoUpdatesShown(c: Connection): bool = c.lastResult == UpdatesShown and c.lastShown == 2
pure def sometimesStatusShown(c: Connection): bool = c.lastResult == StatusShown
pure def sometimesSignInNeeded(c: Connection): bool = c.lastResult == SignInNeeded
pure def sometimesAppNotAvailable(c: Connection): bool = c.lastResult == AppNotAvailable
pure def sometimesHostUnavailable(c: Connection): bool = c.phase == Unavailable
pure def sometimesRevoked(c: Connection): bool = c.phase == Revoked
```
