import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { RevealControlProps } from "./RevealControl.tsx";

type Context = { args: RevealControlProps; canvasElement: HTMLElement };

const granted = { ...initial.reveal, phase: "RevealGranted" as const, reasonReady: true };

export const meta: ComponentMeta<RevealControlProps> = {
  args: { reveal: initial.reveal, canStart: true, reason: "" },
  examples: {
    Drafting: { reveal: { ...initial.reveal, phase: "RevealDrafting" } },
    "Reason ready": { reveal: { ...initial.reveal, phase: "RevealDrafting", reasonReady: true }, reason: "Case 41 evidence", canSubmit: true },
    Sending: { reveal: { ...initial.reveal, phase: "RevealSending", reasonReady: true }, reason: "Case 41 evidence", canSubmit: false },
    Granted: { reveal: granted, minutesLeft: 12, grantedReason: "Case 41 evidence" },
    Expired: { reveal: granted, minutesLeft: 0, grantedReason: "Case 41 evidence" },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Reveal" }));
      await expect(args.onStart).toHaveBeenCalledTimes(1);
    },
    Drafting: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      const reason = canvas.getByRole("textbox", { name: "Reason" });
      await userEvent.type(reason, "C");
      await expect(args.onReasonChange).toHaveBeenCalledWith("C");
      await userEvent.type(reason, "{Enter}");
      await userEvent.click(canvas.getByRole("button", { name: "Reveal" }), { pointerEventsCheck: 0 });
      await expect(args.onSubmit).not.toHaveBeenCalled();
      await userEvent.type(reason, "{Escape}");
      await expect(args.onCancel).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
      await expect(args.onCancel).toHaveBeenCalledTimes(2);
    },
    "Reason ready": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Reveal" }));
      await expect(args.onSubmit).toHaveBeenCalledTimes(1);
      await userEvent.type(canvas.getByRole("textbox", { name: "Reason" }), "{Enter}");
      await expect(args.onSubmit).toHaveBeenCalledTimes(2);
    },
    Sending: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole<HTMLInputElement>("textbox", { name: "Reason" }).disabled).toBe(true);
      const reveal = canvas.getByRole("button", { name: "Reveal" });
      await expect(reveal.getAttribute("aria-busy")).toBe("true");
      await userEvent.click(reveal, { pointerEventsCheck: 0 });
      await userEvent.click(canvas.getByRole("button", { name: "Cancel" }), { pointerEventsCheck: 0 });
      await expect(args.onSubmit).not.toHaveBeenCalled();
      await expect(args.onCancel).not.toHaveBeenCalled();
    },
    Granted: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("12m left")).toBeTruthy();
      await userEvent.click(canvas.getByRole("button", { name: "End" }));
      await expect(args.onEnd).toHaveBeenCalledTimes(1);
    },
    Expired: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("expired")).toBeTruthy();
    },
  },
};
