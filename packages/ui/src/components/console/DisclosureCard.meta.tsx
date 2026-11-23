import type { ComponentMeta } from "../../lib/meta.ts";
import type { DisclosureCardProps } from "./DisclosureCard.tsx";

export const meta: ComponentMeta<DisclosureCardProps> = {
  args: { summary: "Maya + Jon", children: "Both like early climbing sessions in Long Island City." },
  examples: { Open: { defaultOpen: true } },
};
