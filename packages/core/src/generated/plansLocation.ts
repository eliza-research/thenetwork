// GENERATED from spec/plansLocation.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use the place I asked about / Resolve the stated place before using the member's location (spec/plansLocation.md) */
export type RecommendationLocation = "UseNamedArea" | "AskForArea" | "UseMemberLocation";


/** Story: Use the place I asked about / Resolve the stated place before using the member's location (spec/plansLocation.md) */
//@ pure
export function recommendationLocation(known: boolean, mentioned: boolean): RecommendationLocation {
  return known ? "UseNamedArea" : (mentioned ? "AskForArea" : "UseMemberLocation");
}

/** Story: Use the place I asked about / Resolve the stated place before using the member's location (spec/plansLocation.md) */
//@ pure
export function lawUnsupportedLocationNeverUsesHome(known: boolean): boolean {
  //@ ensures \result === true
  return recommendationLocation(known, true) !== "UseMemberLocation";
}

/** Story: Use the place I asked about / Resolve the stated place before using the member's location (spec/plansLocation.md) */
//@ pure
export function requestedAreaAllowsEvent(namedArea: boolean, eventInArea: boolean): boolean {
  return !namedArea || eventInArea;
}

/** Story: Use the place I asked about / Resolve the stated place before using the member's location (spec/plansLocation.md) */
//@ pure
export function lawNamedAreaDoesNotShowUnrelatedListings(namedArea: boolean): boolean {
  //@ ensures \result === true
  return !namedArea || !requestedAreaAllowsEvent(namedArea, false);
}
