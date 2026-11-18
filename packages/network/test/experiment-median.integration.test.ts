import { expect, test } from "bun:test";
import type { RunRecord } from "@thenetwork/core";
import { runArm } from "../harness/experiment.ts";

test("experiment reports the median of completed native request durations", async () => {
  let records: RunRecord[] = [];
  const result = await runArm("consent", { days: 14, seed: 1, onRecords: r => records = r });
  const logs = records.filter((r): r is Extract<RunRecord, { type: "network_log" }> => r.type === "network_log");
  const opened = new Map(logs.filter(r => r.kind === "request" && r.detail.kind === "people").map(r => [r.detail.requestId, r.t]));
  const hours = logs.filter(r => r.kind === "request_result" && r.detail.outcome === "fulfilled")
    .map(r => (r.t - opened.get(r.detail.requestId)!) / 3_600_000).sort((a, b) => a - b);

  expect(hours).toHaveLength(28);
  expect({ middleHours: hours.slice(13, 15), medianHours: result.requestMedianHours })
    .toEqual({ middleHours: [70 + 5 / 60, 89 + 5 / 60], medianHours: 80 });
}, 120_000);
