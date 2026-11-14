// The documented setup (CONTRIBUTING.md section 4) copies .env.example, whose optional values are
// empty lines (OBSERVATORY_PG_PORT=, OBSERVATORY_PG_DIR=, PG_BIN_DIR=). The dev cluster startup
// command must read an empty value as "leave the default" (CONTRIBUTING.md section 5.1). Before the
// fix, a copied .env made `bun run packages/observatory/db/dev-pg.ts up` fail: an empty data
// directory made mkdir of "" throw ENOENT, and an empty port became 0, which the server refuses.
// This runs the real CLI as a child process, with exactly the values the copied file carries, and
// expects the documented command to start and answer with the default cluster URL (localhost:54339).
// Skipped without Postgres, like the other dev-cluster tests.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "bun";
import { pgAvailable } from "./pg.ts";

const T = 180_000;
const REPO = join(import.meta.dir, "..", "..", "..");

describe.skipIf(!pgAvailable)("the dev Postgres startup (Postgres)", () => {
  test("the empty values of a copied .env.example read as 'leave the default': the documented startup command starts the default cluster", async () => {
    const child = Bun.spawn(["bun", "packages/observatory/db/dev-pg.ts", "up"], {
      cwd: REPO,
      // Exactly what a machine that copied .env.example carries: the optional values present and empty.
      env: { ...Bun.env, OBSERVATORY_PG_PORT: "", OBSERVATORY_PG_DIR: "", PG_BIN_DIR: "" } as Record<string, string>,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    // The exit code and the error report in one message, so the failing command shows its cause.
    expect(`exit ${code}: ${err.replace(/\s+/g, " ").slice(0, 180)}`).toBe("exit 0: ");
    expect(out).toContain("localhost:54339/network");
  }, T);

  test("fresh clusters use the login returned by their startup command", async () => {
    for (const user of [undefined, "network_test_owner"]) {
      const dir = mkdtempSync(join(tmpdir(), "network-pg-login-"));
      const probe = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
      const port = probe.port;
      probe.stop();
      if (port === 54329 || port === 54339) throw new Error("Expected an isolated PostgreSQL port");
      const env: Record<string, string | undefined> = { ...Bun.env, OBSERVATORY_PG_DIR: dir, OBSERVATORY_PG_PORT: String(port) };
      if (user === undefined) delete env.USER;
      else env.USER = user;
      const run = (command: string) => Bun.spawn(["bun", "--no-env-file", "packages/observatory/db/dev-pg.ts", command], {
        cwd: REPO, env, stdout: "pipe", stderr: "pipe",
      });
      try {
        const child = run("up");
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ code, err }).toEqual({ code: 0, err: "" });
        const sql = new SQL(out.trim());
        try { expect((await sql`select current_user`)[0].current_user).toBe(user ?? "postgres"); }
        finally { await sql.close(); }
      } finally {
        await run("down").exited;
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, T);
});
