import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DAY } from "@thenetwork/core";
import { createServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";
import type { GameSource } from "../src/sources/game.ts";
import type { SearchHit } from "../src/types.ts";

test("HTTP game search returns the newest matches when native history exceeds its limit", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-search-recency-"));
  const token = "local-search-recency-test-000000000000";
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false, audit: new FileAudit(join(dir, "audit")),
    lab: { dir: join(dir, "lab") },
    game: { seed: 1, personas: 80, days: 14, network: "consent", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  try {
    const step = await fetch(`${server.url}/api/control`, { method: "POST", headers,
      body: JSON.stringify({ type: "step", ms: 14 * DAY }),
    });
    expect(await step.json()).toMatchObject({ ok: true });
    const source = await server.source("game") as GameSource;
    for (const query of ["you", "request_result", "joined", "meeting", "no-such-search-phrase"]) {
      const all = await source.search(query, Number.MAX_SAFE_INTEGER);
      if (query === "you" || query === "request_result") expect(all.length).toBeGreaterThan(100);
      const response = await fetch(`${server.url}/api/search?q=${encodeURIComponent(query)}`, { headers });
      const hits = await response.json() as SearchHit[];
      expect({ query, status: response.status, hits }).toEqual({ query, status: 200, hits: all.slice(0, 100) });
      if (query === "you") {
        const newest = Math.max(...source.world.channel.all()
          .filter(m => m.direction === "outbound" && !m.system && /you/i.test(m.body)).map(m => m.ts));
        expect(hits[0]!.t).toBe(newest);
      }
    }
  } finally {
    await server.stop();
    await rm(dir, { recursive: true, force: true });
  }
}, 120_000);
