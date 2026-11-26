# External dual-persona matchmaker

## Story: Source adult external matches safely with review gates, single-persona locks, privacy purges, kill-switches, and a cross-app firewall

When local in-network dating density is sparse for an opted-in adult member, a city's dual-persona matchmaker pair (female and male) may scout adult external prospects only under recorded review approval, honest upfront matchmaker disclosure with zero links or brand spam, single-persona consistency locks, logged off-app SMS consent, bounded TTL and immediate purge with suppression tombstones, kill-switch failover without ban evasion, post-date quality-gated onboarding invites, and strict isolation from `peon.biz`.

### Safety rules and reachability

Check strict 18+ adult-only enforcement (minors never enter external dating or matchmaker sourcing), single-persona consistency locks, recorded review approval ([automated review](../automatedReview.md): review judge or named staff for held items), persona disclosure with zero URLs or brand spam, consent and suppression enforcement, bounded prospect cache TTL and immediate purge with suppression tombstones, explicit `intro_future_optin` plus 30-day cooldown before reuse, immediate kill-switch suspension on ban or shadowban signals without burner evasion while preserving booked off-app SMS setups, exclusion of banned or held members and prospects, post-meetup positive-feedback quality-gated invites, and the `peon` cross-app firewall. The model defines the checks in `safety`, the reachable states in `witness_*`, and the replay traces in `run` definitions.

The [external matchmaker spec](../externalMatchmaker.md) generates pure persona routing, density trigger, outreach, reconsideration, retention/purge, invite, and cross-app firewall decisions.

See [model index](README.md) for scope and commands.

```quint
// -*- mode: Bluespec; -*-
// quint-check: max-steps=35 max-samples=4000 verify-steps=8
//
// Per-city dual-persona matchmakers (female, male), deterministic persona consistency lock,
// density-aware sourcing trigger, recorded review approval (spec/automatedReview.md),
// persona bio disclosure & zero-link/spam guard, off-app SMS consent gate, prospect cache TTL
// & immediate purge with suppression tombstone, no cold reuse without explicit intro_future_optin
// + 30d cooldown, ban/shadowban kill-switch & no-evasion failover preserving booked off-app setups,
// post-date quality-gated Network invite, and peon cross-app score/prospect firewall
// (docs/design/2026-11-26-meetup-setup-and-external-matchmaking.md;
// spec/externalMatchmaker.md, spec/automatedReview.md, spec/friendIntroAge.md).
//
// Bounds: 2 city personas ("female", "male"), 3 prospects ("p1" adult, "p2" adult, "p3" minor age 16),
// 1 adult Network member seeking external sourcing when local density is sparse.
module external_matchmaker {

  // ------------------------------------------------------------------------------------------ constants
  pure val PERSONAS = Set("female", "male")
  pure val PROSPECTS = Set("p1", "p2", "p3")
  pure val APPS = Set("slop", "peon", "friends", "ntwrk")
  pure val DAILY_OUTBOUND_CAP = 4
  pure val STANDARD_TTL_DAYS = 30
  pure val OPTIN_TTL_DAYS = 60
  pure val RECONTACT_COOLDOWN_DAYS = 30
  pure val MAX_RECONTACTS = 2
  pure val STRONG_SCORE_THRESHOLD = 50

  // ------------------------------------------------------------------------------------------ types
  type PersonaState = {
    status: str,              // active | suspended
    dailyOutboundCount: int,
    banSignalSeen: bool,
  }

  type Prospect = {
    statedAge: int,
    personaLock: str,         // "" | female | male
    stage: str,               // uncontacted | qualifying | soft_yes | pair_reviewed | member_probed | member_yes | booked | completed | closed
    consentState: str,        // none | intro_single_only | intro_future_optin | sms_logistics_optin | declined | stopped | blocked | deletion_requested | underage | red_flagged | expired
    hasLoggedOffAppConsent: bool,
    cachedPiiPresent: bool,
    cacheAgeDays: int,
    daysSinceLastContact: int,
    recontactCount: int,
    optedOut: bool,
    banned: bool,
    held: bool,
    declined: bool,
    suppressed: bool,
    redFlagged: bool,
    alreadyMember: bool,
    memberAttended: bool,
    prospectAttended: bool,
    positiveOrVouched: bool,
    safetyFlag: bool,
    catfishMismatch: bool,
    inviteAttempts: int,
  }

  type OutreachEv = {
    prospect: str,
    persona: str,
    statedAge: int,
    reviewApprover: str,        // "judge" | "staff" (spec/automatedReview.md)
    humanReviewApproved: bool,
    personaDisclosed: bool,
    containsUrlOrBrandSpam: bool,
    leakPassed: bool,
    clefPassed: bool,
    isSmsHandoff: bool,
    hasLoggedOffAppConsent: bool,
    optedOutAtSend: bool,
    bannedAtSend: bool,
    declinedAtSend: bool,
    suppressedAtSend: bool,
    memberHeldAtSend: bool,
    prospectHeldAtSend: bool,
    personaStatusAtSend: str,
    dailyCountBefore: int,
    isEvasionBurner: bool,
    cacheAgeDays: int,
    maxTtlDays: int,
  }

  type ReuseEv = {
    prospect: str,
    persona: str,
    statedAge: int,
    consentStateAtReuse: str,
    cacheAgeDays: int,
    daysSinceLastContact: int,
    recontactCountBefore: int,
    personaMatchesLock: bool,
    reviewApprover: str,
    humanReviewApproved: bool,
    personaStatusAtSend: str,
    dailyCountBefore: int,
    memberHeld: bool,
    prospectHeld: bool,
    prospectBanned: bool,
    isEvasionBurner: bool,
  }

  type InviteEv = {
    prospect: str,
    meetupCompleted: bool,
    memberAttended: bool,
    prospectAttended: bool,
    safetyFlag: bool,
    catfishMismatch: bool,
    positiveOrVouched: bool,
    statedAge: int,
    optedOut: bool,
    banned: bool,
    suppressed: bool,
    alreadyMember: bool,
    inviteAttemptsBefore: int,
    safeFollowupWindow: bool,
  }

  type ReadEv = {
    app: str,
    prospect: str,
  }

  // ------------------------------------------------------------------------------------------ state
  var nowDays: int
  var personas: str -> PersonaState
  var prospects: str -> Prospect
  var memberAge: int
  var eligibleLocalPairs: int
  var topScoreScaled: int
  var memberOptedInRomance: bool
  var memberPaused: bool
  var memberOptedOut: bool
  var memberTrustOk: bool
  var memberHeld: bool
  var memberExternalScoutOptIn: bool
  var sourcingTriggered: bool
  var briefReviewApprover: str        // "" | "judge" | "staff"
  var briefReviewApproved: bool
  var safeFollowupWindow: bool
  // Ghost logs & witness counters
  var outreachLog: Set[OutreachEv]
  var reuseLog: Set[ReuseEv]
  var inviteLog: Set[InviteEv]
  var readLog: Set[ReadEv]
  var evasionBlockedCount: int
  var peonBlockedReads: int
  var failoverBookedPreserved: bool
  var purgeCount: int

  // ------------------------------------------------------------------------------------------ helpers
  pure def isAdult(age: int): bool = age >= 18 and age <= 120

  pure def maxTtlFor(consent: str): int =
    if (consent == "intro_future_optin") OPTIN_TTL_DAYS else STANDARD_TTL_DAYS

  pure def isPurgeReasonState(pr: Prospect): bool =
    pr.optedOut or pr.declined or pr.banned or pr.redFlagged or
    not(isAdult(pr.statedAge)) or
    pr.consentState == "stopped" or
    pr.consentState == "declined" or
    pr.consentState == "blocked" or
    pr.consentState == "deletion_requested" or
    pr.consentState == "underage" or
    pr.consentState == "red_flagged" or
    pr.consentState == "expired"

  pure def routePersona(p: str, existingLock: str): str =
    if (existingLock != "") existingLock
    else if (p == "p1") "female"
    else "male"

  pure def mkProspect(age: int): Prospect = {
    statedAge: age,
    personaLock: "",
    stage: "uncontacted",
    consentState: "none",
    hasLoggedOffAppConsent: false,
    cachedPiiPresent: false,
    cacheAgeDays: 0,
    daysSinceLastContact: 0,
    recontactCount: 0,
    optedOut: false,
    banned: false,
    held: false,
    declined: false,
    suppressed: false,
    redFlagged: false,
    alreadyMember: false,
    memberAttended: false,
    prospectAttended: false,
    positiveOrVouched: false,
    safetyFlag: false,
    catfishMismatch: false,
    inviteAttempts: 0,
  }

  // ------------------------------------------------------------------------------------------ init
  action init = all {
    nowDays' = 0,
    personas' = Map(
      "female" -> { status: "active", dailyOutboundCount: 0, banSignalSeen: false },
      "male"   -> { status: "active", dailyOutboundCount: 0, banSignalSeen: false },
    ),
    prospects' = Map(
      "p1" -> mkProspect(27),
      "p2" -> mkProspect(30),
      "p3" -> mkProspect(16),
    ),
    memberAge' = 28,
    eligibleLocalPairs' = 0,
    topScoreScaled' = 35,
    memberOptedInRomance' = true,
    memberPaused' = false,
    memberOptedOut' = false,
    memberTrustOk' = true,
    memberHeld' = false,
    memberExternalScoutOptIn' = true,
    sourcingTriggered' = false,
    briefReviewApprover' = "",
    briefReviewApproved' = false,
    safeFollowupWindow' = true,
    outreachLog' = Set(),
    reuseLog' = Set(),
    inviteLog' = Set(),
    readLog' = Set(),
    evasionBlockedCount' = 0,
    peonBlockedReads' = 0,
    failoverBookedPreserved' = false,
    purgeCount' = 0,
  }

  // ------------------------------------------------------------------------------------------ actions
  action triggerExternalSourcing: bool = all {
    not(sourcingTriggered),
    eligibleLocalPairs == 0 or topScoreScaled < STRONG_SCORE_THRESHOLD,
    isAdult(memberAge),
    memberOptedInRomance,
    not(memberPaused),
    not(memberOptedOut),
    memberTrustOk,
    not(memberHeld),
    memberExternalScoutOptIn,
    sourcingTriggered' = true,
    nowDays' = nowDays, personas' = personas, prospects' = prospects,
    memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
    memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
    memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
    memberExternalScoutOptIn' = memberExternalScoutOptIn,
    briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
    safeFollowupWindow' = safeFollowupWindow, outreachLog' = outreachLog, reuseLog' = reuseLog,
    inviteLog' = inviteLog, readLog' = readLog, evasionBlockedCount' = evasionBlockedCount,
    peonBlockedReads' = peonBlockedReads, failoverBookedPreserved' = failoverBookedPreserved,
    purgeCount' = purgeCount,
  }

  // Recorded review approval (spec/automatedReview.md): review judge or named staff for a held item.
  action approveSourcingBrief(approver: str): bool = all {
    sourcingTriggered,
    not(briefReviewApproved),
    Set("judge", "staff").contains(approver),
    not(memberHeld),
    briefReviewApprover' = approver,
    briefReviewApproved' = true,
    nowDays' = nowDays, personas' = personas, prospects' = prospects,
    memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
    memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
    memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
    memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
    safeFollowupWindow' = safeFollowupWindow, outreachLog' = outreachLog, reuseLog' = reuseLog,
    inviteLog' = inviteLog, readLog' = readLog, evasionBlockedCount' = evasionBlockedCount,
    peonBlockedReads' = peonBlockedReads, failoverBookedPreserved' = failoverBookedPreserved,
    purgeCount' = purgeCount,
  }

  action contactExternalProspect(
    p: str,
    persona: str,
    humanReviewApproved: bool,
    personaDisclosed: bool,
    containsUrlOrBrandSpam: bool,
    leakPassed: bool,
    clefPassed: bool
  ): bool = {
    val pr = prospects.get(p)
    val per = personas.get(persona)
    val assigned = routePersona(p, pr.personaLock)
    val maxTtl = maxTtlFor(pr.consentState)
    val ev: OutreachEv = {
      prospect: p,
      persona: persona,
      statedAge: pr.statedAge,
      reviewApprover: briefReviewApprover,
      humanReviewApproved: humanReviewApproved,
      personaDisclosed: personaDisclosed,
      containsUrlOrBrandSpam: containsUrlOrBrandSpam,
      leakPassed: leakPassed,
      clefPassed: clefPassed,
      isSmsHandoff: false,
      hasLoggedOffAppConsent: pr.hasLoggedOffAppConsent,
      optedOutAtSend: pr.optedOut,
      bannedAtSend: pr.banned,
      declinedAtSend: pr.declined,
      suppressedAtSend: pr.suppressed,
      memberHeldAtSend: memberHeld,
      prospectHeldAtSend: pr.held,
      personaStatusAtSend: per.status,
      dailyCountBefore: per.dailyOutboundCount,
      isEvasionBurner: false,
      cacheAgeDays: pr.cacheAgeDays,
      maxTtlDays: maxTtl,
    }
    all {
      sourcingTriggered,
      briefReviewApproved,
      Set("judge", "staff").contains(briefReviewApprover),
      PROSPECTS.contains(p),
      PERSONAS.contains(persona),
      pr.stage == "uncontacted",
      persona == assigned,
      isAdult(pr.statedAge),
      humanReviewApproved,
      personaDisclosed,
      not(containsUrlOrBrandSpam),
      leakPassed,
      clefPassed,
      not(pr.optedOut),
      not(pr.banned),
      not(pr.declined),
      not(pr.suppressed),
      not(pr.redFlagged),
      not(memberHeld),
      not(pr.held),
      per.status == "active",
      not(per.banSignalSeen),
      per.dailyOutboundCount < DAILY_OUTBOUND_CAP,
      pr.cacheAgeDays <= maxTtl,
      personas' = personas.set(persona, { ...per, dailyOutboundCount: per.dailyOutboundCount + 1 }),
      prospects' = prospects.set(p, {
        ...pr,
        personaLock: assigned,
        stage: "qualifying",
        consentState: "intro_single_only",
        cachedPiiPresent: true,
        cacheAgeDays: 0,
        daysSinceLastContact: 0,
      }),
      outreachLog' = outreachLog.union(Set(ev)),
      nowDays' = nowDays, memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs,
      topScoreScaled' = topScoreScaled, memberOptedInRomance' = memberOptedInRomance,
      memberPaused' = memberPaused, memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk,
      memberHeld' = memberHeld, memberExternalScoutOptIn' = memberExternalScoutOptIn,
      sourcingTriggered' = sourcingTriggered, briefReviewApprover' = briefReviewApprover,
      briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow, reuseLog' = reuseLog, inviteLog' = inviteLog,
      readLog' = readLog, evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action qualifyAndApprovePair(p: str): bool = {
    val pr = prospects.get(p)
    all {
      PROSPECTS.contains(p),
      pr.stage == "qualifying",
      pr.cachedPiiPresent,
      isAdult(pr.statedAge),
      not(pr.optedOut),
      not(pr.banned),
      not(pr.held),
      not(pr.suppressed),
      not(memberHeld),
      prospects' = prospects.set(p, { ...pr, stage: "member_yes" }),
      nowDays' = nowDays, personas' = personas, memberAge' = memberAge,
      eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
      memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
      memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
      memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
      briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow,
      outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
      evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action recordOffAppSmsConsentAndBook(p: str): bool = {
    val pr = prospects.get(p)
    val persona = pr.personaLock
    val per = personas.get(persona)
    val ev: OutreachEv = {
      prospect: p,
      persona: persona,
      statedAge: pr.statedAge,
      reviewApprover: briefReviewApprover,
      humanReviewApproved: true,
      personaDisclosed: true,
      containsUrlOrBrandSpam: false,
      leakPassed: true,
      clefPassed: true,
      isSmsHandoff: true,
      hasLoggedOffAppConsent: true,
      optedOutAtSend: pr.optedOut,
      bannedAtSend: pr.banned,
      declinedAtSend: pr.declined,
      suppressedAtSend: pr.suppressed,
      memberHeldAtSend: memberHeld,
      prospectHeldAtSend: pr.held,
      personaStatusAtSend: per.status,
      dailyCountBefore: per.dailyOutboundCount,
      isEvasionBurner: false,
      cacheAgeDays: pr.cacheAgeDays,
      maxTtlDays: maxTtlFor("sms_logistics_optin"),
    }
    all {
      PROSPECTS.contains(p),
      pr.stage == "member_yes",
      persona != "",
      Set("judge", "staff").contains(briefReviewApprover),
      per.status == "active",
      per.dailyOutboundCount < DAILY_OUTBOUND_CAP,
      pr.cachedPiiPresent,
      pr.cacheAgeDays <= STANDARD_TTL_DAYS,
      isAdult(pr.statedAge),
      not(pr.optedOut),
      not(pr.banned),
      not(pr.declined),
      not(pr.suppressed),
      not(pr.held),
      not(memberHeld),
      personas' = personas.set(persona, { ...per, dailyOutboundCount: per.dailyOutboundCount + 1 }),
      prospects' = prospects.set(p, {
        ...pr,
        stage: "booked",
        consentState: "sms_logistics_optin",
        hasLoggedOffAppConsent: true,
        daysSinceLastContact: 0,
      }),
      outreachLog' = outreachLog.union(Set(ev)),
      nowDays' = nowDays, memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs,
      topScoreScaled' = topScoreScaled, memberOptedInRomance' = memberOptedInRomance,
      memberPaused' = memberPaused, memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk,
      memberHeld' = memberHeld, memberExternalScoutOptIn' = memberExternalScoutOptIn,
      sourcingTriggered' = sourcingTriggered, briefReviewApprover' = briefReviewApprover,
      briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow, reuseLog' = reuseLog, inviteLog' = inviteLog,
      readLog' = readLog, evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action memberDeclinesProspectFutureOptIn(p: str): bool = {
    val pr = prospects.get(p)
    all {
      PROSPECTS.contains(p),
      pr.stage == "qualifying" or pr.stage == "member_yes",
      pr.cachedPiiPresent,
      isAdult(pr.statedAge),
      not(pr.optedOut),
      not(pr.banned),
      not(pr.suppressed),
      not(pr.redFlagged),
      prospects' = prospects.set(p, {
        ...pr,
        stage: "closed",
        consentState: "intro_future_optin",
        daysSinceLastContact: 0,
      }),
      nowDays' = nowDays, personas' = personas, memberAge' = memberAge,
      eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
      memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
      memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
      memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
      briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow,
      outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
      evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action reconsiderProspect(p: str, persona: str): bool = {
    val pr = prospects.get(p)
    val per = personas.get(persona)
    val ev: ReuseEv = {
      prospect: p,
      persona: persona,
      statedAge: pr.statedAge,
      consentStateAtReuse: pr.consentState,
      cacheAgeDays: pr.cacheAgeDays,
      daysSinceLastContact: pr.daysSinceLastContact,
      recontactCountBefore: pr.recontactCount,
      personaMatchesLock: pr.personaLock == persona,
      reviewApprover: briefReviewApprover,
      humanReviewApproved: true,
      personaStatusAtSend: per.status,
      dailyCountBefore: per.dailyOutboundCount,
      memberHeld: memberHeld,
      prospectHeld: pr.held,
      prospectBanned: pr.banned,
      isEvasionBurner: false,
    }
    all {
      PROSPECTS.contains(p),
      PERSONAS.contains(persona),
      Set("judge", "staff").contains(briefReviewApprover),
      pr.stage == "closed",
      pr.consentState == "intro_future_optin",
      pr.cachedPiiPresent,
      pr.cacheAgeDays <= OPTIN_TTL_DAYS,
      pr.daysSinceLastContact >= RECONTACT_COOLDOWN_DAYS,
      pr.recontactCount < MAX_RECONTACTS,
      isAdult(pr.statedAge),
      not(pr.optedOut),
      not(pr.banned),
      not(pr.redFlagged),
      not(pr.suppressed),
      not(pr.held),
      not(memberHeld),
      pr.personaLock == persona,
      per.status == "active",
      not(per.banSignalSeen),
      per.dailyOutboundCount < DAILY_OUTBOUND_CAP,
      personas' = personas.set(persona, { ...per, dailyOutboundCount: per.dailyOutboundCount + 1 }),
      prospects' = prospects.set(p, {
        ...pr,
        stage: "qualifying",
        daysSinceLastContact: 0,
        recontactCount: pr.recontactCount + 1,
      }),
      reuseLog' = reuseLog.union(Set(ev)),
      nowDays' = nowDays, memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs,
      topScoreScaled' = topScoreScaled, memberOptedInRomance' = memberOptedInRomance,
      memberPaused' = memberPaused, memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk,
      memberHeld' = memberHeld, memberExternalScoutOptIn' = memberExternalScoutOptIn,
      sourcingTriggered' = sourcingTriggered, briefReviewApprover' = briefReviewApprover,
      briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow, outreachLog' = outreachLog, inviteLog' = inviteLog,
      readLog' = readLog, evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action completeDateAndRecordFeedback(
    p: str,
    memberAttended: bool,
    prospectAttended: bool,
    positiveOrVouched: bool,
    safetyFlag: bool,
    catfishMismatch: bool
  ): bool = {
    val pr = prospects.get(p)
    val mustPurgeRedFlag = safetyFlag or catfishMismatch
    all {
      PROSPECTS.contains(p),
      pr.stage == "booked",
      pr.hasLoggedOffAppConsent,
      prospects' = prospects.set(p, {
        ...pr,
        stage: "completed",
        memberAttended: memberAttended,
        prospectAttended: prospectAttended,
        positiveOrVouched: positiveOrVouched,
        safetyFlag: safetyFlag,
        catfishMismatch: catfishMismatch,
        redFlagged: pr.redFlagged or mustPurgeRedFlag,
        cachedPiiPresent: if (mustPurgeRedFlag) false else pr.cachedPiiPresent,
        suppressed: pr.suppressed or mustPurgeRedFlag,
        consentState: if (mustPurgeRedFlag) "red_flagged" else pr.consentState,
      }),
      purgeCount' = if (mustPurgeRedFlag) purgeCount + 1 else purgeCount,
      nowDays' = nowDays, personas' = personas, memberAge' = memberAge,
      eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
      memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
      memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
      memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
      briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow,
      outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
      evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved,
    }
  }

  action sendNetworkInviteToProspect(p: str): bool = {
    val pr = prospects.get(p)
    val ev: InviteEv = {
      prospect: p,
      meetupCompleted: pr.stage == "completed",
      memberAttended: pr.memberAttended,
      prospectAttended: pr.prospectAttended,
      safetyFlag: pr.safetyFlag,
      catfishMismatch: pr.catfishMismatch,
      positiveOrVouched: pr.positiveOrVouched,
      statedAge: pr.statedAge,
      optedOut: pr.optedOut,
      banned: pr.banned,
      suppressed: pr.suppressed,
      alreadyMember: pr.alreadyMember,
      inviteAttemptsBefore: pr.inviteAttempts,
      safeFollowupWindow: safeFollowupWindow,
    }
    all {
      PROSPECTS.contains(p),
      pr.stage == "completed",
      pr.memberAttended,
      pr.prospectAttended,
      not(pr.safetyFlag),
      not(pr.catfishMismatch),
      pr.positiveOrVouched,
      isAdult(pr.statedAge),
      not(pr.optedOut),
      not(pr.banned),
      not(pr.suppressed),
      not(pr.alreadyMember),
      pr.inviteAttempts == 0,
      safeFollowupWindow,
      prospects' = prospects.set(p, { ...pr, inviteAttempts: pr.inviteAttempts + 1 }),
      inviteLog' = inviteLog.union(Set(ev)),
      nowDays' = nowDays, personas' = personas, memberAge' = memberAge,
      eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
      memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
      memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
      memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
      briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow,
      outreachLog' = outreachLog, reuseLog' = reuseLog, readLog' = readLog,
      evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action purgeProspectWithSuppression(p: str, reason: str): bool = {
    val pr = prospects.get(p)
    all {
      PROSPECTS.contains(p),
      Set("stopped", "declined", "blocked", "deletion_requested", "underage", "red_flagged").contains(reason),
      not(pr.suppressed) or pr.cachedPiiPresent,
      prospects' = prospects.set(p, {
        ...pr,
        stage: "closed",
        consentState: reason,
        cachedPiiPresent: false,
        suppressed: true,
        optedOut: pr.optedOut or reason == "stopped",
        declined: pr.declined or reason == "declined",
        banned: pr.banned or reason == "blocked" or reason == "underage" or reason == "red_flagged",
        redFlagged: pr.redFlagged or reason == "red_flagged",
        statedAge: if (reason == "underage") 16 else pr.statedAge,
      }),
      purgeCount' = purgeCount + 1,
      nowDays' = nowDays, personas' = personas, memberAge' = memberAge,
      eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
      memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
      memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
      memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
      briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow,
      outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
      evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved,
    }
  }

  action reportPersonaBanSignal(persona: str): bool = {
    val per = personas.get(persona)
    val hadBooked = PROSPECTS.exists(p =>
      prospects.get(p).personaLock == persona and prospects.get(p).stage == "booked" and prospects.get(p).hasLoggedOffAppConsent
    )
    val nextProspects = PROSPECTS.mapBy(p => {
      val pr = prospects.get(p)
      if (pr.personaLock == persona and (pr.stage == "qualifying" or pr.stage == "member_yes"))
        { ...pr, stage: "closed" }
      else pr
    })
    all {
      PERSONAS.contains(persona),
      per.status == "active",
      personas' = personas.set(persona, { ...per, status: "suspended", banSignalSeen: true }),
      prospects' = nextProspects,
      failoverBookedPreserved' = (failoverBookedPreserved or hadBooked),
      nowDays' = nowDays, memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs,
      topScoreScaled' = topScoreScaled, memberOptedInRomance' = memberOptedInRomance,
      memberPaused' = memberPaused, memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk,
      memberHeld' = memberHeld, memberExternalScoutOptIn' = memberExternalScoutOptIn,
      sourcingTriggered' = sourcingTriggered, briefReviewApprover' = briefReviewApprover,
      briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow, outreachLog' = outreachLog, reuseLog' = reuseLog,
      inviteLog' = inviteLog, readLog' = readLog, evasionBlockedCount' = evasionBlockedCount,
      peonBlockedReads' = peonBlockedReads, purgeCount' = purgeCount,
    }
  }

  action attemptEvasionBurner(persona: str): bool = all {
    PERSONAS.contains(persona),
    personas.get(persona).status == "suspended",
    evasionBlockedCount' = evasionBlockedCount + 1,
    nowDays' = nowDays, personas' = personas, prospects' = prospects,
    memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
    memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
    memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
    memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
    briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
    safeFollowupWindow' = safeFollowupWindow,
    outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
    peonBlockedReads' = peonBlockedReads, failoverBookedPreserved' = failoverBookedPreserved,
    purgeCount' = purgeCount,
  }

  action attemptAppReadExternalProspect(app: str, p: str): bool = all {
    APPS.contains(app),
    PROSPECTS.contains(p),
    if (app == "slop") all {
      readLog' = readLog.union(Set({ app: app, prospect: p })),
      peonBlockedReads' = peonBlockedReads,
    } else all {
      readLog' = readLog,
      peonBlockedReads' = if (app == "peon") peonBlockedReads + 1 else peonBlockedReads,
    },
    nowDays' = nowDays, personas' = personas, prospects' = prospects,
    memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
    memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
    memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
    memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
    briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
    safeFollowupWindow' = safeFollowupWindow,
    outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog,
    evasionBlockedCount' = evasionBlockedCount, failoverBookedPreserved' = failoverBookedPreserved,
    purgeCount' = purgeCount,
  }

  action advanceDays(dt: int): bool = {
    val nextProspects = PROSPECTS.mapBy(p => {
      val pr = prospects.get(p)
      val nextAge = if (pr.cachedPiiPresent) pr.cacheAgeDays + dt else pr.cacheAgeDays
      val nextSince = pr.daysSinceLastContact + dt
      val expiredNow = pr.cachedPiiPresent and nextAge > maxTtlFor(pr.consentState)
      if (expiredNow) {
        ...pr,
        stage: if (pr.stage == "booked" or pr.stage == "completed") pr.stage else "closed",
        consentState: "expired",
        cachedPiiPresent: false,
        suppressed: true,
        cacheAgeDays: nextAge,
        daysSinceLastContact: nextSince,
      } else {
        ...pr,
        cacheAgeDays: nextAge,
        daysSinceLastContact: nextSince,
      }
    })
    val nextPersonas = PERSONAS.mapBy(per => {
      ...personas.get(per),
      dailyOutboundCount: 0,
    })
    all {
      dt > 0,
      nowDays < 120,
      nowDays' = nowDays + dt,
      prospects' = nextProspects,
      personas' = nextPersonas,
      memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
      memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
      memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk, memberHeld' = memberHeld,
      memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
      briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
      safeFollowupWindow' = safeFollowupWindow,
      outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
      evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
      failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
    }
  }

  action holdMember: bool = all {
    not(memberHeld),
    memberHeld' = true,
    nowDays' = nowDays, personas' = personas, prospects' = prospects,
    memberAge' = memberAge, eligibleLocalPairs' = eligibleLocalPairs, topScoreScaled' = topScoreScaled,
    memberOptedInRomance' = memberOptedInRomance, memberPaused' = memberPaused,
    memberOptedOut' = memberOptedOut, memberTrustOk' = memberTrustOk,
    memberExternalScoutOptIn' = memberExternalScoutOptIn, sourcingTriggered' = sourcingTriggered,
    briefReviewApprover' = briefReviewApprover, briefReviewApproved' = briefReviewApproved,
    safeFollowupWindow' = safeFollowupWindow,
    outreachLog' = outreachLog, reuseLog' = reuseLog, inviteLog' = inviteLog, readLog' = readLog,
    evasionBlockedCount' = evasionBlockedCount, peonBlockedReads' = peonBlockedReads,
    failoverBookedPreserved' = failoverBookedPreserved, purgeCount' = purgeCount,
  }

  action step = any {
    triggerExternalSourcing,
    nondet ap = Set("judge", "staff").oneOf()
    approveSourcingBrief(ap),
    nondet p = PROSPECTS.oneOf()
    nondet per = PERSONAS.oneOf()
    contactExternalProspect(p, per, true, true, false, true, true),
    nondet p = PROSPECTS.oneOf()
    qualifyAndApprovePair(p),
    nondet p = PROSPECTS.oneOf()
    recordOffAppSmsConsentAndBook(p),
    nondet p = PROSPECTS.oneOf()
    memberDeclinesProspectFutureOptIn(p),
    nondet p = PROSPECTS.oneOf()
    nondet per = PERSONAS.oneOf()
    reconsiderProspect(p, per),
    nondet p = PROSPECTS.oneOf()
    nondet outcome = Set("positive", "no_show", "safety_flag").oneOf()
    completeDateAndRecordFeedback(
      p,
      true,
      outcome != "no_show",
      outcome == "positive",
      outcome == "safety_flag",
      false
    ),
    nondet p = PROSPECTS.oneOf()
    sendNetworkInviteToProspect(p),
    nondet app = APPS.oneOf()
    nondet p = PROSPECTS.oneOf()
    attemptAppReadExternalProspect(app, p),
    nondet dt = Set(15, 30, 35).oneOf()
    advanceDays(dt),
    any {
      nondet p = PROSPECTS.oneOf()
      nondet rsn = Set("stopped", "declined", "blocked", "deletion_requested", "underage", "red_flagged").oneOf()
      purgeProspectWithSuppression(p, rsn),
      nondet per = PERSONAS.oneOf()
      reportPersonaBanSignal(per),
      nondet per = PERSONAS.oneOf()
      attemptEvasionBurner(per),
      holdMember,
      nondet p = PROSPECTS.oneOf()
      nondet per = PERSONAS.oneOf()
      nondet rev = Set(true, false).oneOf()
      nondet disc = Set(true, false).oneOf()
      nondet spam = Set(false, true).oneOf()
      nondet leak = Set(true, false).oneOf()
      nondet clef = Set(true, false).oneOf()
      contactExternalProspect(p, per, rev, disc, spam, leak, clef),
    },
  }

  // ------------------------------------------------------------------------------------------ invariants
  val externalProspectAdultOnly =
    PROSPECTS.forall(p => {
      val pr = prospects.get(p)
      (pr.cachedPiiPresent or pr.stage == "booked" or pr.stage == "completed") implies isAdult(pr.statedAge)
    }) and
    outreachLog.forall(e => isAdult(e.statedAge)) and
    reuseLog.forall(e => isAdult(e.statedAge)) and
    inviteLog.forall(e => isAdult(e.statedAge))

  val singlePersonaPerProspect =
    PROSPECTS.forall(p => {
      val lock = prospects.get(p).personaLock
      outreachLog.filter(e => e.prospect == p).forall(e => e.persona == lock) and
      reuseLog.filter(e => e.prospect == p).forall(e => e.persona == lock)
    })

  val humanReviewRequiredBeforeExternalOutreach =
    outreachLog.forall(e => e.humanReviewApproved and Set("judge", "staff").contains(e.reviewApprover)) and
    reuseLog.forall(e => e.humanReviewApproved and Set("judge", "staff").contains(e.reviewApprover))

  val personaDisclosureAndNoLinksEnforced =
    outreachLog.forall(e =>
      e.personaDisclosed and not(e.containsUrlOrBrandSpam) and e.leakPassed and e.clefPassed
    )

  val externalOutreachRequiresConsentAndNotSuppressed =
    outreachLog.forall(e => and {
      not(e.optedOutAtSend),
      not(e.bannedAtSend),
      not(e.declinedAtSend),
      not(e.suppressedAtSend),
      e.isSmsHandoff implies e.hasLoggedOffAppConsent,
    })

  val prospectCacheBoundedAndPurgedOnOptOut =
    PROSPECTS.forall(p => {
      val pr = prospects.get(p)
      (pr.cachedPiiPresent implies (pr.cacheAgeDays <= maxTtlFor(pr.consentState) and not(isPurgeReasonState(pr)))) and
      ((pr.consentState == "stopped" or pr.consentState == "declined" or pr.consentState == "blocked" or
        pr.consentState == "deletion_requested" or pr.consentState == "underage" or
        pr.consentState == "red_flagged" or pr.consentState == "expired")
        implies (not(pr.cachedPiiPresent) and pr.suppressed))
    })

  val noColdReuseWithoutExplicitOptIn =
    reuseLog.forall(e => and {
      e.consentStateAtReuse == "intro_future_optin",
      e.daysSinceLastContact >= RECONTACT_COOLDOWN_DAYS,
      e.recontactCountBefore < MAX_RECONTACTS,
      e.cacheAgeDays <= OPTIN_TTL_DAYS,
      e.personaMatchesLock,
    })

  val personaKillSwitchHaltsOnBanSignal =
    PERSONAS.forall(per => personas.get(per).banSignalSeen implies personas.get(per).status == "suspended") and
    outreachLog.forall(e => e.personaStatusAtSend == "active" and e.dailyCountBefore < DAILY_OUTBOUND_CAP) and
    reuseLog.forall(e => e.personaStatusAtSend == "active" and e.dailyCountBefore < DAILY_OUTBOUND_CAP)

  val noEvasionAfterPersonaSuspend =
    outreachLog.forall(e => not(e.isEvasionBurner) and e.personaStatusAtSend == "active") and
    reuseLog.forall(e => not(e.isEvasionBurner) and e.personaStatusAtSend == "active")

  val bannedOrHeldNeverExternallyMatched =
    outreachLog.forall(e => not(e.memberHeldAtSend) and not(e.prospectHeldAtSend) and not(e.bannedAtSend)) and
    reuseLog.forall(e => not(e.memberHeld) and not(e.prospectHeld) and not(e.prospectBanned))

  val networkInviteRequiresPositiveMeetupFeedback =
    inviteLog.forall(e => and {
      e.meetupCompleted,
      e.memberAttended,
      e.prospectAttended,
      not(e.safetyFlag),
      not(e.catfishMismatch),
      e.positiveOrVouched,
      isAdult(e.statedAge),
      not(e.optedOut),
      not(e.banned),
      not(e.suppressed),
      not(e.alreadyMember),
      e.inviteAttemptsBefore == 0,
      e.safeFollowupWindow,
    }) and
    PROSPECTS.forall(p => prospects.get(p).inviteAttempts <= 1)

  val crossAppScoreFirewall =
    readLog.forall(e => e.app == "slop")

  val safety = and {
    externalProspectAdultOnly,
    singlePersonaPerProspect,
    humanReviewRequiredBeforeExternalOutreach,
    personaDisclosureAndNoLinksEnforced,
    externalOutreachRequiresConsentAndNotSuppressed,
    prospectCacheBoundedAndPurgedOnOptOut,
    noColdReuseWithoutExplicitOptIn,
    personaKillSwitchHaltsOnBanSignal,
    noEvasionAfterPersonaSuspend,
    bannedOrHeldNeverExternallyMatched,
    networkInviteRequiresPositiveMeetupFeedback,
    crossAppScoreFirewall,
  }

  // ------------------------------------------------------------------------------------------ witnesses
  val witness_happyExternalDateAndInvite = not(inviteLog.size() > 0)

  val witness_optInReuseAfterCooldown = not(reuseLog.size() > 0)

  val witness_killSwitchAndEvasionBlocked = not(
    PERSONAS.exists(per => personas.get(per).status == "suspended") and evasionBlockedCount > 0
  )

  val witness_immediatePurgeWithSuppression = not(
    purgeCount > 0 and PROSPECTS.exists(p => prospects.get(p).suppressed and not(prospects.get(p).cachedPiiPresent))
  )

  val witness_peonFirewallBlocked = not(peonBlockedReads > 0)

  // ------------------------------------------------------------------------------------------ run tests
  run happyExternalMatchmakerAndInviteTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p1", "female", true, true, false, true, true))
      .then(qualifyAndApprovePair("p1"))
      .then(recordOffAppSmsConsentAndBook("p1"))
      .then(completeDateAndRecordFeedback("p1", true, true, true, false, false))
      .then(sendNetworkInviteToProspect("p1"))
      .expect(prospects.get("p1").inviteAttempts == 1 and networkInviteRequiresPositiveMeetupFeedback and safety)
      .then(sendNetworkInviteToProspect("p1"))
      .fail()

  run singlePersonaConsistencyLockTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("staff"))
      .then(contactExternalProspect("p1", "female", true, true, false, true, true))
      .then(memberDeclinesProspectFutureOptIn("p1"))
      .then(advanceDays(30))
      .then(reconsiderProspect("p1", "male"))
      .fail()

  run compliantOptInReuseAfter30DaysTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p2", "male", true, true, false, true, true))
      .then(memberDeclinesProspectFutureOptIn("p2"))
      .then(advanceDays(30))
      .then(reconsiderProspect("p2", "male"))
      .expect(reuseLog.size() == 1 and noColdReuseWithoutExplicitOptIn and safety)

  run prematureReuseBefore30DaysRefusedTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p2", "male", true, true, false, true, true))
      .then(memberDeclinesProspectFutureOptIn("p2"))
      .then(advanceDays(15))
      .then(reconsiderProspect("p2", "male"))
      .fail()

  run underageProspectRefusedTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p3", "male", true, true, false, true, true))
      .fail()

  run unreviewedOrSpamOutreachRefusedTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p1", "female", false, true, false, true, true))
      .fail()

  run urlSpamOutreachRefusedTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p1", "female", true, true, true, true, true))
      .fail()

  run killSwitchPreservesBookedAndBlocksEvasionTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p1", "female", true, true, false, true, true))
      .then(qualifyAndApprovePair("p1"))
      .then(recordOffAppSmsConsentAndBook("p1"))
      .then(reportPersonaBanSignal("female"))
      .expect(
        personas.get("female").status == "suspended" and
        failoverBookedPreserved and
        prospects.get("p1").stage == "booked" and
        personaKillSwitchHaltsOnBanSignal and
        safety
      )
      .then(attemptEvasionBurner("female"))
      .expect(evasionBlockedCount == 1 and noEvasionAfterPersonaSuspend and safety)
      .then(completeDateAndRecordFeedback("p1", true, true, true, false, false))
      .then(sendNetworkInviteToProspect("p1"))
      .expect(prospects.get("p1").inviteAttempts == 1 and safety)

  run optOutImmediatePurgeAndSuppressionTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p1", "female", true, true, false, true, true))
      .then(purgeProspectWithSuppression("p1", "stopped"))
      .expect(
        not(prospects.get("p1").cachedPiiPresent) and
        prospects.get("p1").suppressed and
        prospectCacheBoundedAndPurgedOnOptOut and
        safety
      )
      .then(reconsiderProspect("p1", "female"))
      .fail()

  run safetyFlagBlocksInviteAndPurgesTest =
    init
      .then(triggerExternalSourcing)
      .then(approveSourcingBrief("judge"))
      .then(contactExternalProspect("p1", "female", true, true, false, true, true))
      .then(qualifyAndApprovePair("p1"))
      .then(recordOffAppSmsConsentAndBook("p1"))
      .then(completeDateAndRecordFeedback("p1", true, true, false, true, false))
      .expect(not(prospects.get("p1").cachedPiiPresent) and prospects.get("p1").suppressed and safety)
      .then(sendNetworkInviteToProspect("p1"))
      .fail()

  run peonCrossAppFirewallTest =
    init
      .then(attemptAppReadExternalProspect("peon", "p1"))
      .then(attemptAppReadExternalProspect("slop", "p1"))
      .expect(peonBlockedReads == 1 and readLog.size() == 1 and crossAppScoreFirewall and safety)
}
```
