import type { ComponentMeta } from "../lib/meta.ts";
import type { SkipLinkProps } from "./SkipLink.tsx";

export const meta: ComponentMeta<SkipLinkProps> = {
  args: { children: "Skip to content" },
  examples: { Empty: { "aria-label": "Skip to content", children: undefined } },
};
