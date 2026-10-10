// bun run check:mirror: compare the wire contract mirror (packages/core/src/svc/{contract,svc-auth}.ts)
// with elizaos/eliza plugins/plugin-network/src/backend on a branch (default develop). Read-only: it
// fetches the upstream files with `gh api` and changes nothing. Needs `gh` signed in. It calls GitHub,
// so it is not part of any test suite; packages/core/test/contract-mirror.test.ts pins the hashes offline.
//
//   bun run check:mirror               # against develop
//   bun run check:mirror --ref <ref>   # another branch, tag or commit
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FILES = ["contract.ts", "svc-auth.ts"] as const;
const UPSTREAM = "elizaos/eliza";
const UPSTREAM_DIR = "plugins/plugin-network/src/backend";

const args = process.argv.slice(2);
const i = args.indexOf("--ref");
const ref = i >= 0 ? args[i + 1] : "develop";
if (!ref || !/^[\w./-]+$/.test(ref)) { console.error("usage: bun run check:mirror [--ref <branch|tag|sha>]"); process.exit(2); }

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function upstream(file: string): Promise<Uint8Array> {
  const p = Bun.spawn(["gh", "api", `repos/${UPSTREAM}/contents/${UPSTREAM_DIR}/${file}?ref=${ref}`, "-q", ".content"], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`gh api failed for ${file}: ${err.trim()}`);
  return Buffer.from(out.replace(/\s+/g, ""), "base64");
}

let ok = true;
for (const f of FILES) {
  const local = readFileSync(new URL(`../packages/core/src/svc/${f}`, import.meta.url));
  let remote: Uint8Array;
  try { remote = await upstream(f); } catch (e) { console.error((e as Error).message); process.exit(2); }
  const [l, r] = [sha256(local), sha256(remote)];
  console.log(`${l === r ? "same" : "DIFFERENT"}  ${f}  local ${l}  ${UPSTREAM}@${ref} ${r}`);
  if (l !== r) ok = false;
}
if (!ok) console.error(`The mirror differs from ${UPSTREAM}@${ref}. Copy the upstream files unchanged and update the pins in packages/core/test/contract-mirror.test.ts.`);
process.exit(ok ? 0 : 1);
