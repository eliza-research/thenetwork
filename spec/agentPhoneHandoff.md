# Confirm an agent signup on the app's site

[Story F45](product/stories.md#story-f45--sign-up-in-my-agents-conversation) keeps profile drafting and the final result in the member's agent. The app's site owns phone verification during signup and [connector authorization](oauthBrowserAuthorization.md) owns the grant. The person enters the number and verification code on the app's own site. The agent's inputs and results never contain those credentials or the browser's session. This contract defines the signup handoff. The [deployed skill model](agentSignup.md) records the older serving path until the site and connector implement the handoff.

## Story: Confirm my own phone during signup

> As a person joining through my agent, I want one link to confirm my phone and authorize my app, then return to my agent to see what saved.

### Offer one app-bound confirmation after the person approves the draft

Use the app from the person's current signup. Offer the handoff after the person has approved the exact draft and current text consent wording. Apply the existing join-age, invite and held-account rules. A session already verified on that app may satisfy the phone step. The request must remain app-bound, short lived and single use. An agent without the required connector access explains the limitation before collecting a profile.

```quint
type HandoffPhase = DraftingHandoff | AwaitingPhoneConfirmation | AwaitingSignupGrant | ReadyForSignupProfile |
  AwaitingSignupReadBack | SignupProfileSaved | SignupProfileUnconfirmed | HandoffRefused

type PhoneHandoff = { phase: HandoffPhase, approvedDraft: bool, verifiedEnrollment: bool, matchingGrant: bool }

pure val initial: PhoneHandoff = {
  phase: DraftingHandoff, approvedDraft: false, verifiedEnrollment: false, matchingGrant: false,
}

pure def canOfferSignupHandoff(handoff: PhoneHandoff): bool = handoff.phase == DraftingHandoff

pure def offerSignupHandoff(handoff: PhoneHandoff, approved: bool): PhoneHandoff =
  { ...handoff, approvedDraft: approved, phase: if (approved) AwaitingPhoneConfirmation else HandoffRefused }

pure def alwaysHandoffNeedsPriorApproval(handoff: PhoneHandoff): bool =
  (handoff.phase != DraftingHandoff and handoff.phase != HandoffRefused) implies handoff.approvedDraft
```

### Only the browser and the authorized connector complete the handoff

Complete phone verification and confirm the signup on the same app. The server checks the verified owner, current signup requirements and the exact live handoff. A successful signup creates or resumes that app's eligible membership. The person authorizes the connector for the same app and owner. A wrong app, changed owner, expired request, blocked membership or refused consent cannot authorize a write. The owning server supplies these facts.

```quint
type SignupConfirmation = { sameApp: bool, ownerVerified: bool, eligibleEnrollment: bool, requestLive: bool }
pure val validSignupConfirmation: SignupConfirmation = { sameApp: true, ownerVerified: true, eligibleEnrollment: true, requestLive: true }
pure val confirmationValues = Set(validSignupConfirmation,
  { ...validSignupConfirmation, sameApp: false }, { ...validSignupConfirmation, ownerVerified: false },
  { ...validSignupConfirmation, eligibleEnrollment: false }, { ...validSignupConfirmation, requestLive: false })

pure def canConfirmSignupPhone(handoff: PhoneHandoff): bool =
  handoff.phase == AwaitingPhoneConfirmation and handoff.approvedDraft

pure def confirmSignupPhone(handoff: PhoneHandoff, confirmation: SignupConfirmation): PhoneHandoff =
  val eligible = confirmation.sameApp and confirmation.ownerVerified and confirmation.eligibleEnrollment and confirmation.requestLive
  { ...handoff, verifiedEnrollment: eligible, phase: if (eligible) AwaitingSignupGrant else HandoffRefused }

pure def canRecordSignupGrant(handoff: PhoneHandoff): bool = handoff.phase == AwaitingSignupGrant and handoff.verifiedEnrollment

pure def recordSignupGrant(handoff: PhoneHandoff, appMatches: bool, ownerMatches: bool, writeScopeLive: bool): PhoneHandoff =
  val eligible = appMatches and ownerMatches and writeScopeLive
  { ...handoff, matchingGrant: eligible, phase: if (eligible) ReadyForSignupProfile else HandoffRefused }

pure def alwaysSignupWriteNeedsVerifiedAuthority(handoff: PhoneHandoff): bool =
  (handoff.phase == ReadyForSignupProfile or handoff.phase == AwaitingSignupReadBack
    or handoff.phase == SignupProfileSaved or handoff.phase == SignupProfileUnconfirmed)
    implies (handoff.verifiedEnrollment and handoff.matchingGrant)
```

### Submit the approved profile once and read back the result

Recheck the same live grant, app, member and approved profile before using the authorized MCP profile write. An existing active member can read back their saved profile. Repeated deliveries of one submission report its recorded result. The agent reports a saved signup only after the service confirms the profile it approved. An unavailable or different result stays unconfirmed.

```quint
pure def canSubmitHandoffProfile(handoff: PhoneHandoff): bool =
  handoff.phase == ReadyForSignupProfile and handoff.matchingGrant

pure def submitHandoffProfile(handoff: PhoneHandoff, authorityLive: bool, exactProfile: bool): PhoneHandoff =
  { ...handoff, phase: if (authorityLive and exactProfile) AwaitingSignupReadBack else HandoffRefused }

pure def canReadHandoffProfile(handoff: PhoneHandoff): bool = handoff.phase == AwaitingSignupReadBack

pure def readHandoffProfile(handoff: PhoneHandoff, exactSavedProfile: bool): PhoneHandoff =
  { ...handoff, phase: if (exactSavedProfile) SignupProfileSaved else SignupProfileUnconfirmed }

pure def stepHandoffSaveRequiresReadBack(before: PhoneHandoff, via: str, after: PhoneHandoff): bool =
  after.phase == SignupProfileSaved implies (before.phase == AwaitingSignupReadBack and via == "readHandoffProfile")

pure def sometimesSignupProfileSaved(handoff: PhoneHandoff): bool = handoff.phase == SignupProfileSaved
pure def sometimesSignupProfileUnconfirmed(handoff: PhoneHandoff): bool = handoff.phase == SignupProfileUnconfirmed
```
