// The Cloudflare deploy guard (scripts/wrangler.sh) and the help switch. wrangler (yargs) takes the last
// value of a boolean switch, and a following "true" or "false" word is the value of that switch. So
// "deploy --help --no-help" is a real deploy, not help text. The guard must read the switch the same
// way. bunx is a recording stub: the test never loads wrangler or contacts Cloudflare.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a help switch that a later word turns off does not pass the deploy guard", () => {
  const root = mkdtempSync(join(tmpdir(), "ntwrk-wrangler-help-"));
  try {
    writeFileSync(join(root, "bunx"), "#!/bin/bash\necho ran\n");
    chmodSync(join(root, "bunx"), 0o700);
    const run = (args: string[]) => Bun.spawnSync(["/bin/bash", join(import.meta.dir, "../scripts/wrangler.sh"), ...args],
      { env: { PATH: root + ":/usr/bin:/bin", HOME: root, CLOUDFLARE_ACCOUNT_ID: "synthetic-account" } }).exitCode;
    const refused = [
      ["deploy", "--help", "--no-help"],
      ["deploy", "--help", "--help=false"],
      ["deploy", "-h", "--no-h"],
      ["deploy", "--help", "false"],
      ["deploy", "--dry-run", "false"],
      ["pages", "deploy", "dist", "--help", "--no-help"],
    ];
    const allowed = [
      ["deploy", "--help"],
      ["deploy", "--no-help", "--help"],
      ["deploy", "--help", "true"],
      ["deploy", "--dry-run", "true"],
      ["pages", "deploy", "--help"],
    ];
    expect({
      refused: refused.map(a => [a.join(" "), run(a)]),
      allowed: allowed.map(a => [a.join(" "), run(a)]),
    }).toEqual({
      refused: refused.map(a => [a.join(" "), 3]),
      allowed: allowed.map(a => [a.join(" "), 0]),
    });
  } finally { rmSync(root, { recursive: true, force: true }); }
});
