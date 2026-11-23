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

A supplied signup marker must match the app, verified phone and current person, including when no person has been created yet. Each app provides this opaque marker for an eligible signed-in account. Reassigning a phone to another person changes the marker even when the number is the same. Some supported clients have no marker. Those requests continue with the authenticated account. The API checks the marker before decoding the profile. The account service checks a supplied marker again under the phone's join lock before it reads an invitation or writes age, membership or consent.

```quint
type EnrollmentPhase = AwaitingAccountView | AccountChanged | AwaitingProfile | InvalidProfile | AwaitingConsent | ConsentMismatch |
  AwaitingEligibility | NeedsReview | AwaitingMembership | NeedsInvite | InvalidInvitation | AwaitingAge | BelowJoinAge |
  ReturnExisting | AwaitingRepair | AwaitingPersistence | Created | JoinHookFailed
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

pure def signupAccountViewMatches(markerSupplied: bool, markerMatches: bool): bool =
  not(markerSupplied) or markerMatches

pure def lawRejectStaleSignupAccountView(markerSupplied: bool, markerMatches: bool): bool =
  (markerSupplied and not(markerMatches)) implies not(signupAccountViewMatches(markerSupplied, markerMatches))

pure def canCheckAccountView(joining: Enrollment): bool = joining.phase == AwaitingAccountView

pure def checkAccountView(joining: Enrollment, viewMatches: bool): Enrollment =
  { ...joining, viewChecked: viewMatches, phase: if (viewMatches) AwaitingProfile else AccountChanged }
```

### Decode the profile and accept current consent before locking the account

Reject a malformed profile. Text consent must be explicit and include the app's current wording, current version or both. Every supplied field must decode and agree with the current consent. A blank or malformed field does not become an omitted field. Typed in-process callers already hold a validated profile and start at the consent step. Changed (owner decision 2026-11-22): the profile carries exactly one of `birthdate` (year-month-day) or `age`, so the service can track when the person turns a new year; both or neither is a malformed profile, and a well-formed date that is not a real date, is in the future or is before 1900 is refused with `invalid_birthdate` before anything is stored.

```quint
pure def canDecodeProfile(joining: Enrollment): bool = joining.phase == AwaitingProfile and joining.viewChecked

pure def decodeProfile(joining: Enrollment, decoded: bool): Enrollment =
  { ...joining, validProfile: decoded, phase: if (decoded) AwaitingConsent else InvalidProfile }

pure val typedJoinEntry: Enrollment = { ...initial, phase: AwaitingConsent, validProfile: true, viewChecked: true }

type JoinConsentEvidence = {
  smsAccepted: bool, wordingSupplied: bool, wordingAccepted: bool, versionSupplied: bool, versionAccepted: bool
}

pure val completeJoinConsent: JoinConsentEvidence = {
  smsAccepted: true, wordingSupplied: true, wordingAccepted: true, versionSupplied: true, versionAccepted: true
}
pure val evidenceValues = Set(completeJoinConsent,
  { ...completeJoinConsent, smsAccepted: false },
  { ...completeJoinConsent, wordingAccepted: false },
  { ...completeJoinConsent, versionAccepted: false },
  { ...completeJoinConsent, wordingSupplied: false, wordingAccepted: false },
  { ...completeJoinConsent, versionSupplied: false, versionAccepted: false },
  { smsAccepted: true, wordingSupplied: false, wordingAccepted: false, versionSupplied: false, versionAccepted: false })

pure def joinConsentEvidenceAllowed(evidence: JoinConsentEvidence): bool =
  evidence.smsAccepted and (evidence.wordingSupplied or evidence.versionSupplied) and
  (not(evidence.wordingSupplied) or evidence.wordingAccepted) and
  (not(evidence.versionSupplied) or evidence.versionAccepted)

pure def lawEverySuppliedJoinConsentFieldMustAgree(evidence: JoinConsentEvidence): bool =
  ((evidence.wordingSupplied and not(evidence.wordingAccepted)) or
    (evidence.versionSupplied and not(evidence.versionAccepted))) implies not(joinConsentEvidenceAllowed(evidence))

pure def joinAgeFieldsValid(hasBirthDate: bool, hasAge: bool): bool =
  (hasBirthDate or hasAge) and not(hasBirthDate and hasAge)

pure def lawBothOrNeitherAgeFieldIsMalformed(hasBirthDate: bool, hasAge: bool): bool =
  (hasBirthDate iff hasAge) implies not(joinAgeFieldsValid(hasBirthDate, hasAge))

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

Use the existing lowest age rule. A repeated join records the age statement before returning the existing membership. A repeated join of an active membership that has no Network member runs the join hook again before it returns the membership. A new join that fails the age rule records the age statement without creating a membership, even when its explicit member invitation is unavailable. Passing the age rule starts persistence only for a new membership with no unavailable invitation. Changed on 2026-11-21 (audit JA-3): a repeated join returned the membership without the hook, so a membership whose Network member was never made answered success forever. Changed (owner decision 2026-11-22): every join records its age statement (a birth date or a typed age) before the age check, and the effective age comes from the recorded readings at the Clock day, so it rises on the birthday and a lower stated age still wins. This is intended also when the join then stops for an unavailable invitation, a review refusal or a failed join hook: the person who controls the verified phone made the statement, so it is an age fact like a statement in the conversation, and a later lower age or a conflict must still see it. For a phone with no person, only the coarse typed-age reading reaches the phone's age floor, never the exact birth date.

```quint
pure def canCheckJoinAge(joining: Enrollment): bool =
  joining.phase == AwaitingAge and joining.currentEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def checkJoinAge(joining: Enrollment, ageEligible: bool, memberMissing: bool): Enrollment =
  { ...joining, ageAllowed: ageEligible,
    phase: if (not(ageEligible)) BelowJoinAge
      else if (joining.rejoin) (if (memberMissing) AwaitingRepair else ReturnExisting)
      else if (joining.invalidReferral) InvalidInvitation else AwaitingPersistence }

pure def canFinishRepair(joining: Enrollment): bool =
  joining.phase == AwaitingRepair and joining.rejoin and joining.ageAllowed
    and joining.currentEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def finishRepair(joining: Enrollment, hookSucceeded: bool): Enrollment =
  { ...joining, phase: if (hookSucceeded) ReturnExisting else JoinHookFailed }
```

### A decline below the join age ends the number's unbound access

When the effective age is below the age at which anyone may join, the decline also ends every session of the number that has no person and deletes the number's pending text joins. The age floor stays. A decline for an app's higher minimum age leaves them, because the person may still use the other apps. New rule on 2026-11-21 (audits AE-4 and JA-5): before, an under-13 web decline left the number's sessions, cookies and pending text join.

```quint
import memberAge as Age from "./memberAge"

pure def declineEndsUnboundAccess(effectiveAge: int): bool = Age::confirmedUnderage(effectiveAge)
```

### Success for a new membership follows the join hook

An ordinary join writes the membership, consent and person link, then runs the join hook. A hook failure runs the app's forget hook, forgets the new membership and records the failed opt-in's reversal, also when the failure is a review refusal, which then answers review. A failed repair of a repeated join does the same to the existing membership. The forget hook of a failed join removes only the Network member: the app's photos, the agent's grants and the signup drafts stay, because the person is still signing up and retries with the same agent. Added on 2026-11-21 (review of JA-4): the forget hook of a failed join first removed them too, so a transient failure took the agent's authorization mid-signup. Changed on 2026-11-21 (audits JA-4 and SIG68): before, the forget hook did not run, so a Network member made before the failure stayed, and a review refusal kept the membership and its opt-in. A referred join commits the app membership, consent, session attachment, Network attribution and invitation use together. A failed referral commit leaves those writes for the next verified attempt. A successful response reports the stored membership.

```quint
pure def canFinishJoin(joining: Enrollment): bool =
  joining.phase == AwaitingPersistence and not(joining.rejoin) and not(joining.invalidReferral) and joining.ageAllowed
    and joining.currentEligibility and joining.viewChecked and joining.validProfile and joining.currentConsent

pure def finishJoin(joining: Enrollment, hookSucceeded: bool): Enrollment =
  { ...joining, phase: if (hookSucceeded) Created else JoinHookFailed }

pure def joinFailureForgetsMembership(referred: bool): bool = not(referred)

pure def forgetEndsAppAccess(joinFailed: bool): bool = not(joinFailed)

pure def lawFailedOrdinaryJoinForgetsOnlyTheMember(joining: Enrollment): bool =
  (canFinishJoin(joining) and not(joining.referred))
    implies (finishJoin(joining, false).phase == JoinHookFailed and joinFailureForgetsMembership(joining.referred) and not(forgetEndsAppAccess(true)))
```

### The approved profile reaches onboarding and its stated age counts

The profile text is the `about` field plus the home area and ZIP that the request names. A request without an `about` field has no profile text: its home area and ZIP go only to the member record, so a browser join's first interview answer stays the member's own. An age that this text states about the person counts in the effective age check before anything is stored. An age counts when the text states it explicitly, when the Network declined the person for it, or when it is below the matching age. The Network's own reader of member text uses the same rule. So the lowest stated age wins, a text that states an age below the join age stores nothing for the app, and a text that states an age from 13 to 17 makes the member single-player.

The join hook creates the Network member and sends the welcome. Then it gives the profile text to that member once, as profile input from the member's own agent. A referred join gives it after its welcome, also when a later recovery sends that welcome. The Network reads the text with its usual rules and learns from it. In an app with its own onboarding loop (Slop), onboarding then asks only for the fields that are still missing. In an app with the fixed interview (Network, Friends), the text answers the first interview question, and the interview continues with its fixed questions. The text never answers a probe, a plan or a check-in, and it never blocks or reports anyone. The shell parses the agent's text with the Network's own readers. The text is untrusted input and never changes review or consent.

A failure to learn the profile does not undo the join: the member, the welcome, the membership and the consent stay, and the member gives the missing fields in the conversation. A repeated join keeps the existing membership and does not send its profile text again; the member changes the profile in the conversation.

```quint
pure def profileJoinAge(typedAge: int, profileAge: int, profileStatesAge: bool): int =
  if (profileStatesAge and profileAge < typedAge) profileAge else typedAge

pure def profileAgeCounts(statedExplicitly: bool, declinedForAge: bool, ageMatchable: bool): bool =
  statedExplicitly or declinedForAge or not(ageMatchable)

pure def lawProfileMinorAgeAlwaysCounts(statedExplicitly: bool, declinedForAge: bool): bool =
  profileAgeCounts(statedExplicitly, declinedForAge, false)

pure def lawProfileAgeNeverRaisesJoinAge(typedAge: int, profileAge: int, profileStatesAge: bool): bool =
  profileJoinAge(typedAge, profileAge, profileStatesAge) <= typedAge and
    (profileStatesAge implies profileJoinAge(typedAge, profileAge, profileStatesAge) <= profileAge)
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
pure def sometimesRepairsMember(joining: Enrollment): bool = joining.phase == AwaitingRepair
```

## Story: Keep the age readings of a person and a phone

> As a member who stated a birth date, I want my age to rise on my birthday wherever my readings go, so that a change of number or a new account on my phone never makes my age wrong.

Owner decision 2026-11-22: the service tracks the birth date, so each age statement is a range of possible birth dates ([member age](memberAge.md#each-age-statement-is-a-range-of-possible-birth-dates)). The platform keeps these readings on the person and on the phone's age floor. The rules below decide how the platform writes them.

### Readings of two records merge without a new date

When the readings of one record join the readings of another record, the merge keeps the largest lower key, the smallest upper key and the latest youngest key of the two records. The phone floor joins a new person this way, and on a change of number the floor of the new number joins the person this way. No reading gets a new date, so the age still rises on each birthday after the merge, and a conflict in either record stays a conflict. A record merges with no record as itself. Changed (owner decision 2026-11-22): on a change of number the service stated the old integer floor again as a typed age on the day of the change; after a birthday that typed age conflicted with an exact birth date, so the person lost the birthday rise and the teen pool got a permanent bar. The records now merge as they are.

```quint
pure def mergeAgeReadings(hasEarlier: bool, earlier: Age::BirthReadings, added: Age::BirthReadings): Age::BirthReadings =
  if (not(hasEarlier)) added
  else {
    lower: Age::laterBirthKey(earlier.lower, added.lower),
    upper: if (earlier.upper <= added.upper) earlier.upper else added.upper,
    youngest: Age::laterBirthKey(earlier.youngest, added.youngest)
  }

pure def lawMergeKeepsEveryYoungestReading(earlier: Age::BirthReadings, added: Age::BirthReadings): bool =
  val merged = mergeAgeReadings(true, earlier, added)
  merged.youngest >= earlier.youngest and merged.youngest >= added.youngest

pure def lawMergeNarrowsTheRange(earlier: Age::BirthReadings, added: Age::BirthReadings): bool =
  val merged = mergeAgeReadings(true, earlier, added)
  merged.lower >= earlier.lower and merged.lower >= added.lower and merged.upper <= earlier.upper and merged.upper <= added.upper

pure def lawMergeKeepsAConflict(earlier: Age::BirthReadings, added: Age::BirthReadings): bool =
  val merged = mergeAgeReadings(true, earlier, added)
  (earlier.lower >= earlier.upper or added.lower >= added.upper) implies merged.lower >= merged.upper

pure def lawMergeWithNoRecordKeepsTheRecord(earlier: Age::BirthReadings, added: Age::BirthReadings): bool =
  val merged = mergeAgeReadings(false, earlier, added)
  merged.lower == added.lower and merged.upper == added.upper and merged.youngest == added.youngest

pure val earlierValues = Set(
  { lower: 20100314, upper: 20100315, youngest: 20100315 },
  { lower: 20091122, upper: 20101122, youngest: 20101122 },
  { lower: 20120314, upper: 20100315, youngest: 20120315 },
  { lower: 20141121, upper: 20151122, youngest: 20151122 })
pure val addedValues = Set(
  { lower: 20090101, upper: 20100101, youngest: 20100101 },
  { lower: 20100314, upper: 20100315, youngest: 20100315 },
  { lower: 20131121, upper: 20141122, youngest: 20141122 },
  { lower: 20120314, upper: 20100315, youngest: 20120315 })
```

### A birth date below the join age is kept only as a typed age

A stated birth date stays on the person as an exact date only when a person exists and the age that the person's readings give with that date is at least 13. Otherwise the statement is kept as the typed age that it gives on the Clock day. So a refused person under 13 never has a birth date on record, and a phone with no person keeps only the coarse typed age. Changed (owner decision 2026-11-22): the service now asks for a birth date, and this decision moved from the platform code into this rule.

```quint
pure def exactReadingKept(statesBirthDate: bool, hasPerson: bool, ageWithBirthDate: int): bool =
  statesBirthDate and hasPerson and Age::joinableAge(ageWithBirthDate)

pure def lawUnderageBirthDateIsNeverKept(statesBirthDate: bool, hasPerson: bool, ageWithBirthDate: int): bool =
  not(Age::joinableAge(ageWithBirthDate)) implies not(exactReadingKept(statesBirthDate, hasPerson, ageWithBirthDate))

pure def lawBirthDateWithoutAPersonIsOnlyTyped(statesBirthDate: bool, ageWithBirthDate: int): bool =
  not(exactReadingKept(statesBirthDate, false, ageWithBirthDate))

pure val ageWithBirthDateValues = Set(-1, 0, 12, 13, 17, 18, 120, 121)
```

### The phone floor keeps the lowest age that a statement gives

The phone's age floor gets the typed-age reading of the lower of two ages: the age of the statement, and the age that the merged readings give after the statement. When the merged readings give no usable age, the floor keeps the age of the statement. So the floor never gets an age above the statement, and it follows a lower age that the person stated before. Changed (owner decision 2026-11-22): the service now asks for a birth date, and this decision moved from the platform code into this rule.

```quint
pure def floorStatedAge(statedAge: int, mergedAge: int): int =
  if (Age::ageInRange(mergedAge)) Age::lowerAge(statedAge, mergedAge) else statedAge

pure def lawFloorNeverRaisesTheStatedAge(statedAge: int, mergedAge: int): bool =
  floorStatedAge(statedAge, mergedAge) <= statedAge

pure def lawFloorFollowsALowerMergedAge(statedAge: int, mergedAge: int): bool =
  (Age::ageInRange(mergedAge) and mergedAge < statedAge) implies floorStatedAge(statedAge, mergedAge) == mergedAge

pure val statedAgeValues = Set(0, 12, 13, 15, 17, 18, 30)
pure val mergedAgeValues = Set(-1, 0, 12, 15, 18, 30, 121)
```

### Staff learn whether the first age reading was a birth date

The reviewer of a teen introduction sees whether the first age reading of a person was a usable birth date. The first reading is the first statement on the person or on the phone's age floor: a typed age, an age that a record held, or a birth date. When the answer is on record, it never changes. When it is not on record yet, it is true only when no earlier reading exists and the statement is a birth date that gives an age of at least 13. A new person on a phone that has an age floor takes the floor's answer, and a floor without an answer reads false. Erasure keeps a coarse floor whose answer is false, so a person who returns after erasure never reads true. When the floors of two numbers merge on a change of number, the merged floor reads false. Changed (owner decision 2026-11-22): a new person copied the floor readings but no answer, so the first birth date read true for a phone that had stated 12 or another age before, and the safety reviewer saw a wrong fact in the confirm step. Changed (owner decision 2026-11-22, answers A2 to A5): the staff confirm step and the safety-role approval are gone, so this fact is now one of the teen facts on the review card that the normal reviewer of each teen introduction reads.

```quint
pure def firstReadingExact(hasStored: bool, storedExact: bool, hadReading: bool, statesUsableBirthDate: bool): bool =
  if (hasStored) storedExact else (not(hadReading) and statesUsableBirthDate)

pure def lawAnEarlierReadingIsNeverFirstExact(hadReading: bool, statesUsableBirthDate: bool): bool =
  hadReading implies not(firstReadingExact(false, false, hadReading, statesUsableBirthDate))

pure def lawTheStoredAnswerNeverChanges(storedExact: bool, hadReading: bool, statesUsableBirthDate: bool): bool =
  firstReadingExact(true, storedExact, hadReading, statesUsableBirthDate) iff storedExact
```
