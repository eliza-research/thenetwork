// LIVE, READ-ONLY. Calls GET /v4/me and GET /v4/me/numbers only. Never sends, never changes configuration.
// Gated on BLOOIO_API_KEY *and* BLOOIO_LIVE_TEST=1, because Bun auto-loads the repo-root .env (which holds the key)
// and the default `bun test` run must stay offline.
//   BLOOIO_LIVE_TEST=1 bun test tests/live.readonly.test.ts      (from this directory, after loading the key)

import { describe, expect, test } from "bun:test";
import { BlooioClient } from "../src/blooio/client.ts";
import { loadRootEnv } from "../scripts/env.ts";

if (process.env.BLOOIO_LIVE_TEST === "1") loadRootEnv();
const live = process.env.BLOOIO_LIVE_TEST === "1" && !!process.env.BLOOIO_API_KEY;

describe.skipIf(!live)("Blooio live read-only", () => {
  test("API key is valid and owns at least one active line", async () => {
    const c = new BlooioClient({ apiKey: process.env.BLOOIO_API_KEY!, timeoutMs: 15_000 });
    const me = await c.getMe();
    expect(me.valid).toBe(true);
    const lines = await c.listNumbers();
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.some((l) => l.is_active && !l.suspended)).toBe(true);
  }, 20_000);
});
