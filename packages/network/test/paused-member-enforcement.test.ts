import { describe, expect, it } from "bun:test";
import { Mini } from "./mini.ts";

const person = (id: string, name: string, state: "normal" | "paused" = "normal") => ({
  id,
  name,
  age: 30,
  area: "Greenpoint",
  state,
  interests: ["climbing", "hiking"],
  skills: ["belaying"],
  wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }],
});

describe("paused member enforcement across eligibility, recipient policy, plans, and review", () => {
  it("eligible(id) returns false for a paused member", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    expect(w.net.eligible("a")).toBe(true);
    expect(w.net.eligible("b")).toBe(false);
  });

  it("planSeatOk(m) returns false for a paused member", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    const mb = (w.net as any).members.get("b")!;
    expect((w.net as any).planSeatOk(mb)).toBe(false);

    const ma = (w.net as any).members.get("a")!;
    expect((w.net as any).planSeatOk(ma)).toBe(true);
  });

  it("recipientPolicy rejects proactive messages to paused member and about them to others", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    // Proactive outreach to paused member must be rejected
    const checkToPaused = w.net.recipientPolicy("b", "probe", { proactive: true });
    expect(checkToPaused.ok).toBe(false);
    expect(!checkToPaused.ok && checkToPaused.reason).toBe("state_paused");

    // Message about paused member to active counterpart must be rejected
    const checkAboutPaused = w.net.recipientPolicy("a", "probe", { about: ["b"] });
    expect(checkAboutPaused.ok).toBe(false);
    expect(!checkAboutPaused.ok && checkAboutPaused.reason).toBe("other_not_matchable");
  });

  it("approvalCheck rejects opportunity containing a participant who is paused", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "normal")], { review: "human" });
    await w.onboard("a", "b");

    const opp = (w.net as any).newOpp({
      id: "test-opp-1",
      origin: "planner",
      kind: "intro",
      category: "hobby",
      objective: "climbing",
      detail: "climbing session",
      participants: ["a", "b"],
      alternates: [],
      primed: [],
      explanations: { a: "intro", b: "intro" },
      score: 0.8,
      generator: "test",
      tags: [],
    });
    (w.net as any).submit(opp);
    expect(opp.stage).toBe("review");

    // Before pause, approval check passes
    expect((w.net as any).approvalCheck(opp)).toBeUndefined();

    // Now member 'b' pauses their account
    const mb = (w.net as any).members.get("b")!;
    mb.state = "paused";

    // Approval check must now reject with participant_paused
    expect((w.net as any).approvalCheck(opp)).toBe("participant_paused");
  });

  it("relayHost member reports held=true for a paused member", async () => {
    const w = new Mini([person("a", "Ana Diaz", "normal"), person("b", "Ben Ito", "paused")]);
    await w.onboard("a", "b");

    const host = (w.net as any).relayHost();
    const relayMemberB = host.member("b");
    expect(relayMemberB).toBeDefined();
    expect(relayMemberB!.held).toBe(true);

    const relayMemberA = host.member("a");
    expect(relayMemberA).toBeDefined();
    expect(relayMemberA!.held).toBe(false);
  });
  it("syncMember drops or replaces paused member when record transitions to paused in open opps", async () => {
    const w = new Mini([
      person("a", "Ana Diaz", "normal"),
      person("b", "Ben Ito", "normal"),
      person("c", "Chloe Chen", "normal"),
    ], { review: "human" });
    await w.onboard("a", "b", "c");

    // 1. In review: member b pauses
    const oppReview = (w.net as any).newOpp({
      id: "review-opp",
      origin: "planner",
      kind: "intro",
      category: "hobby",
      objective: "climbing",
      participants: ["a", "b"],
      alternates: ["c"],
      primed: [],
      explanations: { a: "intro", b: "intro" },
      score: 0.8,
    });
    (w.net as any).submit(oppReview);
    expect(oppReview.stage).toBe("review");

    // Ben's record is paused in snapshot
    (w.net as any).record("b").state = "paused";
    const mb = (w.net as any).members.get("b")!;
    (w.net as any).syncMember(mb);

    // Review opportunity must close because participant paused
    expect(oppReview.stage).toBe("closed");
    expect(oppReview.closedReason).toBe("paused participation");

    // 2. In probing: member b pauses and is replaced by alternate c
    // Reset Ben to normal first to create a probing opp
    (w.net as any).record("b").state = "normal";
    mb.state = "normal";
    const oppProbing = (w.net as any).newOpp({
      id: "probing-opp",
      origin: "planner",
      kind: "intro",
      category: "hobby",
      objective: "climbing",
      participants: ["a", "b"],
      alternates: ["c"],
      primed: [],
      explanations: { a: "intro", b: "intro" },
      score: 0.8,
    });
    oppProbing.stage = "probing";
    oppProbing.status.set("a", "probing");
    oppProbing.status.set("b", "probing");

    // Ben transitions to paused again
    (w.net as any).record("b").state = "paused";
    (w.net as any).syncMember(mb);

    // In probing, Ben is replaced by alternate c
    expect(oppProbing.participants).toEqual(["a", "c"]);
    expect(oppProbing.status.get("c")).toBe("queued");
  });

  it("distinctAlternates filters out paused members from alternate candidate slots", async () => {
    const w = new Mini([
      person("a", "Ana Diaz", "normal"),
      person("b", "Ben Ito", "normal"),
      person("c", "Chloe Chen", "paused"),
      person("d", "David Miller", "normal"),
    ]);
    await w.onboard("a", "b", "c", "d");

    const alts = (w.net as any).distinctAlternates(["a", "b"], ["c", "d"]);
    // Chloe is paused, so distinctAlternates must omit c and only include d
    expect(alts).toEqual(["d"]);
  });
});
