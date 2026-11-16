// Pin the local wire contract and signing files to detect drift offline.
// The wire contract mirrors the plugin-network source byte for byte. The signing
// file has a local opening comment. Its implementation must still match upstream.
// Land changes to the wire contract or signing upstream first, then copy them
// locally, run pnpm run check:mirror, and update these local hashes.
import { expect, test } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const MIRRORED_CONTRACT_SHA256: Record<string, string> = {
  "contract.ts": "564b22b222547f47bf11908a7074c7f640f5059925460ccdb2e69d4d2fb20d42",
  "svc-auth.ts": "bde3fdc4b742f8eab8217974a70a3021cf69c3d0e54d84bac2f41d6945bcadf3",
};

for (const [file, pinned] of Object.entries(MIRRORED_CONTRACT_SHA256)) {
  test(`${file} matches the pinned local mirror`, () => {
    const hash = createHash("sha256").update(readFileSync(new URL(`../src/svc/${file}`, import.meta.url))).digest("hex");
    expect(hash).toBe(pinned);
  });
}
