// SD-510 (observatory D15): a reviewer approves an opportunity, and the Network's re-check finds that a
// gate now fails (here: a participant is now busy in another opportunity). The Network closes the opportunity and the
// service answers 409 with the reason. The console must read the database again, as it does after an
// action that succeeded: the closed card must not stay in the review queue until the next poll.
// Postgres (the local dev cluster) and a local fake of the Network service; skipped without Postgres.
import { afterAll, describe, expect, test } from "bun:test";
import { HOUR } from "@thenetwork/core";
import { PgStore } from "../../network/src/index.ts";
import { Mini } from "../../network/test/mini.ts";
import { RealSource } from "../src/sources/real.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

const climber = (id: string, name: string) => ({ id, name, age: 30, area: "Greenpoint", interests: ["climbing", "hiking"], skills: ["belaying"], wants: [{ objective: "find a regular climbing partner", category: "hobby" as const }] });
const long = (t: string) => t.padEnd(32, "-0123456789abcdef");

describe.skipIf(!pgAvailable)("an approval that the re-check invalidates (Postgres)", () => {
  const close: (() => Promise<void>)[] = [];
  afterAll(async () => { for (const c of close.reverse()) await c(); await dropTestDb(); });

  test("the console reads the closed opportunity at once, not at the next poll", async () => {
    const url = await testDb();
    const store = new PgStore(url);
    close.push(() => store.close());
    const w = new Mini([{ ...climber("r", "Rae Kim"), wants: [] }, climber("c1", "Cal One"), climber("c2", "Cleo Two")], { review: "human" });
    await w.onboard("r", "c1", "c2");
    await w.say("r", "Anyone around who'd want to find a regular climbing partner? I'm near Greenpoint.");
    const oppId = w.net.reviewQueue()[0]!.oppId;
    await store.save({ ...w.net.exportState(), savedAt: w.clock.now() });

    // The fake service runs the decision on the Network, saves the state and answers as the service does.
    const decided: { ok: boolean; reason?: string }[] = [];
    const fake = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
      const u = new URL(req.url);
      if (u.pathname === `/review/${oppId}` && req.method === "POST") {
        const { decision } = await req.json() as { decision: "approve" };
        const r = w.net.decide(oppId, decision, { reviewer: "staff" });
        decided.push(r);
        await store.save({ ...w.net.exportState(), savedAt: w.clock.now() + HOUR });
        return r.ok ? Response.json({ ok: true }) : Response.json({ ok: false, reason: r.reason }, { status: 409 });
      }
      return Response.json({ error: "no route" }, { status: 404 });
    } });
    close.push(async () => { fake.stop(true); });

    const real = new RealSource({ url, app: "ntwrk", pollMs: 3_600_000, pushMs: 3_600_000, service: { url: fake.url.href, token: long("console-svc") } });
    close.push(() => real.dispose());
    await real.init();
    expect(real.state().opportunities.find(x => x.id === oppId)?.state).toBe("IN_REVIEW");

    // After the card was loaded, a participant gets busy in another opportunity (its consent check runs).
    const st = w.net.exportState();
    const item = st.opps.find(o => o.id === oppId)!;
    const busy = item.participants.find(p => p !== "r")!;
    const other = item.participants.includes("c2") ? "c1" : "c2";
    st.opps.push({ ...item, id: "other-opp", stage: "probing", participants: [busy, other], status: [[busy, "probing"]], review: undefined });
    w.net.importState(st);
    const out = await real.control({ type: "review", oppId, decision: "approve" }, "staff");
    expect(decided).toEqual([{ ok: false, reason: "busy_elsewhere" }]);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("busy_elsewhere");
    expect((await store.sql`select state from network.opportunities where id = ${oppId}`)[0].state).not.toBe("IN_REVIEW");
    expect(real.state().opportunities.find(x => x.id === oppId)?.state).not.toBe("IN_REVIEW");
  }, 120_000);
});
