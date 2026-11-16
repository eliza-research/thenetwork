// GENERATED from spec/boundedHelp.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md:12) */
export type BoundedHelpRoute = "SearchPublicHelp" | "ReviewHomeEntryHelp" | "RefuseHighRiskHelp";


/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md:12) */
//@ pure
export function openHomeHelpCase(adult: boolean, hasOpenCase: boolean): boolean {
  return adult && !hasOpenCase;
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md:12) */
//@ pure
export function boundedHelpRoute(highRisk: boolean, homeEntry: boolean): BoundedHelpRoute {
  return highRisk ? "RefuseHighRiskHelp" : (homeEntry ? "ReviewHomeEntryHelp" : "SearchPublicHelp");
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md:12) */
//@ pure
export function lawHomeHelpNeverUsesPublicSearch(highRisk: boolean): boolean {
  //@ ensures \result === true
  return boundedHelpRoute(highRisk, true) !== "SearchPublicHelp";
}

/** Story: Ask for manageable help without unexpected contact / A direct home-entry request goes to staff before contacting helpers (spec/boundedHelp.md:12) */
//@ pure
export function lawHighRiskHelpTakesPrecedence(homeEntry: boolean): boolean {
  //@ ensures \result === true
  return boundedHelpRoute(true, homeEntry) === "RefuseHighRiskHelp";
}

/** Story: Ask for manageable help without unexpected contact / An unfamiliar helper cannot be the only helper for home entry (spec/boundedHelp.md:38) */
//@ pure
export function homeHelperSetAllowed(helperCount: number, knownSingleton: boolean): boolean {
  return helperCount >= 2 || (helperCount === 1 && knownSingleton);
}

/** Story: Ask for manageable help without unexpected contact / An unfamiliar helper cannot be the only helper for home entry (spec/boundedHelp.md:38) */
//@ pure
export function needsSecondHomeHelper(homeEntry: boolean, requestedHelpers: number, knownSingleton: boolean): boolean {
  return homeEntry && requestedHelpers === 1 && !knownSingleton;
}

/** Story: Ask for manageable help without unexpected contact / An unfamiliar helper cannot be the only helper for home entry (spec/boundedHelp.md:38) */
//@ pure
export function lawUnfamiliarHomeSingletonIsDisallowed(helperCount: number): boolean {
  //@ ensures \result === true
  return !(helperCount < 2) || !homeHelperSetAllowed(helperCount, false);
}
