// Clef weight fitting for P2 (operator CLI). Everything runs locally; only `features --live` calls
// Cloudflare Workers AI, and only with CLOUDFLARE_AI_TOKEN + CLOUDFLARE_ACCOUNT_ID set. Reports are
// aggregates only: no photo id, member id or per-person score is printed. Runbook:
// docs/results/2026-10-09-clef-fitting.md.
//
//   bun run clef fit --features features.jsonl --pairs labels.jsonl[,more.jsonl] [--out clefWeights.json]
//       [--version v1-2026-11] [--notes text] [--holdout 0.2] [--split pair|photo] [--seed 1]
//       [--l2 auto|0.01] [--min-pairs 50] [--exclude-raters id,id] [--exclude-features f,f] [--include-body-type]
//       [--population member-features.jsonl] [--no-refit] [--report report.json]
//       [--groups groups.jsonl]   opt-in self-reported groups ({"photo", "group"} per line): label-side
//                                 bias check (does the model rate a group lower than the raters do?)
//   bun run clef calibrate --weights clefWeights.json --population member-features.jsonl --out clefWeights.json
//   bun run clef features --photos <dir> --manifest consent.jsonl --out features.jsonl
//       [--labels labels.jsonl] [--model clef|clef-flash] [--concurrency 4] [--budget-usd 5] [--live]
//       Without --live: the plan and the cost estimate only (no network). With --live: needs the env.
//   bun run clef audit --members members.jsonl [--weights clefWeights.json --features features.jsonl]
//       [--min-n 15] [--threshold 0.8] [--json audit.json]
//   bun run clef synth --curve [--seeds 1-3] [--counts 125,250,500,1000,2000,4000,8000] [--json curve.json]
//   bun run clef synth --write <dir> [--seed 1] [--n 2000] [--clef-bias 0] [--rater-bias 0]
//       synthetic features, labels and members from the slop world, to rehearse fit and audit.
import { appendFile, mkdir, readdir, stat } from "node:fs/promises";
import { hash32 } from "../packages/core/src/index.ts";
import { join, relative, sep } from "node:path";
import { applyHead, CLEF_MODEL_IDS, WorkersAIClefRater, type ClefModel } from "../packages/engine/src/packs/slop/clef.ts";
import { loadClefWeights, type ClefWeights } from "../packages/engine/src/packs/slop/clefWeights.ts";
import { auditRatings, formatAudit, type AuditMember } from "../packages/engine/src/packs/slop/clef-fit/audit.ts";
import { estimateCost, planExtraction, runExtraction, type FeatureCacheRow, type ManifestRow } from "../packages/engine/src/packs/slop/clef-fit/features.ts";
import { calibrateClefWeights, DIMS, fitClefWeights, formatFitReport, groupResiduals, parseLabel, type LabelledPair, type PhotoFlag } from "../packages/engine/src/packs/slop/clef-fit/fit.ts";

const argv = process.argv.slice(2);
const cmd = argv[0];
const arg = (k: string) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
const has = (k: string) => argv.includes(`--${k}`);
const num = (k: string, d: number) => { const v = arg(k); if (v === undefined) return d; const n = Number(v); if (!Number.isFinite(n)) die(`--${k} must be a number`); return n; };
function die(msg: string, code = 2): never { console.error(msg); process.exit(code); }
const list = (v: string | undefined) => (v ?? "").split(",").map(s => s.trim()).filter(Boolean);
const range = (v: string) => list(v).flatMap(x => { const [a, b] = x.split("-").map(Number); return b ? Array.from({ length: b - a! + 1 }, (_, i) => a! + i) : [a!]; });

async function jsonl<T>(path: string): Promise<T[]> {
  const f = Bun.file(path);
  if (!(await f.exists())) die(`not found: ${path}`);
  return (await f.text()).split("\n").filter(l => l.trim()).map((l, i) => { try { return JSON.parse(l) as T; } catch { die(`${path}:${i + 1}: not JSON`); } });
}
const sha256 = (data: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(data).digest("hex");
async function fileSha(paths: string[]): Promise<string> { const h = new Bun.CryptoHasher("sha256"); for (const p of paths) h.update(await Bun.file(p).bytes()); return h.digest("hex"); }
function gitCommit(): string | undefined {
  try { const r = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"], { cwd: import.meta.dir }); return r.exitCode === 0 ? r.stdout.toString().trim() : undefined; } catch { return undefined; }
}
async function featureRows(path: string): Promise<Map<string, Record<string, number>>> {
  return new Map((await jsonl<{ id: string; x: Record<string, number> }>(path)).filter(r => r?.id && r.x).map(r => [r.id, r.x]));
}
async function labelsFrom(paths: string[]): Promise<(LabelledPair | PhotoFlag)[]> {
  const out: (LabelledPair | PhotoFlag)[] = [];
  for (const p of paths) for (const o of await jsonl<unknown>(p)) { const l = parseLabel(o); if (l) out.push(l); }
  return out;
}

async function fit() {
  const fp = arg("features"), pp = list(arg("pairs")), out = arg("out") ?? "clefWeights.json";
  if (!fp || !pp.length) die("usage: bun run clef fit --features features.jsonl --pairs labels.jsonl[,more.jsonl] [--out clefWeights.json] (see scripts/clef-fit.ts)");
  const rows = await featureRows(fp), labels = await labelsFrom(pp);
  const l2v = arg("l2") ?? "auto";
  const split = arg("split") ?? "pair";
  if (split !== "pair" && split !== "photo") die("--split must be pair or photo");
  const pop = arg("population");
  const fittedAt = new Date().toISOString();
  const { weights, report } = fitClefWeights(rows, labels, {
    version: arg("version") ?? `fit-${fittedAt.slice(0, 10)}`, ...(arg("notes") ? { notes: arg("notes")! } : {}), fittedAt,
    holdout: num("holdout", 0.2), split, seed: num("seed", 1), l2: l2v === "auto" ? "auto" : Number(l2v),
    minPairs: num("min-pairs", 50), includeBodyType: has("include-body-type"), excludeRaters: list(arg("exclude-raters")), excludeFeatures: list(arg("exclude-features")), refitAll: !has("no-refit"),
    ...(pop ? { population: (await featureRows(pop)).values() } : {}),
    provenance: { commit: gitCommit(), pairsSha256: await fileSha(pp), featuresSha256: await fileSha([fp]), calibratedOn: pop ? `population file (sha256 ${(await fileSha([pop])).slice(0, 12)})` : "the labelled photos' feature rows" },
  });
  console.log(formatFitReport(report, weights));
  if (arg("groups")) {
    const groups = new Map((await jsonl<{ photo: string; group: string }>(arg("groups")!)).filter(r => r.photo && r.group).map(r => [r.photo, String(r.group)]));
    const flagged = new Set(labels.flatMap(l => ("flag" in l ? [l.flag] : [])));
    const excluded = new Set(list(arg("exclude-raters")));
    const pairs = labels.filter((l): l is LabelledPair => !("flag" in l) && !flagged.has(l.a) && !flagged.has(l.b) && !excluded.has(l.rater ?? "?"));
    console.log("\nlabel-side bias check (positive = the model rates the group LOWER than the raters; groups with < 50 labels suppressed):");
    for (const d of DIMS.filter(d => report.dims[d].source === "fitted")) {
      const r = groupResiduals(weights.heads[d], rows, pairs.filter(p => (p.dim ?? "overall") === d), id => groups.get(id));
      const shown = Object.entries(r).filter(([, v]) => v.n >= 50);
      console.log(`  ${d.padEnd(8)} ${shown.map(([g, v]) => `${g} ${v.residual >= 0 ? "+" : ""}${v.residual.toFixed(3)} ± ${v.se.toFixed(3)} (n ${v.n})${Math.abs(v.residual) > Math.max(0.05, 2 * v.se) ? " FLAG" : ""}`).join("   ") || "no group with 50+ labels"}`);
    }
  }
  if (!DIMS.some(d => report.dims[d].source === "fitted")) die(`\nno dimension had --min-pairs ${num("min-pairs", 50)} usable training labels: nothing written`, 1);
  await Bun.write(out, `${JSON.stringify(weights, null, 2)}\n`);
  await loadClefWeights(out); // the file the platform will load must validate
  if (arg("report")) await Bun.write(arg("report")!, JSON.stringify(report, null, 1));
  console.log(`\nwrote ${out} (${weights.version}; ${DIMS.map(d => `${d} ${report.dims[d].source}`).join(", ")}). Recalibrate on the member population before use: bun run clef calibrate.`);
}

async function calibrate() {
  const wp = arg("weights"), pp = arg("population"), out = arg("out") ?? wp;
  if (!wp || !pp || !out) die("usage: bun run clef calibrate --weights clefWeights.json --population member-features.jsonl [--out file]");
  const w = await loadClefWeights(wp), rows = [...(await featureRows(pp)).values()].filter(x => (x["gate.one_adult"] ?? 1) >= w.gate.oneAdult);
  const c = calibrateClefWeights({ ...w, ...(w.provenance ? { provenance: { ...w.provenance, calibratedOn: `${rows.length} population rows (sha256 ${(await fileSha([pp])).slice(0, 12)}), ${new Date().toISOString().slice(0, 10)}` } } : {}) }, rows);
  await Bun.write(out, `${JSON.stringify(c, null, 2)}\n`);
  console.log(`calibrated ${c.version} on ${rows.length} rows: ${DIMS.map(d => `${d} mean ${c.calibration[d].mean.toFixed(3)} sd ${c.calibration[d].sd.toFixed(3)}`).join("; ")} -> ${out}`);
}

const IMAGE = /\.(jpe?g|png|webp)$/i;
async function listPhotos(dir: string): Promise<{ id: string; path: string; bytes: number }[]> {
  const out: { id: string; path: string; bytes: number }[] = [];
  const walk = async (d: string) => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name.startsWith(".")) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) await walk(p);
      else if (IMAGE.test(e.name)) out.push({ id: relative(dir, p).split(sep).join("/"), path: p, bytes: (await stat(p)).size });
    }
  };
  await walk(dir);
  return out;
}

async function features() {
  const dir = arg("photos"), mp = arg("manifest"), out = arg("out") ?? "features.jsonl";
  if (!dir || !mp) die("usage: bun run clef features --photos <dir> --manifest consent.jsonl [--out features.jsonl] [--model clef|clef-flash] [--live]");
  const model = (arg("model") ?? "clef") as ClefModel;
  if (!(model in CLEF_MODEL_IDS)) die("--model must be clef or clef-flash");
  const manifest = new Map((await jsonl<ManifestRow>(mp)).map(r => [r.photo, r]));
  const cache = (await Bun.file(out).exists()) ? new Map((await jsonl<FeatureCacheRow>(out)).map(r => [r.id, r])) : new Map<string, FeatureCacheRow>();
  const flagged = new Set((await labelsFrom(list(arg("labels")))).flatMap(l => ("flag" in l ? [l.flag] : [])));
  const photos = await listPhotos(dir);
  // Cached rows are re-checked by content hash: an edited photo is rated again.
  const hashed = await Promise.all(photos.map(async p => (cache.has(p.id) ? { ...p, sha256: sha256(await Bun.file(p.path).bytes()) } : p)));
  const plan = planExtraction(hashed, manifest, { cache, flagged, model });
  const est = estimateCost(plan.todo.length, model);
  console.log(`${photos.length} photos in ${dir}; to rate: ${plan.todo.length}`);
  for (const [k, v] of Object.entries(plan.skipped)) if (v.length) console.log(`  skipped, ${k}: ${v.length}`);
  console.log(`cost estimate (${est.model}): ${est.tokens[0].toLocaleString()}-${est.tokens[1].toLocaleString()} input tokens, $${est.usd[0].toFixed(4)}-$${est.usd[1].toFixed(4)} (Cloudflare list price; output tokens are not billed)`);
  if (!has("live")) { console.log("dry run: no photo was read or sent. Add --live (with CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID set) to call Workers AI."); return; }
  const env = process.env;
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) die("--live needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment");
  const budget = num("budget-usd", 5);
  if (est.usd[1] > budget) die(`estimate $${est.usd[1].toFixed(2)} is over --budget-usd ${budget}: raise it explicitly to proceed`);
  if (!plan.todo.length) { console.log("nothing to do"); return; }
  const rater = new WorkersAIClefRater({ token: env.CLOUDFLARE_AI_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID, model, maxPhotos: 1 });
  const byId = new Map(photos.map(p => [p.id, p.path]));
  const res = await runExtraction(plan, {
    source: rater, model, now: () => new Date().toISOString(), concurrency: num("concurrency", 4),
    read: async id => { const bytes = await Bun.file(byId.get(id)!).bytes(); return { bytes, sha256: sha256(bytes) }; },
    write: row => appendFile(out, `${JSON.stringify(row)}\n`),
    onError: (_id, e) => console.error(`  error: ${(e as Error).message}`),
  });
  console.log(`rated ${res.done}, failed ${res.failed}; cache ${out} (re-run to retry failures; cached photos are not sent again)`);
}

async function audit() {
  const mp = arg("members");
  if (!mp) die("usage: bun run clef audit --members members.jsonl [--weights clefWeights.json --features features.jsonl] [--min-n 15] [--threshold 0.8]");
  type Row = AuditMember & { photos?: string[]; overall?: number };
  const rows = await jsonl<Row>(mp);
  let w: ClefWeights | undefined, feats: Map<string, Record<string, number>> | undefined;
  if (arg("weights") && arg("features")) { w = await loadClefWeights(arg("weights")!); feats = await featureRows(arg("features")!); }
  const members: AuditMember[] = [];
  let unscored = 0;
  for (const r of rows) {
    let overall = Number(r.overall);
    if (!Number.isFinite(overall) && w && feats && r.photos?.length) {
      const zs = r.photos.map(p => feats!.get(p)).filter((x): x is Record<string, number> => !!x && (x["gate.one_adult"] ?? 1) >= w!.gate.oneAdult).map(x => applyHead(w!, x).overall);
      if (zs.length) overall = zs.reduce((s, z) => s + z, 0) / zs.length;
    }
    if (!Number.isFinite(overall)) { unscored++; continue; }
    members.push({ id: r.id, overall, ...(r.group ? { group: String(r.group) } : {}), ...(r.memberMonths ? { memberMonths: r.memberMonths, proposals: r.proposals ?? 0, dates: r.dates ?? 0, secondDates: r.secondDates ?? 0 } : {}) });
  }
  const rep = auditRatings(members, { minN: num("min-n", 15), threshold: num("threshold", 0.8) });
  console.log(formatAudit(rep));
  if (unscored) console.log(`(${unscored} members had no score and no usable photo features: left out)`);
  if (arg("json")) await Bun.write(arg("json")!, JSON.stringify(rep, null, 1));
  if (rep.flags.length) process.exitCode = 3; // flags exit non-zero so a weekly job can alert
}

async function synth() {
  const { labelCurve, synthFit, synthLabels, synthPhotos } = await import("../packages/sim/src/apps/slop/clefSynth.ts");
  if (has("curve")) {
    const seeds = range(arg("seeds") ?? "1-3"), counts = list(arg("counts") ?? "125,250,500,1000,2000,4000,8000").map(Number);
    const c = labelCurve({ seeds, counts });
    console.log(`label budget curve (overall; seeds ${seeds.join(",")}; 6 raters incl. one careless; held-out photos never labelled)`);
    console.log(`placeholder weights tau ${c.placeholderTau.toFixed(3)}; ceiling (20k noiseless labels) tau ${c.ceilingTau.toFixed(3)}`);
    console.log("labels   tau (unseen photos)   held-out label acc   ECE     alpha   careless rater flagged");
    for (const p of c.points) console.log(`${String(p.n).padStart(6)}   ${p.tau.toFixed(3)} ± ${p.tauSe.toFixed(3)}         ${(100 * p.heldOutAccuracy).toFixed(1)}%                ${p.ece.toFixed(3)}   ${p.alpha === null ? " n/a " : p.alpha.toFixed(3)}   ${p.careless ? "yes (all seeds)" : "no"}`);
    if (arg("json")) await Bun.write(arg("json")!, JSON.stringify(c, null, 1));
    return;
  }
  const dir = arg("write");
  if (!dir) die("usage: bun run clef synth --curve | --write <dir>");
  const seed = num("seed", 1), n = num("n", 2000);
  const s = synthPhotos({ seed, clefBias: num("clef-bias", 0) });
  await mkdir(dir, { recursive: true });
  const labels = DIMS.flatMap(dim => synthLabels(s, { n, dim, seed, raterBias: num("rater-bias", 0) }));
  await Bun.write(join(dir, "features.jsonl"), [...s.rows].map(([id, x]) => JSON.stringify({ id, sha256: "synthetic", model: "synthetic", x, confidence: 0.8, extractedAt: "2026-10-09" })).join("\n") + "\n");
  await Bun.write(join(dir, "labels.jsonl"), labels.map(l => JSON.stringify(l)).join("\n") + "\n");
  const optIn = (id: string) => hash32("clef-synth-optin", id) % 10 < 6;
  await Bun.write(join(dir, "groups.jsonl"), [...s.rows.keys()].filter(optIn).map(id => JSON.stringify({ photo: id, group: `group-${s.group.get(id)}` })).join("\n") + "\n");
  // Members: one photo each; 60% opt in to report a (synthetic) group.
  await Bun.write(join(dir, "members.jsonl"), [...s.rows.keys()].map(id => JSON.stringify({ id: id.split("/")[0], photos: [id], ...(optIn(id) ? { group: `group-${s.group.get(id)}` } : {}) })).join("\n") + "\n");
  const f = synthFit(s, { n, seed, raterBias: num("rater-bias", 0) });
  console.log(`wrote ${dir}/{features,labels,groups,members}.jsonl (${s.rows.size} photos, ${labels.length} labels). Hidden-truth tau on unseen photos after fitting: ${DIMS.map(d => `${d} ${f.tau[d].toFixed(3)}`).join(", ")}`);
}

const CMDS: Record<string, () => Promise<void>> = { fit, calibrate, features, audit, synth };
if (!cmd || !CMDS[cmd]) die(`usage: bun run clef <${Object.keys(CMDS).join("|")}> ... (see scripts/clef-fit.ts)`);
await CMDS[cmd]!();
