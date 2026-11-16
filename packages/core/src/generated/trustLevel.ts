// GENERATED from spec/trustLevel.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
export type TrustLevel = "Ok" | "Watch" | "Hold";

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
export const watchScore: number = 3;
/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
export const holdScore: number = 6;

/** Story: Pause unsafe activity / Trust scores at three trigger watch and scores at six trigger hold (spec/trustLevel.md) */
//@ pure
export function levelForScore(score: number, held: boolean): TrustLevel {
  return held || score >= holdScore ? "Hold" : (score >= watchScore ? "Watch" : "Ok");
}

/** Story: Pause unsafe activity / A hold stays in place until staff lift it (spec/trustLevel.md) */
//@ pure
export function lawScoreUpdatesKeepHolds(score: number): boolean {
  //@ ensures \result === true
  return levelForScore(score, true) === "Hold";
}
