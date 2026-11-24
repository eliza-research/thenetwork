import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SegmentsProps } from "./Segments.tsx";

type Context = { args: SegmentsProps; canvasElement: HTMLElement };

const options = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "all", label: "All" },
];

const radio = (canvasElement: HTMLElement, name: string) => within(canvasElement).getByRole("radio", { name });

export const meta: ComponentMeta<SegmentsProps> = {
  args: { "aria-label": "Range", defaultValue: "7d", options, onValueChange: fn() },
  examples: { "One choice off": { options: options.map((option) => (option.value === "all" ? { ...option, disabled: true, title: "Needs the full history" } : option)) } },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(radio(canvasElement, "7d").getAttribute("aria-checked")).toBe("true");
      await userEvent.click(radio(canvasElement, "Today"));
      await expect(args.onValueChange).toHaveBeenCalledWith("today");
      await expect(radio(canvasElement, "Today").getAttribute("aria-checked")).toBe("true");
    },
    "One choice off": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await userEvent.click(radio(canvasElement, "All"), { pointerEventsCheck: 0 });
      await expect(args.onValueChange).not.toHaveBeenCalled();
      await expect(radio(canvasElement, "7d").getAttribute("aria-checked")).toBe("true");
    },
  },
};
