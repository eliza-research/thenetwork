// The documented setup (CONTRIBUTING.md section 4) copies .env.example, whose optional values are
// empty lines (OBSERVATORY_PG_PORT=, OBSERVATORY_PG_DIR=, PG_BIN_DIR=). The dev cluster startup
// command must read an empty value as "leave the default" (CONTRIBUTING.md section 5.1). Before the
// fix, a copied .env made starting the local dev database fail: an empty data
// directory made mkdir of "" throw ENOENT, and an empty port became 0, which the server refuses.
// This runs the real CLI as a child process, with exactly the values the copied file carries, and
// expects the documented command to start and answer with the default cluster URL (localhost:54339).
// REQUIRE_PG=1 also exercises startup when the availability check fails.
import { spawnProcess } from "../../core/src/runtime/process.ts";
import { describe, expect, test } from "vitest";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SQL } from "../../core/src/runtime/postgres.ts";
import { pgAvailable } from "./pg.ts";

const T = 180_000;
const REPO = join(import.meta.dirname, "..", "..", "..");

describe.skipIf(!pgAvailable && process.env.REQUIRE_PG !== "1")("the dev Postgres startup (Postgres)", () => {
  test("the empty values of a copied .env.example read as 'leave the default': the documented startup command starts the default cluster", async () => {
    const child = spawnProcess([process.execPath, "--import", "tsx", "packages/observatory/db/dev-pg.ts", "up"], {
      cwd: REPO,
      // Exactly what a machine that copied .env.example carries: the optional values present and empty.
      env: { ...process.env, OBSERVATORY_PG_PORT: "", OBSERVATORY_PG_DIR: "", PG_BIN_DIR: "" },
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
      const probe = createServer();
      probe.listen(0, "127.0.0.1");
      await once(probe, "listening");
      const address = probe.address();
      const closing = once(probe, "close");
      probe.close();
      await closing;
      if (!address || typeof address === "string") throw new Error("Expected a TCP test listener");
      const port = address.port;
      if (port === 54329 || port === 54339) throw new Error("Expected an isolated PostgreSQL port");
      const env: Record<string, string | undefined> = { ...process.env, OBSERVATORY_PG_DIR: dir, OBSERVATORY_PG_PORT: String(port) };
      if (user === undefined) delete env.USER;
      else env.USER = user;
      const run = (command: string) => spawnProcess([process.execPath, "--import", "tsx", "packages/observatory/db/dev-pg.ts", command], {
        cwd: REPO, env, stdout: "pipe", stderr: "pipe",
      });
      try {
        const child = run("up");
        const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
        expect({ code, err }).toEqual({ code: 0, err: "" });
        const sql = new SQL(out.trim());
        try {
          const [server] = await sql`select current_user, current_setting('unix_socket_directories') as sockets`;
          expect(server).toEqual({ current_user: user ?? "postgres", sockets: process.platform === "win32" ? "" : "/tmp" });
        } finally { await sql.close(); }
      } finally {
        await run("down").exited;
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, T);
});
