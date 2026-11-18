import { expect, test } from "bun:test";
import type { RunRecord } from "@thenetwork/core";
import { runArm } from "../harness/experiment.ts";

test("experiment acceptance counts exclude native counteroffers and retain booked accepts", async () => {
  let records: RunRecord[] = [];
  const result = await runArm("push_v2", { days: 7, seed: 1, onRecords: r => records = r });
  const decisions = records.filter((r): r is Extract<RunRecord, { type: "decision" }> => r.type === "decision" && r.messageType === "proposal");
  const counters = decisions.filter(r => r.decision === "counter");
  const silentAccepts = decisions.filter(r => r.decision === "accept" && r.intent === "ignore");
  expect(counters.map(r => ({ member: r.memberId, opportunity: r.proposalId, intent: r.intent })))
    .toEqual([
      { member: "ny-0168", opportunity: "nw-1-50", intent: "counter" },
      { member: "ny-0009", opportunity: "nw-1-78", intent: "counter" },
    ]);
  expect(silentAccepts.length).toBe(11);
  expect({ accepted: result.inviteYes, rate: result.inviteAcceptRate, allYes: result.proposalsAllYes, allYesRate: result.proposalAllYesRate })
    .toEqual({ accepted: 118, rate: 0.484, allYes: 31, allYesRate: 0.22 });
}, 120_000);
