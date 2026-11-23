import { expect, test } from "vitest";
import { DAY, HOUR, EngineRng as Rng, type Member, type NetworkEvent } from "@thenetwork/core";
import { resolveConfig, localEmbed, World, type EngineInput } from "@thenetwork/engine";
import { secondEncounter } from "../../engine/src/packs/network/generators.ts";

test("an unsuitable event does not displace an eligible repeat meetup", () => {
  const now = Date.UTC(2026, 9, 10, 12);
  const ids = ["a", "b"];
  const members: Member[] = ids.map(id => ({
    id, name: id, age: 30, state: "normal", homeCity: "nyc", joinedAt: now - 20 * DAY, unansweredProactive: 0,
    prefs: { categoriesOptIn: ["social", "hobby"], formats: ["one_to_one", "event"], quietHours: [22, 8],
      romanceOptIn: false, maxTravelMinutes: 30, onlyWhenAsked: false },
  }));
  const event: NetworkEvent = { id: "event", title: "Climbing together", city: "nyc", category: "events",
    start: now + 2 * DAY, end: now + 2 * DAY + 2 * HOUR, tags: ["climbing"] };
  const base: EngineInput = {
    now, members, intents: [], edges: [], recentProposals: [],
    facets: ids.map(id => ({ id: `${id}:skill`, memberId: id, kind: "interest", value: "Climbing outdoors",
      tags: ["climbing"], scope: "shareable", provenance: "said", confidence: 1 })),
    presence: ids.map(id => ({ memberId: id, city: "nyc", type: "home", areas: ["Williamsburg"] })),
    interactions: [{ id: "original", kind: "intro", category: "social", at: now - 5 * DAY, participants: ids, outcome: "completed" }],
    feedback: ids.map((id, i) => ({ id: `feedback-${id}`, from: id, about: ids[1 - i]!, opportunityId: "original",
      at: now - 4 * DAY, sentiment: "positive", wouldMeetAgain: true, repeatConsent: true })),
  };
  const generate = (override: Partial<EngineInput>) => {
    const w = new World({ ...base, ...override }, resolveConfig({ seed: 1 }), localEmbed);
    return secondEncounter({ w, memberExclusions: {}, rng: new Rng(42), unmatchedIntents: new Set<string>() });
  };
  expect(generate({})).toMatchObject([{ format: "one_to_one", anchor: { type: "interaction", id: "original" } }]);
  expect(generate({ events: [event] })).toMatchObject([{ format: "one_to_one", anchor: { type: "interaction", id: "original" } }]);
  const eventMembers: Member[] = members.map(member => ({ ...member, prefs: { ...member.prefs, categoriesOptIn: ["social", "hobby", "events"] } }));
  expect(generate({ members: eventMembers, events: [event] })).toMatchObject([{ format: "event", anchor: { type: "event", id: event.id } }]);
  const trip = { memberId: "b", city: "sf", type: "temporary", from: event.start - HOUR, to: event.end + HOUR, areas: ["Mission"] } as const;
  expect(generate({ members: eventMembers, events: [event], presence: [...base.presence, { ...trip, areas: [...trip.areas] }] }))
    .toMatchObject([{ format: "one_to_one", anchor: { type: "interaction", id: "original" } }]);
});
