// GENERATED from spec/photoRetention.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
export type PhotoPhase = "ChoosingChange" | "CheckingUploader" | "ScreeningFile" | "CheckingSlots" | "CleaningImage" | "WritingBytes" | "WritingRow" | "RemovingBytes" | "RemovingRow" | "ClearingRating" | "Rerating" | "ChangeFinished" | "UnsupportedApp" | "ConsentMissing" | "SizeExceeded" | "ChangeRefused";
/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
export interface PhotoChange { phase: PhotoPhase; rerateAfterRemoval: boolean }

/** One variant per transition in the spec. */
export type Event =
  | { type: "beginUpload"; appAllowed: boolean; consentCurrent: boolean }
  | { type: "checkUploader"; eligible: boolean }
  | { type: "screenFile"; tooLarge: boolean; typeKnown: boolean }
  | { type: "checkSlots"; available: boolean }
  | { type: "cleanImage"; cleaned: boolean }
  | { type: "recordUploadBytes" }
  | { type: "recordUploadRow" }
  | { type: "finishRerate" }
  | { type: "beginRemoval"; owned: boolean; rerate: boolean }
  | { type: "recordRemovedBytes" }
  | { type: "recordRemovedRow" }
  | { type: "recordRatingClear" };

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
export const initial: PhotoChange = { phase: "ChoosingChange", rerateAfterRemoval: false };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: PhotoChange): boolean {
  return true;
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function canBeginUpload(c: PhotoChange): boolean {
  return c.phase === "ChoosingChange";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function beginUpload(c: PhotoChange, appAllowed: boolean, consentCurrent: boolean): PhotoChange {
  //@ ensures (inv(c) && canBeginUpload(c)) ==> stepRowWriteRequiresBytes(c, "beginUpload", \result)
  //@ ensures (inv(c) && canBeginUpload(c)) ==> stepRatingClearRequiresRowRemoval(c, "beginUpload", \result)
  return { ...c, phase: !appAllowed ? "UnsupportedApp" : (!consentCurrent ? "ConsentMissing" : "CheckingUploader") };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function canCheckUploader(c: PhotoChange): boolean {
  return c.phase === "CheckingUploader";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function checkUploader(c: PhotoChange, eligible: boolean): PhotoChange {
  //@ ensures (inv(c) && canCheckUploader(c)) ==> stepRowWriteRequiresBytes(c, "checkUploader", \result)
  //@ ensures (inv(c) && canCheckUploader(c)) ==> stepRatingClearRequiresRowRemoval(c, "checkUploader", \result)
  return { ...c, phase: eligible ? "ScreeningFile" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function canScreenFile(c: PhotoChange): boolean {
  return c.phase === "ScreeningFile";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function screenFile(c: PhotoChange, tooLarge: boolean, typeKnown: boolean): PhotoChange {
  //@ ensures (inv(c) && canScreenFile(c)) ==> stepRowWriteRequiresBytes(c, "screenFile", \result)
  //@ ensures (inv(c) && canScreenFile(c)) ==> stepRatingClearRequiresRowRemoval(c, "screenFile", \result)
  return { ...c, phase: tooLarge ? "SizeExceeded" : (typeKnown ? "CheckingSlots" : "ChangeRefused") };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function canCheckSlots(c: PhotoChange): boolean {
  return c.phase === "CheckingSlots";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function checkSlots(c: PhotoChange, available: boolean): PhotoChange {
  //@ ensures (inv(c) && canCheckSlots(c)) ==> stepRowWriteRequiresBytes(c, "checkSlots", \result)
  //@ ensures (inv(c) && canCheckSlots(c)) ==> stepRatingClearRequiresRowRemoval(c, "checkSlots", \result)
  return { ...c, phase: available ? "CleaningImage" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function canCleanImage(c: PhotoChange): boolean {
  return c.phase === "CleaningImage";
}

/** Story: Add and remove photos for private matching / Consent, adult eligibility, and a valid image precede storage (spec/photoRetention.md:9) */
//@ pure
export function cleanImage(c: PhotoChange, cleaned: boolean): PhotoChange {
  //@ ensures (inv(c) && canCleanImage(c)) ==> stepRowWriteRequiresBytes(c, "cleanImage", \result)
  //@ ensures (inv(c) && canCleanImage(c)) ==> stepRatingClearRequiresRowRemoval(c, "cleanImage", \result)
  return { ...c, phase: cleaned ? "WritingBytes" : "ChangeRefused" };
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function canRecordUploadBytes(c: PhotoChange): boolean {
  return c.phase === "WritingBytes";
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function recordUploadBytes(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordUploadBytes(c)) ==> stepRowWriteRequiresBytes(c, "recordUploadBytes", \result)
  //@ ensures (inv(c) && canRecordUploadBytes(c)) ==> stepRatingClearRequiresRowRemoval(c, "recordUploadBytes", \result)
  return { ...c, phase: "WritingRow" };
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function canRecordUploadRow(c: PhotoChange): boolean {
  return c.phase === "WritingRow";
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function recordUploadRow(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordUploadRow(c)) ==> stepRowWriteRequiresBytes(c, "recordUploadRow", \result)
  //@ ensures (inv(c) && canRecordUploadRow(c)) ==> stepRatingClearRequiresRowRemoval(c, "recordUploadRow", \result)
  return { ...c, phase: "Rerating" };
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function canFinishRerate(c: PhotoChange): boolean {
  return c.phase === "Rerating";
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function finishRerate(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canFinishRerate(c)) ==> stepRowWriteRequiresBytes(c, "finishRerate", \result)
  //@ ensures (inv(c) && canFinishRerate(c)) ==> stepRatingClearRequiresRowRemoval(c, "finishRerate", \result)
  return { ...c, phase: "ChangeFinished" };
}

/** Story: Add and remove photos for private matching / Store private bytes before the photo row (spec/photoRetention.md:42) */
//@ pure
export function stepRowWriteRequiresBytes(before: PhotoChange, via: string, after: PhotoChange): boolean {
  return !(after.phase === "WritingRow") || (before.phase === "WritingBytes" && via === "recordUploadBytes");
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function canBeginRemoval(c: PhotoChange): boolean {
  return c.phase === "ChoosingChange";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function beginRemoval(c: PhotoChange, owned: boolean, rerate: boolean): PhotoChange {
  //@ ensures (inv(c) && canBeginRemoval(c)) ==> stepRowWriteRequiresBytes(c, "beginRemoval", \result)
  //@ ensures (inv(c) && canBeginRemoval(c)) ==> stepRatingClearRequiresRowRemoval(c, "beginRemoval", \result)
  return { phase: owned ? "RemovingBytes" : "ChangeRefused", rerateAfterRemoval: rerate };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function canRecordRemovedBytes(c: PhotoChange): boolean {
  return c.phase === "RemovingBytes";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function recordRemovedBytes(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordRemovedBytes(c)) ==> stepRowWriteRequiresBytes(c, "recordRemovedBytes", \result)
  //@ ensures (inv(c) && canRecordRemovedBytes(c)) ==> stepRatingClearRequiresRowRemoval(c, "recordRemovedBytes", \result)
  return { ...c, phase: "RemovingRow" };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function canRecordRemovedRow(c: PhotoChange): boolean {
  return c.phase === "RemovingRow";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function recordRemovedRow(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordRemovedRow(c)) ==> stepRowWriteRequiresBytes(c, "recordRemovedRow", \result)
  //@ ensures (inv(c) && canRecordRemovedRow(c)) ==> stepRatingClearRequiresRowRemoval(c, "recordRemovedRow", \result)
  return { ...c, phase: "ClearingRating" };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function canRecordRatingClear(c: PhotoChange): boolean {
  return c.phase === "ClearingRating";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function recordRatingClear(c: PhotoChange): PhotoChange {
  //@ ensures (inv(c) && canRecordRatingClear(c)) ==> stepRowWriteRequiresBytes(c, "recordRatingClear", \result)
  //@ ensures (inv(c) && canRecordRatingClear(c)) ==> stepRatingClearRequiresRowRemoval(c, "recordRatingClear", \result)
  return { ...c, phase: c.rerateAfterRemoval ? "Rerating" : "ChangeFinished" };
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function stepRatingClearRequiresRowRemoval(before: PhotoChange, via: string, after: PhotoChange): boolean {
  return !(after.phase === "ClearingRating") || (before.phase === "RemovingRow" && via === "recordRemovedRow");
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function sometimesCompletesChange(c: PhotoChange): boolean {
  return c.phase === "ChangeFinished";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function sometimesWritesPhoto(c: PhotoChange): boolean {
  return c.phase === "WritingRow";
}

/** Story: Add and remove photos for private matching / Erase bytes and metadata before dropping the old rating (spec/photoRetention.md:60) */
//@ pure
export function sometimesRemovesPhoto(c: PhotoChange): boolean {
  return c.phase === "RemovingRow";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: PhotoChange, event: Event): boolean {
  if (event.type === "beginUpload") return canBeginUpload(current);
  if (event.type === "checkUploader") return canCheckUploader(current);
  if (event.type === "screenFile") return canScreenFile(current);
  if (event.type === "checkSlots") return canCheckSlots(current);
  if (event.type === "cleanImage") return canCleanImage(current);
  if (event.type === "recordUploadBytes") return canRecordUploadBytes(current);
  if (event.type === "recordUploadRow") return canRecordUploadRow(current);
  if (event.type === "finishRerate") return canFinishRerate(current);
  if (event.type === "beginRemoval") return canBeginRemoval(current);
  if (event.type === "recordRemovedBytes") return canRecordRemovedBytes(current);
  if (event.type === "recordRemovedRow") return canRecordRemovedRow(current);
  if (event.type === "recordRatingClear") return canRecordRatingClear(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: PhotoChange, event: Event): PhotoChange {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "beginUpload" && canBeginUpload(current)) return beginUpload(current, event.appAllowed, event.consentCurrent);
  if (event.type === "checkUploader" && canCheckUploader(current)) return checkUploader(current, event.eligible);
  if (event.type === "screenFile" && canScreenFile(current)) return screenFile(current, event.tooLarge, event.typeKnown);
  if (event.type === "checkSlots" && canCheckSlots(current)) return checkSlots(current, event.available);
  if (event.type === "cleanImage" && canCleanImage(current)) return cleanImage(current, event.cleaned);
  if (event.type === "recordUploadBytes" && canRecordUploadBytes(current)) return recordUploadBytes(current);
  if (event.type === "recordUploadRow" && canRecordUploadRow(current)) return recordUploadRow(current);
  if (event.type === "finishRerate" && canFinishRerate(current)) return finishRerate(current);
  if (event.type === "beginRemoval" && canBeginRemoval(current)) return beginRemoval(current, event.owned, event.rerate);
  if (event.type === "recordRemovedBytes" && canRecordRemovedBytes(current)) return recordRemovedBytes(current);
  if (event.type === "recordRemovedRow" && canRecordRemovedRow(current)) return recordRemovedRow(current);
  if (event.type === "recordRatingClear" && canRecordRatingClear(current)) return recordRatingClear(current);
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
  if (raw.type === "recordUploadBytes") return { type: "recordUploadBytes" };
  if (raw.type === "recordUploadRow") return { type: "recordUploadRow" };
  if (raw.type === "finishRerate") return { type: "finishRerate" };
  if (raw.type === "beginRemoval" && typeof raw.owned === "boolean" && typeof raw.rerate === "boolean") return { type: "beginRemoval", owned: raw.owned, rerate: raw.rerate };
  if (raw.type === "recordRemovedBytes") return { type: "recordRemovedBytes" };
  if (raw.type === "recordRemovedRow") return { type: "recordRemovedRow" };
  if (raw.type === "recordRatingClear") return { type: "recordRatingClear" };
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
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "ChoosingChange" || raw.phase === "CheckingUploader" || raw.phase === "ScreeningFile" || raw.phase === "CheckingSlots" || raw.phase === "CleaningImage" || raw.phase === "WritingBytes" || raw.phase === "WritingRow" || raw.phase === "RemovingBytes" || raw.phase === "RemovingRow" || raw.phase === "ClearingRating" || raw.phase === "Rerating" || raw.phase === "ChangeFinished" || raw.phase === "UnsupportedApp" || raw.phase === "ConsentMissing" || raw.phase === "SizeExceeded" || raw.phase === "ChangeRefused") && typeof raw.rerateAfterRemoval === "boolean" && Object.keys(raw).length === 2)) return undefined;
  const parsed: PhotoChange = ({ phase: raw.phase, rerateAfterRemoval: raw.rerateAfterRemoval });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): PhotoChange {
  //@ ensures inv(\result)
  return initial;
}
