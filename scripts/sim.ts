// pnpm run sim: the single validation command. Offline and deterministic: no LLM, no network, and no
// Postgres except the safety block's Postgres scenarios, which run on a database of their own on the
// dev cluster (:54339) when it is there and are tracked as skipped when it is not. Each block runs
// simulations (or scores hand-written corpora) and checks named gates; the run exits 1 when any
// BLOCKING gate fails. Tracked gates are printed and never fail the run.
//
//   pnpm run sim                      evals, onboard, network, slop, relay, peon, friends, clef (the CI run)
//   pnpm run sim --only slop          one block (repeatable or comma-separated: --only network,peon)
//   pnpm run sim --skip matching     run the default blocks except matching, which CI runs in parallel
//   pnpm run sim --only matching --matching-pack friends  run one matching pack with the pinned workload
//   pnpm run sim --quick              fewer seeds and shorter runs; quality gates become tracked
//   pnpm run sim --with-capital       also the network-capital block (slow: 32 paired seeds; nightly)
//   pnpm run sim --json out.json      write every gate to a file
//   pnpm run sim --only onboard --llm  also the onboarding LLM arm (keeps the provider keys; tracked only; never in CI)
//
// Blocks and pinned seeds (see each block's header in scripts/sim/):
//   evals     evals/ corpora: consent replies, abuse, teen ages, wants, areas, negations, core replies, opt-out, leak guard
//   network   ConsentNetwork in the NYC world: invariants (seed 3, 10 days), consent vs push (seeds 1-3, 21 days) with the
//             attention and plans invariants, NYC scenarios, sim scenarios at pass^3, networkPack conformance
//   slop      slop.date: seeds 13-16, 4 weeks, 300 per city; safety + passing quality gates block, known-failing gates tracked;
//             the relay inside the world (adversary personas after the reveal) and the photo in the probe; the slop-live arm (the
//             service's slop wiring and onboarding loop in the sim World, the stand-in review judge, seeds 21-22, 30 days)
//   relay     the relay policy (engine relay.ts): evals/relay/ corpora and scripted scenarios; photo-in-probe rule
//   peon      peon.biz: seeds 13-16, 8 weeks; the official gates block
//   peon-seats peon job postings to seats to hiring managers through the ConsentNetwork (#9): intake, routing, double opt-in, exclusions, restart, close
//   friends   friends.help: seeds 5-8, 8 weeks, 400 personas; the official gates block
//   safety    slop.date photos (adults only, consent, rater), bans on every rejoin path, report -> hold -> ban, the reviewer
//             of record, SLA alerts and the bias monitor; its Postgres scenarios block when the dev Postgres runs, else tracked
//   ops       monitoring, alerts, cost, the console's deploy guards and image contents; on the dev Postgres (tracked):
//             the ops tables under row-level security and the backup drill (dump, restore, equal row counts)
//   pipeline  the real message path: signed Blooio webhook -> NetworkService -> Postgres (a throwaway database on the dev
//             cluster, :54339) -> persisted queue -> Blooio adapter -> fake provider, simulated clock; skipped (tracked) without Postgres
//   pipeline-slop the slop world on that path: 30 simulated days of joins, review, probes, dates, STOP, leave, a restart,
//             quiet hours, the person cap and a ban mid-relay through signed webhooks; skipped (tracked) without Postgres
//   audit     regression gates for the 2026-10-08 audit's P0/P1 fixes that lost their tests in the cleanup
//             (docs/audit/2026-10-09-platform-status.md): NYC world (seed 3, 9 days), trust, plans, the four
//             site builds, the sites' API client and the Cloudflare deploy guard (refused commands only)
//   matching  the generic match core on planted worlds, engine only, per pack and lane: exactness against brute force
//             (seeds 1-10, N 100/200/400), pair-check cost (N 1k/10k/100k), parity, reciprocity, stability, circles
//   onboard   slop.date onboarding: evals/slop-onboarding corpus gates (rules only) and the persona onboarding sim (seeds 13-14)
//   clef      P2 Clef weight fitting: synthetic labels from the slop world's hidden appearance (seed 1, 2,000 labels
//             per dimension); ranking recovery, weights file round trip, extraction, bias audit, labelling page
//   capital   network capital: 32 paired seeds, 90 days (--with-capital or --only capital)
import { writePath } from "../packages/core/src/runtime/files.ts";
import { Block, type Gate } from "./sim/gate.ts";

type Opts = { quick: boolean; llm: boolean; matchingPack?: string };
const BLOCKS: Record<string, (b: Block, o: Opts) => Promise<void>> = {
  evals: async (b) => (await import("./sim/evals.ts")).evalsBlock(b),
  network: async (b, o) => (await import("./sim/network.ts")).networkBlock(b, o),
  matching: async (b, o) => (await import("./sim/matching.ts")).matchingBlock(b, o),
  slop: async (b, o) => (await import("./sim/slop.ts")).slopBlock(b, o),
  onboard: async (b, o) => (await import("./sim/onboard.ts")).onboardBlock(b, o),
  relay: async (b) => (await import("./sim/relay.ts")).relayBlock(b),
  peon: async (b, o) => (await import("./sim/peon.ts")).peonBlock(b, o),
  "peon-seats": async (b) => (await import("./sim/peon-seats.ts")).peonSeatsBlock(b),
  friends: async (b, o) => (await import("./sim/friends.ts")).friendsBlock(b, o),
  pipeline: async (b) => (await import("./sim/pipeline.ts")).pipelineBlock(b),
  "pipeline-slop": async (b) => (await import("./sim/pipeline-slop.ts")).pipelineSlopBlock(b),
  safety: async (b) => (await import("./sim/safety.ts")).safetyBlock(b),
  ops: async (b) => (await import("./sim/ops.ts")).opsBlock(b),
  clef: async (b) => (await import("./sim/clef.ts")).clefBlock(b),
  audit: async (b) => (await import("./sim/audit.ts")).auditBlock(b),
  capital: async (b, o) => (await import("./sim/capital.ts")).capitalBlock(b, o),
};
const DEFAULT = ["evals", "onboard", "network", "matching", "slop", "relay", "peon", "peon-seats", "friends", "clef", "safety", "ops", "pipeline", "pipeline-slop", "audit"];

const argv = process.argv.slice(2);
const values = (k: string) => argv.flatMap((x, i) => (x === `--${k}` ? (argv[i + 1] ?? "").split(",") : x.startsWith(`--${k}=`) ? x.slice(k.length + 3).split(",") : []));
const only = [...new Set(values("only").map(name => name.trim()))];
const skip = [...new Set(values("skip").map(name => name.trim()))];
const unknown = [...new Set([...only, ...skip])].filter(x => !Object.hasOwn(BLOCKS, x)).map(name => name || "<empty>");
if (unknown.length) { console.error(`unknown block: ${unknown.join(", ")}; known: ${Object.keys(BLOCKS).join(", ")}`); process.exit(2); }
if (only.length && skip.length) { console.error("Choose --only or --skip."); process.exit(2); }
const run = only.length ? only : [...DEFAULT, ...(argv.includes("--with-capital") || argv.includes("--nightly") ? ["capital"] : [])].filter(name => !skip.includes(name));
if (!run.length) { console.error("Select at least one simulation block."); process.exit(2); }
const matchingPacks = values("matching-pack").filter(Boolean);
const matchingPack = matchingPacks[0];
const opts: Opts = { quick: argv.includes("--quick"), llm: argv.includes("--llm"), matchingPack };

// Simulations never call a model: fail fast if any code path tries. The one exception is the
// onboarding LLM arm, which runs only with --llm (and only in the onboard block).
if (opts.llm) console.log("--llm: provider keys kept for the onboarding LLM arm (tracked gates only)");
else for (const k of ["OPENAI_API_KEY", "SURPLUS_API_KEY", "CLOUDFLARE_AI_TOKEN"]) delete process.env[k];

if (argv.some(arg => arg === "--matching-pack" || arg.startsWith("--matching-pack="))) {
  const { MATCHING_PACKS } = await import("./sim/matching.ts");
  if (matchingPacks.length !== 1 || !MATCHING_PACKS.some(app => app === matchingPack) || !run.includes("matching")) {
    console.error(`--matching-pack requires the matching block and one of ${MATCHING_PACKS.join(", ")}.`);
    process.exit(2);
  }
}

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
const out = values("json").find(Boolean);
if (out) await writePath(out, JSON.stringify({ quick: opts.quick, blocks: run, timings, total, gates: all }, null, 1));
process.exit(failed.length ? 1 : 0);
