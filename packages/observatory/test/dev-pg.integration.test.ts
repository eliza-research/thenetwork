// Cold-start the real development cluster. The other database tests reuse an existing server,
// which cannot detect a mismatch between initdb's bootstrap role and the helper's login.
import { expect, test } from "bun:test";
import { SQL } from "bun";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pgAvailable } from "./pg.ts";

if (!pgAvailable && process.env.REQUIRE_PG === "1") throw new Error("Postgres required");

test.skipIf(!pgAvailable)("dev Postgres: fresh clusters use the configured login and preserve data across a restart", async () => {
  const root = resolve(import.meta.dir, "../../../runs");
  await mkdir(root, { recursive: true });
  const entry = fileURLToPath(new URL("../db/dev-pg.ts", import.meta.url));
  const failures: string[] = [];
  let opened = 0, reopened = 0;
  for (const user of [undefined, `bootstrap_${process.pid}`]) {
    const dir = await mkdtemp(join(root, "dev-pg-bootstrap-"));
    const holder = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
    const port = holder.port!;
    holder.stop(true);
    if (port === 54329) throw new Error("The selected port is reserved for another tool");
    const env: NodeJS.ProcessEnv = { ...process.env, OBSERVATORY_PG_DIR: dir, OBSERVATORY_PG_PORT: String(port) };
    if (user === undefined) delete env.USER;
    else env.USER = user;
    const expectedUser = user ?? "postgres";
    const url = `postgres://${expectedUser}@localhost:${port}/network`;
    const invoke = async (action: "up" | "down") => {
      const child = Bun.spawn([process.execPath, "run", "--conditions", "eliza-source", entry, action], { env, stdout: "pipe", stderr: "pipe" });
      const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      return { code, stdout, stderr };
    };
    try {
      const first = await invoke("up");
      if (first.code !== 0) { failures.push(`${expectedUser}: ${first.stderr.trim()}`); continue; }
      const sql = new SQL({ url, max: 1 });
      try {
        expect((await sql`select current_user as name`)[0].name).toBe(expectedUser);
        expect((await sql`select to_regclass('network.members') as table_name`)[0].table_name).toBe("network.members");
        await sql`create table bootstrap_probe (value integer not null)`;
        await sql`insert into bootstrap_probe values (42)`;
        opened++;
      } finally { await sql.close(); }
      expect((await invoke("down")).code).toBe(0);
      const second = await invoke("up");
      if (second.code !== 0) { failures.push(`${expectedUser} restart: ${second.stderr.trim()}`); continue; }
      const saved = new SQL({ url, max: 1 });
      try {
        expect((await saved`select current_user as name`)[0].name).toBe(expectedUser);
        const rows = await saved`select value from bootstrap_probe`;
        expect(rows.length).toBe(1);
        expect(rows[0].value).toBe(42);
        reopened++;
      } finally { await saved.close(); }
    } finally {
      await invoke("down");
      // Never remove a running cluster or a path outside this test's generated directory.
      if (existsSync(join(dir, "postmaster.pid"))) throw new Error(`Test cluster did not stop: ${dir}`);
      if (dirname(resolve(dir)) !== root) throw new Error("Test directory escaped its root");
      await rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  }
  console.log(`dev Postgres bootstrap: ${opened}/2 fresh starts, ${reopened}/2 persisted restarts`);
  expect(failures).toEqual([]);
  expect(opened).toBe(2);
  expect(reopened).toBe(2);
}, 120_000);
