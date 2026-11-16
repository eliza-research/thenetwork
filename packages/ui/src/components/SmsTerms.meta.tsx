import { termsFor } from "../content/legal/index.ts";
import type { LegalText, SmsSlot, SmsTermsText } from "../content/legal/types.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { SmsTermsProps } from "./SmsTerms.tsx";

const smsOf = (terms: LegalText): SmsTermsText =>
  (terms.sections.find((s): s is SmsSlot => "sms" in s) as SmsSlot).sms;

export const meta: ComponentMeta<SmsTermsProps> = {
  args: { app: "Slop", text: smsOf(termsFor.Slop) },
  examples: {
    Network: { app: "Ntwrk", text: smsOf(termsFor.Ntwrk) },
    Friends: { app: "Friends", text: smsOf(termsFor.Friends) },
    Peon: { app: "Peon", text: smsOf(termsFor.Peon) },
  },
  play: {
    Default: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      if (!canvasElement.querySelector("#sms")) throw new Error("The section has no sms anchor.");
      if (canvasElement.querySelector('a[href="/join"]')) throw new Error("The terms link a join page that slop.date does not serve.");
    },
    Peon: ({ canvasElement }: { canvasElement: HTMLElement }) => {
      if (!canvasElement.querySelector('a[href="/join"]')) throw new Error("The peon.biz terms do not link the join page.");
    },
  },
};
