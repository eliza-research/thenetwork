import { expect, fn, userEvent, within } from "storybook/test";
import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PromptCopyProps } from "./PromptCopy.tsx";

export const meta: ComponentMeta<PromptCopyProps> = {
  args: { prompt: landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }).prompt, copy: "CopyReady", canCopy: true, onCopy: fn() },
  examples: { "Without script": { copy: "CopyHidden", canCopy: false } },
  play: {
    Default: async ({ args, canvasElement }: { args: PromptCopyProps; canvasElement: HTMLElement }) => {
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Copy" }));
      await expect(args.onCopy).toHaveBeenCalled();
    },
    "Without script": async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      await expect(within(canvasElement).queryByRole("button")).toBeNull();
    },
  },
};
