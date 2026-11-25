import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { CodeInputProps } from "./CodeInput.tsx";

type Context = { args: CodeInputProps; canvasElement: HTMLElement };

const field = (canvasElement: HTMLElement) => within(canvasElement).getByRole<HTMLInputElement>("textbox", { name: "Code" });

export const meta: ComponentMeta<CodeInputProps> = {
  args: { "aria-label": "Code", onChange: fn() },
  examples: { "Six digits": { maxLength: 6 } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const input = field(canvasElement);
      await expect(input.getAttribute("autocomplete")).toBe("one-time-code");
      await expect(input.getAttribute("inputmode")).toBe("numeric");
      await userEvent.type(input, "1234567890");
      await expect(input.value).toBe("12345678");
      await expect(args.onChange).toHaveBeenCalledTimes(8);
    },
    "Six digits": async ({ canvasElement }: Context) => {
      const input = field(canvasElement);
      await userEvent.type(input, "12345678");
      await expect(input.value).toBe("123456");
    },
    Error: async ({ canvasElement }: Context) => {
      await expect(field(canvasElement).getAttribute("aria-invalid")).toBe("true");
    },
  },
};
