#!/usr/bin/env bun
// Replay one live engine run from what it read (packages/network/service/runInputs.ts; migration 0016;
// audit ME-004) and diff the proposals against the ones it made.
//   bun run scripts/replay-run.ts --list [--app slop]          # the stored runs (last 30 days)
//   bun run scripts/replay-run.ts <run id> [--url <db>] [--json]
// The run's table has member data and row-level security: use the migration (owner) login, never the
// service or a console login. No LLM is called: a run whose judge was on (models.judge) replays without it,
// so its scores can differ. Exit code 1 when the proposals differ.
import { parseArgs } from "node:util";
import { SQL } from "bun";
import { replayRun } from "../packages/network/service/runInputs.ts";

const { values: a, positionals } = parseArgs({
  allowPositionals: true,
  options: { url: { type: "string" }, list: { type: "boolean", default: false }, app: { type: "string" }, json: { type: "boolean", default: false } },
});
let url = a.url ?? process.env.MIGRATION_DATABASE_URL ?? process.env.NETWORK_DATABASE_URL;
if (!url) {
  const { DEV_PG_URL, devPgUp } = await import("../packages/observatory/db/dev-pg.ts");
  await devPgUp();
  url = DEV_PG_URL;
}
const sql = new SQL({ url, max: 1 });
try {
  if (a.list || !positionals[0]) {
    const rows = await sql`select run_id, app_id, at, engine_version, jsonb_array_length(proposals)::int as proposals, models->>'judge' as judge from network.matching_run_inputs
      where (${a.app ?? null}::text is null or app_id = ${a.app ?? null}) order by at desc limit 50`;
    for (const r of rows as any[]) console.log(`${r.run_id}\t${r.app_id}\t${new Date(r.at).toISOString()}\t${r.engine_version}\t${r.proposals} proposal(s)${r.judge ? `\tjudge ${r.judge}` : ""}`);
    if (!rows.length) console.log("no stored runs");
  } else {
    const [row] = await sql`select * from network.matching_run_inputs where run_id = ${positionals[0]}`;
    if (!row) { console.error(`no stored input for run ${positionals[0]} (kept 30 days)`); process.exit(2); }
    const d = await replayRun(row);
    if (a.json) console.log(JSON.stringify(d, null, 2));
    else {
      console.log(`run ${d.runId} (${d.app}): ${d.same ? "same proposals" : "DIFFERENT"}`);
      console.log(`  input hash  ${d.inputHash.stored ?? "?"} -> ${d.inputHash.replay}`);
      console.log(`  config hash ${d.configHash.stored ?? "?"} -> ${d.configHash.replay}`);
      for (const p of d.added) console.log(`  + ${p.kind} ${p.participants.join(", ")} (${p.score})`);
      for (const p of d.removed) console.log(`  - ${p.kind} ${p.participants.join(", ")} (${p.score})`);
      for (const c of d.changed) console.log(`  ~ ${c.id}: ${c.stored} -> ${c.replay}`);
    }
    process.exitCode = d.same ? 0 : 1;
  }
} finally {
  await sql.close();
}
