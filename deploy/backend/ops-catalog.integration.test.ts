// spec/opsAlertDispatch.md, "The catalog alerts when its last scan is older than a day and one retry"
import { afterAll, beforeAll, expect, test } from "vitest";
import { MINUTE, SimClock } from "../../packages/core/src/index.ts";
import { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { dropTestDb, testDb } from "../../apps/observatory/test/pg.ts";
import { catalogMetrics, createOps, opsConfigFromEnv, PgAlertStore, type Notice } from "./ops.ts";

const HOUR = 60 * MINUTE;
const clock = new SimClock(Date.UTC(2026, 10, 21, 16));
let sql: SQL;

beforeAll(async () => {
  sql = new SQL({ url: await testDb(), max: 2 });
}, 120_000);
afterAll(async () => {
  await sql?.close();
  await dropTestDb();
});

function runner() {
  const posts: Notice[] = [];
  const ops = createOps({
    config: opsConfigFromEnv({}, { env: "test", build: "test", deployed: false, warn: line => { throw new Error(line); } }), probes: () => [],
    catalog: now => catalogMetrics(sql, now), store: new PgAlertStore(sql), now: () => clock.now(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
    post: async body => { posts.push(...(body as { alerts: Notice[] }).alerts); return true; },
  });
  return async () => {
    const before = posts.length;
    clock.advance(MINUTE);
    await ops.tick();
    return posts.slice(before).filter(a => a.key.startsWith("catalog_")).map(a => `${a.key}=${a.level}:${a.count}:${a.state}`);
  };
}

test("a catalog scan older than a day and one retry raises one warning, and the next successful scan resolves it", async () => {
  await sql`delete from network.public_events`;
  await sql`delete from network.public_event_imports`;
  await sql`insert into network.public_event_imports (source, checked_at) values ('nyc-parks', ${new Date(clock.now() - 24 * HOUR)})`;
  const round = runner();
  expect(await round()).toEqual([]);
  clock.advance(58 * MINUTE);
  expect(await round()).toEqual([]);
  clock.advance(MINUTE);
  expect(await round()).toEqual(["catalog_stale=warn:25:firing"]);
  expect(await round()).toEqual([]);
  await sql`update network.public_event_imports set checked_at = ${new Date(clock.now())} where source = 'nyc-parks'`;
  expect(await round()).toEqual(["catalog_stale=warn:25:resolved"]);
}, 120_000);

test("a process with no successful scan alerts only after it has run for a day and one retry", async () => {
  await sql`delete from network.public_events`;
  await sql`delete from network.public_event_imports`;
  const round = runner();
  expect(await round()).toEqual([]);
  clock.advance(25 * HOUR - 2 * MINUTE);
  expect(await round()).toEqual([]);
  expect(await round()).toEqual(["catalog_stale=warn:0:firing"]);
}, 120_000);
