import { describe, expect, test } from "vitest";
import {
  buildMeetupIcs, checkMeetupIcsLeaks, DAY, HOUR, isOwnCalendarIcsUrl, MeetupIcsLeakError, MINUTE,
  SimClock, type Proposal, type TimeOption,
} from "@thenetwork/core";
import { signCalendarToken, verifyCalendarToken } from "../../core/src/runtime/calendar-token.ts";
import { friendsPack, networkPack, slopPack } from "@thenetwork/engine";
import { networkTextCanProduceInboxItem } from "../../core/src/generated/notificationAcknowledgement.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { APPS } from "../../platform/src/apps.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { parseFriendsPlanTimeReply } from "../src/friends-plan-time-choice.ts";
import { NetworkService } from "../service/service.ts";
import { Mini, START } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

describe("Pass 4 [DECIDE-4]: 1-slot friends partner plan bare yes", () => {
  const slotA: TimeOption = { key: "a", start: Date.UTC(2026, 9, 8, 23), end: Date.UTC(2026, 9, 9, 1), label: "Thursday 7pm" };
  const slotB: TimeOption = { key: "b", start: Date.UTC(2026, 9, 10, 15), end: Date.UTC(2026, 9, 10, 17), label: "Saturday 11am" };
  const slotC: TimeOption = { key: "c", start: Date.UTC(2026, 9, 11, 18), end: Date.UTC(2026, 9, 11, 20), label: "Sunday 2pm" };

  test("1-slot partner plan accepts bare affirmative replies and returns the single window", () => {
    for (const reply of ["yes", "Yes!", "sounds good", "sure", "works for me", "I'm in"]) {
      const parsed = parseFriendsPlanTimeReply(reply, [slotA]);
      expect(parsed, reply).toEqual({ answer: "yes", picks: [{ start: slotA.start, end: slotA.end }] });
    }
    expect(parseFriendsPlanTimeReply("A", [slotA])).toEqual({ answer: "yes", picks: [{ start: slotA.start, end: slotA.end }] });
  });

  test("1-slot partner plan still rejects negative, counter, wrong option, and hedged replies", () => {
    for (const reply of ["no", "nope", "can't make it"]) {
      expect(parseFriendsPlanTimeReply(reply, [slotA]), reply).toEqual({ answer: "no", picks: [] });
    }
    for (const reply of ["Friday works instead", "neither, how about Sunday?", "B", "Saturday 11am", "maybe", "yes?"]) {
      expect(parseFriendsPlanTimeReply(reply, [slotA]), reply).toEqual({ answer: "unclear", picks: [] });
    }
  });

  test("2- and 3-slot partner plans still require an explicit pick on bare affirmative replies", () => {
    for (const offered of [[slotA, slotB], [slotA, slotB, slotC]]) {
      for (const reply of ["yes", "sounds good", "sure"]) {
        expect(parseFriendsPlanTimeReply(reply, offered), `${offered.length}:${reply}`).toEqual({ answer: "unclear", picks: [] });
      }
      expect(parseFriendsPlanTimeReply("A and B", offered)).toEqual({
        answer: "yes",
        picks: [
          { start: slotA.start, end: slotA.end },
          { start: slotB.start, end: slotB.end },
        ],
      });
    }
  });
});

describe("Pass 4 [DECIDE-4]: Symmetric parallel 1:1 probing vs requester wanter_first", () => {
  test("slopPack and friendsPack default to parallel consent order while networkPack keeps sequential wanter_first", () => {
    expect(slopPack.consent.default).toMatchObject({ kind: "probe_first", order: "parallel" });
    expect(friendsPack.consent.default).toMatchObject({ kind: "probe_first", order: "parallel" });
    expect(networkPack.consent.default).toMatchObject({ kind: "probe_first", order: "wanter_first" });
  });

  test("symmetric non-requester 1:1 engine intro probes both members in parallel, while requester intro stays wanter_first", async () => {
    const w = new Mini([
      { id: "a", name: "Ana Diaz", age: 30, area: "Williamsburg", interests: ["coffee", "climbing", "books"], wants: [{ objective: "find a climbing partner", category: "hobby" }] },
      { id: "b", name: "Ben Ito", age: 31, area: "Williamsburg", interests: ["coffee", "climbing", "books"], skills: ["belaying"] },
    ], { inlineJudge: simulatedReviewJudge({ exceptions: false }), plans: false, growth: false, probeOrder: "parallel" });
    await w.onboard("a", "b");

    // 1. Symmetric engine intro (no requester): probes BOTH in parallel without waiting for the first yes.
    const state = w.net.exportState();
    const now = w.clock.now();
    const symId = "sym-parallel-1";
    state.opps.push({
      id: symId,
      origin: "engine",
      kind: "intro",
      category: "social",
      objective: "coffee meetup",
      detail: "grabbing coffee",
      participants: ["a", "b"],
      alternates: [],
      primed: [],
      status: [["a", "queued"], ["b", "queued"]],
      explanations: { a: "Shared interests nearby.", b: "Shared interests nearby." },
      stage: "probing",
      deadline: now + 3 * DAY,
      createdAt: now,
      score: 0.85,
      components: { fit: 0.8, mutualBenefit: 0.8, warmPath: 0, novelty: 0.4, timingFit: 0.8, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0.9 },
      generator: "shared_interest",
      exploration: false,
      tags: ["coffee"],
      replacements: 0,
      sameDay: false,
      contacted: [],
      reminded: [],
      feedbackFrom: [],
      review: { queuedAt: now, deadline: now + DAY, decision: "approve", approver: "judge", reviewer: "sim_judge" },
    } as unknown as (typeof state.opps)[number]);
    w.net.importState(state);
    expect(w.net.probeOrderFor(symId)).toBe("parallel");

    // Advance until at least one probe sends; in parallel mode both members are probed before either replies.
    expect(await w.runUntil(() => w.probed("a") && w.probed("b"), 2 * DAY)).toBe(true);
    expect(w.meetings).toHaveLength(0);

    // If b declines while a is awaiting reply, b is never exposed as the decliner.
    const markBeforeDecline = w.mark();
    await w.say("b", "no thanks");
    await w.say("a", "yes");
    const aAfter = w.to("a", markBeforeDecline).map(m => m.body).join(" ");
    expect(aAfter.toLowerCase()).not.toContain("ben");
    expect(aAfter.toLowerCase()).not.toContain("declined");
    expect(w.meetings).toHaveLength(0);

    // 2. Asymmetric requester-driven opportunity stays wanter_first.
    const reqState = w.net.exportState();
    const reqId = "req-seq-1";
    reqState.opps.push({
      id: reqId,
      origin: "request",
      kind: "intro",
      category: "hobby",
      objective: "find a climbing partner",
      detail: "a climbing session",
      participants: ["a", "b"],
      alternates: [],
      primed: [],
      requester: "a",
      status: [["a", "queued"], ["b", "queued"]],
      explanations: { a: "They belay nearby.", b: "Someone nearby wants to climb." },
      stage: "probing",
      deadline: w.clock.now() + 3 * DAY,
      createdAt: w.clock.now(),
      score: 0.85,
      components: { fit: 0.8, mutualBenefit: 0.8, warmPath: 0, novelty: 0.8, timingFit: 0.8, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0.9 },
      generator: "request",
      exploration: false,
      tags: ["climbing"],
      replacements: 0,
      sameDay: false,
      contacted: [],
      reminded: [],
      feedbackFrom: [],
      review: { queuedAt: w.clock.now(), deadline: w.clock.now() + DAY, decision: "approve", approver: "judge", reviewer: "sim_judge" },
    } as unknown as (typeof reqState.opps)[number]);
    w.net.importState(reqState);
    expect(w.net.probeOrderFor(reqId)).toBe("wanter_first");
    expect(await w.runUntil(() => w.probed("a"), 2 * DAY)).toBe(true);
    expect(w.probed("b")).toBe(false);
  });
});

describe("Pass 4 [DECIDE-4]: Privacy-safe RFC 5545 .ics, HMAC tokens & reveal calendar link", () => {
  const SECRET = "test-calendar-signing-secret-32-bytes-minimum";
  const NOW = Date.UTC(2026, 10, 20, 15, 0);
  const START_MS = Date.UTC(2026, 10, 22, 19, 0);

  test("buildMeetupIcs outputs valid folded RFC 5545 VCALENDAR/VEVENT and enforces LeakGuard", () => {
    const ics = buildMeetupIcs({
      uid: "abc123def456@ntwrk.party",
      dtstampMs: NOW,
      startMs: START_MS,
      endMs: START_MS + 90 * MINUTE,
      summary: "The Network meetup; coffee, tea & chat",
      location: "Devocion, Williamsburg",
      description: "Reply in your message thread if your plans change. See you there at the counter near the entrance.",
    });
    expect(ics.endsWith("\r\n")).toBe(true);
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("VERSION:2.0\r\n");
    expect(ics).toContain("PRODID:-//The Network//Meetup//EN\r\n");
    expect(ics).toContain("BEGIN:VEVENT\r\n");
    expect(ics).toContain("UID:abc123def456@ntwrk.party\r\n");
    expect(ics).toContain("DTSTAMP:20261120T150000Z\r\n");
    expect(ics).toContain("DTSTART:20261122T190000Z\r\n");
    expect(ics).toContain("DTEND:20261122T203000Z\r\n");
    expect(ics).toContain("SUMMARY:The Network meetup\\; coffee\\, tea & chat\r\n");
    expect(ics).toContain("LOCATION:Devocion\\, Williamsburg\r\n");
    expect(ics).toContain("END:VEVENT\r\n");
    expect(ics).toContain("END:VCALENDAR\r\n");
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }

    // LeakGuard blocks PII, private facts, canaries, and internal IDs.
    expect(() => buildMeetupIcs({
      uid: "u1@ntwrk.party", dtstampMs: NOW, startMs: START_MS,
      summary: "Meetup with 212-555-0199", location: "Cafe",
    })).toThrow(MeetupIcsLeakError);
    expect(() => buildMeetupIcs({
      uid: "u1@ntwrk.party", dtstampMs: NOW, startMs: START_MS,
      summary: "The Network meetup", location: "Cafe",
      description: "Email peer@example.com for details",
    })).toThrow(MeetupIcsLeakError);
    expect(() => buildMeetupIcs({
      uid: "u1@ntwrk.party", dtstampMs: NOW, startMs: START_MS,
      summary: "The Network meetup", location: "Cafe",
      description: "Ref mem_secret12345",
    })).toThrow(MeetupIcsLeakError);
    expect(checkMeetupIcsLeaks({
      summary: "The Network meetup",
      description: "They are going through a rough divorce right now",
      leakOptions: { facts: ["going through a rough divorce"] },
    })).not.toEqual([]);
  });

  test("signCalendarToken and verifyCalendarToken enforce HMAC signature, secret, and Clock expiry", () => {
    const exp = START_MS + 4 * HOUR;
    const token = signCalendarToken({ app: "ntwrk", oppId: "opp-1", memberId: "m-1", exp, rev: 0 }, SECRET);
    expect(verifyCalendarToken(token, SECRET, NOW)).toEqual({ app: "ntwrk", oppId: "opp-1", memberId: "m-1", exp, rev: 0 });
    expect(verifyCalendarToken(`${token}.ics`, SECRET, NOW)).toEqual({ app: "ntwrk", oppId: "opp-1", memberId: "m-1", exp, rev: 0 });
    // Expiry is strict (now >= exp rejected).
    expect(verifyCalendarToken(token, SECRET, exp)).toBeUndefined();
    expect(verifyCalendarToken(token, SECRET, exp + 1)).toBeUndefined();
    // Tampering or wrong secret rejected.
    const tampered = `${token.slice(0, -2)}aa`;
    expect(verifyCalendarToken(tampered, SECRET, NOW)).toBeUndefined();
    expect(verifyCalendarToken(token, "wrong-secret", NOW)).toBeUndefined();
    expect(isOwnCalendarIcsUrl(`https://ntwrk.party/cal/${token}.ics`, "ntwrk.party")).toBe(true);
    expect(isOwnCalendarIcsUrl(`https://evil.example/cal/${token}.ics`, "ntwrk.party")).toBe(false);
  });

  test("ConsentNetwork appends first-party calendarLinkFor on booked reveals without tripping LeakGuard and ignores foreign links", async () => {
    const ownToken = signCalendarToken({ app: "ntwrk", oppId: "opp-cal", memberId: "a", exp: START + 10 * DAY }, SECRET);
    const ownUrl = `https://ntwrk.party/cal/${ownToken}.ics`;
    const w = new Mini([
      { id: "a", name: "Ana Diaz", age: 30, area: "Williamsburg", interests: ["coffee", "books"] },
      { id: "b", name: "Ben Ito", age: 31, area: "Williamsburg", interests: ["coffee", "books"] },
    ], {
      inlineJudge: simulatedReviewJudge({ exceptions: false }),
      plans: false,
      growth: false,
      calendarLinkFor: (_opp, recipient) => recipient === "a" ? ownUrl : "https://evil.example/cal/fake.token.ics",
    });
    await w.onboard("a", "b");
    const oppId = w.propose(["a", "b"], { category: "social", objective: "coffee meetup" });
    await w.answerProbes(["a", "b"]);
    expect(w.meetings).toHaveLength(1);
    const revealA = w.to("a").find(m => m.meta.proposalId === oppId && m.meta.booked)?.body ?? "";
    const revealB = w.to("b").find(m => m.meta.proposalId === oppId && m.meta.booked)?.body ?? "";
    expect(revealA).toContain(`Add to calendar: ${ownUrl}`);
    expect(revealB).not.toContain("evil.example");
    expect(revealB).not.toContain("Add to calendar:");
    expect(w.net.counters.guardBlocked).toBe(0);
  });
});

describe("Pass 4 [DECIDE-3]: Pure ConsentNetwork availability/red-lines & expanded inbox projection", () => {
  test("setMemberAvailability and setMemberRedLines update state cleanly without Date.now", async () => {
    const w = new Mini([
      { id: "a", name: "Ana Diaz", age: 30, area: "Williamsburg", interests: ["coffee"] },
      { id: "b", name: "Ben Ito", age: 30, area: "Williamsburg", interests: ["coffee"] },
    ], { plans: false, growth: false });
    await w.onboard("a", "b");

    const avail = w.net.setMemberAvailability("a", {
      days: ["Tue", "Thu"],
      windows: ["evening"],
      quietHours: { start: "22:30", end: "08:00" },
      timezone: "America/New_York",
    }, w.clock.now());
    expect(avail.ok).toBe(true);
    expect(avail.quietHours).toEqual([22.5, 8]);
    expect(avail.tags).toEqual(expect.arrayContaining(["evening:Tue", "evening:Thu"]));
    const memberAfterAvail = w.net.exportState().members.find(m => m.id === "a")!;
    expect(memberAfterAvail.quietHours).toEqual([22.5, 8]);
    expect(memberAfterAvail.stated?.windows.length).toBeGreaterThan(0);

    expect(w.net.setMemberAvailability("a", { quietHours: { start: "99:00", end: "08:00" } }, w.clock.now()).ok).toBe(false);
    expect(w.net.setMemberAvailability("a", { days: ["Tue"], timezone: "Mars/Olympus" }, w.clock.now()).ok).toBe(false);

    const rl1 = w.net.setMemberRedLines("a", ["I'm strictly sober", "peanut allergy"], "merge");
    expect(rl1).toEqual({ ok: true, redLines: ["severe_allergen", "strict_sober"] });
    const rl2 = w.net.setMemberRedLines("a", ["halal"], "merge");
    expect(rl2).toEqual({ ok: true, redLines: ["halal", "severe_allergen", "strict_sober"] });
    const rl3 = w.net.setMemberRedLines("a", ["wheelchair"], "replace");
    expect(rl3).toEqual({ ok: true, redLines: ["wheelchair"] });

    const oppId = w.propose(["a", "b"], { category: "social", objective: "coffee meetup" });
    await w.answerProbes(["a", "b"]);
    const reveal = w.to("b").find(m => m.meta.proposalId === oppId && m.meta.booked)?.body ?? "";
    expect(reveal).toContain(" at Devoción (Williamsburg) — Under the living plant wall");
  });

  test("networkTextCanProduceInboxItem projects reveal, pre_brief, venue_pivot, checkin, relay and excludes system: true", () => {
    for (const type of ["reveal", "pre_brief", "venue_pivot", "checkin", "relay", "probe", "plan_probe", "proposal", "reminder", "feedback_request", "cancellation", "scheduling"]) {
      expect(networkTextCanProduceInboxItem(false, type), `non-system:${type}`).toBe(true);
      expect(networkTextCanProduceInboxItem(true, type), `system:${type}`).toBe(false);
    }
    expect(networkTextCanProduceInboxItem(false, "onboarding")).toBe(false);
    expect(networkTextCanProduceInboxItem(false, "info")).toBe(false);
  });
});

describe("Pass 4 [DECIDE-3 & DECIDE-4]: NetworkService Postgres integration", () => {
  test.skipIf(!pgAvailable)("service.setMemberAvailability, service.setMemberRedLines, GET /cal/:token.ics, and expanded inbox projection work end-to-end", async () => {
    const url = await migratedDb("pass4_deferred_decide");
    const sql = new SQL(url);
    const clock = new SimClock(Date.UTC(2026, 10, 20, 15, 0));
    const service = new NetworkService({
      url, clock, photoStorage: null, log: () => {}, env: { PLATFORM_ENV: "dev", CLEF_RATINGS: "off" },
      networks: [{ id: "ntwrk:nyc", matchingEnabled: false }],
      calendarLinks: true,
    });
    try {
      await service.start();
      const app = APPS.ntwrk;
      const phoneA = "+12125550941";
      const phoneB = "+12125550942";
      const inviteA = await service.accounts.invite(app, phoneA);
      const inviteB = await service.accounts.invite(app, phoneB);
      const joinedA = await service.accounts.join(app, { e164: phoneA, personId: inviteA!.personId }, {
        firstName: "Ana", age: 30, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
      });
      const joinedB = await service.accounts.join(app, { e164: phoneB, personId: inviteB!.personId }, {
        firstName: "Ben", age: 31, homeCity: "nyc", consent: { sms: true, wording: app.consent.text },
      });
      if (!joinedA.ok || !joinedB.ok) throw new Error("Fixture members failed to join");
      const { personId: personA, memberId: memberA } = joinedA.membership;
      const { memberId: memberB } = joinedB.membership;
      const phoneKeyA = service.accounts.phoneHash(phoneA);

      // Hydrate runtime state so members exist in ConsentNetwork.
      const rt = service.runtimeFor("ntwrk", "nyc")!;
      await rt.unitOfWork(net => net.tick(clock.now()));

      // 1. setMemberAvailability persists into ConsentNetwork + network.members.prefs + network.facets.
      const availRes = await service.setMemberAvailability("ntwrk", personA, phoneKeyA, {
        days: ["Tue", "Thu"], windows: ["evening"], quietHours: { start: "22:30", end: "07:30" },
      });
      expect(availRes.ok).toBe(true);
      const [memberRow] = await rt.scoped(tx => tx`select prefs from network.members where app_id='ntwrk' and id=${memberA}`);
      expect(memberRow.prefs?.quietHours).toEqual([22.5, 7.5]);

      // 2. setMemberRedLines persists into ConsentNetwork + network.facets (agent_private/ai_memory) + platform.memberships.profile.redLines.
      const rlMerge = await service.setMemberRedLines("ntwrk", personA, phoneKeyA, {
        redLines: ["strictly sober", "halal"], mode: "merge",
      });
      expect(rlMerge).toEqual({ ok: true, redLines: ["halal", "strict_sober"] });
      const rlReplace = await service.setMemberRedLines("ntwrk", personA, phoneKeyA, {
        redLines: ["wheelchair"], mode: "replace",
      });
      expect(rlReplace).toEqual({ ok: true, redLines: ["wheelchair"] });
      const storedMembership = await service.people.getMembership(personA, "ntwrk");
      expect(storedMembership?.profile.redLines).toEqual(["wheelchair"]);
      const facetRows = await rt.scoped(tx => tx`select tags, privacy_scope, source from network.facets where app_id='ntwrk' and member_id=${memberA} and kind='boundary'`);
      expect([...facetRows]).toEqual([{ tags: ["wheelchair"], privacy_scope: "agent_private", source: "ai_memory" }]);

      // 3. Seed a booked opportunity, sign its .ics link, and fetch GET /cal/:token.ics.
      const meetingAt = clock.now() + 2 * DAY;
      const oppId = "opp-cal-test-1";
      await rt.unitOfWork(net => {
        const st = net.exportState();
        st.opps.push({
          id: oppId, origin: "engine", kind: "intro", category: "social", objective: "coffee", detail: "coffee",
          participants: [memberA, memberB], alternates: [], primed: [memberA, memberB],
          status: [[memberA, "yes"], [memberB, "yes"]],
          explanations: { [memberA]: "Shared interests.", [memberB]: "Shared interests." },
          stage: "scheduled", deadline: meetingAt, createdAt: clock.now(), meetingAt,
          venueId: "devocion", venue: "Devocion", venueArea: "Williamsburg", scheduleRevision: 0,
          score: 0.9, components: { fit: 0.9, mutualBenefit: 0.9, warmPath: 0, novelty: 0.8, timingFit: 0.9, activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 0.9 },
          generator: "shared_interest", exploration: false, tags: ["coffee"], replacements: 0, sameDay: false,
          contacted: [memberA, memberB], reminded: [], feedbackFrom: [],
        } as unknown as (typeof st.opps)[number]);
        net.importState(st);
      });
      const calUrl = service.calendarLinkFor("ntwrk", {
        id: oppId, stage: "scheduled", meetingAt, venue: "Devocion", scheduleRevision: 0,
      }, memberA);
      expect(calUrl).toMatch(/^https:\/\/ntwrk\.party\/cal\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.ics$/);

      const resOk = await service.publicFetch(new Request(calUrl!));
      expect(resOk.status).toBe(200);
      expect(resOk.headers.get("content-type")).toBe("text/calendar; charset=utf-8");
      expect(resOk.headers.get("content-disposition")).toBe('inline; filename="meetup.ics"');
      expect(resOk.headers.get("cache-control")).toBe("private, no-store");
      const body = await resOk.text();
      expect(body).toContain("BEGIN:VCALENDAR");
      expect(body).toContain("BEGIN:VEVENT");
      expect(body).toContain("LOCATION:Devocion\\, Williamsburg");
      expect(body).not.toContain(phoneA);
      expect(body).not.toContain(phoneB);
      expect(body).not.toContain("Ben");
      expect(body).not.toContain(oppId);

      // Tampered token -> 404.
      const resTampered = await service.publicFetch(new Request(`${calUrl!.slice(0, -6)}aa.ics`));
      expect(resTampered.status).toBe(404);

      // Expired token (meetingAt + 4h) -> 404.
      const tokenPart = new URL(calUrl!).pathname.slice("/cal/".length);
      const resExpired = await service.renderCalendarIcs(tokenPart, meetingAt + 4 * HOUR);
      expect(resExpired.status).toBe(404);

      // Cancelled opportunity -> 404.
      await rt.unitOfWork(net => {
        const st = net.exportState();
        st.opps.find(o => o.id === oppId)!.stage = "closed";
        net.importState(st);
      });
      const resClosed = await service.publicFetch(new Request(calUrl!));
      expect(resClosed.status).toBe(404);

      // 4. Expanded networkTextCanProduceInboxItem types project via service.delivered, while system: true stays excluded.
      const expandedTypes = ["reveal", "pre_brief", "venue_pivot", "checkin", "relay"] as const;
      await service.delivered(rt, [
        ...expandedTypes.map((type, idx) => ({
          id: `exp-${type}-${idx}`, memberId: memberA, to: phoneA, body: `Update for ${type}.`,
          kind: "transactional" as const, type, proactive: false, system: false, ts: clock.now(),
        })),
        {
          id: "exp-system-ignored", memberId: memberA, to: phoneA, body: "System reveal should be ignored.",
          kind: "transactional" as const, type: "reveal", proactive: false, system: true, ts: clock.now(),
        },
      ]);
      const projected = await sql<{ event_type: string; delivery_id: string }[]>`
        select event_type, delivery_id from notify.inbox_items where person_id=${personA} order by event_type`;
      expect(projected.map(r => r.event_type)).toEqual([...expandedTypes].sort());
      expect(projected.some(r => r.delivery_id === "net:exp-system-ignored")).toBe(false);
    } finally {
      await service.close();
      await sql.close();
      await dropDb(url);
    }
  }, 120_000);
});
