#!/usr/bin/env bun
// The nightly scrubbed export (PRD 36.9; docs/runbook-dr.md section 4). Writes local files only.
//   bun run scripts/export-nightly.ts                     # the dev database -> runs/exports/<date>/
//   bun run scripts/export-nightly.ts --url <db> --out <dir> [--full]
// Each table of the network, platform and notify schemas becomes <schema>.<table>.jsonl, with member
// words and identifiers replaced by "[scrubbed]" (message bodies, names, bios, facet values, notes,
// phone numbers, addresses, emails), plus manifest.json (row counts and sha256 per file). Tables
// that hold secrets or the whole Network state (sessions, codes, tokens, network_state) are left out.
// --full also writes a pg_dump (custom format) next to it: that file is NOT scrubbed; keep it local.
//
// Remote upload is off. --upload sends the scrubbed files (never the full dump) to EXPORT_UPLOAD_URL
// only when EXPORT_UPLOAD_APPROVED=1 is also set, a founder decision that is not taken (the R2 bucket
// and its keys do not exist yet). Without both, --upload refuses and exits 2.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SQL } from "bun";

const REPO = resolve(import.meta.dir, "..");
const { values: a } = parseArgs({ options: { url: { type: "string" }, out: { type: "string" }, full: { type: "boolean", default: false }, upload: { type: "boolean", default: false } } });

/** Columns whose values are member words or identifiers. */
export const SCRUB = new Set(["body", "text", "note", "name", "bio", "value", "e164", "address", "email", "phone", "home_area", "occupation", "community", "objective", "explanations", "details", "detail", "title", "summary_text"]);
/** Tables that are never exported (secrets, or the whole Network state with every member's words). */
export const SKIP = new Set(["platform.otp_challenges", "platform.sessions", "platform.rate_limits", "platform.pending_texts", "network.network_state", "notify.task_tokens", "network.matching_run_inputs"]);

export function scrubRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[k] = v !== null && v !== undefined && SCRUB.has(k) ? "[scrubbed]" : v;
  return out;
}

if (import.meta.main) {
  let url = a.url ?? process.env.NETWORK_DATABASE_URL;
  if (!url) {
    const { DEV_PG_URL, devPgUp } = await import("../packages/observatory/db/dev-pg.ts");
    await devPgUp();
    url = DEV_PG_URL;
  }
  if (a.upload && !(process.env.EXPORT_UPLOAD_APPROVED === "1" && process.env.EXPORT_UPLOAD_URL)) {
    console.error("refusing to upload: remote upload needs EXPORT_UPLOAD_URL and EXPORT_UPLOAD_APPROVED=1 (founder approval; docs/runbook-dr.md)");
    process.exit(2);
  }
  const day = new Date().toISOString().slice(0, 10);
  const out = a.out ?? join(REPO, "runs", "exports", day);
  mkdirSync(out, { recursive: true });
  const sql = new SQL({ url, max: 1 });
  const manifest: { at: string; tables: Record<string, { rows: number; sha256: string }>; skipped: string[]; full?: string } = { at: new Date().toISOString(), tables: {}, skipped: [] };
  try {
    const tables = await sql`select schemaname, tablename from pg_tables where schemaname in ('network', 'platform', 'notify') order by 1, 2`;
    for (const t of tables as any[]) {
      const name = `${t.schemaname}.${t.tablename}`;
      if (SKIP.has(name)) { manifest.skipped.push(name); continue; }
      const rows = await sql.unsafe(`select * from "${t.schemaname}"."${t.tablename}"`);
      const text = (rows as Record<string, unknown>[]).map(r => JSON.stringify(scrubRow(r))).join("\n") + (rows.length ? "\n" : "");
      const file = join(out, `${name}.jsonl`);
      writeFileSync(file, text);
      manifest.tables[name] = { rows: rows.length, sha256: createHash("sha256").update(text).digest("hex") };
    }
  } finally { await sql.close(); }
  if (a.full) {
    const { pgBin } = await import("../packages/observatory/db/dev-pg.ts");
    const file = join(out, "full.dump");
    const p = Bun.spawn([pgBin("pg_dump"), "-Fc", "-f", file, "-d", url], { stdout: "ignore", stderr: "inherit", env: { ...process.env, LC_ALL: "C" } });
    if ((await p.exited) !== 0) { console.error("pg_dump failed"); process.exit(1); }
    manifest.full = "full.dump (not scrubbed: keep it local)";
  }
  writeFileSync(join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ out, tables: Object.keys(manifest.tables).length, rows: Object.values(manifest.tables).reduce((n, t) => n + t.rows, 0), skipped: manifest.skipped.length, full: !!a.full }));
  if (a.upload) {
    // Reached only with EXPORT_UPLOAD_APPROVED=1 and EXPORT_UPLOAD_URL (checked above). The scrubbed files only.
    for (const f of [...Object.keys(manifest.tables).map(t => `${t}.jsonl`), "manifest.json"]) {
      const r = await fetch(`${process.env.EXPORT_UPLOAD_URL!.replace(/\/$/, "")}/${day}/${f}`, { method: "PUT", body: readFileSync(join(out, f)) });
      if (!r.ok) { console.error(`upload of ${f} failed: HTTP ${r.status}`); process.exit(1); }
    }
    console.log("uploaded");
  }
}
