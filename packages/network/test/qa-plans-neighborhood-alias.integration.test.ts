import { expect, test } from "bun:test";
import { Mini } from "./mini.ts";

async function recommendations(request: string) {
  const world = new Mini([{ id: "a", name: "Anna Reed", age: 30, area: "Upper West Side" }], { matchingEnabled: false });
  await world.onboard("a");
  const mark = world.mark();
  await world.say("a", request);
  const answer = world.to("a", mark).find(message => message.meta.type === "concierge")?.body;
  expect(answer).toBeDefined();
  return answer!;
}

test("a named neighborhood alias takes precedence over the member's home", async () => {
  const home = await recommendations("Any plans this weekend?");
  expect(home).not.toContain("McCarren Park");
  expect(await recommendations("Any plans in Wburg this weekend?")).toContain("McCarren Park");
  expect(await recommendations("Any plans in the Slope this weekend?")).toContain("Prospect Park, Long Meadow");
  expect(await recommendations("Any plans in LES this weekend?")).toContain("Seward Park");
  expect(await recommendations("Any plans in LIC this weekend?")).toContain("Gantry Plaza State Park");
  expect(await recommendations("Any plans in FIDI this weekend?")).toContain("The Battery");
});

test("separator variants of a named neighborhood take precedence over the member's home", async () => {
  expect(await recommendations("Any plans in Long  Island  City this weekend?")).toContain("Gantry Plaza State Park");
  expect(await recommendations("Any plans in Long-Island-City this weekend?")).toContain("Gantry Plaza State Park");
  expect(await recommendations("Any plans in St George this weekend?")).toContain("Snug Harbor");
  expect(await recommendations("Any plans in Bed Stuy this weekend?")).toContain("Maria Hernandez Park");
});
