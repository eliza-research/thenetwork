// GENERATED from spec/otpLimits.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export type ChallengeReason = "NoReason" | "LimitedHour" | "LimitedGap" | "LimitedDay" | "LimitedGlobal" | "VerificationFailed";
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export type ChallengePhase = "Beginning" | "SendAddress" | "SendPhoneHour" | "SendPhoneDay" | "SendGlobal" | "Sending" | "RecordingChallenge" | "StartComplete" | "CheckAddress" | "CheckPhone" | "ReadingChallenge" | "ClaimingAttempt" | "CheckingCode" | "ConsumingChallenge" | "Verified" | "Refused";
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export interface ChallengeFlow { phase: ChallengePhase; reason: ChallengeReason }

/** One variant per transition in the spec. */
export type Event =
  | { type: "requestCode" }
  | { type: "readSendAddress"; allowed: boolean }
  | { type: "readSendPhoneHour"; allowed: boolean; gapLeft: number }
  | { type: "readSendPhoneDay"; allowed: boolean }
  | { type: "readSendGlobal"; allowed: boolean }
  | { type: "recordSend"; providerAccepted: boolean }
  | { type: "finishStart" }
  | { type: "beginVerification"; codeWellFormed: boolean }
  | { type: "readCheckAddress"; allowed: boolean }
  | { type: "readCheckPhone"; allowed: boolean }
  | { type: "readChallenge"; matchingProvider: boolean }
  | { type: "claimAttempt"; claimed: boolean }
  | { type: "checkCode"; correct: boolean }
  | { type: "consumeChallenge"; consumed: boolean };

/** Story: Prove ownership of my phone / Verification codes expire and have a limited number of attempts (spec/otpLimits.md) */
export const otpChallengeMaxAttempts: number = 5;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export const otpSendsPerPhoneHour: number = 3;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export const otpSendsPerPhoneDay: number = 6;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export const otpSendsPerIpHour: number = 10;
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export const otpSendGapMs: number = exact_otpLimits(30 * 1000);
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export const otpSendsGlobalHour: number = 500;
/** Story: Prove ownership of my phone / Code checks also have limits shared across apps (spec/otpLimits.md) */
export const otpChecksPerPhoneHour: number = 10;
/** Story: Prove ownership of my phone / Code checks also have limits shared across apps (spec/otpLimits.md) */
export const otpChecksPerIpHour: number = 30;
/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
export const otpSendsPerIpHourPhoneCodeOnly: number = 200;
/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
export const otpChecksPerIpHourPhoneCodeOnly: number = 600;
/** Story: Prove ownership of my phone / Verification codes expire and have a limited number of attempts (spec/otpLimits.md) */
export const otpLifetimeMs: number = exact_otpLimits(exact_otpLimits(10 * 60) * 1000);
/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
export const initial: ChallengeFlow = { phase: "Beginning", reason: "NoReason" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: ChallengeFlow): boolean {
  return true;
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function canRequestCode(flow: ChallengeFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function requestCode(flow: ChallengeFlow): ChallengeFlow {
  //@ ensures (inv(flow) && canRequestCode(flow)) ==> stepVerificationRequiresConsume(flow, "requestCode", \result)
  return { ...flow, phase: "SendAddress" };
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function canReadSendAddress(flow: ChallengeFlow): boolean {
  return flow.phase === "SendAddress";
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function readSendAddress(flow: ChallengeFlow, allowed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canReadSendAddress(flow)) ==> stepVerificationRequiresConsume(flow, "readSendAddress", \result)
  return allowed ? ({ ...flow, phase: "SendPhoneHour" } as ChallengeFlow) : ({ phase: "Refused", reason: "LimitedHour" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function canReadSendPhoneHour(flow: ChallengeFlow): boolean {
  return flow.phase === "SendPhoneHour";
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function readSendPhoneHour(flow: ChallengeFlow, allowed: boolean, gapLeft: number): ChallengeFlow {
  //@ ensures (inv(flow) && canReadSendPhoneHour(flow)) ==> stepVerificationRequiresConsume(flow, "readSendPhoneHour", \result)
  return allowed ? ({ ...flow, phase: "SendPhoneDay" } as ChallengeFlow) : ({ phase: "Refused", reason: gapLeft > 0 ? "LimitedGap" : "LimitedHour" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function canReadSendPhoneDay(flow: ChallengeFlow): boolean {
  return flow.phase === "SendPhoneDay";
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function readSendPhoneDay(flow: ChallengeFlow, allowed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canReadSendPhoneDay(flow)) ==> stepVerificationRequiresConsume(flow, "readSendPhoneDay", \result)
  return allowed ? ({ ...flow, phase: "SendGlobal" } as ChallengeFlow) : ({ phase: "Refused", reason: "LimitedDay" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function canReadSendGlobal(flow: ChallengeFlow): boolean {
  return flow.phase === "SendGlobal";
}

/** Story: Prove ownership of my phone / Code sends have limits shared across apps (spec/otpLimits.md) */
//@ pure
export function readSendGlobal(flow: ChallengeFlow, allowed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canReadSendGlobal(flow)) ==> stepVerificationRequiresConsume(flow, "readSendGlobal", \result)
  return allowed ? ({ ...flow, phase: "Sending" } as ChallengeFlow) : ({ phase: "Refused", reason: "LimitedGlobal" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Start keeps its public response private (spec/otpLimits.md) */
//@ pure
export function canRecordSend(flow: ChallengeFlow): boolean {
  return flow.phase === "Sending";
}

/** Story: Prove ownership of my phone / Start keeps its public response private (spec/otpLimits.md) */
//@ pure
export function recordSend(flow: ChallengeFlow, providerAccepted: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canRecordSend(flow)) ==> stepVerificationRequiresConsume(flow, "recordSend", \result)
  return { ...flow, phase: providerAccepted ? "RecordingChallenge" : "StartComplete" };
}

/** Story: Prove ownership of my phone / Start keeps its public response private (spec/otpLimits.md) */
//@ pure
export function canFinishStart(flow: ChallengeFlow): boolean {
  return flow.phase === "RecordingChallenge";
}

/** Story: Prove ownership of my phone / Start keeps its public response private (spec/otpLimits.md) */
//@ pure
export function finishStart(flow: ChallengeFlow): ChallengeFlow {
  //@ ensures (inv(flow) && canFinishStart(flow)) ==> stepVerificationRequiresConsume(flow, "finishStart", \result)
  return { ...flow, phase: "StartComplete" };
}

/** Story: Prove ownership of my phone / Start keeps its public response private (spec/otpLimits.md) */
//@ pure
export function sometimesStarts(flow: ChallengeFlow): boolean {
  return flow.phase === "StartComplete";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canBeginVerification(flow: ChallengeFlow): boolean {
  return flow.phase === "Beginning";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function beginVerification(flow: ChallengeFlow, codeWellFormed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canBeginVerification(flow)) ==> stepVerificationRequiresConsume(flow, "beginVerification", \result)
  return codeWellFormed ? ({ ...flow, phase: "CheckAddress" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canReadCheckAddress(flow: ChallengeFlow): boolean {
  return flow.phase === "CheckAddress";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function readCheckAddress(flow: ChallengeFlow, allowed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canReadCheckAddress(flow)) ==> stepVerificationRequiresConsume(flow, "readCheckAddress", \result)
  return allowed ? ({ ...flow, phase: "CheckPhone" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canReadCheckPhone(flow: ChallengeFlow): boolean {
  return flow.phase === "CheckPhone";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function readCheckPhone(flow: ChallengeFlow, allowed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canReadCheckPhone(flow)) ==> stepVerificationRequiresConsume(flow, "readCheckPhone", \result)
  return allowed ? ({ ...flow, phase: "ReadingChallenge" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canReadChallenge(flow: ChallengeFlow): boolean {
  return flow.phase === "ReadingChallenge";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function readChallenge(flow: ChallengeFlow, matchingProvider: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canReadChallenge(flow)) ==> stepVerificationRequiresConsume(flow, "readChallenge", \result)
  return matchingProvider ? ({ ...flow, phase: "ClaimingAttempt" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canClaimAttempt(flow: ChallengeFlow): boolean {
  return flow.phase === "ClaimingAttempt";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function claimAttempt(flow: ChallengeFlow, claimed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canClaimAttempt(flow)) ==> stepVerificationRequiresConsume(flow, "claimAttempt", \result)
  return claimed ? ({ ...flow, phase: "CheckingCode" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canCheckCode(flow: ChallengeFlow): boolean {
  return flow.phase === "CheckingCode";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function checkCode(flow: ChallengeFlow, correct: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canCheckCode(flow)) ==> stepVerificationRequiresConsume(flow, "checkCode", \result)
  return correct ? ({ ...flow, phase: "ConsumingChallenge" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function canConsumeChallenge(flow: ChallengeFlow): boolean {
  return flow.phase === "ConsumingChallenge";
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function consumeChallenge(flow: ChallengeFlow, consumed: boolean): ChallengeFlow {
  //@ ensures (inv(flow) && canConsumeChallenge(flow)) ==> stepVerificationRequiresConsume(flow, "consumeChallenge", \result)
  return consumed ? ({ ...flow, phase: "Verified" } as ChallengeFlow) : ({ phase: "Refused", reason: "VerificationFailed" } as ChallengeFlow);
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function stepVerificationRequiresConsume(before: ChallengeFlow, via: string, after: ChallengeFlow): boolean {
  return !(after.phase === "Verified") || (before.phase === "ConsumingChallenge" && via === "consumeChallenge");
}

/** Story: Prove ownership of my phone / Verification needs a claimed attempt, the right code, and a successful consume (spec/otpLimits.md) */
//@ pure
export function sometimesVerifies(flow: ChallengeFlow): boolean {
  return flow.phase === "Verified";
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function otpOnlyAppAllowed(appId: string): boolean {
  return appId === "ntwrk" || appId === "slop" || appId === "friends";
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function otpOnlyPolicyAccepted(everyNamedAppAllowed: boolean, namesDistinct: boolean, anyNamed: boolean, blooioSender: boolean): boolean {
  return everyNamedAppAllowed && namesDistinct && (!anyNamed || blooioSender);
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function otpStartNeedsBrowserCheck(appNamed: boolean, checkConfigured: boolean): boolean {
  return checkConfigured && !appNamed;
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function otpAddressLimit(appNamed: boolean, standardLimit: number, phoneCodeOnlyLimit: number): number {
  return appNamed ? phoneCodeOnlyLimit : standardLimit;
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function lawUnnamedAppKeepsBrowserCheck(checkConfigured: boolean): boolean {
  //@ ensures \result === true
  return otpStartNeedsBrowserCheck(false, checkConfigured) === checkConfigured;
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function lawNamedAppNeedsBlooio(everyNamedAppAllowed: boolean, namesDistinct: boolean): boolean {
  //@ ensures \result === true
  return !otpOnlyPolicyAccepted(everyNamedAppAllowed, namesDistinct, true, false);
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function lawUnnamedAppKeepsStandardAddressLimit(standardLimit: number, phoneCodeOnlyLimit: number): boolean {
  //@ ensures \result === true
  return otpAddressLimit(false, standardLimit, phoneCodeOnlyLimit) === standardLimit;
}

/** Story: Prove ownership of my phone / A phone-code-only app skips the browser check only on the Blooio sender, keeps every per-person limit, and has its own coarse address ceiling (spec/otpLimits.md) */
//@ pure
export function lawNamedAppUsesCoarseAddressCeiling(standardLimit: number, phoneCodeOnlyLimit: number): boolean {
  //@ ensures \result === true
  return otpAddressLimit(true, standardLimit, phoneCodeOnlyLimit) === phoneCodeOnlyLimit;
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: ChallengeFlow, event: Event): boolean {
  if (event.type === "requestCode") return canRequestCode(current);
  if (event.type === "readSendAddress") return canReadSendAddress(current);
  if (event.type === "readSendPhoneHour") return canReadSendPhoneHour(current);
  if (event.type === "readSendPhoneDay") return canReadSendPhoneDay(current);
  if (event.type === "readSendGlobal") return canReadSendGlobal(current);
  if (event.type === "recordSend") return canRecordSend(current);
  if (event.type === "finishStart") return canFinishStart(current);
  if (event.type === "beginVerification") return canBeginVerification(current);
  if (event.type === "readCheckAddress") return canReadCheckAddress(current);
  if (event.type === "readCheckPhone") return canReadCheckPhone(current);
  if (event.type === "readChallenge") return canReadChallenge(current);
  if (event.type === "claimAttempt") return canClaimAttempt(current);
  if (event.type === "checkCode") return canCheckCode(current);
  if (event.type === "consumeChallenge") return canConsumeChallenge(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: ChallengeFlow, event: Event): ChallengeFlow {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "requestCode") return canRequestCode(current) ? requestCode(current) : current;
  if (event.type === "readSendAddress") return canReadSendAddress(current) ? readSendAddress(current, event.allowed) : current;
  if (event.type === "readSendPhoneHour") return canReadSendPhoneHour(current) ? readSendPhoneHour(current, event.allowed, event.gapLeft) : current;
  if (event.type === "readSendPhoneDay") return canReadSendPhoneDay(current) ? readSendPhoneDay(current, event.allowed) : current;
  if (event.type === "readSendGlobal") return canReadSendGlobal(current) ? readSendGlobal(current, event.allowed) : current;
  if (event.type === "recordSend") return canRecordSend(current) ? recordSend(current, event.providerAccepted) : current;
  if (event.type === "finishStart") return canFinishStart(current) ? finishStart(current) : current;
  if (event.type === "beginVerification") return canBeginVerification(current) ? beginVerification(current, event.codeWellFormed) : current;
  if (event.type === "readCheckAddress") return canReadCheckAddress(current) ? readCheckAddress(current, event.allowed) : current;
  if (event.type === "readCheckPhone") return canReadCheckPhone(current) ? readCheckPhone(current, event.allowed) : current;
  if (event.type === "readChallenge") return canReadChallenge(current) ? readChallenge(current, event.matchingProvider) : current;
  if (event.type === "claimAttempt") return canClaimAttempt(current) ? claimAttempt(current, event.claimed) : current;
  if (event.type === "checkCode") return canCheckCode(current) ? checkCode(current, event.correct) : current;
  if (event.type === "consumeChallenge") return canConsumeChallenge(current) ? consumeChallenge(current, event.consumed) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "requestCode") return { type: "requestCode" };
  if (raw.type === "readSendAddress" && typeof raw.allowed === "boolean") return { type: "readSendAddress", allowed: raw.allowed };
  if (raw.type === "readSendPhoneHour" && typeof raw.allowed === "boolean" && Number.isSafeInteger(raw.gapLeft)) return { type: "readSendPhoneHour", allowed: raw.allowed, gapLeft: raw.gapLeft };
  if (raw.type === "readSendPhoneDay" && typeof raw.allowed === "boolean") return { type: "readSendPhoneDay", allowed: raw.allowed };
  if (raw.type === "readSendGlobal" && typeof raw.allowed === "boolean") return { type: "readSendGlobal", allowed: raw.allowed };
  if (raw.type === "recordSend" && typeof raw.providerAccepted === "boolean") return { type: "recordSend", providerAccepted: raw.providerAccepted };
  if (raw.type === "finishStart") return { type: "finishStart" };
  if (raw.type === "beginVerification" && typeof raw.codeWellFormed === "boolean") return { type: "beginVerification", codeWellFormed: raw.codeWellFormed };
  if (raw.type === "readCheckAddress" && typeof raw.allowed === "boolean") return { type: "readCheckAddress", allowed: raw.allowed };
  if (raw.type === "readCheckPhone" && typeof raw.allowed === "boolean") return { type: "readCheckPhone", allowed: raw.allowed };
  if (raw.type === "readChallenge" && typeof raw.matchingProvider === "boolean") return { type: "readChallenge", matchingProvider: raw.matchingProvider };
  if (raw.type === "claimAttempt" && typeof raw.claimed === "boolean") return { type: "claimAttempt", claimed: raw.claimed };
  if (raw.type === "checkCode" && typeof raw.correct === "boolean") return { type: "checkCode", correct: raw.correct };
  if (raw.type === "consumeChallenge" && typeof raw.consumed === "boolean") return { type: "consumeChallenge", consumed: raw.consumed };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): ChallengeFlow | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "Beginning" || raw.phase === "SendAddress" || raw.phase === "SendPhoneHour" || raw.phase === "SendPhoneDay" || raw.phase === "SendGlobal" || raw.phase === "Sending" || raw.phase === "RecordingChallenge" || raw.phase === "StartComplete" || raw.phase === "CheckAddress" || raw.phase === "CheckPhone" || raw.phase === "ReadingChallenge" || raw.phase === "ClaimingAttempt" || raw.phase === "CheckingCode" || raw.phase === "ConsumingChallenge" || raw.phase === "Verified" || raw.phase === "Refused") && (raw.reason === "NoReason" || raw.reason === "LimitedHour" || raw.reason === "LimitedGap" || raw.reason === "LimitedDay" || raw.reason === "LimitedGlobal" || raw.reason === "VerificationFailed") && Object.keys(raw).length === 2)) return undefined;
  const parsed: ChallengeFlow = ({ phase: raw.phase, reason: raw.reason });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): ChallengeFlow {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_otpLimits(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
