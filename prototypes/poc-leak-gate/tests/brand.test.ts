import { test, expect } from "bun:test";
import { readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const tsc = join(root, "../../node_modules/.bin/tsc");

function typecheck(files: string[]) {
  const p = Bun.spawnSync([tsc, "--noEmit", "--strict", "--target", "ES2022", "--module", "ESNext", "--moduleResolution", "Bundler",
    "--skipLibCheck", "--allowImportingTsExtensions", "--types", "bun", ...files], { cwd: root });
  return { code: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

test("every gate-bypass attempt fails to compile (@ts-expect-error all used)", () => {
  const r = typecheck(["tests/bypass.typecheck.ts"]);
  expect(r.out).toBe("");
  expect(r.code).toBe(0);
}, 60_000);

test("negative control: the same bypass without @ts-expect-error is a compile error", () => {
  const f = join(root, "tests/_bypass_control.ts");
  writeFileSync(f, `import { send, type OutboundTransport } from "../src/index.ts";\ndeclare const t: OutboundTransport;\nexport const x = send("leak", t);\n`);
  try {
    const r = typecheck(["tests/_bypass_control.ts"]);
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("LeakCheckedMessage");
  } finally { rmSync(f, { force: true }); }
}, 60_000);

test("only gate.ts imports mintLeakChecked, and nothing casts to LeakCheckedMessage", () => {
  const dirs = ["src", "scripts"];
  for (const d of dirs) for (const name of readdirSync(join(root, d))) {
    if (!name.endsWith(".ts")) continue;
    const src = readFileSync(join(root, d, name), "utf8");
    if (name !== "gate.ts" && name !== "brand.ts") expect(/import[^;]*mintLeakChecked/.test(src)).toBe(false);
    if (name !== "brand.ts") expect(/as\s+LeakCheckedMessage/.test(src)).toBe(false);
  }
});
