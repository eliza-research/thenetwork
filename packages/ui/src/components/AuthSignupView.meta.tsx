import type { AuthSignupViewProps } from "./AuthSignupView.tsx";
import type { ComponentMeta } from "../lib/meta.ts";

export const meta: ComponentMeta<AuthSignupViewProps> = {
  args: {
    app: "Friends",
    rid: "r_0123456789abcdefghijk",
    consent: { text: "I agree to receive recurring text messages from friends.help. Reply STOP to stop and HELP for help.", version: "example" },
    requiresInvitation: false,
    signupView: "example-signup-view",
  },
  examples: {
    "Invitation required": { app: "Ntwrk", requiresInvitation: true },
    "Signup error": { error: "Check your details and try again." },
  },
};
