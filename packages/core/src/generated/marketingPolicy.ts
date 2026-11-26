// GENERATED from spec/marketingPolicy.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny


/** Story: Hire and pay only verified adult participants within campaign limits / Only verified adults aged 18 through 120 may participate in paid marketing tasks (spec/marketingPolicy.md) */
export const marketingAdultAge: number = 18;
/** Story: Hire and pay only verified adult participants within campaign limits / Only verified adults aged 18 through 120 may participate in paid marketing tasks (spec/marketingPolicy.md) */
export const marketingMaxAge: number = 120;

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
