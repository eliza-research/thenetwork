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

test("a named neighborhood takes precedence over the member's home", async () => {
  const home = await recommendations("Any plans this weekend?");
  const named = await recommendations("Any plans in Williamsburg this weekend?");
  expect(home).not.toContain("McCarren Park");
  expect(named).toContain("McCarren Park");
  expect(home).not.toBe(named);
});

test("lowercase neighborhood names produce the same recommendations", async () => {
  const named = await recommendations("Any plans in Williamsburg this weekend?");
  expect(await recommendations("Any plans in williamsburg this weekend?")).toBe(named);
});

test("uppercase neighborhood names produce the same recommendations", async () => {
  const named = await recommendations("Any plans in Williamsburg this weekend?");
  expect(await recommendations("Any plans in WILLIAMSBURG this weekend?")).toBe(named);
});
