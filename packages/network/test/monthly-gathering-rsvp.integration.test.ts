import { expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { importPublicEvents } from "../service/import-public-events.ts";
import { NetworkService } from "../service/service.ts";

// spec/monthlyGatheringRsvp.md, "Choose how to attend the monthly gathering"
test.skipIf(!pgAvailable)("signed gathering RSVPs bind to the approved app and revision and never exceed remaining seats", async () => {
  const url = await migratedDb("network_gathering_rsvp");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 18));
  const secret = "synthetic-gathering-rsvp-signed-integration";
  const admin = "gathering-rsvp-fixture-admin", reviewer = "gathering-rsvp-fixture-reviewer";
  const app = APPS.ntwrk;
  const createService = () => new NetworkService({ url, clock, photoStorage: null, log: () => {},
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: `admin@ntwrk:${admin},reviewer@ntwrk:${reviewer}`,
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
  });
  let service = createService();
  try {
    await service.start();
    const joined = [];
    for (const [index, age] of [32, 29, 34, 27, 16].entries()) {
      const e164 = `+1212555040${index}`;
      expect(await service.accounts.invite(app, e164)).toBeTruthy();
      const result = await service.accounts.join(app, { e164, personId: null }, {
        firstName: "River", age, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
      });
      if (!result.ok) throw new Error(`Fixture join failed: ${result.error}`);
      joined.push({ e164, ...result.membership });
    }
    const [first, second, third, fourth, minor] = joined;
    const friend = await service.accounts.join(APPS.friends, { e164: first!.e164, personId: null }, {
      firstName: "River", age: 32, homeCity: "nyc", consent: { sms: true, wording: APPS.friends.consent.text },
    });
    expect(friend.ok).toBe(true);
    const id = "8dc37920-c390-403b-8489-18bd4cc987ec";
    const startsAt = clock.now() + 2 * HOUR;
    const listing = { guid: "202", link: { url: "https://www.nycgovparks.org/events/2026/11/16/public-gathering" },
      title: "Public gathering", location: "Public park", categories: "Sports", coordinates: "40.75,-73.95",
      starttime: "2026-11-16T15:00:00", endtime: "2026-11-16T16:00:00" };
    const publish = async (entry: typeof listing) => {
      const request: typeof fetch = async () => Response.json([entry]);
      expect(await importPublicEvents(sql, clock, request)).toEqual({ published: true, events: 1 });
    };
    await publish(listing);
    await sql`insert into network.monthly_gatherings (app_id,id,city,month,venue_kind,venue_ref,venue_name,
      starts_at,ends_at,capacity,created_by,created_at)
      values ('ntwrk',${id},'nyc','2026-11','listing','nyc-parks:202','Public park',${new Date(startsAt)},
        ${new Date(startsAt + HOUR)},3,'creating-staff',${new Date(clock.now())})`;
    const yes = `RSVP GATHERING ${id} 1 YES`;
    const request = (messageId: string, from: string, text = yes, targetApp: "ntwrk" | "friends" = "ntwrk", receivedAt = clock.now()): TurnRequest =>
      ({ messageId, channel: "blooio", from, to: null, text, transport: "imessage", receivedAt, app: targetApp });
    const post = async (body: TurnRequest, signed = true) => {
      const raw = JSON.stringify(body);
      const headers = signed ? await svcSign(secret, { method: "POST", path: TURN_PATH, id: body.messageId, body: raw,
        nowS: Math.floor(clock.now() / 1000) }) : {};
      const response = await service.fetch(new Request(`http://127.0.0.1${TURN_PATH}`, { method: "POST", headers, body: raw }));
      return { status: response.status, body: await response.json() as { replies?: string[]; error?: string } };
    };
    const roster = async (token = admin) => {
      const response = await service.fetch(new Request(`http://127.0.0.1/apps/ntwrk/gatherings/${id}/roster?revision=1`, {
        headers: { authorization: `Bearer ${token}` },
      }));
      return { status: response.status, body: await response.json() as { items?: { memberId: string; grouping: boolean }[] } };
    };
    const responds = (result: Awaited<ReturnType<typeof post>>) => !!result.body.replies?.length;
    expect((await post(request("gathering-unsigned", first!.e164), false)).status).toBe(401);
    expect(responds(await post(request("gathering-draft", first!.e164)))).toBe(false);
    clock.advance(MINUTE);
    const approvedAt = clock.now();
    await sql`update network.monthly_gatherings set status='approved', revision=1, reviewed_by='reviewing-staff',
      reviewed_at=${new Date(approvedAt)} where app_id='ntwrk' and id=${id}`;
    clock.advance(MINUTE);

    expect(responds(await post(request("gathering-stale-rev", first!.e164, yes.replace(" 1 YES", " 2 YES"))))).toBe(false);
    expect(responds(await post(request("gathering-other-app", first!.e164, yes, "friends")))).toBe(false);
    expect(responds(await post(request("gathering-minor", minor!.e164)))).toBe(false);
    expect(responds(await post(request("gathering-too-early", first!.e164, yes, "ntwrk", approvedAt - 1)))).toBe(false);
    expect(responds(await post(request("gathering-future-clock", first!.e164, yes, "ntwrk", clock.now() + MINUTE)))).toBe(false);
    const beforeListingChanged = request("gathering-grouping-before-listing-change", first!.e164, `${yes} WITH GROUPING`);
    expect(responds(await post(beforeListingChanged))).toBe(true);
    clock.advance(MINUTE);
    await publish({ ...listing, starttime: "2026-11-16T16:00:00", endtime: "2026-11-16T17:00:00" });
    expect(await post(beforeListingChanged)).toMatchObject({ status: 409, body: { error: "turn_gathering_rsvp_changed" } });
    expect(responds(await post(request("gathering-moved-listing", second!.e164)))).toBe(false);
    expect(await sql`select member_id,choice from network.monthly_gathering_rsvps`).toEqual([{ member_id: first!.memberId, choice: "grouping" }]);
    expect((await roster()).status).toBe(404);
    const grouping = await service.fetch(new Request(`http://127.0.0.1/apps/ntwrk/gatherings/${id}/grouping?revision=1`, {
      headers: { authorization: `Bearer ${admin}` },
    }));
    expect(grouping.status).toBe(404);
    const withdrawnWhileMoved = request("gathering-withdraw-while-listing-moved", first!.e164, `WITHDRAW GATHERING ${id} 1`);
    const withdrawnReceipt = await post(withdrawnWhileMoved);
    expect(withdrawnReceipt).toMatchObject({ status: 200, body: { replies: ["Your gathering RSVP is withdrawn."] } });
    expect(await post(withdrawnWhileMoved)).toEqual(withdrawnReceipt);
    clock.advance(MINUTE);
    await publish(listing);

    const confirmed = request("gathering-grouping", first!.e164, `${yes} WITH GROUPING`);
    const firstAnswer = await post(confirmed);
    expect(firstAnswer).toMatchObject({ status: 200, body: { replies: ["Your gathering RSVP includes grouping suggestions."] } });
    expect(await post(confirmed)).toEqual(firstAnswer);
    const competitors = [second!, third!, fourth!];
    const seats = await Promise.all(competitors.map((person, index) => post(request(`gathering-seat-${index}`, person.e164))));
    expect(seats.filter(responds)).toHaveLength(2);
    expect((await roster(reviewer)).status).toBe(403);
    expect(await roster()).toMatchObject({ status: 200, body: { items: expect.arrayContaining([{ memberId: first!.memberId, grouping: true }]) } });
    expect((await roster()).body.items).toHaveLength(3);

    const removed = request("gathering-withdraw", first!.e164, `WITHDRAW GATHERING ${id} 1`, "ntwrk", confirmed.receivedAt);
    expect(await post(removed)).toMatchObject({ status: 200, body: { replies: ["Your gathering RSVP is withdrawn."] } });
    expect((await post(confirmed)).status).toBe(409);
    expect(responds(await post(request("gathering-stale-yes", first!.e164, yes, "ntwrk", confirmed.receivedAt)))).toBe(false);
    clock.advance(MINUTE);
    expect(responds(await post(request("gathering-fresh-yes", first!.e164)))).toBe(true);
    let items = (await roster()).body.items;
    expect(items?.find(item => item.memberId === first!.memberId)).toEqual({ memberId: first!.memberId, grouping: false });
    expect(JSON.stringify(items)).not.toContain(first!.e164);

    await service.close();
    service = createService();
    await service.start();
    expect((await roster()).body.items).toEqual(items);
    await service.accounts.recordAge(first!.e164, await service.accounts.personFor(first!.e164), 16);
    items = (await roster()).body.items;
    expect(items).toHaveLength(2);
    expect(items?.some(item => item.memberId === first!.memberId)).toBe(false);
    await service.accounts.leave(app, { e164: first!.e164, personId: first!.personId });
    expect(await sql`select member_id from network.monthly_gathering_rsvps where member_id=${first!.memberId}`).toEqual([]);
    expect(await sql`select body from network.messages where body like ${`%${id}%`}`).toEqual([]);

    clock.advance(startsAt - clock.now());
    const unseated = competitors[seats.findIndex(result => !responds(result))]!;
    expect(responds(await post(request("gathering-past-cutoff", unseated.e164)))).toBe(false);
    expect((await roster()).body.items).toEqual(items);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);

test.skipIf(!pgAvailable)("a stored gathering RSVP no longer keeps a seat after the member is under 18", async () => {
  // spec/monthlyGatheringRsvp.md, "Each member owns one RSVP and withdrawal wins a tie"
  // spec/monthlyGatheringRsvp.md, "Only the exact approved gathering accepts a fresh RSVP"
  const url = await migratedDb("network_gathering_minor_seat");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "synthetic-gathering-minor-seat-signature";
  const service = new NetworkService({ url, clock, log: () => {}, photoStorage: null,
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    tokens: "admin@ntwrk:ntwrk-admin",
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }],
  });
  const base = "/apps/ntwrk/gatherings";
  const staff = (path: string, body?: object) => service.fetch(new Request(`http://localhost${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: "Bearer ntwrk-admin", "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }));
  try {
    await service.start();
    const app = APPS.ntwrk;
    const people = [];
    for (const [index, firstName] of ["Ada", "Bo", "Cy", "Dee", "Ev"].entries()) {
      const e164 = `+1212555062${index}`;
      const invitation = await service.accounts.invite(app, e164);
      if (!invitation) throw new Error("Fixture invitation refused");
      const joined = await service.accounts.join(app, { e164, personId: invitation.personId }, {
        firstName, age: 30 + index, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused: ${joined.error}`);
      people.push({ e164, ...joined.membership });
    }
    const [ada, bo, cy, dee, ev] = people;
    const startsAt = Date.UTC(2026, 10, 21, 17);
    const created = await staff(base, { month: "2026-11", venue: { kind: "curated", id: "mccarren-park" }, startsAt, endsAt: startsAt + HOUR, capacity: 3 });
    expect(created.status).toBe(201);
    const { gathering } = await created.json() as { gathering: { id: string } };
    expect((await staff(`${base}/${gathering.id}/review`, { decision: "approve", revision: 0 })).status).toBe(200);
    const send = async (person: { e164: string }, id: string) => {
      clock.advance(MINUTE);
      const input: TurnRequest = { app: "ntwrk", from: person.e164, messageId: id, text: `RSVP GATHERING ${gathering.id} 1 YES`,
        channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
      const body = JSON.stringify(input);
      const headers = await svcSign(secret, { method: "POST", path: TURN_PATH, id, body, nowS: Math.floor(clock.now() / 1000) });
      const response = await service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers, body }));
      return response.json() as Promise<{ replies?: string[] }>;
    };
    const accepted = async (person: { e164: string }, id: string) => (await send(person, id)).replies?.length === 1;
    expect(await accepted(ada!, "seat-ada")).toBe(true);
    expect(await accepted(bo!, "seat-bo")).toBe(true);
    expect(await accepted(cy!, "seat-cy")).toBe(true);
    expect(await accepted(dee!, "seat-dee-full")).toBe(false);
    await service.accounts.recordAge(ada!.e164, await service.accounts.personFor(ada!.e164), 16);
    expect(await accepted(dee!, "seat-dee-after-minor")).toBe(true);
    expect(await accepted(ev!, "seat-ev-still-full")).toBe(false);
    expect(await accepted(ada!, "seat-ada-minor")).toBe(false);
    const roster = await (await staff(`${base}/${gathering.id}/roster?revision=1`)).json() as { items: { memberId: string }[] };
    expect(roster.items.map(item => item.memberId).sort()).toEqual([bo!.memberId, cy!.memberId, dee!.memberId].sort());
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
