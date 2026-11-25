import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import type { TextareaProps } from "./Textarea.tsx";

type Context = { args: TextareaProps; canvasElement: HTMLElement };

const field = (canvasElement: HTMLElement) => within(canvasElement).getByRole<HTMLTextAreaElement>("textbox", { name: "Notes" });

export const meta: ComponentMeta<TextareaProps> = {
  args: { "aria-label": "Notes", onChange: fn() },
  examples: { Filled: { defaultValue: "Two lines\nof notes" } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const input = field(canvasElement);
      await userEvent.type(input, "Hi{Enter}there");
      await expect(input.value).toBe("Hi\nthere");
      await expect(args.onChange).toHaveBeenCalledTimes(8);
    },
    Filled: async ({ canvasElement }: Context) => {
      await expect(field(canvasElement).value).toBe("Two lines\nof notes");
    },
    Error: async ({ canvasElement }: Context) => {
      await expect(field(canvasElement).getAttribute("aria-invalid")).toBe("true");
    },
  },
};
