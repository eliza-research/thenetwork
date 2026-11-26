import { expect, test } from "vitest";
import { Mini } from "./mini.ts";

async function ideas(request: string, area = "Upper West Side") {
  const world = new Mini([{ id: "a", name: "Anna Reed", age: 30, area }], { matchingEnabled: false });
  await world.onboard("a");
  const mark = world.mark();
  await world.say("a", request);
  return world.to("a", mark);
}

test.each([
  ["williamsburg", "McCarren Park"], ["WILLIAMSBURG", "McCarren Park"], ["Wburg", "McCarren Park"],
  ["the Slope", "Prospect Park, Long Meadow"], ["LES", "Seward Park"], ["LIC", "Gantry Plaza State Park"],
  ["Long-Island-City", "Gantry Plaza State Park"], ["Long  Island  City", "Gantry Plaza State Park"],
  ["St.George", "Snug Harbor"], ["Bed Stuy", "Herbert Von King Park"], ["Chelsea", "Chelsea Market"],
  ["the battery", "The Battery"], ["Bryant Park", "Bryant Park"], ["Prospect Park", "Prospect Park, Long Meadow"],
])("uses the named public location (%s)", async (requested, expected) => {
  expect((await ideas(`Any plans near ${requested} this weekend?`)).find(reply => reply.meta.type === "concierge")?.body).toContain(expected);
});

test("the full venue name takes precedence over a shorter venue name", async () => {
  const reply = (await ideas("Any plans near Central Park Reservoir loop this weekend?", "Williamsburg"))
    .find(message => message.meta.type === "concierge")?.body;
  expect(reply).toContain("Central Park Reservoir loop");
  expect(reply).not.toMatch(/Riverside Park|McCarren Park/);
});

test.each(["queens", "Brooklyn Heights", "Forest Hills", "Jersey City", "Hoboken", "Moon Harbor"])(
  "asks about an unsupported location without repeating it (%s)", async place => {
    const messages = await ideas(`Any plans in ${place} this weekend?`);
    expect(messages.some(reply => reply.meta.type === "concierge")).toBe(false);
    const question = messages.find(reply => reply.meta.type === "question")?.body;
    expect(question).toContain("Which NYC neighborhood should I use?");
    expect(question?.toLowerCase()).not.toContain(place.toLowerCase());
  },
);

test.each(["with Chelsea this weekend", "in June", "in person this weekend", "around Noon", 'this weekend? "In Chelsea"'])(
  "retains the home area when the request has no direct place (%s)", async suffix => {
    expect((await ideas(`Any plans ${suffix}?`)).find(reply => reply.meta.type === "concierge")?.body).toContain("Central Park, Sheep Meadow");
  },
);
