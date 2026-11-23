# Sign up through the person's own agent

A person asks their own agent to help join an app. The agent drafts the profile in conversation. For ntwrk.party, slop.date and friends.help, the app's native connector brings the person to their own browser for phone confirmation, enrollment and authorization. The browser owns credentials and signup consent. A narrowly authorized connector records the approved profile through MCP afterward. [The signup handoff](agentPhoneHandoff.md) and [connector tools](connectorTools.md) define the serving rules. The agent never uses a website account portal, a direct phone API or a private cookie jar.

The site build checks each served skill's step markers against this model. This checks documented step order. The app and connector independently enforce membership and OAuth authority on each request. The model keeps no phone numbers, codes, invitation secrets or profile values.

## Story: Join through my agent and confirm my own phone

> As a person asking my agent to sign me up, I want to approve my draft in conversation, confirm my phone and choose access in my browser, then know what was recorded.

### The selected app determines the available transport

The three native connector skills require that exact app's supported connector. Reading a skill gives no tools or grants. When the agent does not have the app's connector tools, it first checks whether the client can add a remote connector. If the client can add one, the agent tells the person to add this app's own endpoint in the client's connector settings, and then to continue in the same conversation. This endpoint is on ntwrk.party for every app ([connector tools](connectorTools.md)): `https://ntwrk.party/mcp` for The Network and `https://ntwrk.party/mcp/<app>` for each other app, with `/openai` added in ChatGPT. The skill names the endpoint and the app. The agent gives this setup step one time only. Only after this check can the agent choose a path without connector tools. A native skill without connector tools then stops before it asks for a profile, with "Signup isn't supported in this agent yet." The OpenAI surface serves every app, so a ChatGPT client gets the setup step for slop.date too. Peon retains its existing connector and Messages paths, pending separate production qualification.

```quint
import brandIdentity.* from "./brandIdentity"

type Transport = TransportUndecided | NativeConnectorHandoff | ConnectorHandoff | MessagesHandoff | NoTransport
type SkillKind = NativeConnectorSkill | PeonSkill
type ConnectorSetup = SetupNotChecked | SetupOffered | SetupImpossible
type AgeBand = AgeNotStated | Under13 | Teen | Adult
type SignupPhase =
  CheckingCapability | AwaitingConnector | Unsupported | ReadingApp | WrongApp |
  Drafting | BelowJoinAge | AwaitingApproval | Declined |
  ReadyForHandoff | HandedOff | CheckingStatus | ExistingMember |
  NeedsInvite | InvitationUnavailable | OnReview | MessagesStopped |
  SaveUnconfirmed | ReadyToSubmit | ConfirmingProfile | ProfileNotSent |
  Saved | HandedToMessages
type AgentSignup = {
  phase: SignupPhase,
  transport: Transport,
  connectorSetup: ConnectorSetup,
  age: AgeBand,
  inviteOnly: bool,
  approved: bool,
  minorNotified: bool,
  handoffs: int,
  browserEnrolled: bool,
  inviteAccepted: bool,
  submits: int
}
pure val initial: AgentSignup = {
  phase: CheckingCapability, transport: TransportUndecided, connectorSetup: SetupNotChecked, age: AgeNotStated, inviteOnly: false,
  approved: false, minorNotified: false, handoffs: 0, browserEnrolled: false, inviteAccepted: false, submits: 0
}

pure def skillKindFor(app: AppKey): SkillKind =
  if (app == Peon) PeonSkill else NativeConnectorSkill

pure def transportFor(skillKind: SkillKind, connectorTools: bool): Transport =
  if (skillKind == PeonSkill) (if (connectorTools) ConnectorHandoff else MessagesHandoff)
  else if (connectorTools) NativeConnectorHandoff else NoTransport

pure def lawNativeSkillRequiresItsConnector(connectorTools: bool): bool =
  (transportFor(NativeConnectorSkill, connectorTools) == NativeConnectorHandoff) iff connectorTools

pure def canCheckConnectorSetup(s: AgentSignup): bool =
  s.phase == CheckingCapability and s.connectorSetup == SetupNotChecked

pure def checkConnectorSetup(s: AgentSignup, clientCanAdd: bool): AgentSignup =
  if (clientCanAdd) { ...s, connectorSetup: SetupOffered, phase: AwaitingConnector }
  else { ...s, connectorSetup: SetupImpossible }

pure def canResumeAfterConnector(s: AgentSignup): bool = s.phase == AwaitingConnector

pure def resumeAfterConnector(s: AgentSignup): AgentSignup = { ...s, phase: CheckingCapability }

pure def canChooseTransport(s: AgentSignup, connectorTools: bool): bool =
  s.phase == CheckingCapability and (connectorTools or s.connectorSetup != SetupNotChecked)

pure def chooseTransport(s: AgentSignup, skillKind: SkillKind, connectorTools: bool): AgentSignup =
  val chosen = transportFor(skillKind, connectorTools)
  { ...s, transport: chosen, phase:
    if (chosen == NoTransport) Unsupported else if (chosen == NativeConnectorHandoff) ReadingApp else Drafting }

pure def alwaysTransportFixedAfterChoice(s: AgentSignup): bool =
  (s.phase == CheckingCapability or s.phase == AwaitingConnector) iff s.transport == TransportUndecided

pure def alwaysAwaitingConnectorWasOffered(s: AgentSignup): bool =
  s.phase == AwaitingConnector implies s.connectorSetup == SetupOffered

pure def alwaysNoConnectorPathFollowsSetupCheck(s: AgentSignup): bool =
  (s.transport == NoTransport or s.transport == MessagesHandoff) implies s.connectorSetup != SetupNotChecked

pure def canReadAppFacts(s: AgentSignup): bool = s.phase == ReadingApp and s.transport == NativeConnectorHandoff

pure def readAppFacts(s: AgentSignup, appMatches: bool, inviteMode: bool): AgentSignup =
  { ...s, inviteOnly: inviteMode, phase: if (appMatches) Drafting else WrongApp }
```

### A client without a transport stops

Discovered by the proof: a client without a supported transport stays stopped. Without this rule, the proof cannot exclude an approval that hands a person with no transport to Messages.

```quint
pure def alwaysNoTransportStops(s: AgentSignup): bool =
  s.transport == NoTransport implies s.phase == Unsupported
```

### The person approves the exact draft and current text consent

For the native connector path, read the selected app's public policy and exact text consent before drafting. Ask for the person's birthday, and use it in the conversation only to explain what the person gets. No tool receives a birthday or an age; the person types the birthday on the signup page. Use the lowest stated age. Below 13 stops the flow. Anyone 13 through 17 receives the minor notice: today they get their own help (answers, public events and plans for themselves), they are never matched on dates or for work, and friendship is the only kind of introduction that can open to people under 18, only with people close to their own age. The notice promises no introduction. The agent offers a person aged 13 through 17 neither dating nor work matching, and collects no dating preferences or photos from them. Draft the person's first name, confirmed supported city/region and neighborhood, and the app-specific profile. Obtain explicit approval for the exact draft and the current app consent. Changes return to drafting. Refusal ends the attempt. In Peon's Messages path, the person's own Messages app opens the approved text with the [Peon signup line](textEnrollment.md#a-prepared-peon-signup-names-its-app-on-a-separate-first-line). The person sends it.

```quint
pure def lowerBand(a: AgeBand, b: AgeBand): AgeBand =
  if (a == AgeNotStated) b
  else if (b == AgeNotStated) a
  else if (a == Under13 or b == Under13) Under13
  else if (a == Teen or b == Teen) Teen
  else Adult

pure val statedAgeValues = Set(Under13, Teen, Adult)

pure def canDraftProfile(s: AgentSignup, statedAge: AgeBand): bool =
  s.phase == Drafting and statedAge != AgeNotStated

pure def draftProfile(s: AgentSignup, statedAge: AgeBand): AgentSignup =
  val lowest = lowerBand(s.age, statedAge)
  { ...s, age: lowest, minorNotified: lowest == Teen,
    phase: if (lowest == Under13) BelowJoinAge else AwaitingApproval }

type Approval = ApproveExact | AskChanges | DeclineSignup

pure def canDecideApproval(s: AgentSignup): bool = s.phase == AwaitingApproval

pure def decideApproval(s: AgentSignup, decision: Approval): AgentSignup =
  if (decision == ApproveExact)
    { ...s, approved: true, phase:
      if (s.transport == NativeConnectorHandoff) ReadyForHandoff
      else if (s.transport == ConnectorHandoff) HandedOff
      else HandedToMessages }
  else if (decision == AskChanges) { ...s, phase: Drafting }
  else { ...s, phase: Declined }

pure def alwaysUnderThirteenStops(s: AgentSignup): bool =
  s.age == Under13 implies s.phase == BelowJoinAge

pure def alwaysMinorToldMatchingIsAdult(s: AgentSignup): bool =
  s.age == Teen implies s.minorNotified

pure def alwaysApprovedProfileHasJoinAge(s: AgentSignup): bool =
  (s.approved or s.phase == AwaitingApproval) implies (s.age == Teen or s.age == Adult)

pure def alwaysNothingSentBeforeApproval(s: AgentSignup): bool =
  not(s.approved) implies (s.handoffs == 0 and s.submits == 0)

pure def alwaysTextHandoffIsApproved(s: AgentSignup): bool =
  s.phase == HandedToMessages implies (s.approved and s.transport == MessagesHandoff)
```

### Nothing is approved before the person decides

Discovered by the proof: until the person approves the draft, the attempt has no approval. Without this rule, the proof cannot exclude a redraft below 13 that keeps an earlier approval, or a browser enrollment before the app facts are read.

```quint
pure def alwaysNoApprovalBeforeDecision(s: AgentSignup): bool =
  (s.phase == CheckingCapability or s.phase == AwaitingConnector or s.phase == ReadingApp or
   s.phase == Drafting or s.phase == AwaitingApproval)
    implies not(s.approved)
```

### The app's browser confirms the owner, enrolls if eligible and asks separately for connector access

The person gets one authorization link from the client's native connector. The agent uses its configured app endpoint and uses the link exactly as issued. The browser verifies the phone or uses a current valid session. In the eligible new member flow, the person confirms their enrollment details and separately accepts the app's current text consent and connector permission. Enter any required invitation only in the app's browser. The site determines whether the invitation and signup are eligible. A completed same-app enrollment and current write grant allow the agent to check connector status. The agent reads existing membership status without signing up again or resending a new profile. Refusal, a hold, wrong app, missing/invalid invitation, changed enrollment details and unconfirmed handoff all leave the draft unsent.

```quint
pure def canOfferHandoff(s: AgentSignup): bool =
  s.phase == ReadyForHandoff and s.approved and s.transport == NativeConnectorHandoff and s.handoffs == 0

pure def offerHandoff(s: AgentSignup, linkAvailable: bool): AgentSignup =
  if (linkAvailable) { ...s, phase: HandedOff, handoffs: 1 }
  else { ...s, phase: Unsupported }

type BrowserResult =
  BrowserNewOpen | BrowserNewInvited | BrowserExisting | BrowserWaiting | BrowserWrongApp |
  BrowserBelowAge | BrowserNeedsInvite | BrowserInvalidInvite | BrowserHeld | BrowserRefused | BrowserChanged

pure def canObserveBrowser(s: AgentSignup, result: BrowserResult): bool =
  s.phase == HandedOff and s.transport == NativeConnectorHandoff and
  (result != BrowserNewOpen or not(s.inviteOnly))

pure def observeBrowser(s: AgentSignup, result: BrowserResult, appWriteGrant: bool): AgentSignup =
  val enrolled = result == BrowserNewOpen or result == BrowserNewInvited
  { ...s, browserEnrolled: enrolled, inviteAccepted: result == BrowserNewInvited, phase:
    if (result == BrowserWaiting) HandedOff
    else if (result == BrowserWrongApp) WrongApp
    else if (result == BrowserBelowAge) BelowJoinAge
    else if (result == BrowserNeedsInvite) NeedsInvite
    else if (result == BrowserInvalidInvite) InvitationUnavailable
    else if (result == BrowserHeld) OnReview
    else if (result == BrowserRefused) Declined
    else if (result == BrowserChanged or not(appWriteGrant)) SaveUnconfirmed
    else CheckingStatus }

pure def alwaysNativeEnrollmentKeepsInvitationGate(s: AgentSignup): bool =
  (s.browserEnrolled and s.inviteOnly) implies s.inviteAccepted

pure def alwaysOneApprovedNativeHandoff(s: AgentSignup): bool =
  s.handoffs >= 0 and s.handoffs <= 1 and
  (s.handoffs > 0 implies (s.approved and s.transport == NativeConnectorHandoff))
```

### A native browser result follows the one handoff

Discovered by the proof: only the native browser step records a browser enrollment, and on the native connector path the browser step comes only after the one handoff. Without this rule, the proof cannot show that a native profile submission follows the handoff.

```quint
pure def alwaysBrowserStepFollowsHandoff(s: AgentSignup): bool =
  (s.browserEnrolled or (s.transport == NativeConnectorHandoff and s.phase == HandedOff))
    implies (s.transport == NativeConnectorHandoff and s.handoffs == 1)
```

### The connector submits once and reports saved only after the exact durable result

Call `check_status` on this app's connector. For newly enrolled members with current approval, only `onboarding` or `active` lets the agent send the approved profile once. `submit_profile` confirms the exact submitted text through its durable result. Use the same connector to confirm the app and live membership. A timeout, changed status or refusal remains unconfirmed and does not trigger a second write. The result says nothing about matching, introductions or profile fields the connector never read. Peon's existing connector handoff confirms its browser status and one profile submission on the same connector.

```quint
type SiteStatus = SiteNotJoined | SiteInvited | SiteOnboarding | SiteActive | SiteStopped | SiteOnHold

pure def canCheckSiteStatus(s: AgentSignup): bool =
  (s.phase == CheckingStatus and s.transport == NativeConnectorHandoff) or
  (s.phase == HandedOff and s.transport == ConnectorHandoff)

pure def checkSiteStatus(s: AgentSignup, siteApp: bool, siteStatus: SiteStatus): AgentSignup =
  { ...s, phase:
    if (not(siteApp)) WrongApp
    else if (siteStatus == SiteStopped) MessagesStopped
    else if (siteStatus == SiteOnHold) OnReview
    else if (siteStatus == SiteOnboarding or siteStatus == SiteActive)
      (if (s.transport == NativeConnectorHandoff and not(s.browserEnrolled)) ExistingMember else ReadyToSubmit)
    else if (s.transport == ConnectorHandoff) HandedOff
    else SaveUnconfirmed }

pure def canSubmitProfile(s: AgentSignup): bool =
  s.phase == ReadyToSubmit and s.approved and s.submits == 0 and
  (s.transport == ConnectorHandoff or (s.transport == NativeConnectorHandoff and s.browserEnrolled))

pure def submitProfile(s: AgentSignup, accepted: bool): AgentSignup =
  { ...s, submits: s.submits + 1, phase: if (accepted) ConfirmingProfile else ProfileNotSent }

pure def canConfirmProfile(s: AgentSignup): bool =
  s.phase == ConfirmingProfile and s.submits == 1

pure def confirmProfile(s: AgentSignup, stillLive: bool): AgentSignup =
  { ...s, phase: if (stillLive) Saved else SaveUnconfirmed }

pure def alwaysOneAuthorizedSubmission(s: AgentSignup): bool =
  s.submits >= 0 and s.submits <= 1 and
  (s.submits > 0 implies (s.approved and
    (s.transport == ConnectorHandoff or (s.handoffs == 1 and s.browserEnrolled and s.transport == NativeConnectorHandoff))))

pure def alwaysSavedNeedsConfirmedSave(s: AgentSignup): bool =
  s.phase == Saved implies (s.approved and s.submits == 1)

pure def alwaysExistingMemberKeepsProfile(s: AgentSignup): bool =
  s.phase == ExistingMember implies (not(s.browserEnrolled) and s.submits == 0)

pure def stepSavedFollowsConfirmation(before: AgentSignup, via: str, after: AgentSignup): bool =
  (after.phase == Saved and before.phase != Saved) implies via == "confirmProfile"
```

### No profile is sent before the status check allows it

Discovered by the proof: until the connector submits the profile, the attempt has no submission. Without this rule, the proof cannot exclude a browser result that removes the enrollment of a profile that was already sent.

```quint
pure def alwaysNothingSubmittedBeforeSubmit(s: AgentSignup): bool =
  (s.phase == ReadyForHandoff or s.phase == HandedOff or s.phase == CheckingStatus or s.phase == ReadyToSubmit)
    implies s.submits == 0
```

### Each skill ends with a truthful report

```quint
type SignupReport =
  ReportWorking | ReportSaved | ReportSaveUnconfirmed | ReportAlreadyMember | ReportUnderAge |
  ReportInviteNeeded | ReportInviteUnavailable | ReportOnHold | ReportStopped | ReportUnsupported |
  ReportNotSaved | ReportDeclined | ReportOtherApp | ReportSendTheText

pure def reportFor(phase: SignupPhase): SignupReport =
  if (phase == Saved) ReportSaved
  else if (phase == SaveUnconfirmed) ReportSaveUnconfirmed
  else if (phase == HandedToMessages) ReportSendTheText
  else if (phase == ExistingMember) ReportAlreadyMember
  else if (phase == BelowJoinAge) ReportUnderAge
  else if (phase == NeedsInvite) ReportInviteNeeded
  else if (phase == InvitationUnavailable) ReportInviteUnavailable
  else if (phase == OnReview) ReportOnHold
  else if (phase == MessagesStopped) ReportStopped
  else if (phase == Unsupported) ReportUnsupported
  else if (phase == ProfileNotSent) ReportNotSaved
  else if (phase == Declined) ReportDeclined
  else if (phase == WrongApp) ReportOtherApp
  else ReportWorking

pure def endReportFor(transport: Transport): SignupReport =
  if (transport == NativeConnectorHandoff or transport == ConnectorHandoff) ReportSaved
  else if (transport == MessagesHandoff) ReportSendTheText
  else ReportUnsupported

pure def lawOnlySavedReportsSuccess(phase: SignupPhase): bool =
  (reportFor(phase) == ReportSaved) iff (phase == Saved)

pure def stepFinishedStaysFinished(before: AgentSignup, via: str, after: AgentSignup): bool =
  (reportFor(before.phase) != ReportWorking) implies after == before

pure def sometimesSavedThroughNativeConnector(s: AgentSignup): bool =
  s.phase == Saved and s.transport == NativeConnectorHandoff and not(s.inviteOnly)
pure def sometimesSavedWithBrowserInvitation(s: AgentSignup): bool =
  s.phase == Saved and s.transport == NativeConnectorHandoff and s.inviteOnly and s.inviteAccepted
pure def sometimesSavedThroughPeonConnector(s: AgentSignup): bool =
  s.phase == Saved and s.transport == ConnectorHandoff
pure def sometimesHandedToMessages(s: AgentSignup): bool = s.phase == HandedToMessages
pure def sometimesExistingMember(s: AgentSignup): bool = s.phase == ExistingMember
pure def sometimesUnconfirmed(s: AgentSignup): bool = s.phase == SaveUnconfirmed
pure def sometimesNeedsInvite(s: AgentSignup): bool = s.phase == NeedsInvite
pure def sometimesInvitationUnavailable(s: AgentSignup): bool = s.phase == InvitationUnavailable
pure def sometimesOnReview(s: AgentSignup): bool = s.phase == OnReview
pure def sometimesBelowJoinAge(s: AgentSignup): bool = s.phase == BelowJoinAge
pure def sometimesTeenApproved(s: AgentSignup): bool = s.age == Teen and s.approved
pure def sometimesUnsupported(s: AgentSignup): bool = s.phase == Unsupported
pure def sometimesAwaitingConnector(s: AgentSignup): bool = s.phase == AwaitingConnector
pure def sometimesSavedAfterConnectorSetup(s: AgentSignup): bool =
  s.phase == Saved and s.transport == NativeConnectorHandoff and s.connectorSetup == SetupOffered
pure def sometimesUnsupportedWithoutConnectorSupport(s: AgentSignup): bool =
  s.phase == Unsupported and s.connectorSetup == SetupImpossible
pure def sometimesDeclined(s: AgentSignup): bool = s.phase == Declined
pure def sometimesWrongApp(s: AgentSignup): bool = s.phase == WrongApp
pure def sometimesProfileNotSent(s: AgentSignup): bool = s.phase == ProfileNotSent
pure def sometimesMessagesStopped(s: AgentSignup): bool = s.phase == MessagesStopped
```
