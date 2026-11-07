import { expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { ConsentNetwork } from "../../network/src/network.ts";
import { PolicyPersonaAgent } from "../src/agent/policy.ts";
import type { AgentReply, PersonaAgent } from "../src/agent/types.ts";
import { generatePersonas } from "../src/generator.ts";
import { computeMetrics, type Metrics } from "../src/judge/metrics.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { DEFAULT_START, runWorld, type WorldOptions } from "../src/world.ts";

test("response metrics count replies that reached the channel, retaining legacy decision-only logs", async () => {
  const failures: string[] = [];
  let pending = 0, suppressed = 0, probeReplies = 0, reactions = 0;
  async function run(seed: number, days: number, kind: "stub" | "consent" | "reactions", actions?: WorldOptions["actions"]) {
    const observed: { memberId: string; messageId: string; at: number; reply: AgentReply }[] = [];
    const policy = new PolicyPersonaAgent(DEFAULT_START, { reactions: kind === "reactions" });
    const agent: PersonaAgent = {
      mode: "policy", joinMessage: ctx => policy.joinMessage(ctx), initiative: ctx => policy.initiative(ctx),
      async respond(ctx, msg) {
        const reply = await policy.respond(ctx, msg);
        observed.push({ memberId: msg.memberId, messageId: msg.id, at: ctx.now, reply });
        return reply;
      },
    };
    const w = await runWorld({ seed, days, writeLog: false, agent, actions,
      personas: generatePersonas({ n: 40, seed, joinSpreadDays: 1, minorShare: 0, adversarialRate: 0 }),
      network: kind === "consent" ? new ConsentNetwork({ seed, review: "auto", growth: false, plans: false }) : new StubNetwork({ seed }),
    });
    const expected: Metrics["responses"] = { invitesDelivered: 0, accepted: 0, declined: 0, countered: 0, ignored: 0, acceptRate: 0, probes: { asked: 0, yes: 0, no: 0, ignored: 0 } };
    const inbound = w.channel.all().filter(m => m.direction === "inbound" && m.status === "delivered");
    for (const x of observed) {
      const d = x.reply;
      // Independent evidence: the actual policy's words at its scheduled send time on the channel.
      const delivered = d.action === "reply" && !!d.text && inbound.some(m => m.memberId === x.memberId && m.ts === x.at + d.delayMs && m.body === d.text);
      if (delivered && d.reaction) reactions++;
      if (d.messageType !== "proposal" && d.messageType !== "probe") continue;
      if (!delivered && d.action === "reply") {
        if (x.at + d.delayMs > DEFAULT_START + days * DAY) pending++;
        else if (w.channel.isOptedOut(x.memberId)) suppressed++;
      }
      if (d.messageType === "probe") {
        expected.probes.asked++;
        if (delivered && d.intent === "probe_yes") { expected.probes.yes++; probeReplies++; }
        else if (delivered && d.intent === "probe_no") { expected.probes.no++; probeReplies++; }
        else expected.probes.ignored++;
      } else {
        expected.invitesDelivered++;
        if (!delivered || d.intent === "ignore") expected.ignored++;
        else if (d.decision === "accept") expected.accepted++;
        else if (d.decision === "decline") expected.declined++;
        else if (d.decision === "counter") expected.countered++;
      }
    }
    expected.acceptRate = expected.invitesDelivered ? Math.round((expected.accepted + expected.countered) / expected.invitesDelivered * 1000) / 1000 : 0;
    if (JSON.stringify(w.metrics.responses) !== JSON.stringify(expected)) failures.push(`${kind}/${seed}/${days}: response counts differ from channel`);
    // Retain the original interpretation when reading logs without reply-tracking evidence.
    const legacy = structuredClone(w.records);
    for (const r of legacy) {
      if (r.type === "run_start") delete r.config.replyTracking;
      if (r.type === "message" && r.msg.meta) delete r.msg.meta.inReplyTo;
    }
    const old = computeMetrics(legacy).responses;
    const accepts = observed.filter(x => x.reply.messageType === "proposal" && x.reply.intent !== "ignore" && x.reply.decision === "accept").length;
    if (old.accepted !== accepts) failures.push(`${kind}/${seed}/${days}: legacy decision count changed`);
    if (w.metrics.invariants.total || w.metrics.errors) failures.push(`${kind}/${seed}/${days}: invariant or runtime error`);
    return observed;
  }
  const initial = await run(1, 10, "stub");
  const delayed = initial.find(x => x.reply.messageType === "proposal" && x.reply.decision === "accept" && x.at + x.reply.delayMs > DEFAULT_START + 10 * DAY)!;
  if (!delayed) throw new Error("The generated world must contain the late acceptance");
  await run(1, 11, "stub");
  await run(1, 12, "stub", [{ at: delayed.at + delayed.reply.delayMs / 2, action: { do: "opt_out", persona: delayed.memberId } }]);
  await run(1, 10, "reactions");
  for (const seed of [1, 2, 3]) await run(seed, 10, "consent");
  expect({ pending: pending > 0, suppressed: suppressed > 0, probeReplies: probeReplies > 0, reactions: reactions > 0, failures })
    .toEqual({ pending: true, suppressed: true, probeReplies: true, reactions: true, failures: [] });
}, 60_000);
