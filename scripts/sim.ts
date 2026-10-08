// bun run sim: the single validation command. Offline and deterministic: no LLM, no Postgres, no
// network. Each block runs simulations (or scores hand-written corpora) and checks named gates; the
// run exits 1 when any BLOCKING gate fails. Tracked gates are printed and never fail the run.
//
//   bun run sim                      evals, network, slop, peon, friends (the CI run)
//   bun run sim --only slop          one block (repeatable or comma-separated: --only network,peon)
//   bun run sim --quick              fewer seeds and shorter runs; quality gates become tracked
//   bun run sim --with-capital       also the network-capital block (slow: 32 paired seeds; nightly)
//   bun run sim --json out.json      write every gate to a file
//
// Blocks and pinned seeds (see each block's header in scripts/sim/):
//   evals     evals/ corpora: consent replies, abuse, teen ages, wants, areas, negations, core replies, opt-out, leak guard
//   network   ConsentNetwork in the NYC world: invariants (seed 3, 10 days), consent vs push (seeds 1-3, 21 days) with the
//             attention and plans invariants, NYC scenarios, sim scenarios at pass^3, networkPack conformance
//   slop      slop.date: seeds 13-16, 4 weeks, 300 per city; safety + passing quality gates block, known-failing gates tracked
//   peon      peon.biz: seeds 13-16, 8 weeks; the official gates block
//   friends   friends.help: seeds 5-8, 8 weeks, 400 personas; the official gates block
//   capital   network capital: 32 paired seeds, 90 days (--with-capital or --only capital)
import { capitalBlock } from "./sim/capital.ts";
import { evalsBlock } from "./sim/evals.ts";
import { friendsBlock } from "./sim/friends.ts";
import { Block, type Gate } from "./sim/gate.ts";
import { networkBlock } from "./sim/network.ts";
import { peonBlock } from "./sim/peon.ts";
import { slopBlock } from "./sim/slop.ts";

type Opts = { quick: boolean };
const BLOCKS: Record<string, (b: Block, o: Opts) => Promise<void>> = {
  evals: b => evalsBlock(b),
  network: networkBlock,
  slop: slopBlock,
  peon: peonBlock,
  friends: friendsBlock,
  capital: capitalBlock,
};
const DEFAULT = ["evals", "network", "slop", "peon", "friends"];

const argv = process.argv.slice(2);
const values = (k: string) => argv.flatMap((x, i) => (x === `--${k}` ? (argv[i + 1] ?? "").split(",") : x.startsWith(`--${k}=`) ? x.slice(k.length + 3).split(",") : [])).filter(Boolean);
const only = values("only");
const unknown = only.filter(x => !BLOCKS[x]);
if (unknown.length) { console.error(`unknown block: ${unknown.join(", ")}; known: ${Object.keys(BLOCKS).join(", ")}`); process.exit(2); }
const run = only.length ? only : [...DEFAULT, ...(argv.includes("--with-capital") || argv.includes("--nightly") ? ["capital"] : [])];
const opts: Opts = { quick: argv.includes("--quick") };

// Simulations never call a model: fail fast if any code path tries.
for (const k of ["OPENAI_API_KEY", "SURPLUS_API_KEY", "CLOUDFLARE_AI_TOKEN"]) delete process.env[k];

const all: Gate[] = [];
const timings: Record<string, number> = {};
const t0 = performance.now();
for (const name of run) {
  console.log(`\n== ${name}${opts.quick ? " (quick)" : ""}`);
  const b = new Block(name);
  const t = performance.now();
  try { await BLOCKS[name]!(b, opts); } catch (e) { b.gate(`${name} block ran to completion`, false, (e as Error)?.stack ?? String(e)); }
  timings[name] = Math.round((performance.now() - t) / 100) / 10;
  all.push(...b.gates);
  const failed = b.gates.filter(g => g.blocking && !g.pass).length, tracked = b.gates.filter(g => !g.blocking).length;
  console.log(`-- ${name}: ${b.gates.length - tracked - failed}/${b.gates.length - tracked} blocking gates pass${tracked ? `, ${tracked} tracked` : ""} (${timings[name]}s)`);
}

const failed = all.filter(g => g.blocking && !g.pass);
const total = Math.round((performance.now() - t0) / 100) / 10;
console.log(`\n${failed.length ? "FAIL" : "PASS"}: ${all.filter(g => g.blocking).length - failed.length}/${all.filter(g => g.blocking).length} blocking gates, ${all.filter(g => !g.blocking && !g.pass).length} tracked off target, ${total}s (${Object.entries(timings).map(([k, v]) => `${k} ${v}s`).join(", ")})`);
for (const g of failed) console.error(`  FAIL [${g.block}] ${g.name}${g.detail ? `: ${g.detail.split("\n")[0]}` : ""}`);
const out = values("json")[0];
if (out) await Bun.write(out, JSON.stringify({ quick: opts.quick, blocks: run, timings, total, gates: all }, null, 1));
process.exit(failed.length ? 1 : 0);
