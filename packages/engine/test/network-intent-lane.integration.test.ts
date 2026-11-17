import { DAY, EngineRng, type Intent } from "@thenetwork/core";
import { expect, test } from "vitest";
import { cofounderIntentDetails, cofounderIntentObjective } from "../../core/src/generated/cofounderIntent.ts";
import { resolveConfig } from "../src/config.ts";
import { localEmbed } from "../src/embed.ts";
import { intentToCapability, warmPath } from "../src/packs/network/generators.ts";
import { baseMember, emptyInput, facet } from "../src/testkit.ts";
import type { EngineInput } from "../src/types.ts";
import { World } from "../src/world.ts";

function workPair(ask: string, counterparty: string, intentData: Partial<Intent> = {}): EngineInput {
  const input = emptyInput();
  for (const [id, objective] of [["asker", ask], ["partner", counterparty]]) {
    input.members.push(baseMember(id));
    input.intents.push({ id: `intent-${id}`, memberId: id, objective, category: "professional", horizonDays: 14, status: "active", createdAt: input.now - DAY, ...intentData });
    const skills = ["fundraising", "design", "software"];
    input.facets.push(
      facet(id, 0, "offer", "Work experience I can share", skills),
      facet(id, 1, "desire", "Work experience I seek", skills, "matchable"),
      facet(id, 2, "interest", "Software and startups", ["software", "startups"]),
    );
  }
  return input;
}

function match(input: EngineInput) {
  const w = new World(input, resolveConfig({ maxPerIntent: 1 }), localEmbed);
  const unmatchedIntents = new Set<string>();
  const ctx = { w, rng: new EngineRng(1), memberExclusions: {}, unmatchedIntents };
  return { w, unmatchedIntents, proposals: intentToCapability(ctx), warm: warmPath(ctx) };
}

test.each([
  ["Find a mentor", "Mentor someone earlier in their career", "Mentor", { asker: "seeker", partner: "provider" }],
  ["Raise money for my company", "Meet founders to invest in", "Invest", { asker: "seeker", partner: "provider" }],
  ["Meet people in my field while my cofounder travels", "Meet people doing similar work", "Intro", { asker: "peer", partner: "peer" }],
  ["Find investors", "Find investors", undefined, undefined],
  ["Find a mentor", "Find a mentor", undefined, undefined],
] as const)("routes %s with %s to %s", (ask, counterparty, lane, roles) => {
  const { proposals, unmatchedIntents } = match(workPair(ask, counterparty));
  if (!lane) {
    expect(proposals).toEqual([]);
    expect(unmatchedIntents).toEqual(new Set(["intent-asker", "intent-partner"]));
    return;
  }
  expect(proposals).toEqual([
    expect.objectContaining({ lane, roles, kind: "intro", anchor: { type: "intent", id: expect.stringMatching(/^intent-(asker|partner)$/) } }),
  ]);
  expect(proposals[0]?.participants.toSorted()).toEqual(["asker", "partner"]);
});

test("structured partner skills preserve the member's stated lane", () => {
  const { w, proposals } = match(workPair("Get feedback on a pitch deck", "Meet people doing similar work",
    { details: "format: one_to_one; tags: startups,pitch_feedback,fundraising" }));
  expect(w.match.profilesOf("asker").map(p => `${p.lane}/${p.side}`)).toEqual(["Friend/Peer", "Intro/Peer"]);
  expect(proposals).toEqual([expect.objectContaining({ lane: "Intro", roles: { asker: "peer", partner: "peer" }, kind: "intro" })]);
});

const signed: Partial<Intent> = { app: "ntwrk", details: cofounderIntentDetails };
const cofounderPair = () => workPair(cofounderIntentObjective, cofounderIntentObjective, signed);

test("scoped Cofounder search keeps the requester and both exact grants on its direct introduction", () => {
  const input = cofounderPair();
  input.standingIntentSearch = ["intent-partner"];
  const { proposals, warm } = match(input);
  expect(proposals).toEqual([expect.objectContaining({
    lane: "Cofounder", kind: "intro", anchor: { type: "intent", id: "intent-partner" },
    cofounderIntents: { asker: "intent-asker", partner: "intent-partner" },
  })]);
  expect(warm).toEqual([]);
});

test.each([
  { details: undefined }, { app: undefined }, { app: "peon" }, { status: "closed" }, { horizonDays: 0 },
] satisfies Partial<Intent>[])("a peer with an ineligible Cofounder request cannot match: %j", changes => {
  const input = cofounderPair();
  input.intents[1] = { ...input.intents[1]!, ...changes };
  input.facets.push(facet("partner", 3, "goal", cofounderIntentObjective, ["lane:Cofounder"], "matchable"));

  const { w, proposals } = match(input);
  expect(w.match.profilesOf("partner").some(p => p.lane === "Cofounder")).toBe(false);
  expect(proposals).toEqual([]);
});

test("a private or cross-app skill cannot make the reciprocal Cofounder exchange", () => {
  const input = cofounderPair();
  input.facets = input.facets.map(f => f.kind !== "offer" ? f
    : f.memberId === "asker" ? { ...f, app: "peon" } : { ...f, scope: "agent_private" });
  expect(match(input).proposals).toEqual([]);
});

// packages/engine/src/genkit.ts, pairCandidate: a pair's evidence is the facets that ground its pair
// value (tags that make the complement and affinity hits), shareable first, at most two per member.
// Scoring reads their provenance as confidence; explanations show only the shareable ones.
test("a lane candidate cites the facets that ground its pair value", () => {
  const { proposals } = match(workPair("Meet people in my field while my cofounder travels", "Meet people doing similar work"));
  expect(proposals).toEqual([expect.objectContaining({ lane: "Intro" })]);
  expect(proposals[0]?.evidence).toEqual({ asker: ["asker-f0", "asker-f2"], partner: ["partner-f0", "partner-f2"] });
});
