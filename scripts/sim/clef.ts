// The clef block: P2 Clef weight fitting (docs/results/2026-10-09-clef-fitting.md), on synthetic
// labels generated from the slop world's hidden appearance (packages/sim/src/apps/slop/clefSynth.ts).
// Offline and deterministic: Workers AI is only ever a fake fetch here, and the CLI is run with the
// Cloudflare env removed.
//
// PINNED: synthetic world seed 1 (250 per city, about 690 adult photos, 25% never labelled), 2,000
// labels per dimension from 6 raters (one careless), fit seed 1.
// BLOCKING:
//   - ranking recovery on unseen photos: Kendall tau vs hidden truth >= 0.6 overall, >= 0.5 face / body,
//     and above the placeholder weights;
//   - the agreement report flags the careless rater and no careful one;
//   - the fitted file round-trips: written, loaded by loadClefWeights, rates through
//     WorkersAIClefRater (fake fetch) with tau >= 0.6; the CLI `fit` writes a file that loads;
//   - flagged photos, excluded raters and thin dimensions are handled; the fit is deterministic;
//   - feature extraction: consent manifest, adults only, flags, cache, dry run (0 photo reads),
//     `--live` refuses without the env;
//   - bias audit: flags a group the model under-rates (Clef bias 0.7 SD), not at bias 0; outcome ratios
//     under 0.8x by group and by rating quintile are flagged; small groups are suppressed;
//   - the labelling page cannot make a network request.
// TRACKED: the label-count curve (tau, held-out accuracy, ECE) and calibration.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLEF_FEATURES, clefFeatures, WorkersAIClefRater } from "../../packages/engine/src/packs/slop/clef.ts";
import { DEFAULT_CLEF_WEIGHTS, loadClefWeights } from "../../packages/engine/src/packs/slop/clefWeights.ts";
import { auditRatings, type AuditMember } from "../../packages/engine/src/packs/slop/clef-fit/audit.ts";
import { planExtraction, runExtraction, type FeatureCacheRow, type ManifestRow } from "../../packages/engine/src/packs/slop/clef-fit/features.ts";
import { DIMS, fitClefWeights, groupResiduals, kendallTau, parseLabel } from "../../packages/engine/src/packs/slop/clef-fit/fit.ts";
import { labelCurve, synthAnswers, synthFit, synthLabels, synthPhotos } from "../../packages/sim/src/apps/slop/clefSynth.ts";
import { applyHead } from "../../packages/engine/src/packs/slop/clef.ts";
import { Block, digest, expect } from "./gate.ts";

export const CLEF_PINNED = { seed: 1, perCity: 250, labels: 2000 };
const ROOT = join(import.meta.dir, "..", "..");

/** A fake Workers AI fetch answering from synthetic feature rows (keyed by the photo bytes). */
function fakeFetch(rows: ReadonlyMap<string, Record<string, number>>, calls: string[]) {
  return async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as { images: string[] };
    const id = Buffer.from(body.images[0]!.split(",")[1]!, "base64").toString("latin1").slice(4);
    calls.push(id);
    const x = rows.get(id);
    return { ok: !!x, status: x ? 200 : 404, json: async () => (x ? { success: true, result: { answers: synthAnswers(x) } } : { success: false, errors: [{ message: "unknown photo" }] }) };
  };
}
const photoBytes = (id: string) => new Uint8Array(Buffer.from(`\xff\xd8\xff\xe0${id}`, "latin1"));

export async function clefBlock(b: Block): Promise<void> {
  const P = CLEF_PINNED;
  const s = synthPhotos({ seed: P.seed, perCity: P.perCity });
  const fit = synthFit(s, { n: P.labels, seed: P.seed });
  const f2 = (x: number) => x.toFixed(3);

  b.gate(`clef fit: hidden overall ranking recovered from ${P.labels} labels (Kendall tau on ${s.test.length} unseen photos >= 0.6)`, fit.tau.overall >= 0.6, `tau ${f2(fit.tau.overall)} (placeholder ${f2(fit.placeholderTau.overall)})`);
  b.gate("clef fit: face and body rankings recovered (tau >= 0.5 each)", fit.tau.face >= 0.5 && fit.tau.body >= 0.5, `face ${f2(fit.tau.face)}, body ${f2(fit.tau.body)}`);
  b.gate("clef fit: fitted weights rank better than the placeholder on every dimension", DIMS.every(d => fit.tau[d] > fit.placeholderTau[d]), DIMS.map(d => `${d} ${f2(fit.tau[d])} vs ${f2(fit.placeholderTau[d])}`).join(", "));
  const raters = fit.report.agreement.raters;
  b.gate("clef fit: agreement report flags the careless rater and no careful rater", !!raters.find(r => r.rater === "rater-careless")?.flags.length && raters.filter(r => r.rater !== "rater-careless").every(r => !r.flags.length),
    raters.map(r => `${r.rater} ${r.flags.length ? "FLAGGED" : "ok"}`).join(", "));
  const ho = fit.report.dims.overall.heldOut!;
  b.track("clef fit: held-out calibration, overall (ECE <= 0.05)", ho.ece <= 0.05, `acc ${(100 * ho.accuracy).toFixed(1)}%, ECE ${f2(ho.ece)}, log-loss ${f2(ho.logLoss)}, alpha ${f2(fit.report.agreement.alpha.overall.alpha ?? NaN)}`);

  await b.run("clef weights: the fitted file writes, loads and rates through WorkersAIClefRater (fake fetch) with tau >= 0.6", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clef-sim-"));
    try {
      const path = join(dir, "clefWeights.json");
      await Bun.write(path, JSON.stringify(fit.weights, null, 2));
      const w = await loadClefWeights(path);
      expect(w.placeholder).toBe(false);
      expect(w.provenance?.fitter).toBe("clef-fit-1");
      expect(w.provenance?.labels).toBe(fit.report.usableLabels);
      expect(Object.keys(w.heads.overall.w).some(f => f.startsWith("gate.") || f.startsWith("body.type="))).toBe(false);
      // Answers round-trip to the same features (the fake fetch speaks the Clef response format).
      const x0 = s.rows.get(s.test[0]!)!;
      const back = clefFeatures(synthAnswers(x0)).x;
      for (const f of CLEF_FEATURES) expect(Math.abs((back[f] ?? 0) - (x0[f] ?? 0))).toBeLessThan(1e-9);
      const calls: string[] = [];
      const rater = new WorkersAIClefRater({ token: "fake", accountId: "fake", weights: w, fetch: fakeFetch(s.rows, calls) });
      expect(rater.id).toContain(w.version);
      const rated = new Map<string, number>();
      for (const id of s.test) { const r = await rater.rate({ age: 30, ageVerified: true }, [{ id, bytes: photoBytes(id) }]); if (r) rated.set(id, r.overall); }
      expect(rated.size).toBe(s.test.length);
      expect(calls.length).toBe(s.test.length);
      const tau = kendallTau(rated, new Map(s.test.map(id => [id, s.truth.get(id)!.overall])));
      expect(tau).toBeGreaterThanOrEqual(0.6);
      // Adults only: an unverified or under-18 subject makes no call.
      expect(await rater.rate({ age: 17 }, [{ id: s.test[0]!, bytes: photoBytes(s.test[0]!) }])).toBeNull();
      expect(await rater.rate({ age: 30, ageVerified: false }, [{ id: s.test[0]!, bytes: photoBytes(s.test[0]!) }])).toBeNull();
      expect(calls.length).toBe(s.test.length);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  await b.run("clef fit: deterministic; flagged photos and excluded raters drop out; thin dimensions keep the base head", () => {
    const labels = synthLabels(s, { n: 600, dim: "overall", seed: 9 });
    const o = { version: "det", fittedAt: "2026-10-09", population: s.train.map(id => s.rows.get(id)!) };
    expect(digest(fitClefWeights(s.rows, labels, o).weights)).toBe(digest(fitClefWeights(s.rows, labels, o).weights));
    const flagged = labels[0]!.a;
    const r = fitClefWeights(s.rows, [...labels, { flag: flagged, reason: "may be under 18" }], { ...o, excludeRaters: ["rater-careless"] });
    // Excluded raters are dropped first, then labels touching a flagged photo.
    const careless = labels.filter(l => l.rater === "rater-careless").length, touching = labels.filter(l => l.rater !== "rater-careless" && (l.a === flagged || l.b === flagged)).length;
    expect(r.report.dropped.byFlag).toBe(touching);
    expect(r.report.dropped.byRater).toBe(careless);
    expect(r.report.usableLabels).toBe(labels.length - touching - careless);
    expect(r.report.dims.face.source).toBe("base");
    expect(r.weights.heads.face).toEqual(DEFAULT_CLEF_WEIGHTS.heads.face);
    expect(r.weights.provenance!.dims.face.source).toBe("base");
    expect(r.weights.placeholder).toBe(false);
    // The labelling tool's line format parses; skips and malformed lines do not.
    expect(parseLabel({ a: "x/1.jpg", b: "y/2.jpg", winner: "a", dim: "face", rater: "r1", shared: true, ms: 900 })).toEqual({ a: "x/1.jpg", b: "y/2.jpg", winner: "a", dim: "face", rater: "r1" });
    expect(parseLabel({ a: "x/1.jpg", b: "y/2.jpg", skip: true, rater: "r1" })).toBeNull();
    expect(parseLabel({ a: "x", b: "x", winner: "a" })).toBeNull();
    expect(parseLabel({ flag: "x/1.jpg", reason: "may be under 18" })).toEqual({ flag: "x/1.jpg", reason: "may be under 18" });
  });

  await b.run("clef features: consent manifest, adults only, flags and cache decide what is sent; dry run reads nothing", async () => {
    const ids = s.train.slice(0, 8);
    const man = (id: string, m: Partial<ManifestRow>): [string, ManifestRow] => [id, { photo: id, subject: id.split("/")[0]!, age: 30, ageVerified: true, consent: `release-${id}`, ...m }];
    const manifest = new Map<string, ManifestRow>([
      man(ids[0]!, {}), man(ids[1]!, {}), man(ids[2]!, { age: 17 }), man(ids[3]!, { ageVerified: false }), man(ids[4]!, { consent: "" }), man(ids[5]!, {}), man(ids[6]!, {}),
    ]); // ids[7]: no manifest row
    const photos = ids.map(id => ({ id, bytes: 1000, sha256: `sha-${id}` }));
    const cache = new Map<string, FeatureCacheRow>([[ids[6]!, { id: ids[6]!, sha256: `sha-${ids[6]}`, model: "clef", x: {}, confidence: 1, extractedAt: "2026-10-09" }]]);
    const plan = planExtraction(photos, manifest, { cache, flagged: new Set([ids[5]!]), model: "clef" });
    expect(plan.todo.map(t => t.id).sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(plan.skipped["not a verified adult"].sort()).toEqual([ids[2]!, ids[3]!].sort());
    expect(plan.skipped["no consent reference"]).toEqual([ids[4]!]);
    expect(plan.skipped["flagged by a rater"]).toEqual([ids[5]!]);
    expect(plan.skipped.cached).toEqual([ids[6]!]);
    expect(plan.skipped["no manifest row"]).toEqual([ids[7]!]);
    // An edited photo (new hash) is rated again.
    expect(planExtraction([{ ...photos[6]!, sha256: "changed" }], manifest, { cache, model: "clef" }).todo.length).toBe(1);
    const calls: string[] = [], reads: string[] = [], out: FeatureCacheRow[] = [];
    const source = new WorkersAIClefRater({ token: "fake", accountId: "fake", maxPhotos: 1, fetch: fakeFetch(s.rows, calls) });
    const res = await runExtraction(plan, { source, model: "clef", now: () => "2026-10-09", read: async id => { reads.push(id); return { bytes: photoBytes(id), sha256: `sha-${id}` }; }, write: async r => { out.push(r); } });
    expect(res).toEqual({ done: 2, failed: 0 });
    expect(calls.sort()).toEqual([ids[0]!, ids[1]!].sort());
    expect(reads.length).toBe(2);
    for (const r of out) for (const f of CLEF_FEATURES) expect(Math.abs((r.x[f] ?? 0) - (s.rows.get(r.id)![f] ?? 0))).toBeLessThan(1e-9);
    // A resumed run sends nothing already cached.
    const again = planExtraction(photos, manifest, { cache: new Map([...cache, ...out.map(r => [r.id, r] as const)]), flagged: new Set([ids[5]!]), model: "clef" });
    expect(again.todo.map(t => t.id)).toEqual([]);
  });

  await b.run("clef CLI: fit writes a weights file that loads; features is a dry run without --live and refuses --live without the env", async () => {
    const dir = await mkdtemp(join(tmpdir(), "clef-cli-"));
    try {
      const labels = DIMS.flatMap(dim => synthLabels(s, { n: 300, dim, seed: 3 }));
      await Bun.write(join(dir, "features.jsonl"), [...s.rows].map(([id, x]) => JSON.stringify({ id, x })).join("\n"));
      await Bun.write(join(dir, "labels.jsonl"), labels.map(l => JSON.stringify(l)).join("\n"));
      const env = { ...process.env };
      for (const k of ["CLOUDFLARE_AI_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "OPENAI_API_KEY", "SURPLUS_API_KEY"]) delete env[k];
      const cli = (...args: string[]) => Bun.spawnSync([process.execPath, "run", "--conditions", "eliza-source", join(ROOT, "scripts/clef-fit.ts"), ...args], { cwd: ROOT, env });
      const r = cli("fit", "--features", join(dir, "features.jsonl"), "--pairs", join(dir, "labels.jsonl"), "--out", join(dir, "w.json"), "--version", "sim-cli");
      expect(r.exitCode).toBe(0);
      const w = await loadClefWeights(join(dir, "w.json"));
      expect(w.version).toBe("sim-cli");
      expect(w.provenance?.pairsSha256?.length).toBe(64);
      // No photo id appears in the printed report (aggregates only).
      expect(r.stdout.toString()).not.toContain(s.train[0]!);
      await Bun.write(join(dir, "photos", "a.jpg"), photoBytes("a"));
      await Bun.write(join(dir, "manifest.jsonl"), JSON.stringify({ photo: "a.jpg", subject: "s", age: 30, ageVerified: true, consent: "r1" }));
      const dry = cli("features", "--photos", join(dir, "photos"), "--manifest", join(dir, "manifest.jsonl"), "--out", join(dir, "f.jsonl"));
      expect(dry.exitCode).toBe(0);
      expect(dry.stdout.toString()).toContain("cost estimate");
      expect(dry.stdout.toString()).toContain("dry run");
      expect(await Bun.file(join(dir, "f.jsonl")).exists()).toBe(false);
      const live = cli("features", "--photos", join(dir, "photos"), "--manifest", join(dir, "manifest.jsonl"), "--out", join(dir, "f.jsonl"), "--live");
      expect(live.exitCode).toBe(2);
      expect(live.stdout.toString()).toContain("cost estimate"); // the estimate prints before the env check
      expect(live.stderr.toString()).toContain("CLOUDFLARE_AI_TOKEN");
      expect(await Bun.file(join(dir, "f.jsonl")).exists()).toBe(false);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  await b.run("clef audit: flags a group the model under-rates (Clef bias 0.7 SD), not at bias 0; outcome ratios under 0.8x flagged; small groups suppressed", () => {
    const score = (sp: ReturnType<typeof synthPhotos>): AuditMember[] => [...sp.rows].map(([id, x]) => ({ id, overall: applyHead(fit.weights, x).overall, group: sp.group.get(id)! }));
    const sb = synthPhotos({ seed: P.seed, perCity: P.perCity, clefBias: 0.7 });
    const fair = auditRatings(score(s)), biased = auditRatings(score(sb));
    expect(fair.flags).toEqual([]);
    expect(biased.flags.some(f => f.group === "B" && f.kind === "selection")).toBe(true);
    expect(biased.scores.B!.selectionRatio).toBeLessThan(0.8);
    // Label-side check (fit --groups): with unbiased raters, the model fitted on Clef-biased features
    // under-rates B relative to the raters (positive residual); on unbiased features it does not.
    const resid = (sp: typeof s) => {
      const labels = synthLabels(sp, { n: P.labels, dim: "overall", seed: P.seed });
      const w = fitClefWeights(sp.rows, labels, { version: "resid", fittedAt: "2026-10-09" }).weights;
      return groupResiduals(w.heads.overall, sp.rows, labels, id => sp.group.get(id));
    };
    const rb = resid(sb).B!, r0 = resid(s).B!;
    expect(rb.residual).toBeGreaterThan(Math.max(0.03, 2 * rb.se));
    expect(Math.abs(r0.residual)).toBeLessThan(Math.max(0.05, 2 * r0.se));
    // Outcomes: the bottom rating quintile gets 0.6x the dates of everyone else.
    const ms: AuditMember[] = [...s.rows.keys()].map((id, i) => {
      const overall = s.truth.get(id)!.overall;
      return { id, overall, group: i % 100 === 0 ? "tiny" : s.group.get(id)!, memberMonths: 1, proposals: 2, dates: 1, secondDates: 0.3 };
    });
    const cut = [...ms].sort((a, b) => a.overall - b.overall)[Math.floor(ms.length / 5) - 1]!.overall;
    for (const m of ms) if (m.overall <= cut) m.dates = 0.6;
    const r = auditRatings(ms);
    expect(r.flags.some(f => f.kind === "outcome" && f.group === "q1" && f.metric === "dates")).toBe(true);
    expect(r.suppressed.tiny).toBeGreaterThan(0);
    expect(Object.keys(r.scores)).not.toContain("tiny");
    expect(JSON.stringify(r)).not.toContain(s.train[0]!); // aggregates only
  });

  await b.run("clef labelling page: local only (CSP forbids network; no network API or remote URL in the page)", async () => {
    const html = await Bun.file(join(ROOT, "tools/clef-label/index.html")).text();
    const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).toMatch(/img-src blob:;/);
    for (const bad of [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/, /https?:\/\//, /<link\b/i, /<form\b/i, /\bimport\s*\(/]) expect(bad.test(html)).toBe(false);
    expect(html).toMatch(/Adults only/);
    expect(html).toMatch(/Consented photos only/);
  });

  // Tracked: label count vs ranking recovery (the P2 label budget; the doc has the 3-seed curve).
  const curve = labelCurve({ seeds: [P.seed], counts: [250, 500, 1000, 2000], perCity: P.perCity });
  b.track("clef label curve (seed 1, overall): labels -> tau / held-out acc / ECE", curve.points.every(p => p.n < 1000 || p.tau >= 0.6),
    `${curve.points.map(p => `${p.n}: ${f2(p.tau)}/${(100 * p.heldOutAccuracy).toFixed(0)}%/${f2(p.ece)}`).join("  ")}; placeholder ${f2(curve.placeholderTau)}, ceiling ${f2(curve.ceilingTau)}`);
}
