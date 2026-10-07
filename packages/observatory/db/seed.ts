#!/usr/bin/env bun
// Load a dev/staging `network` database for the observatory's real-world mode.
//   bun run packages/observatory/db/seed.ts --from-dataset                 # the 500 synthetic members (public files)
//   bun run packages/observatory/db/seed.ts --from-sim --days 14 --seed 1  # a whole simulated run (messages, outcomes...)
// Options: --url (default NETWORK_DATABASE_URL or the local dev cluster), --allow-remote (refused otherwise).
import { parseArgs } from "node:util";
import { SQL } from "bun";
import { DAY } from "@thenetwork/core";
import { GameSource } from "../src/sources/game.ts";
import { applySchema, DEV_PG_URL, devPgUp } from "./dev-pg.ts";
import { rowsFromDataset, rowsFromGame, writeRows } from "./writer.ts";

export function isLocalUrl(url: string): boolean {
  try { return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(new URL(url).hostname); } catch { return false; }
}

export async function seedFromSim(url: string, opts: { days: number; seed: number; personas?: number; engine?: "engine-v1" | "random" | "off" }) {
  const g = new GameSource({ seed: opts.seed, personas: opts.personas ?? 0, engine: opts.engine ?? "engine-v1", days: Math.max(opts.days, 1) });
  await g.init();
  await g.control({ type: "step", ms: opts.days * DAY });
  const rows = rowsFromGame(g);
  const sql = new SQL(url);
  const counts = await writeRows(sql, rows, { truncate: true });
  await sql.close();
  return { game: g, counts };
}

if (import.meta.main) {
  const { values: a } = parseArgs({ options: {
    url: { type: "string" }, "from-dataset": { type: "boolean", default: false }, "from-sim": { type: "boolean", default: false },
    days: { type: "string", default: "14" }, seed: { type: "string", default: "1" }, personas: { type: "string", default: "0" },
    engine: { type: "string", default: "engine-v1" }, "allow-remote": { type: "boolean", default: false },
  } });
  let url = a.url ?? process.env.NETWORK_DATABASE_URL;
  if (!url) url = await devPgUp();
  if (!isLocalUrl(url) && !a["allow-remote"]) { console.error(`refusing to write to non-local database ${new URL(url).hostname} (pass --allow-remote for staging)`); process.exit(1); }
  await applySchema(url);
  const t0 = performance.now();
  if (a["from-sim"]) {
    const { game, counts } = await seedFromSim(url, { days: Number(a.days), seed: Number(a.seed), personas: Number(a.personas), engine: a.engine as any });
    await game.dispose();
    console.log(JSON.stringify({ url: url.replace(/\/\/[^@]*@/, "//"), source: `sim seed=${a.seed} days=${a.days}`, counts, ms: Math.round(performance.now() - t0) }, null, 2));
  } else {
    const sql = new SQL(url);
    const counts = await writeRows(sql, await rowsFromDataset(), { truncate: true });
    await sql.close();
    console.log(JSON.stringify({ url: url.replace(/\/\/[^@]*@/, "//"), source: "synthetic dataset v1", counts, ms: Math.round(performance.now() - t0) }, null, 2));
  }
  process.exit(0);
}
export { DEV_PG_URL };
