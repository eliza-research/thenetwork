import { expect, test } from "bun:test";
import { Mini } from "./mini.ts";

// A plans request that names a known venue (The Battery, Prospect Park, Bryant Park,
// McCarren Park) must be answered with venues near that venue, never home venues:
// spec F10 asks for recommendations "based on ... location", and the member stated
// the location. The venue's own neighborhood anchors the answer, as a named
// neighborhood does (#540). The Battery is a venue in VENUES (Financial District),
// not a neighborhood, so the neighborhood match in onPlans never sees it.
const HOME_UWS = ["Central Park, Sheep Meadow", "Central Park Reservoir loop", "Riverside Park"];
const HOME_WBURG = ["McCarren Park", "Domino Park", "Transmitter Park"];

async function replies(member: { id: string; name: string; area: string }, request: string) {
  const world = new Mini([{ id: member.id, name: member.name, age: 30, area: member.area }], { matchingEnabled: false });
  await world.onboard(member.id);
  const mark = world.mark();
  await world.say(member.id, request);
  return world.to(member.id, mark);
}

const UWS = { id: "a", name: "Anna Reed", area: "Upper West Side" };
const WBURG = { id: "b", name: "Ben Ortiz", area: "Williamsburg" };

test("a named venue is answered near that venue, never with home venues", async () => {
  // [member, request, near venue, home venues that must not appear]. Bryant Park is
  // the exception to the no-home-leak check: Midtown genuinely borders Central Park,
  // so nearbyVenues("Midtown") legitimately returns Sheep Meadow as its 3rd idea —
  // that is adjacency, not the home fallback. The other anchors are far from home,
  // so any home venue there would be the fallback.
  for (const [member, request, near, home] of [
    [UWS, "Any plans in The Battery this weekend?", "The Battery", HOME_UWS],
    [UWS, "Any plans near Prospect Park this weekend?", "Prospect Park, Long Meadow", HOME_UWS],
    [UWS, "Any plans in Bryant Park this weekend?", "Bryant Park", []],
    [UWS, "Any plans near McCarren Park this weekend?", "McCarren Park", HOME_UWS],
    [WBURG, "Any plans near Central Park this weekend?", "Central Park, Sheep Meadow", HOME_WBURG],
    [WBURG, "Any plans in The Battery this weekend?", "The Battery", HOME_WBURG],
  ] as const) {
    const msgs = await replies(member, request);
    const body = msgs.find(m => m.meta.type === "concierge")?.body;
    expect(body).toContain(near);
    expect(home.some(v => body?.includes(v))).toBe(false);
  }
});

test("no place, a named neighborhood, or a time still gets the usual home answer", async () => {
  const home = await replies(UWS, "Any plans this weekend?");
  expect(home.find(m => m.meta.type === "concierge")?.body).toContain("Central Park, Sheep Meadow");
  expect((await replies(UWS, "Any plans in Williamsburg this weekend?")).find(m => m.meta.type === "concierge")?.body).toContain("McCarren Park");
  // Boundaries (base behaviour preserved): no place ("in person"), a time ("June"),
  // and a lowercase venue name ("the battery") never trigger the venue anchor —
  // case handling belongs to a #540-style follow-up, not here.
  for (const request of [
    "Any plans in person this weekend?",
    "Any plans in June this weekend?",
    "Any plans in the battery this weekend?",
  ]) {
    const msgs = await replies(UWS, request);
    expect(msgs.some(m => m.meta.type === "question")).toBe(false);
    expect(msgs.find(m => m.meta.type === "concierge")?.body).toContain("Central Park, Sheep Meadow");
  }
});
