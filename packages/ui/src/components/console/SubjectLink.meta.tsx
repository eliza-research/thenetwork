import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SubjectLinkProps } from "./SubjectLink.tsx";

type Context = { args: SubjectLinkProps; canvasElement: HTMLElement };

const onRow = fn();

const opens = (name: string, subject: string) => async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  const link = within(canvasElement).getByRole("button", { name });
  await expect(link.getAttribute("data-subject")).toBe(subject);
  await userEvent.click(link);
  await expect(args.onOpen).toHaveBeenCalledTimes(1);
  await expect(onRow).not.toHaveBeenCalled();
};

export const meta: ComponentMeta<SubjectLinkProps> = {
  args: { subject: "MemberSubject", children: "Maya Chen" },
  examples: { "Named by label": { children: undefined, "aria-label": "Open member m_102" } },
  decorator: (story) => <div onClick={onRow}>{story()}</div>,
  play: {
    Default: opens("Maya Chen", "MemberSubject"),
    "Named by label": opens("Open member m_102", "MemberSubject"),
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).queryByRole("button")).toBeNull();
    },
    "subject NeighborhoodSubject": opens("Maya Chen", "NeighborhoodSubject"),
    "subject OpportunitySubject": opens("Maya Chen", "OpportunitySubject"),
  },
};
