import { expect, test } from "vitest";
import { DAY, SimClock } from "@thenetwork/core";
import type { CapitalEvent } from "../../capital/src/types.ts";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";

test.skipIf(!pgAvailable)("a restart replays the stored capital events into the same ledger, and a refused event is not stored", async () => {
  const url = await migratedDb("capital_ledger_replay");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const replica = () => new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => new DryRunAdapter(() => {}),
    env: { PLATFORM_ENV: "dev" }, networks: [{ id: "friends:nyc", matchingEnabled: false }],
  });
  const first = replica();
  let restarted: NetworkService | undefined;
  const t0 = clock.now(), t1 = t0 + DAY, t2 = t0 + 2 * DAY;
  const joined = (member: string, t: number, vouchedBy?: string): CapitalEvent =>
    ({ id: `member_joined:${member}`, t, type: "member_joined", member, age: 30, ...(vouchedBy ? { vouchedBy } : {}) });
  try {
    await first.start();
    const rt = first.runtimes.get("friends:nyc")!;
    const commit = (events: CapitalEvent[]) => rt.unitOfWork(() => { rt.unit.capital.push(...events); });
    await commit([joined("cap_voucher", t0), joined("cap_provider", t0)]);
    await commit([joined("cap_invitee", t1, "cap_voucher"), { id: "member_activated:cap_invitee", t: t1, type: "member_activated", member: "cap_invitee" }]);
    await commit([{ id: "value_received:cap_invitee", t: t2, type: "value_received", member: "cap_invitee", with: ["cap_provider"], confirmedBy: ["cap_provider"] }]);
    const live = rt.capital.ledger.all().map(e => [e.member, e.category, e.amount]);
    expect(live).toContainEqual(["cap_voucher", "vouch", expect.any(Number)]);

    await commit([joined("cap_late", t0)]);
    expect(rt.capital.rejects().map(r => r.id)).toContain("member_joined:cap_late");
    expect(await sql`select id from network.capital_events where app_id = 'friends' and id = 'member_joined:cap_late'`).toEqual([]);

    restarted = replica();
    await restarted.start();
    const replayed = restarted.runtimes.get("friends:nyc")!.capital;
    expect(replayed.ledger.all().map(e => [e.member, e.category, e.amount])).toEqual(live);
    expect(replayed.rejects()).toEqual([]);
  } finally {
    await first.close();
    await restarted?.close();
    await sql.close();
    await dropDb(url);
  }
}, 120_000);
