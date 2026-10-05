import { describe, expect, test } from "bun:test";
import { MINUTE, SimClock } from "@thenetwork/core";
import { HELP_TEXT, STOP_CONFIRMATION, SimChannel, detectKeyword } from "../src/index.ts";

describe("simulated channel adapter", () => {
  test("delivers with Clock timestamps and keeps per-recipient logs", () => {
    const clock = new SimClock(1_000_000);
    const ch = new SimChannel(clock);
    const delivered: string[] = [];
    ch.onDeliverToMember(m => delivered.push(m.body));
    ch.send("a", "hello a");
    clock.advance(5 * MINUTE);
    const m2 = ch.send("b", "hello b");
    expect(m2.ts).toBe(1_000_000 + 5 * MINUTE);
    expect(delivered).toEqual(["hello a", "hello b"]);
    expect(ch.messagesFor("a").map(m => m.body)).toEqual(["hello a"]);
    expect(ch.messagesFor("b")).toHaveLength(1);
  });

  test("STOP suppresses outbound, confirms once, START resumes; network still sees keywords", () => {
    const ch = new SimChannel(new SimClock());
    const toMember: string[] = [], toNetwork: string[] = [];
    ch.onDeliverToMember(m => toMember.push(m.body));
    ch.onInboundToNetwork(m => toNetwork.push(`${m.keyword ?? ""}:${m.body}`));
    ch.receive("a", "stop");
    expect(ch.isOptedOut("a")).toBe(true);
    expect(toMember).toEqual([STOP_CONFIRMATION]);
    expect(ch.send("a", "are you there?").status).toBe("suppressed_opted_out");
    expect(toMember).toHaveLength(1);
    ch.receive("a", "START");
    expect(ch.isOptedOut("a")).toBe(false);
    expect(ch.send("a", "welcome back").status).toBe("delivered");
    expect(toNetwork).toEqual(["STOP:stop", "START:START"]);
  });

  test("HELP auto-replies; keyword detection is exact-message only", () => {
    const ch = new SimChannel(new SimClock());
    const got: string[] = [];
    ch.onDeliverToMember(m => got.push(m.body));
    ch.receive("a", "HELP");
    expect(got).toEqual([HELP_TEXT]);
    expect(detectKeyword("Stop.")).toBe("STOP");
    expect(detectKeyword("please don't stop texting me")).toBeUndefined();
  });

  test("outbound idempotency: same key delivers once", () => {
    const ch = new SimChannel(new SimClock());
    let n = 0;
    ch.onDeliverToMember(() => n++);
    ch.send("a", "x", { idempotencyKey: "k1" });
    const dup = ch.send("a", "x", { idempotencyKey: "k1" });
    expect(dup.status).toBe("duplicate");
    expect(n).toBe(1);
    expect(ch.all()).toHaveLength(1);
  });

  test("seeded delivery failures are reproducible", () => {
    const run = () => { const ch = new SimChannel(new SimClock(), { failureRate: 0.3, seed: 5 }); return Array.from({ length: 50 }, (_, i) => ch.send("a", `m${i}`).status); };
    const r = run();
    expect(r).toEqual(run());
    expect(r.filter(s => s === "failed").length).toBeGreaterThan(5);
  });
});
