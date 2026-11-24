import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { HOUR, SimClock } from "@thenetwork/core";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { dropTestDb, pgAvailable, testDb } from "../../../apps/observatory/test/pg.ts";
import { START } from "./mini.ts";

describe.skipIf(!pgAvailable)("photo relay photo pass: a store fault waits for the next tick and the after-tick work goes on (spec/photoRelayReview.md, NetworkService, Postgres)", () => {
  let sql: SQL | undefined, service: NetworkService | undefined, url = "";
  beforeAll(async () => { url = await testDb(); sql = new SQL({ url, max: 1 }); }, 120_000);
  afterAll(async () => { await service?.close().catch(() => {}); await sql?.close(); await dropTestDb(); });

  test("a failed read of the pending photos is logged for the next tick, the weekly bias monitor still writes its report, and the tick reports no after-tick failure", async () => {
    const clock = new SimClock(START), logs: string[] = [];
    const s = service = new NetworkService({
      url, clock, instance: "photo-expiry-fault", log: line => logs.push(line), env: { PLATFORM_ENV: "dev" }, networks: [{ id: "slop:nyc" }],
      network: { seed: 1 }, photoStorage: null, notify: false, adapter: () => new DryRunAdapter(() => {}),
    });
    await s.start();
    const reports = async () => Number((await sql!`select count(*)::int as n from network.bias_reports where app_id = 'slop' and network_id = 'slop:nyc'`)[0]!.n);
    expect(await reports()).toBe(0);
    const original = s.photoRelay.duePending;
    let reads = 0;
    s.photoRelay.duePending = async () => { reads++; throw new Error("synthetic photo relay store fault"); };
    const mark = logs.length;
    try {
      clock.advance(HOUR);
      await s.tick();
    } finally { s.photoRelay.duePending = original; }
    expect(reads).toBe(1);
    const lines = logs.slice(mark);
    expect(lines).toContain("[photo-relay] the photo pass waits for the next tick (slop:nyc): synthetic photo relay store fault");
    expect(lines.some(line => line.startsWith("[tick] after-tick work failed"))).toBe(false);
    expect(lines.some(line => line.startsWith("[bias] slop:nyc:"))).toBe(true);
    expect(await reports()).toBe(1);
  }, 180_000);
});
