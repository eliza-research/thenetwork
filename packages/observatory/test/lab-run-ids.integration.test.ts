// Restart the native lab within one wall-clock second; no fake clock or replacement child.
import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Lab } from "../src/lab.ts";

test("a rapid lab restart preserves the prior run's identity and file", async () => {
  const root = await mkdtemp(join(tmpdir(), "obs-lab-ids-"));
  const labs: Lab[] = [];
  async function stop(lab: Lab) {
    await lab.dispose();
    const deadline = performance.now() + 10_000;
    while (lab.running && performance.now() < deadline) await Bun.sleep(1);
    if (lab.running) throw Error("Native lab child did not stop");
  }
  try {
    // Retry only if machine scheduling carries the pair into different seconds.
    for (let attempt = 0; attempt < 3; attempt++) {
      const dir = join(root, String(attempt));
      const first = new Lab({ dir, concurrency: 1 }); labs.push(first);
      await first.list();
      await Bun.sleep(1000 - Date.now() % 1000 + 5);
      const prior = await first.start({ arms: ["consent"], seeds: [1], days: 1 }, "first-instance");
      await first.get(prior.id); // Drain the startup write so the native child exists before disposal.
      await stop(first);
      const saved = await readFile(prior.file, "utf8");
      const second = new Lab({ dir, concurrency: 1 }); labs.push(second);
      const next = await second.start({ arms: ["consent"], seeds: [2], days: 1 }, "second-instance");
      await second.get(next.id);
      await stop(second);
      if (Math.floor(prior.createdAt / 1000) !== Math.floor(next.createdAt / 1000)) continue;
      expect(next.id).not.toBe(prior.id);
      expect(await readFile(prior.file, "utf8")).toBe(saved);
      expect((await readdir(dir)).filter(f => f.endsWith(".json")).sort()).toEqual([`${prior.id}.json`, `${next.id}.json`].sort());
      const reloaded = new Lab({ dir }); labs.push(reloaded);
      expect((await reloaded.list()).map(r => ({ id: r.id, seeds: r.request.seeds, by: r.requestedBy })).sort((a, b) => a.by.localeCompare(b.by)))
        .toEqual([{ id: prior.id, seeds: [1], by: "first-instance" }, { id: next.id, seeds: [2], by: "second-instance" }]);
      return;
    }
    throw Error("Could not exercise a restart inside one second");
  } finally {
    for (const lab of labs) await stop(lab);
    await rm(root, { recursive: true, force: true });
  }
}, 30_000);
