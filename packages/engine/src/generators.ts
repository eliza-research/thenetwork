// Opportunity generators. Moved: the generic building blocks to genkit.ts, The Network's 11
// generators (and their order) to packs/network/generators.ts (networkPack.generators). This shim
// keeps every existing import working.
import { HOUR } from "@thenetwork/core";
import type { OpportunityKind } from "@thenetwork/core";
import { tokenize } from "./embed.ts";
import { bestShareable, label } from "./genkit.ts";
import { CATEGORY_LABEL } from "./packs/network/copy.ts";
import { NETWORK_GENERATORS } from "./packs/network/generators.ts";

export { benefitForProvider, bestShareable, eventRiskText, intentFormat, label, makeCandidate, warmPathValue, type GenCtx } from "./genkit.ts";
export {
  complementaryIntents, eventAnchor, expansion, groupComposer, helpRequest, intentToCapability, networkGrowth, newcomerWelcome,
  romanceIntros, secondEncounter, sharedIntentPooling, warmPath,
} from "./packs/network/generators.ts";
/** The Network's generators in order (networkPack.generators). */
export const GENERATORS = NETWORK_GENERATORS;

export const _internal = { label, bestShareable, CATEGORY_LABEL, HOUR, tokenize };
export type { OpportunityKind };
