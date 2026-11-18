// Exercise the native lab child, its on-disk records, and the real server shutdown lifecycle.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lab } from "../src/lab.ts";
import { createServer } from "../src/server.ts";

test("server shutdown drains the simulation lab and persists terminal runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "obs-lab-shutdown-"));
  const server = await createServer({ port: 0, development: false, token: "lab-shutdown-local-test-0123456789abcdef",
    peopleUrl: false, staffRolesUrl: false, audit: { dir: join(dir, "audit") }, lab: { dir: join(dir, "lab"), concurrency: 1 },
    game: { seed: 1, personas: 24, days: 1, pushMs: 3_600_000, tickMs: 3_600_000 } });
  const lab = server.lab;
  async function drain() {
    const deadline = performance.now() + 30_000;
    while (lab.running && performance.now() < deadline) await Bun.sleep(10);
    if (lab.running) throw Error("Native lab child did not finish");
  }
  try {
    const completed = await lab.start({ arms: ["consent"], seeds: [1], days: 1 }, "local-test");
    await drain();
    const control = await lab.get(completed.id);
    expect(control).toMatchObject({ status: "done", progress: { done: 1, total: 1 },
      results: [{ arm: "consent", seed: 1, judgeInvariants: 0, canaryLeaks: 0, minorContacts: 0 }] });
    // Do not read get() here: it awaits the pending startup write and would miss the pre-spawn race.
    const interrupted = await lab.start({ arms: ["consent"], seeds: [2, 3], days: 1 }, "local-test");
    await server.stop();
    const atStop = { running: lab.running, queued: lab.queued };
    await drain(); // Also lets the unfixed child finish before the temporary directory is removed.
    const stopped = await lab.get(interrupted.id);
    expect({ ...atStop, status: stopped?.status, results: stopped?.results })
      .toEqual({ running: 0, queued: 0, status: "failed", results: [] });
    expect(await lab.get(completed.id)).toEqual(control);
    expect(JSON.parse(await readFile(interrupted.file, "utf8"))).toEqual(stopped);
    const reloaded = new Lab({ dir: join(dir, "lab") });
    try { expect(await reloaded.get(interrupted.id)).toEqual(stopped); }
    finally { await reloaded.dispose(); }
    await expect(lab.start({ arms: ["consent"], seeds: [4], days: 1 }, "local-test")).rejects.toThrow("stopped");
    await lab.dispose();
  } finally {
    await server.stop();
    await drain();
    await rm(dir, { recursive: true, force: true });
  }
}, 60_000);
