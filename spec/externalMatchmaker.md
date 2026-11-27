# External matchmaker sourcing

When local dating supply in a city is sparse, human-operated city matchmaker personas (one female and one male per city) can scout external adult prospects. Every outreach and pairing requires recorded approval from the review judge, or from a named staff member after the judge holds the item, under [automated review](automatedReview.md). External dating sourcing is strictly adult-only (18 to 120), never reuses prospects without explicit opt-in, purges prospect data immediately on opt-out or safety triggers, and isolates all external dating records from `peon.biz`.

## Story: Route personas consistently and trigger external sourcing only when local supply is sparse

> As an adult dating member in a sparse market, I want external scouting to trigger only when strong local matches are unavailable, with one consistent matchmaker persona per prospect.

### Route each prospect deterministically to one locked matchmaker persona

Each city runs two personas: female (`0`) and male (`1`). Once a prospect has a persona lock (`0` or `1`), routing must always return that locked persona and never switch to the sibling persona. Without a lock, `slop` (`1`) routes by member and prospect gender, and `friends` (`3`) routes deterministically by tie-break bit.

```quint
pure val matchmakerPersonaFemale: int = 0
pure val matchmakerPersonaMale: int = 1

pure val matchmakerAppNtwrk: int = 0
pure val matchmakerAppSlop: int = 1
pure val matchmakerAppPeon: int = 2
pure val matchmakerAppFriends: int = 3

pure val genderWoman: int = 0
pure val genderMan: int = 1
pure val genderNonbinary: int = 2
pure val genderUnknown: int = -1

pure val personaStatusActive: int = 0
pure val personaStatusDegraded: int = 1
pure val personaStatusSuspended: int = 2

pure val prospectConsentNone: int = 0
pure val prospectConsentSingleOnly: int = 1
pure val prospectConsentFutureOptin: int = 2
pure val prospectConsentSmsLogistics: int = 3
pure val prospectConsentDeclined: int = 4
pure val prospectConsentStopped: int = 5
pure val prospectConsentBanned: int = 6

type RouteMatchmakerPersonaInput = {
  appCode: int,
  memberGender: int,
  targetProspectGender: int,
  existingLockPersona: int,
  tieBreakBit: int
}

pure def routeMatchmakerPersona(req: RouteMatchmakerPersonaInput): int =
  if (req.existingLockPersona == matchmakerPersonaFemale) matchmakerPersonaFemale
  else if (req.existingLockPersona >= matchmakerPersonaMale) matchmakerPersonaMale
  else if (req.appCode == matchmakerAppSlop)
    if (req.targetProspectGender == genderMan)
      if (req.memberGender == genderMan) matchmakerPersonaMale else matchmakerPersonaFemale
    else if (req.targetProspectGender == genderWoman)
      if (req.memberGender == genderWoman) matchmakerPersonaFemale else matchmakerPersonaMale
    else if (req.memberGender == genderWoman) matchmakerPersonaFemale
    else if (req.memberGender == genderMan) matchmakerPersonaMale
    else if (req.tieBreakBit == 0) matchmakerPersonaFemale else matchmakerPersonaMale
  else
    if (req.tieBreakBit == 0) matchmakerPersonaFemale else matchmakerPersonaMale

pure val appCodeValues = Set(0, 1, 2, 3)
pure val existingLockPersonaValues = Set(-1, 0, 1)
pure val memberGenderValues = Set(-1, 0, 1, 2)
pure val targetProspectGenderValues = Set(-1, 0, 1, 2)

pure def lawPersonaLockNeverSwitches(appCode: int, memberGender: int, targetProspectGender: int, existingLockPersona: int): bool =
  val picked = routeMatchmakerPersona({
    appCode: appCode,
    memberGender: memberGender,
    targetProspectGender: targetProspectGender,
    existingLockPersona: existingLockPersona,
    tieBreakBit: 0
  })
  and {
    picked == matchmakerPersonaFemale or picked == matchmakerPersonaMale,
    existingLockPersona == matchmakerPersonaFemale implies picked == matchmakerPersonaFemale,
    existingLockPersona == matchmakerPersonaMale implies picked == matchmakerPersonaMale
  }
```

### Trigger external sourcing only for eligible adults with sparse local supply

External dating sourcing triggers only when zero local eligible pairs exist or the top reciprocal score falls below the strong match threshold, and the member is an adult aged 18 to 120 who opted into romance and external scouting, is not paused or opted out, passes trust and readiness checks, and has zero active sourcing tickets.

```quint
type ExternalSourcingTriggerInput = {
  eligibleLocalPairs: int,
  topScoreScaled: int,
  strongThresholdScaled: int,
  memberAge: int,
  memberOptedInRomance: bool,
  memberPaused: bool,
  memberOptedOut: bool,
  memberTrustOk: bool,
  memberStageReady: bool,
  memberExternalScoutOptIn: bool,
  activeSourcingTickets: int
}

pure def shouldTriggerExternalSourcing(req: ExternalSourcingTriggerInput): bool =
  (req.eligibleLocalPairs <= 0 or req.topScoreScaled < req.strongThresholdScaled) and
    req.memberAge >= 18 and
    req.memberAge <= 120 and
    req.memberOptedInRomance and
    not(req.memberPaused) and
    not(req.memberOptedOut) and
    req.memberTrustOk and
    req.memberStageReady and
    req.memberExternalScoutOptIn and
    req.activeSourcingTickets == 0

pure val eligibleLocalPairsValues = Set(0, 1, 3)
pure val topScoreScaledValues = Set(300, 500, 700)
pure val memberAgeValues = Set(13, 17, 18, 28, 120, 121)
pure val activeSourcingTicketsValues = Set(0, 1)

pure def lawDenseLocalSupplySkipsExternalSourcing(eligibleLocalPairs: int, topScoreScaled: int): bool =
  val ok = shouldTriggerExternalSourcing({
    eligibleLocalPairs: eligibleLocalPairs,
    topScoreScaled: topScoreScaled,
    strongThresholdScaled: 500,
    memberAge: 28,
    memberOptedInRomance: true,
    memberPaused: false,
    memberOptedOut: false,
    memberTrustOk: true,
    memberStageReady: true,
    memberExternalScoutOptIn: true,
    activeSourcingTickets: 0
  })
  (eligibleLocalPairs > 0 and topScoreScaled >= 500) implies not(ok)

pure def lawMinorOrBusyMemberNeverTriggersSourcing(memberAge: int, activeSourcingTickets: int, memberExternalScoutOptIn: bool): bool =
  val ok = shouldTriggerExternalSourcing({
    eligibleLocalPairs: 0,
    topScoreScaled: 0,
    strongThresholdScaled: 500,
    memberAge: memberAge,
    memberOptedInRomance: true,
    memberPaused: false,
    memberOptedOut: false,
    memberTrustOk: true,
    memberStageReady: true,
    memberExternalScoutOptIn: memberExternalScoutOptIn,
    activeSourcingTickets: activeSourcingTickets
  })
  ok implies (memberAge >= 18 and memberAge <= 120 and activeSourcingTickets == 0 and memberExternalScoutOptIn)
```

## Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation

> As a prospect or member, I want every external message to be reviewed, transparent, link-free, adult-only, bounded in retention, quality-gated for onboarding, and never visible to the hiring app.

### Gate every external contact on adult age, recorded review, transparency, consent, kill-switch health, and TTL

Outbound contact to an external prospect requires adult age (18 to 120), recorded approval under [automated review](automatedReview.md), upfront persona disclosure, zero URLs or brand spam, passing leak and classifier checks, no opt-out, decline, or suppression, logged off-app consent for SMS handoffs, an active or degraded persona under its effective daily cap (`effectivePersonaOutboundCap` gives the full base cap for `active`, halves the base cap with floor 1 for `degraded`, and gives `0` for `suspended` or unknown status), zero ban-evasion attempts, no holds or bans on either party, a matching persona lock, an active consent code (`0` to `3`), and a cache age within 60 days for `intro_future_optin` (`2`) or 30 days otherwise.

```quint
type ContactExternalProspectInput = {
  statedAge: int,
  reviewApproved: bool,
  personaDisclosed: bool,
  containsUrlOrBrandSpam: bool,
  passedLeakAndClefGuard: bool,
  optedOut: bool,
  declined: bool,
  suppressed: bool,
  isSmsHandoff: bool,
  hasLoggedOffAppConsent: bool,
  personaStatus: int,
  dailyOutboundCount: int,
  dailyOutboundCap: int,
  evasionAttempt: bool,
  memberHeld: bool,
  prospectHeld: bool,
  memberBanned: bool,
  prospectBanned: bool,
  personaMatchesLock: bool,
  consentState: int,
  cacheAgeDays: int
}

pure def effectivePersonaOutboundCap(personaStatus: int, dailyOutboundCap: int): int =
  if (dailyOutboundCap <= 0) 0
  else if (personaStatus == personaStatusActive) dailyOutboundCap
  else if (personaStatus == personaStatusDegraded)
    if (dailyOutboundCap / 2 > 0) dailyOutboundCap / 2 else 1
  else 0

pure def canContactExternalProspect(req: ContactExternalProspectInput): bool =
  val maxTtlDays = if (req.consentState == prospectConsentFutureOptin) 60 else 30
  val allowedCap = effectivePersonaOutboundCap(req.personaStatus, req.dailyOutboundCap)
  req.statedAge >= 18 and
    req.statedAge <= 120 and
    req.reviewApproved and
    req.personaDisclosed and
    not(req.containsUrlOrBrandSpam) and
    req.passedLeakAndClefGuard and
    not(req.optedOut) and
    not(req.declined) and
    not(req.suppressed) and
    (not(req.isSmsHandoff) or req.hasLoggedOffAppConsent) and
    (req.personaStatus == personaStatusActive or req.personaStatus == personaStatusDegraded) and
    allowedCap > 0 and
    req.dailyOutboundCount >= 0 and
    req.dailyOutboundCount < allowedCap and
    not(req.evasionAttempt) and
    not(req.memberHeld) and
    not(req.prospectHeld) and
    not(req.memberBanned) and
    not(req.prospectBanned) and
    req.personaMatchesLock and
    req.consentState >= prospectConsentNone and
    req.consentState <= prospectConsentSmsLogistics and
    req.cacheAgeDays >= 0 and
    req.cacheAgeDays <= maxTtlDays

pure val statedAgeValues = Set(13, 17, 18, 29, 120, 121)
pure val personaStatusValues = Set(0, 1, 2)
pure val dailyOutboundCapValues = Set(0, 1, 4, 10)
pure val consentStateValues = Set(0, 1, 2, 3, 4, 5, 6)
pure val cacheAgeDaysValues = Set(-1, 0, 30, 31, 60, 61)

pure def lawDegradedPersonaHalvesCapAndSuspendedHalts(personaStatus: int, dailyOutboundCap: int): bool =
  val cap = effectivePersonaOutboundCap(personaStatus, dailyOutboundCap)
  and {
    personaStatus == personaStatusSuspended implies cap == 0,
    (personaStatus != personaStatusActive and personaStatus != personaStatusDegraded) implies cap == 0,
    dailyOutboundCap <= 0 implies cap == 0,
    (personaStatus == personaStatusActive and dailyOutboundCap > 0) implies cap == dailyOutboundCap,
    (personaStatus == personaStatusDegraded and dailyOutboundCap >= 2) implies (cap > 0 and cap == dailyOutboundCap / 2),
    (personaStatus == personaStatusDegraded and dailyOutboundCap == 1) implies cap == 1
  }

pure def lawMinorOrUnreviewedNeverExternallyContacted(statedAge: int, reviewApproved: bool, personaDisclosed: bool): bool =
  val ok = canContactExternalProspect({
    statedAge: statedAge,
    reviewApproved: reviewApproved,
    personaDisclosed: personaDisclosed,
    containsUrlOrBrandSpam: false,
    passedLeakAndClefGuard: true,
    optedOut: false,
    declined: false,
    suppressed: false,
    isSmsHandoff: false,
    hasLoggedOffAppConsent: false,
    personaStatus: personaStatusActive,
    dailyOutboundCount: 0,
    dailyOutboundCap: 10,
    evasionAttempt: false,
    memberHeld: false,
    prospectHeld: false,
    memberBanned: false,
    prospectBanned: false,
    personaMatchesLock: true,
    consentState: prospectConsentSingleOnly,
    cacheAgeDays: 5
  })
  ok implies (statedAge >= 18 and statedAge <= 120 and reviewApproved and personaDisclosed)

pure def lawSuspendedOrSpamOrColdSmsNeverContacted(
  personaStatus: int,
  containsUrlOrBrandSpam: bool,
  isSmsHandoff: bool,
  hasLoggedOffAppConsent: bool
): bool =
  val ok = canContactExternalProspect({
    statedAge: 29,
    reviewApproved: true,
    personaDisclosed: true,
    containsUrlOrBrandSpam: containsUrlOrBrandSpam,
    passedLeakAndClefGuard: true,
    optedOut: false,
    declined: false,
    suppressed: false,
    isSmsHandoff: isSmsHandoff,
    hasLoggedOffAppConsent: hasLoggedOffAppConsent,
    personaStatus: personaStatus,
    dailyOutboundCount: 0,
    dailyOutboundCap: 10,
    evasionAttempt: false,
    memberHeld: false,
    prospectHeld: false,
    memberBanned: false,
    prospectBanned: false,
    personaMatchesLock: true,
    consentState: prospectConsentSingleOnly,
    cacheAgeDays: 5
  })
  ok implies ((personaStatus == personaStatusActive or personaStatus == personaStatusDegraded) and not(containsUrlOrBrandSpam) and (not(isSmsHandoff) or hasLoggedOffAppConsent))

pure def lawContactEnforcesTtlAndNoEvasionOrBans(consentState: int, cacheAgeDays: int, evasionAttempt: bool, prospectBanned: bool): bool =
  val ok = canContactExternalProspect({
    statedAge: 29,
    reviewApproved: true,
    personaDisclosed: true,
    containsUrlOrBrandSpam: false,
    passedLeakAndClefGuard: true,
    optedOut: false,
    declined: false,
    suppressed: false,
    isSmsHandoff: false,
    hasLoggedOffAppConsent: false,
    personaStatus: personaStatusActive,
    dailyOutboundCount: 0,
    dailyOutboundCap: 10,
    evasionAttempt: evasionAttempt,
    memberHeld: false,
    prospectHeld: false,
    memberBanned: false,
    prospectBanned: prospectBanned,
    personaMatchesLock: true,
    consentState: consentState,
    cacheAgeDays: cacheAgeDays
  })
  and {
    ok implies (not(evasionAttempt) and not(prospectBanned) and consentState >= 0 and consentState <= 3),
    (ok and consentState == prospectConsentFutureOptin) implies (cacheAgeDays >= 0 and cacheAgeDays <= 60),
    (ok and consentState != prospectConsentFutureOptin) implies (cacheAgeDays >= 0 and cacheAgeDays <= 30)
  }
```

### Reconsider a cached prospect only with explicit future opt-in, 30-day cooldown, and review approval

A cached prospect can be reconsidered for another member only when consent is `intro_future_optin` (`2`), cache age is 0 to 60 days, at least 30 days have passed since last contact, fewer than 2 recontacts have occurred, the prospect is an adult aged 18 to 120 without opt-out, ban, or red flag, the locked persona matches, and review approval is recorded.

```quint
type ReconsiderExternalProspectInput = {
  consentState: int,
  cacheAgeDays: int,
  daysSinceLastContact: int,
  recontactCount: int,
  statedAge: int,
  optedOut: bool,
  banned: bool,
  redFlagged: bool,
  personaMatchesLock: bool,
  reviewApproved: bool
}

pure def canReconsiderExternalProspect(req: ReconsiderExternalProspectInput): bool =
  req.consentState == prospectConsentFutureOptin and
    req.cacheAgeDays >= 0 and
    req.cacheAgeDays <= 60 and
    req.daysSinceLastContact >= 30 and
    req.recontactCount >= 0 and
    req.recontactCount < 2 and
    req.statedAge >= 18 and
    req.statedAge <= 120 and
    not(req.optedOut) and
    not(req.banned) and
    not(req.redFlagged) and
    req.personaMatchesLock and
    req.reviewApproved

pure val daysSinceLastContactValues = Set(0, 29, 30, 45)
pure val recontactCountValues = Set(0, 1, 2)

pure def lawNoColdReuseWithoutFutureOptInAndCooldown(consentState: int, daysSinceLastContact: int, recontactCount: int): bool =
  val ok = canReconsiderExternalProspect({
    consentState: consentState,
    cacheAgeDays: 40,
    daysSinceLastContact: daysSinceLastContact,
    recontactCount: recontactCount,
    statedAge: 29,
    optedOut: false,
    banned: false,
    redFlagged: false,
    personaMatchesLock: true,
    reviewApproved: true
  })
  ok implies (consentState == prospectConsentFutureOptin and daysSinceLastContact >= 30 and recontactCount >= 0 and recontactCount < 2)
```

### Purge prospect data immediately on opt-out, decline, underage, red flag, or TTL expiry

When any purge trigger fires (stopped, declined, blocked, deletion requested, underage detected, red-flagged, expired, or cache age outside the bounded TTL up to 60 days), retention returns `"purge_with_suppression"`. Otherwise it returns `"keep"`.

```quint
type ProspectRetentionInput = {
  stopped: bool,
  declined: bool,
  blocked: bool,
  deletionRequested: bool,
  underageDetected: bool,
  redFlagged: bool,
  expired: bool,
  cacheAgeDays: int,
  maxTtlDays: int
}

pure def prospectRetentionDecision(req: ProspectRetentionInput): str =
  if (
    req.stopped or
    req.declined or
    req.blocked or
    req.deletionRequested or
    req.underageDetected or
    req.redFlagged or
    req.expired or
    req.cacheAgeDays < 0 or
    req.maxTtlDays <= 0 or
    req.maxTtlDays > 60 or
    req.cacheAgeDays > req.maxTtlDays
  ) "purge_with_suppression"
  else "keep"

pure val maxTtlDaysValues = Set(0, 30, 60, 61)

pure def lawStopUnderageOrExpiredPurgesWithSuppression(stopped: bool, underageDetected: bool, cacheAgeDays: int, maxTtlDays: int): bool =
  val decision = prospectRetentionDecision({
    stopped: stopped,
    declined: false,
    blocked: false,
    deletionRequested: false,
    underageDetected: underageDetected,
    redFlagged: false,
    expired: false,
    cacheAgeDays: cacheAgeDays,
    maxTtlDays: maxTtlDays
  })
  and {
    (stopped or underageDetected or cacheAgeDays < 0 or maxTtlDays <= 0 or maxTtlDays > 60 or cacheAgeDays > maxTtlDays) implies decision == "purge_with_suppression",
    decision == "keep" implies (not(stopped) and not(underageDetected) and cacheAgeDays >= 0 and maxTtlDays > 0 and maxTtlDays <= 60 and cacheAgeDays <= maxTtlDays)
  }
```

### Invite an external prospect to the Network only after a positive attended meetup

A warm Network onboarding invite is permitted at most once and only when the meetup completed, both the member and prospect attended, no safety, red-flag, catfish, or age-mismatch signal occurred, the member reported positive quality or vouched for others, the prospect is an adult aged 18 to 120 who is not opted out, banned, or already a member, zero prior invites were sent, and the local follow-up window is safe.

```quint
type InviteExternalProspectInput = {
  meetupCompleted: bool,
  memberAttended: bool,
  prospectAttended: bool,
  safetyOrRedFlag: bool,
  catfishOrAgeMismatch: bool,
  memberQualityPositive: bool,
  memberVouchedForOthers: bool,
  statedAge: int,
  optedOut: bool,
  banned: bool,
  alreadyMember: bool,
  inviteAttempts: int,
  safeFollowupWindow: bool
}

pure def canInviteExternalProspectToNetwork(req: InviteExternalProspectInput): bool =
  req.meetupCompleted and
    req.memberAttended and
    req.prospectAttended and
    not(req.safetyOrRedFlag) and
    not(req.catfishOrAgeMismatch) and
    (req.memberQualityPositive or req.memberVouchedForOthers) and
    req.statedAge >= 18 and
    req.statedAge <= 120 and
    not(req.optedOut) and
    not(req.banned) and
    not(req.alreadyMember) and
    req.inviteAttempts == 0 and
    req.safeFollowupWindow

pure val inviteAttemptsValues = Set(0, 1, 2)

pure def lawNetworkInviteRequiresPositiveAttendedMeetup(
  meetupCompleted: bool,
  prospectAttended: bool,
  memberQualityPositive: bool,
  memberVouchedForOthers: bool
): bool =
  val ok = canInviteExternalProspectToNetwork({
    meetupCompleted: meetupCompleted,
    memberAttended: true,
    prospectAttended: prospectAttended,
    safetyOrRedFlag: false,
    catfishOrAgeMismatch: false,
    memberQualityPositive: memberQualityPositive,
    memberVouchedForOthers: memberVouchedForOthers,
    statedAge: 29,
    optedOut: false,
    banned: false,
    alreadyMember: false,
    inviteAttempts: 0,
    safeFollowupWindow: true
  })
  ok implies (meetupCompleted and prospectAttended and (memberQualityPositive or memberVouchedForOthers))

pure def lawNetworkInviteBlocksFlagsMinorsAndDuplicates(safetyOrRedFlag: bool, statedAge: int, inviteAttempts: int): bool =
  val ok = canInviteExternalProspectToNetwork({
    meetupCompleted: true,
    memberAttended: true,
    prospectAttended: true,
    safetyOrRedFlag: safetyOrRedFlag,
    catfishOrAgeMismatch: false,
    memberQualityPositive: true,
    memberVouchedForOthers: false,
    statedAge: statedAge,
    optedOut: false,
    banned: false,
    alreadyMember: false,
    inviteAttempts: inviteAttempts,
    safeFollowupWindow: true
  })
  ok implies (not(safetyOrRedFlag) and statedAge >= 18 and statedAge <= 120 and inviteAttempts == 0)
```

### Isolate external dating prospects strictly inside `slop` and block `peon`

External dating prospect records and signals may be read only inside `slop` (`1`). The work and hiring app `peon` (`2`) and every other non-`slop` app always receive `false`.

```quint
pure def canReadExternalProspectInApp(appCode: int): bool =
  appCode == matchmakerAppSlop

pure def lawPeonCannotReadExternalProspects(appCode: int): bool =
  and {
    not(canReadExternalProspectInApp(matchmakerAppPeon)),
    canReadExternalProspectInApp(appCode) iff appCode == matchmakerAppSlop
  }
```
