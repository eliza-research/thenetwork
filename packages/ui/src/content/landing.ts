// spec/brandIdentity.md, "An app site never names The Network or another app"
import type { AppKey } from "../../../core/src/generated/brandIdentity.ts";

/** The search description of the landing page of each site. Each one names only its own site. */
export const landingDescriptionFor: Record<AppKey, string> = {
  Ntwrk: "Build your network. Your agent knows you: let it find you friends, dates and work.",
  Slop: "Your agent knows you. Let it find you the perfect date. Matching is for adults 18 and older.",
  Peon: "Your agent knows your work. Let it find you the perfect job. A person reviews every introduction.",
  Friends: "Your agent knows what you like. Let it find your best friends: small groups, public places.",
};
