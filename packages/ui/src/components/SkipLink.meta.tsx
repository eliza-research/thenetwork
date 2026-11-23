import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { SkipLinkProps } from "./SkipLink.tsx";

type Context = { args: SkipLinkProps; canvasElement: HTMLElement };

const skips = async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).getByRole("link", { name: "Skip to content" }).getAttribute("href")).toBe("#main");
};

export const meta: ComponentMeta<SkipLinkProps> = {
  args: { children: "Skip to content" },
  examples: { Empty: { "aria-label": "Skip to content", children: undefined } },
  play: { Default: skips, Empty: skips },
};
