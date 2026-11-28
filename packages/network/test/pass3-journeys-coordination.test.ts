import { describe, expect, test } from "vitest";
import {
  ALL_SEED_VENUES,
  CITY_TZ,
  DAY,
  HOUR,
  MINUTE,
  SimClock,
  cityTzLabel,
  fromLocal,
  localParts,
  seedVenuesForCity,
  type City,
  type MemberId,
  type Proposal,
} from "@thenetwork/core";
import { friendsKit } from "@thenetwork/engine";
import { outputLeaks } from "../../mcp/src/leaks.ts";
import { APPS } from "../../platform/src/apps.ts";
import {
  ConsentNetwork,
  MeetupCoordinator,
  VenueManager,
  availabilityTags,
  classify,
  copyFor,
  extractRedLineTags,
  parseProbeReply,
  plansPlaceQuestionForCity,
  publicPlanLocation,
  simulatedReviewJudge,
  statedWindows,
  statesImmediateDanger,
  type MeetupCoordHost,
  type NetworkOptions,
} from "../src/index.ts";
import { parseRescheduleCommand } from "../src/rescheduling.ts";
import { venueBookingLink } from "../src/venue-booking-link.ts";
import { memberFactCommand } from "../service/member-fact-command.ts";
import { participationCommand } from "../service/participation-controls.ts";
import { profileReadRequest, savedProfileText } from "../service/profile-read.ts";
import { soloConciergeRequest } from "../service/solo-concierge.ts";
import { travelPresenceCommand } from "../service/travel-presence.ts";
import { Mini, START } from "./mini.ts";

function sfWorld(
  specs: Array<{ id: MemberId; name: string; age?: number; area?: string; interests?: string[] }>,
  opts: NetworkOptions = {}
): Mini {
  const w = new Mini([], {
    city: "sf",
    engine: { cities: ["sf"], ...opts.engine },
    ...opts,
  });
  for (const s of specs) {
    w.members.push({
      id: s.id,
      name: s.name,
      homeCity: "sf",
      state: "normal",
      joinedAt: w.clock.now(),
      age: s.age ?? 30,
      unansweredProactive: 0,
      prefs: {
        categoriesOptIn: ["social", "hobby", "professional", "events", "growth", "help"],
        quietHours: [22, 8],
        romanceOptIn: false,
        formats: ["one_to_one", "small_group", "event"],
        maxTravelMinutes: 45,
        onlyWhenAsked: false,
      },
    });
    w.presence.push({ memberId: s.id, city: "sf", type: "home", areas: [s.area ?? "Mission"] });
    for (const tag of s.interests ?? ["coffee", "hiking"]) {
      w.facets.push({
        id: `${s.id}:interest:${tag}`,
        memberId: s.id,
        kind: "interest",
        value: tag,
        tags: [tag],
        scope: "shareable",
        provenance: "said",
        confidence: 0.9,
        validFrom: w.clock.now(),
        source: "chat",
        observedAt: w.clock.now(),
        inferred: false,
        confirmedByMember: true,
      });
    }
  }
  return w;
}

function proposeInCity(w: Mini, city: City, participants: MemberId[], objective = "coffee and conversation"): string {
  const now = w.clock.now();
  const id = `pass3-${city}-${participants.join("-")}-${now}`;
  const p: Proposal = {
    id,
    kind: participants.length > 2 ? "group" : "intro",
    participants,
    alternates: [],
    objective,
    category: "social",
    city,
    window: { start: now + DAY, end: now + 5 * DAY },
    score: 0.8,
    exploration: false,
    explanations: Object.fromEntries(participants.map(m => [m, "Shared interests nearby."])),
    generator: "player",
    createdAt: now,
    components: {
      fit: 0.8,
      mutualBenefit: 0.8,
      warmPath: 0,
      novelty: 0.8,
      timingFit: 0.8,
      activationCost: 0,
      interruptionCost: 0,
      load: 0,
      repetition: 0,
      socialRisk: 0,
      confidence: 0.9,
    },
  };
  w.net.submitProposal(p);
  return id;
}

describe("Pass 3 Wave 2: Safety, multilingual consent, and under-13 refusal", () => {
  test("unanchored emergency and panic texts trigger statesImmediateDanger while benign texts do not", async () => {
    for (const danger of [
      "help he won't let me leave",
      "please call 911",
      "he's following me to my car right now",
      "I'm hiding in the bathroom",
      "llama al 911 no me deja salir",
      "he has a knife and is threatening me",
    ]) {
      expect(statesImmediateDanger(danger), danger).toBe(true);
    }

    for (const benign of [
      "I love following basketball",
      "that movie trapped me",
      "he's following me on instagram",
      "report Ben, he threatened me yesterday",
      "if someone trapped me I would call 911",
    ]) {
      expect(statesImmediateDanger(benign), benign).toBe(false);
    }

    const w = new Mini([{ id: "ana", name: "Ana", age: 29, area: "Williamsburg" }]);
    await w.onboard("ana");
    const mark = w.mark();
    await w.say("ana", "help he won't let me leave");
    const replies = w.to("ana", mark).map(m => m.body).join(" ");
    expect(replies).toContain("911");
  });

  test("Spanish, formal/senior, Gen-Z, and double-negative replies parse cleanly and Spanish under-13 is refused", async () => {
    const options = [
      { key: "a", start: 1, end: 2, label: "Thursday 7pm" },
      { key: "b", start: 3, end: 4, label: "Saturday 11am" },
      { key: "c", start: 5, end: 6, label: "Sunday 2pm" },
    ];
    expect(parseProbeReply("sí, claro", options).answer).toBe("yes");
    expect(parseProbeReply("me apunto", options).answer).toBe("yes");
    expect(parseProbeReply("no puedo", options).answer).toBe("no");
    expect(parseProbeReply("otro día", options).answer).toBe("unclear");
    expect(parseProbeReply("I would be delighted", options).answer).toBe("yes");
    expect(parseProbeReply("by all means", options).answer).toBe("yes");
    expect(parseProbeReply("certainly", options).answer).toBe("yes");
    expect(parseProbeReply("I'm afraid not", options).answer).toBe("no");
    expect(parseProbeReply("say less", options).answer).toBe("yes");
    expect(parseProbeReply("lfg", options).answer).toBe("yes");
    expect(parseProbeReply("fs", options).answer).toBe("yes");
    expect(parseProbeReply("ofc", options).answer).toBe("yes");
    expect(parseProbeReply("not not interested", options).answer).toBe("unclear");
    expect(parseProbeReply("I wouldn't say no", options).answer).toBe("unclear");
    expect(parseProbeReply("no yeah", options).answer).toBe("yes");
    expect(parseProbeReply("all good, thanks", options).answer).toBe("no");

    const esChild = classify("tengo 11 años");
    expect(esChild.statedAge).toBe(11);
    expect(esChild.minorSignal).toBe(true);

    const w = new Mini([{ id: "kid", name: "Mateo", area: "Williamsburg" }]);
    await w.say("kid", "Hola");
    await w.say("kid", "tengo 11 años");
    const state = w.net.exportState().members.find(m => m.id === "kid");
    expect(state).toBeUndefined();
    const allReplies = w.to("kid").map(m => m.body).join(" ");
    expect(allReplies).toMatch(/at least 13/i);
  });
});

describe("Pass 3 Wave 2: Live Top-1 venue pivot, red-line backups, and 5-city timezone accuracy", () => {
  test("booked venue objection pivots up to 3 red-line-safe unique spots with silent partner swap instead of dropping", async () => {
    const w = sfWorld([
      { id: "ana", name: "Ana", age: 30, area: "Mission", interests: ["coffee", "books"] },
      { id: "ben", name: "Ben", age: 31, area: "Hayes Valley", interests: ["coffee", "books"] },
    ]);
    await w.onboard("ana", "ben");
    await w.say("ana", "I'm strictly sober, no bars please.");

    const oppId = proposeInCity(w, "sf", ["ana", "ben"]);
    await w.answerProbes(["ana", "ben"]);
    expect(w.meetings.length).toBe(1);

    const opp = () => w.net.exportState().opps.find(o => o.id === oppId)!;
    expect(opp().stage).toBe("scheduled");
    const initialVenueId = opp().venueId;
    expect(initialVenueId).toBeTruthy();

    const seenIds = new Set<string>([initialVenueId!]);
    const objections = [
      "not feeling a bar, somewhere quieter",
      "too far from me, somewhere closer",
    ];
    for (const [idx, text] of objections.entries()) {
      const mark = w.mark();
      await w.say("ana", text);
      expect(opp().stage).toBe("scheduled");
      const nextId = opp().venueId!;
      expect(seenIds.has(nextId)).toBe(false);
      seenIds.add(nextId);

      const rec = ALL_SEED_VENUES.find(v => v.id === nextId);
      if (rec) {
        expect(rec.isBarOnly).toBe(false);
        expect(rec.alcoholOptional).toBe(true);
      }

      const partnerMsgs = w.to("ben", mark).map(m => m.body).join(" ");
      expect(partnerMsgs).toContain(opp().venue!);
      expect(partnerMsgs.toLowerCase()).not.toContain("sober");
      expect(w.log("venue_pivoted").length).toBe(idx + 1);
    }

    const mark3 = w.mark();
    await w.say("ana", "not feeling that spot either, try another vibe");
    expect(opp().stage).toBe("scheduled");
    expect(w.log("venue_pivot_exhausted").length).toBe(1);
    const exhaustedMsg = w.to("ana", mark3).map(m => m.body).join(" ");
    expect(exhaustedMsg.toLowerCase()).toContain("public spot");
  });

  test("5-city timezones, labels, neighborhood lookup, friendsKit geo, and venueBookingLink work outside NYC", () => {
    const nycWin = statedWindows(["evening:Thu"], START, CITY_TZ.nyc)!;
    const sfWin = statedWindows(["evening:Thu"], START, CITY_TZ.sf)!;
    expect(nycWin.windows.length).toBeGreaterThan(0);
    expect(sfWin.windows.length).toBeGreaterThan(0);
    expect(sfWin.windows[0]!.start - nycWin.windows[0]!.start).toBe(3 * HOUR);
    expect(localParts(sfWin.windows[0]!.start, CITY_TZ.sf).hour).toBe(17);

    const sfCopy = copyFor({ agent: "Friends", name: "friends.help" }, "sf");
    const laCopy = copyFor({ agent: "Friends", name: "friends.help" }, "la");
    const offerText = sfCopy.rescheduleOffer("Thursday, Oct 8, 2026 at 7:00 PM", "Friday, Oct 9, 2026 at 7:00 PM", "abcdefghijklmnop");
    const updatedText = laCopy.rescheduleUpdated("Friday, Oct 9, 2026 at 7:00 PM");
    expect(offerText).toContain("Pacific time");
    expect(offerText).not.toContain("New York time");
    expect(updatedText).toContain("Pacific time");
    expect(updatedText).not.toContain("New York time");
    expect(cityTzLabel("chicago")).toBe("Central time");
    expect(cityTzLabel("miami")).toBe("Eastern time");

    for (const [city, phrase, wantArea] of [
      ["sf", "in Mission", "Mission District"],
      ["la", "in Silver Lake", "Silver Lake"],
      ["chicago", "in West Loop", "West Loop / Fulton Market"],
      ["miami", "in Brickell", "Brickell"],
    ] as const) {
      expect(plansPlaceQuestionForCity(city)).not.toContain("NYC");
      expect(publicPlanLocation(phrase, true, city).area).toBe(wantArea);
      expect(friendsKit.hoodForCity(city, wantArea)).toBeDefined();
    }
    expect(friendsKit.transitMinutesInCity("sf", friendsKit.hoodForCity("sf", "Mission")!, friendsKit.hoodForCity("sf", "Hayes Valley")!)).toBeGreaterThan(0);
    expect(friendsKit.transitMinutesInCity("chicago", friendsKit.hoodForCity("chicago", "West Loop")!, friendsKit.hoodForCity("chicago", "River North")!)).toBeGreaterThan(0);

    const nycBooked = venueBookingLink("Té Company", "nyc");
    expect(nycBooked === undefined || typeof nycBooked === "string").toBe(true);
    const seedWithBooking = (["sf", "la", "chicago", "miami"] as const)
      .flatMap(c => seedVenuesForCity(c).map(v => ({ city: c, venue: v as typeof v & { bookingUrl?: string } })))
      .find(x => typeof x.venue.bookingUrl === "string");
    if (seedWithBooking) {
      expect(venueBookingLink(seedWithBooking.venue.name, seedWithBooking.city)).toBe(seedWithBooking.venue.bookingUrl);
    }
    expect(venueBookingLink("Nonexistent Spot", "sf")).toBeUndefined();
  });
});

describe("Pass 3 Wave 2: Natural-language scheduling, counter-proposal relay, 3->2 pivot, and day-of coordination", () => {
  test("natural-language availability tags handle relative days, after-hour, daypart exclusions, and bare evenings", () => {
    const tueTags = availabilityTags("tue after 6", START, CITY_TZ.sf);
    expect(tueTags).toContain("evening:Tue");

    const tomorrowDay = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][(localParts(START, CITY_TZ.sf).weekday + 1) % 7]!;
    const tmrwTags = availabilityTags("tomorrow afternoon", START, CITY_TZ.sf);
    expect(tmrwTags).toContain(`afternoon:${tomorrowDay}`);

    const weekendExcept = availabilityTags("free on weekends except sun morning", START, CITY_TZ.sf);
    expect(weekendExcept).toContain("morning:Sat");
    expect(weekendExcept).toContain("afternoon:Sat");
    expect(weekendExcept).toContain("evening:Sat");
    expect(weekendExcept).toContain("afternoon:Sun");
    expect(weekendExcept).toContain("evening:Sun");
    expect(weekendExcept).not.toContain("morning:Sun");

    const evenings = availabilityTags("evenings work", START, CITY_TZ.sf);
    expect(evenings.filter(t => t.startsWith("evening:")).length).toBeGreaterThanOrEqual(5);
  });

  test("1-round asymmetric counter-proposal relays partner slot once and never loops", async () => {
    const w = new Mini([
      { id: "ana", name: "Ana", age: 30, area: "Williamsburg", interests: ["coffee", "hiking"] },
      { id: "ben", name: "Ben", age: 31, area: "Williamsburg", interests: ["coffee", "hiking"] },
    ]);
    await w.onboard("ana", "ben");
    const oppId = w.propose(["ana", "ben"], { category: "social", objective: "coffee" });
    expect(await w.runUntil(() => w.probed("ana") || w.probed("ben"))).toBe(true);

    const first = w.probed("ana") ? "ana" : "ben";
    const second = first === "ana" ? "ben" : "ana";
    const firstProbe = w.to(first).at(-1)!;
    const firstSlot = firstProbe.meta.timeOptions?.[0];
    expect(firstSlot).toBeDefined();

    await w.say(first, `${firstSlot!.label} works for me`);
    expect(await w.runUntil(() => w.probed(second))).toBe(true);

    const secondMark = w.mark();
    await w.say(second, "neither of those works, how about Sunday 2pm?");
    expect(w.log("counter_proposal_relayed").length).toBe(1);
    const relayedOpp = w.net.exportState().opps.find(o => o.id === oppId)!;
    expect(relayedOpp.counterProposed).toBe(true);
    expect(w.probed(first)).toBe(true);
    expect(w.to(first, secondMark).length).toBeGreaterThan(0);

    await w.say(first, "neither works, how about Monday 7pm?");
    expect(w.log("counter_proposal_relayed").length).toBe(1);
    const closedOpp = w.net.exportState().opps.find(o => o.id === oppId)!;
    expect(closedOpp.stage).toBe("closed");
  });

  test("booked 3->2 drop queues an opt-in 1:1 pivot, and MeetupCoordinator supports scoped removeMember, venue_full pivot, and T-60m late ETA", async () => {
    const w = new Mini([
      { id: "ana", name: "Ana", age: 30, area: "Williamsburg", interests: ["climbing", "coffee"] },
      { id: "ben", name: "Ben", age: 31, area: "Williamsburg", interests: ["climbing", "coffee"] },
      { id: "cy", name: "Cy", age: 29, area: "Williamsburg", interests: ["climbing", "coffee"] },
    ]);
    await w.onboard("ana", "ben", "cy");
    const groupId = w.propose(["ana", "ben", "cy"], { category: "hobby", objective: "climbing" });
    await w.answerProbes(["ana", "ben", "cy"]);
    expect(w.meetings.length).toBe(1);

    await w.say("cy", "I can't make it anymore");
    const orig = w.net.exportState().opps.find(o => o.id === groupId)!;
    expect(orig.stage).toBe("closed");
    const pivotLogs = w.log("group_two_person_pivot_queued");
    expect(pivotLogs).toHaveLength(1);
    expect(pivotLogs[0]!.detail.participants).toEqual(["ana", "ben"]);

    const venues = new VenueManager();
    const sfList = venues.listVenues("sf");
    const primary = sfList[0]!;
    const backup = sfList[1]!;
    const startMs = Date.UTC(2026, 9, 10, 20, 0);
    const sent: Array<{ to: MemberId; body: string; kind: string }> = [];
    const host: MeetupCoordHost = {
      venues,
      ratesPhotos: false,
      party: (_meetupId, id) => ({
        id,
        firstName: id === "ana" ? "Ana" : id === "ben" ? "Ben" : "Cy",
        age: 30,
        confirmed: true,
        optedOut: false,
      }),
      blocked: () => false,
      privateFacts: () => ({ forbidden: [], canaries: [] }),
      send: (to, body, meta) => sent.push({ to, body, kind: meta.kind }),
    };

    const coord = new MeetupCoordinator(host);
    coord.registerMeetup({
      meetupId: "m1",
      oppId: "opp1",
      app: "friends",
      city: "sf",
      startMs,
      participants: ["ana", "ben"],
      confirmed: ["ana", "ben"],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
      venueName: primary.name,
      venueAddress: primary.address,
      arrivalLandmark: primary.arrivalLandmark,
    });
    coord.registerMeetup({
      meetupId: "m2",
      oppId: "opp2",
      app: "friends",
      city: "sf",
      startMs: startMs + 3 * HOUR,
      participants: ["ana", "cy"],
      confirmed: ["ana", "cy"],
      primaryVenueId: primary.id,
      backupVenueId: backup.id,
      venueName: primary.name,
      venueAddress: primary.address,
      arrivalLandmark: primary.arrivalLandmark,
    });

    const earlyLate = coord.handleInbound("ana", "running 15 mins late", startMs - 50 * MINUTE, "m1");
    expect(earlyLate.handled).toBe(true);
    expect(earlyLate.state).toBe("late");
    expect(earlyLate.relayedTo).toEqual(["ben"]);
    expect(sent.some(m => m.to === "ben" && /15/.test(m.body))).toBe(true);

    const fullPivot = coord.handleInbound("ana", "this place is completely packed, no tables left", startMs - 5 * MINUTE, "m1");
    expect(fullPivot.handled).toBe(true);
    expect(fullPivot.state).toBe("venue_full");
    expect(fullPivot.pivotedToVenueId).toBe(backup.id);
    expect(venues.getVenue(primary.id)?.status).toBe("active");

    coord.removeMember("ana", "m1");
    const exported = coord.exportState();
    expect(exported.meetups.find(m => m.meetupId === "m1")?.closed).toBe(true);
    const m2 = exported.meetups.find(m => m.meetupId === "m2")!;
    expect(m2.closed).toBe(false);
    expect(m2.confirmed).toEqual(["ana", "cy"]);
  });
});

describe("Pass 3 Wave 2: MCP red-lines, anti-double-ping, reschedule, survey, and SMS commands", () => {
  test("MCP submit_profile persists red-line facets with zero unsolicited SMS double-ping and outputLeaks catches Pass 3 IDs", async () => {
    const redLines = extractRedLineTags("I keep halal, I'm strictly sober, severe peanut allergy, and I need wheelchair access.");
    expect(redLines).toEqual(expect.arrayContaining(["halal", "strict_sober", "severe_allergen", "wheelchair"]));

    const w = sfWorld([{ id: "mcp1", name: "Sam", age: 30, area: "Mission" }]);
    await w.say("mcp1", "hi!");
    const mark = w.mark();
    await w.net.onInbound({
      id: "mcp-turn-1",
      memberId: "mcp1",
      body: "I enjoy hiking and coffee. I keep halal, I'm strictly sober, have a severe peanut allergy, and need wheelchair access.",
      ts: w.clock.now() + MINUTE,
      channel: "sms",
      source: "mcp",
    });

    expect(w.to("mcp1", mark)).toHaveLength(0);
    expect(w.net.memberRedLines("mcp1")).toEqual(
      expect.arrayContaining(["halal", "strict_sober", "severe_allergen", "wheelchair"])
    );
    const nextQ = w.net.nextOnboardingQuestion("mcp1");
    expect(nextQ?.text.length).toBeGreaterThan(0);

    const snap = w.net.engineInput(w.clock.now());
    const exportedRedLines = snap.facets.filter(
      f => f.memberId === "mcp1" && f.scope === "agent_private" && f.source === "ai_memory"
    );
    expect(exportedRedLines.length).toBeGreaterThanOrEqual(4);

    for (const id of ["vv_9k2m1", "ma_7x8y9", "rsvp_4a5b6", "ep_1c2d3", "plan_9z8y7", "ntf_3e4f5", "ntwa_6g7h8"]) {
      expect(outputLeaks(`Status for ${id}`), id).toContain("internal_id");
    }
    expect(outputLeaks("Match is strictly halal and has a peanut allergy").length).toBeGreaterThan(0);
  });

  test("natural-language reschedule, bare YES/NO interruption survey, and human-friendly SMS commands work alongside canonical forms", async () => {
    const now = fromLocal(2026, 10, 6, 12, CITY_TZ.sf);
    const thu7pm = fromLocal(2026, 10, 8, 19, CITY_TZ.sf);
    const fri7pm = fromLocal(2026, 10, 9, 19, CITY_TZ.sf);

    const resched = parseRescheduleCommand("move Thursday to Friday at 7", CITY_TZ.sf, {
      now,
      bookings: [{ meetingAt: thu7pm }],
    });
    expect(resched).toEqual({ kind: "request", originalAt: thu7pm, proposedAt: fri7pm });

    const bareVote = parseRescheduleCommand("YES", CITY_TZ.sf, {
      now,
      pendingOfferRefs: ["abcdefghijklmnop"],
    });
    expect(bareVote).toEqual({ kind: "vote", accepted: true, ref: "abcdefghijklmnop" });

    const w = new Mini([
      { id: "ana", name: "Ana", age: 30, area: "Williamsburg" },
      { id: "ben", name: "Ben", age: 31, area: "Williamsburg" },
    ]);
    await w.onboard("ana", "ben");
    const oppId = w.propose(["ana", "ben"]);
    await w.run(HOUR);
    const state = w.net.exportState();
    const anaState = state.members.find(m => m.id === "ana")!;
    const benState = state.members.find(m => m.id === "ben")!;
    anaState.interruptionSurvey = { opportunityId: oppId, answeredAt: w.clock.now() - HOUR, sentAt: w.clock.now() };
    benState.interruptionSurvey = { opportunityId: oppId, answeredAt: w.clock.now() - HOUR, sentAt: w.clock.now() };
    delete anaState.awaiting;
    delete benState.awaiting;
    w.net.importState(state);

    const markAna = w.mark();
    await w.say("ana", "YES");
    expect(w.to("ana", markAna).some(m => m.body === "Thanks for the feedback.")).toBe(true);
    await w.say("ben", "NO");
    expect(w.log("interruption_feedback").map(l => l.detail.worthwhile)).toEqual([true, false]);

    const travel = travelPresenceCommand("I'm visiting SF May 10-14", fromLocal(2026, 4, 1, 12, CITY_TZ.sf));
    expect(travel?.city).toBe("sf");
    expect(travel?.dates?.from).toBe("2026-05-10");
    expect(travel?.dates?.to).toBe("2026-05-15");

    expect(participationCommand("quiet hours 10:30pm to 7:30am")).toEqual({ kind: "quiet", hours: [22.5, 7.5] });
    expect(participationCommand("pause me for a week")).toEqual({ kind: "mode", pause: true, durationDays: 7 });
    expect(participationCommand("pause my texts until Monday")).toEqual({ kind: "mode", pause: true, untilWeekday: 0 });
    expect(participationCommand("pause matching until Friday")).toEqual({ kind: "mode", pause: true, untilWeekday: 4 });
    expect(participationCommand("take a break until tomorrow")).toEqual({ kind: "mode", pause: true, untilTomorrow: true });
    expect(participationCommand("she said pause my texts until Monday")).toBeUndefined();
    expect(participationCommand("pause my texts until Monday?")).toBeUndefined();
    expect(participationCommand("no more work stuff")).toEqual({ kind: "category", category: "professional", enable: false });

    expect(memberFactCommand("what do you know about me")).toEqual({ kind: "list", page: 1 });
    expect(memberFactCommand("edit fact 2 to coffee in Mission")).toEqual({
      kind: "correct",
      ref: "2",
      value: "coffee in Mission",
    });
    expect(memberFactCommand("set fact scope #1 to private")).toEqual({
      kind: "scope",
      ref: "1",
      scope: "agent_private",
    });
    expect(memberFactCommand("delete fact 3")).toEqual({ kind: "remove", ref: "3" });

    expect(profileReadRequest("check my profile")).toBeDefined();
    expect(profileReadRequest("what's on my profile")).toBeDefined();
    const longProfile = savedProfileText(
      APPS.friends,
      {
        app: "friends",
        personId: "p1",
        memberId: "m1",
        state: "active",
        review: null,
        firstName: "Maya",
        profile: {
          homeCity: "sf",
          neighborhood: "Mission",
          about: "Enjoys long weekend trail runs and pour-over coffee. ".repeat(60),
          interests: ["coffee", "hiking", "pottery", "books", "running", "cooking", "chess"],
        },
        joinedAt: now,
        leftAt: null,
      },
      31
    );
    expect(longProfile.length).toBeLessThanOrEqual(1600);
    expect(longProfile).not.toContain("too long for one text");

    const solo = soloConciergeRequest("anything fun tonight in Mission", "sf");
    expect(solo).toMatchObject({ period: "tonight", area: "Mission District", mentioned: true });
  });
});
