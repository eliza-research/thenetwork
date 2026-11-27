import { CITY_IDS, CITY_TZ, DAY, HOUR, MINUTE } from "../../packages/core/src/index.ts";
import { copy, timezoneLabel } from "../../packages/network/src/copy.ts";
import { describeBookingStart } from "../../packages/network/src/rescheduling.ts";
import { Mini } from "../../packages/network/test/mini.ts";
import { formatTranscripts, runFiveCitySuite } from "../../packages/sim/src/fiveCitySuite.ts";
import { generatePersonas } from "../../packages/sim/src/generator.ts";
import { buildSnapshot } from "../../packages/sim/src/snapshot.ts";
import { runFriendsWorld } from "../../packages/sim/src/apps/friends/world.ts";
import { friendsPackMatcher } from "../../packages/sim/src/apps/friends/packMatcher.ts";
import { generateSlopPersonas } from "../../packages/sim/src/apps/slop/persona.ts";
import { generatePeonPopulation } from "../../packages/sim/src/apps/peon/persona.ts";
import { Block, digest, expect } from "./gate.ts";

export async function fiveCityBlock(b: Block, opts: { quick?: boolean; transcripts?: boolean } = {}): Promise<void> {
  const res = await runFiveCitySuite({ seed: 42, perCity: 30 });
  const repeat = await runFiveCitySuite({ seed: 42, perCity: 30 });

  b.track("fingerprint: five-city suite (seed 42)", true, digest(res));

  await b.run("determinism: repeated run with same seed produces identical output", () => {
    expect(JSON.stringify(repeat)).toBe(JSON.stringify(res));
  });

  await b.run("population: all 5 cities populated (>=25/city), >=60 curated venues, >=25 impromptu events", () => {
    for (const city of CITY_IDS) {
      expect(res.population.byCity[city]).toBeGreaterThanOrEqual(25);
      expect(res.population.eventsByCity[city]).toBeGreaterThanOrEqual(5);
    }
    expect(res.population.curatedVenues).toBeGreaterThanOrEqual(60);
    expect(res.population.minors).toBeGreaterThanOrEqual(15);
  });

  await b.run("modularity: generator, publicEvents, slop, peon and friends worlds support all 5 cities", () => {
    const ps = generatePersonas({ n: 100, seed: 7, cities: CITY_IDS });
    const present = new Set(ps.map(p => p.homeCity));
    for (const city of CITY_IDS) expect(present.has(city)).toBe(true);
    const now = Date.UTC(2026, 9, 5, 7);
    const snap = buildSnapshot(ps, {
      now,
      worldStart: now,
      joined: new Map(ps.map(p => [p.id, now])),
      optedOut: new Set(),
      blocks: [],
      unanswered: new Map(),
      recentProposals: [],
    });
    const eventCities = new Set((snap.events ?? []).map(e => e.city));
    for (const city of CITY_IDS) expect(eventCities.has(city)).toBe(true);

    const slopPs = generateSlopPersonas({ seed: 7, perCity: 10, cities: CITY_IDS });
    for (const city of CITY_IDS) expect(slopPs.some(p => p.hidden.homeCity === city)).toBe(true);

    const peonPop = generatePeonPopulation({ seed: 7, perCity: 10, jobsPerCity: 4, cities: CITY_IDS });
    for (const city of CITY_IDS) expect(peonPop.candidates.some(c => c.market === city)).toBe(true);

    for (const city of CITY_IDS) {
      const fw = runFriendsWorld({ seed: 7, city, n: 60, weeks: opts.quick ? 1 : 2, matcher: friendsPackMatcher() });
      expect(fw.world.personas.length).toBe(60);
      expect(fw.flows.every(f => !f.ageRuleBroken)).toBe(true);
    }
  });

  for (const s of res.scenarios) {
    const failedChecks = s.checks.filter(c => !c.pass).map(c => `${c.name} (${c.detail})`);
    b.gate(
      `${s.id} [${s.city}/${s.app}] ${s.title}`,
      s.pass && s.transcript.length > 0,
      s.pass ? s.summary : failedChecks.join("; ")
    );
  }

  const inv = res.invariants;
  b.gate("all 16 scenarios pass (100%)", res.passedScenarios === 16 && res.totalScenarios === 16, `${res.passedScenarios}/${res.totalScenarios}`);
  b.gate("sufficiency cutoff: 0 extra external API calls once >=10 local venues exist", inv.externalApiCallsAfterSufficiency === 0, String(inv.externalApiCallsAfterSufficiency));
  b.gate("privacy: 0 canary leaks across all transcripts and relays", inv.canaryLeaks === 0, String(inv.canaryLeaks));
  b.gate("safety: 0 minor contacts and 0 minor bar/21+ venue recs across all 5 cities", inv.minorContacts === 0 && inv.minorBarRecs === 0, `contacts=${inv.minorContacts}, barRecs=${inv.minorBarRecs}`);
  b.gate(
    "teen gates: all 8 teen policy gates equal 0",
    inv.teenAdultContact === 0 &&
      inv.teenGapContact === 0 &&
      inv.teenLaneContact === 0 &&
      inv.teenUnreadyContact === 0 &&
      inv.teenSwitchOffContact === 0 &&
      inv.teenRelayContact === 0 &&
      inv.teenGroupContact === 0 &&
      inv.teenPlaceContact === 0,
    `adult=${inv.teenAdultContact}, gap=${inv.teenGapContact}, lane=${inv.teenLaneContact}, unready=${inv.teenUnreadyContact}, switchOff=${inv.teenSwitchOffContact}, relay=${inv.teenRelayContact}, group=${inv.teenGroupContact}, place=${inv.teenPlaceContact}`
  );
  b.gate("peon: 0 physical venues assigned and 0 unsolicited video invites", inv.peonPhysicalVenues === 0 && inv.unsolicitedVideoInvites === 0, `venues=${inv.peonPhysicalVenues}, unsolicitedVideo=${inv.unsolicitedVideoInvites}`);
  b.gate("memory: 0 visited or rejected venue repeats", inv.visitedOrRejectedRepeats === 0, String(inv.visitedOrRejectedRepeats));
  b.gate("inclusivity: 0 non-drinker bar-only recommendations", inv.nonDrinkerBarRecs === 0, String(inv.nonDrinkerBarRecs));
  b.gate("attention: 0 quiet-hour violations and 0 daily-cap violations", inv.quietHourViolations === 0 && inv.dailyCapViolations === 0, `quiet=${inv.quietHourViolations}, cap=${inv.dailyCapViolations}`);
  b.gate("relay safety: all 4 unsafe arrival items stopped", inv.blockedOrHeldSafetyItems === 4, String(inv.blockedOrHeldSafetyItems));

  await b.run("pass4 multi-city timezone copy: LA/SF/Chicago/Miami never say 'New York time'", () => {
    const sampleAt = Date.UTC(2026, 9, 10, 19, 0);
    expect(timezoneLabel("America/Los_Angeles")).toBe("Pacific time");
    expect(timezoneLabel("America/Chicago")).toBe("Central time");
    expect(timezoneLabel("sf")).toBe("San Francisco time");
    expect(timezoneLabel("la")).toBe("Los Angeles time");
    expect(timezoneLabel("chicago")).toBe("Chicago time");
    expect(timezoneLabel("miami")).toBe("Miami time");
    for (const city of CITY_IDS) {
      const tz = CITY_TZ[city];
      const label = timezoneLabel(city);
      expect(label.length).toBeGreaterThan(0);
      const when = describeBookingStart(sampleAt, tz);
      const offer = copy.rescheduleOffer("Alex", when, "abcdabcdabcdabcd", label);
      const updated = copy.rescheduleUpdated(when, label);
      expect(offer).toContain(label);
      expect(updated).toContain(label);
      if (city !== "nyc") {
        expect(offer).not.toContain("New York time");
        expect(updated).not.toContain("New York time");
      }
    }
  });

  await b.run("pass4 live ConsentNetwork: natural reschedule auto-accept, venue swap without cancel, and arrival ack in SF", async () => {
    const w = new Mini([], { city: "sf", engine: { cities: ["sf"] }, arrivalBriefs: true, plans: false });
    for (const [id, name, area] of [["p1", "Maya Lin", "Mission"], ["p2", "Devon Park", "Hayes Valley"]] as const) {
      w.members.push({
        id, name, homeCity: "sf", state: "normal", joinedAt: w.clock.now(), age: 30, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social", "hobby"], quietHours: [23, 7], romanceOptIn: false, formats: ["one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false },
      });
      w.presence.push({ memberId: id, city: "sf", type: "home", areas: [area] });
    }
    await w.onboard("p1", "p2");
    const oppId = w.propose(["p1", "p2"], { category: "social", objective: "Coffee catch-up" });
    await w.runUntil(() => w.net.opps.has(oppId), 2 * DAY);
    await w.answerProbes(["p1", "p2"]);
    const opp = w.net.opps.get(oppId)!;
    expect(opp.stage).toBe("scheduled");
    const oldVenueId = opp.venueId;
    const oldMeetingAt = opp.meetingAt!;

    // 1. Venue swap on a booked meeting without canceling the date
    await w.say("p1", "That spot is too loud, somewhere quieter instead?");
    expect(w.net.opps.get(oppId)!.stage).toBe("scheduled");
    expect(w.net.opps.get(oppId)!.venueId).not.toBe(oldVenueId);
    expect(w.log("venue_swapped").length).toBe(1);

    // 2. Natural-language reschedule auto-accepts requester and offers San Francisco time (never New York time)
    const beforeOfferCount = w.to("p2").length;
    await w.say("p1", "Can we move it 1 hour later?");
    await w.run(HOUR);
    const p2Offers = w.to("p2").slice(beforeOfferCount);
    const offerMsg = p2Offers.find(m => /San Francisco time/i.test(m.body));
    expect(offerMsg).not.toBeUndefined();
    expect(offerMsg!.body).not.toContain("New York time");
    expect(w.net.exportState().opps.find(o => o.id === oppId)?.reschedule?.accepted).toEqual(["p1"]);
    await w.say("p2", "yes");
    const rescheduled = w.net.opps.get(oppId)!;
    expect(rescheduled.meetingAt).toBe(oldMeetingAt + HOUR);
    expect(rescheduled.scheduleRevision).toBe(1);

    // 3. On-site arrival relay sends direct arrival_ack to sender + relay to partner with 0 guard_blocked
    w.clock.set(rescheduled.meetingAt! - 15 * MINUTE);
    const p1Before = w.to("p1").length;
    const p2Before = w.to("p2").length;
    await w.say("p1", "On my way, running 5 min behind!");
    expect(w.to("p1").length).toBeGreaterThan(p1Before);
    expect(w.to("p2").length).toBeGreaterThan(p2Before);
    expect(w.log("guard_blocked").length).toBe(0);
  });

  if (opts.transcripts) {
    console.log("\n" + formatTranscripts(res));
  }
}
