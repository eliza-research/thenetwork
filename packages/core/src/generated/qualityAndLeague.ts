// GENERATED from spec/qualityAndLeague.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
export type QualityBand = "Q0Quarantine" | "Q1Probationary" | "Q2Standard" | "Q3HighSignal";
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export type ReliabilityTier = "RelOk" | "RelConfirmRequired" | "RelCoolOff" | "RelSuspended";
/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
export type VampireTier = "VampireClean" | "VampireWatch" | "VampireThrottled" | "VampireQuarantined";
/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
export type LeagueLane = "LeagueFriend" | "LeagueDate" | "LeagueHire" | "LeagueCofounder" | "LeagueMentor" | "LeagueInvest" | "LeagueIntro";
/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
export interface LeagueAxisProfile { economic: number; socialCapital: number; domainRung: number; aesthetic: number; discretion: number; extractionRisk: number; publicity: number; verifiedEvidence: boolean; trajectory: number; crossCapitalOpen: boolean; sharedGuild: boolean }

/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
export const qualityHighThreshold: number = 70;
/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
export const qualityStandardThreshold: number = 40;
/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
export const qualityProbationaryThreshold: number = 20;
/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
export const newcomerGraceDays: number = 14;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const firstNoShowStrikes: number = 2;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const repeatNoShowStrikes: number = 3;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const lateCancel4hStrikes: number = 2;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const lateCancel24hStrikes: number = 1;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const rescheduleChurnStrikes: number = 1;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const relConfirmThreshold: number = 3;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const relCoolOffThreshold: number = 5;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const relSuspendedThreshold: number = 8;
/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
export const relCleanAttendancesPerDecay: number = 2;
/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
export const vampireMinIntros: number = 3;
/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
export const vampireWatchPitches: number = 1;
/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
export const vampireThrottlePitches: number = 2;
/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
export const vampireQuarantinePitches: number = 4;
/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
export const vampireQuarantineReports: number = 2;

/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
//@ pure
export function clampRange(value: number, lo: number, hi: number): number {
  return value < lo ? lo : (value > hi ? hi : value);
}

/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
//@ pure
export function memberQualityScore(provenance: number, specificity: number, hygiene: number, completion: number): number {
  return exact_qualityAndLeague(exact_qualityAndLeague(exact_qualityAndLeague(clampRange(provenance, 0, 35) + clampRange(specificity, 0, 25)) + clampRange(hygiene, 0, 25)) + clampRange(completion, 0, 15));
}

/** Story: Curate member signal quality without penalizing terse high-status members / Signal quality depends on provenance, specificity, hygiene, and completion rather than word count (spec/qualityAndLeague.md) */
//@ pure
export function memberQualityBand(provenance: number, specificity: number, hygiene: number, completion: number, voipOrPumping: boolean, sybilFlagged: boolean, chronicLowEffort: boolean, unverifiedHype: boolean): QualityBand {
  const local_0 = clampRange(provenance, 0, 35);
  const local_1 = memberQualityScore(provenance, specificity, hygiene, completion);
  return sybilFlagged || (voipOrPumping && local_0 < 15) ? "Q0Quarantine" : (chronicLowEffort || unverifiedHype || local_1 < qualityProbationaryThreshold ? "Q1Probationary" : (local_1 >= qualityHighThreshold ? "Q3HighSignal" : (local_1 >= qualityStandardThreshold ? "Q2Standard" : "Q1Probationary")));
}

/** Story: Curate member signal quality without penalizing terse high-status members / Quarantined and probationary profiles do not receive reserved exposure-floor slots (spec/qualityAndLeague.md) */
//@ pure
export function exposureFloorEligible(band: QualityBand, lowExposure: boolean, newcomer: boolean, recentExposure30: number, hasClearSignal: boolean): boolean {
  return band !== "Q0Quarantine" && band !== "Q1Probationary" && lowExposure && (newcomer || (recentExposure30 === 0 && hasClearSignal));
}

/** Story: Curate member signal quality without penalizing terse high-status members / Quarantined and probationary profiles do not receive reserved exposure-floor slots (spec/qualityAndLeague.md) */
//@ pure
export function lawQuietHighStatusNotPenalized(provenance: number, specificity: number, hygiene: number, completion: number): boolean {
  //@ ensures \result === true
  return !(provenance >= 25 && provenance <= 35 && specificity >= 15 && specificity <= 25 && hygiene >= 20 && hygiene <= 25 && completion >= 10 && completion <= 15) || (memberQualityBand(provenance, specificity, hygiene, completion, false, false, false, false) === "Q3HighSignal" && exposureFloorEligible("Q3HighSignal", true, false, 0, true));
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function reliabilityStrikeDecay(cleanAttendancesSinceLastStrike: number): number {
  return cleanAttendancesSinceLastStrike <= 0 ? 0 : quotient_qualityAndLeague(cleanAttendancesSinceLastStrike, relCleanAttendancesPerDecay);
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function reliabilityEffectiveStrikes(rawStrikes: number, cleanAttendancesSinceLastStrike: number): number {
  const local_2 = reliabilityStrikeDecay(cleanAttendancesSinceLastStrike);
  return rawStrikes <= local_2 ? 0 : exact_qualityAndLeague(rawStrikes - local_2);
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function reliabilityTier(effectiveStrikes: number, provisionalNoShow: boolean): ReliabilityTier {
  return effectiveStrikes >= relSuspendedThreshold ? "RelSuspended" : (effectiveStrikes >= relCoolOffThreshold ? "RelCoolOff" : (effectiveStrikes >= relConfirmThreshold || (provisionalNoShow && effectiveStrikes >= 2) ? "RelConfirmRequired" : "RelOk"));
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function reliabilityDownrankPermille(tier: ReliabilityTier): number {
  return tier === "RelOk" ? 1000 : (tier === "RelConfirmRequired" ? 850 : 0);
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function confirmBeforeCommitRequired(tier: ReliabilityTier): boolean {
  return tier === "RelConfirmRequired";
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function lawFirstNoShowGrace(cleanAttendances: number): boolean {
  //@ ensures \result === true
  return !(cleanAttendances >= 0) || reliabilityTier(reliabilityEffectiveStrikes(firstNoShowStrikes, cleanAttendances), false) === "RelOk";
}

/** Story: Escalate repeat no-shows and late cancellations fairly across all apps / Weighted strikes preserve first-no-show grace and decay after two clean attendances (spec/qualityAndLeague.md) */
//@ pure
export function lawSingleAttendanceNeverClearsSerialFlaker(rawStrikes: number): boolean {
  //@ ensures \result === true
  const local_3: ReliabilityTier = reliabilityTier(reliabilityEffectiveStrikes(rawStrikes, 1), false);
  return !(rawStrikes >= relCoolOffThreshold) || (local_3 === "RelCoolOff" || local_3 === "RelSuspended");
}

/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
//@ pure
export function vampireTier(intros90d: number, posVotes90d: number, asymNegVotes90d: number, pitchSignals90d: number, distinctSelfPromoReports90d: number): VampireTier {
  return distinctSelfPromoReports90d >= vampireQuarantineReports || pitchSignals90d >= vampireQuarantinePitches || (intros90d >= 5 && posVotes90d <= 0 && asymNegVotes90d >= 3) ? "VampireQuarantined" : (distinctSelfPromoReports90d >= 1 || pitchSignals90d >= vampireThrottlePitches || (intros90d >= vampireMinIntros && asymNegVotes90d >= 2 && exact_qualityAndLeague(posVotes90d * 3) < intros90d) ? "VampireThrottled" : (pitchSignals90d >= vampireWatchPitches || (intros90d >= vampireMinIntros && asymNegVotes90d >= 1 && exact_qualityAndLeague(posVotes90d * 2) < intros90d) ? "VampireWatch" : "VampireClean"));
}

/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
//@ pure
export function vampireWeeklyCap(tier: VampireTier, baseCap: number): number {
  return baseCap <= 0 || tier === "VampireQuarantined" ? 0 : (tier === "VampireThrottled" ? 1 : (tier === "VampireWatch" ? (baseCap > 2 ? 2 : baseCap) : baseCap));
}

/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
//@ pure
export function vampireAllowedTarget(senderTier: VampireTier, targetIsHighStatus: boolean, targetIsNewcomer: boolean): boolean {
  return senderTier === "VampireClean" ? true : (senderTier === "VampireWatch" ? !targetIsHighStatus : (senderTier === "VampireThrottled" ? !targetIsHighStatus && !targetIsNewcomer : false));
}

/** Story: Throttle extractive network vampires and pitch-slappers without harming newcomers / Vampire tiers use rolling 90-day reciprocity, pitch signals, and distinct self-promotion reports (spec/qualityAndLeague.md) */
//@ pure
export function lawNewcomerNeverThrottledWithoutPitch(intros90d: number, posVotes90d: number, asymNegVotes90d: number): boolean {
  //@ ensures \result === true
  return !(intros90d < vampireMinIntros) || vampireTier(intros90d, posVotes90d, asymNegVotes90d, 0, 0) === "VampireClean";
}

/** Story: Guard retaliatory reports while isolating confirmed boundary violators / A reporter already on hold cannot unilaterally restrict matching on another member (spec/qualityAndLeague.md) */
//@ pure
export function reportRestrictsMatchingV2(urgent: boolean, met: boolean, reporterOnHold: boolean, distinctCleanReporters: number, severeOffense: boolean): boolean {
  return reporterOnHold ? distinctCleanReporters >= 2 : (urgent && (met || severeOffense)) || distinctCleanReporters >= 2;
}

/** Story: Guard retaliatory reports while isolating confirmed boundary violators / A reporter already on hold cannot unilaterally restrict matching on another member (spec/qualityAndLeague.md) */
//@ pure
export function lawHeldReporterCannotUnilaterallyHoldVictim(urgent: boolean, met: boolean, severeOffense: boolean): boolean {
  //@ ensures \result === true
  return !reportRestrictsMatchingV2(urgent, met, true, 0, severeOffense) && !reportRestrictsMatchingV2(urgent, met, true, 1, severeOffense);
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function absDiff(x: number, y: number): number {
  return x >= y ? exact_qualityAndLeague(x - y) : exact_qualityAndLeague(y - x);
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function effectiveLeagueProfile(lane: LeagueLane, a: LeagueAxisProfile): LeagueAxisProfile {
  return lane === "LeagueHire" ? ({ economic: 0, socialCapital: 0, domainRung: clampRange(a.domainRung, 0, 100), aesthetic: 0, discretion: 100, extractionRisk: 0, publicity: 0, verifiedEvidence: a.verifiedEvidence, trajectory: clampRange(a.trajectory, 0, 100), crossCapitalOpen: a.crossCapitalOpen, sharedGuild: false } as LeagueAxisProfile) : ({ economic: clampRange(a.economic, 0, 100), socialCapital: clampRange(a.socialCapital, 0, 100), domainRung: clampRange(a.domainRung, 0, 100), aesthetic: lane === "LeagueDate" ? clampRange(a.aesthetic, 0, 100) : 0, discretion: clampRange(a.discretion, 0, 100), extractionRisk: clampRange(a.extractionRisk, 0, 100), publicity: clampRange(a.publicity, 0, 100), verifiedEvidence: a.verifiedEvidence, trajectory: clampRange(a.trajectory, 0, 100), crossCapitalOpen: a.crossCapitalOpen, sharedGuild: a.sharedGuild } as LeagueAxisProfile);
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function discretionRespectsHighVisibility(a: LeagueAxisProfile, b: LeagueAxisProfile): boolean {
  return a.economic < 80 && a.publicity < 65 ? true : b.extractionRisk <= 25 && b.discretion >= (a.sharedGuild && b.sharedGuild ? 65 : 80);
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function bilateralValueCompensates(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile): boolean {
  const local_4: LeagueAxisProfile = effectiveLeagueProfile(lane, a);
  const local_5: LeagueAxisProfile = effectiveLeagueProfile(lane, b);
  const local_6 = absDiff(local_4.domainRung, local_5.domainRung);
  return lane === "LeagueHire" ? local_4.verifiedEvidence && local_5.verifiedEvidence && (local_4.trajectory >= 75 || local_5.trajectory >= 75) && local_6 <= 35 : (lane === "LeagueDate" ? false : (local_4.extractionRisk > 25 || local_5.extractionRisk > 25 ? false : (!discretionRespectsHighVisibility(local_4, local_5) || !discretionRespectsHighVisibility(local_5, local_4) ? false : (lane === "LeagueFriend" ? local_4.sharedGuild && local_5.sharedGuild && local_4.crossCapitalOpen && local_5.crossCapitalOpen : (lane === "LeagueMentor" ? local_6 >= 10 && local_6 <= 30 && local_4.crossCapitalOpen && local_5.crossCapitalOpen && ((local_4.domainRung < local_5.domainRung && local_4.verifiedEvidence && local_4.trajectory >= 65) || (local_5.domainRung < local_4.domainRung && local_5.verifiedEvidence && local_5.trajectory >= 65)) : (lane === "LeagueInvest" ? local_4.verifiedEvidence && local_5.verifiedEvidence && local_4.crossCapitalOpen && local_5.crossCapitalOpen && ((local_4.economic < local_5.economic && (local_4.domainRung >= 65 || local_4.trajectory >= 75)) || (local_5.economic < local_4.economic && (local_5.domainRung >= 65 || local_5.trajectory >= 75))) : local_4.verifiedEvidence && local_5.verifiedEvidence && local_4.crossCapitalOpen && local_5.crossCapitalOpen && ((local_4.domainRung >= 70 && (local_5.economic >= 70 || local_5.socialCapital >= 70)) || (local_5.domainRung >= 70 && (local_4.economic >= 70 || local_4.socialCapital >= 70)))))))));
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function leagueGapIsWide(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile): boolean {
  return lane === "LeagueDate" ? absDiff(a.aesthetic, b.aesthetic) > 28 : (lane === "LeagueHire" ? absDiff(a.domainRung, b.domainRung) > 25 : (lane === "LeagueFriend" ? absDiff(a.economic, b.economic) > 50 || absDiff(a.socialCapital, b.socialCapital) > 50 : absDiff(a.economic, b.economic) > 45 || absDiff(a.socialCapital, b.socialCapital) > 45 || absDiff(a.domainRung, b.domainRung) > 35));
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function leaguePairAllowed(lane: LeagueLane, anyMinor: boolean, a: LeagueAxisProfile, b: LeagueAxisProfile): boolean {
  const local_7: LeagueAxisProfile = effectiveLeagueProfile(lane, a);
  const local_8: LeagueAxisProfile = effectiveLeagueProfile(lane, b);
  return anyMinor ? true : (lane !== "LeagueHire" && (local_7.extractionRisk > 65 || local_8.extractionRisk > 65 || !discretionRespectsHighVisibility(local_7, local_8) || !discretionRespectsHighVisibility(local_8, local_7)) ? false : (!leagueGapIsWide(lane, local_7, local_8) ? true : bilateralValueCompensates(lane, local_7, local_8)));
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function lawMinorsNeverLeagueGated(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile): boolean {
  //@ ensures \result === true
  return leaguePairAllowed(lane, true, a, b);
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function lawPeonFirewallZeroesProtectedAxes(a: LeagueAxisProfile, b: LeagueAxisProfile, econA: number, econB: number, socA: number, socB: number, aesA: number, aesB: number, pubA: number, pubB: number): boolean {
  //@ ensures \result === true
  const local_9: LeagueAxisProfile = { economic: econA, socialCapital: socA, domainRung: a.domainRung, aesthetic: aesA, discretion: a.discretion, extractionRisk: a.extractionRisk, publicity: pubA, verifiedEvidence: a.verifiedEvidence, trajectory: a.trajectory, crossCapitalOpen: a.crossCapitalOpen, sharedGuild: a.sharedGuild };
  const local_10: LeagueAxisProfile = { economic: econB, socialCapital: socB, domainRung: b.domainRung, aesthetic: aesB, discretion: b.discretion, extractionRisk: b.extractionRisk, publicity: pubB, verifiedEvidence: b.verifiedEvidence, trajectory: b.trajectory, crossCapitalOpen: b.crossCapitalOpen, sharedGuild: b.sharedGuild };
  return leaguePairAllowed("LeagueHire", false, a, b) === leaguePairAllowed("LeagueHire", false, local_9, local_10);
}

/** Story: Block wide adult league gaps unless verified bilateral value compensates / Lane firewalls zero protected attributes before any gap or discretion check (spec/qualityAndLeague.md) */
//@ pure
export function lawAestheticWalledToDateOnly(lane: LeagueLane, a: LeagueAxisProfile, b: LeagueAxisProfile, aesA: number, aesB: number): boolean {
  //@ ensures \result === true
  const local_11: LeagueAxisProfile = { economic: a.economic, socialCapital: a.socialCapital, domainRung: a.domainRung, aesthetic: aesA, discretion: a.discretion, extractionRisk: a.extractionRisk, publicity: a.publicity, verifiedEvidence: a.verifiedEvidence, trajectory: a.trajectory, crossCapitalOpen: a.crossCapitalOpen, sharedGuild: a.sharedGuild };
  const local_12: LeagueAxisProfile = { economic: b.economic, socialCapital: b.socialCapital, domainRung: b.domainRung, aesthetic: aesB, discretion: b.discretion, extractionRisk: b.extractionRisk, publicity: b.publicity, verifiedEvidence: b.verifiedEvidence, trajectory: b.trajectory, crossCapitalOpen: b.crossCapitalOpen, sharedGuild: b.sharedGuild };
  return !(lane !== "LeagueDate") || leaguePairAllowed(lane, false, a, b) === leaguePairAllowed(lane, false, local_11, local_12);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_qualityAndLeague(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}

/** Whole-number division as Quint does it: towards zero. */
//@ pure
export function quotient_qualityAndLeague(a: number, b: number): number {
  //@ requires b !== 0
  if (b === 0) throw new RangeError(`${a} cannot be divided by zero`);
  return (a < 0 === b < 0 ? 1 : -1) * Math.floor(Math.abs(a) / Math.abs(b)) + 0;
}
