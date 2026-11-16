import type { ComponentMeta } from "../lib/meta.ts";
import type { LinkProps } from "./Link.tsx";

export const meta: ComponentMeta<LinkProps> = {
  args: { href: "#orders", children: "Orders" },
  examples: {
    AsChild: { asChild: true, children: <a href="#returns">Returns</a> },
    Empty: { "aria-label": "Orders", children: undefined },
  },
};
