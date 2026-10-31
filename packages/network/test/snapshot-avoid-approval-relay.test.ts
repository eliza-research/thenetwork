import { describe, expect, test } from "bun:test";
import { DAY, type Edge } from "@thenetwork/core";
import type { NetworkContext } from "@thenetwork/sim";
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

class MiniWithEdges extends Mini {
  edgesList: Edge[] = [];

  override ctx(): NetworkContext {
    const base = super.ctx();
    return {
      ...base,
      snapshot: () => ({ ...base.snapshot(), edges: this.edgesList ?? [] }),
    };
  }
}

describe("snapshot avoid edges, approval check, relay host, and recipient policy", () => {
  test("snapshot avoid edge is loaded by snapshotAvoid and detected by avoided(a, b)", async () => {
    const w = new MiniWithEdges([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
      climber("charlie", "Charlie Clark"),
    ]);
    await w.onboard("alice", "bob", "charlie");

    // Initially neither avoided nor blocked
    expect((w.net as any).avoided("alice", "bob")).toBe(false);

    // Add avoid edge in snapshot
    w.edgesList.push({
      from: "alice",
      to: "bob",
      type: "avoid",
      strength: 1,
      explicit: false,
      createdAt: START,
    });
    // Invalidate snapshot cache
    (w.net as any).dirty = true;

    // Both directions should report avoided
    expect((w.net as any).avoided("alice", "bob")).toBe(true);
    expect((w.net as any).avoided("bob", "alice")).toBe(true);
    expect((w.net as any).avoided("alice", "charlie")).toBe(false);
  });

  test("approvalCheck rejects opportunity containing avoided participants with blocked_pair", async () => {
    const w = new MiniWithEdges([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
      climber("charlie", "Charlie Clark"),
    ], { review: "human" });
    await w.onboard("alice", "bob", "charlie");

    const opp = {
      id: "opp-1",
      participants: ["alice", "bob"],
      alternates: [],
      stage: "review",
      origin: "player",
    } as any;

    // Without avoid edge, approvalCheck passes (returns undefined)
    expect((w.net as any).approvalCheck(opp)).toBeUndefined();

    // 1. With local avoid edge
    (w.net as any).avoid.add("alice|bob");
    expect((w.net as any).approvalCheck(opp)).toBe("blocked_pair");

    // Remove local avoid edge, test snapshot avoid edge
    (w.net as any).avoid.clear();
    expect((w.net as any).approvalCheck(opp)).toBeUndefined();

    // 2. With snapshot avoid edge
    w.edgesList.push({
      from: "alice",
      to: "bob",
      type: "avoid",
      strength: 1,
      explicit: false,
      createdAt: START,
    });
    (w.net as any).dirty = true;

    expect((w.net as any).approvalCheck(opp)).toBe("blocked_pair");
  });

  test("relayHost blocked returns true for avoided pairs and blocks relay messages", async () => {
    const w = new MiniWithEdges([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
    ]);
    await w.onboard("alice", "bob");

    const host = (w.net as any).relayHost();
    expect(host.blocked("alice", "bob")).toBe(false);

    // Test local avoid edge
    (w.net as any).avoid.add("alice|bob");
    expect(host.blocked("alice", "bob")).toBe(true);
    expect(host.blocked("bob", "alice")).toBe(true);

    // Clear local avoid, add snapshot avoid edge
    (w.net as any).avoid.clear();
    expect(host.blocked("alice", "bob")).toBe(false);

    w.edgesList.push({
      from: "alice",
      to: "bob",
      type: "avoid",
      strength: 1,
      explicit: false,
      createdAt: START,
    });
    (w.net as any).dirty = true;

    expect(host.blocked("alice", "bob")).toBe(true);
    expect(host.blocked("bob", "alice")).toBe(true);

    // Set up mutual match in opps for relayDesk
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

    const relayDesk = (w.net as any).relayDesk;
    const outcome = await relayDesk.request({
      itemId: "relay-item-1",
      matchId: "opp-relay-1",
      from: "alice",
      kind: "text",
      text: "Hey Bob, are we still meeting?",
    });
    expect(outcome.decision).toBe("refused");
    expect(outcome.reason).toBe("I can't pass that on.");
  });

  test("relayDispatchCheck detects avoid edges in stored state", () => {
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
      avoid: ["alice|bob"],
    } as any;

    const res = relayDispatchCheck(st, { matchId: "opp-1", from: "alice", to: "bob", now: START + DAY });
    expect(res).toBe("party:blocked");
  });

  test("recipientPolicy rejects messages about avoided members", async () => {
    const w = new MiniWithEdges([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
    ]);
    await w.onboard("alice", "bob");

    // Initially passes
    const policyBefore = w.net.recipientPolicy("alice", "probe", { about: ["bob"] });
    expect(policyBefore.ok).toBe(true);

    // Add avoid edge in snapshot
    w.edgesList.push({
      from: "alice",
      to: "bob",
      type: "avoid",
      strength: 1,
      explicit: false,
      createdAt: START,
    });
    (w.net as any).dirty = true;

    // Now rejected with blocked_pair
    const policyAfter = w.net.recipientPolicy("alice", "probe", { about: ["bob"] });
    expect(policyAfter).toEqual({ ok: false, reason: "blocked_pair" });
  });

  test("distinctAlternates filters out members with avoid edge", async () => {
    const w = new MiniWithEdges([
      climber("alice", "Alice Adams"),
      climber("bob", "Bob Brown"),
      climber("charlie", "Charlie Clark"),
    ]);
    await w.onboard("alice", "bob", "charlie");

    // Without avoid edge, both bob and charlie are valid alternates
    const altsBefore = (w.net as any).distinctAlternates(["alice"], ["bob", "charlie"]);
    expect(altsBefore).toContain("bob");
    expect(altsBefore).toContain("charlie");

    // Add avoid edge in snapshot between alice and bob
    w.edgesList.push({
      from: "alice",
      to: "bob",
      type: "avoid",
      strength: 1,
      explicit: false,
      createdAt: START,
    });
    (w.net as any).dirty = true;

    // Bob is filtered out, only Charlie remains
    const altsAfter = (w.net as any).distinctAlternates(["alice"], ["bob", "charlie"]);
    expect(altsAfter).not.toContain("bob");
    expect(altsAfter).toContain("charlie");
  });
});
