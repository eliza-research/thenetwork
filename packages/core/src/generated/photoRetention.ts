// GENERATED from spec/photoRetention.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
export type PhotoPhase = "ChoosingChange" | "CheckingUploader" | "ScreeningFile" | "CheckingSlots" | "CleaningImage" | "ReservingRow" | "WritingBytes" | "WritingRow" | "DiscardingUpload" | "RemovingBytes" | "ClearingRating" | "RemovingRow" | "Rerating" | "ChangeFinished" | "UnsupportedApp" | "ConsentMissing" | "SizeExceeded" | "ChangeRefused";
/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
export interface PhotoChange { phase: PhotoPhase; rerateAfterRemoval: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginUpload"; appAllowed: boolean; consentCurrent: boolean }
  | { type: "checkUploader"; eligible: boolean }
  | { type: "screenFile"; tooLarge: boolean; typeKnown: boolean }
  | { type: "checkSlots"; available: boolean }
  | { type: "cleanImage"; cleaned: boolean }
  | { type: "reserveRow"; admitted: boolean }
  | { type: "recordUploadBytes" }
  | { type: "recordUploadRow"; confirmed: boolean }
  | { type: "recordUploadDiscard" }
  | { type: "finishRerate" }
  | { type: "beginRemoval"; owned: boolean; rerate: boolean }
  | { type: "recordRemovedBytes" }
  | { type: "recordRatingClear" }
  | { type: "recordRemovedRow" };

/** Story: Add and remove photos for private matching / The retention tick finishes unfinished photo changes (spec/photoRetention.md) */
export const photoChangeStaleMs: number = 900000;
/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
export const initial: PhotoChange = { phase: "ChoosingChange", rerateAfterRemoval: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoChange): boolean {
  return true;
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function canBeginUpload(c: PhotoChange): boolean {
  return c.phase === "ChoosingChange";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function beginUpload(c: PhotoChange, appAllowed: boolean, consentCurrent: boolean): PhotoChange {
  //@ ensures (inv(c) && canBeginUpload(c)) ==> stepBytesRequireReservedRow(c, "beginUpload", \result)
  //@ ensures (inv(c) && canBeginUpload(c)) ==> stepRowWriteRequiresBytes(c, "beginUpload", \result)
  //@ ensures (inv(c) && canBeginUpload(c)) ==> stepRatingClearRequiresBytesRemoval(c, "beginUpload", \result)
  //@ ensures (inv(c) && canBeginUpload(c)) ==> stepRowRemovalRequiresRatingClear(c, "beginUpload", \result)
  return { ...c, phase: !appAllowed ? "UnsupportedApp" : (!consentCurrent ? "ConsentMissing" : "CheckingUploader") };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function canCheckUploader(c: PhotoChange): boolean {
  return c.phase === "CheckingUploader";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function checkUploader(c: PhotoChange, eligible: boolean): PhotoChange {
  //@ ensures (inv(c) && canCheckUploader(c)) ==> stepBytesRequireReservedRow(c, "checkUploader", \result)
  //@ ensures (inv(c) && canCheckUploader(c)) ==> stepRowWriteRequiresBytes(c, "checkUploader", \result)
  //@ ensures (inv(c) && canCheckUploader(c)) ==> stepRatingClearRequiresBytesRemoval(c, "checkUploader", \result)
  //@ ensures (inv(c) && canCheckUploader(c)) ==> stepRowRemovalRequiresRatingClear(c, "checkUploader", \result)
  return { ...c, phase: eligible ? "ScreeningFile" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function canScreenFile(c: PhotoChange): boolean {
  return c.phase === "ScreeningFile";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function screenFile(c: PhotoChange, tooLarge: boolean, typeKnown: boolean): PhotoChange {
  //@ ensures (inv(c) && canScreenFile(c)) ==> stepBytesRequireReservedRow(c, "screenFile", \result)
  //@ ensures (inv(c) && canScreenFile(c)) ==> stepRowWriteRequiresBytes(c, "screenFile", \result)
  //@ ensures (inv(c) && canScreenFile(c)) ==> stepRatingClearRequiresBytesRemoval(c, "screenFile", \result)
  //@ ensures (inv(c) && canScreenFile(c)) ==> stepRowRemovalRequiresRatingClear(c, "screenFile", \result)
  return { ...c, phase: tooLarge ? "SizeExceeded" : (typeKnown ? "CheckingSlots" : "ChangeRefused") };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function canCheckSlots(c: PhotoChange): boolean {
  return c.phase === "CheckingSlots";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function checkSlots(c: PhotoChange, available: boolean): PhotoChange {
  //@ ensures (inv(c) && canCheckSlots(c)) ==> stepBytesRequireReservedRow(c, "checkSlots", \result)
  //@ ensures (inv(c) && canCheckSlots(c)) ==> stepRowWriteRequiresBytes(c, "checkSlots", \result)
  //@ ensures (inv(c) && canCheckSlots(c)) ==> stepRatingClearRequiresBytesRemoval(c, "checkSlots", \result)
  //@ ensures (inv(c) && canCheckSlots(c)) ==> stepRowRemovalRequiresRatingClear(c, "checkSlots", \result)
  return { ...c, phase: available ? "CleaningImage" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function canCleanImage(c: PhotoChange): boolean {
  return c.phase === "CleaningImage";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md) */
//@ pure
export function cleanImage(c: PhotoChange, cleaned: boolean): PhotoChange {
  //@ ensures (inv(c) && canCleanImage(c)) ==> stepBytesRequireReservedRow(c, "cleanImage", \result)
  //@ ensures (inv(c) && canCleanImage(c)) ==> stepRowWriteRequiresBytes(c, "cleanImage", \result)
  //@ ensures (inv(c) && canCleanImage(c)) ==> stepRatingClearRequiresBytesRemoval(c, "cleanImage", \result)
  //@ ensures (inv(c) && canCleanImage(c)) ==> stepRowRemovalRequiresRatingClear(c, "cleanImage", \result)
  return { ...c, phase: cleaned ? "ReservingRow" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function canReserveRow(c: PhotoChange): boolean {
  return c.phase === "ReservingRow";
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function reserveRow(c: PhotoChange, admitted: boolean): PhotoChange {
  //@ ensures (inv(c) && canReserveRow(c)) ==> stepBytesRequireReservedRow(c, "reserveRow", \result)
  //@ ensures (inv(c) && canReserveRow(c)) ==> stepRowWriteRequiresBytes(c, "reserveRow", \result)
  //@ ensures (inv(c) && canReserveRow(c)) ==> stepRatingClearRequiresBytesRemoval(c, "reserveRow", \result)
  //@ ensures (inv(c) && canReserveRow(c)) ==> stepRowRemovalRequiresRatingClear(c, "reserveRow", \result)
  return { ...c, phase: admitted ? "WritingBytes" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function canRecordUploadBytes(c: PhotoChange): boolean {
  return c.phase === "WritingBytes";
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function recordUploadBytes(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordUploadBytes(c)) ==> stepBytesRequireReservedRow(c, "recordUploadBytes", \result)
  //@ ensures (inv(c) && canRecordUploadBytes(c)) ==> stepRowWriteRequiresBytes(c, "recordUploadBytes", \result)
  //@ ensures (inv(c) && canRecordUploadBytes(c)) ==> stepRatingClearRequiresBytesRemoval(c, "recordUploadBytes", \result)
  //@ ensures (inv(c) && canRecordUploadBytes(c)) ==> stepRowRemovalRequiresRatingClear(c, "recordUploadBytes", \result)
  return { ...c, phase: "WritingRow" };
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function canRecordUploadRow(c: PhotoChange): boolean {
  return c.phase === "WritingRow";
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function recordUploadRow(c: PhotoChange, confirmed: boolean): PhotoChange {
  //@ ensures (inv(c) && canRecordUploadRow(c)) ==> stepBytesRequireReservedRow(c, "recordUploadRow", \result)
  //@ ensures (inv(c) && canRecordUploadRow(c)) ==> stepRowWriteRequiresBytes(c, "recordUploadRow", \result)
  //@ ensures (inv(c) && canRecordUploadRow(c)) ==> stepRatingClearRequiresBytesRemoval(c, "recordUploadRow", \result)
  //@ ensures (inv(c) && canRecordUploadRow(c)) ==> stepRowRemovalRequiresRatingClear(c, "recordUploadRow", \result)
  return { ...c, phase: confirmed ? "Rerating" : "DiscardingUpload" };
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function canRecordUploadDiscard(c: PhotoChange): boolean {
  return c.phase === "DiscardingUpload";
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function recordUploadDiscard(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordUploadDiscard(c)) ==> stepBytesRequireReservedRow(c, "recordUploadDiscard", \result)
  //@ ensures (inv(c) && canRecordUploadDiscard(c)) ==> stepRowWriteRequiresBytes(c, "recordUploadDiscard", \result)
  //@ ensures (inv(c) && canRecordUploadDiscard(c)) ==> stepRatingClearRequiresBytesRemoval(c, "recordUploadDiscard", \result)
  //@ ensures (inv(c) && canRecordUploadDiscard(c)) ==> stepRowRemovalRequiresRatingClear(c, "recordUploadDiscard", \result)
  return { ...c, phase: "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function canFinishRerate(c: PhotoChange): boolean {
  return c.phase === "Rerating";
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function finishRerate(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canFinishRerate(c)) ==> stepBytesRequireReservedRow(c, "finishRerate", \result)
  //@ ensures (inv(c) && canFinishRerate(c)) ==> stepRowWriteRequiresBytes(c, "finishRerate", \result)
  //@ ensures (inv(c) && canFinishRerate(c)) ==> stepRatingClearRequiresBytesRemoval(c, "finishRerate", \result)
  //@ ensures (inv(c) && canFinishRerate(c)) ==> stepRowRemovalRequiresRatingClear(c, "finishRerate", \result)
  return { ...c, phase: "ChangeFinished" };
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function stepBytesRequireReservedRow(before: PhotoChange, via: string, after: PhotoChange): boolean {
  return !(after.phase === "WritingBytes") || (before.phase === "ReservingRow" && via === "reserveRow");
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function stepRowWriteRequiresBytes(before: PhotoChange, via: string, after: PhotoChange): boolean {
  return !(after.phase === "WritingRow") || (before.phase === "WritingBytes" && via === "recordUploadBytes");
}

/** Story: Add and remove photos for private matching / Reserve the photo row under the person lock before the bytes (spec/photoRetention.md) */
//@ pure
export function sometimesDiscardsUpload(c: PhotoChange): boolean {
  return c.phase === "DiscardingUpload";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function canBeginRemoval(c: PhotoChange): boolean {
  return c.phase === "ChoosingChange";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function beginRemoval(c: PhotoChange, owned: boolean, rerate: boolean): PhotoChange {
  //@ ensures (inv(c) && canBeginRemoval(c)) ==> stepBytesRequireReservedRow(c, "beginRemoval", \result)
  //@ ensures (inv(c) && canBeginRemoval(c)) ==> stepRowWriteRequiresBytes(c, "beginRemoval", \result)
  //@ ensures (inv(c) && canBeginRemoval(c)) ==> stepRatingClearRequiresBytesRemoval(c, "beginRemoval", \result)
  //@ ensures (inv(c) && canBeginRemoval(c)) ==> stepRowRemovalRequiresRatingClear(c, "beginRemoval", \result)
  return { phase: owned ? "RemovingBytes" : "ChangeRefused", rerateAfterRemoval: rerate };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function canRecordRemovedBytes(c: PhotoChange): boolean {
  return c.phase === "RemovingBytes";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function recordRemovedBytes(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordRemovedBytes(c)) ==> stepBytesRequireReservedRow(c, "recordRemovedBytes", \result)
  //@ ensures (inv(c) && canRecordRemovedBytes(c)) ==> stepRowWriteRequiresBytes(c, "recordRemovedBytes", \result)
  //@ ensures (inv(c) && canRecordRemovedBytes(c)) ==> stepRatingClearRequiresBytesRemoval(c, "recordRemovedBytes", \result)
  //@ ensures (inv(c) && canRecordRemovedBytes(c)) ==> stepRowRemovalRequiresRatingClear(c, "recordRemovedBytes", \result)
  return { ...c, phase: "ClearingRating" };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function canRecordRatingClear(c: PhotoChange): boolean {
  return c.phase === "ClearingRating";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function recordRatingClear(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordRatingClear(c)) ==> stepBytesRequireReservedRow(c, "recordRatingClear", \result)
  //@ ensures (inv(c) && canRecordRatingClear(c)) ==> stepRowWriteRequiresBytes(c, "recordRatingClear", \result)
  //@ ensures (inv(c) && canRecordRatingClear(c)) ==> stepRatingClearRequiresBytesRemoval(c, "recordRatingClear", \result)
  //@ ensures (inv(c) && canRecordRatingClear(c)) ==> stepRowRemovalRequiresRatingClear(c, "recordRatingClear", \result)
  return { ...c, phase: "RemovingRow" };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function canRecordRemovedRow(c: PhotoChange): boolean {
  return c.phase === "RemovingRow";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function recordRemovedRow(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordRemovedRow(c)) ==> stepBytesRequireReservedRow(c, "recordRemovedRow", \result)
  //@ ensures (inv(c) && canRecordRemovedRow(c)) ==> stepRowWriteRequiresBytes(c, "recordRemovedRow", \result)
  //@ ensures (inv(c) && canRecordRemovedRow(c)) ==> stepRatingClearRequiresBytesRemoval(c, "recordRemovedRow", \result)
  //@ ensures (inv(c) && canRecordRemovedRow(c)) ==> stepRowRemovalRequiresRatingClear(c, "recordRemovedRow", \result)
  return { ...c, phase: c.rerateAfterRemoval ? "Rerating" : "ChangeFinished" };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function stepRatingClearRequiresBytesRemoval(before: PhotoChange, via: string, after: PhotoChange): boolean {
  return !(after.phase === "ClearingRating") || (before.phase === "RemovingBytes" && via === "recordRemovedBytes");
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function stepRowRemovalRequiresRatingClear(before: PhotoChange, via: string, after: PhotoChange): boolean {
  return !(after.phase === "RemovingRow") || (before.phase === "ClearingRating" && via === "recordRatingClear");
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function sometimesCompletesChange(c: PhotoChange): boolean {
  return c.phase === "ChangeFinished";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function sometimesWritesPhoto(c: PhotoChange): boolean {
  return c.phase === "WritingRow";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md) */
//@ pure
export function sometimesRemovesPhoto(c: PhotoChange): boolean {
  return c.phase === "RemovingRow";
}

/** Story: Add and remove photos for private matching / The retention tick finishes unfinished photo changes (spec/photoRetention.md) */
//@ pure
export function unfinishedPhotoDue(reserved: boolean, hidden: boolean, changedAt: number, at: number): boolean {
  return (reserved || hidden) && at >= changedAt && exact_photoRetention(at - changedAt) >= photoChangeStaleMs;
}

/** Story: Add and remove photos for private matching / The retention tick finishes unfinished photo changes (spec/photoRetention.md) */
//@ pure
export function lawStoredPhotoIsNeverSwept(changedAt: number, at: number): boolean {
  //@ ensures \result === true
  return !unfinishedPhotoDue(false, false, changedAt, at);
}

/** Story: Add and remove photos for private matching / The retention tick finishes unfinished photo changes (spec/photoRetention.md) */
//@ pure
export function lawFreshChangeIsLeftToItsRequest(reserved: boolean, hidden: boolean, changedAt: number): boolean {
  //@ ensures \result === true
  return !unfinishedPhotoDue(reserved, hidden, changedAt, exact_photoRetention(exact_photoRetention(changedAt + photoChangeStaleMs) - 1));
}

/** Story: Add and remove photos for private matching / Only a live adult member keeps photos and a rating (spec/photoRetention.md) */
//@ pure
export function photoHoldAllowed(personLive: boolean, adult: boolean, appAdultCheckPassed: boolean, liveMembership: boolean): boolean {
  return personLive && adult && appAdultCheckPassed && liveMembership;
}

/** Story: Add and remove photos for private matching / Only a live adult member keeps photos and a rating (spec/photoRetention.md) */
//@ pure
export function ratingHoldAllowed(photosAllowed: boolean, storedPhotos: number): boolean {
  return photosAllowed && storedPhotos > 0;
}

/** Story: Add and remove photos for private matching / Only a live adult member keeps photos and a rating (spec/photoRetention.md) */
//@ pure
export function lawMinorKeepsNoPhoto(personLive: boolean, appAdultCheckPassed: boolean, liveMembership: boolean): boolean {
  //@ ensures \result === true
  return !photoHoldAllowed(personLive, false, appAdultCheckPassed, liveMembership);
}

/** Story: Add and remove photos for private matching / Only a live adult member keeps photos and a rating (spec/photoRetention.md) */
//@ pure
export function lawFailedAgeCheckKeepsNoPhoto(personLive: boolean, adult: boolean, liveMembership: boolean): boolean {
  //@ ensures \result === true
  return !photoHoldAllowed(personLive, adult, false, liveMembership);
}

/** Story: Add and remove photos for private matching / Only a live adult member keeps photos and a rating (spec/photoRetention.md) */
//@ pure
export function lawRatingNeedsAPhoto(photosAllowed: boolean): boolean {
  //@ ensures \result === true
  return !ratingHoldAllowed(photosAllowed, 0);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoChange, event: Event): boolean {
  if (event.type === "beginUpload") return canBeginUpload(current);
  if (event.type === "checkUploader") return canCheckUploader(current);
  if (event.type === "screenFile") return canScreenFile(current);
  if (event.type === "checkSlots") return canCheckSlots(current);
  if (event.type === "cleanImage") return canCleanImage(current);
  if (event.type === "reserveRow") return canReserveRow(current);
  if (event.type === "recordUploadBytes") return canRecordUploadBytes(current);
  if (event.type === "recordUploadRow") return canRecordUploadRow(current);
  if (event.type === "recordUploadDiscard") return canRecordUploadDiscard(current);
  if (event.type === "finishRerate") return canFinishRerate(current);
  if (event.type === "beginRemoval") return canBeginRemoval(current);
  if (event.type === "recordRemovedBytes") return canRecordRemovedBytes(current);
  if (event.type === "recordRatingClear") return canRecordRatingClear(current);
  if (event.type === "recordRemovedRow") return canRecordRemovedRow(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoChange, event: Event): PhotoChange {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginUpload") return canBeginUpload(current) ? beginUpload(current, event.appAllowed, event.consentCurrent) : current;
  if (event.type === "checkUploader") return canCheckUploader(current) ? checkUploader(current, event.eligible) : current;
  if (event.type === "screenFile") return canScreenFile(current) ? screenFile(current, event.tooLarge, event.typeKnown) : current;
  if (event.type === "checkSlots") return canCheckSlots(current) ? checkSlots(current, event.available) : current;
  if (event.type === "cleanImage") return canCleanImage(current) ? cleanImage(current, event.cleaned) : current;
  if (event.type === "reserveRow") return canReserveRow(current) ? reserveRow(current, event.admitted) : current;
  if (event.type === "recordUploadBytes") return canRecordUploadBytes(current) ? recordUploadBytes(current) : current;
  if (event.type === "recordUploadRow") return canRecordUploadRow(current) ? recordUploadRow(current, event.confirmed) : current;
  if (event.type === "recordUploadDiscard") return canRecordUploadDiscard(current) ? recordUploadDiscard(current) : current;
  if (event.type === "finishRerate") return canFinishRerate(current) ? finishRerate(current) : current;
  if (event.type === "beginRemoval") return canBeginRemoval(current) ? beginRemoval(current, event.owned, event.rerate) : current;
  if (event.type === "recordRemovedBytes") return canRecordRemovedBytes(current) ? recordRemovedBytes(current) : current;
  if (event.type === "recordRatingClear") return canRecordRatingClear(current) ? recordRatingClear(current) : current;
  if (event.type === "recordRemovedRow") return canRecordRemovedRow(current) ? recordRemovedRow(current) : current;
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
  if (raw.type === "beginUpload" && typeof raw.appAllowed === "boolean" && typeof raw.consentCurrent === "boolean") return { type: "beginUpload", appAllowed: raw.appAllowed, consentCurrent: raw.consentCurrent };
  if (raw.type === "checkUploader" && typeof raw.eligible === "boolean") return { type: "checkUploader", eligible: raw.eligible };
  if (raw.type === "screenFile" && typeof raw.tooLarge === "boolean" && typeof raw.typeKnown === "boolean") return { type: "screenFile", tooLarge: raw.tooLarge, typeKnown: raw.typeKnown };
  if (raw.type === "checkSlots" && typeof raw.available === "boolean") return { type: "checkSlots", available: raw.available };
  if (raw.type === "cleanImage" && typeof raw.cleaned === "boolean") return { type: "cleanImage", cleaned: raw.cleaned };
  if (raw.type === "reserveRow" && typeof raw.admitted === "boolean") return { type: "reserveRow", admitted: raw.admitted };
  if (raw.type === "recordUploadBytes") return { type: "recordUploadBytes" };
  if (raw.type === "recordUploadRow" && typeof raw.confirmed === "boolean") return { type: "recordUploadRow", confirmed: raw.confirmed };
  if (raw.type === "recordUploadDiscard") return { type: "recordUploadDiscard" };
  if (raw.type === "finishRerate") return { type: "finishRerate" };
  if (raw.type === "beginRemoval" && typeof raw.owned === "boolean" && typeof raw.rerate === "boolean") return { type: "beginRemoval", owned: raw.owned, rerate: raw.rerate };
  if (raw.type === "recordRemovedBytes") return { type: "recordRemovedBytes" };
  if (raw.type === "recordRatingClear") return { type: "recordRatingClear" };
  if (raw.type === "recordRemovedRow") return { type: "recordRemovedRow" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): PhotoChange | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ChoosingChange" || raw.phase === "CheckingUploader" || raw.phase === "ScreeningFile" || raw.phase === "CheckingSlots" || raw.phase === "CleaningImage" || raw.phase === "ReservingRow" || raw.phase === "WritingBytes" || raw.phase === "WritingRow" || raw.phase === "DiscardingUpload" || raw.phase === "RemovingBytes" || raw.phase === "ClearingRating" || raw.phase === "RemovingRow" || raw.phase === "Rerating" || raw.phase === "ChangeFinished" || raw.phase === "UnsupportedApp" || raw.phase === "ConsentMissing" || raw.phase === "SizeExceeded" || raw.phase === "ChangeRefused") && typeof raw.rerateAfterRemoval === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: PhotoChange = ({ phase: raw.phase, rerateAfterRemoval: raw.rerateAfterRemoval });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoChange {
  //@ ensures inv(\result)
  return initial;
}

/** An integer result, which must be exact: past 2^53 a number is rounded, where Quint's and the proof's integers are not. */
export function exact_photoRetention(n: number): number {
  if (!Number.isSafeInteger(n)) throw new RangeError(`an integer result is ${n}, beyond 2^53, where TypeScript cannot hold it exactly`);
  return n;
}
