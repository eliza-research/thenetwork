# Connector tools as the agent sees them

Each app site has its own MCP connector. A connection covers that one app (the host). The MCP server owns the tool list, the argument checks, the scope checks, the daily profile limit and the answers. The OAuth pages own sign-in and consent ([connector browser authorization](oauthBrowserAuthorization.md)). The platform owns the membership status, the profile intake and the single update inbox. This spec models which tools the agent can see and call, what each call does for each member status, and what the agent can observe after the call. The tokens, the grant storage and the minor rules of the inbox are in the OAuth and inbox models.

The MCP server (`packages/mcp/src/tools.ts` and `packages/mcp/src/handler.ts`) calls these decisions: `toolListed` for the tool list, `scopeFor` for the scope of each tool and its security scheme, `grantCovers` for the sign-in answer, the `canCall…` guards before each member tool call (a public tool needs no grant, and an anonymous or connected connection can call it), `profileLimitReached` for the daily limit, `appOffered` and `hostServes` for the apps and hosts of a surface, and `toolAllowedFor` and `nextStepFor` for the member status. The shell owns these parts of the model, and does not keep them as state:

- The connection. The shell finds the host from the request host and the surface from the path (`connect`). The OAuth pages make the grant (`authorize`, [connector browser authorization](oauthBrowserAuthorization.md)). For each request, the shell makes one connection from the access token: connected with a token, anonymous without one, and with the profile write scope only when the token holds it.
- The approved profile. The agent reads the profile back and gets the person's approval before it calls `submit_profile` (`approveProfile`). The server cannot see this approval. The shell keeps a grant-bound keyed receipt for each exact profile ([profile submission](mcpProfileSubmission.md)) so retries do not repeat intake.
- The day. The store counts the profile calls of one grant in a fixed window of 24 hours. The count of the earlier calls in the window is `sentToday`. A new window starts the count at zero, which is `startNewDay`. The store also counts a call that the limit refuses, but that call is in a window that is already at the limit, so the limit does not change.
- The member status, the owner change and the updates. The platform reads the status on each call (`changeMemberStatus`). Credential admission checks ownership before applying scopes, argument checks or limits, so the first authenticated call after a change ends the grant (`callAfterOwnerChange`). The platform inbox keeps the unseen updates, reads them and marks them seen (`receiveUpdate`, `readUpdates`, `callGetUpdates`).

## Story: Use my app's connector from my agent

> As a person who connected my agent to an app, I want the agent to see only the tools that fit my app and my status, so that it can check my status, send my approved profile once and read my own updates without seeing my phone number or code.

### Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date

There are two surfaces. The full surface, at `https://<site>/mcp`, offers every app. The OpenAI surface, at `https://<site>/mcp/openai`, serves ChatGPT and Codex clients. It hides slop.date: it never lists slop.date as an app choice, and the slop.date site has no OpenAI surface. The OpenAI plugin uses the ntwrk.party endpoint ([agent entry](agentEntry.md)). Every host that a surface serves lists the public tools and the member tools. Changed: the Join draft tool is gone, because no page or form read the draft it saved (audit MCP16 and SIG46); a person who has not joined finishes signup on the connection page.

The app registry can disable an otherwise available OpenAI host. Check this setting on every request bound to the OpenAI surface, including when that surface is served at `/mcp`. A connection to a disabled OpenAI host is not available. The full surface applies the ordinary host rule. The shell refuses a request to a host that is not available before it lists or calls a tool, so the tool list of an available host uses the ordinary host rule.

```quint
type AppId = Ntwrk | Slop | Peon | Friends
type Surface = FullSurface | OpenAiSurface
type ToolName = AppInfoTool | StartSignupTool | CheckStatusTool | ReadProfileTool | SubmitProfileTool | GetUpdatesTool

pure def appOffered(surface: Surface, app: AppId): bool = surface == FullSurface or app != Slop

pure def hostServes(surface: Surface, host: AppId): bool = appOffered(surface, host)

pure def configuredHostServes(surface: Surface, host: AppId, openAiEnabled: bool): bool =
  hostServes(surface, host) and (surface != OpenAiSurface or openAiEnabled)

pure def lawConfiguredOptOutBlocksOpenAiHost(host: AppId): bool =
  not(configuredHostServes(OpenAiSurface, host, false))

pure def toolListed(host: AppId, surface: Surface, tool: ToolName): bool =
  hostServes(surface, host)

pure def lawOpenAiNeverOffersSlop(tool: ToolName): bool =
  not(appOffered(OpenAiSurface, Slop)) and not(toolListed(Slop, OpenAiSurface, tool))

pure def lawFullSurfaceOffersEveryApp(app: AppId): bool = appOffered(FullSurface, app)
```

### Public tools need no sign-in, and member tools need the person's own grant

`app_info` and `start_signup` return public facts only: what the app is, who can join, how to join, the ages and the legal links. They need no sign-in and take no personal details. `check_status` and `get_updates` need the membership read scope. `read_profile` needs its own explicitly authorized profile read scope. `submit_profile` needs the profile write scope. A grant covers a tool when the tool needs no scope, or when the grant holds the scope that the tool needs. Each grant covers the public tools, with or without scopes. A member tool without the right grant answers that the person must sign in on the app's page and allow access.

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

The agent sees one of six statuses: not joined, invited, onboarding, active, stopped or on hold. Every status can read its status and its updates. Only an onboarding or active member can send a profile. Each status has one next step that the agent tells the person: join or get an invitation when not joined, accept the invitation, reply to the last text, nothing to do, text START, or email support. The connector reads the effective consent of the grant's current verified phone in its app. An explicit opt-out makes an active or onboarding membership read as stopped even while the membership update is pending. A review or restriction still reads as on hold. A missing consent record does not create a stopped status. Changed: the join step now names a path that works from a live connection (audit MCP15). On The Network, slop.date and friends.help, the person disconnects the app in their agent, connects it again and chooses Finish signup on the connection page; on peon.biz, the person opens the app's join page. The text keyword stays a second path where the app has one.

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

pure def lawReadToolsServeEveryStatus(status: MemberStatus): bool =
  toolAllowedFor(AppInfoTool, status) and toolAllowedFor(StartSignupTool, status) and
  toolAllowedFor(CheckStatusTool, status) and toolAllowedFor(GetUpdatesTool, status)
```

### A connection binds to one host on one surface, and the person connects it in the browser

The agent first reaches one host on one surface. The host is fixed before any tool can act. A host that the surface does not serve is not available, and the agent can call nothing on it. Only an authorized connection holds the profile write scope. The person authorizes the connection on the app's page, with or without the profile write scope. A public tool works before authorization and with a live grant, and it answers that an app is not available when the surface does not offer it. A member tool without a grant, or without the scope that it needs, answers that the person must sign in on the app's page and allow access. After a grant ends, every call with the old token answers the same, a public tool included, until the person connects again.

```quint
type ConnectionPhase = Unbound | Unavailable | Anonymous | Connected | Revoked
type ToolResult =
  NoResult | PublicFacts | AppNotAvailable | SignInNeeded | StatusShown | ProfileAccepted |
  ProfileNotForStatus | UpdatesShown | TooManyToday | SavedProfileShown | SavedProfileUnavailable
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
  tokenUnseen: bool,
  otherUnseen: bool,
  lastShown: int,
  lastResult: ToolResult
}
pure val initial: Connection = {
  phase: Unbound, host: Ntwrk, surface: FullSurface, hasWrite: false, hasProfileRead: false, status: NotJoined,
  profileApproved: false, profileSent: false, sentToday: 0,
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
  { ...c, phase: Connected, hasWrite: withWrite, hasProfileRead: withProfileRead, sentToday: 0, lastResult: NoResult }

pure def canCallPublicTool(c: Connection, tool: ToolName): bool =
  (c.phase == Anonymous or c.phase == Connected) and scopeFor(tool) == NoScope

pure def callPublicTool(c: Connection, tool: ToolName, app: AppId): Connection =
  { ...c, lastResult: if (appOffered(c.surface, app)) PublicFacts else AppNotAvailable }

pure def canCallWithoutAccess(c: Connection, tool: ToolName): bool =
  bound(c) and toolListed(c.host, c.surface, tool) and
  ((c.phase == Anonymous and scopeFor(tool) != NoScope) or
   c.phase == Revoked or
   (c.phase == Connected and not(grantCovers(tool, true, c.hasWrite, c.hasProfileRead))))

pure def callWithoutAccess(c: Connection, tool: ToolName): Connection =
  { ...c, lastResult: SignInNeeded }

pure def alwaysOpenAiHidesSlop(c: Connection): bool =
  bound(c) implies hostServes(c.surface, c.host)

pure def alwaysWriteNeedsConnection(c: Connection): bool =
  c.hasWrite implies c.phase == Connected
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
  r == StatusShown or r == ProfileAccepted or r == ProfileNotForStatus or
  r == UpdatesShown or r == TooManyToday or r == SavedProfileShown or r == SavedProfileUnavailable

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

The agent reads the profile back and the person approves it before the agent calls `submit_profile`. The profile is the person's own words, without a phone number, a code or an email address. For an onboarding or active member, the app takes the profile once. The agent does not send the same approved profile again. For any other status, nothing is sent and the answer gives the status and its next step. Check the exact phone owner and any current opt-out again before forwarding a claimed profile to the app. A grant can make at most five well-formed profile calls in one day. A refused call counts too. The limit is reached when the grant made five such calls today. A further call answers that the limit is reached and sends nothing. Each authorization makes a new grant, which starts its own count.

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
  (before.sentToday >= profileDailyCap and via == "callSubmitProfile") implies
    (after.lastResult == TooManyToday and after.profileSent == before.profileSent and
     after.sentToday == before.sentToday)
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

### Request limits count each person's grant, and the client address has only a coarse ceiling

Changed: the limits used to count every request by its client address, so all people who use one hosted assistant shared one count and one person's traffic refused another's (audit MCP14). An MCP request with a verified access token counts against its grant. A request without a verified token reaches only public facts and counts against its address bucket; that limit is 600 a minute, because people behind one hosted assistant share the address before they connect. A token request counts against the grant of the code or refresh token that it presents. Every MCP and token request also counts against a coarse address ceiling, which only stops a flood from one address. A client registration counts against its address bucket, with a higher hourly limit when every redirect address belongs to a known assistant host. The browser authorization pages keep their address limit, because the person's own browser sends them.

```quint
type ConnectorLimitKey = AddressLimitKey | GrantLimitKey

pure val connectorAnonymousPerAddressMinute: int = 600
pure val connectorRequestsPerGrantMinute: int = 120
pure val connectorAddressCeilingMinute: int = 6000
pure val connectorTokenPerGrantMinute: int = 30
pure val connectorTokenAddressCeilingMinute: int = 600
pure val connectorRegisterPerAddressHour: int = 20
pure val connectorAssistantRegisterPerAddressHour: int = 1000

pure def connectorLimitKey(grantVerified: bool): ConnectorLimitKey =
  if (grantVerified) GrantLimitKey else AddressLimitKey

pure def connectorRegisterLimit(assistantRedirect: bool): int =
  if (assistantRedirect) connectorAssistantRegisterPerAddressHour else connectorRegisterPerAddressHour

pure def lawVerifiedRequestsCountPerGrant(grantVerified: bool): bool =
  (connectorLimitKey(grantVerified) == GrantLimitKey) iff grantVerified

pure def lawAddressCeilingAboveEachPersonLimit(assistantRedirect: bool): bool =
  connectorAddressCeilingMinute >= connectorRequestsPerGrantMinute and
  connectorAddressCeilingMinute >= connectorAnonymousPerAddressMinute and
  connectorTokenAddressCeilingMinute >= connectorTokenPerGrantMinute and
  connectorRegisterLimit(assistantRedirect) >= connectorRegisterPerAddressHour
```

### A connection can reach every tool result

The supported paths include a sent profile, a refused profile, the daily limit, shown updates, a sign-in request, an unavailable host and an ended grant.

```quint
pure def sometimesProfileAccepted(c: Connection): bool = c.lastResult == ProfileAccepted
pure def sometimesProfileNotForStatus(c: Connection): bool = c.lastResult == ProfileNotForStatus
pure def sometimesTooManyToday(c: Connection): bool = c.lastResult == TooManyToday
pure def sometimesTwoUpdatesShown(c: Connection): bool = c.lastResult == UpdatesShown and c.lastShown == 2
pure def sometimesStatusShown(c: Connection): bool = c.lastResult == StatusShown
pure def sometimesSignInNeeded(c: Connection): bool = c.lastResult == SignInNeeded
pure def sometimesAppNotAvailable(c: Connection): bool = c.lastResult == AppNotAvailable
pure def sometimesHostUnavailable(c: Connection): bool = c.phase == Unavailable
pure def sometimesRevoked(c: Connection): bool = c.phase == Revoked
```
