import { expect, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { ScopeListProps } from "./ScopeList.tsx";

export const meta: ComponentMeta<ScopeListProps> = {
  args: { scopes: ["apps:read", "membership:read", "profile:write"] },
  examples: { Empty: { scopes: [] } },
  play: {
    Default: async ({ canvasElement }: { canvasElement: HTMLElement }) => {
      const items = within(canvasElement).getAllByRole("listitem");
      await expect(items).toHaveLength(3);
      await expect(items.some((item) => item.textContent?.includes(":"))).toBe(false);
    },
  },
};
