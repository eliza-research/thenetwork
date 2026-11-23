import { describe, expect, test } from "vitest";
import { DAY, HOUR } from "@thenetwork/core";
import {
  SLOP_ENGINE_CONFIG, World, attention, localEmbed, relayItemAsync, resolveConfig, runEngine, slopPack,
  type EngineInput,
} from "../src/index.ts";
import { slopWorld } from "../../../scripts/sim/slop.ts";
import { planMemberReason } from "../src/plans.ts";
import { slopOnboardTags, extractSlopProfile } from "../src/packs/slop/extract.ts";
import { SLOP_ONBOARD_QUESTIONS } from "../src/packs/slop/onboard.ts";
import { SLOP_ASK_QUESTIONS } from "../src/packs/slop/copy.ts";
import { missingFields } from "../src/packs/slop/rules.ts";
import { SLOP_DEFAULT_OPTIONS } from "../src/packs/slop/options.ts";
import { slopProfiles } from "../src/packs/slop/profile.ts";

const NOW = Date.UTC(2026, 9, 12, 14);
const COMPS = {
  fit: 0.8, mutualBenefit: 0.8, warmPath: 0, novelty: 0.8, timingFit: 1,
  activationCost: 0, interruptionCost: 0, load: 0, repetition: 0, socialRisk: 0, confidence: 1,
};

function recent(id: string, participants: string[], category: "romance" | "events", createdAt: number) {
  return {
    id, kind: "intro" as const, participants, alternates: [], objective: "meet", category, city: "nyc" as const,
    score: 0.8, components: COMPS, exploration: false, explanations: {}, generator: "test", createdAt,
  };
}

function adultSlopMember(id: string, area?: string, extraTags: string[] = []): {
  member: EngineInput["members"][number];
  facets: EngineInput["facets"];
  presence: EngineInput["presence"];
} {
  return {
    member: {
      id, name: `Member ${id}`, age: 29, homeCity: "nyc" as const, state: "normal",
      joinedAt: NOW - 30 * DAY, unansweredProactive: 0,
      prefs: { categoriesOptIn: ["romance", "social", "events", "hobby"], quietHours: [22, 8], romanceOptIn: true, formats: ["one_to_one", "small_group"], maxTravelMinutes: 45, onlyWhenAsked: false },
    },
    facets: [
      { id: `${id}-f1`, memberId: id, kind: "preference", value: "woman seeking men", tags: ["romance:is:woman", "romance:seeks:man", "romance:age:25-38", "slop:scope:radius:10", "slop:max_miles:10", ...extraTags], scope: "agent_private", confidence: 1, provenance: "said" },
    ],
    presence: [{ memberId: id, city: "nyc" as const, type: "home", areas: area ? [area] : [] }],
  };
}

describe("QSM ported engine fixes", () => {
  test("SD-209: missingFields asks slop_location when member gave a radius without zip or neighborhood", () => {
    const { member, facets, presence } = adultSlopMember("rae");
    const profiles = slopProfiles({ now: NOW, members: [member], facets, intents: [], presence, edges: [], recentProposals: [] });
    const fields = missingFields(profiles.get("rae")!, SLOP_DEFAULT_OPTIONS);
    expect(fields).toContain("location");
    expect(SLOP_ONBOARD_QUESTIONS.slop_location?.text).toBe(SLOP_ASK_QUESTIONS.slop_location);
  });

  test("SD-207: slopAssign respects each member's interruption budget", async () => {
    const base = slopWorld(1, { perCity: 20, minorShare: 0 });
    const baseline = await runEngine(base, { ...SLOP_ENGINE_CONFIG, seed: 1, budgets: { ...SLOP_ENGINE_CONFIG.budgets, normal: { limit: 2, periodDays: 7 } } }, { pack: slopPack });
    expect(baseline.proposals.length).toBeGreaterThan(0);
    const target = baseline.proposals[0]!.participants[0]!;
    const limitedInput: EngineInput = {
      ...base,
      recentProposals: [
        ...base.recentProposals,
        recent("p1", [target, "x1"], "romance", base.now - DAY),
      ],
    };
    const exhaust = await runEngine(limitedInput, { ...SLOP_ENGINE_CONFIG, seed: 1, budgets: { ...SLOP_ENGINE_CONFIG.budgets, normal: { limit: 1, periodDays: 7 } } }, { pack: slopPack });
    expect(exhaust.proposals.some(p => p.participants.includes(target))).toBe(false);
  });

  test("SD-061: slopOnboardTags always includes slop:dealbreaker: in replaces when dealbreaker is retracted", () => {
    let ob = extractSlopProfile(["no smokers please"], undefined, { market: "nyc" });
    expect(ob.dealbreakers.map(d => d.value)).toEqual(["smoker"]);
    expect(slopOnboardTags(ob).tags.some(t => t.tag === "slop:dealbreaker:smoker")).toBe(true);

    ob = extractSlopProfile(["smoking is fine actually"], ob, { market: "nyc" });
    expect(ob.dealbreakers).toEqual([]);
    const after = slopOnboardTags(ob);
    expect(after.tags.some(t => t.tag.startsWith("slop:dealbreaker:"))).toBe(false);
    expect(after.replaces).toContain("slop:dealbreaker:");
  });

  test("SD-206: planMemberReason skips only the interruption/contribution budgets without masking later hard rules", () => {
    const input: EngineInput = {
      now: NOW,
      members: [
        {
          id: "m1", name: "NoShow Guest", age: 29, homeCity: "nyc", state: "normal",
          joinedAt: NOW - 40 * DAY, unansweredProactive: 0,
          prefs: { categoriesOptIn: ["events", "social"], quietHours: [22, 8], romanceOptIn: false, formats: ["small_group"], maxTravelMinutes: 45, onlyWhenAsked: false },
        },
      ],
      facets: [{ id: "m1-f", memberId: "m1", kind: "interest", value: "hiking", tags: ["hiking"], scope: "shareable", confidence: 1, provenance: "said" }],
      intents: [],
      presence: [{ memberId: "m1", city: "nyc", type: "home", areas: ["Greenpoint"] }],
      edges: [],
      recentProposals: [
        recent("r1", ["m1", "x1"], "events", NOW - HOUR),
        recent("r2", ["m1", "x2"], "events", NOW - 2 * HOUR),
      ],
      reliability: { m1: { noShows: 3, completedSinceLastNoShow: 0 } },
    };
    const cfg = resolveConfig({
      budgets: {
        normal: { limit: 1, periodDays: 7 }, open: { limit: 1, periodDays: 7 },
        quiet: { limit: 1, periodDays: 7 }, receiving: { limit: 1, periodDays: 7 }, paused: { limit: 0, periodDays: 7 },
      },
    });
    const w = new World(input, cfg, localEmbed);
    expect(planMemberReason(w, "m1", "guest")).toBe("reliability_holdout");
  });

  test("SD-063: recordProbeAnswer ends a 1-participant probe flow at revealed on yes", () => {
    const flow = attention.startProbeFlow({ id: "growth-1", participants: ["a"], roles: { a: "guest" } });
    const next = attention.recordProbeAnswer(flow, "a", true);
    expect(next.stage).toBe("revealed");
  });

  test("SD-064: relayItemAsync marks ageSignal when classifier returns minor_signal", async () => {
    const res = await relayItemAsync(
      { id: "item-minor", from: "a", to: "b", kind: "text", text: "meet at the park after class", at: NOW },
      {
        now: NOW,
        opportunity: { id: "m1", app: "friends", participants: ["a", "b"], acceptedBy: ["a", "b"], status: "mutual" },
        sender: { id: "a", firstName: "Ari", age: 25, optedOut: false, held: false },
        recipient: { id: "b", firstName: "Bo", age: 27, optedOut: false, held: false },
        blocked: false,
        recentTexts: [],
      },
      { hook: async () => ({ flags: ["minor_signal"], source: "clef" }) },
    );
    expect(res.decision).toBe("hold");
    expect(res.record.ageSignal).toBe(true);
    expect(res.reasons).toContain("clef:minor_signal");
  });
});
