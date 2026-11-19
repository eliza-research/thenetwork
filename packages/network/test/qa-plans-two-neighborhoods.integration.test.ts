import { expect, test } from "bun:test";
import { Mini } from "./mini.ts";

// A plans request that names two neighborhoods ("Williamsburg or Park Slope") names two
// locations: spec/product/stories.md F10 asks for recommendations "based on ... location",
// and the member stated two of them. The base answer kept only the first NEIGHBORHOODS
// match (Williamsburg) and Park Slope was never heard — the reply must name a venue near
// each side. Round-robin keeps 1–3 options: the first pick near each named area. The
// Williamsburg side accepts any Williamsburg venue near its centroid (Domino Park is
// nearer the Williamsburg centroid than McCarren Park itself, so it ranks first there).
const UWS = { id: "a", name: "Anna Reed", area: "Upper West Side" };

async function replies(member: { id: string; name: string; area: string }, request: string) {
  const world = new Mini([{ id: member.id, name: member.name, age: 30, area: member.area }], { matchingEnabled: false });
  await world.onboard(member.id);
  const mark = world.mark();
  await world.say(member.id, request);
  return world.to(member.id, mark);
}

const WBURG = { id: "b", name: "Ben Ortiz", area: "Williamsburg" };

test("two named neighborhoods are both answered, never one only", async () => {
  for (const [member, request, first, second] of [
    [UWS, "Any plans in Williamsburg or Park Slope this weekend?", ["McCarren Park", "Domino Park", "Transmitter Park"], ["Prospect Park, Long Meadow", "Grand Army Plaza Greenmarket", "Brooklyn Public Library, Central", "Brooklyn Museum"]],
    [UWS, "Any plans in Park Slope or Williamsburg this weekend?", ["Prospect Park, Long Meadow", "Grand Army Plaza Greenmarket", "Brooklyn Public Library, Central", "Brooklyn Museum"], ["McCarren Park", "Domino Park", "Transmitter Park"]],
    [WBURG, "Any plans in Williamsburg or Park Slope this weekend?", ["McCarren Park", "Domino Park", "Transmitter Park"], ["Prospect Park, Long Meadow", "Grand Army Plaza Greenmarket", "Brooklyn Public Library, Central", "Brooklyn Museum"]],
    [UWS, "Any plans in Astoria or Williamsburg this weekend?", ["Astoria Park", "Socrates Sculpture Park"], ["McCarren Park", "Domino Park", "Transmitter Park"]],
    [UWS, "Any plans in Chelsea or Park Slope this weekend?", ["Chelsea Market", "The High Line at Gansevoort", "Union Square Greenmarket"], ["Prospect Park, Long Meadow", "Grand Army Plaza Greenmarket", "Brooklyn Public Library, Central", "Brooklyn Museum"]],
  ] as const) {
    const msgs = await replies(member, request);
    const body = msgs.find(m => m.meta.type === "concierge")?.body;
    expect(first.some(v => body?.includes(v))).toBe(true);
    expect(second.some(v => body?.includes(v))).toBe(true);
  }
});

test("one named neighborhood, or no place, still gets the usual single-area answer", async () => {
  const home = await replies(UWS, "Any plans this weekend?");
  expect(home.find(m => m.meta.type === "concierge")?.body).toContain("Central Park, Sheep Meadow");
  expect((await replies(UWS, "Any plans in Williamsburg this weekend?")).find(m => m.meta.type === "concierge")?.body).toContain("McCarren Park");
  expect((await replies(UWS, "Any plans in Park Slope this weekend?")).find(m => m.meta.type === "concierge")?.body).toContain("Prospect Park, Long Meadow");
  // Boundary (base behaviour preserved): a name contained in another matched name
  // ("Harlem" in "East Harlem") still answers as one neighborhood, not two.
  expect((await replies(UWS, "Any plans in East Harlem this weekend?")).find(m => m.meta.type === "concierge")?.body).toContain("Marcus Garvey Park");
  for (const request of [
    "Any plans in person this weekend?",
    "Any plans in June this weekend?",
  ]) {
    const msgs = await replies(UWS, request);
    expect(msgs.some(m => m.meta.type === "question")).toBe(false);
    expect(msgs.find(m => m.meta.type === "concierge")?.body).toContain("Central Park, Sheep Meadow");
  }
});
