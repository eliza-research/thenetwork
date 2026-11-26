import { CITY_IDS } from "../../packages/core/src/index.ts";
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

  if (opts.transcripts) {
    console.log("\n" + formatTranscripts(res));
  }
}
