// pnpm run check:mirror: compare the wire contract mirror (packages/core/src/svc/{contract,svc-auth}.ts)
// with elizaos/eliza plugins/plugin-network/src/backend on a branch (default develop). Read-only: it
// fetches the upstream files with `gh api` and changes nothing. Needs `gh` signed in. It calls GitHub,
// so it is not part of any test suite; packages/core/test/contract-mirror.test.ts pins the hashes offline.
//
//   pnpm run check:mirror               # against develop
//   pnpm run check:mirror --ref <ref>   # another branch, tag or commit
import { spawnProcess } from "../packages/core/src/runtime/process.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const FILES = ["contract.ts", "svc-auth.ts"] as const;
const UPSTREAM = "elizaos/eliza";
const UPSTREAM_DIR = "plugins/plugin-network/src/backend";
const UPSTREAM_VIBE_PATH = "packages/plugin-network/src/index.vibe";

const args = process.argv.slice(2);
const i = args.indexOf("--ref");
const ref = i >= 0 ? args[i + 1] : "develop";
if (!ref || !/^[\w./-]+$/.test(ref)) { console.error("usage: pnpm run check:mirror [--ref <branch|tag|sha>]"); process.exit(2); }

function mirrorHash(file: typeof FILES[number], source: Buffer): string {
  // The opening paragraph of the signing file describes the local runtime.
  // Keep the canonical request documentation and all source bytes in the hash.
  const paragraphEnd = source.indexOf("\n *\n");
  const commentEnd = source.indexOf("*/");
  const body = file === "svc-auth.ts" && source.subarray(0, 4).equals(Buffer.from("/**\n"))
    && paragraphEnd >= 0 && paragraphEnd < commentEnd
    ? source.subarray(paragraphEnd)
    : source;
  return createHash("sha256").update(body).digest("hex");
}

async function fetchUpstreamPath(path: string): Promise<{ ok: true; content: Buffer } | { ok: false; notFound: boolean; error: string }> {
  const p = spawnProcess(["gh", "api", `repos/${UPSTREAM}/contents/${path}?ref=${ref}`, "-q", ".content"], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) {
    const trimmed = err.trim();
    return { ok: false, notFound: /404|Not Found/i.test(trimmed), error: trimmed };
  }
  return { ok: true, content: Buffer.from(out.replace(/\s+/g, ""), "base64") };
}

let ok = true;
for (const f of FILES) {
  const local = readFileSync(new URL(`../packages/core/src/svc/${f}`, import.meta.url));
  const fetched = await fetchUpstreamPath(`${UPSTREAM_DIR}/${f}`);
  if (!fetched.ok) {
    if (fetched.notFound) {
      const vibe = await fetchUpstreamPath(UPSTREAM_VIBE_PATH);
      if (vibe.ok) {
        console.error(
          `${UPSTREAM}@${ref} no longer carries TypeScript files under ${UPSTREAM_DIR} (migrated to VibeLang at ${UPSTREAM_VIBE_PATH}).\n` +
          `Local mirror pins remain enforced offline by packages/core/test/contract-mirror.test.ts.\n` +
          `Pass --ref <pre-migration-sha> to compare against the last TypeScript mirror revision.`,
        );
        process.exit(2);
      }
    }
    console.error(`gh api failed for ${f}: ${fetched.error}`);
    process.exit(2);
  }
  const [l, r] = [mirrorHash(f, local), mirrorHash(f, fetched.content)];
  console.log(`${l === r ? "same" : "DIFFERENT"}  ${f}  local ${l}  ${UPSTREAM}@${ref} ${r}`);
  if (l !== r) ok = false;
}
if (!ok) console.error(`The mirror differs from ${UPSTREAM}@${ref}. Sync the upstream implementation and update the pins in packages/core/test/contract-mirror.test.ts.`);
process.exit(ok ? 0 : 1);
