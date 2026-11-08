// The deploy-sites workflow runs on a push to main only when a changed file matches its path filter.
// The router Worker (_worker.js) that each site runs is a bundle of several source files. This test
// builds the real Worker entry the site build uses (sites/sites.ts ROUTER) and checks that every
// source file that puts code into the bundle matches the push and the pull_request path filters, so a
// fix in any of them rebuilds and deploys the sites.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { ROUTER } from "../sites/sites.ts";

const REPO = join(import.meta.dir, "..");

test("every source file of the site router Worker is in the deploy-sites path filter", async () => {
  const wf = Bun.YAML.parse(readFileSync(join(REPO, ".github/workflows/deploy-sites.yml"), "utf8")) as { on: Record<string, { paths?: string[] }> };
  const built = await Bun.build({ entrypoints: [ROUTER], target: "browser", format: "esm", metafile: true });
  expect(built.success).toBe(true);
  const sources = new Set<string>();
  for (const out of Object.values(built.metafile!.outputs)) {
    for (const [input, info] of Object.entries(out.inputs)) {
      const path = relative(REPO, join(process.cwd(), input));
      if (info.bytesInOutput > 0 && !path.startsWith("node_modules/")) sources.add(path);
    }
  }
  expect(sources.size).toBeGreaterThan(0);
  for (const trigger of ["push", "pull_request"]) {
    const globs = (wf.on[trigger]?.paths ?? []).map(p => new Bun.Glob(p));
    const missing = [...sources].filter(f => !globs.some(g => g.match(f))).sort();
    expect({ trigger, missing }).toEqual({ trigger, missing: [] });
  }
});
