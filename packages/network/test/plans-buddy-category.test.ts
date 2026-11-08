// The plans buddy in each app's categories (docs/research/2026-11-07-state-machines.md, module
// matching_engine, SD-260): the real ConsentNetwork and engine in the small NYC world (mini.ts). The
// plans buddy was an `events` item, and submit closes any item outside the app's categories. So on
// friends (social and hobby) two members who both asked for plans got the offer "see if anyone else is
// up", the item closed at once, and both requests kept its id, so neither could be paired again. On
// slop and peon the offer could never be kept at all. The second encounter (a social item) closed the
// same way on slop and peon, after it had deleted the pair's mutual "meet again" wish.
import { describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { pairKey } from "../../engine/src/world.ts";
import { copy } from "../src/copy.ts";
import { Mini } from "./mini.ts";

const friend = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"] });
const ASK = "Anything fun this weekend?";

describe("plans buddy and app categories", () => {
  test("friends: two plans requests become one item in review, not a closed item", async () => {
    const w = new Mini([friend("a", "Ana Diaz"), friend("b", "Ben Ito")], { app: "friends", review: "human" });
    await w.onboard("a", "b");
    await w.run(HOUR);
    await w.say("a", ASK);
    expect(w.to("a").at(-1)?.body).toMatch(/Want me to see if anyone else is up/);
    await w.say("b", ASK);
    const st = w.net.exportState();
    const buddy = st.opps.filter(o => o.origin === "plans");
    expect(buddy.map(o => ({ stage: o.stage, closedReason: o.closedReason, category: o.category }))).toEqual([{ stage: "review", closedReason: undefined, category: "social" }]);
    expect(w.log("gate").filter(l => l.detail.reason === "category_not_allowed")).toHaveLength(0);
  });

  test("peon: a plans request gets no offer that cannot be kept, and no item is composed", async () => {
    const w = new Mini([friend("a", "Ana Diaz"), friend("b", "Ben Ito")], { app: "peon", review: "human" });
    await w.onboard("a", "b");
    await w.run(HOUR);
    const from = w.mark();
    await w.say("a", ASK);
    await w.say("b", ASK);
    const toA = w.to("a", from).map(s => s.body).join(" ");
    expect(toA).toMatch(/^A few ideas nearby: /);
    expect(toA).not.toMatch(/see if anyone else is up/);
    expect(toA).toContain(copy.plansNoOffer([]).split(". ").at(-1)!);
    expect(w.net.exportState().opps.filter(o => o.origin === "plans")).toEqual([]);
    expect(w.log("gate").filter(l => l.detail.reason === "category_not_allowed")).toHaveLength(0);
  });
  // The second encounter is a social item too: on slop it closed at submit and the mutual wish was deleted.
  test("slop: a mutual 'meet again' composes no item outside the app's categories and keeps the wish", async () => {
    const w = new Mini([friend("a", "Ana Diaz"), friend("b", "Ben Ito")], { app: "slop", review: "human" });
    await w.onboard("a", "b");
    const st = w.net.exportState();
    st.again = [[pairKey("a", "b"), ["a", "b"]]];
    w.net.importState(st);
    await w.run(DAY);
    const after = w.net.exportState();
    expect(after.opps.filter(o => o.origin === "second_encounter")).toEqual([]);
    expect(w.log("gate").filter(l => l.detail.reason === "category_not_allowed")).toHaveLength(0);
    expect(after.again).toEqual([[pairKey("a", "b"), ["a", "b"]]]);
  });
});
