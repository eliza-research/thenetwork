// SD-501 (observatory D23): after a meeting the Network resolves attendance from the post-meeting answers
// (finalize: present, said they could not make it, ghosted). The console rows must carry that result: a
// member who said yes to a meeting that is done but who did not come is not "attended". Real mode reads
// these rows for the show rate, meetings attended and activation.
// Postgres (the local dev cluster); skipped without it.
import { afterAll, describe, expect, test } from "bun:test";
import { DAY } from "@thenetwork/core";
import { RealSource } from "../../observatory/src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { PgStore } from "../src/index.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"] });

describe.skipIf(!pgAvailable)("meeting attendance in the console rows (Postgres)", () => {
  const close: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of close.reverse()) await c(); await dropTestDb(); });

  test("a member who said they could not make it reads as no_show; the one who came reads as attended", async () => {
    const url = await testDb();
    const store = new PgStore(url);
    close.push(() => store.close());
    // A participation row needs its member row (the writer's job in production).
    for (const [id, name] of [["a", "Ada Park"], ["b", "Ben Cho"]]) await store.sql`insert into network.members (id, name, home_city, account_status, age, joined_at) values (${id}, ${name}, 'nyc', 'active', 30, now())`;
    const w = new Mini([climber("a", "Ada Park"), climber("b", "Ben Cho")]);
    await w.onboard("a", "b");
    const oppId = w.propose(["a", "b"]);
    await w.answerProbes(["a", "b"]);
    expect(w.meetings.length).toBe(1);
    const asked = (id: string) => w.sent.some(s => s.to === id && s.meta.type === "feedback_request");
    expect(await w.runUntil(() => asked("a") && asked("b"), 8 * DAY)).toBe(true);

    // Before anyone answers, the meeting is done but attendance is not known yet.
    await store.save({ ...w.net.exportState(), savedAt: w.clock.now() });
    const read = async () => {
      const real = new RealSource({ url, app: "ntwrk", pollMs: 3_600_000, pushMs: 3_600_000, service: false });
      close.push(() => real.dispose());
      await real.init();
      return real.state().opportunities.find(x => x.id === oppId)!;
    };
    const before = await read();
    expect(before.state).toBe("COMPLETED");
    expect(before.status["a"]).not.toBe("attended");
    expect(before.status["b"]).not.toBe("attended");

    await w.say("a", "It was great, thanks!");
    await w.say("b", "Sorry, I couldn't make it in the end.");
    await w.run(2 * 3_600_000);
    expect(w.log("attendance").some(l => l.detail.oppId === oppId)).toBe(true);
    await store.save({ ...w.net.exportState(), savedAt: w.clock.now() });
    const o = await read();
    expect(o.status["a"]).toBe("attended");
    expect(o.status["b"]).toBe("no_show");
  }, 120_000);
});
