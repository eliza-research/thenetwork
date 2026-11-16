import { describe, expect, it } from "vitest";
import { DAY, type Facet, type Intent, type Member } from "@thenetwork/core";
import { cofounderIntentDetails, cofounderIntentObjective } from "../../core/src/generated/cofounderIntent.ts";
import { runEngine } from "../src/engine.ts";
import { PEON_ENGINE_CONFIG, peonPack } from "../src/packs/peon/index.ts";
import { JOB_INTENT, SEARCH_INTENT, T } from "../src/packs/peon/schema.ts";
import type { EngineInput } from "../src/types.ts";

const now = Date.UTC(2026, 10, 16, 16);

const adult = (id: string): Member => ({
  id, name: id, age: 28, joinedAt: now - 7 * DAY, state: "normal", homeCity: "nyc", unansweredProactive: 0,
  apps: ["peon"], prefs: {
    categoriesOptIn: ["professional"], romanceOptIn: false, formats: ["one_to_one"],
    quietHours: [22, 8], maxTravelMinutes: 30, onlyWhenAsked: false,
  },
});

function facet(id: string, kind: Facet["kind"], tags: string[], scope: Facet["scope"] = "matchable"): Facet {
  return { id: `${id}:${kind}:${tags[0]}`, memberId: id, app: "peon", kind, value: tags[0]!,
    tags, scope, provenance: "said", confidence: 1, confirmedByMember: true };
}

function intent(memberId: string, objective: string, details: string): Intent {
  return { id: `${memberId}-goal`, memberId, app: "peon", objective, details, category: "professional",
    horizonDays: 60, status: "active", createdAt: now - DAY };
}

function cofounderInput(): EngineInput {
  return {
    now, members: [adult("ari"), adult("ren")], intents: ["ari", "ren"].map(id => intent(id, cofounderIntentObjective, cofounderIntentDetails)),
    facets: [facet("ari", "skill", ["design"]), facet("ren", "skill", ["fundraising"])],
    presence: [], edges: [], recentProposals: [], events: [],
  };
}

const engine = (input: EngineInput) => runEngine(input, PEON_ENGINE_CONFIG, { pack: peonPack });

describe("Peon Cofounder matchmaking", () => {
  it("selects one same-app peer introduction and binds both exact intents", async () => {
    const { proposals } = await engine(cofounderInput());
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      lane: "Cofounder", category: "professional", kind: "intro", roles: { ari: "peer", ren: "peer" },
      participants: ["ari", "ren"], alternates: [], cofounderIntents: { ari: "ari-goal", ren: "ren-goal" },
    });
    expect(JSON.stringify(proposals[0]?.explanations)).not.toMatch(/employer|interview|pay range/i);
  });

  it.each([
    ["a paused goal", (input: EngineInput) => { input.intents[1]!.status = "paused"; }],
    ["an expired goal", (input: EngineInput) => { input.intents[1]!.createdAt = now - 61 * DAY; }],
    ["a general founder goal", (input: EngineInput) => { input.intents[1]!.details = "meet other founders"; }],
    ["an intent from another app", (input: EngineInput) => { input.intents[1]!.app = "ntwrk"; }],
    ["a member of another app", (input: EngineInput) => { input.members[1]!.apps = ["ntwrk"]; }],
    ["a different market", (input: EngineInput) => { input.members[1]!.homeCity = "sf"; }],
    ["a minor", (input: EngineInput) => { input.members[1]!.age = 17; }],
    ["professional opt-out", (input: EngineInput) => { input.members[1]!.prefs.categoriesOptIn = []; }],
    ["a current safety hold", (input: EngineInput) => { input.safetyHolds = [{ memberId: "ren", from: now - DAY }]; }],
    ["a reverse block", (input: EngineInput) => { input.edges.push({ from: "ren", to: "ari", type: "blocked", strength: 1, explicit: true, createdAt: now - DAY }); }],
    ["only cross-app skill evidence", (input: EngineInput) => { input.facets[1]!.app = "ntwrk"; }],
    ["only private skill evidence", (input: EngineInput) => { input.facets[1]!.scope = "agent_private"; }],
  ] as const)("refuses %s", async (_description, change) => {
    const input = cofounderInput();
    change(input);
    expect((await engine(input)).proposals).toEqual([]);
  });

  it("keeps verified Hire distinct even when a seat has a Cofounder intent", async () => {
    const input = cofounderInput();
    input.members.push(adult("job:verified"), adult("job:unverified"), adult("candidate"));
    const role = [`${T.family}data_analyst`, `${T.seniority}3`];
    for (const id of ["job:verified", "job:unverified"]) {
      input.intents.push(intent(id, "Hire: Data Analyst", JOB_INTENT), { ...intent(id, cofounderIntentObjective, cofounderIntentDetails), id: `${id}-cofounder` });
      input.facets.push(facet(id, "fact", [`${T.entity}job`, ...role]), facet(id, "fact", [`${T.pay}90-130`, `${T.openings}1`, `${T.mode}remote`]),
        facet(id, "skill", [`${T.must}sql:3`]), facet(id, "fact", [`${T.company}${id}`]));
    }
    input.facets.push(facet("job:verified", "fact", [T.verified]));
    input.intents.push(intent("candidate", "Find a data role", SEARCH_INTENT));
    input.facets.push(facet("candidate", "fact", [`${T.entity}candidate`, ...role]),
      facet("candidate", "skill", [`${T.skill}sql:5`], "shareable"), facet("candidate", "preference", [`${T.floor}95`, `${T.mode}remote`]));
    const { proposals } = await engine(input);
    expect(proposals.filter(p => p.lane === "Cofounder").flatMap(p => p.participants)).toEqual(["ari", "ren"]);
    expect(proposals.filter(p => p.lane === "Hire").flatMap(p => p.participants).sort()).toEqual(["candidate", "job:verified"]);
  });
});
