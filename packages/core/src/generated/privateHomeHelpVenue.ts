// GENERATED from spec/privateHomeHelpVenue.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Control who can read my home-help address / A current participant can open the private address step (spec/privateHomeHelpVenue.md) */
export type HomeHelpVenueStatus = "VenueUnavailable" | "VenueRequesterEmpty" | "VenueRequesterSaved" | "VenueHelperSaved";
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

/** Story: Control who can read my home-help address / A current participant can open the private address step (spec/privateHomeHelpVenue.md) */
//@ pure
export function homeHelpVenueLinkAllowed(signedDirect: boolean, status: HomeHelpVenueStatus): boolean {
  return signedDirect && status !== "VenueUnavailable";
}

/** Story: Control who can read my home-help address / A current participant can open the private address step (spec/privateHomeHelpVenue.md) */
//@ pure
export function currentHomeHelpVenueStatus(owner: boolean, helper: boolean, unanimous: boolean, saved: boolean, revoked: boolean, now: number, expiresAt: number): HomeHelpVenueStatus {
  return revoked ? "VenueUnavailable" : (mayStoreHomeHelpVenue(owner, unanimous, now, expiresAt) ? (saved ? "VenueRequesterSaved" : "VenueRequesterEmpty") : (saved && mayReadHomeHelpVenue(helper, unanimous, now, expiresAt) ? "VenueHelperSaved" : "VenueUnavailable"));
}

/** Story: Control who can read my home-help address / A current participant can open the private address step (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpVenueLinkRequiresDirectTurn(status: HomeHelpVenueStatus): boolean {
  //@ ensures \result === true
  return !homeHelpVenueLinkAllowed(false, status) && !homeHelpVenueLinkAllowed(true, "VenueUnavailable");
}

/** Story: Control who can read my home-help address / A current participant can open the private address step (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpVenueStatusRequiresCurrentParticipant(owner: boolean, helper: boolean, unanimous: boolean, saved: boolean, revoked: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !(currentHomeHelpVenueStatus(owner, helper, unanimous, saved, revoked, now, expiresAt) !== "VenueUnavailable") || (unanimous && (owner || helper) && !revoked && homeHelpVenueLive(now, expiresAt));
}

/** Story: Control who can read my home-help address / A current participant can open the private address step (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpHelperStatusRequiresSavedAddress(owner: boolean, helper: boolean, unanimous: boolean, revoked: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return currentHomeHelpVenueStatus(owner, helper, unanimous, false, revoked, now, expiresAt) !== "VenueHelperSaved";
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
export function homeHelpAddressStep(requester: boolean, helper: boolean, unanimousCurrentConsent: boolean, addressStored: boolean, addressRevoked: boolean, now: number, expiresAt: number): HomeHelpAddressStep {
  return requester && mayStoreHomeHelpVenue(true, unanimousCurrentConsent, now, expiresAt) ? (addressStored ? "RequesterAddressSaved" : (addressRevoked ? "AddressStepClosed" : "RequesterAddsAddress")) : (helper && addressStored && mayReadHomeHelpVenue(true, unanimousCurrentConsent, now, expiresAt) ? "HelperReadsAddress" : "AddressStepClosed");
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpAddressStepNeedsConsent(requester: boolean, helper: boolean, addressStored: boolean, addressRevoked: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(requester, helper, false, addressStored, addressRevoked, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHomeHelpAddressStepNeedsParticipant(unanimousCurrentConsent: boolean, addressStored: boolean, addressRevoked: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(false, false, unanimousCurrentConsent, addressStored, addressRevoked, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawHelperWaitsForStoredAddress(unanimousCurrentConsent: boolean, addressRevoked: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(false, true, unanimousCurrentConsent, false, addressRevoked, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawRevokedAddressClosesTheRequesterStep(helper: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(true, helper, unanimousCurrentConsent, false, true, now, expiresAt) === "AddressStepClosed";
}

/** Story: Control who can read my home-help address / The conversation points each participant to the private page (spec/privateHomeHelpVenue.md) */
//@ pure
export function lawExpiredHomeHelpAddressStepIsClosed(requester: boolean, helper: boolean, unanimousCurrentConsent: boolean, addressStored: boolean, addressRevoked: boolean, expiresAt: number): boolean {
  //@ ensures \result === true
  return homeHelpAddressStep(requester, helper, unanimousCurrentConsent, addressStored, addressRevoked, expiresAt, expiresAt) === "AddressStepClosed";
}
