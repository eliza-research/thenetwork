// The simulation lab's run states (observatory lab-run, section 2.21 of
// docs/research/state-machines/observatory.md): queued, running, done, failed. Stand-in child scripts;
// no Postgres.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lab, LAB_LIMITS } from "../src/lab.ts";
import { createServer } from "../src/server.ts";

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

// SD-503 (observatory D25): two lab requests could both pass the server's queue check while their audit
// rows were written. The second lab.start then threw "the lab queue is full": the client got a 500, and
// the audit log kept only an ok:true row for a run that never started.
test("lab requests that race for the last queue places get 200 or 429, and the audit says which", async () => {
  const token = "admin-lab-race".padEnd(32, "-0123456789abcdef");
  const script = join(dir, "slow-arm.ts");
  await writeFile(script, "await Bun.sleep(20000); console.log(JSON.stringify({ results: [] }));");
  const obs = await createServer({
    port: 0, development: false, tokens: `admin:${token}`, audit: { dir: join(dir, "audit-race") },
    lab: { dir: join(dir, "lab-race"), script, concurrency: 1 }, game: { seed: 1, pushMs: 3_600_000, tickMs: 3_600_000 },
  });
  try {
    // One seed runs; the queue has 1 place left.
    for (let i = 0; i < 4; i++) await obs.lab.start({ arms: ["consent"], seeds: [1, 2, 3, 4, 5], days: 1, app: "ntwrk" }, "tester");
    expect(obs.lab.queued).toBe(LAB_LIMITS.maxQueued - 1);
    const post = () => fetch(`${obs.url}/api/lab/run`, {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ arms: ["consent"], seeds: [1], days: 1 }),
    });
    const res = await Promise.all([post(), post(), post(), post()]);
    const codes = res.map(r => r.status).sort();
    expect(codes).toEqual([200, 429, 429, 429]);
    expect(obs.lab.queued).toBe(LAB_LIMITS.maxQueued);
    // Each refused request has an audit row that says it failed.
    const rows = (await obs.audit.list({ limit: 100 })).filter(e => e.action === "lab_run");
    expect(rows.filter(e => e.ok === false).length).toBe(3);
  } finally {
    await obs.stop();
  }
}, 120_000);
