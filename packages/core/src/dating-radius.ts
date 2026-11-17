import { withinAdjustedRadius } from "./generated/datingRadius.ts";

/** Compare both travel limits without rounding distance or the privacy margin. */
export function withinMutualRadius(miles: number, margin: number, firstLimit: number, secondLimit: number): boolean {
  return withinAdjustedRadius(miles + margin, firstLimit, secondLimit);
}
