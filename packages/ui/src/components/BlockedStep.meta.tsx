import { expect, within } from "storybook/test";
import { apiMessages } from "../api/client.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { BlockedStepProps } from "./BlockedStep.tsx";

type Context = { args: BlockedStepProps; canvasElement: HTMLElement };

const siteText = "peon.biz is not open to new members right now. Please try again later.";

const says = (text: string) => async ({ args, canvasElement }: Context) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByText(text)).toBeTruthy();
  await expect(canvas.getByRole("link", { name: args.homeLabel }).getAttribute("href")).toBe(args.homeHref ?? "/");
};

export const meta: ComponentMeta<BlockedStepProps> = {
  args: { reason: "UnderAge", homeLabel: "Back to peon.biz" },
  examples: {
    "Site text": { reason: "InviteOnly", messages: { InviteOnly: siteText } },
    "Own home link": { reason: "InReview", homeHref: "https://peon.biz/" },
  },
  play: {
    Default: says(apiMessages.under_age),
    "Site text": says(siteText),
    "Own home link": says(apiMessages.review),
    "reason InviteOnly": says(apiMessages.invite_only),
    "reason NotValid": says(apiMessages.invalid),
    "reason OtherReason": says(apiMessages.unknown),
  },
};
