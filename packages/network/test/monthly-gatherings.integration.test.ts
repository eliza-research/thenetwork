import { expect, test } from "vitest";
import { HOUR, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { PLAN_VENUES } from "../src/plans.ts";
import { START } from "./mini.ts";

test.skipIf(!pgAvailable)("authorized staff approve an exact public gathering draft without contacting anyone", async () => {
  // spec/monthlyGathering.md, "Review decides the exact draft once and does not contact members"
  const url = await migratedDb("monthly_gathering");
  const sql = new SQL(url);
  const clock = new SimClock(START);
  const service = new NetworkService({ url, clock, photoStorage: null, notify: false, log: () => {},
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
    tokens: "admin@ntwrk:ntwrk-admin,admin@friends:friends-admin,reviewer@ntwrk:ntwrk-reviewer", consoleToken: "ntwrk-admin",
  });
  const path = "/apps/ntwrk/gatherings";
  const call = (route: string, data?: object, token: string | null = "ntwrk-admin", staff = "operator@example.test") => service.fetch(new Request(`http://localhost${route}`, {
    method: data ? "POST" : "GET",
    headers: { "content-type": "application/json", "x-network-staff-id": staff, ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(data ? { body: JSON.stringify(data) } : {}),
  }));
  const venue = PLAN_VENUES.find(v => v.hours.weekend[0] <= 12 && v.hours.weekend[1] >= 14)!;
  const startsAt = Date.UTC(2026, 9, 10, 16);
  const valid = { month: "2026-10", venue: { kind: "curated", id: venue.id }, startsAt, endsAt: startsAt + 2 * HOUR, capacity: 24 };
  try {
    await service.start();
    expect((await call(path, valid, null)).status).toBe(401);
    expect((await call(path, valid, "ntwrk-reviewer")).status).toBe(403);
    expect((await call(path, valid, "friends-admin")).status).toBe(403);
    expect((await call("/apps/friends/gatherings", valid, "friends-admin")).status).toBe(403);
    expect((await call(path, { ...valid, capacity: 151 })).status).toBe(400);
    expect((await call(path, { ...valid, month: "2026-11" })).status).toBe(400);
    expect((await call(path, { ...valid, venue: { kind: "curated", id: "unknown" } })).status).toBe(400);
    expect((await call(path, { ...valid, participants: ["someone"] })).status).toBe(400);

    const creates = await Promise.all([call(path, valid), call(path, valid)]);
    expect(creates.map(res => res.status).sort()).toEqual([201, 409]);
    const { gathering: draft } = await creates.find(res => res.status === 201)!.json();
    expect(draft).toMatchObject({ ...valid, app: "ntwrk", city: "nyc", revision: 0, status: "draft", createdBy: "operator@example.test", reviewedBy: null });
    const review = `${path}/${draft.id}/review`;
    expect((await call(review, { revision: 1, decision: "approve" })).status).toBe(409);
    const reviewed = await Promise.all([
      call(review, { revision: 0, decision: "approve" }, "ntwrk-admin", "reviewer@example.test"),
      call(review, { revision: 0, decision: "approve" }, "ntwrk-admin", "reviewer@example.test"),
    ]);
    expect(reviewed.map(res => res.status).sort()).toEqual([200, 409]);
    expect(await reviewed.find(res => res.status === 200)!.json()).toMatchObject({ gathering: {
      id: draft.id, revision: 1, status: "approved", reviewedBy: "reviewer@example.test", reviewedAt: START,
    } });
    expect((await call(path, valid)).status).toBe(409);

    clock.set(Date.UTC(2026, 9, 30, 16));
    const listingStart = Date.UTC(2026, 10, 7, 17);
    const listing = { month: "2026-11", venue: { kind: "listing", id: "nyc-parks:101" }, startsAt: listingStart, endsAt: listingStart + 2 * HOUR, capacity: 24 };
    await sql`insert into network.public_event_imports (source, checked_at) values ('nyc-parks', ${new Date(clock.now())})`;
    await sql`insert into network.public_events (source, source_id, city, source_url, title, venue, area, latitude, longitude, starts_at, ends_at, category, tags)
      values ('nyc-parks', '101', 'nyc', 'https://www.nycgovparks.org/events/2026/11/07/fixture', 'Public meetup', ${venue.name}, ${venue.area},
        40.75, -73.95, ${new Date(listing.startsAt)}, ${new Date(listing.endsAt)}, 'events', '{}')`;
    expect((await call(path, { ...listing, endsAt: listing.endsAt + HOUR })).status).toBe(400);
    const listingDraft = await call(path, listing);
    expect(listingDraft.status).toBe(201);
    const { gathering: published } = await listingDraft.json();
    const listingReview = `${path}/${published.id}/review`;
    await sql`delete from network.public_events where source = 'nyc-parks' and source_id = '101'`;
    expect((await call(listingReview, { revision: 0, decision: "approve" })).status).toBe(409);
    expect(await (await call(listingReview, { revision: 0, decision: "reject" })).json()).toMatchObject({ gathering: {
      id: published.id, revision: 1, status: "rejected", reviewedBy: "operator@example.test",
    } });
    expect((await call(path, { ...listing, venue: valid.venue })).status).toBe(201);
    expect(await (await call(path)).json()).toMatchObject({ ok: true, gatherings: expect.arrayContaining([
      expect.objectContaining({ id: draft.id, status: "approved" }), expect.objectContaining({ id: published.id, status: "rejected" }),
    ]) });

    await sql.begin(async tx => {
      await tx`set local role network_service`;
      await tx`select set_config('app.app_id', 'friends', true)`;
      expect(await tx`select id from network.monthly_gatherings`).toEqual([]);
    });
    expect(await sql`select actor, action, ok from network.staff_audit where target_id in (${draft.id}, ${published.id}) and app_id = 'ntwrk'`)
      .toEqual(expect.arrayContaining([
        { actor: "operator@example.test", action: "create_monthly_gathering", ok: true },
        { actor: "reviewer@example.test", action: "approve_monthly_gathering", ok: true },
        { actor: "operator@example.test", action: "approve_monthly_gathering", ok: false },
        { actor: "operator@example.test", action: "reject_monthly_gathering", ok: true },
      ]));
    expect(await sql`select id from platform.outbound`).toEqual([]);
    expect(await sql`select id from network.members`).toEqual([]);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 30_000);
