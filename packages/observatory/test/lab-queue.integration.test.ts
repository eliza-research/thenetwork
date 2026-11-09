import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../src/server.ts";
import { FileAudit } from "../src/staff.ts";

test("concurrent lab requests report capacity exhaustion as 429 through real HTTP", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-queue-http-"));
  const token = "local-lab-queue-test-0000000000000000";
  const server = await createServer({ port: 0, development: false, token,
    staffRolesUrl: false, peopleUrl: false,
    audit: new FileAudit(join(dir, "audit")), lab: { dir: join(dir, "lab"), concurrency: 1 },
    game: { personas: 12, days: 2, engine: "off", network: "stub", pushMs: 3_600_000, tickMs: 3_600_000 },
    real: { url: undefined, service: false, pollMs: 3_600_000 },
  });
  const post = async (seeds: number[]) => {
    const response = await fetch(`${server.url}/api/lab/run`, { method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ arms: ["consent"], seeds, days: 1 }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const responses = await Promise.all(Array.from({ length: 8 }, (_, i) =>
      post([1, 2, 3, 4, 5].map(seed => seed + i * 5))));
    const accepted = responses.filter(r => r.status === 200);
    expect(accepted).toHaveLength(4);
    expect(responses.filter(r => r.status !== 200).map(r => ({ status: r.status, code: r.body.code })))
      .toEqual(Array.from({ length: 4 }, () => ({ status: 429, code: "queue_full" })));
    expect({ running: server.lab.running, queued: server.lab.queued }).toEqual({ running: 1, queued: 19 });
    const serial = await post([41, 42, 43, 44, 45]);
    expect(serial).toEqual(responses.find(r => r.status === 429)!);
    const runs = await server.lab.list();
    expect(runs.map(r => r.id).sort()).toEqual(accepted.map(r => r.body.run.id).sort());
  } finally {
    // Drain the startup saves before stopping the real child, then its final result save.
    for (const run of await server.lab.list()) await server.lab.get(run.id);
    await server.stop();
    const deadline = performance.now() + 30_000;
    while (server.lab.running && performance.now() < deadline) await Bun.sleep(10);
    if (server.lab.running) throw new Error("Lab child did not stop");
    for (const run of await server.lab.list()) await server.lab.get(run.id);
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
