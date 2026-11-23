import { expect, within } from "storybook/test";
import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { type AgentId, agentName, agentToastText, copyByHandText } from "../../../core/src/generated/landingEntry.ts";
import { landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { StatusLineProps } from "./StatusLine.tsx";

type Context = { args: StatusLineProps; canvasElement: HTMLElement };

const text = (canvasElement: HTMLElement) => within(canvasElement).getByRole("status").textContent ?? "";

const namesAgent = (agent: AgentId) => async ({ canvasElement }: Context) => {
  await expect(text(canvasElement)).toBe(agentToastText(agent));
  await expect(text(canvasElement)).toContain(agentName(agent));
};

const filled = async ({ args, canvasElement }: Context) => {
  await expect(text(canvasElement)).toContain(args.links.textLine);
  await expect(text(canvasElement)).not.toMatch(/[{}]/);
};

export const meta: ComponentMeta<StatusLineProps> = {
  args: { status: "AgentOpening", agent: "Claude", links: landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" }) },
  examples: {
    "status StatusEmpty": { status: "StatusEmpty" },
    "status PasteInAgent": { status: "PasteInAgent", agent: "Gemini" },
    "status SendToAgentApp": { status: "SendToAgentApp", agent: "Hermes" },
    "status CopyByHand": { status: "CopyByHand" },
    "status MessageCopied": { status: "MessageCopied" },
    "status TextTheNumber": { status: "TextTheNumber" },
  },
  play: {
    Default: namesAgent("Claude"),
    "status StatusEmpty": async ({ canvasElement }: Context) => {
      await expect(text(canvasElement)).toBe("");
    },
    "status PasteInAgent": namesAgent("Gemini"),
    "status SendToAgentApp": namesAgent("Hermes"),
    "status CopyByHand": async ({ canvasElement }: Context) => {
      await expect(text(canvasElement)).toBe(copyByHandText);
    },
    "status MessageCopied": filled,
    "status TextTheNumber": async (context: Context) => {
      await filled(context);
      await expect(text(context.canvasElement)).toContain(context.args.links.joinMessage);
    },
  },
};
