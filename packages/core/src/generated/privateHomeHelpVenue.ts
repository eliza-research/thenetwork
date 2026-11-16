// GENERATED from spec/privateHomeHelpVenue.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny



/** Story: Control who can read my home-help address / The requester supplies one address after everyone accepts this revision (spec/privateHomeHelpVenue.md:11) */
//@ pure
export function homeHelpVenueLive(now: number, expiresAt: number): boolean {
  return now < expiresAt;
}

/** Story: Control who can read my home-help address / The requester supplies one address after everyone accepts this revision (spec/privateHomeHelpVenue.md:11) */
//@ pure
export function mayStoreHomeHelpVenue(owner: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  return owner && unanimousCurrentConsent && homeHelpVenueLive(now, expiresAt);
}

/** Story: Control who can read my home-help address / The requester supplies one address after everyone accepts this revision (spec/privateHomeHelpVenue.md:11) */
//@ pure
export function lawHomeHelpVenueStorageRequiresOwnerAndConsent(owner: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayStoreHomeHelpVenue(owner, unanimousCurrentConsent, now, expiresAt) || (owner && unanimousCurrentConsent);
}

/** Story: Control who can read my home-help address / A helper reads the address in a directly verified private request (spec/privateHomeHelpVenue.md:29) */
//@ pure
export function mayReadHomeHelpVenue(helper: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  return helper && unanimousCurrentConsent && homeHelpVenueLive(now, expiresAt);
}

/** Story: Control who can read my home-help address / A helper reads the address in a directly verified private request (spec/privateHomeHelpVenue.md:29) */
//@ pure
export function lawExpiredHomeHelpVenueIsUnavailable(owner: boolean, helper: boolean, unanimousCurrentConsent: boolean, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayStoreHomeHelpVenue(owner, unanimousCurrentConsent, expiresAt, expiresAt) && !mayReadHomeHelpVenue(helper, unanimousCurrentConsent, expiresAt, expiresAt);
}

/** Story: Control who can read my home-help address / A helper reads the address in a directly verified private request (spec/privateHomeHelpVenue.md:29) */
//@ pure
export function lawHomeHelpVenueReadRequiresHelperAndConsent(helper: boolean, unanimousCurrentConsent: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayReadHomeHelpVenue(helper, unanimousCurrentConsent, now, expiresAt) || (helper && unanimousCurrentConsent);
}

/** Story: Control who can read my home-help address / Revocation, plan change and expiry end access (spec/privateHomeHelpVenue.md:49) */
//@ pure
export function mayRevokeHomeHelpVenue(owner: boolean, currentRevision: boolean, now: number, expiresAt: number): boolean {
  return owner && currentRevision && homeHelpVenueLive(now, expiresAt);
}

/** Story: Control who can read my home-help address / Revocation, plan change and expiry end access (spec/privateHomeHelpVenue.md:49) */
//@ pure
export function lawHomeHelpVenueRevocationRequiresCurrentOwner(owner: boolean, currentRevision: boolean, now: number, expiresAt: number): boolean {
  //@ ensures \result === true
  return !mayRevokeHomeHelpVenue(owner, currentRevision, now, expiresAt) || (owner && currentRevision);
}
