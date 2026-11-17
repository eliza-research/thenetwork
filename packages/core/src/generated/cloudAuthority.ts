// GENERATED from spec/cloudAuthority.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
export type CheckPhase = "AwaitingProof" | "AwaitingDelegation" | "AwaitingGrantOwner" | "AwaitingCloud" | "AuthorityValid" | "AuthorityInvalid" | "AuthorityUnavailable";
/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
export interface AuthorityCheck { phase: CheckPhase; fromCache: boolean }
/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
export type CloudResponse = "CloudAccepted" | "CloudDenied" | "CloudUnavailable";

/** One variant per transition in the spec. */
export type Event =
  | { type: "checkSiteProof"; bindingValid: boolean; proofLive: boolean; productionCloud: boolean; cacheLive: boolean }
  | { type: "useLocalSession"; cloudToken: boolean }
  | { type: "finishCloudCheck"; answer: CloudResponse; proofLive: boolean }
  | { type: "checkGrantEnvelope"; envelopeValid: boolean }
  | { type: "checkGrantDelegation"; delegationBound: boolean }
  | { type: "checkGrantOwner"; phoneEligible: boolean };

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
export const initial: AuthorityCheck = { phase: "AwaitingProof", fromCache: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: AuthorityCheck): boolean {
  return alwaysOnlyValidChecksUseCache(current);
}

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
//@ pure
export function localSessionAllowed(cloudToken: boolean): boolean {
  return !cloudToken;
}

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
//@ pure
export function checkSiteProof(check: AuthorityCheck, bindingValid: boolean, proofLive: boolean, productionCloud: boolean, cacheLive: boolean): AuthorityCheck {
  //@ ensures (inv(check) && canCheckSiteProof(check)) ==> alwaysOnlyValidChecksUseCache(\result)
  //@ ensures (inv(check) && canCheckSiteProof(check)) ==> stepOnlyAnAuthorityResultFinishes(check, "checkSiteProof", \result)
  return !bindingValid || !proofLive ? ({ ...check, phase: "AuthorityInvalid" } as AuthorityCheck) : (!productionCloud && cacheLive ? ({ phase: "AuthorityValid", fromCache: true } as AuthorityCheck) : ({ ...check, phase: "AwaitingCloud" } as AuthorityCheck));
}

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
//@ pure
export function alwaysOnlyValidChecksUseCache(check: AuthorityCheck): boolean {
  return !check.fromCache || check.phase === "AuthorityValid";
}

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
//@ pure
export function canUseLocalSession(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingProof";
}

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
//@ pure
export function useLocalSession(check: AuthorityCheck, cloudToken: boolean): AuthorityCheck {
  //@ ensures (inv(check) && canUseLocalSession(check)) ==> alwaysOnlyValidChecksUseCache(\result)
  //@ ensures (inv(check) && canUseLocalSession(check)) ==> stepOnlyAnAuthorityResultFinishes(check, "useLocalSession", \result)
  return { ...check, phase: localSessionAllowed(cloudToken) ? "AuthorityValid" : "AuthorityInvalid" };
}

/** Story: Keep site access tied to current Cloud authority / The app's authority and proof choose how a site session is checked (spec/cloudAuthority.md) */
//@ pure
export function canCheckSiteProof(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingProof";
}

/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
//@ pure
export function canFinishCloudCheck(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingCloud";
}

/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
//@ pure
export function finishCloudCheck(check: AuthorityCheck, answer: CloudResponse, proofLive: boolean): AuthorityCheck {
  //@ ensures (inv(check) && canFinishCloudCheck(check)) ==> alwaysOnlyValidChecksUseCache(\result)
  //@ ensures (inv(check) && canFinishCloudCheck(check)) ==> stepOnlyAnAuthorityResultFinishes(check, "finishCloudCheck", \result)
  return { ...check, phase: !proofLive || answer === "CloudDenied" ? "AuthorityInvalid" : (answer === "CloudAccepted" ? "AuthorityValid" : "AuthorityUnavailable") };
}

/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
//@ pure
export function stepOnlyAnAuthorityResultFinishes(before: AuthorityCheck, via: string, after: AuthorityCheck): boolean {
  return !(before.phase === "AwaitingCloud" && after.phase !== "AwaitingCloud") || via === "finishCloudCheck";
}

/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
//@ pure
export function sometimesChecksCloud(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingCloud";
}

/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
//@ pure
export function sometimesAcceptsAuthority(check: AuthorityCheck): boolean {
  return check.phase === "AuthorityValid";
}

/** Story: Keep site access tied to current Cloud authority / Only a positive live Cloud response updates the cache (spec/cloudAuthority.md) */
//@ pure
export function sometimesCloudIsUnavailable(check: AuthorityCheck): boolean {
  return check.phase === "AuthorityUnavailable";
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function grantResourceMatches(productionCloud: boolean, resource: string, standardMcp: string, openAiMcp: string): boolean {
  return productionCloud && (resource === standardMcp || resource === openAiMcp);
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function grantExpiresAt(sessionExpiry: number, identityExpiry: number): number {
  return sessionExpiry <= identityExpiry ? sessionExpiry : identityExpiry;
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function canCheckGrantEnvelope(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingProof";
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function checkGrantEnvelope(check: AuthorityCheck, envelopeValid: boolean): AuthorityCheck {
  //@ ensures (inv(check) && canCheckGrantEnvelope(check)) ==> alwaysOnlyValidChecksUseCache(\result)
  //@ ensures (inv(check) && canCheckGrantEnvelope(check)) ==> stepOnlyAnAuthorityResultFinishes(check, "checkGrantEnvelope", \result)
  return { ...check, phase: envelopeValid ? "AwaitingDelegation" : "AuthorityInvalid" };
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function canCheckGrantDelegation(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingDelegation";
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function checkGrantDelegation(check: AuthorityCheck, delegationBound: boolean): AuthorityCheck {
  //@ ensures (inv(check) && canCheckGrantDelegation(check)) ==> alwaysOnlyValidChecksUseCache(\result)
  //@ ensures (inv(check) && canCheckGrantDelegation(check)) ==> stepOnlyAnAuthorityResultFinishes(check, "checkGrantDelegation", \result)
  return { ...check, phase: delegationBound ? "AwaitingGrantOwner" : "AuthorityInvalid" };
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function canCheckGrantOwner(check: AuthorityCheck): boolean {
  return check.phase === "AwaitingGrantOwner";
}

/** Story: Use a grant only for its bound identity / Grant validation checks envelope and owner before asking Cloud (spec/cloudAuthority.md) */
//@ pure
export function checkGrantOwner(check: AuthorityCheck, phoneEligible: boolean): AuthorityCheck {
  //@ ensures (inv(check) && canCheckGrantOwner(check)) ==> alwaysOnlyValidChecksUseCache(\result)
  //@ ensures (inv(check) && canCheckGrantOwner(check)) ==> stepOnlyAnAuthorityResultFinishes(check, "checkGrantOwner", \result)
  return { ...check, phase: phoneEligible ? "AwaitingCloud" : "AuthorityInvalid" };
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: AuthorityCheck, event: Event): boolean {
  if (event.type === "checkSiteProof") return canCheckSiteProof(current);
  if (event.type === "useLocalSession") return canUseLocalSession(current);
  if (event.type === "finishCloudCheck") return canFinishCloudCheck(current);
  if (event.type === "checkGrantEnvelope") return canCheckGrantEnvelope(current);
  if (event.type === "checkGrantDelegation") return canCheckGrantDelegation(current);
  if (event.type === "checkGrantOwner") return canCheckGrantOwner(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: AuthorityCheck, event: Event): AuthorityCheck {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "checkSiteProof") return canCheckSiteProof(current) ? checkSiteProof(current, event.bindingValid, event.proofLive, event.productionCloud, event.cacheLive) : current;
  if (event.type === "useLocalSession") return canUseLocalSession(current) ? useLocalSession(current, event.cloudToken) : current;
  if (event.type === "finishCloudCheck") return canFinishCloudCheck(current) ? finishCloudCheck(current, event.answer, event.proofLive) : current;
  if (event.type === "checkGrantEnvelope") return canCheckGrantEnvelope(current) ? checkGrantEnvelope(current, event.envelopeValid) : current;
  if (event.type === "checkGrantDelegation") return canCheckGrantDelegation(current) ? checkGrantDelegation(current, event.delegationBound) : current;
  if (event.type === "checkGrantOwner") return canCheckGrantOwner(current) ? checkGrantOwner(current, event.phoneEligible) : current;
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
  if (raw.type === "checkSiteProof" && typeof raw.bindingValid === "boolean" && typeof raw.proofLive === "boolean" && typeof raw.productionCloud === "boolean" && typeof raw.cacheLive === "boolean") return { type: "checkSiteProof", bindingValid: raw.bindingValid, proofLive: raw.proofLive, productionCloud: raw.productionCloud, cacheLive: raw.cacheLive };
  if (raw.type === "useLocalSession" && typeof raw.cloudToken === "boolean") return { type: "useLocalSession", cloudToken: raw.cloudToken };
  if (raw.type === "finishCloudCheck" && (raw.answer === "CloudAccepted" || raw.answer === "CloudDenied" || raw.answer === "CloudUnavailable") && typeof raw.proofLive === "boolean") return { type: "finishCloudCheck", answer: raw.answer, proofLive: raw.proofLive };
  if (raw.type === "checkGrantEnvelope" && typeof raw.envelopeValid === "boolean") return { type: "checkGrantEnvelope", envelopeValid: raw.envelopeValid };
  if (raw.type === "checkGrantDelegation" && typeof raw.delegationBound === "boolean") return { type: "checkGrantDelegation", delegationBound: raw.delegationBound };
  if (raw.type === "checkGrantOwner" && typeof raw.phoneEligible === "boolean") return { type: "checkGrantOwner", phoneEligible: raw.phoneEligible };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): AuthorityCheck | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "AwaitingProof" || raw.phase === "AwaitingDelegation" || raw.phase === "AwaitingGrantOwner" || raw.phase === "AwaitingCloud" || raw.phase === "AuthorityValid" || raw.phase === "AuthorityInvalid" || raw.phase === "AuthorityUnavailable") && typeof raw.fromCache === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: AuthorityCheck = ({ phase: raw.phase, fromCache: raw.fromCache });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): AuthorityCheck {
  //@ ensures inv(\result)
  return initial;
}
