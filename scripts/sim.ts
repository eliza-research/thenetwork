// bun run sim: the single validation command. Offline and deterministic: no LLM, no network, and no
// Postgres except the safety block's Postgres scenarios, which run on a database of their own on the
// dev cluster (:54339) when it is there and are tracked as skipped when it is not. Each block runs
// simulations (or scores hand-written corpora) and checks named gates; the run exits 1 when any
// BLOCKING gate fails. Tracked gates are printed and never fail the run.
//
//   bun run sim                      evals, onboard, network, slop, relay, peon, friends, clef (the CI run)
//   bun run sim --only slop          one block (repeatable or comma-separated: --only network,peon)
//   bun run sim --quick              fewer seeds and shorter runs; quality gates become tracked
//   bun run sim --with-capital       also the network-capital block (slow: 32 paired seeds; nightly)
//   bun run sim --json out.json      write every gate to a file
//   bun run sim --only onboard --llm  also the onboarding LLM arm (keeps the provider keys; tracked only; never in CI)
//
// Blocks and pinned seeds (see each block's header in scripts/sim/):
//   evals     evals/ corpora: consent replies, abuse, teen ages, wants, areas, negations, core replies, opt-out, leak guard
//   network   ConsentNetwork in the NYC world: invariants (seed 3, 10 days), consent vs push (seeds 1-3, 21 days) with the
//             attention and plans invariants, NYC scenarios, sim scenarios at pass^3, networkPack conformance
//   slop      slop.date: seeds 13-16, 4 weeks, 300 per city; safety + passing quality gates block, known-failing gates tracked;
//             the relay inside the world (adversary personas after the reveal) and the photo in the probe
//   relay     the relay policy (engine relay.ts): evals/relay/ corpora and scripted scenarios; photo-in-probe rule
//   peon      peon.biz: seeds 13-16, 8 weeks; the official gates block
//   friends   friends.help: seeds 5-8, 8 weeks, 400 personas; the official gates block
//   safety    slop.date photos (adults only, consent, rater), bans on every rejoin path, report -> hold -> ban, the reviewer
//             of record, SLA alerts and the bias monitor; its Postgres scenarios block when the dev Postgres runs, else tracked
//   ops       monitoring, alerts, cost, the console's deploy guards and image contents; on the dev Postgres (tracked):
//             the ops tables under row-level security and the backup drill (dump, restore, equal row counts)
//   pipeline  the real message path: signed Blooio webhook -> NetworkService -> Postgres (a throwaway database on the dev
//             cluster, :54339) -> persisted queue -> Blooio adapter -> fake provider, simulated clock; skipped (tracked) without Postgres
//   audit     regression gates for the 2026-10-08 audit's P0/P1 fixes that lost their tests in the cleanup
//             (docs/audit/2026-10-09-platform-status.md): NYC world (seed 3, 9 days), trust, plans, the four
//             site builds, the sites' API client and the Cloudflare deploy guard (refused commands only)
//   onboard   slop.date onboarding: evals/slop-onboarding corpus gates (rules only) and the persona onboarding sim (seeds 13-14)
//   clef      P2 Clef weight fitting: synthetic labels from the slop world's hidden appearance (seed 1, 2,000 labels
//             per dimension); ranking recovery, weights file round trip, extraction, bias audit, labelling page
//   capital   network capital: 32 paired seeds, 90 days (--with-capital or --only capital)
import { auditBlock } from "./sim/audit.ts";
import { capitalBlock } from "./sim/capital.ts";
import { clefBlock } from "./sim/clef.ts";
import { evalsBlock } from "./sim/evals.ts";
import { friendsBlock } from "./sim/friends.ts";
import { Block, type Gate } from "./sim/gate.ts";
import { onboardBlock } from "./sim/onboard.ts";
import { networkBlock } from "./sim/network.ts";
import { opsBlock } from "./sim/ops.ts";
import { peonBlock } from "./sim/peon.ts";
import { pipelineBlock } from "./sim/pipeline.ts";
import { safetyBlock } from "./sim/safety.ts";
import { relayBlock } from "./sim/relay.ts";
import { slopBlock } from "./sim/slop.ts";

type Opts = { quick: boolean; llm: boolean };
const BLOCKS: Record<string, (b: Block, o: Opts) => Promise<void>> = {
  evals: b => evalsBlock(b),
  network: networkBlock,
  slop: slopBlock,
  onboard: onboardBlock,
  relay: b => relayBlock(b),
  peon: peonBlock,
  friends: friendsBlock,
  pipeline: b => pipelineBlock(b),
  safety: b => safetyBlock(b),
  ops: b => opsBlock(b),
  audit: b => auditBlock(b),
  clef: b => clefBlock(b),
  capital: capitalBlock,
};
const DEFAULT = ["evals", "onboard", "network", "slop", "relay", "peon", "friends", "clef", "safety", "ops", "pipeline", "audit"];

const argv = process.argv.slice(2);
const values = (k: string) => argv.flatMap((x, i) => (x === `--${k}` ? (argv[i + 1] ?? "").split(",") : x.startsWith(`--${k}=`) ? x.slice(k.length + 3).split(",") : [])).filter(Boolean);
const only = values("only");
const unknown = only.filter(x => !BLOCKS[x]);
if (unknown.length) { console.error(`unknown block: ${unknown.join(", ")}; known: ${Object.keys(BLOCKS).join(", ")}`); process.exit(2); }
const run = only.length ? only : [...DEFAULT, ...(argv.includes("--with-capital") || argv.includes("--nightly") ? ["capital"] : [])];
const opts: Opts = { quick: argv.includes("--quick"), llm: argv.includes("--llm") };

// Simulations never call a model: fail fast if any code path tries. The one exception is the
// onboarding LLM arm, which runs only with --llm (and only in the onboard block).
if (opts.llm) console.log("--llm: provider keys kept for the onboarding LLM arm (tracked gates only)");
else for (const k of ["OPENAI_API_KEY", "SURPLUS_API_KEY", "CLOUDFLARE_AI_TOKEN"]) delete process.env[k];

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
