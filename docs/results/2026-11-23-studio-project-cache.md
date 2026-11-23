# Studio project reads on The Network

The Studio server reads the same project when the editor refreshes. It can reuse the parsed specifications across those requests. The implementation comes from [VibeStack #222](https://github.com/lalalune/vibestack/pull/222).

## Measurements

The input was the 150-spec project that `pnpm run spec:studio` prepares on Network commit `16f5cc1b`. We compared the original project reader and the reader with a persistent per-project cache. Each reader first served the project once. We then took six measurements per reader in one Node 26.13.0 process on a shared Mac. The order was old, new, new, old, new, old, old, new, old, new, new, old. The measured region was the project reader. It included reading Markdown, building outlines and computing current review status. Serialization and the forced garbage collection before each read were outside that region.

| Median for a repeat read | Original | With parsed specs |
| --- | ---: | ---: |
| Process CPU | 639.5 ms | 203.5 ms |
| Elapsed on the shared host | 5,333 ms | 857.5 ms |

Each of the 12 reads returned an identical 2,500,622-byte JSON payload. Its SHA-256 was `56b83a87a7aae16da5ea1dd3ca285fda67ac4b9432c51708fcc4d501d56a37e1`. Four HTTP reads through the real Studio server returned the same specifications and review results. Dropping the one project's cached data and running garbage collection freed a median 4,756,112 bytes across three trials. The first request pays the parse cost. The timing experiments used deterministic files and called no language model.

## Reproduction

Use the original reader from `16f5cc1b` and the candidate in separate clean checkouts with the same Node version and dependencies. The core setup and measured call are below. The original reader takes `root`; the candidate takes `tree`, created once outside the measured region.

```js
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formalFiles, prepareProject } from "./scripts/vibestack.ts";
import { readTree } from "./tools/vibestack/vibestack/studio/src/project.ts";

const root = mkdtempSync(join(tmpdir(), "network-studio-bench-"));
try {
  prepareProject(root, formalFiles());
  const tree = { root };
  const read = () => readTree(tree); // On 16f5cc1b use readTree(root).
  read();
  for (let i = 0; i < 6; i++) {
    global.gc();
    const start = performance.now();
    const cpu = process.cpuUsage();
    const result = read();
    const elapsed = performance.now() - start;
    const { user, system } = process.cpuUsage(cpu);
    console.log(elapsed, (user + system) / 1000, result.specs.length);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}
```

Run this code with `node --expose-gc --input-type=module` from the repository root using standard input. To check the HTTP response, run `pnpm run spec:studio --port 0` and request `/api/project` from the reported local address.

## Validation

The reader rebuilt its cache after a content change with its original modification time restored, a file addition, and a removal. The old and new readers agreed after changing only the review ledger or a source contract, as well as on a missing linked spec, recovery from the error, and rejection of a symbolic link. Separate readers had independent caches. A bundled library import bypassed the cache. A missing library produced an error. Adding a local version allowed caching, and removing it returned to reading the bundled library. Toolkit and Studio typechecking passed. All seven Studio HTTP journeys passed, including publish, sign-off and edits during a check.
