import type { ComponentMeta } from "../lib/meta.ts";
import type { IconProps } from "./Icon.tsx";

export const meta: ComponentMeta<IconProps> = {
  args: { name: "chevronRight" },
  examples: {
    "Chevron down": { name: "chevronDown" },
    Close: { name: "close", label: "Close" },
    Back: { name: "back", label: "Back" },
    Small: { name: "close", size: "sm" },
  },
};
