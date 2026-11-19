import { expect, test } from "bun:test";
import { Mini } from "./mini.ts";

// A plans request that names a place the Network does not know (a borough, an unlisted
// neighborhood, somewhere outside NYC) must be asked about, never answered with home venues:
// the same "ask, never guess" rule areaOf applies to where someone lives, and the evals gate
// "an unknown place is never defaulted" for where someone lives. The member named a place;
// sending them to the wrong neighborhood with no signal is a wrong answer, not a fallback.
const HOME_VENUES = ["Central Park, Sheep Meadow", "Central Park Reservoir loop", "Riverside Park"];

async function replies(request: string) {
  const world = new Mini([{ id: "a", name: "Anna Reed", age: 30, area: "Upper West Side" }], { matchingEnabled: false });
  await world.onboard("a");
  const mark = world.mark();
  await world.say("a", request);
  return world.to("a", mark);
}

test("an unknown named place is asked about, never answered with home venues", async () => {
  for (const [request, place] of [
    ["Any plans in Queens this weekend?", "Queens"],
    ["Any plans in Brooklyn Heights this weekend?", "Brooklyn Heights"],
    ["Any plans in Jersey City this weekend?", "Jersey City"],
    ["Any plans in Hoboken this weekend?", "Hoboken"],
    ["Any plans in Forest Hills this weekend?", "Forest Hills"],
    ["Any plans in Manhattan this weekend?", "Manhattan"],
    ["Any plans in Brooklyn this weekend?", "Brooklyn"],
    ["Any plans in the Bronx this weekend?", "Bronx"],
    ["Any plans in Staten Island this weekend?", "Staten Island"],
    ["Any plans in queens this weekend?", "Queens"],
  ] as const) {
    const msgs = await replies(request);
    expect(msgs.some(m => HOME_VENUES.some(v => m.body.includes(v)))).toBe(false);
    expect(msgs.find(m => m.meta.type === "question")?.body).toContain(`I don't have ${place} on my list of neighborhoods`);
  }
});

test("a named neighborhood, a venue, or a time still gets the usual answer, not the ask", async () => {
  const home = await replies("Any plans this weekend?");
  expect(home.find(m => m.meta.type === "concierge")?.body).toContain("Central Park, Sheep Meadow");
  expect((await replies("Any plans in Williamsburg this weekend?")).find(m => m.meta.type === "concierge")?.body).toContain("McCarren Park");
  // Boundaries (base behaviour preserved; the matching fixes belong to #540 / #549, not here):
  // a venue ("Central Park"), a time ("June"), no place ("in person"), a known alias
  // ("the Slope", "Wburg") and a lowercase known name ("williamsburg") never trigger the ask.
  for (const request of [
    "Any plans in Central Park this weekend?",
    "Any plans in June this weekend?",
    "Any plans in person this weekend?",
    "Any plans in the Slope this weekend?",
    "Any plans in Wburg this weekend?",
    "Any plans in williamsburg this weekend?",
  ]) {
    const msgs = await replies(request);
    expect(msgs.some(m => m.meta.type === "question")).toBe(false);
    expect(msgs.find(m => m.meta.type === "concierge")?.body).toBeDefined();
  }
});
