// GENERATED from spec/privateHomeHelpVenue.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
export type HomeHelpAddressStep = "AddressStepClosed" | "RequesterAddsAddress" | "RequesterAddressSaved" | "HelperReadsAddress";


/** Story: Control who can read my home-help address / The requester supplies one address after everyone accepts this revision (spec/privateHomeHelpVenue.md) */
//@ pure
export function homeHelpVenueLive(now: number, expiresAt: number): boolean {
  return now < expiresAt;
}

/** Story: Control who can read my home-help address / The requester supplies one address after everyone accepts this revision (spec/privateHomeHelpVenue.md) */
//@ pure
export function mayStoreHomeHelpVenue(owner: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  return owner && unanimousCurrentConsent && homeHelpVenueLive(now, expiresAt);
}

/** Story: Control who can read my home-help address / The requester supplies one address after everyone accepts this revision (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpVenueStorageRequiresOwnerAndConsent(owner: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayStoreHomeHelpVenue(false, unanimousCurrentConsent, now, expiresAt) && !mayStoreHomeHelpVenue(owner, false, now, expiresAt);
}

/** Story: Control who can read my home-help address / A helper reads the address in a directly verified private request (spec/privateHomeHelpVenue.md) */
//@ pure
export function mayReadHomeHelpVenue(helper: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  return helper && unanimousCurrentConsent && homeHelpVenueLive(now, expiresAt);
}

/** Story: Control who can read my home-help address / A helper reads the address in a directly verified private request (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawExpiredHomeHelpVenueIsUnavailable(owner: boolean, helper: boolean, unanimousCurrentConsent: boolean, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayStoreHomeHelpVenue(owner, unanimousCurrentConsent, expiresAt, expiresAt) && !mayReadHomeHelpVenue(helper, unanimousCurrentConsent, expiresAt, expiresAt);
}

/** Story: Control who can read my home-help address / A helper reads the address in a directly verified private request (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpVenueReadRequiresHelperAndConsent(helper: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayReadHomeHelpVenue(false, unanimousCurrentConsent, now, expiresAt) && !mayReadHomeHelpVenue(helper, false, now, expiresAt);
}

/** Story: Control who can read my home-help address / Revocation, plan change and expiry end access (spec/privateHomeHelpVenue.md) */
//@ pure
export function mayRevokeHomeHelpVenue(owner: boolean, currentRevision: boolean, now: number, expiresAt: number): boolean {
  return owner && currentRevision && homeHelpVenueLive(now, expiresAt);
}

/** Story: Control who can read my home-help address / Revocation, plan change and expiry end access (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpVenueRevocationRequiresCurrentOwner(owner: boolean, currentRevision: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayRevokeHomeHelpVenue(false, currentRevision, now, expiresAt) && !mayRevokeHomeHelpVenue(owner, false, now, expiresAt);
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function homeHelpAddressStep(requester: boolean, helper: boolean, unanimousCurrentConsent: boolean, addressStored: boolean, now: number, expiresAt: number): HomeHelpAddressStep {
  return requester && mayStoreHomeHelpVenue(true, unanimousCurrentConsent, now, expiresAt) ? (addressStored ? "RequesterAddressSaved" : "RequesterAddsAddress") : (helper && addressStored && mayReadHomeHelpVenue(true, unanimousCurrentConsent, now, expiresAt) ? "HelperReadsAddress" : "AddressStepClosed");
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpAddressStepNeedsConsent(requester: boolean, helper: boolean, addressStored: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(requester, helper, false, addressStored, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpAddressStepNeedsParticipant(unanimousCurrentConsent: boolean, addressStored: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(false, false, unanimousCurrentConsent, addressStored, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHelperWaitsForStoredAddress(unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(false, true, unanimousCurrentConsent, false, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawExpiredHomeHelpAddressStepIsClosed(requester: boolean, helper: boolean, unanimousCurrentConsent: boolean, addressStored: boolean, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(requester, helper, unanimousCurrentConsent, addressStored, expiresAt, expiresAt) === "AddressStepClosed";
}
