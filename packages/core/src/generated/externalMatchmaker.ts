// GENERATED from spec/externalMatchmaker.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export interface RouteMatchmakerPersonaInput { appCode: number; memberGender: number; targetProspectGender: number; existingLockPersona: number; tieBreakBit: number }
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Trigger external sourcing only for eligible adults with sparse local supply (spec/externalMatchmaker.md) */
export interface ExternalSourcingTriggerInput { eligibleLocalPairs: number; topScoreScaled: number; strongThresholdScaled: number; memberAge: number; memberOptedInRomance: boolean; memberPaused: boolean; memberOptedOut: boolean; memberTrustOk: boolean; memberStageReady: boolean; memberExternalScoutOptIn: boolean; activeSourcingTickets: number }
/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Gate every external contact on adult age, recorded review, transparency, consent, kill-switch health, and TTL (spec/externalMatchmaker.md) */
export interface ContactExternalProspectInput { statedAge: number; reviewApproved: boolean; personaDisclosed: boolean; containsUrlOrBrandSpam: boolean; passedLeakAndClefGuard: boolean; optedOut: boolean; declined: boolean; suppressed: boolean; isSmsHandoff: boolean; hasLoggedOffAppConsent: boolean; personaStatus: number; dailyOutboundCount: number; dailyOutboundCap: number; evasionAttempt: boolean; memberHeld: boolean; prospectHeld: boolean; memberBanned: boolean; prospectBanned: boolean; personaMatchesLock: boolean; consentState: number; cacheAgeDays: number }
/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Reconsider a cached prospect only with explicit future opt-in, 30-day cooldown, and review approval (spec/externalMatchmaker.md) */
export interface ReconsiderExternalProspectInput { consentState: number; cacheAgeDays: number; daysSinceLastContact: number; recontactCount: number; statedAge: number; optedOut: boolean; banned: boolean; redFlagged: boolean; personaMatchesLock: boolean; reviewApproved: boolean }
/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Purge prospect data immediately on opt-out, decline, underage, red flag, or TTL expiry (spec/externalMatchmaker.md) */
export interface ProspectRetentionInput { stopped: boolean; declined: boolean; blocked: boolean; deletionRequested: boolean; underageDetected: boolean; redFlagged: boolean; expired: boolean; cacheAgeDays: number; maxTtlDays: number }
/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Invite an external prospect to the Network only after a positive attended meetup (spec/externalMatchmaker.md) */
export interface InviteExternalProspectInput { meetupCompleted: boolean; memberAttended: boolean; prospectAttended: boolean; safetyOrRedFlag: boolean; catfishOrAgeMismatch: boolean; memberQualityPositive: boolean; memberVouchedForOthers: boolean; statedAge: number; optedOut: boolean; banned: boolean; alreadyMember: boolean; inviteAttempts: number; safeFollowupWindow: boolean }

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const matchmakerPersonaFemale: number = 0;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const matchmakerPersonaMale: number = 1;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const matchmakerAppNtwrk: number = 0;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const matchmakerAppSlop: number = 1;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const matchmakerAppPeon: number = 2;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const matchmakerAppFriends: number = 3;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const genderWoman: number = 0;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const genderMan: number = 1;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const genderNonbinary: number = 2;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const genderUnknown: number = -1;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const personaStatusActive: number = 0;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const personaStatusDegraded: number = 1;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const personaStatusSuspended: number = 2;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentNone: number = 0;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentSingleOnly: number = 1;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentFutureOptin: number = 2;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentSmsLogistics: number = 3;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentDeclined: number = 4;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentStopped: number = 5;
/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
export const prospectConsentBanned: number = 6;

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
//@ pure
export function routeMatchmakerPersona(req: RouteMatchmakerPersonaInput): number {
  return req.existingLockPersona === matchmakerPersonaFemale ? matchmakerPersonaFemale : (req.existingLockPersona >= matchmakerPersonaMale ? matchmakerPersonaMale : (req.appCode === matchmakerAppSlop ? (req.targetProspectGender === genderMan ? (req.memberGender === genderMan ? matchmakerPersonaMale : matchmakerPersonaFemale) : (req.targetProspectGender === genderWoman ? (req.memberGender === genderWoman ? matchmakerPersonaFemale : matchmakerPersonaMale) : (req.memberGender === genderWoman ? matchmakerPersonaFemale : (req.memberGender === genderMan ? matchmakerPersonaMale : (req.tieBreakBit === 0 ? matchmakerPersonaFemale : matchmakerPersonaMale))))) : (req.tieBreakBit === 0 ? matchmakerPersonaFemale : matchmakerPersonaMale)));
}

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Route each prospect deterministically to one locked matchmaker persona (spec/externalMatchmaker.md) */
//@ pure
export function lawPersonaLockNeverSwitches(appCode: number, memberGender: number, targetProspectGender: number, existingLockPersona: number): boolean {
  //@ ensures \result === true
  const local_0 = routeMatchmakerPersona(({ appCode: appCode, memberGender: memberGender, targetProspectGender: targetProspectGender, existingLockPersona: existingLockPersona, tieBreakBit: 0 } as RouteMatchmakerPersonaInput));
  return (local_0 === matchmakerPersonaFemale || local_0 === matchmakerPersonaMale) && (!(existingLockPersona === matchmakerPersonaFemale) || local_0 === matchmakerPersonaFemale) && (!(existingLockPersona === matchmakerPersonaMale) || local_0 === matchmakerPersonaMale);
}

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Trigger external sourcing only for eligible adults with sparse local supply (spec/externalMatchmaker.md) */
//@ pure
export function shouldTriggerExternalSourcing(req: ExternalSourcingTriggerInput): boolean {
  return (req.eligibleLocalPairs <= 0 || req.topScoreScaled < req.strongThresholdScaled) && req.memberAge >= 18 && req.memberAge <= 120 && req.memberOptedInRomance && !req.memberPaused && !req.memberOptedOut && req.memberTrustOk && req.memberStageReady && req.memberExternalScoutOptIn && req.activeSourcingTickets === 0;
}

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Trigger external sourcing only for eligible adults with sparse local supply (spec/externalMatchmaker.md) */
//@ pure
export function lawDenseLocalSupplySkipsExternalSourcing(eligibleLocalPairs: number, topScoreScaled: number): boolean {
  //@ ensures \result === true
  const local_1 = shouldTriggerExternalSourcing(({ eligibleLocalPairs: eligibleLocalPairs, topScoreScaled: topScoreScaled, strongThresholdScaled: 500, memberAge: 28, memberOptedInRomance: true, memberPaused: false, memberOptedOut: false, memberTrustOk: true, memberStageReady: true, memberExternalScoutOptIn: true, activeSourcingTickets: 0 } as ExternalSourcingTriggerInput));
  return !(eligibleLocalPairs > 0 && topScoreScaled >= 500) || !local_1;
}

/** Story: Route personas consistently and trigger external sourcing only when local supply is sparse / Trigger external sourcing only for eligible adults with sparse local supply (spec/externalMatchmaker.md) */
//@ pure
export function lawMinorOrBusyMemberNeverTriggersSourcing(memberAge: number, activeSourcingTickets: number, memberExternalScoutOptIn: boolean): boolean {
  //@ ensures \result === true
  const local_2 = shouldTriggerExternalSourcing(({ eligibleLocalPairs: 0, topScoreScaled: 0, strongThresholdScaled: 500, memberAge: memberAge, memberOptedInRomance: true, memberPaused: false, memberOptedOut: false, memberTrustOk: true, memberStageReady: true, memberExternalScoutOptIn: memberExternalScoutOptIn, activeSourcingTickets: activeSourcingTickets } as ExternalSourcingTriggerInput));
  return !local_2 || (memberAge >= 18 && memberAge <= 120 && activeSourcingTickets === 0 && memberExternalScoutOptIn);
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Gate every external contact on adult age, recorded review, transparency, consent, kill-switch health, and TTL (spec/externalMatchmaker.md) */
//@ pure
export function canContactExternalProspect(req: ContactExternalProspectInput): boolean {
  const local_3 = req.consentState === prospectConsentFutureOptin ? 60 : 30;
  return req.statedAge >= 18 && req.statedAge <= 120 && req.reviewApproved && req.personaDisclosed && !req.containsUrlOrBrandSpam && req.passedLeakAndClefGuard && !req.optedOut && !req.declined && !req.suppressed && (!req.isSmsHandoff || req.hasLoggedOffAppConsent) && req.personaStatus === personaStatusActive && req.dailyOutboundCap > 0 && req.dailyOutboundCount >= 0 && req.dailyOutboundCount < req.dailyOutboundCap && !req.evasionAttempt && !req.memberHeld && !req.prospectHeld && !req.memberBanned && !req.prospectBanned && req.personaMatchesLock && req.consentState >= prospectConsentNone && req.consentState <= prospectConsentSmsLogistics && req.cacheAgeDays >= 0 && req.cacheAgeDays <= local_3;
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Gate every external contact on adult age, recorded review, transparency, consent, kill-switch health, and TTL (spec/externalMatchmaker.md) */
//@ pure
export function lawMinorOrUnreviewedNeverExternallyContacted(statedAge: number, reviewApproved: boolean, personaDisclosed: boolean): boolean {
  //@ ensures \result === true
  const local_4 = canContactExternalProspect(({ statedAge: statedAge, reviewApproved: reviewApproved, personaDisclosed: personaDisclosed, containsUrlOrBrandSpam: false, passedLeakAndClefGuard: true, optedOut: false, declined: false, suppressed: false, isSmsHandoff: false, hasLoggedOffAppConsent: false, personaStatus: personaStatusActive, dailyOutboundCount: 0, dailyOutboundCap: 10, evasionAttempt: false, memberHeld: false, prospectHeld: false, memberBanned: false, prospectBanned: false, personaMatchesLock: true, consentState: prospectConsentSingleOnly, cacheAgeDays: 5 } as ContactExternalProspectInput));
  return !local_4 || (statedAge >= 18 && statedAge <= 120 && reviewApproved && personaDisclosed);
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Gate every external contact on adult age, recorded review, transparency, consent, kill-switch health, and TTL (spec/externalMatchmaker.md) */
//@ pure
export function lawSuspendedOrSpamOrColdSmsNeverContacted(personaStatus: number, containsUrlOrBrandSpam: boolean, isSmsHandoff: boolean, hasLoggedOffAppConsent: boolean): boolean {
  //@ ensures \result === true
  const local_5 = canContactExternalProspect(({ statedAge: 29, reviewApproved: true, personaDisclosed: true, containsUrlOrBrandSpam: containsUrlOrBrandSpam, passedLeakAndClefGuard: true, optedOut: false, declined: false, suppressed: false, isSmsHandoff: isSmsHandoff, hasLoggedOffAppConsent: hasLoggedOffAppConsent, personaStatus: personaStatus, dailyOutboundCount: 0, dailyOutboundCap: 10, evasionAttempt: false, memberHeld: false, prospectHeld: false, memberBanned: false, prospectBanned: false, personaMatchesLock: true, consentState: prospectConsentSingleOnly, cacheAgeDays: 5 } as ContactExternalProspectInput));
  return !local_5 || (personaStatus === personaStatusActive && !containsUrlOrBrandSpam && (!isSmsHandoff || hasLoggedOffAppConsent));
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Gate every external contact on adult age, recorded review, transparency, consent, kill-switch health, and TTL (spec/externalMatchmaker.md) */
//@ pure
export function lawContactEnforcesTtlAndNoEvasionOrBans(consentState: number, cacheAgeDays: number, evasionAttempt: boolean, prospectBanned: boolean): boolean {
  //@ ensures \result === true
  const local_6 = canContactExternalProspect(({ statedAge: 29, reviewApproved: true, personaDisclosed: true, containsUrlOrBrandSpam: false, passedLeakAndClefGuard: true, optedOut: false, declined: false, suppressed: false, isSmsHandoff: false, hasLoggedOffAppConsent: false, personaStatus: personaStatusActive, dailyOutboundCount: 0, dailyOutboundCap: 10, evasionAttempt: evasionAttempt, memberHeld: false, prospectHeld: false, memberBanned: false, prospectBanned: prospectBanned, personaMatchesLock: true, consentState: consentState, cacheAgeDays: cacheAgeDays } as ContactExternalProspectInput));
  return (!local_6 || (!evasionAttempt && !prospectBanned && consentState >= 0 && consentState <= 3)) && (!(local_6 && consentState === prospectConsentFutureOptin) || (cacheAgeDays >= 0 && cacheAgeDays <= 60)) && (!(local_6 && consentState !== prospectConsentFutureOptin) || (cacheAgeDays >= 0 && cacheAgeDays <= 30));
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Reconsider a cached prospect only with explicit future opt-in, 30-day cooldown, and review approval (spec/externalMatchmaker.md) */
//@ pure
export function canReconsiderExternalProspect(req: ReconsiderExternalProspectInput): boolean {
  return req.consentState === prospectConsentFutureOptin && req.cacheAgeDays >= 0 && req.cacheAgeDays <= 60 && req.daysSinceLastContact >= 30 && req.recontactCount >= 0 && req.recontactCount < 2 && req.statedAge >= 18 && req.statedAge <= 120 && !req.optedOut && !req.banned && !req.redFlagged && req.personaMatchesLock && req.reviewApproved;
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Reconsider a cached prospect only with explicit future opt-in, 30-day cooldown, and review approval (spec/externalMatchmaker.md) */
//@ pure
export function lawNoColdReuseWithoutFutureOptInAndCooldown(consentState: number, daysSinceLastContact: number, recontactCount: number): boolean {
  //@ ensures \result === true
  const local_7 = canReconsiderExternalProspect(({ consentState: consentState, cacheAgeDays: 40, daysSinceLastContact: daysSinceLastContact, recontactCount: recontactCount, statedAge: 29, optedOut: false, banned: false, redFlagged: false, personaMatchesLock: true, reviewApproved: true } as ReconsiderExternalProspectInput));
  return !local_7 || (consentState === prospectConsentFutureOptin && daysSinceLastContact >= 30 && recontactCount >= 0 && recontactCount < 2);
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Purge prospect data immediately on opt-out, decline, underage, red flag, or TTL expiry (spec/externalMatchmaker.md) */
//@ pure
export function prospectRetentionDecision(req: ProspectRetentionInput): string {
  return req.stopped || req.declined || req.blocked || req.deletionRequested || req.underageDetected || req.redFlagged || req.expired || req.cacheAgeDays < 0 || req.maxTtlDays <= 0 || req.maxTtlDays > 60 || req.cacheAgeDays > req.maxTtlDays ? "purge_with_suppression" : "keep";
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Purge prospect data immediately on opt-out, decline, underage, red flag, or TTL expiry (spec/externalMatchmaker.md) */
//@ pure
export function lawStopUnderageOrExpiredPurgesWithSuppression(stopped: boolean, underageDetected: boolean, cacheAgeDays: number, maxTtlDays: number): boolean {
  //@ ensures \result === true
  const local_8 = prospectRetentionDecision(({ stopped: stopped, declined: false, blocked: false, deletionRequested: false, underageDetected: underageDetected, redFlagged: false, expired: false, cacheAgeDays: cacheAgeDays, maxTtlDays: maxTtlDays } as ProspectRetentionInput));
  return (!(stopped || underageDetected || cacheAgeDays < 0 || maxTtlDays <= 0 || maxTtlDays > 60 || cacheAgeDays > maxTtlDays) || local_8 === "purge_with_suppression") && (!(local_8 === "keep") || (!stopped && !underageDetected && cacheAgeDays >= 0 && maxTtlDays > 0 && maxTtlDays <= 60 && cacheAgeDays <= maxTtlDays));
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Invite an external prospect to the Network only after a positive attended meetup (spec/externalMatchmaker.md) */
//@ pure
export function canInviteExternalProspectToNetwork(req: InviteExternalProspectInput): boolean {
  return req.meetupCompleted && req.memberAttended && req.prospectAttended && !req.safetyOrRedFlag && !req.catfishOrAgeMismatch && (req.memberQualityPositive || req.memberVouchedForOthers) && req.statedAge >= 18 && req.statedAge <= 120 && !req.optedOut && !req.banned && !req.alreadyMember && req.inviteAttempts === 0 && req.safeFollowupWindow;
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Invite an external prospect to the Network only after a positive attended meetup (spec/externalMatchmaker.md) */
//@ pure
export function lawNetworkInviteRequiresPositiveAttendedMeetup(meetupCompleted: boolean, prospectAttended: boolean, memberQualityPositive: boolean, memberVouchedForOthers: boolean): boolean {
  //@ ensures \result === true
  const local_9 = canInviteExternalProspectToNetwork(({ meetupCompleted: meetupCompleted, memberAttended: true, prospectAttended: prospectAttended, safetyOrRedFlag: false, catfishOrAgeMismatch: false, memberQualityPositive: memberQualityPositive, memberVouchedForOthers: memberVouchedForOthers, statedAge: 29, optedOut: false, banned: false, alreadyMember: false, inviteAttempts: 0, safeFollowupWindow: true } as InviteExternalProspectInput));
  return !local_9 || (meetupCompleted && prospectAttended && (memberQualityPositive || memberVouchedForOthers));
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Invite an external prospect to the Network only after a positive attended meetup (spec/externalMatchmaker.md) */
//@ pure
export function lawNetworkInviteBlocksFlagsMinorsAndDuplicates(safetyOrRedFlag: boolean, statedAge: number, inviteAttempts: number): boolean {
  //@ ensures \result === true
  const local_10 = canInviteExternalProspectToNetwork(({ meetupCompleted: true, memberAttended: true, prospectAttended: true, safetyOrRedFlag: safetyOrRedFlag, catfishOrAgeMismatch: false, memberQualityPositive: true, memberVouchedForOthers: false, statedAge: statedAge, optedOut: false, banned: false, alreadyMember: false, inviteAttempts: inviteAttempts, safeFollowupWindow: true } as InviteExternalProspectInput));
  return !local_10 || (!safetyOrRedFlag && statedAge >= 18 && statedAge <= 120 && inviteAttempts === 0);
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Isolate external dating prospects strictly inside `slop` and block `peon` (spec/externalMatchmaker.md) */
//@ pure
export function canReadExternalProspectInApp(appCode: number): boolean {
  return appCode === matchmakerAppSlop;
}

/** Story: Enforce outreach safety, privacy retention, quality-gated onboarding, and app isolation / Isolate external dating prospects strictly inside `slop` and block `peon` (spec/externalMatchmaker.md) */
//@ pure
export function lawPeonCannotReadExternalProspects(appCode: number): boolean {
  //@ ensures \result === true
  return !canReadExternalProspectInApp(matchmakerAppPeon) && canReadExternalProspectInApp(appCode) === (appCode === matchmakerAppSlop);
}
