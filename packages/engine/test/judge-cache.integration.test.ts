import { DAY, type ChatMessage, type ChatOptions, type LLM } from "@thenetwork/core";
import { expect, test } from "vitest";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { runEngine, type EngineDeps } from "../src/engine.ts";
import { JudgeCache, judgeCandidates, type JudgeRunStats } from "../src/judge.ts";
import { RUBRIC_KEYS } from "../src/judgeDeep.ts";
import { isEntityId } from "../src/match/profile.ts";
import { networkPack } from "../src/packs/network/index.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { Candidate, JudgeVerdict, MatchingRunLog } from "../src/types.ts";
import { World } from "../src/world.ts";

const candidate: Candidate = {
  key: "two-climbers", kind: "intro", generator: "intent_to_capability", category: "hobby",
  participants: ["ada", "grace"], roles: { ada: "peer", grace: "peer" }, format: "one_to_one", objective: "Go climbing",
  city: "sf", channels: new Set(), evidence: {}, fit: 1, benefit: {}, warm: 0, alternates: [], exploration: false,
  safetyClass: "low", timeSensitive: false, riskText: "climbing", lane: "Friend",
};

function mockJudge() {
  const requests: { messages: ChatMessage[]; options?: ChatOptions }[] = [];
  const llm: LLM = { chat: async (messages, options) => {
    requests.push({ messages, options });
    const accepts = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`P${i + 1}`, 0.8]));
    const why = Object.fromEntries(Object.keys(accepts).map(ref => [ref, ref === "P1" ? "Practice belaying" : "Go climbing"]));
    return JSON.stringify({ steelman_for: "Both members climb.", steelman_against: "They may prefer different routes.",
      reasoning: "Both members are interested in climbing.", verdict: "yes", match_probability: 0.8,
      fit: 4, mutual_value: 4, capacity_realism: 4, timing: 4, social_comfort: 4, red_flags: 4, certainty: 4,
      dealbreaker: false, why, member_why: why, accept_probability: accepts,
      rubric: Object.fromEntries(RUBRIC_KEYS.map(key => [key, 4])) });
  } };
  return { llm, requests };
}

async function judge(w: World, c: Candidate, llm: LLM, cache: JudgeCache, model = "fixed-model") {
  const stats: JudgeRunStats = { calls: 0, failures: 0, cacheHits: 0 };
  const log: MatchingRunLog["judge"]["verdicts"] = [];
  const result = await judgeCandidates(w, [c], llm, cache, stats, log, model);
  const row = log[0];
  if (!row) throw new Error("expected a judgment log row");
  return { verdict: result.get(c.key), row, stats };
}

test("rubric cache reuse requires exact prompt, settings and provider identity", async () => {
  // spec/judgmentAttempt.md, "An expired entry or a backward clock reading forces a request"
  const input = emptyInput();
  input.members.push(baseMember("ada"), baseMember("grace"));
  for (const member of input.members) {
    input.facets.push({ ...facet(member.id, 0, "interest", "Climbing", ["climbing"]), observedAt: input.now - DAY });
  }
  const limits = resolveConfig({});
  const firstWorld = new World(input, limits, localEmbed);
  const nextWorld = new World({ ...input, now: input.now + DAY }, limits, localEmbed);
  const differentTokens = new World(input, resolveConfig({ judge: { maxTokens: limits.judge.maxTokens + 1 } }), localEmbed);
  const { llm, requests } = mockJudge();
  const cache = new JudgeCache(7 * DAY);

  const first = await judge(firstWorld, candidate, llm, cache);
  expect(first.stats).toEqual({ calls: 1, failures: 0, cacheHits: 0 });
  if (!first.verdict) throw new Error("expected a decoded verdict");
  first.verdict.why.ada = "overwritten log";
  const repeat = await judge(firstWorld, candidate, llm, cache);
  expect(repeat.stats.cacheHits).toBe(1);
  expect(repeat.verdict?.why.ada).toBe("Practice belaying");

  for (const m of input.members) expect(nextWorld.get(m.id)?.revision).toBe(firstWorld.get(m.id)?.revision);
  expect((await judge(nextWorld, candidate, llm, cache)).stats.calls).toBe(1);
  expect(requests[1]?.messages).not.toEqual(requests[0]?.messages);
  expect((await judge(differentTokens, candidate, llm, cache)).stats.calls).toBe(1);
  expect(requests[2]?.messages).toEqual(requests[0]?.messages);
  expect(requests[2]?.options?.maxTokens).toBe(limits.judge.maxTokens + 1);

  const other = mockJudge();
  expect((await judge(firstWorld, candidate, other.llm, cache)).stats.calls).toBe(1);
  expect((await judge(firstWorld, candidate, other.llm, cache, "other-model")).stats.calls).toBe(1);
  expect(requests).toHaveLength(3);
  expect(other.requests).toHaveLength(2);
});

test("rubric cache binds pseudonyms and proposal entities even when provider messages are identical", async () => {
  // spec/judgmentAttempt.md, "Only a returned judgment is eligible for storage"
  const input = emptyInput();
  input.members.push(baseMember("ada"), baseMember("grace"));
  const baseJudge = networkPack.judge;
  if (!baseJudge) throw new Error("missing Network judge");
  const worldFor = (refs: Record<string, string>) => new World(input, resolveConfig({}), localEmbed, {
    ...networkPack, judge: { ...baseJudge, buildContext: () => ({ context: { objective: "Go climbing" }, refs }) },
  });
  const w = worldFor({ P1: "ada", P2: "grace" });
  const reversedRefs = worldFor({ P1: "grace", P2: "ada" });
  const entity = "separate-entity";
  if (!isEntityId(entity)) throw new Error("invalid entity fixture");
  const { llm, requests } = mockJudge();
  const cache = new JudgeCache(7 * DAY);

  const first = await judge(w, candidate, llm, cache);
  const rebind = await judge(reversedRefs, candidate, llm, cache);
  const otherEntity = await judge(w, { ...candidate, entities: { ada: entity } }, llm, cache);
  expect(requests).toHaveLength(3);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[2]).toEqual(requests[0]);
  expect(new Set([first.row.cacheKey, rebind.row.cacheKey, otherEntity.row.cacheKey]).size).toBe(3);
  expect(rebind.verdict?.why).toEqual({ ada: "Go climbing", grace: "Practice belaying" });
});

test("a cache sweep expires unvisited entries and an older run leaves later verdicts intact", async () => {
  // spec/judgmentAttempt.md, "An expired entry or a backward clock reading forces a request"
  const input = emptyInput();
  input.members.push(baseMember("ada"), baseMember("grace"));
  const baseJudge = networkPack.judge;
  if (!baseJudge) throw new Error("missing Network judge");
  const pack = { ...networkPack, judge: { ...baseJudge,
    buildContext: () => ({ context: { objective: "Go climbing" }, refs: { P1: "ada", P2: "grace" } }) } };
  const worldAt = (now: number) => new World({ ...input, now }, resolveConfig({}), localEmbed, pack);
  const { llm } = mockJudge();
  const cache = new JudgeCache<JudgeVerdict>(DAY);
  const earlyAt = input.now;
  const laterAt = earlyAt + DAY;
  const unrelated = { ...candidate, objective: "Another plan", anchor: { type: "event", id: "other" } } satisfies Candidate;

  await judge(worldAt(earlyAt), unrelated, llm, cache);
  const later = await judge(worldAt(laterAt), candidate, llm, cache);
  expect(cache.size).toBe(1);
  expect((await judge(worldAt(earlyAt), candidate, llm, cache)).stats.calls).toBe(1);
  expect((await judge(worldAt(laterAt), candidate, llm, cache)).stats.cacheHits).toBe(1);
  const expired = await judge(worldAt(laterAt + DAY), candidate, llm, cache);
  expect(expired.row.cacheKey).toBe(later.row.cacheKey);
  expect(expired.stats.calls).toBe(1);
});

test("matching reuses all three judgments for a stable run without bypassing hard filters", async () => {
  // spec/judgmentAttempt.md, "Only a returned judgment is eligible for storage"
  const input = emptyInput();
  for (const id of ["ada", "grace", "margaret", "katherine", "dorothy", "joan"]) {
    input.members.push(baseMember(id));
    input.presence.push({ memberId: id, type: "home", city: "sf", areas: ["mission"] });
    input.facets.push(facet(id, 0, "interest", "Climbing", ["climbing"]), facet(id, 1, "skill", "Belaying", ["belaying", "climbing"]));
    input.intents.push({ id: `${id}-intent`, memberId: id, status: "active", category: "hobby",
      objective: "Find a climbing partner", createdAt: input.now - DAY, horizonDays: 14 });
  }
  const { llm, requests } = mockJudge();
  const cfg = { judge: { screen: { enabled: true }, deep: { enabled: true } } };
  const deps: EngineDeps = { llm, judgeCache: new JudgeCache(7 * DAY), screenCache: new JudgeCache(7 * DAY), deepCache: new JudgeCache(7 * DAY) };
  const first = await runEngine(input, cfg, deps);
  const calls = requests.length;
  expect(first.runLog.judge.screen?.calls).toBeGreaterThan(0);
  expect(first.runLog.judge.calls).toBeGreaterThan(0);
  expect(first.runLog.judge.deep?.calls).toBeGreaterThan(0);
  const repeated = await runEngine(input, cfg, deps);
  expect(repeated.runLog.judge.screen?.cacheHits).toBe(first.runLog.judge.screen?.calls);
  expect(repeated.runLog.judge.cacheHits).toBe(first.runLog.judge.calls);
  expect(repeated.runLog.judge.deep?.cacheHits).toBe(first.runLog.judge.deep?.calls);
  expect(requests).toHaveLength(calls);
  expect(repeated.proposals).toEqual(first.proposals);

  const [from, to] = first.proposals[0]?.participants ?? [];
  if (!from || !to) throw new Error("expected a judged pair or group");
  input.edges.push({ from, to, type: "blocked", explicit: true, strength: 1, createdAt: input.now });
  const blocked = await runEngine(input, cfg, deps);
  expect(blocked.proposals.every(p => !(p.participants.includes(from) && p.participants.includes(to)))).toBe(true);
});
