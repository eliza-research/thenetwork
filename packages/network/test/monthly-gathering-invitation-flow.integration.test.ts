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
import { gatheringRsvpCommand } from "../service/monthly-gathering-rsvp.ts";
import { NetworkService } from "../service/service.ts";

test.skipIf(!pgAvailable)("the tick delivers only current staff-approved gathering invitations with a working RSVP command", async () => {
  // spec/monthlyGatheringDelivery.md, "A gathering and its invitation recipients both need exact review"
  // spec/monthlyGatheringDelivery.md, "One approved text goes through the usual outbound controls"
  const url = await migratedDb("monthly_gathering_invitation_flow");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 17));
  const secret = "a-synthetic-gathering-invitation-flow-secret";
  const sent: SendRequest[] = [];
  const invites = () => sent.filter(send => send.idempotencyKey.startsWith(`tn:${monthlyGatheringInvitePrefix}`));
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, notify: false,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "admin@ntwrk:ntwrk-admin,reviewer@ntwrk:ntwrk-reviewer",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: true }], devMatching: ["ntwrk:nyc"],
    adapter: (_net, rt) => new BlooioAdapter({ app: rt.app.id, from: "+12125550100", clock, liveGate: () => true, log: () => {},
      provider: { kind: "sim", async send(request) {
        sent.push(request);
        return { providerMessageId: `sim:${request.idempotencyKey}`, status: "sent", acceptedAt: clock.now() };
      } },
    }),
  });
  const base = "/apps/ntwrk/gatherings";
  const staff = (path: string, body?: object, token = "ntwrk-admin") => service.fetch(new Request(`http://localhost${path}`, {
    method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  }));
  const send = async (phone: string, messageId: string, text: string) => {
    const input: TurnRequest = { app: "ntwrk", from: phone, messageId, text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
  };

  try {
    await service.start();
    const members = new Map<string, string>();
    for (const [phone, firstName] of [["+12125550233", "Ari"], ["+12125550234", "Bea"]] as const) {
      const app = APPS.ntwrk;
      const invitation = await service.accounts.invite(app, phone);
      if (!invitation) throw new Error("Fixture invitation refused");
      const joined = await service.accounts.join(app, { e164: phone, personId: invitation.personId },
        { firstName, age: 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
      members.set(joined.membership.memberId, phone);
      for (const [index, text] of ["I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"].entries()) {
        clock.advance(MINUTE);
        expect((await send(phone, `gathering-${firstName}-${index}`, text)).status).toBe(200);
      }
    }
    const startsAt = Date.UTC(2026, 10, 21, 17);
    const created = await staff(base, { month: "2026-11", venue: { kind: "curated", id: "mccarren-park" }, startsAt, endsAt: startsAt + HOUR, capacity: 8 });
    expect(created.status).toBe(201);
    const { gathering: { id } } = await created.json();
    expect((await staff(`${base}/${id}/review`, { decision: "approve", revision: 0 })).status).toBe(200);
    const reviewPath = `${base}/${id}/invitations/review`;
    const priority = await (await staff(`${base}/${id}/priority?revision=1`)).json();
    const memberIds: string[] = priority.items;
    expect(memberIds).toHaveLength(2);
    expect(memberIds.every(memberId => members.has(memberId))).toBe(true);
    await service.tick();
    expect(invites()).toHaveLength(0);
    expect((await staff(reviewPath, { revision: 1, memberIds }, "ntwrk-reviewer")).status).toBe(403);
    expect((await staff(reviewPath, { revision: 1, memberIds: [...memberIds].reverse() })).status).toBe(409);
    const review = await staff(reviewPath, { revision: 1, memberIds });
    expect(review.ok).toBe(true);
    expect(await review.json()).toMatchObject({ ok: true, replayed: false, review: { id, revision: 1, count: 2 } });
    expect(await sql`select * from platform.outbound where id like ${`${monthlyGatheringInvitePrefix}%`}`).toHaveLength(0);
    expect((await staff("/apps/ntwrk/matching", { on: false })).status).toBe(200);
    await service.tick();
    expect(invites()).toHaveLength(0);
    expect((await staff("/apps/ntwrk/matching", { on: true })).status).toBe(200);

    const stoppedPhone = members.get(memberIds[0]!)!;
    const recipient = members.get(memberIds[1]!)!;
    expect((await send(stoppedPhone, "gathering-stop", "STOP")).status).toBe(200);
    for (let slot = 0; !invites().length && slot < 24; slot++) {
      clock.advance(HOUR);
      await service.tick();
    }
    expect(invites().map(invite => invite.to)).toEqual([recipient]);
    const command = invites()[0]!.text.split("\n").find(line => gatheringRsvpCommand(line));
    expect(gatheringRsvpCommand(command ?? "")).toMatchObject({ id, revision: 1 });
    const rsvp = await send(recipient, "gathering-approved-invitation-rsvp", command!);
    expect(await rsvp.json()).toMatchObject({ outcome: "handled", reason: "gathering_rsvp", replies: [expect.any(String)] });
    expect(await (await staff(reviewPath, { revision: 1, memberIds })).json()).toMatchObject({ replayed: true });
    clock.advance(HOUR);
    await service.tick();
    expect(invites()).toHaveLength(1);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
