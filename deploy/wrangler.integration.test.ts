// Exercise the actual operator wrapper as a child process. bunx is a recording CLI boundary;
// this test never loads Wrangler, reads credentials, authenticates or contacts Cloudflare.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("Wrangler OS-session opt-in preserves context and account/deploy guards", () => {
  const bash = Bun.which("bash");
  if (!bash) throw new Error("This integration test needs Bash on PATH (Git Bash on Windows).");
  const root = mkdtempSync(join(tmpdir(), "ntwrk wrangler cli-"));
  const home = "/synthetic-wrangler-home";
  try {
    const cli = join(root, "bunx");
    writeFileSync(cli, '#!/bin/bash\nprintf \'context=%s\\naccount=%s\\n\' "${XDG_CONFIG_HOME-UNSET}" "$CLOUDFLARE_ACCOUNT_ID"\nprintf \'arg=%s\\n\' "$@"\n');
    chmodSync(cli, 0o700);
    // Let Bash derive its own PATH from cwd: native Windows drive letters cannot
    // be inserted into a colon-separated POSIX PATH. Keep only the recording CLI
    // and shell tools, with no inherited login files, provider env or real bunx.
    const invoke = (extra: Record<string, string>, args = ["whoami"]) => Bun.spawnSync(
      [bash, "--noprofile", "--norc", "-c", 'export PATH="$PWD:/usr/bin:/bin"; exec bash "$@"', "wrangler-test",
        join(import.meta.dir, "../scripts/wrangler.sh").replaceAll("\\", "/"), ...args],
      { cwd: root, env: { HOME: home, CLOUDFLARE_ACCOUNT_ID: "synthetic-account", ...extra } },
    );
    const normal = invoke({});
    expect(normal.exitCode).toBe(0);
    expect(normal.stdout.toString()).toContain(`context=${home}/.config/wrangler-ntwrk`);
    const os = invoke({ NTWRK_WRANGLER_USE_OS_SESSION: "1" });
    expect(os.exitCode).toBe(0);
    expect(os.stdout.toString()).toContain("context=UNSET");
    const explicit = invoke({ NTWRK_WRANGLER_USE_OS_SESSION: "1", XDG_CONFIG_HOME: root + "/operator-context" });
    expect(explicit.stdout.toString()).toContain(`context=${root}/operator-context`);
    expect(explicit.stdout.toString()).toContain("account=synthetic-account");
    expect(invoke({ NTWRK_WRANGLER_USE_OS_SESSION: "1", CLOUDFLARE_ACCOUNT_ID: "" }).exitCode).toBe(2);
    const choices: Record<string, string>[] = [{}, { NTWRK_WRANGLER_USE_OS_SESSION: "1" }];
    for (const choice of choices) {
      const denied = invoke(choice, ["pages", "deploy", "synthetic-dist"]);
      expect(denied.exitCode).toBe(3);
      expect(denied.stdout.toString()).toBe("");
      const approved = invoke({ ...choice, NTWRK_ALLOW_DEPLOY: "1" }, ["pages", "deploy", "synthetic-dist"]);
      expect(approved.exitCode).toBe(0);
      expect(approved.stdout.toString()).toContain("arg=pages\narg=deploy\narg=synthetic-dist");
      expect(invoke(choice, ["pages", "project", "list"]).exitCode).toBe(0);
      expect(invoke(choice, ["deploy", "--dry-run", "--no-dry-run"]).exitCode).toBe(3);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
