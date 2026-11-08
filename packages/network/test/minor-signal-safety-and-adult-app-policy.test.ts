import { describe, expect, test } from "bun:test";
import { APPS } from "../../platform/src/apps.ts";
import { Mini } from "./mini.ts";

describe("minor signal safety and 18+ app policy", () => {
  test("unknown-age member emitting minor signal triggers safety review, logs, and drops opportunities", async () => {
    // Member A joins with unknown age (treated as minor initially, minorSignal: false)
    // Member B is an adult
    const w = new Mini([
      { id: "a", name: "Alex Roe", area: "Williamsburg", interests: ["gaming"] },
      { id: "b", name: "Bob Brown", age: 25, area: "Williamsburg", interests: ["gaming"] },
    ], { review: "auto" });

    const memA = (w.net as any).member("a");
    memA.stage = "active";
    expect(memA.minor).toBe(true);
    expect(memA.minorSignal).toBe(false);

    // Simulate an opportunity where A and B were scheduled/contacted
    const opp = (w.net as any).newOpp({
      origin: "plans", kind: "intro", category: "social", objective: "meet up", detail: "meeting up",
      participants: ["a", "b"], alternates: [], primed: [], explanations: { a: "plans", b: "plans" },
      score: 0.8, generator: "test", tags: ["gaming"],
    });
    opp.stage = "scheduled";
    opp.meetingAt = w.clock.now() + 86400000;
    opp.contacted.add("a");
    opp.contacted.add("b");
    opp.bookedTold = ["a", "b"];
    opp.status.set("a", "yes");
    opp.status.set("b", "yes");

    // Member A sends a message containing a minor signal
    await w.say("a", "I am studying for my geometry test, school nights are busy");

    // 1. minorSignal must now be true
    expect(memA.minorSignal).toBe(true);

    // 2. minor_signal must be logged
    const minorLogs = w.log("minor_signal");
    expect(minorLogs).toHaveLength(1);
    expect(minorLogs[0]!.detail).toEqual({ memberId: "a" });

    // 3. minorAfterContact must have created safety case events for adult B and minor A
    const caseA = (w.net as any).cases.find((c: any) => c.memberId === "a");
    const caseB = (w.net as any).cases.find((c: any) => c.memberId === "b");
    expect(caseA).toBeDefined();
    expect(caseA.events.some((e: any) => e.kind === "minor_after_contact" && e.by === "b")).toBe(true);
    expect(caseB).toBeDefined();
    expect(caseB.events.some((e: any) => e.kind === "contact_with_minor")).toBe(true);

    // 4. Scheduled opportunity must be dropped/closed
    expect(opp.stage).toBe("closed");

    // 5. Member A should have received minorNotice
    const msgsA = w.to("a").map(s => s.body);
    expect(msgsA.some(m => m.includes("under 18"))).toBe(true);
  });

  test("unknown-age member emitting minor signal on 18+ app files age_review and halts", async () => {
    // 18+ app (minJoinAge: 18)
    const adultApp = { ...APPS.slop, minJoinAge: 18 };
    const w = new Mini([
      { id: "a", name: "Alex Roe", area: "Williamsburg", interests: ["coffee"] },
    ], { review: "auto", app: adultApp });

    const from = w.mark();
    // Member A sends a message containing a minor signal
    await w.say("a", "I am in 9th grade");

    // Must file age_review caseEvent on 18+ app
    const caseA = (w.net as any).cases.find((c: any) => c.memberId === "a");
    expect(caseA).toBeDefined();
    expect(caseA.events.some((e: any) => e.kind === "age_review")).toBe(true);

    // No teen copy / minorNotice sent on 18+ app
    const msgsA = w.to("a", from).map(s => s.body);
    expect(msgsA.some(m => m.includes("under 18"))).toBe(false);
  });

  test("unknown-age member answering age question with non-explicit minor signal on 18+ app files age_review without teen copy", async () => {
    const adultApp = { ...APPS.slop, minJoinAge: 18 };
    const w = new Mini([
      { id: "a", name: "Alex Roe", area: "Williamsburg", interests: ["dating"] },
      { id: "b", name: "Bob Smith", age: 25, area: "Williamsburg", interests: ["dating"] },
    ], { review: "auto", app: adultApp });

    // First message asks age
    await w.say("a", "Hi");
    const memA = (w.net as any).member("a");
    expect(memA.stage).toBe("age");

    const from = w.mark();
    // Alex states non-explicit minor age
    await w.say("a", "I am in 10th grade");

    // Must file age_review caseEvent
    const caseA = (w.net as any).cases.find((c: any) => c.memberId === "a");
    expect(caseA).toBeDefined();
    expect(caseA.events.some((e: any) => e.kind === "age_review")).toBe(true);

    // No teen copy sent on 18+ app
    const msgsA = w.to("a", from).map(s => s.body);
    expect(msgsA.some(m => m.includes("under 18"))).toBe(false);

    // 3rd message without numeric age or new minor signal:
    // Alex must NOT become active or enter matching on 18+ app, and age_review must not duplicate
    const from3 = w.mark();
    await w.say("a", "Can you find me a date?");
    expect(memA.stage).not.toBe("active");
    expect(memA.stage).not.toBe("q1");
    const msgsA3 = w.to("a", from3).map(s => s.body);
    expect(msgsA3).toHaveLength(0);
    const ageReviewEvents = caseA.events.filter((e: any) => e.kind === "age_review");
    expect(ageReviewEvents).toHaveLength(1);

    // 4th message: block and safety reports must NOT be dropped
    (w.net as any).member("b");
    await w.say("a", "block Bob");
    expect((w.net as any).blocks.has("a|b")).toBe(true);
  });

  test("attested minor or explicit minor age on 18+ app is declined under min join age without teen welcome", async () => {
    const adultApp = {
      ...APPS.slop,
      minJoinAge: 18,
      brand: { ...APPS.slop.brand, underAge: "Thanks for your interest in slop. You need to be at least 18 to join, so we can't sign you up." },
    };
    const w = new Mini([
      { id: "a", name: "Alex Minor", age: 16, area: "Williamsburg", interests: ["dating"] },
    ], { review: "auto", app: adultApp });

    const from = w.mark();
    // Inbound from attested minor triggers declineUnderMinAge
    await w.say("a", "Hello there");

    const msgsA = w.to("a", from).map(s => s.body);
    // Gets brand.underAge decline message, NOT teen welcome
    expect(msgsA.some(m => m.includes("at least 18"))).toBe(true);
    expect(msgsA.some(m => m.includes("under 18"))).toBe(false);

    // welcomeJoined should also guard against minors on 18+ app
    const w2 = new Mini([
      { id: "b", name: "Ben Minor", age: 15, area: "Williamsburg", interests: ["dating"] },
    ], { review: "auto", app: adultApp });

    const res = w2.net.welcomeJoined("b");
    expect(res).toBe(false);
    const msgsB = w2.to("b").map(s => s.body);
    expect(msgsB.some(m => m.includes("at least 18"))).toBe(true);
  });
});
