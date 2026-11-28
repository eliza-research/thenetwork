import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { SliceExplorerProps } from "./SliceExplorer.tsx";

type Context = { args: SliceExplorerProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<SliceExplorerProps> = {
  args: {
    metrics: [
      { value: "intros_sent", label: "Intros sent" },
      { value: "reply_rate", label: "Reply rate" },
      { value: "active_members", label: "Active members" },
    ],
    dimensions: [
      { value: "app", label: "App" },
      { value: "channel", label: "Channel" },
      { value: "lane", label: "Lane" },
    ],
    query: {
      metric: "intros_sent",
      groupBy: "app",
      granularity: "1d",
      chartType: "line",
    },
    onQueryChange: fn(),
    labels: ["D1", "D2", "D3", "D4", "D5"],
    series: [
      { id: "ntwrk", label: "ntwrk", values: [12, 18, 22, 27, 35] },
      { id: "friends", label: "friends", values: [8, 11, 14, 19, 24] },
    ],
    rows: [
      { day: "D1", app: "ntwrk", intros_sent: 12 },
      { day: "D2", app: "friends", intros_sent: 11 },
    ],
    onExport: fn(),
    enableSql: true,
    onRunSql: fn(),
    sqlColumns: ["day", "lane", "events"],
    sqlRows: [
      { day: "2026-11-26", lane: "friends", events: 42 },
      { day: "2026-11-27", lane: "friends", events: 58 },
    ],
  },
  examples: {
    "Table mode": {
      query: { metric: "intros_sent", groupBy: "app", granularity: "1d", chartType: "table" },
      enableSql: false,
    },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: "Export CSV" }));
      await expect(args.onExport).toHaveBeenCalledWith("csv");
      await userEvent.click(canvas.getByRole("tab", { name: "Read-only SQL" }));
      const textarea = canvas.getByRole("textbox", { name: "Read-only SQL query" });
      await userEvent.clear(textarea);
      await userEvent.type(textarea, "DELETE FROM analytics_events");
      await userEvent.click(canvas.getByRole("button", { name: "Run query" }));
      await expect(canvas.getByRole("alert")).toBeTruthy();
      await expect(args.onRunSql).not.toHaveBeenCalled();
    },
  },
};
