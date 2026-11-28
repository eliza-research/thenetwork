import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import { calendarPreloadPath, calendarSource } from "../../core/src/generated/calendarFreeBusy.ts";
import type { CalendarPreloadRequest } from "../../core/src/svc/calendar-scheduling.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { PLAN_VENUES, planVenuesForCity } from "../src/plans.ts";
import { describeBookingStart, localBookingStart, parseNaturalReschedule, rescheduleNoticeCurrent, rescheduleOfferKey, rescheduleUpdateKey } from "../src/rescheduling.ts";
import { Mini, START } from "./mini.ts";

const ids = ["a", "b", "c"];
const originalAt = Date.UTC(2026, 9, 10, 17);
const proposedAt = Date.UTC(2026, 9, 11, 18);
const request = `RESCHEDULE ${localBookingStart(originalAt)} TO ${localBookingStart(proposedAt)}`;

async function bookedFixture() {
  const w = new Mini(ids.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false });
  await w.onboard(...ids);
  const id = w.propose(ids);
  await w.answerProbes(ids);
  expect(w.meetings).toHaveLength(1);
  const state = w.net.exportState();
  const o = state.opps.find(item => item.id === id)!;
  expect(o.stage).toBe("scheduled");
  const venue = PLAN_VENUES.find(place => place.id === "mccarren-park")!;
  Object.assign(o, { meetingAt: originalAt, venue: venue.name, venueArea: venue.area });
  w.net.importState(state);
  const booking = () => w.net.exportState().opps.find(item => item.id === id)!;
  const vote = (member: string) => {
    const line = w.to(member).find(message => message.body.includes("Reply RESCHEDULE YES"))?.body;
    expect(line, JSON.stringify({ member, messages: w.to(member), guard: w.log("guard_blocked"), refusals: w.log("send_refused") })).toBeDefined();
    expect(line!).toContain(describeBookingStart(proposedAt));
    return /RESCHEDULE YES [a-p]{16}/.exec(line!)![0];
  };
  return { w, id, booking, vote };
}

test("only each participant's own answer to the exact offer commits a changed time across restart", async () => {
  const { w, id, booking, vote } = await bookedFixture();
  await w.say("a", request);
  await w.run(HOUR);
  const yes = Object.fromEntries(ids.map(member => [member, vote(member)]));
  expect(new Set(Object.values(yes)).size).toBe(3);
  expect(booking()).toMatchObject({ meetingAt: originalAt, reschedule: { accepted: [], roster: ids } });
  const draft = booking().reschedule!;
  const oldOfferKey = rescheduleOfferKey(draft, "c");
  expect(rescheduleNoticeCurrent({ ...booking(), current: true }, ids, "c", oldOfferKey, w.clock.now())).toBe(true);
  expect(w.net.rescheduleReplyCurrent("c", oldOfferKey)).toBe(true);
  expect(w.net.rescheduleReplyCurrent("b", oldOfferKey)).toBe(false);

  await w.say("b", yes.a!);
  await w.net.onInbound({ id: "profile-reschedule", memberId: "a", body: yes.a!, ts: w.clock.now(), channel: "sms", source: "mcp" });
  expect(booking().reschedule?.accepted).toEqual([]);
  await w.say("a", yes.a!);
  await w.say("a", yes.a!);
  await w.say("b", yes.b!);
  expect(booking()).toMatchObject({ meetingAt: originalAt, reschedule: { accepted: ["a", "b"] } });

  w.restart();
  await w.say("c", yes.c!);
  const committed = booking();
  expect(committed).toMatchObject({ meetingAt: proposedAt, scheduleRevision: 1, confirmed: ids });
  expect(committed.reschedule).toBeUndefined();
  expect(rescheduleNoticeCurrent({ ...committed, current: true }, ids, "c", oldOfferKey, w.clock.now())).toBe(false);
  expect(w.net.rescheduleReplyCurrent("c", oldOfferKey)).toBe(false);
  expect(rescheduleNoticeCurrent({ ...committed, current: true }, ids, "c", rescheduleUpdateKey(id, 1, "c"), w.clock.now())).toBe(true);
  expect(rescheduleNoticeCurrent({ ...committed, current: true }, ids, "c", rescheduleUpdateKey(id, 0, "c"), w.clock.now())).toBe(false);
  expect(w.meetings.at(-1)).toMatchObject({ proposalId: id, at: proposedAt, previousAt: originalAt });
  await w.say("c", yes.c!);
  expect(w.log("meeting_rescheduled")).toHaveLength(1);
});

test("decline and expiry keep the original booking and invalidate queued offers", async () => {
  const { w, booking, vote } = await bookedFixture();
  await w.say("a", request);
  await w.run(HOUR);
  const originalVote = vote("b");
  await w.say("b", originalVote);
  expect(booking().reschedule?.accepted).toEqual(["b"]);
  await w.say("b", originalVote.replace(" YES ", " NO "));
  expect(booking().reschedule).toBeUndefined();
  await w.say("b", originalVote);
  expect(booking().meetingAt).toBe(originalAt);
  await w.say("a", request);
  const draft = booking().reschedule!;
  const expired = { ...booking(), current: true };
  expect(rescheduleNoticeCurrent(expired, ids, "a", rescheduleOfferKey(draft, "a"), draft.expiresAt)).toBe(false);
  w.clock.set(draft.expiresAt);
  await w.net.tick(w.clock.now());
  expect(booking()).toMatchObject({ meetingAt: originalAt, stage: "scheduled" });
  expect(booking().reschedule).toBeUndefined();
  expect(w.log("meeting_rescheduled")).toEqual([]);
});

test("committed reschedule moves the arrival pre-brief, arrival relay, and no-show window to the new time", async () => {
  const pair = ["a", "b"];
  const w = new Mini(pair.map(id => ({
    id, name: `${id.toUpperCase()}nton Q`, age: 30, area: "Greenpoint", quietHours: [22, 8], interests: ["climbing", "hiking"],
    skills: ["belaying"], wants: [{ objective: "find climbing partners", category: "hobby" as const }],
  })), { plans: false, arrivalBriefs: true });
  await w.onboard(...pair);
  const id = w.propose(pair);
  await w.answerProbes(pair);
  const initialAt = w.net.exportState().opps.find(item => item.id === id)!.meetingAt!;
  const nextAt = initialAt + 24 * HOUR;
  await w.say("a", `RESCHEDULE ${localBookingStart(initialAt)} TO ${localBookingStart(nextAt)}`);
  await w.run(HOUR);
  const code = (member: string) => /RESCHEDULE YES [a-p]{16}/.exec(
    w.to(member).find(message => message.body.includes("Reply RESCHEDULE YES"))!.body,
  )![0];
  const yesA = code("a"), yesB = code("b");
  await w.say("a", yesA);
  w.restart();
  await w.say("b", yesB);
  expect(w.net.exportState().opps.find(item => item.id === id)?.meetingAt).toBe(nextAt);

  const beforeOldWindow = w.sent.length;
  w.clock.set(initialAt - 70 * MINUTE);
  await w.net.tick(w.clock.now());
  const oldBriefs = w.sent.slice(beforeOldWindow).filter(s => s.meta.proposalId === id && /Heads up for/i.test(s.body));

  w.clock.set(initialAt - 10 * MINUTE);
  const bBeforeOldArrival = w.to("b").length;
  await w.say("a", "Just got here!");
  const oldArrivalRelays = w.to("b").slice(bBeforeOldArrival).map(m => m.body);

  w.clock.set(initialAt + 50 * MINUTE);
  await w.net.tick(w.clock.now());
  const oldNoShows = w.log("provisional_no_show").map(l => l.detail.memberId);
  const bStrikesAfterOldSlot = w.net.exportState().members.find(m => m.id === "b")?.strikes ?? 0;

  const beforeNewBrief = w.sent.length;
  w.clock.set(nextAt - 70 * MINUTE);
  await w.net.tick(w.clock.now());
  const newBriefs = w.sent.slice(beforeNewBrief).filter(s => s.meta.proposalId === id && /Heads up for/i.test(s.body));

  await w.say("b", "Sounds good!");
  w.clock.set(nextAt - 10 * MINUTE);
  const bBeforeNewArrival = w.to("b").length;
  await w.say("a", "Just got here!");
  const newArrivalRelayed = w.to("b").slice(bBeforeNewArrival).some(m => /Anton just arrived/i.test(m.body));

  expect({
    oldBriefRecipients: oldBriefs.map(s => s.to).sort(),
    oldArrivalRelays,
    oldNoShows,
    bStrikesAfterOldSlot,
    newBriefRecipients: newBriefs.map(s => s.to).sort(),
    newArrivalRelayed,
  }).toEqual({
    oldBriefRecipients: [],
    oldArrivalRelays: [],
    oldNoShows: [],
    bStrikesAfterOldSlot: 0,
    newBriefRecipients: ["a", "b"],
    newArrivalRelayed: true,
  });
});

test("a member outside New York reschedules with the starts their booking message shows", async () => {
  const w = new Mini([], { city: "sf", engine: { cities: ["sf"] }, plans: false });
  for (const [id, name, area] of [["s1", "Ana Diaz", "Mission"], ["s2", "Ben Ito", "Hayes Valley"]] as const) {
    w.members.push({
      id, name, homeCity: "sf", state: "normal", joinedAt: w.clock.now(), age: 30, unansweredProactive: 0,
      prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false },
    });
    w.presence.push({ memberId: id, city: "sf", type: "home", areas: [area] });
    for (const tag of ["climbing", "hiking"]) w.facets.push({ id: `${id}:interest:${tag}`, memberId: id, kind: "interest", value: tag, tags: [tag], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: w.clock.now(), source: "chat", observedAt: w.clock.now(), inferred: false, confirmedByMember: true });
    w.intents.push({ id: `${id}:want:0`, memberId: id, objective: "find climbing partners", category: "hobby", horizonDays: 60, status: "active", createdAt: w.clock.now() });
  }
  await w.onboard("s1", "s2");
  const id = w.propose(["s1", "s2"]);
  await w.answerProbes(["s1", "s2"]);
  expect(w.meetings).toHaveLength(1);
  const state = w.net.exportState();
  const o = state.opps.find(item => item.id === id)!;
  expect(o.stage).toBe("scheduled");
  const venue = planVenuesForCity("sf")[0]!;
  Object.assign(o, { meetingAt: originalAt, venue: venue.name, venueArea: venue.area });
  w.net.importState(state);
  const booking = () => w.net.exportState().opps.find(item => item.id === id)!;

  await w.say("s1", request);
  expect(booking().reschedule).toBeUndefined();
  const cityRequest = `RESCHEDULE ${localBookingStart(originalAt, "America/Los_Angeles")} TO ${localBookingStart(proposedAt, "America/Los_Angeles")}`;
  await w.say("s1", cityRequest);
  expect(booking().reschedule, JSON.stringify({ replies: w.to("s1").map(s => s.body), refusals: w.log("send_refused") })).toMatchObject({ originalAt, proposedAt });
  const offer = w.to("s2").find(message => message.body.includes("Reply RESCHEDULE YES"))?.body;
  expect(offer).toContain(describeBookingStart(proposedAt, "America/Los_Angeles"));
  expect(offer).not.toContain("New York");
});

test.skipIf(!pgAvailable)("a service turn in a San Francisco runtime parses reschedule starts in Pacific time for calendar preloads", async () => {
  const url = await migratedDb("network_reschedule_sf_service");
  const clock = new SimClock(START);
  const app = APPS.friends;
  const turnSecret = "synthetic-sf-reschedule-turn-secret";
  const calendarSecret = "synthetic-sf-reschedule-calendar-secret";
  const safetyToken = "synthetic-sf-reschedule-safety-token";
  const connectionId = "22222222-2222-4222-8222-222222222222";
  const phones = ["+14155550181", "+14155550182"] as const;
  const reads: CalendarPreloadRequest[] = [];
  const service = new NetworkService({
    url, clock, photoStorage: null, log: () => {}, notify: false,
    tokens: `safety@friends:${safetyToken}`,
    env: {
      PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: turnSecret,
      NETWORK_CALENDAR_FREE_BUSY_SECRET: calendarSecret,
      NETWORK_CLOUD_DELIVERY_ORIGIN: "https://calendar.invalid",
    },
    networks: [{ id: "friends:sf", matchingEnabled: false }],
    calendarFreeBusyFetch: async (destination, init) => {
      const req = new Request(destination, init);
      expect(req.url).toBe(`https://calendar.invalid${calendarPreloadPath}`);
      const raw = await req.text();
      const parsed = JSON.parse(raw) as CalendarPreloadRequest;
      reads.push(parsed);
      const now = clock.now();
      const source = { app: parsed.app, memberId: parsed.memberId, purpose: parsed.purpose, provider: calendarSource, connectionId };
      const body = JSON.stringify({
        app: parsed.app, personId: parsed.personId, memberId: parsed.memberId, purpose: parsed.purpose,
        requestSha256: createHash("sha256").update(raw).digest("hex"), issuedAt: now, expiresAt: now + 29_000,
        grant: { ...source, active: true, grantedAt: START, expiresAt: now + 5 * MINUTE },
        observation: { ...source, observedAt: now, coverage: parsed.coverage, busy: [] },
      });
      const headers = await svcSign(calendarSecret, { method: "POST", path: calendarPreloadPath, id: `calendar-read:${parsed.nonce}:proof`, body, nowS: Math.floor(now / 1000) });
      return new Response(body, { headers });
    },
  });
  const turn = async (id: string, text: string, from: string) => {
    const input: TurnRequest = { app: app.id, from, messageId: id, text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const auth = await svcSign(turnSecret, { method: "POST", path: TURN_PATH, id, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body }));
  };

  try {
    await service.start();
    const members: { id: string; name: string; area: string }[] = [];
    for (const [i, e164] of phones.entries()) {
      const name = i === 0 ? "Ana Diaz" : "Ben Ito";
      const area = i === 0 ? "Mission" : "Hayes Valley";
      const joined = await service.accounts.join(app, { e164, personId: null }, {
        firstName: name.split(" ")[0]!, age: 30, homeCity: "sf", consent: { sms: true, wording: app.consent.text },
      });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      const id = joined.membership.memberId;
      for (const check of ["age", "liveness"]) {
        const verified = await service.fetch(new Request(`http://localhost/apps/friends/members/${encodeURIComponent(id)}/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${safetyToken}`, "content-type": "application/json" },
          body: JSON.stringify({ check, result: "pass", note: "Adult SF reschedule fixture" }),
        }));
        expect(await verified.json()).toEqual({ ok: true });
      }
      members.push({ id, name, area });
    }
    const [first, second] = members as [typeof members[number], typeof members[number]];
    const world = new Mini([], { app: app.id, city: "sf", engine: { cities: ["sf"] }, growth: false, plans: false });
    for (const m of members) {
      world.members.push({
        id: m.id, name: m.name, homeCity: "sf", state: "normal", joinedAt: world.clock.now(), age: 30, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      world.presence.push({ memberId: m.id, city: "sf", type: "home", areas: [m.area] });
      for (const tag of ["climbing", "hiking"]) world.facets.push({ id: `${m.id}:interest:${tag}`, memberId: m.id, kind: "interest", value: tag, tags: [tag], scope: "matchable", provenance: "said", confidence: 0.9, validFrom: world.clock.now(), source: "chat", observedAt: world.clock.now(), inferred: false, confirmedByMember: true });
      world.intents.push({ id: `${m.id}:want:0`, memberId: m.id, objective: "find climbing partners", category: "hobby", horizonDays: 60, status: "active", createdAt: world.clock.now() });
    }
    world.verify(first.id, second.id);
    await world.onboard(first.id, second.id);
    const oppId = world.propose([first.id, second.id]);
    await world.answerProbes([first.id, second.id]);
    const fixture = world.net.exportState();
    const booked = fixture.opps.find(item => item.id === oppId)!;
    const venue = planVenuesForCity("sf")[0]!;
    Object.assign(booked, { meetingAt: originalAt, venue: venue.name, venueArea: venue.area });
    const unrelated = { ...booked, id: "unrelated-sf-booking", meetingAt: originalAt + 2 * DAY };
    clock.set(world.clock.now());
    const rt = service.runtimes.get("friends:sf")!;
    await rt.unitOfWork(n => n.importState({ ...n.exportState(), members: fixture.members, opps: [booked, unrelated] }));

    expect((await turn("sf-calendar-enable", "CALENDAR", phones[0])).status).toBe(200);
    reads.length = 0;
    expect((await turn("sf-reschedule-ny-tz", request, phones[1])).status).toBe(200);
    expect(reads).toEqual([]);

    const sfRequest = `RESCHEDULE ${localBookingStart(originalAt, "America/Los_Angeles")} TO ${localBookingStart(proposedAt, "America/Los_Angeles")}`;
    expect((await turn("sf-reschedule-pacific-tz", sfRequest, phones[1])).status).toBe(200);
    expect(reads.map(r => r.memberId)).toEqual([first.id]);
    expect((await rt.pg.load())?.opps.find(item => item.id === oppId)?.reschedule).toMatchObject({ originalAt, proposedAt });
  } finally {
    await service.close();
    await dropDb(url);
  }
}, 120_000);

test("a weekday-named reschedule lands on the named day, not one day later", () => {
  // Monday 2026-10-05 12:00 New York; the booked meeting is Wednesday 2026-10-07 18:00 New York.
  const nowMs = Date.UTC(2026, 9, 5, 16);
  const originalAt = Date.UTC(2026, 9, 7, 22);
  expect(parseNaturalReschedule("move it to Friday", { nowMs, tz: "America/New_York", originalAt }))
    .toEqual({ kind: "request", originalAt, proposedAt: Date.UTC(2026, 9, 9, 22) }); // Friday 2026-10-09 18:00 New York
});
test("naming today's weekday reschedules to next week, not tomorrow", () => {
  const nowMs = Date.UTC(2026, 9, 5, 16); // Monday 2026-10-05 12:00 New York
  const originalAt = Date.UTC(2026, 9, 7, 22); // Wednesday 2026-10-07 18:00 New York
  expect(parseNaturalReschedule("move it to Monday", { nowMs, tz: "America/New_York", originalAt }))
    .toEqual({ kind: "request", originalAt, proposedAt: Date.UTC(2026, 9, 12, 22) }); // Monday 2026-10-12 18:00 New York
});
