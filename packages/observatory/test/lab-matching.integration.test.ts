import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lab, LAB_ARMS } from "../src/lab.ts";

test("real lab arms keep matching-disabled apps free of meetings", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lab-matching-"));
  const lab = new Lab({ dir, concurrency: 1 });
  try {
    for (const app of ["peon", "ntwrk"] as const) {
      const run = await lab.start({ app, arms: [...LAB_ARMS], seeds: [1], days: 7 }, "regression");
      const deadline = Date.now() + 90_000;
      let done = (await lab.get(run.id))!;
      while ((done.status === "queued" || done.status === "running") && Date.now() < deadline) {
        await Bun.sleep(25);
        done = (await lab.get(run.id))!;
      }
      expect({ status: done.status, error: done.error }).toEqual({ status: "done", error: undefined });
      expect(done.results.map(r => r.arm).sort()).toEqual([...LAB_ARMS].sort());
      for (const result of done.results) {
        expect(result).toMatchObject({ judgeInvariants: 0, canaryLeaks: 0, minorContacts: 0 });
        if (app === "peon") expect(result.meetings).toBe(0);
        else expect(result.meetings).toBeGreaterThan(0);
      }
      expect(JSON.parse(await readFile(done.file, "utf8")).results).toEqual(done.results);
    }
  } finally {
    lab.dispose();
    const deadline = Date.now() + 10_000;
    while (lab.running && Date.now() < deadline) await Bun.sleep(10);
    if (lab.running) throw new Error("lab child did not stop");
    await rm(dir, { recursive: true, force: true });
  }
}, 210_000);
