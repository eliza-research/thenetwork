// contract.ts and svc-auth.ts are byte-for-byte copies of elizaOS/eliza plugins/plugin-network/src/backend
// (Cloud b763, PR #34657). The upstream contract-mirror.test.ts pins the same SHA-256 values. When this
// fails, the wire changed: change both repos together and update the pins on both sides.
import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PINNED: Record<string, string> = {
  "contract.ts": "8c7e68ff489d33919939890d019787ddf07d64070f867c22d9fe2e3dd88d4b5d",
  "svc-auth.ts": "80c561af25581926e6317837f91e92063e4655e5cd9a687597ce4ea8ce297c70",
};

for (const [file, pinned] of Object.entries(PINNED)) {
  test(`${file} is the byte-for-byte upstream mirror`, () => {
    expect(createHash("sha256").update(readFileSync(new URL(`./${file}`, import.meta.url))).digest("hex")).toBe(pinned);
  });
}
