import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { ConfigFieldProps } from "./ConfigField.tsx";

type Context = { args: ConfigFieldProps; canvasElement: HTMLElement };

const noButton = async ({ canvasElement }: Context) => {
  await expect(within(canvasElement).queryByRole("button")).toBeNull();
};

export const meta: ComponentMeta<ConfigFieldProps> = {
  args: { control: "SwitchControl", phase: "ConfigShown", matchingOn: true, canPress: true, review: "human" },
  examples: {
    Confirming: { phase: "ConfigConfirming", canPress: false, canConfirm: true },
    Locked: { control: "LockedNote", matchingOn: false },
    "Admin only": { control: "AdminOnlyNote" },
    Refused: { phase: "ConfigFailed", error: "refused" },
    Saving: { phase: "ConfigSaving", canPress: false },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Turn off" }));
      await expect(args.onPress).toHaveBeenCalledTimes(1);
      await expect(args.onConfirm).not.toHaveBeenCalled();
      await expect(canvas.getByText("Review: human")).toBeTruthy();
    },
    Confirming: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: "Turn off" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Confirm: turn off" }));
      await expect(args.onConfirm).toHaveBeenCalledTimes(1);
      await expect(args.onPress).not.toHaveBeenCalled();
    },
    Locked: noButton,
    "Admin only": noButton,
    Refused: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByRole("alert").textContent).toBe("refused");
    },
    Saving: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const button = within(canvasElement).getByRole("button", { name: "Turn off" });
      await expect(button.getAttribute("aria-busy")).toBe("true");
      await userEvent.click(button, { pointerEventsCheck: 0 });
      await expect(args.onPress).not.toHaveBeenCalled();
    },
  },
};
