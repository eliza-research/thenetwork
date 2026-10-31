import { describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { relayDispatchCheck } from "../src/index.ts";
import { Mini, type Spec, START } from "./mini.ts";

const climber = (id: string, name: string, more: Partial<Spec> = {}): Spec => ({
  id,
  name,
  age: 30,
  area: "Greenpoint",
  interests: ["climbing", "hiking"],
  skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
  ...more,
});

describe("safety report hold enforcement across approval, relay, recipient policy, and requests", () => {
  test("approvalCheck rejects opportunity containing participant with open urgent report as held", async () => {
    const w = new Mini([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
    ], { review: "human" });
    await w.onboard("alice", "bob");

    const opp = {
      id: "opp-1",
      participants: ["alice", "bob"],
      alternates: [],
      stage: "review",
      origin: "player",
    } as any;

    expect((w.net as any).approvalCheck(opp)).toBeUndefined();

    // File an urgent report from alice against bob (they met on a date)
    // Note: one report does not add trust points (needs 2 reporters), so bob's trust level remains "ok"
    (w.net as any).fileReport("alice", "bob", "unsafe", { source: "check_in", met: true });

    expect((w.net as any).trust.level("bob")).toBe("ok");
    expect((w.net as any).reportHeld("bob")).toBe(true);

    // approvalCheck must return "held"
    expect((w.net as any).approvalCheck(opp)).toBe("held");
  });

  test("relayHost member reports held=true for urgent report held member, blocking relay requests", async () => {
    const w = new Mini([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
    ]);
    await w.onboard("alice", "bob");

    const hostBefore = (w.net as any).relayHost();
    expect(hostBefore.member("bob")?.held).toBe(false);

    // File urgent harassment report against bob
    (w.net as any).fileReport("alice", "bob", "harassment", { source: "message", met: true });
    expect((w.net as any).reportHeld("bob")).toBe(true);

    const hostAfter = (w.net as any).relayHost();
    expect(hostAfter.member("bob")?.held).toBe(true);

    // Set up scheduled match for relayDesk
    const opp = {
      id: "opp-relay-1",
      participants: ["alice", "bob"],
      stage: "scheduled",
      meetingAt: START + DAY,
      createdAt: START,
      status: new Map([["alice", "yes"], ["bob", "yes"]]),
      alternates: [],
    } as any;
    (w.net as any).opps.set("opp-relay-1", opp);

    // Bob tries to send a relay message - should be refused because party is held
    const outcome = await (w.net as any).relayDesk.request({
      itemId: "relay-item-1",
      matchId: "opp-relay-1",
      from: "bob",
      kind: "text",
      text: "Hey Alice, are you there?",
    });
    expect(outcome.decision).toBe("held");
  });

  test("relayDispatchCheck detects reportHeld from stored state", () => {
    const st = {
      opps: [
        {
          id: "opp-1",
          participants: ["alice", "bob"],
          stage: "scheduled" as const,
          meetingAt: START + DAY,
          createdAt: START,
          status: [["alice", "yes"], ["bob", "yes"]] as [string, any][],
        },
      ],
      members: [
        { id: "alice", first: "Alice", name: "Alice Adams", age: 30, optedOut: false },
        { id: "bob", first: "Bob", name: "Bob Brown", age: 30, optedOut: false },
      ],
      declinedIds: [],
      trust: [{ id: "alice", level: "ok" }, { id: "bob", level: "ok" }],
      blocks: [],
      reports: [
        { id: "rp1", kind: "unsafe" as const, reporterId: "alice", subjectId: "bob", at: START, status: "open" as const, source: "check_in" as const, met: true },
      ],
    } as any;

    const res = relayDispatchCheck(st, { matchId: "opp-1", from: "bob", to: "alice", now: START + DAY });
    expect(res).toBe("party:held");
  });

  test("recipientPolicy rejects proactive messages to reportHeld member and about them to others", async () => {
    const w = new Mini([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
    ]);
    await w.onboard("alice", "bob");

    // Before report
    expect(w.net.recipientPolicy("bob", "probe", {}).ok).toBe(true);
    expect(w.net.recipientPolicy("alice", "probe", { about: ["bob"] }).ok).toBe(true);

    // File urgent report
    (w.net as any).fileReport("alice", "bob", "scam", { source: "check_in", met: true });

    // After report: bob cannot receive non-safety proactive messages
    const policyToBob = w.net.recipientPolicy("bob", "probe", {});
    expect(policyToBob).toEqual({ ok: false, reason: "held" });

    // After report: messages to others about bob are blocked
    const policyAboutBob = w.net.recipientPolicy("alice", "probe", { about: ["bob"] });
    expect(policyAboutBob).toEqual({ ok: false, reason: "other_on_watch" });
  });

  test("plan seats and invitations reject members under urgent report hold", async () => {
    const w = new Mini([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
    ], { growth: true });
    await w.onboard("alice", "bob");

    const bobState = (w.net as any).members.get("bob");
    expect((w.net as any).planSeatOk(bobState)).toBe(true);
    expect((w.net as any).canInvite(bobState)).toBe(true);

    // File urgent report
    (w.net as any).fileReport("alice", "bob", "harassment", { source: "message", met: true });

    expect((w.net as any).planSeatOk(bobState)).toBe(false);
    expect((w.net as any).canInvite(bobState)).toBe(false);
  });
});
