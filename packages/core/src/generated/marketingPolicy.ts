// GENERATED from spec/marketingPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Hire and pay only verified adult participants within campaign limits / Only verified adults aged 18 through 120 may participate in paid marketing tasks (spec/marketingPolicy.md) */
export const marketingAdultAge: number = 18;
/** Story: Hire and pay only verified adult participants within campaign limits / Only verified adults aged 18 through 120 may participate in paid marketing tasks (spec/marketingPolicy.md) */
export const marketingMaxAge: number = 120;
/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
export const mvnoBonusCapCents: number = 200;
/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
export const consumerLifetimeBonusCapCents: number = 2000;
/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
export const w9AnnualThresholdCents: number = 50000;
/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Bandit arms stay eligible only within CPA and STOP-rate ceilings (spec/marketingPolicy.md) */
export const banditMaxStopRateBps: number = 500;

/** Story: Hire and pay only verified adult participants within campaign limits / Only verified adults aged 18 through 120 may participate in paid marketing tasks (spec/marketingPolicy.md) */
//@ pure
export function adultParticipantAge(age: number): boolean {
  return age >= marketingAdultAge && age <= marketingMaxAge;
}

/** Story: Hire and pay only verified adult participants within campaign limits / Campaign spend obeys per-task, daily, monthly, billing, lockdown, and slop.cash gates (spec/marketingPolicy.md) */
//@ pure
export function canAuthorizeSpend(tier: number, amountCents: number, perTaskCapCents: number, dailySpentCents: number, dailyCapCents: number, monthlySpentCents: number, monthlyCapCents: number, billingArmed: boolean, lockdown: boolean, useSlopCash: boolean, slopCashEnabled: boolean): boolean {
  return amountCents > 0 && amountCents <= perTaskCapCents && dailySpentCents >= 0 && exact_marketingPolicy(dailySpentCents + amountCents) <= dailyCapCents && monthlySpentCents >= 0 && exact_marketingPolicy(monthlySpentCents + amountCents) <= monthlyCapCents && (tier <= 2 || (billingArmed && !lockdown)) && (!useSlopCash || slopCashEnabled);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Campaign spend obeys per-task, daily, monthly, billing, lockdown, and slop.cash gates (spec/marketingPolicy.md) */
//@ pure
export function lawSpendRespectsCaps(tier: number, amountCents: number, perTaskCapCents: number, dailySpentCents: number, dailyCapCents: number, monthlySpentCents: number, monthlyCapCents: number, billingArmed: boolean, lockdown: boolean, useSlopCash: boolean, slopCashEnabled: boolean): boolean {
  //@ ensures \result === true
  return !canAuthorizeSpend(tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents, monthlySpentCents, monthlyCapCents, billingArmed, lockdown, useSlopCash, slopCashEnabled) || (amountCents > 0 && amountCents <= perTaskCapCents && dailySpentCents >= 0 && exact_marketingPolicy(dailySpentCents + amountCents) <= dailyCapCents && monthlySpentCents >= 0 && exact_marketingPolicy(monthlySpentCents + amountCents) <= monthlyCapCents);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Campaign spend obeys per-task, daily, monthly, billing, lockdown, and slop.cash gates (spec/marketingPolicy.md) */
//@ pure
export function lawSlopCashBlockedWhenDisabled(tier: number, amountCents: number, perTaskCapCents: number, dailySpentCents: number, dailyCapCents: number, monthlySpentCents: number, monthlyCapCents: number, billingArmed: boolean, lockdown: boolean): boolean {
  //@ ensures \result === true
  return !canAuthorizeSpend(tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents, monthlySpentCents, monthlyCapCents, billingArmed, lockdown, true, false);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Campaign spend obeys per-task, daily, monthly, billing, lockdown, and slop.cash gates (spec/marketingPolicy.md) */
//@ pure
export function lawLockdownBlocksTier3And4(tier: number, amountCents: number, perTaskCapCents: number, dailySpentCents: number, dailyCapCents: number, monthlySpentCents: number, monthlyCapCents: number, billingArmed: boolean, useSlopCash: boolean, slopCashEnabled: boolean): boolean {
  //@ ensures \result === true
  return !(tier > 2) || !canAuthorizeSpend(tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents, monthlySpentCents, monthlyCapCents, billingArmed, true, useSlopCash, slopCashEnabled);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Only open-source developer bounties may use the slop.cash payout rail (spec/marketingPolicy.md) */
//@ pure
export function isOssDevBounty(taskKindIsOssDev: boolean): boolean {
  return taskKindIsOssDev;
}

/** Story: Hire and pay only verified adult participants within campaign limits / Only open-source developer bounties may use the slop.cash payout rail (spec/marketingPolicy.md) */
//@ pure
export function canAuthorizeTaskSpend(tier: number, amountCents: number, perTaskCapCents: number, dailySpentCents: number, dailyCapCents: number, monthlySpentCents: number, monthlyCapCents: number, billingArmed: boolean, lockdown: boolean, useSlopCash: boolean, slopCashEnabled: boolean, taskKindIsOssDev: boolean): boolean {
  return canAuthorizeSpend(tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents, monthlySpentCents, monthlyCapCents, billingArmed, lockdown, useSlopCash, slopCashEnabled) && (!useSlopCash || isOssDevBounty(taskKindIsOssDev));
}

/** Story: Hire and pay only verified adult participants within campaign limits / Only open-source developer bounties may use the slop.cash payout rail (spec/marketingPolicy.md) */
//@ pure
export function lawConsumerTaskNeverUsesSlopCash(tier: number, amountCents: number, perTaskCapCents: number, dailySpentCents: number, dailyCapCents: number, monthlySpentCents: number, monthlyCapCents: number, billingArmed: boolean, lockdown: boolean, slopCashEnabled: boolean): boolean {
  //@ ensures \result === true
  return !canAuthorizeTaskSpend(tier, amountCents, perTaskCapCents, dailySpentCents, dailyCapCents, monthlySpentCents, monthlyCapCents, billingArmed, lockdown, true, slopCashEnabled, false);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Human street-team and creator payouts require complete proof and verified adult status (spec/marketingPolicy.md) */
//@ pure
export function canApproveProof(hasEvidenceUrl: boolean, ftcDisclosed: boolean, geoTimeValid: boolean, verifiedSignupsOrShiftDone: boolean, workerAge: number, workerBanned: boolean): boolean {
  return hasEvidenceUrl && ftcDisclosed && geoTimeValid && verifiedSignupsOrShiftDone && adultParticipantAge(workerAge) && !workerBanned;
}

/** Story: Hire and pay only verified adult participants within campaign limits / Human street-team and creator payouts require complete proof and verified adult status (spec/marketingPolicy.md) */
//@ pure
export function lawUnderageNeverPaid(hasEvidenceUrl: boolean, ftcDisclosed: boolean, geoTimeValid: boolean, verifiedSignupsOrShiftDone: boolean, workerAge: number, workerBanned: boolean): boolean {
  //@ ensures \result === true
  return !(workerAge < marketingAdultAge || workerAge > marketingMaxAge) || !canApproveProof(hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Human street-team and creator payouts require complete proof and verified adult status (spec/marketingPolicy.md) */
//@ pure
export function lawProofRequiresEvidenceAndAdult(hasEvidenceUrl: boolean, ftcDisclosed: boolean, geoTimeValid: boolean, verifiedSignupsOrShiftDone: boolean, workerAge: number, workerBanned: boolean): boolean {
  //@ ensures \result === true
  return !canApproveProof(hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned) || (hasEvidenceUrl && ftcDisclosed && geoTimeValid && verifiedSignupsOrShiftDone && adultParticipantAge(workerAge) && !workerBanned);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Creator video proofs also require signed commercial likeness releases (spec/marketingPolicy.md) */
//@ pure
export function likenessReleaseOk(needsRelease: boolean, hasRelease: boolean): boolean {
  return !needsRelease || hasRelease;
}

/** Story: Hire and pay only verified adult participants within campaign limits / Creator video proofs also require signed commercial likeness releases (spec/marketingPolicy.md) */
//@ pure
export function canApproveCreatorProof(hasEvidenceUrl: boolean, ftcDisclosed: boolean, geoTimeValid: boolean, verifiedSignupsOrShiftDone: boolean, workerAge: number, workerBanned: boolean, needsRelease: boolean, hasRelease: boolean): boolean {
  return canApproveProof(hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned) && likenessReleaseOk(needsRelease, hasRelease);
}

/** Story: Hire and pay only verified adult participants within campaign limits / Creator video proofs also require signed commercial likeness releases (spec/marketingPolicy.md) */
//@ pure
export function lawCreatorProofRequiresLikenessRelease(hasEvidenceUrl: boolean, ftcDisclosed: boolean, geoTimeValid: boolean, verifiedSignupsOrShiftDone: boolean, workerAge: number, workerBanned: boolean): boolean {
  //@ ensures \result === true
  return !canApproveCreatorProof(hasEvidenceUrl, ftcDisclosed, geoTimeValid, verifiedSignupsOrShiftDone, workerAge, workerBanned, true, false);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
//@ pure
export function antiFraudPayoutAllowed(tier: number, amountCents: number, isPrepaidOrMvno: boolean, isVoip: boolean, priorLifetimeCents: number, annualWorkerCents: number, hasW9: boolean, mediaDuplicate: boolean, clusterQuarantined: boolean): boolean {
  return tier >= 1 && amountCents > 0 && priorLifetimeCents >= 0 && annualWorkerCents >= 0 && !isVoip && (!isPrepaidOrMvno || amountCents <= mvnoBonusCapCents) && (tier >= 4 || exact_marketingPolicy(priorLifetimeCents + amountCents) <= consumerLifetimeBonusCapCents) && (exact_marketingPolicy(annualWorkerCents + amountCents) <= w9AnnualThresholdCents || hasW9) && !mediaDuplicate && !clusterQuarantined;
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
//@ pure
export function lawVoipNeverPaid(tier: number, amountCents: number, isPrepaidOrMvno: boolean, priorLifetimeCents: number, annualWorkerCents: number, hasW9: boolean, mediaDuplicate: boolean, clusterQuarantined: boolean): boolean {
  //@ ensures \result === true
  return !antiFraudPayoutAllowed(tier, amountCents, isPrepaidOrMvno, true, priorLifetimeCents, annualWorkerCents, hasW9, mediaDuplicate, clusterQuarantined);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
//@ pure
export function lawMvnoBonusCappedAt200(tier: number, amountCents: number, isVoip: boolean, priorLifetimeCents: number, annualWorkerCents: number, hasW9: boolean, mediaDuplicate: boolean, clusterQuarantined: boolean): boolean {
  //@ ensures \result === true
  return !(amountCents > mvnoBonusCapCents) || !antiFraudPayoutAllowed(tier, amountCents, true, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, mediaDuplicate, clusterQuarantined);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
//@ pure
export function lawConsumerLifetimeCapNeverExceeded(tier: number, amountCents: number, isPrepaidOrMvno: boolean, isVoip: boolean, priorLifetimeCents: number, annualWorkerCents: number, hasW9: boolean, mediaDuplicate: boolean, clusterQuarantined: boolean): boolean {
  //@ ensures \result === true
  return !(tier < 4 && exact_marketingPolicy(priorLifetimeCents + amountCents) > consumerLifetimeBonusCapCents) || !antiFraudPayoutAllowed(tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, mediaDuplicate, clusterQuarantined);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
//@ pure
export function lawW9RequiredOver500Usd(tier: number, amountCents: number, isPrepaidOrMvno: boolean, isVoip: boolean, priorLifetimeCents: number, annualWorkerCents: number, mediaDuplicate: boolean, clusterQuarantined: boolean): boolean {
  //@ ensures \result === true
  return !(exact_marketingPolicy(annualWorkerCents + amountCents) > w9AnnualThresholdCents) || !antiFraudPayoutAllowed(tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, false, mediaDuplicate, clusterQuarantined);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Anti-fraud payout checks block VoIP, cap prepaid/MVNO and lifetime consumer bonuses, enforce W-9 over $500, and block duplicates or quarantined clusters (spec/marketingPolicy.md) */
//@ pure
export function lawDuplicateOrQuarantinedBlocked(tier: number, amountCents: number, isPrepaidOrMvno: boolean, isVoip: boolean, priorLifetimeCents: number, annualWorkerCents: number, hasW9: boolean): boolean {
  //@ ensures \result === true
  return !antiFraudPayoutAllowed(tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, true, false) && !antiFraudPayoutAllowed(tier, amountCents, isPrepaidOrMvno, isVoip, priorLifetimeCents, annualWorkerCents, hasW9, false, true);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Automated BD venue deals stay inside venue budget bounds and require phone callback and signed contract (spec/marketingPolicy.md) */
//@ pure
export function bdDealWithinBounds(offeredCents: number, maxVenueCents: number, hasPhoneCallback: boolean, contractSigned: boolean): boolean {
  return offeredCents >= 0 && maxVenueCents >= 0 && offeredCents <= maxVenueCents && hasPhoneCallback && contractSigned;
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Automated BD venue deals stay inside venue budget bounds and require phone callback and signed contract (spec/marketingPolicy.md) */
//@ pure
export function lawBdDealRequiresBoundsCallbackAndContract(offeredCents: number, maxVenueCents: number, hasPhoneCallback: boolean, contractSigned: boolean): boolean {
  //@ ensures \result === true
  return !bdDealWithinBounds(offeredCents, maxVenueCents, hasPhoneCallback, contractSigned) || (offeredCents >= 0 && offeredCents <= maxVenueCents && hasPhoneCallback && contractSigned);
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Bandit arms stay eligible only within CPA and STOP-rate ceilings (spec/marketingPolicy.md) */
//@ pure
export function banditArmEligible(cpaCents: number, maxCpaCents: number, stopRateBps: number, maxStopRateBps: number): boolean {
  return cpaCents >= 0 && maxCpaCents >= 0 && cpaCents <= maxCpaCents && stopRateBps >= 0 && maxStopRateBps >= 0 && stopRateBps <= maxStopRateBps;
}

/** Story: Enforce anti-fraud payout caps, BD deal bounds, and bandit eligibility / Bandit arms stay eligible only within CPA and STOP-rate ceilings (spec/marketingPolicy.md) */
//@ pure
export function lawBanditKillsHighCpaOrStopRate(cpaCents: number, maxCpaCents: number, stopRateBps: number, maxStopRateBps: number): boolean {
  //@ ensures \result === true
  return !(cpaCents > maxCpaCents || stopRateBps > maxStopRateBps) || !banditArmEligible(cpaCents, maxCpaCents, stopRateBps, maxStopRateBps);
}

/** Story: Enforce agent subscription caps and the global STOP fence / Agent turns and direct outreach stop immediately on STOP, ban, lockdown, or cap exhaustion (spec/marketingPolicy.md) */
//@ pure
export function canDispatchAgentTurn(agentPaused: boolean, rateLimited: boolean, sessionHealthy: boolean, turnsToday: number, dailyTurnCap: number, targetStopped: boolean, lockdown: boolean): boolean {
  return !agentPaused && !rateLimited && sessionHealthy && turnsToday >= 0 && turnsToday < dailyTurnCap && !targetStopped && !lockdown;
}

/** Story: Enforce agent subscription caps and the global STOP fence / Agent turns and direct outreach stop immediately on STOP, ban, lockdown, or cap exhaustion (spec/marketingPolicy.md) */
//@ pure
export function canSendOutreach(targetStopped: boolean, targetBanned: boolean, lockdown: boolean, sentToday: number, dailyOutreachCap: number): boolean {
  return !targetStopped && !targetBanned && !lockdown && sentToday >= 0 && sentToday < dailyOutreachCap;
}

/** Story: Enforce agent subscription caps and the global STOP fence / Agent turns and direct outreach stop immediately on STOP, ban, lockdown, or cap exhaustion (spec/marketingPolicy.md) */
//@ pure
export function lawStopFenceBlocksAgentAndOutreach(agentPaused: boolean, rateLimited: boolean, sessionHealthy: boolean, turnsToday: number, dailyTurnCap: number, targetBanned: boolean, lockdown: boolean, sentToday: number, dailyOutreachCap: number): boolean {
  //@ ensures \result === true
  return !canDispatchAgentTurn(agentPaused, rateLimited, sessionHealthy, turnsToday, dailyTurnCap, true, lockdown) && !canSendOutreach(true, targetBanned, lockdown, sentToday, dailyOutreachCap);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_marketingPolicy(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
