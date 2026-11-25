# Connector tools as the agent sees them

Each app has its own MCP connector. The ntwrk.party host serves the connector of every app, each app at its own path, and each app site also serves the connector of its own app. A connection covers one app (the host app). The MCP server owns the tool list, the argument checks, the scope checks, the daily profile limit and the answers. The OAuth pages own sign-in and consent ([connector browser authorization](oauthBrowserAuthorization.md)). The platform owns the membership status, the profile intake and the single update inbox. This spec models which tools the agent can see and call, what each call does for each member status, and what the agent can observe after the call. The tokens and the grant storage are in the OAuth and inbox models. The age and leak-gate outcome of each update that `get_updates` reads is here (`connectorUpdateOutcome`).

The MCP server (`packages/mcp/src/tools.ts` and `packages/mcp/src/handler.ts`) calls these decisions: `toolListed` for the tool list, `scopeFor` for the scope of each tool and its security scheme, `grantCovers` for the sign-in answer, the `canCall…` guards before each member tool call (a public tool needs no grant, and an anonymous or connected connection can call it), `profileLimitReached` for the daily limit, `appOffered` and `hostServes` for the apps and hosts of a surface, `appListed` for the apps that one connection names, `hostBindsApp` and `siteOffersOpenAi` for the app paths of each host, `grantServesApp` for the app of a token, and `toolAllowedFor` and `nextStepFor` for the member status. The shell owns these parts of the model, and does not keep them as state:

- The connection. The shell finds the host from the request host and the surface from the path (`connect`). The OAuth pages make the grant (`authorize`, [connector browser authorization](oauthBrowserAuthorization.md)). For each request, the shell makes one connection from the access token: connected with a token, anonymous without one, and with the profile write scope only when the token holds it.
- The approved profile. The agent reads the profile back and gets the person's approval before it calls `submit_profile` (`approveProfile`). The server cannot see this approval. The shell keeps a grant-bound keyed receipt for each exact profile ([profile submission](mcpProfileSubmission.md)) so retries do not repeat intake.
- The day. The store counts the profile and draft calls of one grant in a fixed window of 24 hours. The count of the earlier calls in the window is `sentToday`. A new window starts the count at zero, which is `startNewDay`. The store also counts a call that the limit refuses, but that call is in a window that is already at the limit, so the limit does not change.
- The member status, the owner change and the updates. The platform reads the status on each call (`changeMemberStatus`). Credential admission checks ownership before applying scopes, argument checks or limits, so the first authenticated call after a change ends the grant (`callAfterOwnerChange`). The platform inbox keeps the unseen updates, reads them and marks them seen (`receiveUpdate`, `readUpdates`, `callGetUpdates`).

## Story: Use my app's connector from my agent

> As a person who connected my agent to an app, I want the agent to see only the tools that fit my app and my status, so that it can check my status, send my approved profile once and read my own updates without seeing my phone number or code.

### Each surface lists only the apps it may offer, and the OpenAI surface never offers slop.date

There are two surfaces. The full surface, at `https://<site>/mcp`, offers every app. The OpenAI surface, at `https://<site>/mcp/openai`, serves ChatGPT and Codex clients. It hides slop.date: it never lists slop.date as an app choice, and the slop.date site has no OpenAI surface. The OpenAI plugin uses the ntwrk.party endpoint ([agent entry](agentEntry.md)). Every host that a surface serves lists the public tools and the member tools. Only the friends.help and ntwrk.party hosts list the Join draft tool. Only the slop.date app endpoints (slop.date/mcp and ntwrk.party/mcp/slop) list the two photo tools, `my_photos` and `photo_request`, and both are only on the full surface. Initialization and discovery name the photo tools only when this host and surface list them. Changed (owner decision 2026-11-22): the photo tools are new, and only slop.date keeps photos.

The app registry can disable an otherwise available OpenAI host. Check this setting on every request bound to the OpenAI surface, including when that surface is served at `/mcp`. A connection to a disabled OpenAI host is not available. The full surface applies the ordinary host rule. The shell refuses a request to a host that is not available before it lists or calls a tool, so the tool list of an available host uses the ordinary host rule. A ChatGPT connector that a person adds at `https://slop.date/mcp` (a registered client whose redirects all go to chatgpt.com or chat.openai.com) is a full-surface connection of the slop.date host, for every person, with the same tools and checks as every other full-surface connection, with one exception: its connection page does not offer browser signup, so a person who is not yet a slop.date member joins slop.date first and then connects. The slop.date site still has no OpenAI surface, and an OpenAI client of another kind stays unavailable on slop.date. Changed (owner decision 2026-11-22, "the connector opens to everyone"): before, only allowlisted adults (`MCP_CUSTOM_CHATGPT_SLOP`) could use this connector, with onboarding tools only; the allowlist and its extra checks are removed.

```quint
type AppId = Ntwrk | Slop | Peon | Friends
type Surface = FullSurface | OpenAiSurface
type ToolName = AppInfoTool | StartSignupTool | PrepareSignupTool | CheckStatusTool | ReadProfileTool | SubmitProfileTool | GetUpdatesTool |
  ListLookingForTool | PauseLookingForTool | ResumeLookingForTool | MyPhotosTool | PhotoRequestTool

pure def appOffered(surface: Surface, app: AppId): bool = surface == FullSurface or app != Slop

pure def hostServes(surface: Surface, host: AppId): bool = appOffered(surface, host)

pure def configuredHostServes(surface: Surface, host: AppId, openAiEnabled: bool): bool =
  hostServes(surface, host) and (surface != OpenAiSurface or openAiEnabled)

pure def lawConfiguredOptOutBlocksOpenAiHost(host: AppId): bool =
  not(configuredHostServes(OpenAiSurface, host, false))

pure def photoTool(tool: ToolName): bool = tool == MyPhotosTool or tool == PhotoRequestTool

pure def toolListed(host: AppId, surface: Surface, tool: ToolName): bool =
  hostServes(surface, host) and (tool != PrepareSignupTool or host == Friends or host == Ntwrk) and
  (not(photoTool(tool)) or host == Slop)

pure def lawPhotoToolsOnlyOnSlop(host: AppId, surface: Surface, tool: ToolName): bool =
  (photoTool(tool) and toolListed(host, surface, tool)) implies (host == Slop and surface == FullSurface)

pure def lawDraftOnlyOnFriendsAndNtwrk(host: AppId, surface: Surface): bool =
  toolListed(host, surface, PrepareSignupTool) implies (host == Friends or host == Ntwrk)

pure def lawOpenAiNeverOffersSlop(tool: ToolName): bool =
  not(appOffered(OpenAiSurface, Slop)) and not(toolListed(Slop, OpenAiSurface, tool))

pure def lawFullSurfaceOffersEveryApp(app: AppId): bool = appOffered(FullSurface, app)
```

### The ntwrk.party host serves every app at its own path, and a grant covers only its own app

All app connectors are on one server. Each skill names the ntwrk.party endpoint of its app: `https://ntwrk.party/mcp` for The Network, and `https://ntwrk.party/mcp/<app>` for slop, peon and friends. ChatGPT and Codex use the endpoint with `/openai` added for The Network, peon and friends. Slop has no public OpenAI endpoint on any host, and the OpenAI surface never lists its public tools or facts. A ChatGPT connector that a person adds at the full slop endpoint is open to everyone, with the rules of the full surface (owner decision 2026-11-22, "the connector opens to everyone"; no allowlist). The ntwrk.party host serves each app at its own full path. Each other site host serves only its own app, at `/mcp`. The endpoint path is the OAuth resource. The client sends this resource when authorization starts. The authorization request, the consent page, the grant and each token are for the app of that path. A grant covers only its own app: a token for one app is refused at the endpoint of another app, a public tool included. The rules of each app stay with the app: the join mode (The Network is invite-only on the web), bans, ages, the text consent and the profile limit.

```quint
pure val hubHost: AppId = Ntwrk

pure def hostBindsApp(host: AppId, app: AppId): bool = host == app or host == hubHost

pure def appListed(surface: Surface, host: AppId, app: AppId): bool =
  hostServes(surface, host) and appOffered(surface, app)

pure def siteOffersOpenAi(site: AppId, app: AppId): bool =
  hostBindsApp(site, app) and appOffered(OpenAiSurface, app)

pure def grantServesApp(grantApp: AppId, requestApp: AppId): bool = grantApp == requestApp

pure def lawHubServesEveryApp(app: AppId): bool = hostBindsApp(hubHost, app)

pure def lawAppSiteServesOnlyItsApp(host: AppId, app: AppId): bool =
  host != hubHost implies (hostBindsApp(host, app) iff host == app)

pure def lawHubOffersOnlySupportedOpenAiApps(app: AppId): bool =
  siteOffersOpenAi(hubHost, app) iff app != Slop

pure def lawNoSiteOffersSlopOnTheOpenAiSurface(site: AppId): bool =
  not(siteOffersOpenAi(site, Slop)) and not(appListed(OpenAiSurface, site, Slop))

pure def lawGrantNeverCrossesApps(grantApp: AppId, requestApp: AppId): bool =
  grantApp != requestApp implies not(grantServesApp(grantApp, requestApp))
```

### Public tools need no sign-in, and member tools need the person's own grant

`app_info` and `start_signup` return public facts only: what the app is, who can join, how to join, the ages and the legal links. They need no sign-in and take no personal details. `check_status` and `get_updates` need the membership read scope. `read_profile` and `list_looking_for` need the explicitly authorized profile read scope. `submit_profile`, `prepare_signup`, `pause_looking_for` and `resume_looking_for` need the profile write scope. `my_photos` and `photo_request` need the explicitly authorized photos scope (`photos:use`), which no other scope includes and no other tool needs. A grant covers a tool when the tool needs no scope, or when the grant holds the scope that the tool needs. Each grant covers the public tools, with or without scopes. A member tool without the right grant answers that the person must sign in on the app's page and allow access. Changed (owner decision 2026-11-22): the three looking-for tools are new; the list reads saved profile state, so it needs the profile read scope, and a pause or a resume changes it, so it needs the profile write scope. Changed (owner decision 2026-11-22): the photo tools are new and need their own scope, so that a person can give an agent the profile scopes without the photo list.

```quint
type Scope = NoScope | MembershipRead | ProfileWrite | ProfileRead | PhotosUse

pure def scopeFor(tool: ToolName): Scope =
  if (tool == AppInfoTool or tool == StartSignupTool) NoScope
  else if (tool == CheckStatusTool or tool == GetUpdatesTool) MembershipRead
  else if (tool == ReadProfileTool or tool == ListLookingForTool) ProfileRead
  else if (photoTool(tool)) PhotosUse
  else ProfileWrite

pure def lawPublicToolsNeedNoSignIn(tool: ToolName): bool =
  (scopeFor(tool) == NoScope) iff (tool == AppInfoTool or tool == StartSignupTool)

pure def grantCovers(tool: ToolName, hasRead: bool, hasWrite: bool, hasProfileRead: bool, hasPhotos: bool): bool =
  scopeFor(tool) == NoScope or (scopeFor(tool) == MembershipRead and hasRead) or
  (scopeFor(tool) == ProfileWrite and hasWrite) or (scopeFor(tool) == ProfileRead and hasProfileRead) or
  (scopeFor(tool) == PhotosUse and hasPhotos)

pure def lawGrantCoversPublicTools(tool: ToolName, hasRead: bool, hasWrite: bool, hasProfileRead: bool, hasPhotos: bool): bool =
  scopeFor(tool) == NoScope implies grantCovers(tool, hasRead, hasWrite, hasProfileRead, hasPhotos)

pure def lawProfileReadScopeIsSeparate(hasRead: bool, hasWrite: bool, hasPhotos: bool): bool =
  not(grantCovers(ReadProfileTool, hasRead, hasWrite, false, hasPhotos)) and not(grantCovers(ListLookingForTool, hasRead, hasWrite, false, hasPhotos))

pure def lawPhotoScopeIsSeparate(tool: ToolName, hasRead: bool, hasWrite: bool, hasProfileRead: bool, hasPhotos: bool): bool =
  (photoTool(tool) implies not(grantCovers(tool, hasRead, hasWrite, hasProfileRead, false))) and
  (not(photoTool(tool)) implies (grantCovers(tool, hasRead, hasWrite, hasProfileRead, hasPhotos) == grantCovers(tool, hasRead, hasWrite, hasProfileRead, false)))

pure def lawLookingForChangesNeedWrite(tool: ToolName): bool =
  (tool == PauseLookingForTool or tool == ResumeLookingForTool) implies scopeFor(tool) == ProfileWrite
```

### The member status decides which member tool can act

The agent sees one of six statuses: not joined, invited, onboarding, active, stopped or on hold. Every status can read its status and its updates. Only an onboarding or active member can send a profile. Only a person who is not joined or invited can prepare a Join draft. Only an active member can list, pause or resume what the app looks for on their behalf, see their photo list or ask to send a photo. Each status has one next step that the agent tells the person: join or get an invitation when not joined, accept the invitation, reply to the last text, nothing to do, text START, or email support. The connector reads the effective consent of the grant's current verified phone in its app. An explicit opt-out makes an active or onboarding membership read as stopped even while the membership update is pending. A review or restriction still reads as on hold. A missing consent record does not create a stopped status. Changed: the join step now names a path that works from a live connection (audit MCP15). On The Network, slop.date and friends.help, the person disconnects the app in their agent, connects it again and chooses Finish signup on the connection page; on peon.biz, the person opens the app's join page. The text keyword stays a second path where the app has one. Changed (owner decision 2026-11-22): the looking-for tools are new and serve only an active member, because a pause or a resume sends the person a text, and a stopped, held or onboarding member gets no such text. Changed (owner decision 2026-11-22): the photo tools serve only an active member, because a photo goes only to a match and a send request is confirmed by a text. Changed (owner decision 2026-11-22, answers A2 to A5): for an active member under 18, the nothing-to-do step is the notice that the line gives that member ([which introductions the app makes](textEnrollment.md#a-minor-hears-which-introductions-the-app-makes)), read from the network; before, the connector chose the text by app alone and promised friendship introductions while staff had stopped them or the age was in doubt. When the network cannot give the notice, the connector uses the notice for a stored doubt, which promises no introductions.

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
  else if (tool == ReadProfileTool or tool == ListLookingForTool or tool == PauseLookingForTool or tool == ResumeLookingForTool or photoTool(tool)) status == Active
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

pure def lawLookingForOnlyForActiveMembers(status: MemberStatus): bool =
  (toolAllowedFor(ListLookingForTool, status) or toolAllowedFor(PauseLookingForTool, status) or toolAllowedFor(ResumeLookingForTool, status))
    implies status == Active

pure def lawPhotoToolsOnlyForActiveMembers(status: MemberStatus): bool =
  (toolAllowedFor(MyPhotosTool, status) or toolAllowedFor(PhotoRequestTool, status)) implies status == Active

pure def lawReadToolsServeEveryStatus(status: MemberStatus): bool =
  toolAllowedFor(AppInfoTool, status) and toolAllowedFor(StartSignupTool, status) and
  toolAllowedFor(CheckStatusTool, status) and toolAllowedFor(GetUpdatesTool, status)
```

### A connection binds to one host on one surface, and the person connects it in the browser

The agent first reaches one host on one surface. The host is fixed before any tool can act. A host that the surface does not serve is not available, and the agent can call nothing on it. Only an authorized connection holds the profile write scope. The person authorizes the connection on the app's page, with or without the profile write scope. A public tool works before authorization and with a live grant, and it answers that an app is not available when the connection does not list it or when the agent names an app that is not in the app registry. A member tool without a grant, or without the scope that it needs, answers that the person must sign in on the app's page and allow access. After a grant ends, every call with the old token answers the same, a public tool included, until the person connects again.

```quint
type ConnectionPhase = Unbound | Unavailable | Anonymous | Connected | Revoked
type ToolResult =
  NoResult | PublicFacts | AppNotAvailable | SignInNeeded | StatusShown | ProfileAccepted |
  ProfileNotForStatus | DraftSaved | DraftRefused | UpdatesShown | TooManyToday | SavedProfileShown | SavedProfileUnavailable |
  LookingForUnavailable | LookingForShown | LookingForChanged | LookingForUnchanged |
  PhotoListShown | PhotoRequestAnswered | PhotoToolUnavailable
type Connection = {
  phase: ConnectionPhase,
  host: AppId,
  surface: Surface,
  hasWrite: bool,
  hasProfileRead: bool,
  hasPhotos: bool,
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
  phase: Unbound, host: Ntwrk, surface: FullSurface, hasWrite: false, hasProfileRead: false, hasPhotos: false, status: NotJoined,
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

pure def authorize(c: Connection, withWrite: bool, withProfileRead: bool, withPhotos: bool): Connection =
  { ...c, phase: Connected, hasWrite: withWrite, hasProfileRead: withProfileRead, hasPhotos: withPhotos, sentToday: 0, draftPrepared: false, lastResult: NoResult }

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
   (c.phase == Connected and not(grantCovers(tool, true, c.hasWrite, c.hasProfileRead, c.hasPhotos))))

pure def callWithoutAccess(c: Connection, tool: ToolName): Connection =
  { ...c, lastResult: SignInNeeded }

pure def alwaysBoundHostIsServed(c: Connection): bool =
  bound(c) implies hostServes(c.surface, c.host)

pure def alwaysWriteNeedsConnection(c: Connection): bool =
  c.hasWrite implies c.phase == Connected

pure def alwaysUnboundHasNoDraft(c: Connection): bool =
  c.phase == Unbound implies not(c.draftPrepared)

pure def alwaysPhotosNeedConnection(c: Connection): bool =
  c.hasPhotos implies c.phase == Connected
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
  { ...c, phase: Revoked, hasWrite: false, hasProfileRead: false, hasPhotos: false, lastResult: SignInNeeded }

pure def memberResult(r: ToolResult): bool =
  r == StatusShown or r == ProfileAccepted or r == ProfileNotForStatus or r == DraftSaved or
  r == DraftRefused or r == UpdatesShown or r == TooManyToday or r == SavedProfileShown or r == SavedProfileUnavailable or
  r == LookingForUnavailable or r == LookingForShown or r == LookingForChanged or r == LookingForUnchanged or
  r == PhotoListShown or r == PhotoRequestAnswered or r == PhotoToolUnavailable

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

### The agent can list the person's standing things and pause or resume one, but never close one

`list_looking_for` shows the things that the app looks for on the person's behalf in this one app: their active and paused wants, requests and job posts, each with a reference, and what they closed in the last 30 days. It changes nothing. `pause_looking_for` and `resume_looking_for` change one thing that the reference names, and only after the person asked in the conversation. The connector never closes anything: to close a thing for good, the person replies CLOSE to the text that the app sends, or texts the close command. The platform rechecks the current phone, member, ban, age and app consent on each call. The network decides the change ([standing change rule](standingIntentManagement.md)): at most three applied agent changes a day for each person across all grants, never a resume of a thing that the person closed, a resume for adults only, and no change to a job post. Each applied change sends the person one text with how to undo it; a change that the person cannot be told about (texts are off) is refused. A call that finds the thing already in the asked state changes nothing and sends nothing. The list text and each summary pass the output leak gate; a summary that fails is left out. Changed (owner decision 2026-11-22): before this rule the agent could not see what the app looked for, and the only way to end a want was profile text that an assistant wrote; now profile text only adds, and the person's own agent can pause and resume one named thing, which the person can undo. A result of another tool shows a summary of a standing thing only when the token holds the profile read scope: `submit_profile` then returns `looking_for` and `check_with_person`, and `pause_looking_for` and `resume_looking_for` return the changed item. With the profile write scope only, `submit_profile` returns empty lists and, when a submitted profile may not match what is active, a next step that asks the person to check by text, and a pause or a resume returns no item. Changed (owner decision 2026-11-22): before this sentence a grant with only the default profile write scope read the summaries through `submit_profile` and the change results, which went around the separate profile read consent.

```quint
pure def lookingForTool(tool: ToolName): bool =
  tool == ListLookingForTool or tool == PauseLookingForTool or tool == ResumeLookingForTool

pure def resultShowsLookingFor(hasProfileRead: bool): bool =
  grantCovers(ListLookingForTool, false, false, hasProfileRead, false)

pure def lawLookingForResultNeedsProfileRead(hasProfileRead: bool): bool =
  resultShowsLookingFor(hasProfileRead) == hasProfileRead

pure def canCallLookingForTool(c: Connection, tool: ToolName): bool =
  c.phase == Connected and lookingForTool(tool) and
    (if (tool == ListLookingForTool) c.hasProfileRead else c.hasWrite)

pure def callLookingForTool(c: Connection, tool: ToolName, currentMembership: bool, changed: bool): Connection =
  { ...c, lastResult:
    if (not(toolAllowedFor(tool, c.status)) or not(currentMembership)) LookingForUnavailable
    else if (tool == ListLookingForTool) LookingForShown
    else if (changed) LookingForChanged
    else LookingForUnchanged }

pure def stepLookingForChangeNeedsWriteAndActive(before: Connection, via: str, after: Connection): bool =
  (after.lastResult == LookingForChanged and before.lastResult != LookingForChanged) implies
    (via == "callLookingForTool" and before.phase == Connected and before.hasWrite and before.status == Active)

pure def stepLookingForListNeedsRead(before: Connection, via: str, after: Connection): bool =
  (after.lastResult == LookingForShown and before.lastResult != LookingForShown) implies
    (via == "callLookingForTool" and before.phase == Connected and before.hasProfileRead and before.status == Active)

pure def sometimesLookingForShown(c: Connection): bool = c.lastResult == LookingForShown
pure def sometimesLookingForChanged(c: Connection): bool = c.lastResult == LookingForChanged
pure def sometimesLookingForUnchanged(c: Connection): bool = c.lastResult == LookingForUnchanged
pure def sometimesLookingForUnavailable(c: Connection): bool = c.lastResult == LookingForUnavailable
```

### The agent sees the person's photo list and asks to send a photo, but never sees a photo and never confirms a send

On slop.date, `my_photos` shows the person's own photo list: for each photo its number, its name if the person gave one, the day it was added, and the first name and state of each match who was offered it (asked, checking, ready or opened). It never shows a photo id, a photo, a thumbnail, a link, a rating or anything about the match other than the first name. `photo_request` passes the person's own words about a photo, such as "send Maya the beach one". The service reads the words as it reads them on the text line, and texts the person the proposal with its check page link. The result says only that a text went, that a step was done (a name, a take-back), that the request was refused, or that photos are not available, with the reply text without any link. The agent can never confirm a send: only the person's YES to the text on their phone, or Send on the check page, is consent. The platform checks the current phone, the member, the ban, the app consent and the age on each call, and a person who is not a known adult gets the unavailable answer. Added (owner decision 2026-11-22): the person can review in their own agent which photos the app has and who has each, and ask for a send in their own words; the agent sees the list only with the separate photos scope, and never the photos.

```quint
pure val hasPhotosValues = Set(true, false)
pure val withPhotosValues = Set(true, false)
pure val adultMemberValues = Set(true, false)

pure def canCallPhotoTool(c: Connection, tool: ToolName): bool =
  c.phase == Connected and photoTool(tool) and c.hasPhotos and toolListed(c.host, c.surface, tool)

pure def callPhotoTool(c: Connection, tool: ToolName, currentMembership: bool, adultMember: bool): Connection =
  { ...c, lastResult:
    if (not(toolAllowedFor(tool, c.status)) or not(currentMembership) or not(adultMember)) PhotoToolUnavailable
    else if (tool == MyPhotosTool) PhotoListShown
    else PhotoRequestAnswered }

pure def stepPhotoToolNeedsPhotosScopeAndActive(before: Connection, via: str, after: Connection): bool =
  ((after.lastResult == PhotoListShown or after.lastResult == PhotoRequestAnswered) and after.lastResult != before.lastResult) implies
    (via == "callPhotoTool" and before.phase == Connected and before.hasPhotos and before.status == Active and before.host == Slop)

pure def sometimesPhotoListShown(c: Connection): bool = c.lastResult == PhotoListShown
pure def sometimesPhotoRequestAnswered(c: Connection): bool = c.lastResult == PhotoRequestAnswered
pure def sometimesPhotoToolUnavailable(c: Connection): bool = c.lastResult == PhotoToolUnavailable
```

### The agent sends an approved profile once, only for a live member, within the daily limit

The agent reads the profile back and the person approves it before the agent calls `submit_profile`. The profile is the person's own words, without a phone number, a code or an email address. For an onboarding or active member, the app takes the profile once. The agent does not send the same approved profile again. For any other status, nothing is sent and the answer gives the status and its next step. Check the exact phone owner and any current opt-out again before forwarding a claimed profile to the app. A grant can make at most five well-formed profile or draft calls in one day. A refused call counts too. The limit is reached when the grant made five such calls today. A further call answers that the limit is reached and sends nothing. Each authorization makes a new grant, which starts its own count. After the app takes the profile, the result lists what is active and what to check with the person only for a token with the profile read scope ([looking-for rule](#the-agent-can-list-the-persons-standing-things-and-pause-or-resume-one-but-never-close-one)). Changed (owner decision 2026-11-22): the list in this result now needs the profile read scope, as `list_looking_for` does.

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

On friends.help and ntwrk.party, `prepare_signup` saves only the first name and the optional home city that the person approved. It never creates a person, a membership or text consent. It needs a join age that the app allows and a person who is not joined or invited. A grant saves at most one draft. The call counts toward the daily limit. Both sites have retired their browser Join page. The reply asks the person to connect again and choose Finish signup on the connection page, and to continue in their agent. The reply keeps the draft fields in storage. A person who connects for the first time types their name and city. A verified browser authorization form can use a draft from an existing grant once, when it passes the [one-use signup form checks](authorizationPages.md#the-signup-form-shows-the-draft-that-the-person-approved-in-the-agent) and the [Finish signup keep or delete decision](mcpSignupDraft.md). Changed (audit MCP16 and SIG46): the reply and the tool description said that a Join page shows the draft; that page does not exist. Changed (merge with develop, 2026-11-24): develop added the one-use prefill of the Finish signup form from the draft.

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

### A reader who cannot be matched never reads an update about another member

The read decides each selected update from four facts: the update is current (its opportunity, if any, is still open), the reader's age allows the item (`readerAgeAllowed`), the update is about another member (it belongs to an opportunity), and its summary passes the output leak gate. For an item that is not a teen friendship item, the reader's age allows it only when the reader can be matched (a known age of 18 or more in this app). For a teen friendship item (an item with a minor that the age rule of spec/friendIntroAge.md admitted), the reader's age allows it only while the age rule holds for its roster now, while no stop is stored, for every reader, the adult partner included. So a person aged 13 to 17 reads about another member only for a current teen friendship item, and a person of unknown age never does. An update that is not current, or that is about another member while the reader's age does not allow the item, is retired: it is not shown and it is marked seen, so no later read on any surface shows it. An update about the reader only (a reminder, an event for themselves) stays readable at every age. Changed: before this rule the connector had no age check, and a member whose lowest age dropped to 13 to 17 still read earlier updates about adults (audit MCP54). Changed (owner decision 2026-11-22): the parameter `readerMatchable` is now `readerAgeAllowed`, because a minor may read about a current teen friendship item, and an adult reader of a teen friendship item reads about it only while the age rule holds for it. Changed (owner decision 2026-11-22, answers A2 to A5): the stored switch that two admins turned on is replaced by a stored stop, so a teen item is readable while no stop is stored.

```quint
type ConnectorUpdateOutcome = InboxUpdateShown | InboxUpdateRetired | InboxUpdateWithheld

pure def connectorUpdateOutcome(stillCurrent: bool, readerAgeAllowed: bool, aboutAnotherMember: bool, passesLeakGate: bool): ConnectorUpdateOutcome =
  if (not(stillCurrent) or (aboutAnotherMember and not(readerAgeAllowed))) InboxUpdateRetired
  else if (not(passesLeakGate)) InboxUpdateWithheld
  else InboxUpdateShown

pure def lawUnmatchableReaderNeverReadsAboutAnotherMember(stillCurrent: bool, passesLeakGate: bool): bool =
  connectorUpdateOutcome(stillCurrent, false, true, passesLeakGate) == InboxUpdateRetired

pure def lawOwnUpdateReadableAtEveryAge(readerAgeAllowed: bool): bool =
  connectorUpdateOutcome(true, readerAgeAllowed, false, true) == InboxUpdateShown

pure def lawShownUpdateIsCurrentSafeAndAllowed(stillCurrent: bool, readerAgeAllowed: bool, aboutAnotherMember: bool, passesLeakGate: bool): bool =
  connectorUpdateOutcome(stillCurrent, readerAgeAllowed, aboutAnotherMember, passesLeakGate) == InboxUpdateShown implies
    (stillCurrent and passesLeakGate and (readerAgeAllowed or not(aboutAnotherMember)))
```

### A withheld update stays unseen

A current update that the reader may read but whose summary fails the output leak gate (a phone number, an email address, an internal id or a machine timestamp) is withheld: it is not shown, and it is not marked seen. It stays in the inbox for staff and for a later safe render until it expires. The other updates of the same read are shown or retired as usual. Changed: the read used to mark every selected update seen before the gate dropped the summary, so a withheld update was lost on every surface (audit MCP55). The shared line's update read applies the same gate, so a withheld update is withheld on every surface. Changed: the shared line's read used to pass every summary, so an update that the connector withheld reached the text line unchecked (review of MCP55).

```quint
pure def connectorUpdateMarkedSeen(updateOutcome: ConnectorUpdateOutcome): bool = updateOutcome != InboxUpdateWithheld

pure def lawAllowedUpdateFailingGateStaysUnseen(readerAgeAllowed: bool, aboutAnotherMember: bool): bool =
  (readerAgeAllowed or not(aboutAnotherMember)) implies
    not(connectorUpdateMarkedSeen(connectorUpdateOutcome(true, readerAgeAllowed, aboutAnotherMember, false)))

pure def lawRetiredUpdateIsMarkedSeen(readerAgeAllowed: bool, aboutAnotherMember: bool, passesLeakGate: bool): bool =
  connectorUpdateMarkedSeen(connectorUpdateOutcome(false, readerAgeAllowed, aboutAnotherMember, passesLeakGate))

pure def lawFailedGateIsNeverShown(stillCurrent: bool, readerAgeAllowed: bool, aboutAnotherMember: bool): bool =
  connectorUpdateOutcome(stillCurrent, readerAgeAllowed, aboutAnotherMember, false) != InboxUpdateShown
```

### Request limits count each person's grant, and the client address has only a coarse ceiling

An MCP request with a verified access token counts against its grant. A request without a verified token reaches only public facts and counts against its address bucket; that limit is 600 a minute, because people behind one hosted assistant share the address before they connect. A token request counts against the grant of the code or refresh token that it presents. Every MCP and token request also counts against a coarse address ceiling, which only stops a flood from one address. A client registration counts against one of two registration buckets of its address. A registration whose every redirect address belongs to a known assistant host counts against the assistant bucket, which has the higher hourly limit; any other registration counts against the address bucket. The two buckets count separately, so one address can make both counts in the same hour, and any caller that gives only assistant redirect addresses uses the assistant bucket. The generated decision chooses the bucket, and the shell counts against the generated limit of that bucket. The browser authorization pages keep their address limit, because the person's own browser sends them. Changed (audits MCP14 and mcpSignup-r18-4): the limits counted every request by its client address, so all people who use one hosted assistant shared one count, and the shell chose the registration bucket itself.

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

type RegisterBucket = AssistantRegisterBucket | AddressRegisterBucket

pure def connectorRegisterBucket(assistantRedirect: bool): RegisterBucket =
  if (assistantRedirect) AssistantRegisterBucket else AddressRegisterBucket

pure def connectorRegisterLimit(bucket: RegisterBucket): int =
  if (bucket == AssistantRegisterBucket) connectorAssistantRegisterPerAddressHour else connectorRegisterPerAddressHour

pure def lawAssistantBucketOnlyForAssistantRedirects(assistantRedirect: bool): bool =
  (connectorRegisterBucket(assistantRedirect) == AssistantRegisterBucket) iff assistantRedirect

pure def lawVerifiedRequestsCountPerGrant(grantVerified: bool): bool =
  (connectorLimitKey(grantVerified) == GrantLimitKey) iff grantVerified

pure def lawAddressCeilingAboveEachPersonLimit(assistantRedirect: bool): bool =
  connectorAddressCeilingMinute >= connectorRequestsPerGrantMinute and
  connectorAddressCeilingMinute >= connectorAnonymousPerAddressMinute and
  connectorTokenAddressCeilingMinute >= connectorTokenPerGrantMinute and
  connectorRegisterLimit(connectorRegisterBucket(assistantRedirect)) >= connectorRegisterPerAddressHour
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
