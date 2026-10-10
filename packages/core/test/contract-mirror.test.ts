// The wire contract mirror (issue #10). packages/core/src/svc/contract.ts and svc-auth.ts are byte-identical
// copies of elizaos/eliza plugins/plugin-network/src/backend/{contract,svc-auth}.ts. The service and the
// Eliza side must sign and parse the same bytes, so neither copy may change alone. Upstream pins the same
// two SHA-256 values in plugins/plugin-network/src/backend/contract-mirror.test.ts.
//
// When this test fails you changed the wire contract here, or you copied a new upstream version:
//   1. A wire change goes upstream first (elizaos/eliza, plugins/plugin-network/src/backend), with the
//      new hashes in its contract-mirror.test.ts.
//   2. Copy both upstream files unchanged into packages/core/src/svc/ (do not reformat them).
//   3. Run `bun run check:mirror` (needs `gh` signed in): it compares these files with elizaos/eliza develop.
//   4. Update the two hashes below to what `shasum -a 256 packages/core/src/svc/{contract,svc-auth}.ts`
//      prints; they must equal the upstream pins.
// There is no contract version constant: the hashes are the contract's identity.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const MIRRORED_CONTRACT_SHA256: Record<string, string> = {
  "contract.ts": "8c7e68ff489d33919939890d019787ddf07d64070f867c22d9fe2e3dd88d4b5d",
  "svc-auth.ts": "80c561af25581926e6317837f91e92063e4655e5cd9a687597ce4ea8ce297c70",
};

for (const [file, pinned] of Object.entries(MIRRORED_CONTRACT_SHA256)) {
  test(`${file} is byte-identical to the upstream plugin-network copy`, () => {
    const hash = createHash("sha256").update(readFileSync(new URL(`../src/svc/${file}`, import.meta.url))).digest("hex");
    expect(hash).toBe(pinned);
  });
}
