import { expect, test } from "vitest";
import { slopProfiles } from "@thenetwork/engine/src/packs/slop/profile.ts";
import { limitMiles, mutualMarkets } from "@thenetwork/engine/src/packs/slop/geo.ts";
import { readBack } from "@thenetwork/engine/src/packs/slop/onboard.ts";
import type { SlopOnboarding } from "@thenetwork/engine/src/packs/slop/extract.ts";
import { makeSlopPack } from "@thenetwork/engine";
import { appWiring } from "../service/packs.ts";

type SlopOptions = ReturnType<typeof makeSlopPack>["options"];
import { Mini } from "./mini.ts";
import { simulatedReviewJudge } from "../../engine/src/reviewJudge.ts";

// spec/datingRadius.md, "The distance and margin must fit both members' limits": the limit a member
// states by text is the limit matching uses, so a later text that changes it must replace the stored one.
test("a radius change texted after onboarding is saved and matching uses the new limit", async () => {
  const wiring = appWiring("slop");
  const options = (wiring.pack as unknown as { options: SlopOptions }).options;
  const w = new Mini(
    [
      { id: "a", name: "Ana Doe", age: 30, romance: { is: "woman", seeks: ["man"] } },
      { id: "b", name: "Ben Roe", age: 31, romance: { is: "man", seeks: ["woman"] } },
    ],
    { app: "slop", pack: wiring.pack, hooks: wiring.hooks, plans: false, inlineJudge: simulatedReviewJudge({ exceptions: false }), engine: { ...wiring.engine } },
  );
  const ANSWERS: Record<string, string> = { slop_readback: "Yes", slop_basics: "no smokers", slop_goal: "something serious", slop_interests: "climbing and live music", slop_activities: "coffee or a walk", slop_free: "weekday evenings", slop_distance: "within 5 miles", slop_location: "11222", slop_age_range: "25 to 38", slop_seeks: "men", slop_gender: "a woman", slop_orientation: "straight" };
  const onboard = async (id: string, lines: string[]) => {
    for (const line of lines) { await w.say(id, line); w.clock.advance(60_000); }
    for (let i = 0; i < 12; i++) {
      const aw = w.net.memberList().find(m => m.id === id)?.awaiting;
      if (aw?.kind !== "interview" || !aw.ask) break;
      await w.say(id, ANSWERS[aw.ask.reason] ?? "Yes"); w.clock.advance(60_000);
    }
    expect(w.net.memberList().find(m => m.id === id)?.awaiting).toBeUndefined();
  };
  // Ana dates within 5 miles of 11222; Ben within 25 of 11220 (cells 6.63 miles apart, margin 0.9).
  await onboard("a", ["hi", "Ana, 30", "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 25 to 38, within 5 miles of 11222", "Something serious, no smokers", "Yes"]);
  await onboard("b", ["hi", "Ben, 31", "I'm a man into women. Sunset Park, I climb and go to shows", "I'm a man looking for women, 25 to 38, within 25 miles of 11220", "A relationship, no smokers", "Yes"]);
  const pair = () => {
    const P = slopProfiles(w.net.packInput(w.clock.now()));
    return mutualMarkets(P.get("a")!, P.get("b")!, options, ["nyc"]);
  };
  expect(pair()).toEqual([]);
  // No question is waiting: Ana texts the change on her own.
  await w.say("a", "actually, keep it within 10 miles now");
  const tags = (w.net.exportState().members.find(m => m.id === "a")?.appTags ?? []).map(t => t.tag);
  expect(tags).toContain("slop:scope:radius:10");
  expect(tags).toContain("slop:max_miles:10");
  expect(tags).not.toContain("slop:scope:radius:5");
  const P = slopProfiles(w.net.packInput(w.clock.now()));
  expect(limitMiles(P.get("a")!, options)).toBe(10);
  expect(pair()).toHaveLength(1);
  // The read-back the loop renders from the stored state repeats the new radius.
  const state = w.net.exportState().members.find(m => m.id === "a")?.onboarding as SlopOnboarding;
  expect(readBack(state)).toContain("within 10 mi");
  // The change is read back to the member for confirmation.
  expect(w.to("a").map(m => m.body).join("\n")).toContain("within 10 mi");
  await w.say("a", "Yes");
  // Ordinary remarks about trips, places and other people change nothing.
  const remarks = [
    "the date was 30 miles away, too far",
    "I'm 17 miles from my parents",
    "my office is 3 miles from home",
    "make my radius -5 miles",
    "my sister lives in Astoria",
    "the restaurant is at 11201",
    "my radius is fine but the date was 30 miles away, too far",
    "I'm looking for a gym, the last date was 30 miles away",
    "I live in Greenpoint but the date was 30 miles away, too far",
    "no more than 2 drinks on a first date, the bar was 12 miles away",
    "I'd go up to 3 dates before deciding, he lived 20 miles away",
    "my radius is fine, the restaurant is at 11201",
    "I'm looking for a new apartment near 11201",
    "keep it within 10 miles, my sister lives in Astoria",
    "make my radius minus 5 miles",
    "make my radius −5 miles",
    "make my radius –5 miles",
  ];
  for (const remark of remarks) {
    await w.say("a", remark);
    const after = (w.net.exportState().members.find(m => m.id === "a")?.appTags ?? []).map(t => t.tag);
    expect(after, remark).toContain("slop:scope:radius:10");
    expect(after).toContain("slop:max_miles:10");
    expect(after.some(t => t.startsWith("slop:location:") && !t.includes("11222"))).toBe(false);
    await w.say("a", "Yes");
  }
});
