import { expect, test } from "vitest";
import type { SendRequest } from "../../blooio/src/types.ts";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { BlooioAdapter } from "../service/channel.ts";
import { monthlyGatheringInvitePrefix } from "../service/monthly-gathering-delivery.ts";
import { NetworkService } from "../service/service.ts";

// spec/monthlyGatheringDelivery.md, "A gathering and its invitation recipients both need exact review"
test.skipIf(!pgAvailable)("a reviewed listing invitation already waiting in the carrier queue cannot escape after the published time changes", async () => {
  const url = await migratedDb("network_monthly_gathering_claim");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 17));
  const secret = "synthetic-monthly-gathering-claim-fixture";
  const line = "+12125550100", phone = "+12125550242";
  const id = "17052633-5140-4373-9702-074049127748";
  const app = APPS.ntwrk;
  const sent: SendRequest[] = [];
  const startService = () => new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: true }], devMatching: ["ntwrk:nyc"],
    adapter: () => new BlooioAdapter({ app: "ntwrk", from: line, clock, log: () => {},
      provider: { kind: "sim", async send(request) {
        sent.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
      } },
    }),
  });
  let service = startService();
  try {
    await service.start();
    expect(await service.accounts.invite(app, phone)).toBeTruthy();
    const joined = await service.accounts.join(app, { e164: phone, personId: null }, {
      firstName: "Ari", age: 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
    });
    if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
    const { memberId } = joined.membership;
    for (const [index, text] of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) {
      clock.advance(MINUTE);
      const messageId = `gathering-listing-onboarding-${index}`;
      const input: TurnRequest = { app: "ntwrk", from: phone, messageId, text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
      const body = JSON.stringify(input);
      const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
      expect((await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }))).status).toBe(200);
    }
    const startsAt = Date.UTC(2026, 10, 21, 17), endsAt = startsAt + HOUR;
    const approvedAt = new Date(clock.now());
    await sql`insert into network.public_event_imports (source,checked_at) values ('nyc-parks',${approvedAt})`;
    await sql`insert into network.public_events
      (source,source_id,city,source_url,title,venue,area,latitude,longitude,starts_at,ends_at,category,tags)
      values ('nyc-parks','202','nyc','https://www.nycgovparks.org/events/fixture','Public gathering','Public park','Brooklyn',
        40.75,-73.95,${new Date(startsAt)},${new Date(endsAt)},'events','{}')`;
    await sql`insert into network.monthly_gatherings (app_id,id,city,month,venue_kind,venue_ref,venue_name,
      starts_at,ends_at,capacity,status,revision,created_by,created_at,reviewed_by,reviewed_at)
      values ('ntwrk',${id},'nyc','2026-11','listing','nyc-parks:202','Public park',${new Date(startsAt)},${new Date(endsAt)},
        3,'approved',1,'creator',${approvedAt},'reviewer',${approvedAt})`;
    await sql`insert into network.monthly_gathering_invitation_reviews
      (app_id,gathering_id,revision,selection_hash,recipient_count,reviewed_by,reviewed_at)
      values ('ntwrk',${id},1,${"a".repeat(64)},1,'reviewer',${approvedAt})`;
    await sql`insert into network.monthly_gathering_invitees (app_id,gathering_id,revision,member_id,position) values ('ntwrk',${id},1,${memberId},1)`;

    const deliveryId = `${monthlyGatheringInvitePrefix}${id}:1:${memberId}`;
    const queue = async () => (await sql`select status,attempts,person_cap from platform.outbound where id=${deliveryId}`)[0];
    const invitations = () => sent.filter(request => request.idempotencyKey === `tn:${deliveryId}`);
    const adapter = () => service.runtimeFor("ntwrk")!.adapter as BlooioAdapter;
    await adapter().lineSafety("review", "fixture");
    for (let slot = 0; !await queue() && slot < 24; slot++) {
      clock.advance(HOUR);
      await service.tick();
    }
    expect(await queue()).toEqual({ status: "retry_scheduled", attempts: 0, person_cap: false });
    expect(invitations()).toHaveLength(0);

    await sql`update network.public_events set starts_at=${new Date(startsAt + HOUR)},ends_at=${new Date(endsAt + HOUR)}
      where source='nyc-parks' and source_id='202'`;
    await adapter().lineSafety(undefined);
    clock.advance(HOUR);
    await service.runtimeFor("ntwrk")!.deliver();
    expect(await queue()).toMatchObject({ status: "suppressed_ineligible", attempts: 0 });
    expect(invitations()).toHaveLength(0);
    expect(await sql`select 1 from platform.person_sends where msg_id=${deliveryId}`).toEqual([]);

    await sql`update network.public_events set starts_at=${new Date(startsAt)},ends_at=${new Date(endsAt)}
      where source='nyc-parks' and source_id='202'`;
    await service.close();
    service = startService();
    await service.start();
    await service.tick();
    expect(await queue()).toMatchObject({ status: "suppressed_ineligible", attempts: 0 });
    expect(invitations()).toHaveLength(0);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
