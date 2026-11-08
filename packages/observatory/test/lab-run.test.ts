// The simulation lab's run states (observatory lab-run, section 2.21 of
// docs/research/state-machines/observatory.md): queued, running, done, failed. Stand-in child scripts;
// no Postgres.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lab } from "../src/lab.ts";

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "obs-lab-run-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

const until = async (ok: () => boolean, ms: number) => {
  const deadline = Date.now() + ms;
  while (!ok() && Date.now() < deadline) await Bun.sleep(20);
};

// SD-502 (observatory D24): the save of the "running" status was outside the try. When it failed, exec
// rejected with no catch, the seed was never counted and the run stayed "running" for ever (LB3).
test("a run whose save fails ends as failed, not running", async () => {
  const script = join(dir, "short-arm.ts");
  await writeFile(script, `await Bun.sleep(300); console.log(JSON.stringify({ results: [{ arm: "consent", meetingsHeld: 1 }] }));`);
  const lab = new Lab({ dir: join(dir, "lab-save"), script, concurrency: 1 });
  const unhandled: unknown[] = [];
  const onUnhandled = (e: unknown) => { unhandled.push(e); };
  process.on("unhandledRejection", onUnhandled);
  try {
    const first = await lab.start({ arms: ["consent"], seeds: [1], days: 1 }, "tester");
    const second = await lab.start({ arms: ["consent"], seeds: [1], days: 1 }, "tester");
    // The second run waits in the queue (its "queued" save is on disk). A directory at its temporary
    // file path makes each later save of that run fail (EISDIR).
    await mkdir(`${second.file}.tmp`);
    await until(() => lab.running === 0 && lab.queued === 0, 30_000);
    await Bun.sleep(100);
    expect((await lab.get(first.id))!.status).toBe("done");
    const r = (await lab.get(second.id))!;
    expect(r.status).toBe("failed");
    expect(r.progress.done).toBe(1);
    expect(r.error).toContain("EISDIR");
    expect(unhandled).toEqual([]);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    lab.dispose();
  }
}, 60_000);
