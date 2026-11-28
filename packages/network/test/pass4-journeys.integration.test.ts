import { describe, expect, test } from "vitest";
import { CITY_IDS, CITY_TZ, DAY, HOUR, MINUTE } from "@thenetwork/core";
import { addMember, call, connect, origin, PHONE_A, PHONE_B, setup } from "../../mcp/test/harness.ts";
import { copy, timezoneLabel } from "../src/copy.ts";
import { plansPlaceQuestionFor } from "../src/classify.ts";
import { describeBookingStart } from "../src/rescheduling.ts";
import { Mini } from "./mini.ts";

const NTWRK_MCP = `${origin("ntwrk.party")}/mcp`;

describe("Pass 4 user journeys integration", () => {
  test("MCP submit_profile accepts benign 4-digit years/currency/units, rejects real OTPs/contacts, and prepare_signup returns direct signup_url", async () => {
    const saved: string[] = [];
    const env = setup({
      submitProfile: async (_personId, _app, _e164, text) => {
        saved.push(text);
        return "accepted" as const;
      },
    });
    await addMember(env, PHONE_A, [{ app: "ntwrk", state: "active" }], 30);
    const { token } = await connect(env, "ntwrk.party", PHONE_A, {
      scope: "membership:read profile:write profile:read",
    });

    // Benign 4-digit years, currency, and ratings/units must be accepted
    for (const about of [
      "Graduated in 2019 and moved to SF in 2022. Love climbing and espresso.",
      "Budget around $1500/mo, 1600 elo chess player in Lincoln Park, 2000 sqft studio.",
    ]) {
      const r = await call(env, NTWRK_MCP, "submit_profile", { app: "ntwrk", about }, { token: token.access_token });
      expect(r.res.status).toBe(200);
      expect(r.body!.result.isError).toBe(false);
      expect(r.body!.result.structuredContent).toMatchObject({ app: "ntwrk", submitted: true });
      expect(r.body!.result.structuredContent.next_step).toMatch(/text|missing|match/i);
    }
    expect(saved).toHaveLength(2);

    // Real OTP / verification codes and phone/email contacts must still be rejected
    for (const bad of [
      "My verification code is 482910",
      "OTP: 8392 please verify",
      "Call me at 415-555-0192",
      "Email me at alex@example.com",
    ]) {
      const r = await call(env, NTWRK_MCP, "submit_profile", { app: "ntwrk", about: bad }, { token: token.access_token });
      expect(r.res.status).toBe(200);
      expect(r.body!.result.isError).toBe(true);
    }
    expect(saved).toHaveLength(2);

    // prepare_signup returns a direct app-bound signup_url with the draft token for a new user
    const { token: freshToken } = await connect(env, "ntwrk.party", PHONE_B, {
      scope: "membership:read profile:write",
    });
    const prep = await call(env, NTWRK_MCP, "prepare_signup", {
      app: "ntwrk",
      firstName: "Maya",
      homeCity: "sf",
    }, { token: freshToken.access_token });
    expect(prep.res.status).toBe(200);
    expect(prep.body!.result.isError).toBe(false);
    const sc = prep.body!.result.structuredContent;
    expect(sc).toMatchObject({ prepared: true, app: "ntwrk" });
    expect(sc.signup_url).toMatch(/^https:\/\/ntwrk\.party\//);
    expect(sc.next_step).toContain("draft is saved");
  });

  test("natural-language rescheduling auto-accepts requester, uses city timezone, and commits across restart", async () => {
    const w = new Mini([], { city: "chicago", engine: { cities: ["chicago"] }, plans: false });
    for (const [id, name, area] of [["c1", "Elena Cruz", "Lincoln Park"], ["c2", "Sam Patel", "West Loop"]] as const) {
      w.members.push({
        id, name, homeCity: "chicago", state: "normal", joinedAt: w.clock.now(), age: 31, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      w.presence.push({ memberId: id, city: "chicago", type: "home", areas: [area] });
    }
    await w.onboard("c1", "c2");
    const oppId = w.propose(["c1", "c2"], { category: "social", objective: "Coffee intro" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    await w.answerProbes(["c1", "c2"]);
    const initialAt = w.net.opps.get(oppId)!.meetingAt!;

    const c2Before = w.to("c2").length;
    await w.say("c1", "Can we push it 1 hour later?");
    await w.run(HOUR);
    const c2Msgs = w.to("c2").slice(c2Before);
    const offer = c2Msgs.find(m => /Chicago time/i.test(m.body));
    expect(offer).toBeDefined();
    expect(offer!.body).not.toContain("New York time");
    expect(w.net.exportState().opps.find(o => o.id === oppId)?.reschedule?.accepted).toEqual(["c1"]);

    // Persists across restart and commits when partner replies naturally
    w.restart();
    await w.say("c2", "sounds good");
    const after = w.net.opps.get(oppId)!;
    expect(after.meetingAt).toBe(initialAt + HOUR);
    expect(after.scheduleRevision).toBe(1);
    expect(w.log("meeting_rescheduled")).toHaveLength(1);
  });

  test("venue swap pivots a booked date without canceling and notifies partner", async () => {
    const w = new Mini([], { city: "la", engine: { cities: ["la"] }, plans: false });
    for (const [id, name, area] of [["l1", "Nora Kim", "Silver Lake"], ["l2", "Omar Reed", "Echo Park"]] as const) {
      w.members.push({
        id, name, homeCity: "la", state: "normal", joinedAt: w.clock.now(), age: 29, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      w.presence.push({ memberId: id, city: "la", type: "home", areas: [area] });
    }
    await w.onboard("l1", "l2");
    const oppId = w.propose(["l1", "l2"], { category: "social", objective: "Coffee hangout" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    await w.answerProbes(["l1", "l2"]);
    const beforeVenueId = w.net.opps.get(oppId)!.venueId;
    const l2Before = w.to("l2").length;

    await w.say("l1", "Too loud there, can we do somewhere quieter instead?");
    const after = w.net.opps.get(oppId)!;
    expect(after.stage).toBe("scheduled");
    expect(after.venueId).not.toBe(beforeVenueId);
    expect(w.log("venue_swapped")).toHaveLength(1);
    expect(w.to("l2").slice(l2Before).some(m => m.body.includes(after.venue!))).toBe(true);
  });

  test("general venue swap syncs the arrival pre-brief, avoids rejected repeats, and stops at the pivot limit", async () => {
    const w = new Mini([], { city: "la", engine: { cities: ["la"] }, arrivalBriefs: true, plans: false });
    for (const [id, name, area] of [["s1", "Nora Kim", "Silver Lake"], ["s2", "Omar Reed", "Echo Park"]] as const) {
      w.members.push({
        id, name, homeCity: "la", state: "normal", joinedAt: w.clock.now(), age: 29, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      w.presence.push({ memberId: id, city: "la", type: "home", areas: [area] });
    }
    await w.onboard("s1", "s2");
    const oppId = w.propose(["s1", "s2"], { category: "social", objective: "Coffee hangout" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    await w.answerProbes(["s1", "s2"]);
    const v0 = w.net.opps.get(oppId)!.venueId!;
    const v0Name = w.net.opps.get(oppId)!.venue!;
    const seen = new Set<string>([v0]);

    await w.say("s1", "Can we swap the venue?");
    const v1 = w.net.opps.get(oppId)!.venueId!;
    expect(seen.has(v1)).toBe(false);
    seen.add(v1);

    await w.say("s1", "Can we try another spot?");
    const v2 = w.net.opps.get(oppId)!.venueId!;
    const v2Name = w.net.opps.get(oppId)!.venue!;
    expect(seen.has(v2)).toBe(false);
    seen.add(v2);

    await w.say("s1", "Can we swap the venue?");
    const afterThird = w.net.opps.get(oppId)!;
    const repeatedPriorVenue = afterThird.venueId !== v2 && seen.has(afterThird.venueId!);

    await w.say("s2", "Sounds good!");
    const beforeBrief = w.sent.length;
    w.clock.set(afterThird.meetingAt! - 70 * MINUTE);
    await w.net.tick(w.clock.now());
    const briefs = w.sent.slice(beforeBrief).filter(s => s.meta.proposalId === oppId && /Heads up for/i.test(s.body));
    const rejectedByS1 = new Map(w.net.exportState().venues?.rejected ?? []).get("s1") ?? [];

    expect({
      repeatedPriorVenue,
      exhaustedCount: w.log("venue_pivot_exhausted").length,
      rejectedRecorded: rejectedByS1.includes(v0) && rejectedByS1.includes(v1),
      briefRecipients: briefs.map(b => b.to).sort(),
      briefNamesCurrentVenue: briefs.length === 2 && briefs.every(b => b.body.includes(v2Name)),
      briefNamesInitialVenue: briefs.some(b => b.body.includes(v0Name)),
    }).toEqual({
      repeatedPriorVenue: false,
      exhaustedCount: 1,
      rejectedRecorded: true,
      briefRecipients: ["s1", "s2"],
      briefNamesCurrentVenue: true,
      briefNamesInitialVenue: false,
    });
  });

  test("multi-city onboarding skips redundant questions, uses city copy, and direct-reply ack works without breaking Blooio streak", async () => {
    // Multi-city plans place question and timezone labels
    expect(plansPlaceQuestionFor("nyc")).toContain("Which NYC neighborhood");
    expect(plansPlaceQuestionFor("sf")).toContain("San Francisco");
    expect(plansPlaceQuestionFor("miami")).toContain("Miami");
    for (const city of CITY_IDS) {
      const tz = CITY_TZ[city];
      const label = timezoneLabel(city);
      const msg = copy.rescheduleUpdated(describeBookingStart(Date.UTC(2026, 9, 10, 19), tz), label);
      expect(msg).toContain(label);
      if (city !== "nyc") expect(msg).not.toContain("New York time");
    }

    // Rich Q1 answer skips redundant Q2/Q3 onboarding questions straight to active
    const w = new Mini([], { city: "miami", engine: { cities: ["miami"] }, arrivalBriefs: true, plans: false });
    for (const [id, name, area] of [["m1", "Sofia Vega", "Brickell"], ["m2", "Liam Park", "Wynwood"]] as const) {
      w.members.push({
        id, name, homeCity: "miami", state: "normal", joinedAt: w.clock.now(), age: 30, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      w.presence.push({ memberId: id, city: "miami", type: "home", areas: [area] });
    }
    await w.say("m1", "Hi! I'm 30, based in Brickell.");
    await w.say("m1", "I live in Brickell, usually free weekday evenings, small groups are great, love tennis and looking to meet founders.");
    expect(w.net.exportState().members.find(m => m.id === "m1")?.stage).toBe("active");

    await w.onboard("m2");
    const oppId = w.propose(["m1", "m2"], { category: "social", objective: "Coffee catch-up" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    await w.answerProbes(["m1", "m2"]);
    const opp = w.net.opps.get(oppId)!;
    expect(opp.stage).toBe("scheduled");

    // Direct-reply ack on booked confirmation
    const m1BeforeConfirm = w.to("m1").length;
    await w.say("m1", "sounds good, see you there!");
    expect(w.to("m1").length).toBe(m1BeforeConfirm + 1);

    // T-70m pre-brief still delivers to BOTH members (Blooio streak preserved)
    w.clock.set(opp.meetingAt! - 70 * MINUTE);
    await w.net.tick(w.clock.now());
    const briefs = w.sent.filter(s => s.meta.proposalId === oppId && s.meta.type === "reminder" && /Heads up for/i.test(s.body));
    expect(briefs).toHaveLength(2);

    // On-site arrival cue gets a direct arrival_ack (and resets conversation streak)
    w.clock.set(opp.meetingAt! - 10 * MINUTE);
    const m1BeforeArrival = w.to("m1").length;
    await w.say("m1", "Just got here!");
    expect(w.to("m1").length).toBeGreaterThan(m1BeforeArrival);

    // Post-meetup feedback gets a direct acknowledgement reply
    w.clock.set(opp.meetingAt! + 2 * HOUR);
    await w.net.tick(w.clock.now());
    w.clock.set((opp.followupAt ?? opp.meetingAt! + 24 * HOUR) + HOUR);
    await w.run(2 * HOUR);
    const m1BeforeFb = w.to("m1").length;
    await w.say("m1", "vibes were immaculate, definitely down again");
    expect(w.to("m1").length).toBeGreaterThan(m1BeforeFb);
  });
});
