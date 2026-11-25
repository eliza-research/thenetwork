import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { ProposeTrayProps } from "./ProposeTray.tsx";

type Context = { args: ProposeTrayProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<ProposeTrayProps> = {
  args: {
    phase: "TrayIdle",
    picks: [
      { id: "m1", name: "Maya Chen" },
      { id: "m2", name: "Jon Park", busy: true },
    ],
    formShown: true,
    group: false,
    canPropose: true,
    sparksLeft: 3,
    categories: ["social", "professional", "hobby", "help", "romance", "growth", "events"],
    category: "social",
    objective: "",
    why: "",
  },
  examples: {
    "One pick": { picks: [{ id: "m1", name: "Maya Chen" }], formShown: false, canPropose: false },
    "Group of three": {
      picks: [
        { id: "m1", name: "Maya Chen" },
        { id: "m2", name: "Jon Park" },
        { id: "m4", name: "Ana Ruiz" },
      ],
      group: true,
    },
    "Minor picked": { picks: [{ id: "m1", name: "Maya Chen" }, { id: "m3", name: "Sam Ortiz", minor: true }], minorPicked: true, canPropose: false },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.type(canvas.getByRole("textbox", { name: "Intro for" }), "c");
      await expect(args.onObjectiveChange).toHaveBeenCalledWith("c");
      await userEvent.type(canvas.getByRole("textbox", { name: "Why (shown to them)" }), "b");
      await expect(args.onWhyChange).toHaveBeenCalledWith("b");
      await userEvent.click(canvas.getByRole("button", { name: "Propose intro · 3 sparks" }));
      await expect(args.onPropose).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "Peek −25" }));
      await expect(args.onPeek).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "Remove Jon Park" }));
      await expect(args.onRemove).toHaveBeenCalledWith("m2");
      await userEvent.click(canvas.getByRole("button", { name: "Clear" }));
      await expect(args.onClear).toHaveBeenCalledTimes(1);
    },
    "One pick": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("textbox")).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Remove Maya Chen" }));
      await expect(args.onRemove).toHaveBeenCalledWith("m1");
    },
    "Group of three": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("textbox", { name: "Plan" })).toBeTruthy();
      await expect(canvas.getByRole("button", { name: "Propose group · 3 sparks" })).toBeTruthy();
    },
    "Minor picked": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvasElement.querySelector('svg[aria-label="under 18"]')).not.toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Propose intro · 3 sparks" }), { pointerEventsCheck: 0 });
      await expect(args.onPropose).not.toHaveBeenCalled();
    },
  },
};
