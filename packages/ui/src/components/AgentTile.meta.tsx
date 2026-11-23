import { expect, fn, userEvent, within } from "storybook/test";
import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { agentHref, landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AgentTileProps } from "./AgentTile.tsx";

const links = landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" });

export const meta: ComponentMeta<AgentTileProps> = {
  args: { agent: "ChatGpt", href: agentHref("ChatGpt", links), onChoose: fn() },
  examples: { "Copy only": { agent: "Muse", href: undefined } },
  play: {
    "Copy only": async ({ args, canvasElement }: { args: AgentTileProps; canvasElement: HTMLElement }) => {
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Copy the prompt for Muse" }));
      await expect(args.onChoose).toHaveBeenCalledWith("Muse");
    },
  },
};
