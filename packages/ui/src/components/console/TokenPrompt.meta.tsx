import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { TokenPromptProps } from "./TokenPrompt.tsx";

type Context = { args: TokenPromptProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<TokenPromptProps> = {
  args: { value: "" },
  examples: { Filled: { value: " obs_3f9c ", canSubmit: true }, "Without title": { title: null } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("form", { name: "Token required" })).toBeTruthy();
      await userEvent.type(canvas.getByLabelText("Observatory token"), "x{Enter}");
      await expect(args.onValueChange).toHaveBeenCalledWith("x");
      await expect(args.onSubmitToken).not.toHaveBeenCalled();
    },
    Filled: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Use" }));
      await expect(args.onSubmitToken).toHaveBeenCalledWith("obs_3f9c");
      await userEvent.type(canvas.getByLabelText("Observatory token"), "{Enter}");
      await expect(args.onSubmitToken).toHaveBeenCalledTimes(2);
    },
    "Without title": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("heading")).toBeNull();
      await expect(canvas.getByRole("form", { name: "Observatory token" })).toBeTruthy();
    },
  },
};
