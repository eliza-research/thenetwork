import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { overlap, paired, pairedLine, saltSeed, idsSalted } from "../../packages/sim/src/paired.ts";

type Block = "friends" | "slop" | "network";
interface SeedResult { seed: number; values: Record<string, number>; events: string[] }

const ARMS = {
  friends: { n: 400, weeks: 8 },
  slop: { weeks: 4, perCity: 300, world: { catfish: 0.005, bodyTypes: true, verification: true, relay: { engine: true }, review: 3, widen: true, checkin: true, rater: true } },
  network: { days: 21 },
};

const num = (x: unknown) => (typeof x === "number" ? x : NaN);

async function child(block: Block, seeds: number[], salt: number, opts: Record<string, unknown>): Promise<SeedResult[]> {
  const tree = process.cwd();
  const load = async (path: string) => import(pathToFileURL(join(tree, path)).href);
  const out: SeedResult[] = [];
  if (block === "friends") {
    const { runFriendsWorld } = await load("packages/sim/src/apps/friends/world.ts");
    const { friendsPackMatcher } = await load("packages/sim/src/apps/friends/packMatcher.ts");
    const { friendsMetrics } = await load("packages/sim/src/apps/friends/metrics.ts");
    for (const seed of seeds) {
      const res = runFriendsWorld({ seed, n: ARMS.friends.n, weeks: ARMS.friends.weeks, matcher: idsSalted(friendsPackMatcher(opts), salt) });
      const m = friendsMetrics(res);
      out.push({ seed, values: { meetups: m.meetups, v14: m.v14, repeatRate: m.repeatRate, evPerProposal: num(m.expected?.perProposal), evPerMember: num(m.expected?.perMember) },
        events: res.meetups.map((x: { activity: string; attendees: string[] }) => `${x.activity}:${[...x.attendees].sort().join(",")}`) });
      process.stderr.write(`  friends seed ${seed} done\n`);
    }
  } else if (block === "slop") {
    const { runSlopWorldAsync } = await load("packages/sim/src/apps/slop/world.ts");
    const { slopEngineMatcher } = await load("packages/sim/src/apps/slop/enginePack.ts");
    const { slopMetrics } = await load("packages/sim/src/apps/slop/metrics.ts");
    const { worldOptions } = await load("packages/sim/src/apps/slop/packEval.ts");
    const { world, weeks, perCity } = ARMS.slop;
    for (const seed of seeds) {
      const res = await runSlopWorldAsync({ seed, perCity, weeks, matcher: slopEngineMatcher({ name: "slop", options: opts, seed: saltSeed(seed, salt) }), ...worldOptions(world) });
      const m = slopMetrics(res);
      out.push({ seed, values: { dates: m.dates, secondDates: Math.round(m.secondDateRate * m.dates), goodDates: Math.round(m.goodDateRate * m.dates), evGoodPerProposal: num(m.expected?.goodPerProposal), evSecondPerProposal: num(m.expected?.secondPerProposal), evGoodPerMember: num(m.expected?.goodPerMember) },
        events: res.flows.filter((f: { stage: string }) => f.stage === "date").map((f: { first: string; partner: string }) => [f.first, f.partner].sort().join("|")) });
      process.stderr.write(`  slop seed ${seed} done\n`);
    }
  } else {
    const { runArm } = await load("packages/network/harness/experiment.ts");
    for (const seed of seeds) {
      let events: string[] = [];
      const r = await runArm("consent", { days: ARMS.network.days, seed, network: { ...opts, ...(salt ? { seed: seed + 1000 * salt } : {}) },
        onRecords: (records: { type: string; attendance?: Record<string, { showed: boolean }> }[]) => {
          events = records.filter(x => x.type === "outcome").map(o => Object.entries(o.attendance ?? {}).filter(([, a]) => a.showed).map(([id]) => id).sort()).filter(ids => ids.length >= 2).map(ids => ids.join(","));
        } });
      out.push({ seed, values: { meetings: r.meetingsHeld, everyoneYes: r.proposalsAllYes, joined: r.newMembersJoined, evPerProposal: num(r.expected?.perProposal), evPerMember: num(r.expected?.perMember) }, events });
      process.stderr.write(`  network seed ${seed} done\n`);
    }
  }
  return out;
}

function checkTree(tree: string): void {
  const root = realpathSync(tree), bad: string[] = [];
  const scopes = [join("node_modules", "@thenetwork"), ...readdirSync(join(tree, "packages")).map(pkg => join("packages", pkg, "node_modules", "@thenetwork"))];
  for (const scope of scopes) {
    if (!existsSync(join(tree, scope))) continue;
    for (const l of readdirSync(join(tree, scope))) {
      const real = realpathSync(join(tree, scope, l));
      if (!real.startsWith(root + "/")) bad.push(`${scope}/${l} -> ${real}`);
    }
  }
  if (bad.length) throw new Error(`paired: ${tree} resolves workspace packages outside itself:\n  ${bad.join("\n  ")}`);
}

function runChild(tree: string, block: Block, seeds: number[], salt: number, opts: string): SeedResult[] {
  checkTree(tree);
  const r = spawnSync(process.execPath, ["--import", "tsx", "--conditions", "eliza-source", import.meta.filename, "--child", block, "--seeds", seeds.join(","), "--salt", String(salt), "--opts", opts],
    { cwd: tree, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], maxBuffer: 1 << 28 });
  const line = r.stdout.split("\n").find(l => l.startsWith("RESULT "));
  if (r.status !== 0 || !line) throw new Error(`paired: the arm in ${tree} failed (exit ${r.status})\n${r.stdout.slice(-2000)}`);
  return JSON.parse(line.slice(7)) as SeedResult[];
}

function seedList(s: string): number[] {
  return s.split(",").flatMap(part => { const [a, b] = part.split("-").map(Number); return b === undefined ? [a!] : Array.from({ length: b - a! + 1 }, (_, i) => a! + i); });
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name: string, d?: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1]! : d; };
  if (args[0] === "--child") {
    const res = await child(args[1] as Block, seedList(arg("seeds")!), Number(arg("salt")), JSON.parse(arg("opts")!));
    process.stdout.write(`RESULT ${JSON.stringify(res)}\n`);
    return;
  }
  const block = arg("block") as Block;
  if (!(block in ARMS)) throw new Error("paired: --block friends|slop|network");
  const here = resolve(import.meta.dirname, "../..");
  const treeA = resolve(arg("a", here)!), treeB = resolve(arg("b", treeA)!);
  const seeds = seedList(arg("seeds", "1-20")!);
  const saltA = Number(arg("a-salt", "0")), saltB = Number(arg("b-salt", "0"));
  console.log(`paired ${block}: seeds ${seeds.join(",")} (n ${seeds.length})\n  A ${treeA} salt ${saltA} ${arg("a-opts", "{}")}\n  B ${treeB} salt ${saltB} ${arg("b-opts", "{}")}`);
  const A = runChild(treeA, block, seeds, saltA, arg("a-opts", "{}")!);
  const B = runChild(treeB, block, seeds, saltB, arg("b-opts", "{}")!);
  const report: Record<string, unknown> = { block, seeds, a: { tree: treeA, salt: saltA, opts: arg("a-opts", "{}") }, b: { tree: treeB, salt: saltB, opts: arg("b-opts", "{}") }, metrics: {} };
  for (const k of Object.keys(A[0]!.values)) {
    const a = A.map(r => r.values[k] ?? NaN), b = B.map(r => r.values[k] ?? NaN);
    const absent = [a.some(x => !Number.isFinite(x)) && "A", b.some(x => !Number.isFinite(x)) && "B"].filter(Boolean);
    if (absent.length) { console.log(`  ${k}: not reported by arm ${absent.join(" and ")}`); continue; }
    console.log(`  ${k}: ${pairedLine(a, b)}`);
    (report.metrics as Record<string, unknown>)[k] = { a, b, ...paired(a, b) };
  }
  const same = A.map((r, i) => overlap(r.events, B[i]!.events));
  console.log(`  same events (Jaccard per seed): ${same.map(x => x.toFixed(2)).join(", ")}`);
  report.overlap = same;
  const out = arg("json");
  if (out) writeFileSync(out, JSON.stringify(report, null, 1));
}

await main();
