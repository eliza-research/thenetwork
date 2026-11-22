import type { ReactNode } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../lib/meta.ts";
import { type ToastProps, Toaster } from "./Toast.tsx";

export const meta: ComponentMeta<ToastProps> = {
  args: { children: "Copied" },
  decorator: (story: () => ReactNode) => <Toaster className="static">{story()}</Toaster>,
  play: {
    Default: async ({ args, canvasElement }: { args: ToastProps; canvasElement: HTMLElement }) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("status").textContent).toBe("Copied");
      await userEvent.click(canvas.getByRole("button", { name: "Close" }));
      await expect(args.onDismiss).toHaveBeenCalled();
    },
  },
};
