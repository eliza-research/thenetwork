// GENERATED from spec/baseProfileShare.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Reuse my approved basics in a second app / A shared value never replaces what the person told this app (spec/baseProfileShare.md) */
export type BaseProfileField = "BaseFirstName" | "BaseCity" | "BaseInterest";
/** Story: Reuse my approved basics in a second app / A shared value never replaces what the person told this app (spec/baseProfileShare.md) */
export type BaseFieldCopy = "KeepAppValue" | "AddSharedValue" | "NothingToShare";

/** Story: Reuse my approved basics in a second app / An interest is shared only when the member confirmed it and it is not private (spec/baseProfileShare.md) */
export const baseInterestLimit: number = 20;
/** Story: Reuse my approved basics in a second app / An interest is shared only when the member confirmed it and it is not private (spec/baseProfileShare.md) */
export const baseInterestSizeLimit: number = 40;

/** Story: Reuse my approved basics in a second app / A grant is usable only while it is current and both memberships are live (spec/baseProfileShare.md) */
//@ pure
export function baseProfileGrantUsable(granted: boolean, revoked: boolean, sourceLive: boolean, targetLive: boolean, banned: boolean): boolean {
  return granted && !revoked && sourceLive && targetLive && !banned;
}

/** Story: Reuse my approved basics in a second app / A grant is usable only while it is current and both memberships are live (spec/baseProfileShare.md) */
//@ pure
export function lawRevokedGrantIsNotUsable(sourceLive: boolean, targetLive: boolean, banned: boolean): boolean {
  //@ ensures \result === true
  return !baseProfileGrantUsable(true, true, sourceLive, targetLive, banned);
}

/** Story: Reuse my approved basics in a second app / A grant is usable only while it is current and both memberships are live (spec/baseProfileShare.md) */
//@ pure
export function lawBannedPhoneHasNoUsableGrant(granted: boolean, revoked: boolean, sourceLive: boolean, targetLive: boolean): boolean {
  //@ ensures \result === true
  return !baseProfileGrantUsable(granted, revoked, sourceLive, targetLive, true);
}

/** Story: Reuse my approved basics in a second app / UNSHARE revokes every live grant to or from this app (spec/baseProfileShare.md) */
//@ pure
export function unshareRevokesGrant(alreadyRevoked: boolean, readsFromApp: boolean, readsIntoApp: boolean): boolean {
  return !alreadyRevoked && (readsFromApp || readsIntoApp);
}

/** Story: Reuse my approved basics in a second app / UNSHARE revokes every live grant to or from this app (spec/baseProfileShare.md) */
//@ pure
export function lawUnshareRevokesEveryLiveGrantOfTheApp(readsFromApp: boolean, readsIntoApp: boolean): boolean {
  //@ ensures \result === true
  return !(readsFromApp || readsIntoApp) || unshareRevokesGrant(false, readsFromApp, readsIntoApp);
}

/** Story: Reuse my approved basics in a second app / UNSHARE revokes every live grant to or from this app (spec/baseProfileShare.md) */
//@ pure
export function lawUnshareKeepsGrantsBetweenOtherApps(alreadyRevoked: boolean): boolean {
  //@ ensures \result === true
  return !unshareRevokesGrant(alreadyRevoked, false, false);
}

/** Story: Reuse my approved basics in a second app / UNSHARE revokes every live grant to or from this app (spec/baseProfileShare.md) */
//@ pure
export function lawUnshareKeepsTheFirstRevocation(readsFromApp: boolean, readsIntoApp: boolean): boolean {
  //@ ensures \result === true
  return !unshareRevokesGrant(true, readsFromApp, readsIntoApp);
}

/** Story: Reuse my approved basics in a second app / An interest is shared only when the member confirmed it and it is not private (spec/baseProfileShare.md) */
//@ pure
export function baseInterestShareable(interest: boolean, confirmed: boolean, privateScope: boolean, sensitive: boolean, stillValid: boolean, textLength: number): boolean {
  return interest && confirmed && !privateScope && !sensitive && stillValid && textLength > 0 && textLength <= baseInterestSizeLimit;
}

/** Story: Reuse my approved basics in a second app / An interest is shared only when the member confirmed it and it is not private (spec/baseProfileShare.md) */
//@ pure
export function lawPrivateFactIsNeverShared(interest: boolean, confirmed: boolean, sensitive: boolean, stillValid: boolean, textLength: number): boolean {
  //@ ensures \result === true
  return !baseInterestShareable(interest, confirmed, true, sensitive, stillValid, textLength);
}

/** Story: Reuse my approved basics in a second app / An interest is shared only when the member confirmed it and it is not private (spec/baseProfileShare.md) */
//@ pure
export function lawSensitiveFactIsNeverShared(interest: boolean, confirmed: boolean, privateScope: boolean, stillValid: boolean, textLength: number): boolean {
  //@ ensures \result === true
  return !baseInterestShareable(interest, confirmed, privateScope, true, stillValid, textLength);
}

/** Story: Reuse my approved basics in a second app / A shared value never replaces what the person told this app (spec/baseProfileShare.md) */
//@ pure
export function baseFieldCopy(profileField: BaseProfileField, usable: boolean, fieldGranted: boolean, sourceHasValue: boolean, appHasValue: boolean): BaseFieldCopy {
  return !usable || !fieldGranted || !sourceHasValue ? "NothingToShare" : (profileField !== "BaseInterest" || appHasValue ? "KeepAppValue" : "AddSharedValue");
}

/** Story: Reuse my approved basics in a second app / A shared value never replaces what the person told this app (spec/baseProfileShare.md) */
//@ pure
export function lawSharedValueNeedsUsableGrant(profileField: BaseProfileField, usable: boolean, fieldGranted: boolean, sourceHasValue: boolean, appHasValue: boolean): boolean {
  //@ ensures \result === true
  return !(baseFieldCopy(profileField, usable, fieldGranted, sourceHasValue, appHasValue) === "AddSharedValue") || (usable && fieldGranted && sourceHasValue && !appHasValue);
}

/** Story: Reuse my approved basics in a second app / A shared value never replaces what the person told this app (spec/baseProfileShare.md) */
//@ pure
export function lawNameAndCityAreNeverReplaced(usable: boolean, fieldGranted: boolean, sourceHasValue: boolean, appHasValue: boolean): boolean {
  //@ ensures \result === true
  return baseFieldCopy("BaseFirstName", usable, fieldGranted, sourceHasValue, appHasValue) !== "AddSharedValue" && baseFieldCopy("BaseCity", usable, fieldGranted, sourceHasValue, appHasValue) !== "AddSharedValue";
}
