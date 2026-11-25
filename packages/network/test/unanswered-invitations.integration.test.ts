import { expect, test } from "vitest";
import { DAY, HOUR, type InitialInviteReceipt } from "@thenetwork/core";
import { probeResponseMs } from "../../core/src/generated/probeDispatch.ts";
import type { plans } from "@thenetwork/engine";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

test.each(["delayed_receipt", "not_sent"] as const)("terminal probe and plan expiries count once with %s", async outcome => {
  const ids = ["a", "b", "c", "d"];
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find a climbing partner", category: "hobby" as const }],
  })), { inlineJudge: holdEveryItem.inline, plans: false });
  const receipts = new Map<string, InitialInviteReceipt>();
  let heldPlan: { id: string; at: number } | undefined;
  const connect = () => {
    const context = w.ctx();
    w.net.init({ ...context, initialInviteReceipt: id => receipts.get(id), send: (id, body, opts) => {
      const delivered = context.send(id, body, opts);
      if (id === "a" && opts?.meta?.type === "plan_probe") heldPlan = { id: delivered.id, at: delivered.ts };
      else if (opts?.meta?.proactive) receipts.set(delivered.id, { kind: "accepted", at: delivered.ts });
      return delivered;
    } });
  };
  const ledger = () => w.net.memberList().find(m => m.id === "a")!;
  const tickAt = async (at: number) => {
    w.clock.set(at);
    await w.net.tick(at);
  };

  connect();
  await w.onboard(...ids);
  const intro = w.propose(["a", "b"]);
  expect(await w.runUntil(() => w.net.reviewQueue().some(item => item.oppId === intro))).toBe(true);
  expect(w.net.review(intro, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => w.probed("a"), DAY)).toBe(true);
  const probe = w.to("a").find(message => message.meta.type === "probe")!;
  await tickAt(probe.t + probeResponseMs(false, false) - 1);
  expect(ledger().unanswered).toBe(0);
  await tickAt(probe.t + probeResponseMs(false, false));
  expect(ledger()).toMatchObject({ unanswered: 1, onlyWhenAsked: false });

  const now = w.clock.now();
  const plan: plans.Plan = {
    id: "unanswered_plan", city: "nyc", activityId: "bouldering", place: { name: "Brooklyn Boulders", area: "Gowanus" },
    window: { start: now + 5 * DAY, end: now + 5 * DAY + HOUR }, invited: ["a", "c", "d"], alternates: [], partner: false,
    size: { min: 3, target: 3, max: 3 }, quorum: 3, probeDeadline: now + 8 * HOUR,
    score: 0.6, u: {}, familiar: {}, createdAt: now, category: "hobby",
  };
  const item = (w.net as unknown as { submitPlan(plan: plans.Plan, at: number): { id: string } }).submitPlan(plan, now);
  await w.net.tick(now);
  expect(w.net.review(item.id, "approve", { reviewer: "sim_staff" })).toBe(true);
  expect(await w.runUntil(() => heldPlan !== undefined, DAY)).toBe(true);
  const sent = heldPlan!;
  expect(plan.probeDeadline - sent.at).toBeLessThan(probeResponseMs(false, false));

  w.restart();
  connect();
  await tickAt(plan.probeDeadline);
  expect(ledger()).toMatchObject({ unanswered: 1, onlyWhenAsked: false });
  receipts.set(sent.id, outcome === "not_sent" ? { kind: "not_sent" } : { kind: "accepted", at: sent.at });
  await tickAt(plan.probeDeadline + 1);
  const paused = outcome === "delayed_receipt";
  expect(ledger()).toMatchObject({ unanswered: paused ? 2 : 1, onlyWhenAsked: paused });
  await tickAt(plan.probeDeadline + HOUR);
  expect(w.log("only_when_asked").filter(entry => entry.detail.memberId === "a")).toHaveLength(paused ? 1 : 0);

  await w.say("a", "Thanks, still interested in climbing.");
  expect(ledger()).toMatchObject({ pendingAsks: [], unanswered: 0, onlyWhenAsked: false });
});

test("stored invitations without receipt IDs retain the original 72-hour fallback", async () => {
  const w = new Mini([{ id: "a", name: "Ana Diaz", age: 30 }], { plans: false });
  await w.onboard("a");
  const state = w.net.exportState();
  const member = state.members.find(m => m.id === "a")!;
  const now = w.clock.now();
  member.pendingAsks = [{ kind: "probe", at: now - 73 * HOUR }, { kind: "probe", at: now - 72 * HOUR + 1 }];
  w.net.importState(state);
  await w.net.tick(now);
  expect(w.net.memberList()[0]).toMatchObject({ unanswered: 1, onlyWhenAsked: false });
  w.restart();
  w.clock.set(now + 1);
  await w.net.tick(now + 1);
  expect(w.net.memberList()[0]).toMatchObject({ unanswered: 2, onlyWhenAsked: true });
});
