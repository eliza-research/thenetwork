import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { VenueLinkProps } from "./SubjectLink.tsx";

type Context = { args: VenueLinkProps; canvasElement: HTMLElement };

/** The row under the link: a click on the link must not reach it (the link calls `stopPropagation`). */
const onRow = fn();

export const meta: ComponentMeta<VenueLinkProps> = {
  args: { children: "Brooklyn Boulders" },
  examples: { "Own title": { title: "Show Brooklyn Boulders on the map" } },
  // The row only records clicks for the play test; it is not a control.
  decorator: (story) => <div onClick={onRow}>{story()}</div>,
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const link = within(canvasElement).getByRole("button", { name: "Brooklyn Boulders" });
      await expect(link.getAttribute("title")).toBe("Show on the map");
      await userEvent.click(link);
      await expect(args.onShow).toHaveBeenCalledTimes(1);
      await expect(onRow).not.toHaveBeenCalled();
    },
    "Own title": async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByRole("button", { name: "Brooklyn Boulders" }).getAttribute("title")).toBe("Show Brooklyn Boulders on the map");
    },
  },
};
