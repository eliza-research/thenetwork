// GENERATED from spec/otpLimits.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny


/** Story: Prove ownership of my phone / Verification codes expire and have a limited number of attempts (spec/otpLimits.md:7) */
export const otpChallengeMaxAttempts: number = 5;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md:16) */
export const otpSendsPerPhoneHour: number = 3;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md:16) */
export const otpSendsPerPhoneDay: number = 6;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md:16) */
export const otpSendsPerIpHour: number = 10;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md:16) */
export const otpSendGapMs: number = 30 * 1000;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md:16) */
export const otpSendsGlobalHour: number = 500;
/** Story: Prove ownership of my phone / Code checks also have limits shared across apps (spec/otpLimits.md:28) */
export const otpChecksPerPhoneHour: number = 10;
/** Story: Prove ownership of my phone / Code checks also have limits shared across apps (spec/otpLimits.md:28) */
export const otpChecksPerIpHour: number = 30;
/** Story: Prove ownership of my phone / Verification codes expire and have a limited number of attempts (spec/otpLimits.md:7) */
export const otpLifetimeMs: number = 10 * 60 * 1000;
