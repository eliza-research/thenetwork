import { expect, test } from "vitest";
import { HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { Mini } from "./mini.ts";

test.skipIf(!pgAvailable)("a signed calendar request downloads the current booking with no participant details", async () => {
  // spec/calendarInvite.md, "The member asks for one current booking"
  // spec/calendarInvite.md, "A calendar link follows the booked revision and the current owner"
  const url = await migratedDb("calendar_invite");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const secret = "a-synthetic-calendar-invite-fixture-secret";
  const phones = ["+12125550288", "+12125550289"];
  const app = APPS.friends;
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => new DryRunAdapter(() => {}),
    env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "friends:nyc", matchingEnabled: false }, { id: "peon:nyc", matchingEnabled: false }],
  });
  const turn = (id: string, text = "calendar invite", from = phones[0]!): TurnRequest => ({ app: "friends", from, messageId: id,
    text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null });
  const send = async (input: TurnRequest) => {
    const body = JSON.stringify(input);
    const auth = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const download = (href: string | URL) => service.publicFetch(new Request(href));
  const iCalTime = (at: number) => new Date(at).toISOString().replace(/[-:]|\.\d{3}/g, "");

  try {
    await service.start();
    const unknown = await send(turn("calendar-unknown", "calendar invite", "+12125550287"));
    expect(await unknown.json()).toMatchObject({ outcome: "handled", reason: "calendar_invite", replies: [] });
    const members = [];
    for (const [i, e164] of phones.entries()) {
      const name = i ? "Blair" : "Ari";
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      members.push({ id: joined.membership.memberId, name, age: 30, area: "Greenpoint", interests: ["hiking", "climbing"], skills: ["belaying"] });
    }
    const rt = service.runtimes.get("friends:nyc")!;
    const world = new Mini(members, { app: "friends", review: "auto", plans: false, growth: false });
    world.clock.set(clock.now());
    const ids = members.map(member => member.id);
    await world.onboard(...ids);
    const id = world.propose(ids);
    await world.answerProbes(ids);
    const booked = world.net.exportState().opps.find(opp => opp.id === id && opp.stage === "scheduled")!;
    expect(booked.bookedTold).toEqual(expect.arrayContaining(ids));
    clock.set(world.clock.now());
    const save = (opportunity: typeof booked) => rt.unitOfWork(n => {
      n.importState({ ...n.exportState(), opps: [opportunity] });
    });
    await save(booked);

    const requested = turn("calendar-issue");
    const original = await send(requested);
    expect(original.status).toBe(200);
    const result = await original.json();
    expect(result).toMatchObject({ outcome: "handled", reason: "calendar_invite", replies: [expect.stringContaining("https://friends.help/api/calendar/invite?code=")] });
    const link = result.replies[0].split("\n")[1];
    const replay = await send(requested);
    expect(await replay.json()).toEqual(result);
    expect(await sql`select token_hash from platform.calendar_invites`).toHaveLength(1);
    expect(await sql`select body from network.messages where type='calendar_invite' and direction='outbound'`).toEqual([{ body: "Private calendar invite reply." }]);

    const file = await download(link);
    expect(file.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    const contents = (await file.text()).replace(/\r\n /g, "");
    expect(contents).toContain(`DTSTART:${iCalTime(booked.meetingAt!)}`);
    expect(contents).toContain(`LOCATION:${booked.venue}`);
    expect(contents).not.toMatch(/Blair|Ari|ATTENDEE|\+1212/);
    expect((await download(link.replace("friends.help", "peon.biz"))).status).toBe(404);
    expect((await download(link + "x")).status).toBe(404);

    // A changed start invalidates the old file and its signed reply. A newly requested file uses the new start.
    await save({ ...booked, meetingAt: booked.meetingAt! + HOUR });
    expect((await download(link)).status).toBe(404);
    expect((await send(requested)).status).toBe(409);
    const timed = await (await send(turn("calendar-expires"))).json();
    const timedLink = timed.replies[0].split("\n")[1];
    clock.advance(15 * MINUTE);
    expect((await download(timedLink)).status).toBe(404);

    const stopped = turn("calendar-stop-target");
    const latest = await (await send(stopped)).json();
    const latestLink = latest.replies[0].split("\n")[1];
    await send(turn("calendar-stop", "STOP"));
    expect((await download(latestLink)).status).toBe(404);
    expect((await send(stopped)).status).toBe(409);
  } finally {
    await service.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
