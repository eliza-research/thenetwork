import { expect, test } from "vitest";
import { HOUR, type MemberId } from "@thenetwork/core";
import { buildWorld, localEmbed, resolveConfig } from "@thenetwork/engine";
import { appearanceFacet } from "@thenetwork/engine/src/packs/slop/appearance.ts";
import { biasAlerts, biasReport } from "../service/bias.ts";
import { appWiring } from "../service/packs.ts";
import { Mini, type Spec } from "./mini.ts";

const PAIRS = 30;
const WOMEN = ["Ana", "Bea", "Cleo", "Dina", "Eva", "Fay", "Gia", "Hana", "Ida", "Jo", "Kim", "Lea", "Mia", "Nia", "Ola", "Pia", "Quinn", "Rae", "Sia", "Tia",
  "Uma", "Vera", "Wren", "Xia", "Yara", "Zoe", "Ama", "Bri", "Cy", "Dee"];
const MEN = ["Al", "Ben", "Cal", "Dan", "Eli", "Finn", "Gus", "Hal", "Ian", "Jay", "Kai", "Leo", "Max", "Ned", "Oto", "Pat", "Ray", "Sam", "Ted", "Uri",
  "Vic", "Walt", "Xan", "Yves", "Zed", "Abe", "Bo", "Cole", "Drew", "Ezra"];
const woman = (i: number): MemberId => `w${i}`, man = (i: number): MemberId => `m${i}`;

test("the monitor turns photo standing off on production outcomes whose gap predicts nothing", async () => {
  const wiring = appWiring("slop");
  const specs: Spec[] = [];
  for (let i = 0; i < PAIRS; i++) {
    specs.push({ id: woman(i), name: `${WOMEN[i]} Doe`, age: 30, romance: { is: "woman", seeks: ["man"] } });
    specs.push({ id: man(i), name: `${MEN[i]} Roe`, age: 31, romance: { is: "man", seeks: ["woman"] } });
  }
  const w = new Mini(specs, { app: "slop", pack: wiring.pack, hooks: wiring.hooks, plans: false, review: "auto", engine: { ...wiring.engine } });
  for (let i = 0; i < PAIRS; i++) for (const id of [woman(i), man(i)]) {
    w.facets.push(appearanceFacet(id, { age: 30 }, { face: -1.5 + i / 10, body: -1.5 + i / 10, overall: -1.5 + i / 10, confidence: 0.9, photos: 3, model: "test-rater" }, w.clock.now()));
  }
  for (let i = 0; i < PAIRS; i++) for (const [id, lines] of [
    [woman(i), ["hi", `${WOMEN[i]}, 30`, "I'm a woman into men. Live in Greenpoint, love climbing and live music", "I'm a woman looking for men, 25 to 38, within 5 miles of 11222", "Something serious, no smokers", "Yes"]],
    [man(i), ["hi", `${MEN[i]}, 31`, "I'm a man into women. Williamsburg, I climb and go to shows", "I'm a man looking for women, 25 to 38, within 5 miles of 11211", "A relationship, no smokers", "Yes"]],
  ] as const) for (const line of lines) { await w.say(id, line); w.clock.advance(60_000); }
  expect(w.net.memberList().filter(m => m.stage === "active")).toHaveLength(2 * PAIRS);

  const answered = new Set<number>();
  const drive = async (days: number, answer: (id: MemberId) => string) => {
    for (let h = 0; h < days * 24; h++) {
      await w.run(HOUR);
      for (const m of w.net.memberList()) if (m.awaiting?.kind === "probe") await w.say(m.id, answer(m.id));
      for (const [i, s] of w.sent.entries()) {
        const checkIn = s.meta.type === "feedback_request", reminder = s.meta.type === "reminder" && s.body.includes("?"), question = s.meta.type === "question";
        if (answered.has(i) || !(checkIn || reminder || question)) continue;
        answered.add(i);
        await w.say(s.to, checkIn ? "It was nice, we both came." : reminder ? "Yes, still good" : "A walk or coffee");
      }
    }
  };

  const dates = Array.from({ length: PAIRS }, (_, i) => w.propose([woman(i), man(PAIRS - 1 - i)], { category: "romance", objective: "a date" }));
  await drive(9, () => "Yes, the first time works");
  for (const id of dates) expect(w.net.opps.get(id)?.stage).toBe("done");
  const declines = Array.from({ length: PAIRS }, (_, i) => w.propose([woman(i), man(i)], { category: "romance", objective: "a date" }));
  await drive(3, () => "No thanks");
  for (const id of declines) expect(w.net.opps.get(id)?.stage).toBe("closed");
  const CHAINS = 4;
  await drive(8, () => "No thanks");
  const decliners = new Set(Array.from({ length: CHAINS }, (_, c) => woman(c)));
  const chains = Array.from({ length: CHAINS }, (_, c) => w.propose([woman(c), man(c + 10)], { category: "romance", objective: "a date", alternates: [woman(c + 20)] }));
  await drive(9, id => (decliners.has(id) ? "No thanks" : "Yes, the first time works"));
  expect(w.log("probe_replaced")).toHaveLength(CHAINS);
  for (const [c, id] of chains.entries()) {
    expect(w.net.opps.get(id)?.stage).toBe("done");
    expect(w.net.opps.get(id)?.participants).toEqual([woman(c + 20), man(c + 10)]);
  }

  const records = w.net.exportState().interactions;
  expect(records.filter(r => r.outcome === "completed").length).toBeGreaterThanOrEqual(PAIRS);
  expect(records.filter(r => r.outcome === "expired")).toHaveLength(PAIRS);
  expect(records.some(r => r.acceptedBy || r.declinedBy?.length)).toBe(false);
  for (let c = 0; c < CHAINS; c++) expect(records.some(r => r.participants.includes(woman(c)) && r.participants.includes(man(c + 10)))).toBe(false);

  const now = w.clock.now();
  const validity = wiring.dateStanding!(buildWorld(w.net.packInput(now), resolveConfig(wiring.engine), localEmbed));
  expect(validity.positives).toBe(PAIRS + CHAINS);
  expect(validity.negatives).toBe(PAIRS);
  expect(validity.predicts).toBe(false);
  const report = biasReport("slop:nyc", "slop", [], [], now, { dateStanding: validity });
  expect(biasAlerts(report)).toContain(`[alert] bias slop:nyc: the Date lane does not use photo standing (the standing gap does not predict mutual yes; ${PAIRS + CHAINS} positive, ${PAIRS} negative outcomes)`);
  const shown = JSON.stringify(report);
  for (const id of [woman(0), man(0), "appearance", "overall="]) expect(shown).not.toContain(id);
}, 600_000);
