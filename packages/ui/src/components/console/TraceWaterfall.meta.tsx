import { clearAllMocks, expect, fn, userEvent, within } from "storybook/test";
import type { ComponentMeta } from "../../lib/meta.ts";
import type { TraceWaterfallProps } from "./TraceWaterfall.tsx";

type Context = { args: TraceWaterfallProps; canvasElement: HTMLElement };

export const meta: ComponentMeta<TraceWaterfallProps> = {
  args: {
    spans: [
      {
        id: "root",
        name: "intro.propose",
        service: "network",
        startMs: 0,
        durationMs: 840,
        status: "ok",
        attributes: { lane: "friends", minor_present: false },
      },
      {
        id: "rank",
        parentId: "root",
        name: "engine.rank",
        service: "recommender",
        model: "gpt-6-luna",
        startMs: 40,
        durationMs: 320,
        status: "fallback",
        tokens: 1420,
        costUsd: 0.0028,
        input: { candidates: 18, lane: "friends" },
        output: { selected: "cand_42", score: 0.87 },
      },
      {
        id: "review",
        parentId: "root",
        name: "judge.review",
        service: "review",
        model: "gpt-6-luna",
        startMs: 370,
        durationMs: 390,
        status: "flagged",
        tokens: 910,
        costUsd: 0.0018,
        input: "[crypto-shredded]",
        output: { verdict: "hold", reason: "age_check_pending" },
      },
      {
        id: "guard",
        parentId: "root",
        name: "outbound.leak_guard",
        service: "core",
        startMs: 770,
        durationMs: 65,
        status: "leak_blocked",
        input: "[crypto-shredded]",
        output: "[crypto-shredded]",
      },
    ],
    onSelectSpan: fn(),
  },
  examples: {
    Empty: { spans: [] },
  },
  play: {
    Default: async ({ args, canvasElement }: Context) => {
      clearAllMocks();
      const canvas = within(canvasElement);
      await userEvent.click(canvas.getByRole("button", { name: /judge\.review/ }));
      await expect(args.onSelectSpan).toHaveBeenCalledTimes(1);
      await expect(canvas.getByText("[crypto-shredded]")).toBeTruthy();
    },
    Empty: async ({ canvasElement }: Context) => {
      await expect(within(canvasElement).getByText("No spans recorded.")).toBeTruthy();
    },
  },
};
