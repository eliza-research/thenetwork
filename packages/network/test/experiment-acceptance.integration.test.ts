import { expect, test } from "vitest";
import type { RunRecord } from "@thenetwork/core";
import { computeMetrics } from "../../sim/src/judge/metrics.ts";
import { runArm } from "../harness/experiment.ts";

test("experiment acceptance reports count only accepted invitations", async () => {
  let records: RunRecord[] = [];
  const report = await runArm("push_v2", { days: 7, seed: 1, onRecords: run => records = run });
  const replies = records.filter((r): r is Extract<RunRecord, { type: "decision" }> =>
    r.type === "decision" && r.messageType === "proposal");
  expect(replies.filter(r => r.decision === "counter" && r.intent === "counter")).toHaveLength(3);
  expect(computeMetrics(records).responses.countered).toBe(3);
  expect(replies.filter(r => r.decision === "accept" && r.intent === "ignore")).toHaveLength(9);
  expect(records.filter(r => r.type === "meeting_scheduled")).toHaveLength(155);
  expect(report).toMatchObject({
    invitations: 283, inviteYes: 123, inviteAcceptRate: 0.435,
    proposalsAllYes: 27, proposalAllYesRate: 0.174, meetingsHeld: 12,
  });
}, 120_000);
