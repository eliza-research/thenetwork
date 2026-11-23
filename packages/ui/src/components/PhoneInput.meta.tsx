import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { PhoneInputProps } from "./PhoneInput.tsx";

type Context = { args: PhoneInputProps; canvasElement: HTMLElement };

const field = (canvasElement: HTMLElement) => within(canvasElement).getByRole<HTMLInputElement>("textbox", { name: "Mobile number" });

export const meta: ComponentMeta<PhoneInputProps> = {
  args: { "aria-label": "Mobile number", placeholder: "(212) 555-0123", onChange: fn() },
  examples: { "No autofill": { autoComplete: "off" } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const input = field(canvasElement);
      await expect(input.getAttribute("type")).toBe("tel");
      await expect(input.getAttribute("autocomplete")).toBe("tel");
      await userEvent.type(input, "2125550123");
      await expect(input.value).toBe("2125550123");
      await expect(args.onChange).toHaveBeenCalledTimes(10);
    },
    "No autofill": async ({ canvasElement }: Context) => {
      await expect(field(canvasElement).getAttribute("autocomplete")).toBe("off");
    },
    Error: async ({ canvasElement }: Context) => {
      await expect(field(canvasElement).getAttribute("aria-invalid")).toBe("true");
    },
  },
};
