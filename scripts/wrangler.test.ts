// The deploy guard in scripts/wrangler.sh (audit sites-infra-4, SITE-05 and SITE-06): every command
// that is not on the read-only list exits 3 without NTWRK_ALLOW_DEPLOY=1, wherever its flags are.
// A fake `bunx` on PATH records what would run, so nothing reaches Cloudflare.
//   bun test scripts
import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "wrangler.sh");
const dir = mkdtempSync(join(tmpdir(), "wrangler-guard-"));
writeFileSync(join(dir, "bunx"), '#!/usr/bin/env bash\necho "RAN $*"\n');
chmodSync(join(dir, "bunx"), 0o755);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(args: string[], env: Record<string, string> = {}) {
  const p = Bun.spawnSync(["bash", SCRIPT, ...args], {
    env: { PATH: `${dir}:/usr/bin:/bin`, HOME: dir, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode, out: p.stdout.toString(), err: p.stderr.toString() };
}

const MUTATING: string[][] = [
  ["deploy"],
  ["deploy", "--dry-run=false"],
  // The last value wins in wrangler (yargs): these are real deploys (audit: wrangler.sh guard).
  ["deploy", "--dry-run", "--no-dry-run"],
  ["deploy", "--dry-run", "--dry-run=false"],
  ["versions", "upload", "--dry-run", "--no-dry-run"],
  // dev --remote uploads to the account.
  ["dev", "--remote"],
  ["dev", "-r"],
  ["dev", "--remote=true"],
  ["pages", "deploy", "sites/slop.date/dist", "--project-name", "slop-date", "--branch", "main"],
  ["pages", "secret", "put", "PLATFORM_PROXY_SECRET", "--project-name", "slop-date"],
  ["--config", "wrangler.toml", "deploy"],
  ["-c", "x.toml", "deploy"],
  ["--env", "production", "deploy"],
  ["--some-new-flag", "deploy", "whoami"],
  ["--latest", "deploy"],
  ["publish"],
  ["delete"],
  ["rollback"],
  ["versions", "upload"],
  ["versions", "deploy"],
  ["versions", "secret", "put", "X"],
  ["secret", "put", "PLATFORM_PROXY_SECRET"],
  ["secret", "delete", "X"],
  ["secret", "bulk", "secrets.json"],
  ["kv", "key", "put", "k", "v"],
  ["kv", "namespace", "create", "n"],
  ["kv", "bulk", "put", "f.json"],
  ["r2", "bucket", "create", "b"],
  ["r2", "object", "put", "b/k", "--file", "f"],
  ["d1", "execute", "db", "--command", "drop table x"],
  ["d1", "migrations", "apply", "db"],
  ["pages", "deploy", "dist"],
  ["pages", "project", "create", "p"],
  ["queues", "create", "q"],
  ["triggers", "deploy"],
  ["domains", "add", "x"],
  ["route", "add", "x"],
  ["dispatch-namespace", "create", "x"],
  ["some-future-command"],
  ["DEPLOY"],
];

const READ_ONLY: string[][] = [
  ["whoami"],
  ["--version"],
  ["dev", "--port", "8787"],
  ["--config", "sites/slop.date/wrangler.toml", "dev", "--port", "8788"],
  ["tail", "--format", "pretty"],
  ["types"],
  ["deploy", "--dry-run"],
  ["deploy", "--dry-run", "--outdir", "out"],
  ["deploy", "--no-dry-run", "--dry-run"],
  ["dev", "--remote", "--no-remote"],
  ["pages", "deployment", "list", "--project-name", "slop-date"],
  ["pages", "dev", "sites/slop.date/dist", "--port", "8811"],
  ["versions", "upload", "--dry-run"],
  ["versions", "list"],
  ["deployments", "list"],
  ["secret", "list"],
  ["kv", "namespace", "list"],
  ["kv", "key", "get", "k"],
  ["r2", "bucket", "list"],
  ["d1", "list"],
  ["pages", "project", "list"],
  ["deploy", "--help"],
];

describe("wrangler guard", () => {
  test.each(MUTATING)("refuses %p without approval", (...args) => {
    const r = run(args);
    expect(r.code).toBe(3);
    expect(r.out).toBe("");
    expect(r.err).toContain("refusing to run");
  });

  test.each(READ_ONLY)("runs %p", (...args) => {
    const r = run(args);
    expect(r.code, r.err).toBe(0);
    expect(r.out).toBe(`RAN wrangler@4.136.3 ${args.join(" ")}\n`);
  });

  test("runs a mutating command with NTWRK_ALLOW_DEPLOY=1, and says so", () => {
    const r = run(["deploy"], { NTWRK_ALLOW_DEPLOY: "1" });
    expect(r.code).toBe(0);
    expect(r.out).toBe("RAN wrangler@4.136.3 deploy\n");
    expect(r.err).toContain("NTWRK_ALLOW_DEPLOY=1 set");
  });

  test("NTWRK_ALLOW_DEPLOY must be exactly 1", () => {
    expect(run(["deploy"], { NTWRK_ALLOW_DEPLOY: "true" }).code).toBe(3);
  });

  // Property (fixed seed): any non-allowlisted command, with flags and values anywhere, is refused.
  test("random flag placement never lets a mutating command through", () => {
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
    const flags = [["--config", "x.toml"], ["-e", "prod"], ["--unknown", "val"], ["--remote"], ["--json"], ["--cwd", "sites"], ["--weird"]];
    const cmds = [["deploy"], ["versions", "upload"], ["secret", "put", "S"], ["kv", "key", "put", "a", "b"], ["delete"], ["pages", "deploy", "dist"]];
    for (let i = 0; i < 60; i++) {
      const cmd = cmds[rnd(cmds.length)]!;
      const args: string[] = [...cmd];
      for (let k = rnd(3) + 1; k > 0; k--) {
        const f = flags[rnd(flags.length)]!;
        const at = rnd(args.length + 1);
        args.splice(at, 0, ...f);
      }
      const r = run(args);
      expect(r.code, args.join(" ")).toBe(3);
    }
  });
});
