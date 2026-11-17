import { expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS, type AppId } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

test.skipIf(!pgAvailable)("monthly gathering approval enables private signed RSVPs and a current staff roster", async () => {
  const url = await migratedDb("monthly_gathering_flow");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "a-synthetic-monthly-gathering-flow-secret";
  const phone = "+12125550231";
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => new DryRunAdapter(() => {}),
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "admin@ntwrk:ntwrk-admin,reviewer@ntwrk:ntwrk-reviewer,admin@friends:friends-admin",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
  });
  const base = "/apps/ntwrk/gatherings";
  const staffRequest = (path: string, token = "ntwrk-admin", body?: object) => new Request(`http://localhost${path}`, {
    method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body && { body: JSON.stringify(body) }),
  });
  const staff = (path: string, token?: string, body?: object) => service.fetch(staffRequest(path, token, body));
  const turn = (id: string, text: string, app: AppId = "ntwrk"): TurnRequest => ({ app, from: phone, messageId: id,
    text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null });
  const send = async (input: TurnRequest) => {
    const body = JSON.stringify(input);
    const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body }));
  };

  try {
    await service.start();
    const app = APPS.ntwrk;
    const invitation = await service.accounts.invite(app, phone);
    if (!invitation) throw new Error("Fixture invitation refused");
    const joined = await service.accounts.join(app, { e164: phone, personId: invitation.personId },
      { firstName: "Ari", age: 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text } });
    if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
    const memberId = joined.membership.memberId;
    const startsAt = Date.UTC(2026, 10, 21, 17);
    const create = { month: "2026-11", venue: { kind: "curated", id: "mccarren-park" }, startsAt, endsAt: startsAt + HOUR, capacity: 8 };
    expect((await staff(base, "ntwrk-reviewer", create)).status).toBe(403);
    expect((await service.publicFetch(staffRequest(base))).status).toBe(404);
    const created = await staff(base, undefined, create);
    expect(created.status).toBe(201);
    const { gathering: draft } = await created.json();
    expect(draft).toMatchObject({ app: "ntwrk", city: "nyc", status: "draft", revision: 0 });
    const yes = `RSVP GATHERING ${draft.id} 1 YES WITH GROUPING`;
    const waitForReview = await send(turn("gathering-draft", yes));
    expect(await waitForReview.json()).toMatchObject({ reason: "gathering_rsvp", replies: [] });
    expect(await sql`select * from network.monthly_gathering_rsvps`).toHaveLength(0);
    const outboundBeforeReview = await sql`select id from network.messages where direction='outbound' order by id`;
    const approved = await staff(`${base}/${draft.id}/review`, undefined, { decision: "approve", revision: 0 });
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ gathering: { id: draft.id, status: "approved", revision: 1 } });
    expect(await sql`select id from network.messages where direction='outbound' order by id`).toEqual(outboundBeforeReview);

    const wrongApp = await send(turn("gathering-friends", yes, "friends"));
    expect(await wrongApp.json()).toMatchObject({ reason: "gathering_rsvp", replies: [] });
    clock.advance(MINUTE);
    const request = turn("gathering-join", yes);
    const affirmative = await send(request);
    expect(affirmative.status).toBe(200);
    const receipt = await affirmative.json();
    expect(receipt).toMatchObject({ reason: "gathering_rsvp", outcome: "handled", replies: [expect.any(String)] });
    expect(await (await send(request)).json()).toEqual(receipt);
    const roster = `${base}/${draft.id}/roster?revision=1`;
    expect((await staff(roster, "friends-admin")).status).toBe(403);
    expect(await (await staff(roster)).json()).toEqual({ ok: true, items: [{ memberId, grouping: true }] });
    expect(await sql`select direction, body from network.messages where type='gathering_rsvp' order by direction`).toEqual([
      { direction: "inbound", body: "Private gathering RSVP." }, { direction: "outbound", body: "Private gathering RSVP reply." },
    ]);

    clock.advance(MINUTE);
    const withdrawal = await send(turn("gathering-withdraw", `WITHDRAW GATHERING ${draft.id} 1`));
    expect(withdrawal.status).toBe(200);
    expect(await withdrawal.json()).toMatchObject({ reason: "gathering_rsvp", replies: [expect.any(String)] });
    expect((await send(request)).status).toBe(409);
    expect(await (await staff(roster)).json()).toEqual({ ok: true, items: [] });
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
