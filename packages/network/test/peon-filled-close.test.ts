// "We filled it" by text (docs/research/2026-11-07-state-machines.md, module matching_engine, SD-327):
// the real ConsentNetwork with the peon pack and hooks in the small NYC world (mini.ts), with the
// world's rows as the database (a confirmed posting is written to them and the snapshot makes it a job
// seat, as service/snapshot.ts does). A manager's text close always saved closedReason "closed", so a
// posting the manager filled read as closed, and only staff could record "filled".
import { describe, expect, test } from "bun:test";
import { PEON_ENGINE_CONFIG, peonSeats } from "@thenetwork/engine";
import { postingFacts, POSTING_COPY, type JobPosting } from "../src/jobs.ts";
import { appWiring } from "../service/packs.ts";
import { Mini } from "./mini.ts";

class SeatMini extends Mini {
  override ctx() { const c = super.ctx(); return { ...c, snapshot: () => peonSeats(c.snapshot()) }; }
}

function world() {
  const saved: JobPosting[] = [];
  const wiring = appWiring("peon");
  let w!: SeatMini;
  w = new SeatMini([{ id: "hm1", name: "Rowan Abbott", age: 34 }], {
    app: "peon", pack: wiring.pack!, hooks: wiring.hooks!, engine: { ...PEON_ENGINE_CONFIG, cities: ["nyc"] },
    onPosting: p => {
      saved.push(p);
      const { intent, facets } = postingFacts(p);
      for (let i = w.intents.length - 1; i >= 0; i--) if (w.intents[i]!.id === p.id) w.intents.splice(i, 1);
      for (let i = w.facets.length - 1; i >= 0; i--) if (w.facets[i]!.tags.includes(`peon:posting:${p.id}`)) w.facets.splice(i, 1);
      w.intents.push(intent); w.facets.push(...facets);
    },
  });
  return { w, saved };
}

describe("peon posting closed by text", () => {
  test("\"we filled the role\" closes the posting as filled; \"close my post\" as closed", async () => {
    const { w, saved } = world();
    for (const a of ["hi!", "Work, mostly.", "Weekday evenings.", "One-on-one is good."]) await w.say("hm1", a);
    const last = () => w.to("hm1").at(-1)?.body;
    for (const title of ["barista", "cook"]) {
      w.clock.advance(60_000); // a new post's id carries the time
      await w.say("hm1", `We're hiring a ${title}, 1 opening, $40k-$50k, onsite in Brooklyn`);
      await w.say("hm1", "yes");
      expect(last()).toMatch(new RegExp(`^Posted: ${title}\\.`));
    }

    await w.say("hm1", "We filled the barista role");
    expect(last()).toBe(POSTING_COPY.readBackClose("barista"));
    await w.say("hm1", "yes");
    expect(last()).toBe(POSTING_COPY.closed("barista"));
    expect(saved.at(-1)).toMatchObject({ title: "barista", status: "closed", closedReason: "filled" });

    await w.say("hm1", "Close my cook post");
    expect(last()).toBe(POSTING_COPY.readBackClose("cook"));
    await w.say("hm1", "yes");
    expect(saved.at(-1)).toMatchObject({ title: "cook", status: "closed", closedReason: "closed" });
  });
});
