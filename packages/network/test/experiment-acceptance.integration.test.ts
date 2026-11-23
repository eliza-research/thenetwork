import { expect, test } from "vitest";
import type { RunRecord } from "@thenetwork/core";
import { runArm } from "../harness/experiment.ts";

test("experiment acceptance reports count only accepted invitations", async () => {
  let records: RunRecord[] = [];
  const report = await runArm("push_v2", { days: 7, seed: 1, onRecords: run => records = run });
  const replies = records.filter((r): r is Extract<RunRecord, { type: "decision" }> =>
    r.type === "decision" && r.messageType === "proposal");
  const proposals = records.flatMap(r => r.type === "proposal" && r.source !== "scenario" ? [r.proposal.id] : []);
  const proposalIds = new Set(proposals);
  const invitations = records.flatMap(r => r.type === "message" && r.msg.direction === "outbound"
    && r.msg.meta?.type === "proposal" && proposalIds.has(String(r.msg.meta.proposalId)) ? [r.msg] : []);
  const byMessage = new Map(replies.map(reply => [reply.messageId, reply]));
  const invitationKey = (proposalId: string, memberId: string) => JSON.stringify([proposalId, memberId]);
  const accepted = new Set<string>();
  let explicitCounters = 0, silentBookedAcceptances = 0;
  for (const invite of invitations) {
    const reply = byMessage.get(invite.id);
    const key = invitationKey(String(invite.meta?.proposalId), invite.memberId);
    if (reply?.intent === "counter") {
      explicitCounters++;
      continue;
    }
    if (invite.meta?.booked && reply?.intent === "ignore" && reply.decision === "accept") {
      silentBookedAcceptances++;
      accepted.add(key);
    } else if (reply?.intent === "accept") {
      accepted.add(key);
    }
  }
  expect(explicitCounters).toBeGreaterThan(0);
  expect(silentBookedAcceptances).toBeGreaterThan(0);
  const allYes = proposals.filter(id => {
    const members = new Set(invitations.filter(invite => invite.meta?.proposalId === id).map(invite => invite.memberId));
    return members.size >= 2 && [...members].every(member => accepted.has(invitationKey(id, member)));
  }).length;
  expect(report).toMatchObject({
    invitations: invitations.length, inviteYes: accepted.size,
    inviteAcceptRate: Number((accepted.size / invitations.length).toFixed(3)),
    proposalsAllYes: allYes, proposalAllYesRate: Number((allYes / proposals.length).toFixed(3)),
  });
}, 120_000);
