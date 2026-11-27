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
/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
export const coldCooldownDays: number = 14;
/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
export const maxColdTouches30d: number = 2;
/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
export const maxUnansweredCold: number = 2;
/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
export const maxOpTouchesPerDay: number = 3;
/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Apollo enrichment credits obey daily and monthly caps, billing arming, lockdown, suppression, and adult-only safety (spec/marketingPolicy.md) */
export const maxPlatformReportRisk: number = 24;
/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Apollo enrichment credits obey daily and monthly caps, billing arming, lockdown, suppression, and adult-only safety (spec/marketingPolicy.md) */
export const minIntakeQualityScore: number = 70;

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

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Daily LLM calls stay within token and cost ceilings (spec/marketingPolicy.md) */
//@ pure
export function llmBudgetWithinCaps(tokensUsedToday: number, estimatedTokens: number, dailyTokenCap: number, costMicrosToday: number, estimatedCostMicros: number, dailyCostCapMicros: number): boolean {
  return tokensUsedToday >= 0 && estimatedTokens >= 0 && dailyTokenCap > 0 && exact_marketingPolicy(tokensUsedToday + estimatedTokens) <= dailyTokenCap && costMicrosToday >= 0 && estimatedCostMicros >= 0 && dailyCostCapMicros > 0 && exact_marketingPolicy(costMicrosToday + estimatedCostMicros) <= dailyCostCapMicros;
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Daily LLM calls stay within token and cost ceilings (spec/marketingPolicy.md) */
//@ pure
export function lawTokenCapBlocksLlm(tokensUsedToday: number, estimatedTokens: number, dailyTokenCap: number, costMicrosToday: number, estimatedCostMicros: number, dailyCostCapMicros: number): boolean {
  //@ ensures \result === true
  return !(exact_marketingPolicy(tokensUsedToday + estimatedTokens) > dailyTokenCap) || !llmBudgetWithinCaps(tokensUsedToday, estimatedTokens, dailyTokenCap, costMicrosToday, estimatedCostMicros, dailyCostCapMicros);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Daily LLM calls stay within token and cost ceilings (spec/marketingPolicy.md) */
//@ pure
export function lawCostCapBlocksLlm(tokensUsedToday: number, estimatedTokens: number, dailyTokenCap: number, costMicrosToday: number, estimatedCostMicros: number, dailyCostCapMicros: number): boolean {
  //@ ensures \result === true
  return !(exact_marketingPolicy(costMicrosToday + estimatedCostMicros) > dailyCostCapMicros) || !llmBudgetWithinCaps(tokensUsedToday, estimatedTokens, dailyTokenCap, costMicrosToday, estimatedCostMicros, dailyCostCapMicros);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Paid acquisition pauses when platform queues or messaging lines are under pressure (spec/marketingPolicy.md) */
//@ pure
export function queuePressurePaused(lineRestricted: boolean, reviewOverdue: number, reviewOpen: number, reviewBacklogLimit: number, outboundWaiting: number, outboundBacklogLimit: number): boolean {
  return lineRestricted || reviewOverdue > 0 || reviewOpen >= reviewBacklogLimit || outboundWaiting >= outboundBacklogLimit;
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Paid acquisition pauses when platform queues or messaging lines are under pressure (spec/marketingPolicy.md) */
//@ pure
export function lawLineRestrictedPausesPaid(reviewOverdue: number, reviewOpen: number, reviewBacklogLimit: number, outboundWaiting: number, outboundBacklogLimit: number): boolean {
  //@ ensures \result === true
  return queuePressurePaused(true, reviewOverdue, reviewOpen, reviewBacklogLimit, outboundWaiting, outboundBacklogLimit);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Paid acquisition pauses when platform queues or messaging lines are under pressure (spec/marketingPolicy.md) */
//@ pure
export function lawOverdueReviewPausesPaid(lineRestricted: boolean, reviewOverdue: number, reviewOpen: number, reviewBacklogLimit: number, outboundWaiting: number, outboundBacklogLimit: number): boolean {
  //@ ensures \result === true
  return !(reviewOverdue > 0) || queuePressurePaused(lineRestricted, reviewOverdue, reviewOpen, reviewBacklogLimit, outboundWaiting, outboundBacklogLimit);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
//@ pure
export function contactSafetyEligible(isStopped: boolean, isBanned: boolean, isKnownMinor: boolean, lockdown: boolean): boolean {
  return !isStopped && !isBanned && !isKnownMinor && !lockdown;
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
//@ pure
export function lawKnownMinorNeverContacted(isStopped: boolean, isBanned: boolean, lockdown: boolean): boolean {
  //@ ensures \result === true
  return !contactSafetyEligible(isStopped, isBanned, true, lockdown);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
//@ pure
export function lawStoppedNeverContacted(isBanned: boolean, isKnownMinor: boolean, lockdown: boolean): boolean {
  //@ ensures \result === true
  return !contactSafetyEligible(true, isBanned, isKnownMinor, lockdown);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
//@ pure
export function contactCooldownAllowed(isCold: boolean, isQuietHours: boolean, daysSinceCold: number, coldTouches30d: number, unansweredCold: number, opTouchesToday: number): boolean {
  return isCold ? !isQuietHours && daysSinceCold >= coldCooldownDays && coldTouches30d >= 0 && coldTouches30d < maxColdTouches30d && unansweredCold >= 0 && unansweredCold < maxUnansweredCold : opTouchesToday >= 0 && opTouchesToday < maxOpTouchesPerDay;
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
//@ pure
export function lawColdCooldownBlocksEarlyTouch(isQuietHours: boolean, daysSinceCold: number, coldTouches30d: number, unansweredCold: number, opTouchesToday: number): boolean {
  //@ ensures \result === true
  return !(daysSinceCold < coldCooldownDays) || !contactCooldownAllowed(true, isQuietHours, daysSinceCold, coldTouches30d, unansweredCold, opTouchesToday);
}

/** Story: Enforce daily LLM budgets, queue backpressure, and cross-surface contact hygiene / Cross-surface contact safety and cooldowns block minors, opt-outs, bans, quiet hours, and spam streaks (spec/marketingPolicy.md) */
//@ pure
export function lawUnansweredStreakStopsCold(isQuietHours: boolean, daysSinceCold: number, coldTouches30d: number, unansweredCold: number, opTouchesToday: number): boolean {
  //@ ensures \result === true
  return !(unansweredCold >= maxUnansweredCold) || !contactCooldownAllowed(true, isQuietHours, daysSinceCold, coldTouches30d, unansweredCold, opTouchesToday);
}

/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Apollo enrichment credits obey daily and monthly caps, billing arming, lockdown, suppression, and adult-only safety (spec/marketingPolicy.md) */
//@ pure
export function canAuthorizeApolloCredits(creditsUsedToday: number, requestedCredits: number, dailyCreditCap: number, creditsUsedMonth: number, monthlyCreditCap: number, billingArmed: boolean, lockdown: boolean, isSuppressed: boolean, isKnownMinor: boolean): boolean {
  return requestedCredits >= 0 && creditsUsedToday >= 0 && creditsUsedMonth >= 0 && dailyCreditCap >= 0 && monthlyCreditCap >= 0 && !lockdown && !isSuppressed && !isKnownMinor && (requestedCredits === 0 || (billingArmed && exact_marketingPolicy(creditsUsedToday + requestedCredits) <= dailyCreditCap && exact_marketingPolicy(creditsUsedMonth + requestedCredits) <= monthlyCreditCap));
}

/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Apollo enrichment credits obey daily and monthly caps, billing arming, lockdown, suppression, and adult-only safety (spec/marketingPolicy.md) */
//@ pure
export function lawApolloCreditsRespectCapsAndSafety(creditsUsedToday: number, requestedCredits: number, dailyCreditCap: number, creditsUsedMonth: number, monthlyCreditCap: number, billingArmed: boolean, lockdown: boolean, isSuppressed: boolean, isKnownMinor: boolean): boolean {
  //@ ensures \result === true
  return !canAuthorizeApolloCredits(creditsUsedToday, requestedCredits, dailyCreditCap, creditsUsedMonth, monthlyCreditCap, billingArmed, lockdown, isSuppressed, isKnownMinor) || (!lockdown && !isSuppressed && !isKnownMinor && (requestedCredits === 0 || (billingArmed && exact_marketingPolicy(creditsUsedToday + requestedCredits) <= dailyCreditCap && exact_marketingPolicy(creditsUsedMonth + requestedCredits) <= monthlyCreditCap)));
}

/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Platform outreach fails closed on suspended channels, high report risk, or unsolicited links on link-free platforms (spec/marketingPolicy.md) */
//@ pure
export function canDispatchPlatformTouch(sentToday: number, effectiveDailyCap: number, reportRiskScore: number, hasUnsolicitedUrl: boolean, requiresLinkFree: boolean, contactSafe: boolean, cooldownAllowed: boolean, channelSuspended: boolean): boolean {
  return !channelSuspended && contactSafe && cooldownAllowed && sentToday >= 0 && effectiveDailyCap > 0 && sentToday < effectiveDailyCap && reportRiskScore >= 0 && reportRiskScore <= maxPlatformReportRisk && (!requiresLinkFree || !hasUnsolicitedUrl);
}

/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Platform outreach fails closed on suspended channels, high report risk, or unsolicited links on link-free platforms (spec/marketingPolicy.md) */
//@ pure
export function lawHighReportRiskOrSuspendedBlocked(sentToday: number, effectiveDailyCap: number, reportRiskScore: number, hasUnsolicitedUrl: boolean, requiresLinkFree: boolean, contactSafe: boolean, cooldownAllowed: boolean, channelSuspended: boolean): boolean {
  //@ ensures \result === true
  return !(channelSuspended || reportRiskScore > maxPlatformReportRisk || (requiresLinkFree && hasUnsolicitedUrl)) || !canDispatchPlatformTouch(sentToday, effectiveDailyCap, reportRiskScore, hasUnsolicitedUrl, requiresLinkFree, contactSafe, cooldownAllowed, channelSuspended);
}

/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Out-of-network quality intake invites verified high-signal adults at most once after delivering value (spec/marketingPolicy.md) */
//@ pure
export function canPromoteOutOfNetworkCandidate(statedAge: number, qualityScore: number, valueDelivered: boolean, explicitPositiveSignal: boolean, contactSafe: boolean, queuePaused: boolean, priorInviteCount: number): boolean {
  return adultParticipantAge(statedAge) && qualityScore >= minIntakeQualityScore && qualityScore <= 100 && valueDelivered && explicitPositiveSignal && contactSafe && !queuePaused && priorInviteCount === 0;
}

/** Story: Gate Apollo enrichment credits, 10-platform outreach risk, and out-of-network quality intake / Out-of-network quality intake invites verified high-signal adults at most once after delivering value (spec/marketingPolicy.md) */
//@ pure
export function lawIntakeRequiresAdultQualityValueAndOnceOnly(statedAge: number, qualityScore: number, valueDelivered: boolean, explicitPositiveSignal: boolean, contactSafe: boolean, queuePaused: boolean, priorInviteCount: number): boolean {
  //@ ensures \result === true
  return !canPromoteOutOfNetworkCandidate(statedAge, qualityScore, valueDelivered, explicitPositiveSignal, contactSafe, queuePaused, priorInviteCount) || (adultParticipantAge(statedAge) && qualityScore >= minIntakeQualityScore && valueDelivered && explicitPositiveSignal && contactSafe && !queuePaused && priorInviteCount === 0);
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_marketingPolicy(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
