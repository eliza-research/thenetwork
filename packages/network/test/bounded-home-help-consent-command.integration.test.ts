// spec/product/stories.md, "A help request names its effort and passes safety review".
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { OutboundQueue, recipientWindowHasher } from "../../blooio/src/outbound-queue.ts";
import type { SendRequest } from "../../blooio/src/types.ts";
import { SimClock } from "../../core/src/clock.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { dropTestDb, pgAvailable, testDb } from "../../../apps/observatory/test/pg.ts";
import { boundedHomeHelpConsentCard, boundedHomeHelpConsentCommand } from "../service/bounded-home-help-consent-command.ts";
import type { HomeHelpConsentNotice } from "../src/bounded-home-help-consent.ts";
import { NY } from "../src/outreach.ts";

describe.skipIf(!pgAvailable)("home-help consent card transport (Postgres)", () => {
  let sql: SQL;
  beforeAll(async () => { sql = new SQL(await testDb()); });
  afterAll(async () => { await sql?.close(); await dropTestDb(); });

  test("a queued card reaches the recipient through the leak guard with three exact commands", async () => {
    const sent: SendRequest[] = [];
    const queue = new OutboundQueue({
      recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"),
      sql, app: "ntwrk", line: "+12125550100", clock: new SimClock(Date.UTC(2026, 9, 5, 17)),
      checks: { live: () => true, leaks: () => ({ forbidden: ["canary_owner_", "canary_address_"] }) },
      provider: { kind: "sim", async send(request) {
        sent.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent" };
      } },
    });
    const notice = {
      app: "ntwrk", id: "7a457330-6b92-49b3-a7bd-2156f9801fac", revision: 2,
      noticeId: "ac7df3ff-c0f2-415e-b298-6473d7d263f5", recipientId: "helper",
      role: "helper", task: "MoveFurniture", area: "Greenpoint", effortMinutes: 30, helperCount: 2,
      startsAt: Date.UTC(2026, 9, 6, 18), endsAt: Date.UTC(2026, 9, 6, 19), expiresAt: Date.UTC(2026, 9, 6, 4),
      ownerName: "canary_owner_", address: "canary_address_",
    } satisfies HomeHelpConsentNotice & { ownerName: string; address: string };
    const card = boundedHomeHelpConsentCard(notice);
    const outboundId = `home-help-consent:${notice.noticeId}`;
    const message = { to: "+12125550101", kind: "proactive", timeZone: NY } as const;
    await queue.enqueue(sql, [
      { ...message, id: "unsafe-raw-plan-key", text: `YES HOME HELP ${notice.id} ${notice.revision}` },
      { ...message, id: outboundId, text: card },
    ]);
    await queue.drain();
    expect(await queue.statusOf("unsafe-raw-plan-key")).toBe("parked_leak_review");
    expect(await queue.statusOf(outboundId)).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(message.to);

    const commands = sent[0]?.text.split("\n").map(boundedHomeHelpConsentCommand).filter(Boolean);
    expect(commands).toEqual(["accept", "decline", "withdraw"].map(decision => ({
      kind: "answer", id: notice.id, revision: notice.revision, decision,
    })));
    expect(boundedHomeHelpConsentCommand("yes")).toBeUndefined();
    expect(boundedHomeHelpConsentCommand("WITHDRAW HOME HELP OFFER")).toBeUndefined();
    expect(boundedHomeHelpConsentCommand(`YES HOME HELP ${notice.id}`)).toEqual({ kind: "invalid" });
    expect(boundedHomeHelpConsentCommand(`YES HOME HELP ${notice.id} 2\nNO HOME HELP ${notice.id} 2`)).toEqual({ kind: "invalid" });
  });
});
