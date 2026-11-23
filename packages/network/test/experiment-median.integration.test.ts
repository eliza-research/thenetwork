import { expect, test } from "vitest";
import { HOUR, type Category, type RunRecord } from "@thenetwork/core";
import { World } from "@thenetwork/sim";
import { runArm, summarize } from "../harness/experiment.ts";
import { ConsentNetwork } from "../src/network.ts";

test("experiment reports the median of completed native request durations", async () => {
  let records: RunRecord[] = [];
  const result = await runArm("consent", { days: 14, seed: 1, onRecords: r => records = r });
  const logs = records.filter((r): r is Extract<RunRecord, { type: "network_log" }> => r.type === "network_log");
  const opened = new Map(logs.filter(r => r.kind === "request" && r.detail.kind === "people").map(r => [r.detail.requestId, r]));
  const completed = logs.flatMap(r => {
    if (r.kind !== "request_result" || r.detail.outcome !== "fulfilled") return [];
    const start = opened.get(r.detail.requestId);
    if (!start) throw new Error(`Missing opening for fulfilled request ${String(r.detail.requestId)}`);
    return [{ start, fulfilledAt: r.t, hours: (r.t - start.t) / HOUR }];
  }).sort((a, b) => a.hours - b.hours);

  expect(completed.length).toBeGreaterThan(1);
  const middle = Math.floor(completed.length / 2);
  const median = completed.length % 2 ? completed[middle]!.hours : (completed[middle - 1]!.hours + completed[middle]!.hours) / 2;
  expect(result.requestMedianHours).toBe(Math.round(median));

  const shortest = completed[0]!, longest = completed.at(-1)!;
  const evenMedian = Math.round((shortest.hours + longest.hours) / 2);
  expect(evenMedian).not.toBe(Math.round(longest.hours));
  const network = new ConsentNetwork({ seed: 1, matchingEnabled: false });
  const world = new World({ seed: 1, days: 14, personas: [], network, writeLog: false });
  await world.begin();
  const state = network.exportState();
  state.requests = [shortest, longest].map(({ start, fulfilledAt }) => ({
    id: String(start.detail.requestId), memberId: String(start.detail.memberId),
    at: start.t, kind: "people", category: start.detail.category as Category,
    tags: [], outcome: "fulfilled", fulfilledAt,
  }));
  network.importState(state);
  expect(summarize("consent", 14, world.records, world, network).requestMedianHours).toBe(evenMedian);
}, 120_000);
