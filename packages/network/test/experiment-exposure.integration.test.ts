import { expect, test } from "bun:test";
import type { RunRecord } from "@thenetwork/core";
import { runArm } from "../harness/experiment.ts";

test("experiment measures proactive messages over observed member time", async () => {
  let records: RunRecord[] = [];
  const result = await runArm("consent", { days: 14, seed: 1, onRecords: r => records = r });
  const end = records.find(r => r.type === "run_end")!.simEnd;
  const joins = records.filter(r => r.type === "join");
  const proactive = records.filter(r => r.type === "message" && r.msg.direction === "outbound" && r.msg.meta?.proactive && r.msg.status === "delivered").length;
  const memberMinutes = joins.reduce((sum, r) => sum + (end - r.t) / 60_000, 0);

  expect({ joined: joins.length, proactive, memberMinutes: Math.round(memberMinutes) })
    .toEqual({ joined: 263, proactive: 392, memberMinutes: 4_994_210 });
  expect(result.proactivePerMemberWeek).toBe(0.791);
}, 120_000);
