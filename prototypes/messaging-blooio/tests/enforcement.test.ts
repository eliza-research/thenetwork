// Pre-send enforcement added after the 2026-10-07 audit (P1-5, P1-7, P1-10, P1-11, P1-16).
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY, HOUR, SimClock } from "../../../packages/core/src/clock.ts";
import { FileConsentStore, InMemoryConsentStore } from "../src/consent-store.ts";
import { ConsentLedger } from "../src/keywords.ts";
import { NETWORK_LINE, resolveSenderLine } from "../src/line.ts";
import { isAgentInitiated, type RecipientCheck } from "../src/outbound-queue.ts";
import { normalizeAddress, toE164 } from "../src/phone.ts";
import { isValidTimeZone, resolveTimeZone } from "../src/quiet-hours.ts";
import { world } from "./helpers.ts";

const ALICE = "+15550100001";
const BOB = "+15550100002";
const LA = "America/Los_Angeles";

describe("E.164 normalization", () => {
  test.each([
    ["+1 (555) 010-0001", "+15550100001"],
    ["15550100001", "+15550100001"],
    ["555-010-0001", "+15550100001"],
    ["+15550100001", "+15550100001"],
    ["0044 20 7946 0958", "+442079460958"],
  ])("%p -> %p", (raw, want) => expect(toE164(raw)).toBe(want));
  test("non-phones are not phones", () => {
    expect(toE164("alice@example.com")).toBeNull();
    expect(toE164("chat:abc")).toBeNull();
    expect(toE164("hello")).toBeNull();
    expect(normalizeAddress(" Alice@Example.com ")).toBe("alice@example.com");
    expect(normalizeAddress("chat:AbC123")).toBe("chat:AbC123");
  });
  test("a STOP from one format blocks every other format of the same number", async () => {
    const w = world();
    w.consent.record("sim", "+1 (555) 010-0001", "opted_in", "invite_acceptance");
    await w.bus.inbound(ALICE, "STOP");
    for (const [i, to] of ["+1 (555) 010-0001", "15550100001", "555.010.0001"].entries()) {
      const r = w.queue.enqueue({ idempotencyKey: `k${i}`, channel: "sim", to, text: "hi", kind: "reply" }).record;
      await w.queue.drain();
      expect(r.status).toBe("suppressed_opt_out");
    }
  });
  test("variants of one idempotent send dedupe to one record", () => {
    const w = world();
    const a = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: "+1 555 010 0001", text: "hi", kind: "reply" });
    const b = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: "15550100001", text: "hi", kind: "reply" });
    expect(b.deduped).toBe(true);
    expect(a.record.to).toBe(ALICE);
  });
});

describe("durable opt-outs", () => {
  test("a STOP survives a restart (file store)", () => {
    const dir = mkdtempSync(join(tmpdir(), "blooio-consent-"));
    try {
      const path = join(dir, "consent.jsonl");
      const clock = new SimClock();
      const l1 = new ConsentLedger(clock, "address", new FileConsentStore(path));
      l1.record("blooio", "+1 (555) 010-0001", "opted_in", "invite_acceptance");
      l1.record("blooio", "15550100001", "opted_out", "keyword:STOP");
      // "restart": a fresh ledger on the same file
      const l2 = new ConsentLedger(clock, "address", new FileConsentStore(path));
      expect(l2.isOptedOut("blooio", ALICE)).toBe(true);
      expect(l2.isOptedOut("twilio", "555-010-0001")).toBe(true);
      expect(l2.history.map((h) => h.state)).toEqual(["opted_in", "opted_out"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  test("a store failure is not swallowed and leaves state unchanged", () => {
    const store = new InMemoryConsentStore();
    store.append = () => { throw new Error("disk full"); };
    const l = new ConsentLedger(new SimClock(), "address", store);
    expect(() => l.record("blooio", ALICE, "opted_out", "keyword:STOP")).toThrow("disk full");
    expect(l.get("blooio", ALICE)).toBeUndefined();
  });
});

describe("time zones never wedge the queue", () => {
  test("validation helpers", () => {
    expect(isValidTimeZone(LA)).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(resolveTimeZone("Mars/Olympus", "nyc")).toBe("America/New_York");
    expect(resolveTimeZone("Mars/Olympus")).toBeNull();
  });
  test("an invalid zone parks that one record; records behind it still send", async () => {
    const w = world();
    const bad = w.queue.enqueue({ idempotencyKey: "bad", channel: "sim", to: ALICE, text: "x", kind: "transactional", timeZone: "Mars/Olympus" }).record;
    const good = w.queue.enqueue({ idempotencyKey: "good", channel: "sim", to: BOB, text: "y", kind: "transactional", timeZone: LA }).record;
    await w.queue.drain();
    expect(bad.status).toBe("parked_invalid_timezone");
    expect(good.status).toBe("sent");
    expect(w.alerts).toContain("bad:invalid_timezone");
    await w.queue.drain(); // later drains don't throw either
  });
  test("an invalid zone falls back to the member's city zone", async () => {
    const w = world();
    w.clock.set(Date.parse("2026-10-06T02:00:00Z")); // 19:00 PDT, 22:00 EDT
    const r = w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "transactional", timeZone: "Bogus/Zone", city: "nyc" }).record;
    expect(r.timeZone).toBe("America/New_York");
    await w.queue.drain();
    expect(r.status).toBe("deferred_quiet_hours");
  });
  test("an unexpected dispatch error parks the record and the drain continues", async () => {
    const w = world();
    const boom = w.queue.enqueue({ idempotencyKey: "boom", channel: "sim", to: ALICE, text: "x", kind: "reply" }).record;
    const ok = w.queue.enqueue({ idempotencyKey: "ok", channel: "sim", to: BOB, text: "y", kind: "reply" }).record;
    boom.timeZone = "Mars/Olympus";
    // Corrupt the record so dispatch throws outside the adapter call (simulates a bug or bad persisted row).
    Object.defineProperty(boom, "from", { get() { throw new Error("corrupt row"); } });
    await w.queue.drain();
    expect(boom.status).toBe("parked_error");
    expect(ok.status).toBe("sent");
    expect(w.alerts).toContain("boom:dispatch_error");
  });
});

describe("quiet hours apply to every agent-initiated kind", () => {
  test("kind classification", () => {
    expect(isAgentInitiated("proactive")).toBe(true);
    expect(isAgentInitiated("transactional")).toBe(true);
    expect(isAgentInitiated("reply")).toBe(false);
    expect(isAgentInitiated("compliance")).toBe(false);
  });
  test("reminders/nudges (transactional) are deferred at night; replies and compliance are not", async () => {
    const w = world();
    w.clock.set(Date.parse("2026-10-06T06:00:00Z")); // 23:00 PDT
    const nudge = w.queue.enqueue({ idempotencyKey: "nudge", channel: "sim", to: ALICE, text: "still up for it?", kind: "transactional", timeZone: LA }).record;
    const reply = w.queue.enqueue({ idempotencyKey: "reply", channel: "sim", to: BOB, text: "sure", kind: "reply" }).record;
    await w.queue.drain();
    expect(nudge.status).toBe("deferred_quiet_hours");
    expect(reply.status).toBe("sent");
  });
  test("agent-initiated without any zone is refused at enqueue", () => {
    const w = world();
    expect(() => w.queue.enqueue({ idempotencyKey: "k", channel: "sim", to: ALICE, text: "x", kind: "transactional" })).toThrow("timeZone");
  });
});

describe("conversation rules: 3 unanswered, one re-engagement after 14 days", () => {
  const send = (w: ReturnType<typeof world>, key: string, kind: "transactional" | "reply" = "transactional") =>
    w.queue.enqueue({ idempotencyKey: key, channel: "sim", to: ALICE, text: key, kind, timeZone: LA }).record;

  test("the 4th unanswered message is held until the member replies", async () => {
    const w = world({ perRecipientPerHour: 100 });
    for (const k of ["m1", "m2", "m3"]) send(w, k);
    await w.queue.drain();
    const fourth = send(w, "m4");
    await w.queue.drain();
    expect(fourth.status).toBe("held_awaiting_reply");
    expect(w.queue.contactState("sim", ALICE)?.unanswered).toBe(3);
    expect(w.bus.inbox.get(ALICE)?.length).toBe(3);
    await w.bus.inbound(ALICE, "hey sorry, busy week");
    expect(w.queue.contactState("sim", ALICE)?.unanswered).toBe(0);
    await w.queue.drain();
    expect(fourth.status).toBe("sent");
  });

  test("replies count toward the cap too (Blooio counts every outbound)", async () => {
    const w = world({ perRecipientPerHour: 100 });
    for (const k of ["r1", "r2", "r3", "r4"]) send(w, k, "reply");
    await w.queue.drain();
    expect(w.queue.get("r4")?.status).toBe("held_awaiting_reply");
  });

  test("exactly one re-engagement after 14 days of silence, then held again", async () => {
    const w = world({ perRecipientPerHour: 100 });
    for (const k of ["m1", "m2", "m3"]) send(w, k);
    await w.queue.drain();
    w.clock.advance(13 * DAY);
    const early = send(w, "early");
    await w.queue.drain();
    expect(early.status).toBe("held_awaiting_reply");
    w.clock.advance(1 * DAY);
    const re = send(w, "reengage");
    await w.queue.drain();
    expect(re.status).toBe("sent");
    expect(w.queue.contactState("sim", ALICE)?.reengagementUsed).toBe(true);
    w.clock.advance(30 * DAY + 2 * HOUR); // past the DST change, still daytime in LA
    const again = send(w, "again");
    await w.queue.drain();
    expect(again.status).toBe("held_awaiting_reply");
    expect(again.history.at(-1)?.note).toContain("re-engagement already used");
    // An inbound resets everything.
    await w.bus.inbound(ALICE, "back!");
    expect(w.queue.contactState("sim", ALICE)).toMatchObject({ unanswered: 0, reengagementUsed: false });
  });

  test("compliance confirmations are never capped", async () => {
    const w = world({ perRecipientPerHour: 100 });
    for (const k of ["m1", "m2", "m3"]) send(w, k);
    await w.queue.drain();
    const c = w.queue.enqueue({ idempotencyKey: "c", channel: "sim", to: ALICE, text: "help copy", kind: "compliance" }).record;
    await w.queue.drain();
    expect(c.status).toBe("sent");
  });
});

describe("per-line new-conversation cap", () => {
  test("applies to every agent-initiated kind and resolves the line from defaultFrom", async () => {
    const w = world({ newChatsPerLinePerDay: 2, defaultFrom: { sim: "+1 (555) 010-0199" } });
    const people = ["+15550100011", "+15550100012", "+15550100013"];
    const recs = people.map((p, i) => w.queue.enqueue({ idempotencyKey: `t${i}`, channel: "sim", to: p, text: "reminder", kind: "transactional", timeZone: LA }).record);
    await w.queue.drain();
    expect(recs.map((r) => r.status)).toEqual(["sent", "sent", "retry_scheduled"]);
    expect(recs[0].from).toBe("+15550100199");
  });
});

describe("send-time recipient eligibility", () => {
  test("a member paused/blocked/minor after enqueue is not messaged", async () => {
    const state = new Map<string, RecipientCheck>();
    const w = world({ recipientPolicy: (to, ctx) => (ctx.agentInitiated ? state.get(to) ?? { ok: true } : { ok: true }) });
    const a = w.queue.enqueue({ idempotencyKey: "a", channel: "sim", to: ALICE, text: "intro", kind: "transactional", timeZone: LA }).record;
    const r = w.queue.enqueue({ idempotencyKey: "r", channel: "sim", to: ALICE, text: "answer", kind: "reply" }).record;
    state.set(ALICE, { ok: false, reason: "paused" }); // changed between enqueue and send
    await w.queue.drain();
    expect(a.status).toBe("suppressed_ineligible");
    expect(a.history.at(-1)?.note).toBe("paused");
    expect(r.status).toBe("sent"); // the policy chose to allow direct replies to a paused member
  });
  test("policy errors fail closed", async () => {
    const w = world({ recipientPolicy: () => { throw new Error("db down"); } });
    const a = w.queue.enqueue({ idempotencyKey: "a", channel: "sim", to: ALICE, text: "x", kind: "reply" }).record;
    await w.queue.drain();
    expect(a.status).toBe("suppressed_ineligible");
    expect(a.history.at(-1)?.note).toContain("policy_error");
  });
  test("the policy sees the normalized address and kind", async () => {
    const seen: string[] = [];
    const w = world({ recipientPolicy: async (to, ctx) => { seen.push(`${to}:${ctx.kind}`); return { ok: false, reason: "minor" }; } });
    w.queue.enqueue({ idempotencyKey: "a", channel: "sim", to: "(555) 010-0001", text: "x", kind: "transactional", timeZone: LA });
    await w.queue.drain();
    expect(seen).toEqual([`${ALICE}:transactional`]);
  });
});

describe("sender line env", () => {
  test("BLOOIO_FROM is canonical; BLOOIO_FROM_NUMBER is an alias; both are normalized", () => {
    expect(resolveSenderLine({ BLOOIO_FROM: "+1 (808) 788-1821" })).toBe(NETWORK_LINE);
    expect(resolveSenderLine({ BLOOIO_FROM_NUMBER: "18087881821" })).toBe(NETWORK_LINE);
    expect(resolveSenderLine({ BLOOIO_FROM: NETWORK_LINE, BLOOIO_FROM_NUMBER: "808-788-1821" })).toBe(NETWORK_LINE);
    expect(resolveSenderLine({})).toBeUndefined();
  });
  test("conflicting or invalid values throw", () => {
    expect(() => resolveSenderLine({ BLOOIO_FROM: NETWORK_LINE, BLOOIO_FROM_NUMBER: "+15550100199" })).toThrow("differ");
    expect(() => resolveSenderLine({ BLOOIO_FROM: "not a number" })).toThrow("E.164");
  });
});
