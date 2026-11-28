import { expect, test } from "vitest";
import { standingIntentCommand } from "../src/standing-intents.ts";
import { Mini } from "./mini.ts";
import { holdEveryItem } from "../../engine/src/reviewJudge.ts";

const climber = { id: "a", name: "Alice Able", age: 30, interests: ["climbing"] };

function command(x: Mini, text: string, causeId: string) {
  const parsed = standingIntentCommand(text);
  expect(parsed).toBeDefined();
  return x.net.manageStandingIntents("a", parsed!, true, causeId);
}

test("the KEEP confirmation dates the deadline in the member's own time zone", async () => {
  const x = new Mini([climber], { seed: 1, inlineJudge: holdEveryItem.inline, onboardingRequests: false });
  await x.onboard("a");
  await x.say("a", "Find me a climbing partner.");
  await x.net.tick(x.clock.now());
  x.members.find(m => m.id === "a")!.homeCity = "sf";
  x.clock.set(Date.UTC(2026, 9, 6, 5, 30));
  expect(command(x, "what am I looking for", "list-1").kind).toBe("reply");
  const kept = command(x, "keep 1", "keep-1");
  const endsAt = x.net.standingView("a").entries[0]!.endsAt!;
  const local = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric" }).format(endsAt);
  expect(kept).toEqual({ kind: "reply", body: `Kept: “find a regular climbing partner”. I'll keep looking until ${local}.` });
});
