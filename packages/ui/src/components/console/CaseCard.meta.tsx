import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { CaseCardProps } from "./CaseCard.tsx";

type Context = { args: CaseCardProps; canvasElement: HTMLElement };

const row = { ...initial.caseRow, status: "CaseRowOpen" as const, onHold: true, expanded: true };

const head = (canvasElement: HTMLElement) => canvasElement.querySelector<HTMLElement>("[aria-expanded]")!;

const toggles = async ({ args, canvasElement }: Context) => {
  clearAllMocks();
  await userEvent.click(head(canvasElement));
  await expect(args.onToggle).toHaveBeenCalledTimes(1);
};

export const meta: ComponentMeta<CaseCardProps> = {
  args: {
    row,
    name: "Jon Park",
    level: { tone: "destructive", label: "hold" },
    urgent: true,
    meta: "open · opened Nov 14, 3:20 PM · 2 events",
    events: <p>Nov 14, 3:20 PM contact extraction · +40 pts</p>,
    actionsShown: true,
    note: "",
    canLift: true,
    canClose: true,
  },
  examples: {
    Collapsed: { row: { ...row, expanded: false } },
    Closed: { row: { ...row, status: "CaseRowClosed", onHold: false } },
    Lifting: { row: { ...row, caseSending: true, caseStep: "LiftStep" }, note: "Checked the thread", canLift: false, canClose: false },
    "Watch only": { actionsShown: false },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(head(canvasElement).getAttribute("aria-expanded")).toBe("true");
      await expect(canvas.getByText("Nov 14, 3:20 PM contact extraction · +40 pts")).toBeTruthy();
      await userEvent.type(canvas.getByRole("textbox", { name: "Decision note" }), "o");
      await expect(args.onNoteChange).toHaveBeenCalledWith("o");
      await userEvent.click(canvas.getByRole("button", { name: "Lift hold" }));
      await expect(args.onLift).toHaveBeenCalledTimes(1);
      await userEvent.click(canvas.getByRole("button", { name: "Close case" }));
      await expect(args.onClose).toHaveBeenCalledTimes(1);
      await toggles({ args, canvasElement });
    },
    Collapsed: async (context: Context) => {
      await expect(head(context.canvasElement).getAttribute("aria-expanded")).toBe("false");
      await expect(within(context.canvasElement).queryByRole("textbox")).toBeNull();
      await toggles(context);
    },
    Closed: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: "Lift hold" })).toBeNull();
      await expect(canvas.queryByRole("button", { name: "Close case" })).toBeNull();
      await expect(canvas.queryByText("urgent")).toBeNull();
    },
    Lifting: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByRole<HTMLInputElement>("textbox", { name: "Decision note" }).disabled).toBe(true);
      const lift = canvas.getByRole("button", { name: "Lift hold" });
      await expect(lift.getAttribute("aria-busy")).toBe("true");
      await userEvent.click(lift, { pointerEventsCheck: 0 });
      await userEvent.click(canvas.getByRole("button", { name: "Close case" }), { pointerEventsCheck: 0 });
      await expect(args.onLift).not.toHaveBeenCalled();
      await expect(args.onClose).not.toHaveBeenCalled();
    },
    "Watch only": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("textbox")).toBeNull();
      await expect(canvas.queryByRole("button", { name: "Lift hold" })).toBeNull();
    },
  },
};
