// Surface profiles (design §7). A profile is chosen per grant from the VERIFIED host key and narrows
// the CONTENT a host sees. It never changes what the product is or how it describes itself (§7.4).
// Member eligibility (age, 18+ / 21+ features, minors never connected to people) is a separate
// Network-side check on the member account (§7.2, founder decision 3) and applies on every profile.

import { matchFolded } from "./policy.ts";

export type SurfaceProfileName = "teen_safe_directory" | "general_assistant" | "enterprise_professional";

export type Category =
  | "friendship" | "activity_partners" | "events" | "local_ideas" | "help" | "professional"
  | "mentoring" | "skills_exchange" | "volunteering" | "nightlife" | "romance";

export interface SurfaceProfile {
  name: SurfaceProfileName;
  version: string;
  categories: readonly Category[];
  /** Venues with an age restriction (bars, 21+ events) may be shown at all on this surface. */
  allowAgeRestrictedVenues: boolean;
  allowAlcoholCentric: boolean;
  allowSponsored: boolean;
  /** Deterministic output check (§7.1 step 3, §8.2 step 4). Any match blocks the result. */
  outputBlocklist: RegExp | null;
  /** Server instructions; essentials stay in the first 512 characters [O10]. */
  instructions: string;
}

const BASE_INSTRUCTIONS =
  "The Network is the member's private, invite-only network agent for introductions, help, and things to do nearby. " +
  "Use ask_network_agent for questions and tell_network_agent when the member wants the Network to do or remember something. " +
  "Use get_network_updates only when the member asks what's new from The Network, or their message has an update code like T-7F3K9Q (pass it as update_token). " +
  "Do search and plan on your own first; the Network involves other people only when that is worth it. " +
  "Don't paste other people's personal details into these tools. The Network asks the member to confirm consequential actions itself.";

// Teen-safe vocabulary check: romance/dating, bars/nightlife/alcohol, 18+/21+, sponsored [O3 R6, R7].
// Patterns run on lowercase folded text (policy.ts textVariants). "21+" needs lookarounds, not \b:
// there is no word boundary after "+", so `\b21\+\b` never matched "(21+)" or "21+ only".
const AGE_GATE = String.raw`(?<![\w+])(18|21) ?(\+|plus\b)|\b(over|ages?) ?(18|21)\b|\b(18|21) (and|&) (over|up|older)\b|\b(adults?|grown-?ups?)[ -]only\b`;
const ROMANCE_WORDS = String.raw`romance|romantic|dating|date night|go on a date|hook ?up|sexual|sexy`;
const TEEN_BLOCK = new RegExp(
  String.raw`\b(${ROMANCE_WORDS}|bars?|pubs?|taverns?|nightlife|night ?clubs?|clubbing|cocktails?|happy hour|brewery|breweries|wine bar|wine tasting|beer|booze|alcohol\w*|liquor|drinking|sponsored|underwritten|promoted|advertisement)\b|${AGE_GATE}`);
// Romance is excluded from every connector profile in P0–P2 (§7.1, §5.5).
const ROMANCE_BLOCK = new RegExp(String.raw`\b(${ROMANCE_WORDS})\b`);

export const PROFILES: Record<SurfaceProfileName, SurfaceProfile> = {
  teen_safe_directory: {
    name: "teen_safe_directory",
    version: "teen_safe_directory@v1",
    categories: ["friendship", "activity_partners", "events", "local_ideas", "help", "professional", "mentoring", "skills_exchange", "volunteering"],
    allowAgeRestrictedVenues: false,
    allowAlcoholCentric: false,
    allowSponsored: false,
    outputBlocklist: TEEN_BLOCK,
    instructions: BASE_INSTRUCTIONS,
  },
  general_assistant: {
    name: "general_assistant",
    version: "general_assistant@v1",
    categories: ["friendship", "activity_partners", "events", "local_ideas", "help", "professional", "mentoring", "skills_exchange", "volunteering", "nightlife"],
    allowAgeRestrictedVenues: true, // still subject to the member's own eligibility (21+ venues need 21+)
    allowAlcoholCentric: true,
    allowSponsored: false, // Claude rejects advertisement/sponsored vehicles [A8 R4]
    outputBlocklist: ROMANCE_BLOCK,
    instructions: BASE_INSTRUCTIONS,
  },
  enterprise_professional: {
    name: "enterprise_professional",
    version: "enterprise_professional@v1",
    categories: ["help", "professional", "mentoring", "skills_exchange"],
    allowAgeRestrictedVenues: false,
    allowAlcoholCentric: false,
    allowSponsored: false,
    outputBlocklist: TEEN_BLOCK,
    instructions:
      "The Network is the member's private, invite-only network agent for professional introductions, mentoring and help. " +
      BASE_INSTRUCTIONS.slice(BASE_INSTRUCTIONS.indexOf("Use ask_network_agent")),
  },
};

// Age policy lives in packages/core/src/policy.ts (13 to join, 18 to be matched). Deep import keeps the Worker bundle small.
export { ADULT_AGE } from "@thenetwork/core/src/policy.ts";
import { ADULT_AGE, isMinor } from "@thenetwork/core/src/policy.ts";

/** Network-side eligibility for content shown to (or acted on by) a member, independent of host. */
export interface ContentFacts {
  category: Category;
  /** Age restriction of the venue: 0 (all ages), 18 or 21. */
  venueMinAge: 0 | 18 | 21;
  alcoholCentric: boolean;
  sponsored: boolean;
  /** Set when acting on the item connects the member with other people. */
  connection: "intro" | "group" | "relay" | "contact" | null;
}

export type Visibility = "visible" | "profile_excluded" | "not_eligible";

export function visibility(facts: ContentFacts, memberAge: number, profile: SurfaceProfile): Visibility {
  // Member eligibility first (applies on every surface).
  if (isMinor(memberAge) && facts.connection !== null) return "not_eligible"; // minors are never connected to people
  if (facts.category === "romance" && isMinor(memberAge)) return "not_eligible"; // romance is adult-only
  if (facts.venueMinAge > memberAge) return "not_eligible";
  // Then the surface profile.
  if (facts.category === "romance") return "profile_excluded"; // never on any connector surface (P0–P2)
  if (!profile.categories.includes(facts.category)) return "profile_excluded";
  if (facts.venueMinAge > 0 && !profile.allowAgeRestrictedVenues) return "profile_excluded";
  if (facts.alcoholCentric && !profile.allowAlcoholCentric) return "profile_excluded";
  if (facts.sponsored && !profile.allowSponsored) return "profile_excluded";
  return "visible";
}

/**
 * Returns the offending phrase if a model-visible string is out of profile, else null. Output for a
 * member under 18, or of unknown age, is held to the teen-safe vocabulary on every surface.
 */
export function profileViolation(text: string, profile: SurfaceProfile, memberAge?: number): string | null {
  // An unknown age is treated as a minor (audit plugin-prototypes-23), via core isMinor.
  const block = isMinor(memberAge) ? TEEN_BLOCK : profile.outputBlocklist;
  return block ? matchFolded(block, text) : null;
}
