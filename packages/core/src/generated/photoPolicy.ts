// GENERATED from spec/photoPolicy.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny


/** Story: Let slop use my photos for private matching / Photo intake and rating have separate limits (spec/photoPolicy.md:21) */
export const uploadMaxBytes: number = 8388608;
/** Story: Let slop use my photos for private matching / Photo intake and rating have separate limits (spec/photoPolicy.md:21) */
export const uploadMaxPerPerson: number = 6;
/** Story: Let slop use my photos for private matching / Photo intake and rating have separate limits (spec/photoPolicy.md:21) */
export const ratingMaxPhotos: number = 4;
/** Story: Let slop use my photos for private matching / Photo intake and rating have separate limits (spec/photoPolicy.md:21) */
export const ratingMaxBytes: number = 4194304;
/** Story: Let slop use my photos for private matching / Photo intake and rating have separate limits (spec/photoPolicy.md:21) */
export const photoMaxPerMessage: number = 4;

/** Story: Let slop use my photos for private matching / The rater requires an adult age without a failed age check (spec/photoPolicy.md:9) */
//@ pure
export function photoSubjectAllowed(adult: boolean, ageCheckFailed: boolean): boolean {
  return adult && !ageCheckFailed;
}

/** Story: Let slop use my photos for private matching / The rater requires an adult age without a failed age check (spec/photoPolicy.md:9) */
//@ pure
export function lawRatingRequiresAdult(ageCheckFailed: boolean): boolean {
  //@ ensures \result === true
  return !photoSubjectAllowed(false, ageCheckFailed);
}

/** Story: Let slop use my photos for private matching / Photo intake and rating have separate limits (spec/photoPolicy.md:21) */
//@ pure
export function photoSlotsFull(storedCount: number): boolean {
  return storedCount >= uploadMaxPerPerson;
}
