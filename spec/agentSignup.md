# Sign up through the person's own agent

A person pastes a site prompt into their own agent (Claude, Codex, ChatGPT or another agent). The agent reads the app's SKILL.md and runs the signup conversation that this spec describes. The agent owns the conversation, the draft profile and the private cookie jar. The site API owns the app facts, the code delivery and check, the account state, the join and the read-back. For the connector transport, the app's page owns the phone check and the text consent, and the MCP server owns the status and the profile intake ([connector tools](connectorTools.md)). For the Messages transport, the person's own Messages app sends the profile to the shared text line. This spec models the decisions that the agent takes. It does not model what the agent says word for word.

## Story: Join an app without leaving my agent

> As a person who asked my agent to sign me up, I want the agent to draft my profile, get my approval, confirm my own phone and save the profile, so that I join the app in one conversation and know the true result.

### The skill's transport decides how the phone is confirmed, and a missing capability stops the flow before credentials

Three transports exist. The ntwrk.party, slop.date and friends.help skills use the in-agent transport: the agent sends HTTPS requests to the app's own site, keeps a private cookie session, and the person types the texted code into the conversation. The peon.biz skill uses the connector transport on a computer whose agent can use the app's connector: the person confirms the phone on the app's page, and the agent never sees the number or the code. On a phone, or when the agent cannot use the connector, the peon.biz skill uses the Messages transport: the agent gives one link that opens the person's Messages app with the approved profile, and the person sends it. Each skill lists its steps in this order, and the site build replays them against this model for each transport of the skill. The build fails when a skill lists a step that the model does not allow at that point, or when the steps do not end at the end report of the transport. The peon.biz skill describes an earlier path, and its active transport needs separate qualification (product policies, "Age, identity and enrollment"). A direct skill never falls back to the connector or to a text. If the agent of a direct skill cannot do HTTPS with a private session, the agent says "Signup isn't supported in this agent yet." and stops. It asks for no number, no code and no profile.

```quint
import brandIdentity.* from "./brandIdentity"

type Transport = TransportUndecided | InAgentCode | ConnectorHandoff | MessagesHandoff | NoTransport
type SkillKind = DirectHttpsSkill | BrowserConnectorSkill
type AgeBand = AgeNotStated | Under13 | Teen | Adult
type SignupPhase =
  CheckingCapability | Unsupported | ReadingApp | WrongApp |
  Drafting | BelowJoinAge | AwaitingApproval | Declined |
  CheckingSession | CheckingAuthMode | SignInUnavailable |
  AwaitingNumber | CodeNotSent | SecurityCheckBlocked | AwaitingCode | CodeRejected |
  ReadingAccount | ReadyToJoin | NeedsInvite | InvitationUnavailable | OnReview | JoinFailed | ExistingMember |
  ReadingBack | Saved | SavedDiffers | SaveUnconfirmed |
  HandedOff | ReadyToSubmit | ConfirmingProfile | ProfileNotSent | MessagesStopped |
  HandedToMessages
type AgentSignup = {
  phase: SignupPhase,
  transport: Transport,
  age: AgeBand,
  inviteOnly: bool,
  useInvitation: bool,
  approved: bool,
  minorNotified: bool,
  codeStarts: int,
  codeChecks: int,
  joins: int,
  submits: int
}
pure val initial: AgentSignup = {
  phase: CheckingCapability, transport: TransportUndecided, age: AgeNotStated, inviteOnly: false, useInvitation: false,
  approved: false, minorNotified: false, codeStarts: 0, codeChecks: 0, joins: 0, submits: 0
}

pure def transportFor(skillKind: SkillKind, httpsSession: bool, connectorTools: bool): Transport =
  if (skillKind == DirectHttpsSkill) (if (httpsSession) InAgentCode else NoTransport)
  else if (connectorTools) ConnectorHandoff else MessagesHandoff

pure def skillKindFor(app: AppKey): SkillKind =
  if (app == Peon) BrowserConnectorSkill else DirectHttpsSkill

pure def lawOnlyPeonSkillUsesTheConnector(app: AppKey): bool =
  (skillKindFor(app) == BrowserConnectorSkill) iff (app == Peon)

pure def canChooseTransport(s: AgentSignup): bool = s.phase == CheckingCapability

pure def chooseTransport(s: AgentSignup, skillKind: SkillKind, httpsSession: bool, connectorTools: bool): AgentSignup =
  val chosen = transportFor(skillKind, httpsSession, connectorTools)
  { ...s, transport: chosen, phase:
    if (chosen == NoTransport) Unsupported else if (chosen == InAgentCode) ReadingApp else Drafting }

pure def lawDirectSkillNeverFallsBack(httpsSession: bool, connectorTools: bool): bool =
  val chosen = transportFor(DirectHttpsSkill, httpsSession, connectorTools)
  chosen == InAgentCode or chosen == NoTransport

pure def lawConnectorSkillNeverUsesCodeInAgent(httpsSession: bool, connectorTools: bool): bool =
  val chosen = transportFor(BrowserConnectorSkill, httpsSession, connectorTools)
  chosen == ConnectorHandoff or chosen == MessagesHandoff

pure def alwaysTransportFixedAfterChoice(s: AgentSignup): bool =
  (s.phase == CheckingCapability iff s.transport == TransportUndecided) and
  (s.phase == Unsupported iff s.transport == NoTransport)

pure def alwaysNoCredentialsWithoutTransport(s: AgentSignup): bool =
  (s.transport == NoTransport or s.transport == TransportUndecided) implies
    (s.codeStarts == 0 and s.codeChecks == 0 and s.joins == 0 and s.submits == 0)
```

### In the in-agent transport, the agent reads the app's own facts before it drafts and stops when they name another app

In the in-agent transport, the agent reads the app facts from the skill's own origin: the app id, the join mode, the join age, the matching age and the current consent wording and version. If the facts name another app, the agent stops and submits nothing. An invite-only join mode is kept for the invite gate. The peon.biz skill reads no app facts: the agent starts to draft at once, and the status call on the app's own connection checks the app later.

```quint
pure def canReadAppFacts(s: AgentSignup): bool = s.phase == ReadingApp and s.transport == InAgentCode

pure def alwaysAppFactsOnlyInAgent(s: AgentSignup): bool =
  (s.phase == ReadingApp or s.inviteOnly) implies s.transport == InAgentCode

pure def readAppFacts(s: AgentSignup, appMatches: bool, inviteMode: bool): AgentSignup =
  { ...s, inviteOnly: inviteMode, phase: if (appMatches) Drafting else WrongApp }
```

### A stated age under 13 stops the flow, and a minor is told that matching is for adults

The agent drafts the profile only from facts the person confirmed, with an explicitly stated age. When the person states more than one age, the lowest age applies. Under 13, the agent explains that the person cannot join and stops before it asks for a number. At 13 to 17, the agent continues and tells the person that matching and introductions are for adults 18 and older only.

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

pure def alwaysUnderThirteenStops(s: AgentSignup): bool =
  s.age == Under13 implies s.phase == BelowJoinAge

pure def alwaysMinorToldMatchingIsAdult(s: AgentSignup): bool =
  s.age == Teen implies s.minorNotified

pure def alwaysApprovedProfileHasJoinAge(s: AgentSignup): bool =
  (s.approved or s.phase == AwaitingApproval) implies (s.age == Teen or s.age == Adult)
```

### Nothing leaves the conversation without explicit approval of the exact profile and text consent

The agent shows a short draft and the app's current text consent: recurring texts, variable frequency, possible message and data rates, STOP and HELP, with links to the text terms, the terms and the privacy policy. Only an explicit approval of this exact profile and this exact consent wording continues the flow. A code, a draft or silence is not approval. The person can ask for changes, which returns to the draft, or decline, which ends the flow. In the connector transport, the person also checks the consent box on the app's page. In the Messages transport, the approved profile goes into the link, and the person sends it from their own phone. The agent never sends that text and never reports it as a saved profile.

```quint
type Approval = ApproveExact | AskChanges | DeclineSignup

pure def canDecideApproval(s: AgentSignup): bool = s.phase == AwaitingApproval

pure def decideApproval(s: AgentSignup, decision: Approval): AgentSignup =
  if (decision == ApproveExact)
    { ...s, approved: true, phase:
      if (s.transport == InAgentCode) CheckingSession
      else if (s.transport == ConnectorHandoff) HandedOff
      else HandedToMessages }
  else if (decision == AskChanges) { ...s, phase: Drafting }
  else { ...s, phase: Declined }

pure def alwaysNoApprovalBeforeDraftApproved(s: AgentSignup): bool =
  (s.phase == CheckingCapability or s.phase == Unsupported or s.phase == ReadingApp or
   s.phase == Drafting or s.phase == AwaitingApproval or s.phase == Declined) implies not(s.approved)

pure def alwaysNothingSentBeforeApproval(s: AgentSignup): bool =
  not(s.approved) implies (s.codeStarts == 0 and s.codeChecks == 0 and s.joins == 0 and s.submits == 0)

pure def alwaysTextHandoffIsApproved(s: AgentSignup): bool =
  s.phase == HandedToMessages implies (s.approved and s.transport == MessagesHandoff)
```

### In the in-agent transport, a live session is reused and only the code sign-in mode continues

When the private cookie jar for this exact site holds a session, the agent reads the account before it asks for another code. Without a session, or when the site refuses the session, the agent reads the site's sign-in mode before it asks for the number. Only the code mode continues. Another mode (Cloud sign-in) ends the flow: the agent says that direct sign-in is not available in this agent and offers no website fallback.

```quint
pure def inCodePath(phase: SignupPhase): bool =
  phase == CheckingSession or phase == CheckingAuthMode or phase == AwaitingNumber or
  phase == AwaitingCode or phase == CodeRejected or phase == CodeNotSent or
  phase == ReadingAccount or phase == ReadyToJoin or phase == ReadingBack

pure def canCheckSession(s: AgentSignup): bool = s.phase == CheckingSession and s.transport == InAgentCode

pure def checkSession(s: AgentSignup, sessionLive: bool): AgentSignup =
  { ...s, phase: if (sessionLive) ReadingAccount else CheckingAuthMode }

pure def canReadAuthMode(s: AgentSignup): bool = s.phase == CheckingAuthMode and s.transport == InAgentCode

pure def readAuthMode(s: AgentSignup, codeMode: bool): AgentSignup =
  { ...s, phase: if (codeMode) AwaitingNumber else SignInUnavailable }

pure def alwaysCodePathIsApprovedInAgent(s: AgentSignup): bool =
  inCodePath(s.phase) implies (s.approved and s.transport == InAgentCode)
```

### The agent requests the code at most once per attempt

The agent sends the person's own number once. A sent code means only that a code was requested, not that the phone is verified. A refused request (a malformed number or a rate limit) stops this attempt. A security check that the agent cannot pass ends the flow: the agent never fakes a token and never offers website signup. The agent never resends a code by itself.

```quint
type CodeStart = CodeSent | CodeRefused | SecurityCheckRequired

pure def canStartCode(s: AgentSignup): bool =
  s.phase == AwaitingNumber and s.transport == InAgentCode and s.approved and s.codeStarts == 0

pure def startCode(s: AgentSignup, codeStart: CodeStart): AgentSignup =
  { ...s, codeStarts: s.codeStarts + 1,
    phase: if (codeStart == CodeSent) AwaitingCode else if (codeStart == CodeRefused) CodeNotSent else SecurityCheckBlocked }

pure def alwaysOneCodePerAttempt(s: AgentSignup): bool =
  s.codeStarts >= 0 and s.codeStarts <= 1 and s.codeChecks >= 0 and s.codeChecks <= s.codeStarts
```

### The agent checks only the code that the person supplies, once, and only the person starts a new attempt

The agent sends the code that the person typed, once, and keeps it out of files and output. A rejected code stops the attempt and the agent explains it. Only the person's own request starts a new attempt, which allows one new code request.

```quint
pure def canCheckCode(s: AgentSignup): bool =
  s.phase == AwaitingCode and s.transport == InAgentCode and s.codeStarts == 1 and s.codeChecks == 0

pure def checkCode(s: AgentSignup, verified: bool): AgentSignup =
  { ...s, codeChecks: s.codeChecks + 1, phase: if (verified) ReadingAccount else CodeRejected }

pure def canRequestNewCode(s: AgentSignup): bool =
  (s.phase == CodeRejected or s.phase == CodeNotSent) and s.transport == InAgentCode

pure def requestNewCode(s: AgentSignup): AgentSignup =
  { ...s, codeStarts: 0, codeChecks: 0, phase: AwaitingNumber }
```

### The account's state decides whether the agent may join

After sign-in, the agent reads the account. An account of another app stops the flow. An existing membership is read back and reported as it is. The agent never sends Join again to overwrite it. An account on hold stops with the review outcome. If the site says an invitation is required, the agent can attempt Join only with a forwarded link for this app that the person supplied and explicitly approved with their profile and text consent. A joinable account can use the same kind of invitation by choice. The agent keeps the token value private and treats the server result as the authority on whether the invitation can be used.

```quint
type AccountFact = OtherAppAccount | MemberAccount | JoinableAccount | InviteRequired | HeldForReview
type InvitationEvidence = { forwarded: bool, sameApp: bool, approved: bool }

pure val invitationValues = Set(
  { forwarded: false, sameApp: false, approved: false },
  { forwarded: true, sameApp: false, approved: true },
  { forwarded: true, sameApp: true, approved: false },
  { forwarded: true, sameApp: true, approved: true }
)

pure def approvedAppInvitation(invitation: InvitationEvidence): bool =
  invitation.forwarded and invitation.sameApp and invitation.approved

pure def canReadAccount(s: AgentSignup, account: AccountFact): bool =
  s.phase == ReadingAccount and s.transport == InAgentCode and (account != InviteRequired or s.inviteOnly)

pure def readAccount(s: AgentSignup, account: AccountFact, invitation: InvitationEvidence): AgentSignup =
  val use = approvedAppInvitation(invitation)
  { ...s, useInvitation: use and (account == JoinableAccount or account == InviteRequired), phase:
    if (account == OtherAppAccount) WrongApp
    else if (account == MemberAccount) ExistingMember
    else if (account == HeldForReview) OnReview
    else if (account == InviteRequired and not(use)) NeedsInvite
    else ReadyToJoin }

pure def alwaysInviteGateOnlyForInviteApps(s: AgentSignup): bool =
  s.phase == NeedsInvite implies s.inviteOnly

pure def lawInviteGateRequiresApprovedSameAppEvidence(s: AgentSignup, invitation: InvitationEvidence): bool =
  (readAccount(s, InviteRequired, invitation).phase == ReadyToJoin) iff approvedAppInvitation(invitation)

pure def lawOnlyApprovedSameAppEvidenceUsesInvitation(s: AgentSignup, account: AccountFact, invitation: InvitationEvidence): bool =
  readAccount(s, account, invitation).useInvitation implies
    (approvedAppInvitation(invitation) and (account == JoinableAccount or account == InviteRequired))
```

### The agent joins once, with the approved profile and the current consent

The agent sends Join once, with the approved fields, the confirmed home region, the account marker when the site gave one, and the current consent wording and version. It sends the exact token only when the person supplied and approved the same-app forwarded invitation. Each refusal leads to its own result, including age below the join age, a missing or unavailable invitation, a hold, or a profile that the site did not save. If the server refused the invitation, the agent reports that result and does not retry the same attempt.

```quint
type JoinResult = JoinCreated | JoinBelowAge | JoinNeedsInvite | JoinInvalidInvitation | JoinHeld | JoinNotSaved

pure def canJoinApp(s: AgentSignup, joinResult: JoinResult, invitationSubmitted: bool): bool =
  s.phase == ReadyToJoin and s.transport == InAgentCode and s.approved and s.joins == 0 and
  invitationSubmitted == s.useInvitation and (joinResult != JoinNeedsInvite or s.inviteOnly) and
  (joinResult != JoinInvalidInvitation or invitationSubmitted)

pure def joinApp(s: AgentSignup, joinResult: JoinResult, invitationSubmitted: bool): AgentSignup =
  { ...s, joins: s.joins + 1, phase:
    if (joinResult == JoinCreated) ReadingBack
    else if (joinResult == JoinBelowAge) BelowJoinAge
    else if (joinResult == JoinNeedsInvite) NeedsInvite
    else if (joinResult == JoinInvalidInvitation) InvitationUnavailable
    else if (joinResult == JoinHeld) OnReview
    else JoinFailed }

pure def alwaysJoinAndSubmitAtMostOnce(s: AgentSignup): bool =
  s.joins >= 0 and s.joins <= 1 and s.submits >= 0 and s.submits <= 1 and
  (s.transport == InAgentCode implies s.submits == 0) and
  (s.transport == ConnectorHandoff implies (s.codeStarts == 0 and s.codeChecks == 0 and s.joins == 0)) and
  (s.transport == MessagesHandoff implies (s.codeStarts == 0 and s.codeChecks == 0 and s.joins == 0 and s.submits == 0))
```

### In-agent success is reported only after the read-back matches the approved profile

After Join, the agent reads the account and the export with the same private session. It compares the app, the first name, the state, the profile and the home region with the approved fields. Only a match is reported as saved. A difference is reported as a difference, and the agent does not send Join again.

```quint
pure def canReadBack(s: AgentSignup): bool =
  s.phase == ReadingBack and s.transport == InAgentCode and s.joins == 1

pure def readBack(s: AgentSignup, readBackMatches: bool): AgentSignup =
  { ...s, phase: if (readBackMatches) Saved else SavedDiffers }
```

### In the connector transport, the person confirms the phone on the app's page and the agent sends the profile once

The agent gives the person one link to the app's page. On that page, the person types their own number and code and agrees to the texts. When the person returns, the agent reads the status on the app's own connection. A connection for another app stops the flow. A person who is not joined or only invited is asked to finish on the page. Stopped messages and a hold stop the flow. For an onboarding or active member, the agent sends the approved profile once, then reads the status again. Success is reported only when both calls confirm it. When the second status call does not show an onboarding or active member, the agent reports that the save is not confirmed.

```quint
type SiteStatus = SiteNotJoined | SiteInvited | SiteOnboarding | SiteActive | SiteStopped | SiteOnHold

pure def inConnectorPath(phase: SignupPhase): bool =
  phase == HandedOff or phase == ReadyToSubmit or phase == ConfirmingProfile

pure def canCheckSiteStatus(s: AgentSignup): bool = s.phase == HandedOff and s.transport == ConnectorHandoff

pure def checkSiteStatus(s: AgentSignup, siteApp: bool, siteStatus: SiteStatus): AgentSignup =
  { ...s, phase:
    if (not(siteApp)) WrongApp
    else if (siteStatus == SiteOnboarding or siteStatus == SiteActive) ReadyToSubmit
    else if (siteStatus == SiteStopped) MessagesStopped
    else if (siteStatus == SiteOnHold) OnReview
    else HandedOff }

pure def canSubmitProfile(s: AgentSignup): bool =
  s.phase == ReadyToSubmit and s.transport == ConnectorHandoff and s.approved and s.submits == 0

pure def submitProfile(s: AgentSignup, accepted: bool): AgentSignup =
  { ...s, submits: s.submits + 1, phase: if (accepted) ConfirmingProfile else ProfileNotSent }

pure def canConfirmProfile(s: AgentSignup): bool =
  s.phase == ConfirmingProfile and s.transport == ConnectorHandoff and s.submits == 1

pure def confirmProfile(s: AgentSignup, stillLive: bool): AgentSignup =
  { ...s, phase: if (stillLive) Saved else SaveUnconfirmed }

pure def alwaysConnectorPathIsApproved(s: AgentSignup): bool =
  inConnectorPath(s.phase) implies (s.approved and s.transport == ConnectorHandoff)
```

### The agent asks for the number and the code only in the in-agent transport after approval

What the agent asks next depends only on the phase. The agent asks for profile facts while it drafts, for approval when the draft is ready, for the number and the code only in the in-agent code path, for the person to finish on the page in the connector transport, and for the person to send the prepared text in the Messages transport. In every other phase it asks for nothing.

```quint
type AgentAsk = AskNothing | AskProfileFacts | AskApproval | AskNumber | AskCode | AskToFinishOnSite | AskToSendText

pure def askFor(phase: SignupPhase): AgentAsk =
  if (phase == Drafting) AskProfileFacts
  else if (phase == AwaitingApproval) AskApproval
  else if (phase == AwaitingNumber) AskNumber
  else if (phase == AwaitingCode) AskCode
  else if (phase == HandedOff) AskToFinishOnSite
  else if (phase == HandedToMessages) AskToSendText
  else AskNothing

pure def alwaysCredentialsAskedOnlyAfterApproval(s: AgentSignup): bool =
  (askFor(s.phase) == AskNumber or askFor(s.phase) == AskCode) implies
    (s.approved and s.transport == InAgentCode)
```

### The agent reports the true result, and only a confirmed save is reported as saved

Each end of the flow has its own report. A refusal (under the join age, an invitation needed, a hold) is reported as that refusal. An unsupported agent, a sign-in mode the agent cannot use, and a security check the agent cannot pass are reported as unsupported. A saved profile is reported only after the read-back or the second status call confirms it, and a saved profile is never reported as a match. A profile in a prepared text is reported as waiting for the person to send it. When every step of a skill succeeds, the in-agent and connector transports end at a saved profile, and the Messages transport ends at the prepared text. A finished signup stays finished. Only after a code problem can the person start a new attempt.

```quint
type SignupReport =
  ReportWorking | ReportSaved | ReportSaveDiffers | ReportSaveUnconfirmed | ReportAlreadyMember | ReportUnderAge |
  ReportInviteNeeded | ReportInviteUnavailable | ReportOnHold | ReportStopped | ReportUnsupported | ReportCodeProblem |
  ReportNotSaved | ReportDeclined | ReportOtherApp | ReportSendTheText

pure def reportFor(phase: SignupPhase): SignupReport =
  if (phase == Saved) ReportSaved
  else if (phase == SavedDiffers) ReportSaveDiffers
  else if (phase == SaveUnconfirmed) ReportSaveUnconfirmed
  else if (phase == HandedToMessages) ReportSendTheText
  else if (phase == ExistingMember) ReportAlreadyMember
  else if (phase == BelowJoinAge) ReportUnderAge
  else if (phase == NeedsInvite) ReportInviteNeeded
  else if (phase == InvitationUnavailable) ReportInviteUnavailable
  else if (phase == OnReview) ReportOnHold
  else if (phase == MessagesStopped) ReportStopped
  else if (phase == Unsupported or phase == SignInUnavailable or phase == SecurityCheckBlocked) ReportUnsupported
  else if (phase == CodeNotSent or phase == CodeRejected) ReportCodeProblem
  else if (phase == JoinFailed or phase == ProfileNotSent) ReportNotSaved
  else if (phase == Declined) ReportDeclined
  else if (phase == WrongApp) ReportOtherApp
  else ReportWorking

pure def finished(phase: SignupPhase): bool = reportFor(phase) != ReportWorking

pure def endReportFor(transport: Transport): SignupReport =
  if (transport == InAgentCode or transport == ConnectorHandoff) ReportSaved
  else if (transport == MessagesHandoff) ReportSendTheText
  else ReportUnsupported

pure def lawOnlyConfirmedTransportsEndSaved(transport: Transport): bool =
  (endReportFor(transport) == ReportSaved) iff (transport == InAgentCode or transport == ConnectorHandoff)

pure def lawOnlySavedReportsSuccess(phase: SignupPhase): bool =
  (reportFor(phase) == ReportSaved) iff (phase == Saved)

pure def alwaysSavedNeedsConfirmedSave(s: AgentSignup): bool =
  s.phase == Saved implies (s.approved and (s.joins == 1 or s.submits == 1))

pure def stepSavedFollowsConfirmation(before: AgentSignup, via: str, after: AgentSignup): bool =
  (after.phase == Saved and before.phase != Saved) implies (via == "readBack" or via == "confirmProfile")

pure def retryable(phase: SignupPhase): bool = phase == CodeRejected or phase == CodeNotSent

pure def stepFinishedStaysFinished(before: AgentSignup, via: str, after: AgentSignup): bool =
  (finished(before.phase) and not(retryable(before.phase))) implies after == before

pure def stepRetryOnlyAfterCodeProblem(before: AgentSignup, via: str, after: AgentSignup): bool =
  (finished(before.phase) and after.phase != before.phase) implies (retryable(before.phase) and via == "requestNewCode")
```

### A signup can save a profile, hand it to Messages, or stop at a truthful result

The supported paths include a save in the in-agent and connector transports, a save with a live session and with a code, a save that differs, a save that is not confirmed, a hand-off to Messages, an existing membership, and each refusal and stop.

```quint
pure def sometimesSavedInAgent(s: AgentSignup): bool = s.phase == Saved and s.transport == InAgentCode
pure def sometimesSavedThroughConnector(s: AgentSignup): bool = s.phase == Saved and s.transport == ConnectorHandoff
pure def sometimesSavedDiffers(s: AgentSignup): bool = s.phase == SavedDiffers
pure def sometimesSaveUnconfirmed(s: AgentSignup): bool = s.phase == SaveUnconfirmed
pure def sometimesHandedToMessages(s: AgentSignup): bool = s.phase == HandedToMessages
pure def sometimesSavedWithCode(s: AgentSignup): bool = s.phase == Saved and s.transport == InAgentCode and s.codeChecks == 1
pure def sometimesSavedWithSession(s: AgentSignup): bool = s.phase == Saved and s.transport == InAgentCode and s.codeStarts == 0
pure def sometimesExistingMember(s: AgentSignup): bool = s.phase == ExistingMember
pure def sometimesNeedsInvite(s: AgentSignup): bool = s.phase == NeedsInvite
pure def sometimesSavedWithForwardedInvite(s: AgentSignup): bool = s.phase == Saved and s.inviteOnly and s.useInvitation
pure def sometimesForwardedInviteUnavailable(s: AgentSignup): bool = s.phase == InvitationUnavailable
pure def sometimesOnReview(s: AgentSignup): bool = s.phase == OnReview
pure def sometimesBelowJoinAge(s: AgentSignup): bool = s.phase == BelowJoinAge
pure def sometimesTeenApproved(s: AgentSignup): bool = s.age == Teen and s.approved
pure def sometimesUnsupported(s: AgentSignup): bool = s.phase == Unsupported
pure def sometimesSignInUnavailable(s: AgentSignup): bool = s.phase == SignInUnavailable
pure def sometimesSecurityCheckBlocked(s: AgentSignup): bool = s.phase == SecurityCheckBlocked
pure def sometimesCodeRejected(s: AgentSignup): bool = s.phase == CodeRejected
pure def sometimesCodeNotSent(s: AgentSignup): bool = s.phase == CodeNotSent
pure def sometimesDeclined(s: AgentSignup): bool = s.phase == Declined
pure def sometimesWrongApp(s: AgentSignup): bool = s.phase == WrongApp
pure def sometimesJoinFailed(s: AgentSignup): bool = s.phase == JoinFailed
pure def sometimesProfileNotSent(s: AgentSignup): bool = s.phase == ProfileNotSent
pure def sometimesMessagesStopped(s: AgentSignup): bool = s.phase == MessagesStopped
```
