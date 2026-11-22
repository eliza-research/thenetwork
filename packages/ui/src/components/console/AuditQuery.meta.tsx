import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { AuditQueryProps } from "./AuditRow.tsx";

type Context = { args: AuditQueryProps; canvasElement: HTMLElement };

const refusesLoad = async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  const canvas = within(canvasElement);
  await userEvent.type(canvas.getByRole("textbox", { name: "Actor" }), "{Enter}");
  await userEvent.click(canvas.getByRole("button", { name: "Load" }), { pointerEventsCheck: 0 });
  await expect(args.onLoad).not.toHaveBeenCalled();
};

export const meta: ComponentMeta<AuditQueryProps> = {
  args: { phase: "AuditClosed", canLoad: true, actor: "", target: "" },
  examples: {
    Loading: { phase: "AuditLoading", canLoad: false, actor: "dana" },
    "Not an admin": { canLoad: false },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.type(canvas.getByRole("textbox", { name: "Actor" }), "d");
      await expect(args.onActorChange).toHaveBeenCalledWith("d");
      await userEvent.type(canvas.getByRole("textbox", { name: "Target id" }), "m");
      await expect(args.onTargetChange).toHaveBeenCalledWith("m");
      await userEvent.click(canvas.getByRole("button", { name: "Load" }));
      await expect(args.onLoad).toHaveBeenCalledTimes(1);
      await userEvent.type(canvas.getByRole("textbox", { name: "Target id" }), "{Enter}");
      await expect(args.onLoad).toHaveBeenCalledTimes(2);
    },
    Loading: async (context: Context) => {
      await expect(within(context.canvasElement).getByRole("button", { name: "Load" }).getAttribute("aria-busy")).toBe("true");
      await refusesLoad(context);
    },
    "Not an admin": refusesLoad,
  },
};
