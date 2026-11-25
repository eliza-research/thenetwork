import { expect, test } from "vitest";
import { resolve } from "node:path";
import { DAY, HOUR } from "@thenetwork/core";
import { localEmbed, resolveConfig, runEngine, World as EngineWorld } from "@thenetwork/engine";
import { memberReason } from "../../engine/src/filters.ts";
import { loadScenario, scenarioWorldOptions, type Scenario } from "../src/scenario.ts";
import { networkStateFromRecords, type SimSnapshot } from "../src/snapshot.ts";
import { StubNetwork } from "../src/stubNetwork.ts";
import { DEFAULT_START, World } from "../src/world.ts";

test("a declined invitation does not erase the remaining group's scheduled and completed meeting", async () => {
  const template = await loadScenario(resolve(import.meta.dirname, "../scenarios/group-flake-morning-of.json"));
  const actual = [], expected = [];
  for (const seed of [5, 12, 17, 118, 2, 9, 15]) {
    const s = structuredClone(template);
    s.actions = s.actions.filter(a => a.do !== "force_flake");
    const w = new World(scenarioWorldOptions(s, { seed, network: () => new StubNetwork({ randomIntros: false }), writeLog: false }));
    await w.begin(); await w.advanceTo(DEFAULT_START + 3 * DAY);
    const before = w.snapshot() as SimSnapshot;
    const scheduled = w.records.filter(r => r.type === "meeting_scheduled").at(-1)!;
    await w.advanceTo(w.end); const result = await w.complete();
    const after = w.snapshot() as SimSnapshot;
    const outcome = w.records.find(r => r.type === "outcome")!;
    const attendees = Object.entries(outcome.attendance).filter(([, a]) => a.showed).map(([id]) => id).sort();
    const history = after.interactions![0]!;
    const engine = await runEngine(after, { seed });
    const later = await runEngine({ ...after, now: DEFAULT_START + 10 * DAY }, { seed });
    const indexed = new EngineWorld(after, resolveConfig({ seed }), localEmbed);
    const refused = history.declinedBy ?? [];
    const refusalTimes = Object.fromEntries(refused.map(id => {
      const decision = w.records.find(r => r.type === "decision" && r.memberId === id && r.proposalId === history.id && r.decision === "decline")!;
      if (decision?.type !== "decision") throw new Error(`missing refusal for ${id}`);
      return [id, decision.t + decision.delayMs];
    }));
    const sentRefusals = refused.every(id => w.records.some(r => r.type === "message" && r.msg.direction === "inbound"
      && r.msg.memberId === id && r.msg.ts === refusalTimes[id]));
    const pairRefusals = refused.flatMap(a => s.personas.filter(p => p.ref !== a).map(p => {
      const b = p.ref, pair = a < b ? `${a}|${b}` : `${b}|${a}`;
      const refusal = indexed.pairInteractions.get(pair)?.find(r => r.id === history.id && r.outcome === "declined");
      return { pair, at: refusal?.at };
    }));
    const expectedPairRefusals = refused.flatMap(a => s.personas.filter(p => p.ref !== a).map(p => ({
      pair: a < p.ref ? `${a}|${p.ref}` : `${p.ref}|${a}`, at: Math.max(refusalTimes[a]!, refusalTimes[p.ref] ?? -Infinity),
    })));
    const cooldowns = Object.fromEntries(refused.map(id => [id, indexed.memberCategoryDeclines.get(id)?.get("social")]));
    const heldPairs = attendees.flatMap((a, i) => attendees.slice(i + 1).map(b =>
      indexed.pairInteractions.get(`${a}|${b}`)?.some(row => row.id === history.id && row.outcome === "completed")));
    const reproposed = (r: typeof engine) => r.proposals.filter(p => p.participants.some(id => refused.includes(id))).length;
    actual.push({ seed, scheduledOutcome: before.interactions![0]!.outcome,
      scheduledMembers: [...before.interactions![0]!.participants].sort(),
      openMembers: before.openOpportunities!.map(o => [...o.participants].sort()),
      finalOutcome: history.outcome, finalMembers: [...history.participants].sort(), at: history.at,
      declined: history.declinedBy?.length ?? 0, accepted: history.acceptedBy?.length ?? 0,
      held: result.metrics.meetings.held, heldPairs: heldPairs.every(Boolean),
      declinedAt: history.declinedAt ?? {}, sentRefusals, cooldowns, pairRefusals, reproposed: reproposed(engine), laterReproposed: reproposed(later) });
    const declines = seed === 118 ? 2 : [5, 12, 17].includes(seed) ? 1 : 0;
    expected.push({ seed, scheduledOutcome: "accepted" as const, scheduledMembers: [...scheduled.participants].sort(),
      openMembers: [[...scheduled.participants].sort()], finalOutcome: "completed" as const, finalMembers: attendees, at: outcome.at,
      declined: declines, accepted: 6 - declines, held: 1, heldPairs: true,
      declinedAt: refusalTimes, sentRefusals: true, cooldowns: refusalTimes, pairRefusals: expectedPairRefusals, reproposed: 0, laterReproposed: 0 });
  }
  expect(actual).toEqual(expected);
});

test("an expired invite cools only its recipient and a refusal uses the time it arrived", async () => {
  const scenario: Scenario = {
    name: "response-cooldowns", description: "An unanswered first invite does not penalize the uncontacted partner.",
    seed: 83, days: 5,
    personas: ["a", "b"].map(ref => ({ ref, age: 30, city: "nyc", interests: ["film", "books", "coffee"],
      desires: ["new_friends"], capacity: 1, socialEnergy: 1, join: { day: 0, hour: 9 } })),
    actions: [
      ...["a", "b"].map(persona => ({ at: { day: 0, hour: 12 }, do: "go_silent" as const, persona })),
      { at: { day: 0, hour: 13 }, do: "propose", kind: "intro", participants: ["a", "b"], objective: "coffee", city: "nyc" },
    ], expectations: [],
  };
  const check = { category: "social", role: "peer", format: "one_to_one", timeSensitive: false } as const;
  for (const decline of [false, true]) {
    const world = new World(scenarioWorldOptions(scenario, { network: () => new StubNetwork({ seed: 83, randomIntros: false }) }));
    await world.begin();
    let answeredAt: number | undefined;
    if (decline) {
      await world.advanceTo(world.clock.now() + 2 * DAY + 9 * HOUR);
      answeredAt = world.clock.now();
      world.act({ do: "say", persona: "a", text: "No thanks" });
    }
    await world.advanceTo(world.end);
    const result = await world.complete();
    const history = networkStateFromRecords(result.records, world.clock.now());
    const input = { ...world.snapshot(), ...history };
    const indexed = new EngineWorld(input, resolveConfig(), localEmbed);
    expect(memberReason(indexed, "b", check)).toBeNull();
    expect(memberReason(indexed, "a", check)).toBe("category_cooldown");
    const record = history.interactions[0]!;
    if (answeredAt !== undefined) {
      expect(record.at).toBe(answeredAt);
      const later = new EngineWorld({ ...input, now: answeredAt + 6 * DAY }, resolveConfig(), localEmbed);
      expect(memberReason(later, "a", check)).toBe("category_cooldown");
    } else {
      expect(record.noResponse).toEqual(["a"]);
      const none = new EngineWorld({ ...input, interactions: [{ ...record, noResponse: [] }] }, resolveConfig(), localEmbed);
      expect(none.memberCategoryDeclines.size).toBe(0);
      const legacy = { ...record };
      delete legacy.noResponse;
      const old = new EngineWorld({ ...input, interactions: [legacy] }, resolveConfig(), localEmbed);
      expect([...old.memberCategoryDeclines.keys()].sort()).toEqual(["a", "b"]);
    }
  }
});
