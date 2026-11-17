// GENERATED from spec/networkIntentLane.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Use my request as the purpose of the introduction / One request can open one lane (spec/networkIntentLane.md) */
export type NetworkIntentRoute = "NoRoute" | "FriendRoute" | "IntroRoute" | "CofounderRoute" | "MentorOfferRoute" | "MentorSeekRoute" | "InvestOfferRoute" | "InvestSeekRoute";


/** Story: Use my request as the purpose of the introduction / One request can open one lane (spec/networkIntentLane.md) */
//@ pure
export function networkIntentRoute(eligibleCategory: boolean, specific: NetworkIntentRoute, professional: boolean): NetworkIntentRoute {
  return !eligibleCategory ? "NoRoute" : (specific !== "NoRoute" ? specific : (professional ? "IntroRoute" : "FriendRoute"));
}

/** Story: Use my request as the purpose of the introduction / One request can open one lane (spec/networkIntentLane.md) */
//@ pure
export function lawExcludedNetworkIntentHasNoRoute(specific: NetworkIntentRoute, professional: boolean): boolean {
  //@ ensures \result === true
  return networkIntentRoute(false, specific, professional) === "NoRoute";
}

/** Story: Use my request as the purpose of the introduction / One request can open one lane (spec/networkIntentLane.md) */
//@ pure
export function lawExplicitNetworkIntentKeepsItsRoute(specific: NetworkIntentRoute, professional: boolean): boolean {
  //@ ensures \result === true
  return !(specific !== "NoRoute") || networkIntentRoute(true, specific, professional) === specific;
}

/** Story: Use my request as the purpose of the introduction / One request can open one lane (spec/networkIntentLane.md) */
//@ pure
export function lawNetworkIntentDefaultsOnlyWithNoSpecificRoute(professional: boolean): boolean {
  //@ ensures \result === true
  return networkIntentRoute(true, "NoRoute", professional) === (professional ? "IntroRoute" : "FriendRoute");
}

/** Story: Use my request as the purpose of the introduction / Each cofounder peer explicitly opts in under their app account (spec/networkIntentLane.md) */
//@ pure
export function cofounderPeersOptedIn(firstIntentLive: boolean, secondIntentLive: boolean): boolean {
  return firstIntentLive && secondIntentLive;
}

/** Story: Use my request as the purpose of the introduction / Each cofounder peer explicitly opts in under their app account (spec/networkIntentLane.md) */
//@ pure
export function lawEndedCofounderIntentBlocksIntroduction(otherIntentLive: boolean): boolean {
  //@ ensures \result === true
  return !cofounderPeersOptedIn(false, otherIntentLive) && !cofounderPeersOptedIn(otherIntentLive, false);
}
