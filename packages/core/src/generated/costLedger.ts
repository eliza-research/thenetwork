// GENERATED from spec/costLedger.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Know the cost of paid service work / Charge code sends, photo tries, and priced model attempts (spec/costLedger.md) */
export type OtpCostBasis = "OtpUnmetered" | "OtpSmsEstimate" | "OtpVerifyEstimate";
/** Story: Know the cost of paid service work / Relay classification charges only a provider attempt (spec/costLedger.md) */
export type RelayCostBasis = "RelayUnmetered" | "RelayFixedPrice" | "RelayTokenPrice";

/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
export const costMicrosPerUsd: number = 1000000;
/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
export const defaultTwilioVerifyMicros: number = 58000;
/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
export const defaultClefPhotoMicros: number = 425;
/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
export const defaultSmsMicros: number = 8300;
/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
export const defaultBlooioLines: number = 1;
/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
export const costAccrualDaysPerMonth: number = 30;

/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
//@ pure
export function costOverrideValid(finite: boolean, amount: number): boolean {
  return finite && amount >= 0;
}

/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
//@ pure
export function costAmountWithFloor(amount: number): number {
  return amount <= 0 ? 0 : amount;
}

/** Story: Know the cost of paid service work / Use the configured rates and the existing defaults (spec/costLedger.md) */
//@ pure
export function lawCostFloorIsNonnegative(amount: number): boolean {
  //@ ensures \result === true
  return costAmountWithFloor(amount) >= 0;
}

/** Story: Know the cost of paid service work / Charge code sends, photo tries, and priced model attempts (spec/costLedger.md) */
//@ pure
export function otpCostBasis(provider: string, twilioProvider: boolean): OtpCostBasis {
  return provider === "blooio" ? "OtpSmsEstimate" : (twilioProvider ? "OtpVerifyEstimate" : "OtpUnmetered");
}

/** Story: Know the cost of paid service work / Charge code sends, photo tries, and priced model attempts (spec/costLedger.md) */
//@ pure
export function photoRaterIsMetered(provider: string): boolean {
  return provider !== "none";
}

/** Story: Know the cost of paid service work / Charge code sends, photo tries, and priced model attempts (spec/costLedger.md) */
//@ pure
export function photoResultIsBillable(refused: boolean): boolean {
  return !refused;
}

/** Story: Know the cost of paid service work / Charge code sends, photo tries, and priced model attempts (spec/costLedger.md) */
//@ pure
export function meteredPhotoQuantity(photos: number): number {
  return photos > 1 ? photos : 1;
}

/** Story: Know the cost of paid service work / Charge code sends, photo tries, and priced model attempts (spec/costLedger.md) */
//@ pure
export function llmAttemptIsPriced(costMicro: number): boolean {
  return costMicro > 0;
}

/** Story: Know the cost of paid service work / Relay classification charges only a provider attempt (spec/costLedger.md) */
//@ pure
export function relayCostBasis(providerOutcome: string, fixedPrice: boolean): RelayCostBasis {
  return providerOutcome === "ok" || providerOutcome === "error" || providerOutcome === "timeout" ? (fixedPrice ? "RelayFixedPrice" : "RelayTokenPrice") : "RelayUnmetered";
}

/** Story: Know the cost of paid service work / Relay classification charges only a provider attempt (spec/costLedger.md) */
//@ pure
export function lawRelayCacheCostsNothing(fixedPrice: boolean): boolean {
  //@ ensures \result === true
  return relayCostBasis("cached", fixedPrice) === "RelayUnmetered";
}

/** Story: Report the spend against a daily budget / Accrue configured line costs and show positive budgets (spec/costLedger.md) */
//@ pure
export function dailyCostIncludesLine(accrueLine: boolean, monthlyKnown: boolean, lines: number): boolean {
  return accrueLine && monthlyKnown && lines > 0;
}

/** Story: Report the spend against a daily budget / Accrue configured line costs and show positive budgets (spec/costLedger.md) */
//@ pure
export function costBudgetIsEnabled(budget: number): boolean {
  return budget > 0;
}

/** Story: Report the spend against a daily budget / Accrue configured line costs and show positive budgets (spec/costLedger.md) */
//@ pure
export function lawZeroBudgetIsDisabled(budget: number): boolean {
  //@ ensures \result === true
  return !(budget === 0) || !costBudgetIsEnabled(budget);
}
