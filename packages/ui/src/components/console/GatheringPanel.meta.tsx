import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { GatheringPanelProps, GatheringRow } from "./GatheringPanel.tsx";

type Story = { args: GatheringPanelProps; canvasElement: HTMLElement };

const draft: GatheringRow = { id: "g1", revision: 2, month: "2026-12", venue: "Bryant Park", window: "Dec 12, 2026, 7:00 PM – Dec 12, 2026, 9:00 PM", capacity: 40, phase: "GatheringDraft" };
const approved: GatheringRow = { id: "g0", revision: 3, month: "2026-11", venue: "Madison Square Park", window: "Nov 14, 2026, 6:00 PM – Nov 14, 2026, 8:00 PM", capacity: 60, phase: "GatheringApproved" };
const rejected: GatheringRow = { id: "g9", revision: 1, month: "2026-10", venue: "Washington Square Park", window: "Oct 10, 2026, 6:00 PM – Oct 10, 2026, 8:00 PM", capacity: 25, phase: "GatheringRejected" };
const choice = { id: "g1", revision: 2, decision: "approve" as const };

export const meta: ComponentMeta<GatheringPanelProps> = {
  args: {
    view: "PanelRows",
    formShown: true,
    rows: [draft, approved],
    venues: [{ id: "bryant-park", name: "Bryant Park" }, { id: "madison-square-park", name: "Madison Square Park" }],
  },
  examples: {
    Confirming: { choice },
    "Confirming rejection": { choice: { ...choice, decision: "reject" } },
    "Stale choice": { choice: { ...choice, revision: 1 } },
    Decided: { rows: [approved, rejected] },
    Saving: { saving: true },
    Refused: { view: "PanelForbidden", formShown: false, rows: [] },
    Unavailable: { view: "PanelUnavailable", formShown: false, rows: [] },
    "No gatherings": { view: "PanelEmpty", rows: [] },
    "Write failed": { error: "A gathering already occupies this month." },
  },
  play: {
    Default: async ({ args, canvasElement }: Story) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.getByText("draft")).toBeTruthy();
      await expect(canvas.getByText("approved")).toBeTruthy();
      await expect(canvas.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
      await userEvent.click(canvas.getByRole("button", { name: "Approve" }));
      await expect(args.onChoose).toHaveBeenCalledWith({ id: "g1", revision: 2, decision: "approve" });
      await userEvent.click(canvas.getByRole("button", { name: "Reject" }));
      await expect(args.onChoose).toHaveBeenLastCalledWith({ id: "g1", revision: 2, decision: "reject" });
      await userEvent.click(canvas.getByRole("button", { name: "Create gathering draft" }));
      const capacity = canvas.getByLabelText<HTMLInputElement>("Capacity");
      await expect(capacity.min).toBe("3");
      await expect(capacity.max).toBe("150");
      const form = capacity.closest("form") as HTMLFormElement;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await expect(args.onCreate).toHaveBeenCalledWith(form);
    },
    Confirming: async ({ args, canvasElement }: Story) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: "Approve" })).toBeNull();
      await userEvent.click(canvas.getByRole("button", { name: "Confirm approval" }));
      await expect(args.onConfirm).toHaveBeenCalledWith(choice);
      await userEvent.click(canvas.getByRole("button", { name: "Cancel" }));
      await expect(args.onChoose).toHaveBeenCalledWith(undefined);
    },
    "Confirming rejection": async ({ args, canvasElement }: Story) => {
      clearAllMocks();
      await userEvent.click(within(canvasElement).getByRole("button", { name: "Confirm rejection" }));
      await expect(args.onConfirm).toHaveBeenCalledWith({ ...choice, decision: "reject" });
    },
    "Stale choice": async ({ canvasElement }: Story) => {
      const canvas = within(canvasElement);
      await expect(canvas.queryByRole("button", { name: "Confirm approval" })).toBeNull();
      await expect(canvas.getByRole("button", { name: "Approve" })).toBeTruthy();
    },
    Decided: async ({ canvasElement }: Story) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("rejected")).toBeTruthy();
      await expect(canvas.queryByRole("button", { name: "Approve" })).toBeNull();
      await expect(canvas.queryByRole("button", { name: "Reject" })).toBeNull();
    },
    Saving: async ({ args, canvasElement }: Story) => {
      clearAllMocks();
      const approve = within(canvasElement).getByRole("button", { name: "Approve" });
      await expect(approve.hasAttribute("disabled")).toBe(true);
      await userEvent.click(approve, { pointerEventsCheck: 0 });
      await expect(args.onChoose).not.toHaveBeenCalled();
    },
    Refused: async ({ canvasElement }: Story) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Your role cannot see this.")).toBeTruthy();
      await expect(canvas.queryByRole("button", { name: "Create gathering draft" })).toBeNull();
      await expect(canvas.queryByRole("table")).toBeNull();
    },
    Unavailable: async ({ canvasElement }: Story) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("Not available here.")).toBeTruthy();
      await expect(canvas.queryByRole("button", { name: "Create gathering draft" })).toBeNull();
    },
    "No gatherings": async ({ canvasElement }: Story) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByText("No gatherings yet.")).toBeTruthy();
      await expect(canvas.getByRole("button", { name: "Create gathering draft" })).toBeTruthy();
    },
    "Write failed": async ({ canvasElement }: Story) => {
      await expect(within(canvasElement).getByText("A gathering already occupies this month.")).toBeTruthy();
    },
  },
};
