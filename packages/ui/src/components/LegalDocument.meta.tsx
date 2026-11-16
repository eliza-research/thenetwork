import { privacyFor, termsFor } from "../content/legal/index.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { LegalDocumentProps } from "./LegalDocument.tsx";

export const meta: ComponentMeta<LegalDocumentProps> = {
  args: { app: "Slop", text: termsFor.Slop },
  examples: {
    SlopPrivacy: { app: "Slop", text: privacyFor.Slop },
    NetworkTerms: { app: "Ntwrk", text: termsFor.Ntwrk },
    NetworkPrivacy: { app: "Ntwrk", text: privacyFor.Ntwrk },
    FriendsTerms: { app: "Friends", text: termsFor.Friends },
    FriendsPrivacy: { app: "Friends", text: privacyFor.Friends },
    PeonTerms: { app: "Peon", text: termsFor.Peon },
    PeonPrivacy: { app: "Peon", text: privacyFor.Peon },
  },
};
