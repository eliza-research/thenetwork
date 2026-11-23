import type { ComponentMeta } from "../lib/meta.ts";
import type { DisclosureProps } from "./Disclosure.tsx";

export const meta: ComponentMeta<DisclosureProps> = {
  args: { summary: "Shipping", children: "Ships in two days." },
  examples: { Open: { defaultOpen: true } },
};
