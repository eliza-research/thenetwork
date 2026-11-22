import { expect, test } from "vitest";
import type { RunRecord } from "@thenetwork/core";
import { runArm } from "../harness/experiment.ts";

test("experiment reports the median of completed native request durations", async () => {
  let records: RunRecord[] = [];
  const result = await runArm("consent", { days: 14, seed: 1, onRecords: r => records = r });
  const logs = records.filter((r): r is Extract<RunRecord, { type: "network_log" }> => r.type === "network_log");
  const opened = new Map(logs.filter(r => r.kind === "request" && r.detail.kind === "people").map(r => [r.detail.requestId, r.t]));
  const hours = logs.filter(r => r.kind === "request_result" && r.detail.outcome === "fulfilled")
    .map(r => (r.t - opened.get(r.detail.requestId)!) / 3_600_000).sort((a, b) => a - b);

  expect(hours.length).toBeGreaterThan(1);
  expect(hours.length % 2).toBe(0);
  const middle = hours.length / 2;
  expect(Math.round(hours[middle]!)).not.toBe(Math.round(hours[middle - 1]!));
  expect(result.requestMedianHours).toBe(Math.round((hours[middle - 1]! + hours[middle]!) / 2));
}, 120_000);
