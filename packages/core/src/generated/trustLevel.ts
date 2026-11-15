// GENERATED from spec/trustLevel.md by tools/spec.ts. Do not edit: change the spec and run `npm run gen`.
//@ backend dafny

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md:9) */
export type TrustLevel = "Ok" | "Watch" | "Hold";

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md:9) */
export const watchScore: number = 3;
/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md:9) */
export const holdScore: number = 6;

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md:9) */
//@ pure
export function levelForScore(score: number, held: boolean): TrustLevel {
  return held || score >= holdScore ? "Hold" : (score >= watchScore ? "Watch" : "Ok");
}

/** Story: Pause unsafe activity / A hold stays in place until staff lift it (spec/trustLevel.md:23) */
//@ pure
export function lawScoreUpdatesKeepHolds(score: number): boolean {
  //@ ensures \result === true
  return levelForScore(score, true) === "Hold";
}
