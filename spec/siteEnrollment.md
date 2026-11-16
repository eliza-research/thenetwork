# Enroll through the site API

An agent uses the app's authenticated site session to submit a member-approved profile. The same account operation also accepts already validated, typed requests from internal callers. Peon still offers browser signup for its waitlist. Network, Slop and Friends retired their browser Join forms. The API and storage shell still own authentication, input decoding, lock acquisition, persistence and the join hook.

## Story: Find the app's public signup entry

> As a person considering an app, I want the connector to point me to signup instructions the app actually serves.

### Public signup uses the app's supported surface

Send Peon applicants to its browser Join form. Send Network, Slop and Friends applicants to the app's own signup skill. Keep the invite-only requirement and the existing connector scope.

```quint
pure def publicSignupUsesBrowser(app: str): bool = app == "peon"
```

## Story: Save my approved profile in the app I asked for

> As a person enrolling in an app, I want it to use my verified account, honor my consent, and tell me the actual enrollment result.

### A submitted account marker must match the authenticated account

A supplied signup marker must match the app-bound account that owns the session. Some supported clients have no marker. Those requests continue with the authenticated account. The authenticated API checks the marker before decoding the profile or calling the account service.

```quint
type EnrollmentPhase = AwaitingAccountView | AccountChanged | AwaitingProfile | InvalidProfile | AwaitingConsent | ConsentMismatch |
  AwaitingEligibility | NeedsReview | AwaitingMembership | NeedsInvite | InvalidInvitation | AwaitingAge | BelowJoinAge |
  ReturnExisting | AwaitingPersistence | Created | JoinHookFailed
type Enrollment = {
  phase: EnrollmentPhase,
  viewChecked: bool,
  validProfile: bool,
  currentConsent: bool,
  currentEligibility: bool,
  rejoin: bool,
  invited: bool,
  referred: bool,
  invalidReferral: bool,
  ageAllowed: bool,
}
pure val initial: Enrollment = {
  phase: AwaitingAccountView, viewChecked: false, validProfile: false, currentConsent: false,
  currentEligibility: false, rejoin: false, invited: false, referred: false, invalidReferral: false, ageAllowed: false,
}

pure def canCheckAccountView(joining: Enrollment): bool = joining.phase == AwaitingAccountView

pure def checkAccountView(joining: Enrollment, viewMatches: bool): Enrollment =
  { ...joining, viewChecked: viewMatches, phase: if (viewMatches) AwaitingProfile else AccountChanged }
```

### Decode the profile and accept current consent before locking the account

Reject a malformed profile. The account service accepts the app's current consent wording or version under the existing matching rules. Typed in-process callers already hold a validated profile and start at the consent step.

```quint
pure def canDecodeProfile(joining: Enrollment): bool = joining.phase == AwaitingProfile and joining.viewChecked

pure def decodeProfile(joining: Enrollment, decoded: bool): Enrollment =
  { ...joining, validProfile: decoded, phase: if (decoded) AwaitingConsent else InvalidProfile }

pure val typedJoinEntry: Enrollment = { ...initial, phase: AwaitingConsent, validProfile: true, viewChecked: true }

pure def canConfirmConsent(joining: Enrollment): bool = joining.phase == AwaitingConsent and joining.validProfile and joining.viewChecked

pure def confirmConsent(joining: Enrollment, consentMatches: bool): Enrollment =
  { ...joining, currentConsent: consentMatches, phase: if (consentMatches) AwaitingEligibility else ConsentMismatch }
```

### A hold or ban prevents enrollment

The account service runs eligibility checks under the phone's join lock. A hold or ban returns the existing review outcome. Only an eligible account proceeds to the app membership check.

```quint
pure def canCheckEligibility(joining: Enrollment): bool =
  joining.phase == AwaitingEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def checkEligibility(joining: Enrollment, eligible: bool): Enrollment =
  { ...joining, currentEligibility: eligible, phase: if (eligible) AwaitingMembership else NeedsReview }
```

### The current membership determines whether a join needs an invite

A live membership can be returned without reading or redeeming a referral. An invite-only app requires a stored staff invitation or a valid member invitation for a new membership. The new-membership path preserves a staff-invited member's ID. A person may explicitly submit a member invitation in the authenticated join body. The shell verifies the invitation against the app and its active enrollment policy, then passes the verified referral to the join hook after the effective age check. A new join with an unavailable referral gets one generic refusal, including on an open app. A waitlist keeps its usual enrollment path because membership there begins without an active Network member.

```quint
type ReferralFact = NoReferral | InvalidReferral | VerifiedReferral
type MembershipFacts = { existingMember: bool, inviteRequired: bool, hasInvite: bool, referral: ReferralFact }
pure val membershipFactsValues = Set(
  { existingMember: false, inviteRequired: false, hasInvite: false, referral: NoReferral },
  { existingMember: true, inviteRequired: true, hasInvite: false, referral: NoReferral },
  { existingMember: false, inviteRequired: true, hasInvite: false, referral: NoReferral },
  { existingMember: false, inviteRequired: true, hasInvite: true, referral: NoReferral },
  { existingMember: false, inviteRequired: true, hasInvite: false, referral: VerifiedReferral },
  { existingMember: false, inviteRequired: false, hasInvite: false, referral: InvalidReferral },
)

pure def canCheckMembership(joining: Enrollment): bool =
  joining.phase == AwaitingMembership and joining.currentEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def checkMembership(joining: Enrollment, membershipFacts: MembershipFacts): Enrollment =
  val referred = not(membershipFacts.existingMember) and membershipFacts.referral == VerifiedReferral
  val invalid = not(membershipFacts.existingMember) and membershipFacts.referral == InvalidReferral
  val missingInvite = membershipFacts.inviteRequired and not(membershipFacts.existingMember) and not(membershipFacts.hasInvite) and not(referred) and not(invalid)
  { ...joining, rejoin: membershipFacts.existingMember, invited: membershipFacts.hasInvite,
    referred: referred, invalidReferral: invalid, phase: if (missingInvite) NeedsInvite else AwaitingAge }
```

### The effective age controls the result of a new or repeated join

Use the existing lowest age rule. A repeated join records the age statement before returning the existing membership. A new join that fails the age rule records the age statement without creating a membership, even when its explicit member invitation is unavailable. Passing the age rule starts persistence only for a new membership with no unavailable invitation.

```quint
pure def canCheckJoinAge(joining: Enrollment): bool =
  joining.phase == AwaitingAge and joining.currentEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def checkJoinAge(joining: Enrollment, ageEligible: bool): Enrollment =
  { ...joining, ageAllowed: ageEligible,
    phase: if (not(ageEligible)) BelowJoinAge else if (joining.rejoin) ReturnExisting else if (joining.invalidReferral) InvalidInvitation else AwaitingPersistence }
```

### Success for a new membership follows the join hook

An ordinary join writes the membership, consent and person link, then runs the join hook. A hook failure forgets the new membership and records the failed opt-in's reversal. A referred join commits the app membership, consent, session attachment, Network attribution and invitation use together. A failed referral commit leaves those writes for the next verified attempt. A successful response reports the stored membership.

```quint
pure def canFinishJoin(joining: Enrollment): bool =
  joining.phase == AwaitingPersistence and not(joining.rejoin) and not(joining.invalidReferral) and joining.ageAllowed
    and joining.currentEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def finishJoin(joining: Enrollment, hookSucceeded: bool): Enrollment =
  { ...joining, phase: if (hookSucceeded) Created else JoinHookFailed }
```

### Success requires an eligible profile with current consent

Both successful outcomes need a valid profile, current consent, account eligibility and a passing effective age check. The repeat path keeps an existing membership. The new path can report creation only after persistence and the hook.

```quint
pure def alwaysSuccessUsesEligibleProfile(joining: Enrollment): bool =
  (joining.phase == Created or joining.phase == ReturnExisting) implies
    (joining.viewChecked and joining.validProfile and joining.currentConsent and joining.currentEligibility and joining.ageAllowed)

pure def alwaysExistingMembershipStaysExisting(joining: Enrollment): bool =
  (joining.phase == ReturnExisting implies joining.rejoin) and (joining.phase == Created implies not(joining.rejoin))

pure def alwaysReferralOnlyOnNewMembership(joining: Enrollment): bool =
  joining.referred implies not(joining.rejoin)

pure def lawTypedEntryUsesSameConsentGate(consentMatches: bool): bool =
  canConfirmConsent(typedJoinEntry) and
    (confirmConsent(typedJoinEntry, consentMatches).phase == AwaitingEligibility) == consentMatches
```

### A request can enroll, reuse its membership or stop at a refusal

The supported paths include a new membership, a repeat request, an account change, a missing invite, and an ineligible age.

```quint
pure def sometimesEnrolled(joining: Enrollment): bool = joining.phase == Created
pure def sometimesExisting(joining: Enrollment): bool = joining.phase == ReturnExisting
pure def sometimesAccountChanged(joining: Enrollment): bool = joining.phase == AccountChanged
pure def sometimesNeedsInvite(joining: Enrollment): bool = joining.phase == NeedsInvite
pure def sometimesInvalidInvitation(joining: Enrollment): bool = joining.phase == InvalidInvitation
pure def sometimesBelowJoinAge(joining: Enrollment): bool = joining.phase == BelowJoinAge
```
