// Real webhook deliveries captured on 2026-10-07 (first live send from +18087881821 to the founder's phone,
// payload version 2026-10-01). Phone number replaced with a reserved test number; signature headers stripped.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseBlooioWebhook } from "../src/blooio/webhook.ts";

const dir = join(import.meta.dir, "fixtures/live-2026-10-07");
const captures = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as {
  headers: Record<string, string>; body: { id: string; type: string; data: { message_id?: string } };
});

describe("live 2026-10-01 status webhooks", () => {
  test("each parses to a status event for the same provider message", () => {
    const events = captures.map((c) => parseBlooioWebhook(JSON.stringify(c.body), Date.now()));
    for (const ev of events) expect(ev.kind).toBe("status");
    const ids = new Set(events.map((ev) => (ev.kind === "status" ? ev.providerMessageId : "")));
    expect(ids.size).toBe(1);
    expect(events.map((ev) => (ev.kind === "status" ? ev.status : ""))).toEqual(["sent", "queued", "delivered"]);
  });

  test("they arrive out of order (sent before queued), so status handling must not assume order", () => {
    expect(captures.map((c) => c.body.type)).toEqual(["message.sent", "message.queued", "message.delivered"]);
  });

  test("delivery resolves the transport to iMessage", () => {
    const delivered = parseBlooioWebhook(JSON.stringify(captures[2]!.body), Date.now());
    expect(delivered.kind === "status" && delivered.transport).toBe("imessage");
  });

  test("headers carry event type, version and webhook id; each event has its own envelope id", () => {
    for (const c of captures) {
      expect(c.headers["x-blooio-event"]).toBe(c.body.type);
      expect(c.headers["x-blooio-version"]).toBe("2026-10-01");
    }
    expect(new Set(captures.map((c) => c.body.id)).size).toBe(3);
  });
});
