import { expect, test } from "vitest";
import { MINUTE, SimClock } from "@thenetwork/core";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { TURN_PATH, type TurnRequest } from "../../core/src/svc/contract.ts";
import { svcSign } from "../../core/src/svc/svc-auth.ts";
import { dropDb, migratedDb, pgAvailable } from "../../platform/test/pg.ts";
import { DryRunAdapter } from "../service/channel.ts";
import { NetworkService } from "../service/service.ts";
import { loadSnapshot } from "../service/snapshot.ts";

test.skipIf(!pgAvailable)("START restores texts without ending a scheduled pause", async () => {
  const url = await migratedDb("start_participation_window");
  const sql = new SQL(url);
  const clock = new SimClock(Date.UTC(2026, 10, 16, 16));
  const phone = "+12125550181";
  const secret = "synthetic-start-participation-window-fixture";
  const service = new NetworkService({
    url, clock, log: () => {}, photoStorage: null, adapter: () => new DryRunAdapter(() => {}),
    env: { PLATFORM_ENV: "dev", SERVICE_TURN_SECRET: secret },
    networks: [{ id: "friends:nyc", matchingEnabled: false }],
  });
  let turnCount = 0;
  const say = async (text: string) => {
    clock.advance(MINUTE);
    const input: TurnRequest = { app: "friends", text, from: phone, messageId: `start-window-${++turnCount}`, channel: "blooio", transport: "imessage", receivedAt: clock.now(), to: null };
    const body = JSON.stringify(input);
    const auth = await svcSign(secret, { method: "POST", path: TURN_PATH, id: input.messageId, body, nowS: Math.floor(clock.now() / 1000) });
    return service.fetch(new Request(`http://localhost${TURN_PATH}`, { method: "POST", headers: { "content-type": "application/json", ...auth }, body }));
  };
  const member = async () => (await sql`select * from network.members where app_id='friends'`)[0];
  const stateAt = async (at: number) => (await loadSnapshot(sql, at, { app: "friends" })).members[0]?.state;

  try {
    await service.start();
    for (const message of ["friends.help", "Ari, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) {
      expect((await say(message)).status).toBe(200);
    }
    const from = "2026-11-18T00:00:00.000Z", until = "2026-11-20T00:00:00.000Z";
    await sql`update network.members set participation_state='normal',
      participation_window=${{ state: "paused", from, until, note: null }}::jsonb where app_id='friends'`;
    expect(await stateAt(Date.parse(from))).toBe("paused");

    expect((await say("STOP")).status).toBe(200);
    expect((await say("START")).status).toBe(200);

    expect((await member()).participation_window).toMatchObject({ state: "paused", from, until });
    expect(await stateAt(Date.parse(from))).toBe("paused");
    expect(await stateAt(Date.parse(until))).toBe("normal");

    expect((await say("Pause matching")).status).toBe(200);
    expect((await member()).participation_state).toBe("paused");
    expect((await say("START")).status).toBe(200);
    expect((await member()).participation_state).toBe("paused");
    expect(await stateAt(clock.now())).toBe("paused");
  } finally {
    await service.close().catch(() => {});
    await sql.close().catch(() => {});
    await dropDb(url);
  }
}, 120_000);
