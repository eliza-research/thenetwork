import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import { ntwrkBrand } from "../../../core/src/generated/brandIdentity.ts";
import { type AgentId, agentLinkTemplate, agentName } from "../../../core/src/generated/landingEntry.ts";
import { agentHref, landingLinks } from "../brand/landing.ts";
import type { ComponentMeta } from "../lib/meta.ts";
import type { AgentTileProps } from "./AgentTile.tsx";

type Context = { args: AgentTileProps; canvasElement: HTMLElement };

const links = landingLinks(ntwrkBrand.app, { skillVersion: "1.0.0", textLine: "+15555550100" });

const opens = (agent: AgentId) => async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  const link = within(canvasElement).getByRole("link", { name: `Open in ${agentName(agent)}` });
  const href = link.getAttribute("href") ?? "";
  await expect(href).toBe(agentHref(agent, links));
  await expect(href.startsWith(agentLinkTemplate(agent).split("{")[0])).toBe(true);
  await expect(link.getAttribute("target")).toBe("_blank");
  link.addEventListener("click", (event) => event.preventDefault());
  await userEvent.click(link);
  await expect(args.onChoose).toHaveBeenCalledWith(agent);
};

export const meta: ComponentMeta<AgentTileProps> = {
  args: { agent: "ChatGpt", href: agentHref("ChatGpt", links), onChoose: fn() },
  examples: {
    "Copy only": { agent: "Muse", href: undefined },
    "agent Claude": { agent: "Claude", href: agentHref("Claude", links) },
    "agent Grok": { agent: "Grok", href: agentHref("Grok", links) },
    "agent Muse": { agent: "Muse", href: agentHref("Muse", links) },
    "agent Gemini": { agent: "Gemini", href: agentHref("Gemini", links) },
    "agent Perplexity": { agent: "Perplexity", href: agentHref("Perplexity", links) },
    "agent Cursor": { agent: "Cursor", href: agentHref("Cursor", links) },
    "agent OpenClaw": { agent: "OpenClaw", href: agentHref("OpenClaw", links) },
    "agent Hermes": { agent: "Hermes", href: agentHref("Hermes", links) },
  },
  play: {
    Default: opens("ChatGpt"),
    "Copy only": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("link")).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Copy the prompt for Muse" }));
      await expect(args.onChoose).toHaveBeenCalledWith("Muse");
    },
    "agent Claude": opens("Claude"),
    "agent Grok": opens("Grok"),
    "agent Muse": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(args.href).toBeUndefined();
      await expect(canvas.queryByRole("link")).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Copy the prompt for Muse" }));
      await expect(args.onChoose).toHaveBeenCalledWith("Muse");
    },
    "agent Gemini": opens("Gemini"),
    "agent Perplexity": opens("Perplexity"),
    "agent Cursor": opens("Cursor"),
    "agent OpenClaw": opens("OpenClaw"),
    "agent Hermes": opens("Hermes"),
  },
};
