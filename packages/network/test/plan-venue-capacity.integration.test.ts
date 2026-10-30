import { expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { World } from "../../engine/src/world.ts";
import { resolveConfig } from "../../engine/src/config.ts";
import { localEmbed } from "../../engine/src/embed.ts";
import { planProposals, type PlanEvidence, type Venue } from "../../engine/src/plans.ts";
import type { EngineInput } from "../../engine/src/types.ts";

test("planned groups and partner fallbacks fit their public venue capacity", () => {
  for (const seed of [1, 2, 3]) for (const activity of [{ id: "board_game_cafe", tag: "board_games", min: 3 }, { id: "tennis", tag: "tennis", min: 2 }]) for (const capacity of [0, 1, 2, 3, 4, 6, undefined]) {
    const now = Date.UTC(2026, 9, 12, 13), ids = ["a", "b", "c", "d", "e", "f"];
    const input: EngineInput = { now, members: [], facets: [], intents: [], presence: [], edges: [], recentProposals: [] };
    for (const id of ids) {
      input.members.push({ id, name: id, age: 30, homeCity: "nyc", state: "normal", joinedAt: now - 40 * DAY, unansweredProactive: 0,
        prefs: { categoriesOptIn: ["social"], quietHours: [22, 8], romanceOptIn: false, formats: ["small_group", "one_to_one"], maxTravelMinutes: 45, onlyWhenAsked: false } });
      input.presence.push({ memberId: id, city: "nyc", type: "home", areas: ["manhattan"] });
      input.facets.push({ id: `${id}-interest`, memberId: id, kind: "interest", value: `I enjoy ${activity.tag}`, tags: [activity.tag], scope: "shareable", confidence: 1, provenance: "said" });
    }
    const w = new World(input, resolveConfig({ seed }), localEmbed);
    const evidence = new Map<string, PlanEvidence>(ids.map(memberId => [memberId, { memberId, tz: "America/New_York", quietHours: [22, 8],
      standing: [{ byDay: [0, 1, 2, 3, 4, 5, 6], startHour: 17, endHour: 22, source: "conversation", statedAt: now }] }]));
    const venue: Venue = { id: "small-cafe", city: "nyc", area: "manhattan", name: "Synthetic public venue", activities: [activity.id], priceTier: 1, ageMin: 18,
      hours: { weekday: [9, 23], weekend: [9, 23] }, public: true, source: "curated", ...(capacity === undefined ? {} : { capacity }) };
    const plans = planProposals(w, { now, city: "nyc", tz: "America/New_York", evidence, venues: [venue] });
    if (capacity !== undefined && capacity < activity.min) expect(plans).toHaveLength(0);
    else {
      expect(plans.length).toBeGreaterThan(0);
      for (const p of plans) {
        expect(p.venueId).toBe(venue.id);
        expect(p.invited.length).toBeLessThanOrEqual(capacity ?? 6);
        expect(p.size.max).toBeLessThanOrEqual(capacity ?? 6);
      }
    }
  }
});
