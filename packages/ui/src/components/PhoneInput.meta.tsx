import type { ComponentMeta } from "../lib/meta.ts";
import type { PhoneInputProps } from "./PhoneInput.tsx";

export const meta: ComponentMeta<PhoneInputProps> = {
  args: { "aria-label": "Mobile number", placeholder: "(212) 555-0123" },
};
