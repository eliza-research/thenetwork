import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "vitest";
import { DAY, HOUR, MINUTE, SimClock } from "@thenetwork/core";
import type { plans } from "@thenetwork/engine";
import { calendarOwnerPath, calendarPreloadPath, calendarSchedulingPurpose, calendarSource } from "../../core/src/generated/calendarFreeBusy.ts";
import type { CalendarOwnerRequest, CalendarPreloadRequest } from "../../core/src/svc/calendar-scheduling.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign, svcVerify } from "../../core/src/svc/svc-auth.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { NetworkService } from "../service/service.ts";
import { localBookingStart, rescheduleMemberRef, type RescheduleCommand, type RescheduleDraft } from "../src/rescheduling.ts";
import { Mini, START } from "./mini.ts";
import { REVIEW_JUDGE_PROMPT_VERSION, SIM_REVIEW_JUDGE, type ReviewJudge } from "../../engine/src/reviewJudge.ts";

const turnSecret = "synthetic-calendar-bridge-fixture-turn-secret";
const calendarSecret = "synthetic-calendar-bridge-fixture-scope-secret";
const safetyToken = "synthetic-calendar-bridge-fixture-safety";
const connectionId = "22222222-2222-4222-8222-222222222222";
const organizationId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";
const hash = (input: string) => createHash("sha256").update(input).digest("hex");

test.skipIf(!pgAvailable)("a signed owner proof and fresh Cloud preload bind actual reviewed scheduling to the exact member", async () => {
  // spec/calendarFreeBusy.md, "Exchange fresh proofs for one member of one app"
  const url = await migratedDb("calendar_bridge");
  const clock = new SimClock(START);
  const app = APPS.friends;
  const phones = ["+12125550181", "+12125550182", "+12125550183", "+12125550184"] as const;
  const reads: CalendarPreloadRequest[] = [];
  let busy: { start: number; end: number } | undefined;
  let cloudRevoked = false;
  const service = new NetworkService({
    url, clock, photoStorage: null, log: () => {}, notify: false,
    tokens: `safety@friends:${safetyToken}`,
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: turnSecret, NETWORK_CALENDAR_FREE_BUSY_SECRET: calendarSecret,
      NETWORK_CLOUD_DELIVERY_ORIGIN: "https://calendar.invalid" },
    networks: [{ id: "friends:nyc", matchingEnabled: false }],
    calendarFreeBusyFetch: async (destination, init) => {
      const req = new Request(destination, init);
      expect(req.url).toBe(`https://calendar.invalid${calendarPreloadPath}`);
      expect(req.redirect).toBe("error");
      const raw = await req.text();
      const request = JSON.parse(raw) as CalendarPreloadRequest;
      expect(Object.keys(request).sort()).toEqual(["app", "coverage", "memberId", "nonce", "personId", "purpose"]);
      const now = clock.now();
      const id = `calendar-read:${request.nonce}`;
      expect(await svcVerify(calendarSecret, { method: "POST", path: calendarPreloadPath, headers: req.headers, body: raw, nowS: Math.floor(now / 1000) })).toMatchObject({ ok: true, id });
      reads.push(request);
      if (cloudRevoked || !busy) return new Response(null, { status: 403 });
      const { app, personId, memberId, purpose, coverage } = request;
      const source = { app, memberId, purpose, provider: calendarSource, connectionId };
      const body = JSON.stringify({
        app, personId, memberId, purpose, requestSha256: hash(raw), issuedAt: now, expiresAt: now + 29_000,
        grant: { ...source, active: true, grantedAt: START, expiresAt: now + 5 * MINUTE },
        observation: { ...source, observedAt: now, coverage, busy: [busy] },
      });
      const headers = await svcSign(calendarSecret, { method: "POST", path: calendarPreloadPath, id: `${id}:proof`, body, nowS: Math.floor(now / 1000) });
      return new Response(body, { headers });
    },
  });
  const post = async (path: string, id: string, body: string, key: string) => {
    const auth = await svcSign(key, { method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body }));
  };
  const turn = (id: string, text: string, from: string, at = clock.now()) => {
    const input: TurnRequest = { app: app.id, from, messageId: id, text, channel: "blooio", transport: "imessage", receivedAt: at, to: null };
    return post(TURN_PATH, id, JSON.stringify(input), turnSecret);
  };

  try {
    await service.start();
    const profiles = [];
    for (const [i, e164] of phones.entries()) {
      const name = ["Ari", "Blair", "Casey", "Devon"][i]!;
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      const id = joined.membership.memberId;
      for (const check of ["age", "liveness"]) {
        const verified = await service.fetch(new Request(`http://localhost/apps/friends/members/${encodeURIComponent(id)}/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${safetyToken}`, "content-type": "application/json" },
          body: JSON.stringify({ check, result: "pass", note: "Adult calendar scheduling fixture" }),
        }));
        expect(await verified.json()).toEqual({ ok: true });
      }
      profiles.push({ id, personId: joined.membership.personId, name, age: 30, area: "Greenpoint",
        interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
    }
    const [first, second, declined, pending] = profiles as [typeof profiles[number], typeof profiles[number], typeof profiles[number], typeof profiles[number]];
    const ids = [first.id, second.id];
    const rt = service.runtimes.get("friends:nyc")!;
    const world = new Mini(profiles, { app: app.id, growth: false, plans: false });
    world.verify(...ids);
    await world.onboard(...profiles.map(profile => profile.id));
    const oppId = world.propose(ids);
    expect(await world.runUntil(() => world.probed(first.id), 2 * DAY)).toBe(true);
    await world.say(first.id, "Yes, the first time works");
    expect(await world.runUntil(() => world.probed(second.id), DAY)).toBe(true);
    const picked = world.to(second.id).find(sent => sent.meta.probe?.key === oppId)?.meta.timeOptions?.[0];
    expect(picked).toBeDefined();
    busy = { start: picked!.start, end: picked!.end };
    clock.set(world.clock.now());
    const fixture = world.net.exportState();
    await rt.unitOfWork(n => n.importState({ ...n.exportState(), members: fixture.members, opps: fixture.opps }));

    const ownerInput: CalendarOwnerRequest = { app: app.id, e164: phones[0], organizationId, userId, connectionId, purpose: calendarSchedulingPurpose, nonce: randomUUID() };
    const ownerId = `calendar-owner:${ownerInput.nonce}`, ownerBody = JSON.stringify(ownerInput);
    expect((await post(calendarOwnerPath, ownerId, ownerBody, turnSecret)).status).toBe(401);
    expect((await post(calendarOwnerPath, ownerId, ownerBody, calendarSecret)).status).toBe(403);
    expect((await turn("calendar-enable", "CALENDAR", phones[0])).status).toBe(200);
    expect(reads).toEqual([]);
    const proof = await post(calendarOwnerPath, ownerId, ownerBody, calendarSecret);
    expect(proof.status).toBe(200);
    const payload = await proof.text();
    expect(JSON.parse(payload)).toEqual({ app: app.id, personId: first.personId, memberId: first.id, purpose: calendarSchedulingPurpose,
      requestSha256: hash(ownerBody), issuedAt: clock.now(), expiresAt: clock.now() + 30_000 });
    expect(await svcVerify(calendarSecret, { method: "POST", path: calendarOwnerPath, headers: proof.headers, body: payload, nowS: Math.floor(clock.now() / 1000) }))
      .toMatchObject({ ok: true, id: `${ownerId}:proof` });
    expect(payload).not.toContain(phones[0]);
    expect(payload).not.toContain(connectionId);
    expect((await post(calendarOwnerPath, ownerId, JSON.stringify({ ...ownerInput, app: "peon" }), calendarSecret)).status).toBe(403);

    const optedIn = (await rt.pg.load())!;
    expect((await turn("calendar-accept-busy", "Yes, the first time works", phones[1])).status).toBe(200);
    expect(reads.map(({ app, personId, memberId }) => ({ app, personId, memberId }))).toEqual([{ app: app.id, personId: first.personId, memberId: first.id }]);
    const closed = (await rt.pg.load())!;
    expect(closed.opps.find(opp => opp.id === oppId)?.stage).toBe("closed");
    expect(JSON.stringify(closed)).not.toContain(connectionId);

    cloudRevoked = true;
    await rt.unitOfWork(n => n.importState(optedIn));
    expect((await turn("calendar-accept-after-revoke", "Yes, the first time works", phones[1])).status).toBe(200);
    expect(reads).toHaveLength(2);
    expect((await rt.pg.load())?.opps.find(opp => opp.id === oppId)?.stage).toBe("scheduled");

    const earlier = clock.now();
    clock.advance(MINUTE);
    expect((await turn("calendar-disable", "CALENDAR OFF", phones[0])).status).toBe(200);
    expect((await turn("calendar-delayed-enable", "CALENDAR", phones[0], earlier)).status).toBe(200);
    expect(reads).toHaveLength(2);
    expect((await post(calendarOwnerPath, ownerId, ownerBody, calendarSecret)).status).toBe(403);

    // spec/calendarFreeBusy.md, "A scheduling read uses only the seats still involved in that work"
    clock.advance(MINUTE);
    for (const i of [0, 2, 3] as const) expect((await turn(`calendar-seat-optin-${i}`, "CALENDAR", phones[i])).status).toBe(200);
    const persisted = (await rt.pg.load())!;
    const probing = optedIn.opps.find(opp => opp.id === oppId)!;
    await rt.unitOfWork(n => n.importState({ ...persisted, opps: [{ ...probing, participants: [...ids, declined.id], status: [...probing.status, [declined.id, "no"]] }] }));
    const stageWork = async (memberId: string, reschedule?: RescheduleCommand) => {
      reads.length = 0;
      await rt.unitOfWork(() => undefined, { kind: "member", memberId, reschedule });
      return reads.map(request => request.memberId).sort();
    };
    expect(await stageWork(second.id)).toEqual([first.id]);
    expect(await stageWork(declined.id)).toEqual([]);

    const booked = persisted.opps.find(opp => opp.id === oppId)!;
    const participants = [...ids, declined.id, pending.id];
    const start = booked.meetingAt!;
    const plan: plans.Plan = { id: oppId, city: "nyc", activityId: "coffee_crawl", place: { name: "Public meeting place" },
      window: { start, end: start + HOUR }, invited: participants, alternates: [], partner: false, size: { min: 3, target: 4, max: 4 },
      quorum: 3, probeDeadline: start, score: 0, u: {}, familiar: {}, createdAt: booked.createdAt, category: "social" };
    await rt.unitOfWork(n => n.importState({ ...persisted, opps: [{ ...booked, participants, plan,
      status: [[first.id, "yes"], [second.id, "yes"], [declined.id, "no"], [pending.id, "probing"]],
      planRun: { plan, stage: "booked", bench: [], answers: { [first.id]: "yes", [second.id]: "yes", [declined.id]: "no", [pending.id]: "pending" } },
    }] }));
    expect(await stageWork(second.id, { kind: "request", originalAt: start, proposedAt: start + 2 * DAY })).toEqual([first.id]);
    expect(await stageWork(pending.id, { kind: "request", originalAt: start, proposedAt: start + 2 * DAY })).toEqual([]);
    expect(await stageWork(second.id)).toEqual([]);
    expect(await stageWork(pending.id)).toEqual([first.id, pending.id].sort());
    const withPendingSeat = (await rt.pg.load())!;
    await rt.unitOfWork(n => n.importState({ ...withPendingSeat, opps: withPendingSeat.opps.map(opp => ({
      ...opp, status: opp.status.map(([id, status]) => [id, id === pending.id ? "dropped" : status]),
    })) }));
    expect(await stageWork(pending.id)).toEqual([]);

    // A direct reschedule must not read opted-in calendars for any other booking this member holds.
    const unrelated: typeof booked = { ...booked, id: "unrelated-booked-calendar", meetingAt: start + DAY,
      participants: [second.id, pending.id], status: [[second.id, "yes"], [pending.id, "yes"]] };
    const setBookings = (...opps: (typeof booked)[]) => rt.unitOfWork(n => n.importState({ ...n.exportState(), opps }));
    await setBookings(booked, unrelated);
    reads.length = 0;
    expect((await turn("calendar-reschedule-format", "RESCHEDULE whenever", phones[1])).status).toBe(200);
    expect(reads).toEqual([]);
    expect((await turn("calendar-reschedule-unknown-vote", "RESCHEDULE YES aaaaaaaaaaaaaaaa", phones[1])).status).toBe(200);
    expect(reads).toEqual([]);
    const exact = `RESCHEDULE ${localBookingStart(start)} TO ${localBookingStart(start + 2 * DAY)}`;
    await setBookings(booked, { ...unrelated, meetingAt: start, publicEventRevision: "fixture-fixed" });
    const ambiguous = await turn("calendar-reschedule-ambiguous", exact, phones[1]);
    expect(ambiguous.status, await ambiguous.text()).toBe(200);
    expect(reads).toEqual([]);
    await setBookings(booked, unrelated);
    expect((await turn("calendar-reschedule-exact", exact, phones[1])).status).toBe(200);
    expect(reads.map(request => request.memberId)).toEqual([first.id]);

    const draft: RescheduleDraft = { ref: "calendar-reschedule-fixture", revision: booked.scheduleRevision ?? 0,
      originalAt: start, proposedAt: start + 2 * DAY, expiresAt: clock.now() + HOUR,
      roster: [...ids].sort(), offered: [second.id], accepted: [] };
    await setBookings({ ...booked, reschedule: draft }, unrelated);
    reads.length = 0;
    const code = rescheduleMemberRef(draft, second.id);
    expect((await turn("calendar-reschedule-decline", `RESCHEDULE NO ${code}`, phones[1])).status).toBe(200);
    expect(reads).toEqual([]);
    await setBookings({ ...booked, reschedule: draft }, unrelated);
    expect((await turn("calendar-reschedule-vote", `RESCHEDULE YES ${code}`, phones[1])).status).toBe(200);
    expect(reads.map(request => request.memberId)).toEqual([first.id]);
  } finally {
    await service.close();
    await dropDb(url);
  }
});

test.skipIf(!pgAvailable)("a judge approval preloads calendar busy time before the first probe offers times", async () => {
  // spec/calendarFreeBusy.md, "A known busy interval excludes the slot and incomplete coverage cannot make it free"
  const url = await migratedDb("calendar_judge_approval");
  const clock = new SimClock(START);
  const app = APPS.friends;
  const phones = ["+12125550191", "+12125550192"] as const;
  const reads: CalendarPreloadRequest[] = [];
  let busy: { start: number; end: number } | undefined;
  const judge: ReviewJudge = { reviewer: SIM_REVIEW_JUDGE, judge: async () => ({
    verdict: "approve", reason: "none", explanation: "Both members climb near Greenpoint and asked for a regular partner.",
    model: "scripted", promptVersion: REVIEW_JUDGE_PROMPT_VERSION,
  }) };
  const service = new NetworkService({
    url, clock, photoStorage: null, log: () => {}, notify: false, reviewJudge: judge,
    tokens: `safety@friends:${safetyToken}`,
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: turnSecret, NETWORK_CALENDAR_FREE_BUSY_SECRET: calendarSecret,
      NETWORK_CLOUD_DELIVERY_ORIGIN: "https://calendar.invalid" },
    networks: [{ id: "friends:nyc", matchingEnabled: true }],
    devMatching: ["friends:nyc"],
    network: { maxNewPerDay: 0, plans: false, growth: false },
    calendarFreeBusyFetch: async (destination, init) => {
      const req = new Request(destination, init);
      const raw = await req.text();
      const request = JSON.parse(raw) as CalendarPreloadRequest;
      const now = clock.now();
      const id = `calendar-read:${request.nonce}`;
      reads.push(request);
      if (!busy) return new Response(null, { status: 403 });
      const { app, personId, memberId, purpose, coverage } = request;
      const source = { app, memberId, purpose, provider: calendarSource, connectionId };
      const body = JSON.stringify({
        app, personId, memberId, purpose, requestSha256: hash(raw), issuedAt: now, expiresAt: now + 29_000,
        grant: { ...source, active: true, grantedAt: START, expiresAt: now + 5 * MINUTE },
        observation: { ...source, observedAt: now, coverage, busy: [busy] },
      });
      const headers = await svcSign(calendarSecret, { method: "POST", path: calendarPreloadPath, id: `${id}:proof`, body, nowS: Math.floor(now / 1000) });
      return new Response(body, { headers });
    },
  });
  const post = async (path: string, id: string, body: string, key: string) => {
    const auth = await svcSign(key, { method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${path}`, { method: "POST", headers: { "Content-Type": "application/json", ...auth }, body }));
  };
  const turn = (id: string, text: string, from: string) => {
    const input: TurnRequest = { app: app.id, from, messageId: id, text, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    return post(TURN_PATH, id, JSON.stringify(input), turnSecret);
  };

  try {
    await service.start();
    const profiles = [];
    for (const [i, e164] of phones.entries()) {
      const name = ["Ari", "Blair"][i]!;
      const joined = await service.accounts.join(app, { e164, personId: null }, { firstName: name, age: 30, consent: { sms: true, wording: app.consent.text } });
      if (!joined.ok) throw new Error(`Fixture join refused for ${name}`);
      const id = joined.membership.memberId;
      for (const check of ["age", "liveness"]) {
        const verified = await service.fetch(new Request(`http://localhost/apps/friends/members/${encodeURIComponent(id)}/verify`, {
          method: "POST",
          headers: { authorization: `Bearer ${safetyToken}`, "content-type": "application/json" },
          body: JSON.stringify({ check, result: "pass", note: "Adult calendar scheduling fixture" }),
        }));
        expect(await verified.json()).toEqual({ ok: true });
      }
      profiles.push({ id, personId: joined.membership.personId, name, age: 30, area: "Greenpoint",
        interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
    }
    const [first, second] = profiles as [typeof profiles[number], typeof profiles[number]];
    const ids = [first.id, second.id];
    const rt = service.runtimes.get("friends:nyc")!;
    const world = new Mini(profiles, { app: app.id, growth: false, plans: false, inlineJudge: () => null });
    world.verify(...ids);
    await world.onboard(...ids);
    const oppId = world.propose(ids);
    expect(await world.runUntil(() => world.net.reviewQueue().some(item => item.oppId === oppId))).toBe(true);
    clock.set(START);
    const fixture = world.net.exportState();
    const reviewOpp = fixture.opps.find(item => item.id === oppId)!;
    delete reviewOpp.review!.exception;
    reviewOpp.review!.judgeWaitFrom = START;
    await rt.unitOfWork(n => n.importState({ ...n.exportState(), members: fixture.members, opps: fixture.opps }));
    expect((await turn("calendar-judge-enable", "CALENDAR", phones[0])).status).toBe(200);
    busy = { start: clock.now(), end: clock.now() + 8 * DAY };
    reads.length = 0;
    await service.reviewJudgeTick();
    const state = (await rt.pg.load())!;
    const opp = state.opps.find(item => item.id === oppId)!;
    expect(opp.stage).toBe("probing");
    expect(opp.offered?.[first.id] ?? []).toEqual([]);
    expect(reads.map(request => request.memberId)).toEqual([first.id]);
  } finally {
    await service.close();
    await dropDb(url);
  }
});
