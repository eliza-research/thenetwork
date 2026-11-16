// spec/sitePages.md, "Every page links the privacy policy and the terms in its footer"
import type { AppKey } from "../../../../core/src/generated/brandIdentity.ts";
import type { LegalText } from "./types.ts";
import { friendsPrivacy } from "./friendsPrivacy.tsx";
import { friendsTerms } from "./friendsTerms.tsx";
import { ntwrkPrivacy } from "./ntwrkPrivacy.tsx";
import { ntwrkTerms } from "./ntwrkTerms.tsx";
import { peonPrivacy } from "./peonPrivacy.tsx";
import { peonTerms } from "./peonTerms.tsx";
import { slopPrivacy } from "./slopPrivacy.tsx";
import { slopTerms } from "./slopTerms.tsx";

export type { LegalSection, LegalText, SmsSlot, SmsTermsText } from "./types.ts";

/** The privacy policy of each site. */
export const privacyFor: Record<AppKey, LegalText> = { Ntwrk: ntwrkPrivacy, Slop: slopPrivacy, Peon: peonPrivacy, Friends: friendsPrivacy };

/** The terms of each site. */
export const termsFor: Record<AppKey, LegalText> = { Ntwrk: ntwrkTerms, Slop: slopTerms, Peon: peonTerms, Friends: friendsTerms };
