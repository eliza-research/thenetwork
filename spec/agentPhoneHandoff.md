# Confirm an agent signup on the app's site

[Story F45](product/stories.md#story-f45--sign-up-in-my-agents-conversation) keeps profile drafting and the final result in the member's agent. The app's site owns phone verification during signup and [connector authorization](oauthBrowserAuthorization.md) owns the grant. The person enters the number and verification code on the app's own site. The agent's inputs and results never contain those credentials or the browser's session. The [signup conversation](agentSignup.md) defines how the agent offers the native authorization link and confirms the result after the person returns.

The signup conversation refines this handoff. Each step of the conversation either keeps the handoff where it is or is the handoff step of the same name, allowed by its guard. Thus every rule of this handoff applies to each native connector signup that the agent does.

## Story: Confirm my own phone during signup

> As a person joining through my agent, I want one link to confirm my phone and authorize my app, then return to my agent to see what saved.

### Offer one app-bound confirmation after the person approves the draft

Use the app from the person's current signup. Offer the handoff only after the person approves the exact draft and the current text consent wording. A request for changes or a refusal gives no approval. Apply the existing join-age, invite and held-account rules. A session already verified on that app may satisfy the phone step. The request must stay app-bound, short lived and single use. An agent without the required connector access explains the limitation before it collects a profile. When the client cannot supply the link, the handoff stops. Changed: the server now records the offer too, because no shipping code ran these rules (audit COV06); the Finish signup step of the connection page records the person's approval of the exact form and the current text consent wording as the approval.

```quint
type HandoffPhase = DraftingHandoff | AwaitingPhoneConfirmation | AwaitingSignupGrant | ReadyForSignupProfile |
  AwaitingSignupReadBack | SignupProfileSaved | SignupProfileUnconfirmed | HandoffRefused

type PhoneHandoff = { phase: HandoffPhase, approvedDraft: bool, verifiedEnrollment: bool, matchingGrant: bool }

type Approval = ApproveExact | AskChanges | DeclineSignup

pure val initial: PhoneHandoff = {
  phase: DraftingHandoff, approvedDraft: false, verifiedEnrollment: false, matchingGrant: false,
}

pure def canDecideApproval(handoff: PhoneHandoff): bool =
  handoff.phase == DraftingHandoff and not(handoff.approvedDraft)

pure def decideApproval(handoff: PhoneHandoff, decision: Approval): PhoneHandoff =
  { ...handoff, approvedDraft: decision == ApproveExact }

pure def canOfferHandoff(handoff: PhoneHandoff): bool =
  handoff.phase == DraftingHandoff and handoff.approvedDraft

pure def offerHandoff(handoff: PhoneHandoff, linkAvailable: bool): PhoneHandoff =
  { ...handoff, phase: if (linkAvailable) AwaitingPhoneConfirmation else HandoffRefused }

pure def alwaysHandoffNeedsPriorApproval(handoff: PhoneHandoff): bool =
  (handoff.phase != DraftingHandoff and handoff.phase != HandoffRefused) implies handoff.approvedDraft

pure def stepOfferFollowsApproval(before: PhoneHandoff, via: str, after: PhoneHandoff): bool =
  (after.phase == AwaitingPhoneConfirmation and before.phase != AwaitingPhoneConfirmation)
    implies (via == "offerHandoff" and before.approvedDraft)
```

### Only the browser and the authorized connector complete the handoff

Complete phone verification and confirm the signup on the same app. The server checks the verified owner, the current signup requirements and the exact live handoff. A successful signup creates or resumes the eligible membership of that app. A browser result that enrolls nobody keeps the handoff where it is: the person can wait and come back, and the agent reports the other results without a write. Before the profile write, the agent checks the membership status on the connector of the same app. Only a live grant for the same app and owner allows the write. A wrong app, a changed owner, an expired request, a blocked membership or a refused consent cannot authorize a write. The owning server supplies these facts. Changed: the Finish signup step now confirms the phone through this rule after the join, and the grant issuance of an enrolled request records the grant through it, so a refused handoff stops the join or the grant (audit COV06). Changed: the authorization request now stores the handoff state, the offered state while the join runs and the confirmed state after it, and the grant steps that stored state; before, the grant stepped a fixed confirmed state, so a refused or missing stored handoff could still get a grant. A request without a stored handoff, or with one that is not waiting for the grant, gets no grant. Changed (audit COV06): the grant applied the step, which leaves a state unchanged when the grant cannot be recorded, so a stored state already ready for the profile passed without the app, owner and write checks; the server now records the grant only when `canCheckSiteStatus` allows it and refuses every other stored state.

```quint
pure def canObserveBrowser(handoff: PhoneHandoff): bool =
  handoff.phase == AwaitingPhoneConfirmation and handoff.approvedDraft

pure def observeBrowser(handoff: PhoneHandoff): PhoneHandoff =
  { ...handoff, verifiedEnrollment: true, phase: AwaitingSignupGrant }

pure def canCheckSiteStatus(handoff: PhoneHandoff): bool =
  handoff.phase == AwaitingSignupGrant and handoff.verifiedEnrollment

pure def checkSiteStatus(handoff: PhoneHandoff, siteApp: bool): PhoneHandoff =
  { ...handoff, matchingGrant: siteApp, phase: if (siteApp) ReadyForSignupProfile else HandoffRefused }

pure def alwaysSignupWriteNeedsVerifiedAuthority(handoff: PhoneHandoff): bool =
  (handoff.phase == ReadyForSignupProfile or handoff.phase == AwaitingSignupReadBack
    or handoff.phase == SignupProfileSaved or handoff.phase == SignupProfileUnconfirmed)
    implies (handoff.verifiedEnrollment and handoff.matchingGrant)

pure def alwaysGrantFollowsVerifiedEnrollment(handoff: PhoneHandoff): bool =
  handoff.matchingGrant implies (handoff.verifiedEnrollment and handoff.approvedDraft)
```

### Submit the approved profile once and read back the result

Recheck the same live grant, app, member and approved profile before the authorized MCP profile write. An existing member can check their current membership status without a new profile submission. Repeated deliveries of one profile submission report its recorded result. The agent reports the approved text as recorded only after the service confirms that submission and a status check confirms the same app and an eligible membership. An unavailable or different result stays unconfirmed.

```quint
pure def canSubmitProfile(handoff: PhoneHandoff): bool =
  handoff.phase == ReadyForSignupProfile and handoff.matchingGrant

pure def submitProfile(handoff: PhoneHandoff, accepted: bool): PhoneHandoff =
  { ...handoff, phase: if (accepted) AwaitingSignupReadBack else HandoffRefused }

pure def canConfirmProfile(handoff: PhoneHandoff): bool = handoff.phase == AwaitingSignupReadBack

pure def confirmProfile(handoff: PhoneHandoff, stillLive: bool): PhoneHandoff =
  { ...handoff, phase: if (stillLive) SignupProfileSaved else SignupProfileUnconfirmed }

pure def stepHandoffSaveRequiresReadBack(before: PhoneHandoff, via: str, after: PhoneHandoff): bool =
  after.phase == SignupProfileSaved implies (before.phase == AwaitingSignupReadBack and via == "confirmProfile")

pure def sometimesSignupProfileSaved(handoff: PhoneHandoff): bool = handoff.phase == SignupProfileSaved
pure def sometimesSignupProfileUnconfirmed(handoff: PhoneHandoff): bool = handoff.phase == SignupProfileUnconfirmed
pure def sometimesHandoffRefused(handoff: PhoneHandoff): bool = handoff.phase == HandoffRefused

pure val eval_witness_sometimesSignupProfileSaved = (
  ("decideApproval", ApproveExact),
  ("offerHandoff", true),
  "observeBrowser",
  ("checkSiteStatus", true),
  ("submitProfile", true),
  ("confirmProfile", true)
)
```
