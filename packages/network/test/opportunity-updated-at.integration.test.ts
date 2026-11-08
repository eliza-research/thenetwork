// SD-500 (observatory D22): the Network saves its whole state on each tick, and the save upserts a console row
// for every opportunity. updated_at must say when the row last changed, not when the state was last saved:
// real mode reads it as the close time of a closed opportunity (its age, the range filter, "time in state").
// Postgres (the local dev cluster); skipped without it.
import { afterAll, describe, expect, test } from "bun:test";
import { DAY, HOUR } from "@thenetwork/core";
import { RealSource } from "../../observatory/src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "../../observatory/test/pg.ts";
import { PgStore } from "../src/index.ts";
import { Mini } from "./mini.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });

describe.skipIf(!pgAvailable)("opportunity updated_at across saves (Postgres)", () => {
  const close: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of close.reverse()) await c(); await dropTestDb(); });

  test("a save that does not change an opportunity keeps its updated_at; a change moves it", async () => {
    const url = await testDb();
    const store = new PgStore(url);
    close.push(() => store.close());
    const w = new Mini([{ ...climber("r", "Rae Kim"), wants: [] }, climber("c1", "Cal One"), climber("c2", "Cleo Two")], { review: "human" });
    await w.onboard("r", "c1", "c2");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    const oppId = w.net.reviewQueue()[0]!.oppId;
    const t0 = w.clock.now();
    const updatedAt = async () => (await store.sql`select state, updated_at from network.opportunities where id = ${oppId}`)[0] as { state: string; updated_at: Date };

    await store.save({ ...w.net.exportState(), savedAt: t0 });
    expect((await updatedAt()).state).toBe("IN_REVIEW");
    expect((await updatedAt()).updated_at.getTime()).toBe(t0);

    // The reviewer rejects it: the row changes, so updated_at moves to that save.
    expect(w.net.decide(oppId, "reject", { reviewer: "staff" }).ok).toBe(true);
    const t1 = t0 + HOUR;
    await store.save({ ...w.net.exportState(), savedAt: t1 });
    expect((await updatedAt()).state).not.toBe("IN_REVIEW");
    expect((await updatedAt()).updated_at.getTime()).toBe(t1);

    // Later saves (other work, other ticks) do not change the closed opportunity.
    for (const t of [t1 + DAY, t1 + 3 * DAY]) await store.save({ ...w.net.exportState(), savedAt: t });
    expect((await updatedAt()).updated_at.getTime()).toBe(t1);

    // Real mode reads the close time: its age stops at the close.
    const real = new RealSource({ url, app: "ntwrk", pollMs: 3_600_000, pushMs: 3_600_000, service: false });
    close.push(() => real.dispose());
    await real.init();
    const o = real.state().opportunities.find(x => x.id === oppId)!;
    expect(o.updatedAt).toBe(t1);
  }, 120_000);
});
