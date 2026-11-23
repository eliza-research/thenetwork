import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { MemberLinkProps } from "./SubjectLink.tsx";

type Context = { args: MemberLinkProps; canvasElement: HTMLElement };

const onRow = fn();

export const meta: ComponentMeta<MemberLinkProps> = {
  args: { children: "Maya + Jon" },
  decorator: (story) => <div onClick={onRow}>{story()}</div>,
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const link = within(canvasElement).getByRole("button", { name: "Maya + Jon" });
      await expect(link.getAttribute("data-subject")).toBe("OpportunitySubject");
      await userEvent.click(link);
      await expect(args.onOpen).toHaveBeenCalledTimes(1);
      await expect(onRow).not.toHaveBeenCalled();
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).queryByRole("button")).toBeNull();
    },
  },
};
