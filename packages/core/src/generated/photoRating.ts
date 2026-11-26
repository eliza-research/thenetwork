// GENERATED from spec/photoRating.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
export type RatingPhase = "CheckingSubject" | "ReadingPhotos" | "AwaitingScore" | "CheckingReturnedScore" | "WritingScore" | "CheckingWrittenScore" | "RemovingScore" | "RatingKept" | "RatingEnded";
/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
export interface RatingAttempt { phase: RatingPhase }

/** One variant per transition in the spec. */
export type Event =
  | { type: "screenSubject"; eligible: boolean }
  | { type: "supplyPhotos"; hasPhotos: boolean }
  | { type: "receiveScore"; hasScore: boolean }
  | { type: "checkReturnedScore"; eligible: boolean }
  | { type: "recordScoreWrite"; committed: boolean }
  | { type: "checkWrittenScore"; eligible: boolean }
  | { type: "recordScoreRemoval" };

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
export const initial: RatingAttempt = { phase: "CheckingSubject" };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: RatingAttempt): boolean {
  return true;
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function canScreenSubject(a: RatingAttempt): boolean {
  return a.phase === "CheckingSubject";
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function screenSubject(a: RatingAttempt, eligible: boolean): RatingAttempt {
  //@ ensures (inv(a) && canScreenSubject(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "screenSubject", \result)
  //@ ensures (inv(a) && canScreenSubject(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "screenSubject", \result)
  return { phase: eligible ? "ReadingPhotos" : "RatingEnded" };
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function canSupplyPhotos(a: RatingAttempt): boolean {
  return a.phase === "ReadingPhotos";
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function supplyPhotos(a: RatingAttempt, hasPhotos: boolean): RatingAttempt {
  //@ ensures (inv(a) && canSupplyPhotos(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "supplyPhotos", \result)
  //@ ensures (inv(a) && canSupplyPhotos(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "supplyPhotos", \result)
  return { phase: hasPhotos ? "AwaitingScore" : "RatingEnded" };
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function canReceiveScore(a: RatingAttempt): boolean {
  return a.phase === "AwaitingScore";
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function receiveScore(a: RatingAttempt, hasScore: boolean): RatingAttempt {
  //@ ensures (inv(a) && canReceiveScore(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "receiveScore", \result)
  //@ ensures (inv(a) && canReceiveScore(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "receiveScore", \result)
  return { phase: hasScore ? "CheckingReturnedScore" : "RatingEnded" };
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function ratingPhotoSelectionCurrent(selected: string[], latest: string[]): boolean {
  return selected.length > 0 && equal_photoRating(selected, latest);
}

/** Story: Keep a private rating only while its photos and authority are current / Only an eligible member with available photo bytes reaches the rater (spec/photoRating.md) */
//@ pure
export function lawDifferentPhotoSelectionEndsAttempt(selected: string[], latest: string[]): boolean {
  //@ ensures \result === true
  return !(!equal_photoRating(selected, latest)) || !ratingPhotoSelectionCurrent(selected, latest);
}

/** Story: Keep a private rating only while its photos and authority are current / Write only after the returned score passes a fresh authority check (spec/photoRating.md) */
//@ pure
export function canCheckReturnedScore(a: RatingAttempt): boolean {
  return a.phase === "CheckingReturnedScore";
}

/** Story: Keep a private rating only while its photos and authority are current / Write only after the returned score passes a fresh authority check (spec/photoRating.md) */
//@ pure
export function checkReturnedScore(a: RatingAttempt, eligible: boolean): RatingAttempt {
  //@ ensures (inv(a) && canCheckReturnedScore(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "checkReturnedScore", \result)
  //@ ensures (inv(a) && canCheckReturnedScore(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "checkReturnedScore", \result)
  return { phase: eligible ? "WritingScore" : "RatingEnded" };
}

/** Story: Keep a private rating only while its photos and authority are current / Write only after the returned score passes a fresh authority check (spec/photoRating.md) */
//@ pure
export function canRecordScoreWrite(a: RatingAttempt): boolean {
  return a.phase === "WritingScore";
}

/** Story: Keep a private rating only while its photos and authority are current / Write only after the returned score passes a fresh authority check (spec/photoRating.md) */
//@ pure
export function recordScoreWrite(a: RatingAttempt, committed: boolean): RatingAttempt {
  //@ ensures (inv(a) && canRecordScoreWrite(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "recordScoreWrite", \result)
  //@ ensures (inv(a) && canRecordScoreWrite(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "recordScoreWrite", \result)
  return { phase: committed ? "CheckingWrittenScore" : "RatingEnded" };
}

/** Story: Keep a private rating only while its photos and authority are current / Write only after the returned score passes a fresh authority check (spec/photoRating.md) */
//@ pure
export function stepWritingRequiresReturnedScoreCheck(before: RatingAttempt, via: string, after: RatingAttempt): boolean {
  return !(after.phase === "WritingScore") || (before.phase === "CheckingReturnedScore" && via === "checkReturnedScore");
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function canCheckWrittenScore(a: RatingAttempt): boolean {
  return a.phase === "CheckingWrittenScore";
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function checkWrittenScore(a: RatingAttempt, eligible: boolean): RatingAttempt {
  //@ ensures (inv(a) && canCheckWrittenScore(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "checkWrittenScore", \result)
  //@ ensures (inv(a) && canCheckWrittenScore(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "checkWrittenScore", \result)
  return { phase: eligible ? "RatingKept" : "RemovingScore" };
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function canRecordScoreRemoval(a: RatingAttempt): boolean {
  return a.phase === "RemovingScore";
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function recordScoreRemoval(a: RatingAttempt): RatingAttempt {
  //@ ensures (inv(a) && canRecordScoreRemoval(a)) ==> stepWritingRequiresReturnedScoreCheck(a, "recordScoreRemoval", \result)
  //@ ensures (inv(a) && canRecordScoreRemoval(a)) ==> stepOnlyTheWriteCheckCanKeepScore(a, "recordScoreRemoval", \result)
  return { phase: "RatingEnded" };
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function stepOnlyTheWriteCheckCanKeepScore(before: RatingAttempt, via: string, after: RatingAttempt): boolean {
  return !(after.phase === "RatingKept") || (before.phase === "CheckingWrittenScore" && via === "checkWrittenScore");
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function sometimesRetainsScore(a: RatingAttempt): boolean {
  return a.phase === "RatingKept";
}

/** Story: Keep a private rating only while its photos and authority are current / Keep or remove the private rating after the write (spec/photoRating.md) */
//@ pure
export function sometimesNeedsRemoval(a: RatingAttempt): boolean {
  return a.phase === "RemovingScore";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: RatingAttempt, event: Event): boolean {
  if (event.type === "screenSubject") return canScreenSubject(current);
  if (event.type === "supplyPhotos") return canSupplyPhotos(current);
  if (event.type === "receiveScore") return canReceiveScore(current);
  if (event.type === "checkReturnedScore") return canCheckReturnedScore(current);
  if (event.type === "recordScoreWrite") return canRecordScoreWrite(current);
  if (event.type === "checkWrittenScore") return canCheckWrittenScore(current);
  if (event.type === "recordScoreRemoval") return canRecordScoreRemoval(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: RatingAttempt, event: Event): RatingAttempt {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "screenSubject") return canScreenSubject(current) ? screenSubject(current, event.eligible) : current;
  if (event.type === "supplyPhotos") return canSupplyPhotos(current) ? supplyPhotos(current, event.hasPhotos) : current;
  if (event.type === "receiveScore") return canReceiveScore(current) ? receiveScore(current, event.hasScore) : current;
  if (event.type === "checkReturnedScore") return canCheckReturnedScore(current) ? checkReturnedScore(current, event.eligible) : current;
  if (event.type === "recordScoreWrite") return canRecordScoreWrite(current) ? recordScoreWrite(current, event.committed) : current;
  if (event.type === "checkWrittenScore") return canCheckWrittenScore(current) ? checkWrittenScore(current, event.eligible) : current;
  if (event.type === "recordScoreRemoval") return canRecordScoreRemoval(current) ? recordScoreRemoval(current) : current;
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
  if (raw.type === "screenSubject" && typeof raw.eligible === "boolean") return { type: "screenSubject", eligible: raw.eligible };
  if (raw.type === "supplyPhotos" && typeof raw.hasPhotos === "boolean") return { type: "supplyPhotos", hasPhotos: raw.hasPhotos };
  if (raw.type === "receiveScore" && typeof raw.hasScore === "boolean") return { type: "receiveScore", hasScore: raw.hasScore };
  if (raw.type === "checkReturnedScore" && typeof raw.eligible === "boolean") return { type: "checkReturnedScore", eligible: raw.eligible };
  if (raw.type === "recordScoreWrite" && typeof raw.committed === "boolean") return { type: "recordScoreWrite", committed: raw.committed };
  if (raw.type === "checkWrittenScore" && typeof raw.eligible === "boolean") return { type: "checkWrittenScore", eligible: raw.eligible };
  if (raw.type === "recordScoreRemoval") return { type: "recordScoreRemoval" };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): RatingAttempt | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "CheckingSubject" || raw.phase === "ReadingPhotos" || raw.phase === "AwaitingScore" || raw.phase === "CheckingReturnedScore" || raw.phase === "WritingScore" || raw.phase === "CheckingWrittenScore" || raw.phase === "RemovingScore" || raw.phase === "RatingKept" || raw.phase === "RatingEnded") && Object.keys(raw).length === 1)) return undefined;
  const parsed: RatingAttempt = ({ phase: raw.phase });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): RatingAttempt {
  //@ ensures inv(\result)
  return initial;
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_photoRating(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_photoRating((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
