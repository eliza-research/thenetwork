import { describe, expect, test } from "bun:test";
import { SimClock } from "../../../packages/core/src/clock.ts";
import { BlooioAdapter } from "../src/adapters/blooio-adapter.ts";
import { BlooioClient } from "../src/blooio/client.ts";
import { signBlooioPayload } from "../src/blooio/webhook.ts";
import { InMemoryDedupeStore } from "../src/dedupe.ts";
import { Gateway } from "../src/gateway.ts";
import { ConsentLedger, defaultCopy } from "../src/keywords.ts";
import { OutboundQueue } from "../src/outbound-queue.ts";
import { createWebhookHandler, WEBHOOK_PATH } from "../src/server.ts";
import type { InboundMessage } from "../src/types.ts";
import { fixture, mockFetch, world } from "./helpers.ts";

const SECRET = "whsec_test";

/** Full Blooio stack with a mocked HTTP layer: webhook in -> gateway -> queue -> BlooioClient -> mock fetch. */
function blooioStack() {
  const clock = new SimClock(1_791_216_000_000);
  let n = 0;
  const http = mockFetch((url) => url.endsWith("/messages")
    ? Response.json({ id: `msg_out_${++n}`, chat_id: "chat_abc", status: "queued", protocol: "pending" }, { status: 202 })
    : Response.json({ ok: true }));
  const consent = new ConsentLedger(clock);
  const queue = new OutboundQueue({ clock, consent, adapters: { blooio: new BlooioAdapter(new BlooioClient({ apiKey: "api_test", fetch: http.fn }), "+15550000001") } });
  const agent: InboundMessage[] = [];
  const gateway = new Gateway({ dedupe: new InMemoryDedupeStore(clock), consent, copy: defaultCopy("help@test"), queue, onMessage: (m) => { agent.push(m); } });
  const handle = createWebhookHandler({ secret: SECRET, clock, gateway });
  const post = (raw: string, opts: { sig?: string; t?: number } = {}) => handle(new Request(`http://localhost${WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-blooio-signature": opts.sig ?? signBlooioPayload(SECRET, raw, opts.t ?? Math.floor(clock.now() / 1000)), "x-blooio-delivery": "wdel_1" },
    body: raw,
  }));
  return { clock, http, consent, queue, agent, handle, post };
}

describe("webhook receiver (Blooio payloads, mocked HTTP)", () => {
  test("valid inbound reaches the agent once; provider retries are deduped", async () => {
    const s = blooioStack();
    const raw = fixture("received.v20261001.json");
    const r1 = await s.post(raw);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toEqual({ ok: true, result: "message" });
    const r2 = await s.post(raw); // Blooio retry: same envelope id
    expect(await r2.json()).toEqual({ ok: true, result: "duplicate" });
    expect(s.agent.length).toBe(1);
  });

  test("same message via a second subscription (new envelope id) is still deduped by message id", async () => {
    const s = blooioStack();
    const raw = fixture("received.v20261001.json");
    await s.post(raw);
    const other = JSON.stringify({ ...JSON.parse(raw), id: "evt_other_subscription" });
    expect(await (await s.post(other)).json()).toEqual({ ok: true, result: "duplicate" });
  });

  test("bad, stale, or missing signatures get 401 and never reach the agent", async () => {
    const s = blooioStack();
    const raw = fixture("received.v20261001.json");
    expect((await s.post(raw, { sig: signBlooioPayload("whsec_wrong", raw, Math.floor(s.clock.now() / 1000)) })).status).toBe(401);
    expect((await s.post(raw, { t: Math.floor(s.clock.now() / 1000) - 600 })).status).toBe(401);
    expect((await s.handle(new Request(`http://localhost${WEBHOOK_PATH}`, { method: "POST", body: raw }))).status).toBe(401);
    expect(s.agent.length).toBe(0);
  });

  test("STOP over Blooio: opt-out recorded, one confirmation sent with an idempotency key, agent not called", async () => {
    const s = blooioStack();
    const res = await s.post(fixture("received.v20260901.json"));
    expect(await res.json()).toEqual({ ok: true, result: "keyword" });
    expect(s.consent.isOptedOut("blooio", "+15551234567")).toBe(true);
    const sends = s.http.calls.filter((c) => c.url.endsWith("/v4/messages"));
    expect(sends.length).toBe(1);
    const body = JSON.parse(sends[0].init.body as string);
    expect(body).toMatchObject({ to: "+15551234567", from: "+15550000001" });
    expect(body.text).toContain("unsubscribed");
    expect((sends[0].init.headers as Record<string, string>)["Idempotency-Key"]).toBe("tn:kw:blooio:msg_in_0002");
    expect(s.agent.length).toBe(0);
    // Retry of the same webhook does not send a second confirmation.
    await s.post(fixture("received.v20260901.json"));
    expect(s.http.calls.filter((c) => c.url.endsWith("/v4/messages")).length).toBe(1);
  });

  test("HELP via legacy v2 flat payload gets help copy", async () => {
    const s = blooioStack();
    await s.post(fixture("legacy.v2.flat.json"));
    const body = JSON.parse(s.http.calls.find((c) => c.url.endsWith("/v4/messages"))!.init.body as string);
    expect(body.text).toContain("Reply STOP to opt out");
  });

  test("delivery receipts update the outbound record", async () => {
    const s = blooioStack();
    s.queue.enqueue({ idempotencyKey: "k", channel: "blooio", to: "+15551234567", text: "hi", kind: "reply" });
    await s.queue.drain();
    expect(s.queue.get("k")?.providerMessageId).toBe("msg_out_1");
    const delivered = JSON.stringify({ ...JSON.parse(fixture("status.delivered.json")), data: { message_id: "msg_out_1", status: "delivered", direction: "outbound", protocol: "imessage" } });
    expect(await (await s.post(delivered)).json()).toEqual({ ok: true, result: "status" });
    expect(s.queue.get("k")?.status).toBe("delivered");
    expect(s.queue.get("k")?.transport).toBe("imessage");
  });

  test("bad JSON with a valid signature is 400; agent errors are 500 so Blooio retries, and the retry is processed", async () => {
    const s = blooioStack();
    expect((await s.post("{nope")).status).toBe(400);

    const clock = new SimClock(1_791_216_000_000);
    const consent = new ConsentLedger(clock);
    let failOnce = true;
    const seen: string[] = [];
    const gateway = new Gateway({
      dedupe: new InMemoryDedupeStore(clock), consent, copy: defaultCopy(), queue: new OutboundQueue({ clock, consent, adapters: {} }),
      onMessage: (m) => { if (failOnce) { failOnce = false; throw new Error("db down"); } seen.push(m.messageId); },
    });
    const handle = createWebhookHandler({ secret: SECRET, clock, gateway });
    const raw = fixture("received.v20261001.json");
    const req = () => new Request(`http://localhost${WEBHOOK_PATH}`, { method: "POST", headers: { "x-blooio-signature": signBlooioPayload(SECRET, raw, Math.floor(clock.now() / 1000)) }, body: raw });
    expect((await handle(req())).status).toBe(500);
    expect((await handle(req())).status).toBe(200);
    expect(seen).toEqual(["msg_in_0001"]);
  });

  test("healthz and 404s", async () => {
    const s = blooioStack();
    expect((await s.handle(new Request("http://localhost/healthz"))).status).toBe(200);
    expect((await s.handle(new Request("http://localhost/other", { method: "POST" }))).status).toBe(404);
    expect((await s.handle(new Request(`http://localhost${WEBHOOK_PATH}`))).status).toBe(405);
  });
});

describe("adapter swap: same gateway logic on the simulated bus", () => {
  test("onboarding-style exchange, STOP, START entirely in memory", async () => {
    const w = world();
    const MAYA = "+15559990001";
    await w.bus.inbound(MAYA, "hi, Sam invited me");
    expect(w.agentInbox.map((x) => x.msg.text)).toEqual(["hi, Sam invited me"]);
    w.queue.enqueue({ idempotencyKey: "onb-1", channel: "sim", to: MAYA, text: "Welcome! What are you hoping to find?", kind: "reply" });
    await w.queue.drain();
    await w.bus.flush();
    expect(w.queue.get("onb-1")?.status).toBe("delivered");
    await w.bus.inbound(MAYA, "Stop");
    expect(w.consent.isOptedOut("sim", MAYA)).toBe(true);
    await w.bus.inbound(MAYA, "are you still there?");
    expect(w.agentInbox.at(-1)).toMatchObject({ optedOut: true });
    await w.bus.inbound(MAYA, "START");
    expect(w.consent.isOptedOut("sim", MAYA)).toBe(false);
    expect(w.bus.inbox.get(MAYA)?.map((m) => m.text.slice(0, 12))).toEqual(["Welcome! Wha", "You're unsub", "You're back "]);
  });

  test("duplicate simulated delivery is deduped like a Blooio retry", async () => {
    const w = world();
    await w.bus.inbound("+15559990002", "hello", { messageId: "m1", eventId: "e1" });
    const r = await w.bus.inbound("+15559990002", "hello", { messageId: "m1", eventId: "e1" });
    expect(r).toEqual({ outcome: "duplicate" });
    expect(w.agentInbox.length).toBe(1);
  });
});
