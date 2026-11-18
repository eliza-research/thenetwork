import { expect, setSystemTime, test } from "bun:test";
import { SQL } from "bun";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DAY, SimClock } from "@thenetwork/core";
import { BlooioAdapter } from "../../network/service/channel.ts";
import { NetworkService } from "../../network/service/service.ts";
import { rowsFromGame, writeRows } from "../db/writer.ts";
import { createServer } from "../src/server.ts";
import { GameSource } from "../src/sources/game.ts";
import { FileAudit } from "../src/staff.ts";
import type { ObsState } from "../src/types.ts";
import { dropTestDb, pgAvailable, testDb } from "./pg.ts";

test.skipIf(!pgAvailable)("read receipts preserve delivered proactive counts and interruption scores through the real HTTP reader", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-read-receipts-"));
  const g = new GameSource({ seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 });
  let sql: SQL | undefined, svc: NetworkService | undefined, server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    await g.init();
    await g.control({ type: "step", ms: 5 * DAY });
    const rows = rowsFromGame(g), message = rows.messages.find(m => m.direction === "outbound" && m.proactive && !m.system && m.status === "delivered");
    if (!message) throw Error("Native world produced no delivered proactive message");
    const clock = new SimClock(g.world.clock.now());
    setSystemTime(clock.now());
    const url = await testDb();
    sql = new SQL({ url, max: 2 });
    await writeRows(sql, rows, { truncate: true });
    // A persisted provider receipt for one native delivered message; no provider send is made.
    await sql`insert into platform.outbound (id,app_id,member_id,line,to_address,kind,body,fingerprint,time_zone,status,next_attempt_at,created_at,updated_at,provider_message_id,transport,sent_at,delivered_at)
      values (${message.id},'ntwrk',${message.member_id},'+12125550170','+12125550171','proactive','Synthetic receipt fixture',${message.id},'UTC','delivered',${message.ts},${message.ts},${message.ts},'local-read-receipt','imessage',${message.ts},${message.ts})`;
    svc = new NetworkService({ url, clock, networks: [{ id: "ntwrk:nyc" }], notify: false, photoStorage: null, env: { PLATFORM_ENV: "dev" }, log: () => {},
      adapter: (_net, rt) => new BlooioAdapter({ clock, app: rt.app.id, from: "+12125550170", env: { PLATFORM_ENV: "dev" },
        provider: { kind: "sim", send: async () => { throw Error("This receipt test must not send"); } }, log: () => {} }) });
    const token = "synthetic-read-receipts-token".padEnd(40, "x"), headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
    server = await createServer({ port: 0, mode: "real", development: false, token, platformEnv: "dev", staffRolesUrl: false, peopleUrl: false,
      audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab") }, real: { url, service: false, pollMs: 3_600_000, pushMs: 3_600_000 } });
    const read = async () => {
      const r = await fetch(`${server!.url}/api/state?mode=real&app=ntwrk`, { headers });
      expect(r.status).toBe(200);
      const state = await r.json() as ObsState;
      expect(state.env.error).toBeUndefined();
      return state;
    };
    const target = (s: ObsState) => ({ proactive: s.stats.proactive,
      member: s.members.find(m => m.id === message.member_id)!.counters.proactive,
      scorecard: s.stats.scorecard!.filter(m => ["worthwhile_interruption", "attention_burden"].includes(m.key)) });
    const before = await read();
    expect(before.stats.proactive).toBeGreaterThan(0);
    const rt = svc.runtimes.get("ntwrk:nyc")!;
    const receipt = await rt.adapter.status!({ kind: "status", channel: "sim", providerMessageId: "local-read-receipt", status: "read", at: clock.now() });
    if (!receipt) throw Error("Delivered receipt did not advance to read");
    await rt.storeStatuses([receipt]);
    expect((await sql`select status from network.messages where id=${message.id}`)[0].status).toBe("read");
    const refresh = await fetch(`${server.url}/api/control?mode=real&app=ntwrk`, { method: "POST", headers, body: JSON.stringify({ type: "refresh" }) });
    expect(refresh.status).toBe(200);
    expect((await refresh.json()).ok).toBe(true);
    const after = await read();
    expect(target(after)).toEqual(target(before));
    expect(after.stats.messages).toBe(before.stats.messages);
    expect(after.stats.outbound).toBe(before.stats.outbound);
    expect(await rt.adapter.status!({ kind: "status", channel: "sim", providerMessageId: "local-read-receipt", status: "delivered", at: clock.now() })).toBeUndefined();
  } finally {
    await server?.stop();
    await svc?.close();
    await sql?.close();
    await g.dispose();
    setSystemTime();
    await dropTestDb();
    if (!resolve(dir).startsWith(resolve(tmpdir(), "obs-read-receipts-"))) throw Error("Unexpected temporary path");
    await rm(dir, { recursive: true, force: true });
  }
}, 180_000);
