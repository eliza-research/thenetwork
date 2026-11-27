import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import type { OtpProvider } from "../../platform/src/otp.ts";
import { LocalDiskPhotoStorage } from "../../platform/src/photos.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

const ORIGIN = "https://slop-qa.example.test";
const SECRET = "a-synthetic-staging-page-link-turn-secret";

class NoOtp implements OtpProvider {
  readonly name = "none";
  async send(): Promise<{ code: string }> { throw new Error("no code is sent in this test"); }
}

test.skipIf(!pgAvailable)("a staging backend links the photo upload page and the phone page on the staging site origin", async () => {
  const url = await migratedDb("staging_page_links");
  const sql = new SQL(url);
  const photoDir = mkdtempSync(join(tmpdir(), "staging-page-links-"));
  const clock = new SimClock(Date.UTC(2026, 10, 20, 17));
  await sql`update platform.settings set value = 'staging' where key = 'environment'`;
  const service = await NetworkService.fromDatabase({
    url, clock, log: () => {}, notify: false, instance: "staging-page-links",
    env: {
      PLATFORM_ENV: "staging", STAGING_SITE_ORIGINS: JSON.stringify({ slop: ORIGIN }), SERVICE_TURN_SECRET: SECRET,
      PLATFORM_HASH_KEY: "staging-page-links-hash-key-".repeat(2), PLATFORM_SESSION_SECRET: "staging-page-links-session-secret-".repeat(2),
    },
    publicApi: { otp: new NoOtp(), turnstile: { verify: async () => true }, minStartMs: 0, minVerifyMs: 0 },
    adapter: () => new DryRunAdapter(() => {}),
    photoStorage: new LocalDiskPhotoStorage(photoDir),
  });
  try {
    await service.start();
    const phone = "+12125550287";
    const app = service.apps.slop;
    const joined = await service.accounts.join(app, { e164: phone, personId: null },
      { firstName: "Sam", age: 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text } });
    if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);

    const issued = await service.photoLinks.issue(joined.membership.personId, "slop", "agent");
    if (!issued.ok) throw new Error(JSON.stringify(issued));
    expect(issued.url).toMatch(new RegExp(`^${ORIGIN.replaceAll(".", "\\.")}/photos/add#[A-Za-z0-9_-]{43}$`));

    const messageId = "staging-phone-link-1";
    const input: TurnRequest = { app: "slop", from: phone, messageId, text: "change my phone number", channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const headers = await svcSign(SECRET, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
    const res = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ outcome: "handled", replies: [expect.stringContaining(`open ${ORIGIN}/phone and sign in`)] });

    const reportId = "staging-phone-link-2";
    const report: TurnRequest = { app: "slop", from: phone, messageId: reportId, text: "I changed my number to 415-555-0199.", channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const reportBody = JSON.stringify(report);
    const reportHeaders = await svcSign(SECRET, { method: "POST", path: TURN_PATH, id: reportId, body: reportBody, nowS: Math.floor(clock.now() / 1000) });
    const reportRes = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { ...reportHeaders, "content-type": "application/json" }, body: reportBody }));
    expect(reportRes.status).toBe(200);
    expect(await reportRes.json()).toMatchObject({ outcome: "handled", replies: [expect.stringContaining(`open ${ORIGIN}/phone and sign in`)] });
    expect((await service.accounts.personFor(phone))?.id).toBe(joined.membership.personId);
    expect(await service.accounts.personFor("+14155550199")).toBeUndefined();
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
    rmSync(photoDir, { recursive: true, force: true });
  }
}, 120_000);
