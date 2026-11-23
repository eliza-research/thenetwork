import { clearAllMocks, expect, userEvent, within } from "storybook/test";
import { initial } from "../../../../core/src/generated/consoleWorkspace.ts";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { ReportCardProps } from "./ReportCard.tsx";

type Context = { args: ReportCardProps; canvasElement: HTMLElement };

const report = { ...initial.report, present: true };

const ready = [
  { step: "HoldPersonStep", enabled: true },
  { step: "BanPhoneStep", enabled: true },
  { step: "BanPersonStep", enabled: true },
  { step: "DismissStep", enabled: true },
] as const;

const head = (canvasElement: HTMLElement) => canvasElement.querySelector<HTMLElement>("[aria-expanded]")!;

export const meta: ComponentMeta<ReportCardProps> = {
  args: {
    report,
    expanded: true,
    kind: { tone: "destructive", label: "harassment" },
    name: "Jon Park",
    urgent: true,
    meta: "open · Nov 14, 3:20 PM",
    detail: <p>Reported Jon Park · by Maya Chen</p>,
    note: "",
    steps: [
      { step: "HoldPersonStep", enabled: false },
      { step: "BanPhoneStep", enabled: false },
      { step: "BanPersonStep", enabled: false },
      { step: "DismissStep", enabled: false },
    ],
  },
  examples: {
    "Note ready": { note: "Two reports, same pattern", steps: [...ready] },
    "Minor report": { report: { ...report, minorReport: true }, kind: { tone: "warn", label: "minor" }, steps: [{ step: "ClearMinorStep", enabled: false }] },
    Banning: { report: { ...report, reportSending: true, reportStep: "BanPhoneStep" }, note: "Two reports, same pattern", steps: ready.map((choice) => ({ ...choice, enabled: false })) },
    Collapsed: { expanded: false },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.type(canvas.getByRole("textbox", { name: "Decision note" }), "T");
      await expect(args.onNoteChange).toHaveBeenCalledWith("T");
      await userEvent.click(canvas.getByRole("button", { name: "Hold" }), { pointerEventsCheck: 0 });
      await expect(args.onAct).not.toHaveBeenCalled();
      await userEvent.click(head(canvasElement));
      await expect(args.onToggle).toHaveBeenCalledTimes(1);
    },
    "Note ready": async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      for (const [name, step] of [["Hold", "HoldPersonStep"], ["Ban phone", "BanPhoneStep"], ["Ban person", "BanPersonStep"], ["Dismiss", "DismissStep"]] as const) {
        await userEvent.click(canvas.getByRole("button", { name }));
        await expect(args.onAct).toHaveBeenLastCalledWith(step);
      }
    },
    "Minor report": async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("button", { name: "Clear minor signal (every app)" })).toBeTruthy();
      await expect(canvas.queryByRole("button", { name: "Hold" })).toBeNull();
    },
    Banning: async ({ canvasElement }: Context) => {
      const canvas = within(canvasElement);
      await expect(canvas.getByRole("button", { name: "Ban phone" }).getAttribute("aria-busy")).toBe("true");
      await expect(canvas.getByRole<HTMLInputElement>("textbox", { name: "Decision note" }).disabled).toBe(true);
    },
    Collapsed: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      await expect(within(canvasElement).queryByRole("textbox")).toBeNull();
      await userEvent.click(head(canvasElement));
      await expect(args.onToggle).toHaveBeenCalledTimes(1);
    },
  },
};
