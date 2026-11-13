// GENERATED from spec/oauthGrantIssuance.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export type AuthorityResult = "AuthorityValid" | "AuthorityInvalid" | "AuthorityUnavailable";
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export type IssuancePhase = "StartApproval" | "AwaitingAuthority" | "RetryAuthority" | "DeniedAuthority" | "ExpiredApproval" | "AwaitingConsumption" | "AwaitingPersistence" | "GrantIssued";
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export interface Issuance { phase: IssuancePhase; authorityAccepted: boolean; sameOwner: boolean; requestLive: boolean; grantLive: boolean }
/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export interface ConsumedApproval { ownerMatches: boolean; consumedRequestLive: boolean; pendingGrantLive: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginApproval"; requestLive: boolean }
  | { type: "checkGrantAuthority"; authority: AuthorityResult }
  | { type: "checkConsumption"; consumption: ConsumedApproval }
  | { type: "recordIssuance" };

/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
export const validConsumption: ConsumedApproval = { ownerMatches: true, consumedRequestLive: true, pendingGrantLive: true };
/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
export const initial: Issuance = { phase: "StartApproval", authorityAccepted: false, sameOwner: false, requestLive: false, grantLive: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Issuance): boolean {
  return alwaysIssuanceRequiresCurrentApproval(current);
}

/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function requestIsLive(asOf: number, expiresAt: number): boolean {
  return asOf < expiresAt;
}

/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function beginApproval(issuance: Issuance, requestLive: boolean): Issuance {
  //@ ensures (inv(issuance) && canBeginApproval(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
  return { ...issuance, phase: requestLive ? "AwaitingAuthority" : "ExpiredApproval", requestLive: requestLive };
}

/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function lawDeadlineExcludesExpiry(expiresAt: number): boolean {
  //@ ensures \result === true
  return !requestIsLive(expiresAt, expiresAt);
}

/** Story: Connect my agent after I approve access / An expired request cannot begin issuance (spec/oauthGrantIssuance.md:9) */
//@ pure
export function canBeginApproval(issuance: Issuance): boolean {
  return issuance.phase === "StartApproval";
}

/** Story: Connect my agent after I approve access / Authority is checked before the consent request is consumed (spec/oauthGrantIssuance.md:32) */
//@ pure
export function canCheckGrantAuthority(issuance: Issuance): boolean {
  return issuance.phase === "AwaitingAuthority" && issuance.requestLive;
}

/** Story: Connect my agent after I approve access / Authority is checked before the consent request is consumed (spec/oauthGrantIssuance.md:32) */
//@ pure
export function checkGrantAuthority(issuance: Issuance, authority: AuthorityResult): Issuance {
  //@ ensures (inv(issuance) && canCheckGrantAuthority(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
  return { ...issuance, authorityAccepted: authority === "AuthorityValid", phase: authority === "AuthorityValid" ? "AwaitingConsumption" : (authority === "AuthorityUnavailable" ? "RetryAuthority" : "DeniedAuthority") };
}

/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
//@ pure
export function canCheckConsumption(issuance: Issuance): boolean {
  return issuance.phase === "AwaitingConsumption" && issuance.authorityAccepted && issuance.requestLive;
}

/** Story: Connect my agent after I approve access / Consumed approval must still match the owner and both deadlines (spec/oauthGrantIssuance.md:47) */
//@ pure
export function checkConsumption(issuance: Issuance, consumption: ConsumedApproval): Issuance {
  //@ ensures (inv(issuance) && canCheckConsumption(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
  const eligible: boolean = consumption.ownerMatches && consumption.consumedRequestLive && consumption.pendingGrantLive;
  return { ...issuance, sameOwner: consumption.ownerMatches, requestLive: consumption.consumedRequestLive, grantLive: consumption.pendingGrantLive, phase: eligible ? "AwaitingPersistence" : "ExpiredApproval" };
}

/** Story: Connect my agent after I approve access / A successful response follows grant and code persistence (spec/oauthGrantIssuance.md:68) */
//@ pure
export function canRecordIssuance(issuance: Issuance): boolean {
  return issuance.phase === "AwaitingPersistence" && issuance.authorityAccepted && issuance.sameOwner && issuance.requestLive && issuance.grantLive;
}

/** Story: Connect my agent after I approve access / A successful response follows grant and code persistence (spec/oauthGrantIssuance.md:68) */
//@ pure
export function recordIssuance(issuance: Issuance): Issuance {
  //@ ensures (inv(issuance) && canRecordIssuance(issuance)) ==> alwaysIssuanceRequiresCurrentApproval(\result)
  return { ...issuance, phase: "GrantIssued" };
}

/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:80) */
//@ pure
export function alwaysIssuanceRequiresCurrentApproval(issuance: Issuance): boolean {
  return !(issuance.phase === "AwaitingPersistence" || issuance.phase === "GrantIssued") || (issuance.authorityAccepted && issuance.sameOwner && issuance.requestLive && issuance.grantLive);
}

/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:80) */
//@ pure
export function sometimesIssuesGrant(issuance: Issuance): boolean {
  return issuance.phase === "GrantIssued";
}

/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:80) */
//@ pure
export function sometimesRetriesAuthority(issuance: Issuance): boolean {
  return issuance.phase === "RetryAuthority";
}

/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:80) */
//@ pure
export function sometimesDeniesAuthority(issuance: Issuance): boolean {
  return issuance.phase === "DeniedAuthority";
}

/** Story: Connect my agent after I approve access / An issued grant had current authority, owner and deadlines (spec/oauthGrantIssuance.md:80) */
//@ pure
export function sometimesExpiresApproval(issuance: Issuance): boolean {
  return issuance.phase === "ExpiredApproval";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Issuance, event: Event): boolean {
  if (event.type === "beginApproval") return canBeginApproval(current);
  if (event.type === "checkGrantAuthority") return canCheckGrantAuthority(current);
  if (event.type === "checkConsumption") return canCheckConsumption(current);
  if (event.type === "recordIssuance") return canRecordIssuance(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Issuance, event: Event): Issuance {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginApproval" && canBeginApproval(current)) return beginApproval(current, event.requestLive);
  if (event.type === "checkGrantAuthority" && canCheckGrantAuthority(current)) return checkGrantAuthority(current, event.authority);
  if (event.type === "checkConsumption" && canCheckConsumption(current)) return checkConsumption(current, event.consumption);
  if (event.type === "recordIssuance" && canRecordIssuance(current)) return recordIssuance(current);
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
  if (raw.type === "beginApproval" && typeof raw.requestLive === "boolean") return { type: "beginApproval", requestLive: raw.requestLive };
  if (raw.type === "checkGrantAuthority" && (raw.authority === "AuthorityValid" || raw.authority === "AuthorityInvalid" || raw.authority === "AuthorityUnavailable")) return { type: "checkGrantAuthority", authority: raw.authority };
  if (raw.type === "checkConsumption" && typeof raw.consumption === "object" && raw.consumption !== null && !Array.isArray(raw.consumption) && typeof raw.consumption.ownerMatches === "boolean" && typeof raw.consumption.consumedRequestLive === "boolean" && typeof raw.consumption.pendingGrantLive === "boolean") return { type: "checkConsumption", consumption: ({ ownerMatches: raw.consumption.ownerMatches, consumedRequestLive: raw.consumption.consumedRequestLive, pendingGrantLive: raw.consumption.pendingGrantLive }) };
  if (raw.type === "recordIssuance") return { type: "recordIssuance" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Issuance | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "StartApproval" || raw.phase === "AwaitingAuthority" || raw.phase === "RetryAuthority" || raw.phase === "DeniedAuthority" || raw.phase === "ExpiredApproval" || raw.phase === "AwaitingConsumption" || raw.phase === "AwaitingPersistence" || raw.phase === "GrantIssued") && typeof raw.authorityAccepted === "boolean" && typeof raw.sameOwner === "boolean" && typeof raw.requestLive === "boolean" && typeof raw.grantLive === "boolean" && Object.keys(raw).length === 5)) return undefined;
  const parsed: Issuance = ({ phase: raw.phase, authorityAccepted: raw.authorityAccepted, sameOwner: raw.sameOwner, requestLive: raw.requestLive, grantLive: raw.grantLive });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Issuance {
  //@ ensures inv(\result)
  return initial;
}
