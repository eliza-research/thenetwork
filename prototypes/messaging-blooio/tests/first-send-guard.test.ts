import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { checkFirstSendArgs } from "../src/first-send-guard.ts";

describe("first-send guard", () => {
  test("requires both --to and --confirm, and E.164", () => {
    expect(checkFirstSendArgs({})).toContain("Refusing");
    expect(checkFirstSendArgs({ to: "+14155550123" })).toContain("Refusing");
    expect(checkFirstSendArgs({ confirm: true })).toContain("Refusing");
    expect(checkFirstSendArgs({ to: "4155550123", confirm: true })).toContain("E.164");
    expect(checkFirstSendArgs({ to: "+14155550123", confirm: true })).toBeNull();
  });

  test("the script exits 2 before touching the network when a flag is missing", () => {
    const script = resolve(import.meta.dir, "../scripts/first-send.ts");
    for (const args of [[], ["--to", "+14155550123"], ["--confirm"]]) {
      // Empty key in the child env as a belt-and-braces guarantee nothing could be sent.
      const p = Bun.spawnSync(["bun", "run", script, ...args], { env: { ...process.env, BLOOIO_API_KEY: "" }, stderr: "pipe", stdout: "pipe" });
      expect(p.exitCode).toBe(2);
      expect(p.stderr.toString()).toContain("Refusing to send");
    }
  });
});
