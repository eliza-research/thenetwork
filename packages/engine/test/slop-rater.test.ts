// Iteration 4: the Workers AI Clef appearance rater (fake fetch; no network), its decision model,
// fitting and calibration, the body-type matching terms and the admin bias monitor. One optional live
// smoke test runs only with LIVE_TESTS=1 and real Cloudflare credentials.
import { describe, expect, test } from "bun:test";
import { appearanceFacet, BODY_TYPES, parseAppearance, type PhotoRef } from "../src/packs/slop/appearance.ts";
import { applyHead, CLEF_FEATURES, CLEF_MODEL_IDS, CLEF_QUESTIONS, clefFeatures, ClefError, makeClefRater, makeClefRaterFromEnv, WorkersAIClefRater, type ClefAnswer } from "../src/packs/slop/clef.ts";
import { DEFAULT_CLEF_WEIGHTS, validateClefWeights } from "../src/packs/slop/clefWeights.ts";
import { calibrateClefWeights, fitClefWeights, type LabelledPair } from "../src/packs/slop/fitClef.ts";
import { biasMonitor, ratingQuintiles } from "../src/packs/slop/biasMonitor.ts";
import { slopOptions } from "../src/packs/slop/options.ts";
import { appearanceGap, bodyTypeFactor } from "../src/packs/slop/score.ts";
import type { SlopProfile } from "../src/packs/slop/profile.ts";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const photos = (n: number): PhotoRef[] => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, bytes: JPEG }));

/** Clef-shaped answers: rating levels 0-6, gate probabilities, a body-type distribution. */
function answers(o: { face?: number; body?: number; overall?: number; adult?: number; bodyVisible?: number; bodyType?: string; conf?: number } = {}): Record<string, ClefAnswer> {
  const a: Record<string, ClefAnswer> = {};
  for (const [id, q] of Object.entries(CLEF_QUESTIONS)) {
    if (q.type === "noul") a[id] = { type: "noul", noul: 0.9 };
    else if (q.type === "score") a[id] = { type: "score", score: (q.criteria.length - 1) / 2, confidence: o.conf ?? 0.8 };
    else a[id] = { type: "choice", choice: "average", probabilities: Object.fromEntries(Object.keys(q.criteria).map(k => [k, k === (o.bodyType ?? "average") ? 0.8 : 0.04])), confidence: 0.8 };
  }
  if (o.face !== undefined) a["rate.face"]!.score = o.face;
  if (o.body !== undefined) a["rate.body"]!.score = o.body;
  if (o.overall !== undefined) a["rate.overall"]!.score = o.overall;
  if (o.adult !== undefined) a["gate.one_adult"]!.noul = o.adult;
  if (o.bodyVisible !== undefined) a["gate.body_visible"]!.noul = o.bodyVisible;
  return a;
}
function fakeFetch(per: (i: number) => Record<string, ClefAnswer> | { status: number; body: unknown }) {
  const calls: { url: string; init: { method: string; headers: Record<string, string>; body: string } }[] = [];
  const fetch = async (url: string, init: { method: string; headers: Record<string, string>; body: string }) => {
    calls.push({ url, init });
    const r = per(calls.length - 1);
    if ("status" in r && typeof r.status === "number") return { ok: r.status < 400, status: r.status as number, json: async () => (r as { body: unknown }).body };
    return { ok: true, status: 200, json: async () => ({ success: true, errors: [], messages: [], result: { model: "clef", answers: r, usage: { input_tokens: 1400, output_tokens: 0 } } }) };
  };
  return { fetch, calls };
}
const opts = (fetch: ReturnType<typeof fakeFetch>["fetch"]) => ({ token: "test-token", accountId: "acct123", fetch });

describe("WorkersAIClefRater (fake fetch)", () => {
  test("calls the Workers AI REST endpoint with the Clef request shape", async () => {
    const f = fakeFetch(() => answers({ face: 5, body: 4, overall: 5 }));
    const r = new WorkersAIClefRater(opts(f.fetch));
    const s = await r.rate({ age: 29, ageVerified: true }, photos(1));
    expect(f.calls.length).toBe(1);
    const c = f.calls[0]!;
    expect(c.url).toBe(`https://api.cloudflare.com/client/v4/accounts/acct123/ai/run/${CLEF_MODEL_IDS.clef}`);
    expect(c.init.method).toBe("POST");
    expect(c.init.headers.Authorization).toBe("Bearer test-token");
    const body = JSON.parse(c.init.body);
    expect(body.model).toBe("clef");
    expect(Object.keys(body.questions).length).toBeLessThanOrEqual(64);
    expect(body.images).toHaveLength(1);
    expect(body.images[0]).toMatch(/^data:image\/jpeg;base64,/);
    expect(typeof body.state).toBe("string");
    // The question bank never asks about protected attributes.
    expect(JSON.stringify(body.questions)).not.toMatch(/\b(race|ethnic|skin|gender|disab|religio)/i);
    expect(s).not.toBeNull();
    expect(s!.face).toBeCloseTo((5 / 6 - 0.5) / 0.2, 5);
    expect(s!.body).toBeCloseTo((4 / 6 - 0.5) / 0.2, 5);
    expect(s!.bodyType).toBe("average");
    expect(s!.model).toBe("clef-clef-placeholder-0");
    expect(s!.confidence).toBeGreaterThan(0.3);
  });

  test("averages photos (one call each, up to maxPhotos); disagreement lowers confidence", async () => {
    const same = fakeFetch(() => answers({ overall: 4, face: 4, body: 4 }));
    const s1 = await new WorkersAIClefRater(opts(same.fetch)).rate({ age: 30 }, photos(3));
    const diff = fakeFetch(i => answers({ overall: [1, 5, 3][i]!, face: 3, body: 3 }));
    const s2 = await new WorkersAIClefRater(opts(diff.fetch)).rate({ age: 30 }, photos(3));
    expect(same.calls.length).toBe(3);
    expect(s2!.confidence).toBeLessThan(s1!.confidence);
    const many = fakeFetch(() => answers());
    await new WorkersAIClefRater({ ...opts(many.fetch), maxPhotos: 2 }).rate({ age: 30 }, photos(6));
    expect(many.calls.length).toBe(2);
  });

  test("gate: a photo that does not show exactly one adult is dropped; none left = null", async () => {
    const f = fakeFetch(i => answers({ adult: i === 0 ? 0.1 : 0.95, overall: i === 0 ? 6 : 2 }));
    const s = await new WorkersAIClefRater(opts(f.fetch)).rate({ age: 30 }, photos(2));
    expect(s!.overall).toBeLessThan(0.5); // the high score came from the gated-out photo
    const g = fakeFetch(() => answers({ adult: 0.2 }));
    expect(await new WorkersAIClefRater(opts(g.fetch)).rate({ age: 30 }, photos(2))).toBeNull();
  });

  test("body type: only when the body is visible and the choice is confident", async () => {
    const hidden = fakeFetch(() => answers({ bodyVisible: 0.1, bodyType: "athletic" }));
    expect((await new WorkersAIClefRater(opts(hidden.fetch)).rate({ age: 30 }, photos(1)))!.bodyType).toBeUndefined();
    const vis = fakeFetch(() => answers({ bodyVisible: 0.9, bodyType: "athletic" }));
    const s = await new WorkersAIClefRater(opts(vis.fetch)).rate({ age: 30 }, photos(1));
    expect(s!.bodyType).toBe("athletic");
    expect(s!.bodyTypeConfidence).toBeGreaterThan(0.5);
    const unclear = fakeFetch(() => answers({ bodyVisible: 0.9, bodyType: "unclear" }));
    expect((await new WorkersAIClefRater(opts(unclear.fetch)).rate({ age: 30 }, photos(1)))!.bodyType).toBeUndefined();
  });

  test("adults only: no call, no photo read for a minor, unknown or unverified age (rater and wrapper)", async () => {
    const f = fakeFetch(() => answers());
    let loads = 0;
    const r = new WorkersAIClefRater({ ...opts(f.fetch), loadPhoto: async () => { loads++; return { bytes: JPEG }; } });
    const wrapped = makeClefRater({ ...opts(f.fetch), loadPhoto: async () => { loads++; return { bytes: JPEG }; } });
    for (const subj of [{ age: 13 }, { age: 17 }, { age: NaN }, { age: undefined as unknown as number }, { age: 30, ageVerified: false }]) {
      expect(await r.rate(subj, [{ id: "u", url: "r2://x" }])).toBeNull();
      expect(await wrapped.rate(subj, photos(1))).toBeNull();
      expect(await r.features(subj, photos(1))).toEqual([]);
    }
    expect(f.calls.length).toBe(0);
    expect(loads).toBe(0);
    expect(await r.rate({ age: 30 }, [{ id: "u", url: "r2://x" }])).not.toBeNull(); // loadPhoto for stored photos
    expect(loads).toBe(1);
  });

  test("API errors throw a ClefError (the platform retries); oversized photos are refused before sending", async () => {
    const f = fakeFetch(() => ({ status: 429, body: { success: false, errors: [{ message: "rate limited" }] } }));
    await expect(new WorkersAIClefRater(opts(f.fetch)).rate({ age: 30 }, photos(1))).rejects.toBeInstanceOf(ClefError);
    const big = fakeFetch(() => answers());
    await expect(new WorkersAIClefRater(opts(big.fetch)).rate({ age: 30 }, [{ id: "big", bytes: new Uint8Array(5 * 1024 * 1024) }])).rejects.toThrow(/4 MiB/);
    expect(big.calls.length).toBe(0);
  });

  test("env: CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID are required; CLEF_MODEL picks clef-flash", async () => {
    expect(() => WorkersAIClefRater.fromEnv({})).toThrow(/CLOUDFLARE_AI_TOKEN/);
    const f = fakeFetch(() => answers());
    const r = makeClefRaterFromEnv({ CLOUDFLARE_AI_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a", CLEF_MODEL: "clef-flash" }, { fetch: f.fetch });
    await r.rate({ age: 30 }, photos(1));
    expect(f.calls[0]!.url.endsWith(CLEF_MODEL_IDS["clef-flash"])).toBe(true);
    expect(JSON.parse(f.calls[0]!.init.body).model).toBe("clef-flash");
  });

  test("the stored facet carries the body type and parses back; iteration-3 facets still parse", () => {
    const f = appearanceFacet("m1", { age: 30 }, { face: 1, body: 0.5, overall: 0.75, confidence: 0.6, bodyType: "curvy", bodyTypeConfidence: 0.7, model: "x" }, 0);
    expect(f.scope).toBe("agent_private");
    expect(parseAppearance(f.tags)).toEqual({ face: 1, body: 0.5, overall: 0.75, confidence: 0.6, bodyType: "curvy", bodyTypeConfidence: 0.7 });
    expect(parseAppearance(["appearance:face=1.00", "appearance:body=1.00", "appearance:overall=1.00", "appearance:conf=0.90"])!.bodyType).toBeUndefined();
    expect(parseAppearance([...f.tags.filter(t => !t.includes("bodyType=")), "appearance:bodyType=not_a_type"])!.bodyType).toBeUndefined();
  });
});

describe("Clef decision model: weights, fitting, calibration", () => {
  test("the default weights are a documented placeholder and validate", () => {
    expect(DEFAULT_CLEF_WEIGHTS.placeholder).toBe(true);
    expect(DEFAULT_CLEF_WEIGHTS.notes).toMatch(/placeholder/i);
    expect(validateClefWeights(DEFAULT_CLEF_WEIGHTS)).toBe(DEFAULT_CLEF_WEIGHTS);
    expect(() => validateClefWeights({ ...DEFAULT_CLEF_WEIGHTS, calibration: { ...DEFAULT_CLEF_WEIGHTS.calibration, face: { mean: 0, sd: 0 } } })).toThrow();
    for (const h of Object.values(DEFAULT_CLEF_WEIGHTS.heads)) for (const f of Object.keys(h.w)) expect(CLEF_FEATURES).toContain(f);
  });

  test("Bradley-Terry fit on labelled pairs recovers the ranking; calibration gives a z-scale", () => {
    // Synthetic members: a hidden "true" score drives rate.face (noisy) and aux.grooming; pairs labelled by the truth.
    const rows = new Map<string, Record<string, number>>();
    const truth = new Map<string, number>();
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 60; i++) {
      const t = rnd();
      truth.set(`m${i}`, t);
      const x = clefFeatures(answers({ face: 6 * t, body: 3, overall: 6 * t })).x;
      x["aux.grooming"] = 0.5 * t + 0.25 * rnd();
      x["rate.face"] = Math.min(1, Math.max(0, t + 0.15 * (rnd() - 0.5)));
      rows.set(`m${i}`, x);
    }
    const ids = [...rows.keys()], pairs: LabelledPair[] = [];
    for (let k = 0; k < 600; k++) {
      const a = ids[Math.floor(rnd() * ids.length)]!, b = ids[Math.floor(rnd() * ids.length)]!;
      if (a === b) continue;
      for (const dim of ["face", "body", "overall"] as const) pairs.push({ a, b, dim, winner: truth.get(a)! > truth.get(b)! ? "a" : "b" });
    }
    const { weights, report } = fitClefWeights(rows, pairs, { version: "test-fit", notes: "synthetic" });
    expect(weights.placeholder).toBe(false);
    expect(report.face.accuracy).toBeGreaterThan(0.85);
    const z = ids.map(id => applyHead(weights, rows.get(id)!).face);
    const mean = z.reduce((s, x) => s + x, 0) / z.length;
    expect(Math.abs(mean)).toBeLessThan(1e-6);
    // Rank correlation with the truth.
    const order = (xs: number[]) => xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0]).map(p => p[1]);
    const rz = order(z), rt = order(ids.map(id => truth.get(id)!));
    const rank = (o: number[]) => { const r: number[] = []; o.forEach((i, k) => { r[i] = k; }); return r; };
    const a = rank(rz), b = rank(rt), n = ids.length;
    const rho = 1 - (6 * a.reduce((s, x, i) => s + (x - b[i]!) ** 2, 0)) / (n * (n * n - 1));
    expect(rho).toBeGreaterThan(0.85);
    // Recalibrating on a shifted population moves the mean to 0 there.
    const shifted = [...rows.values()].map(x => ({ ...x, "rate.face": Math.min(1, x["rate.face"]! + 0.2) }));
    const re = calibrateClefWeights(weights, shifted);
    expect(re.calibration.face.mean).not.toBeCloseTo(weights.calibration.face.mean, 3);
  });
});

describe("slopPack appearance terms (iteration 4)", () => {
  const prof = (id: string, ap?: SlopProfile["appearance"], wantsBody: string[] = [], ratedBody: { type: string; v: number }[] = []) =>
    ({ id, appearance: ap, wantsBody, history: { ratedBody } } as unknown as SlopProfile);
  const o = slopOptions();
  const ap = (overall: number, bodyType?: string, face = overall, body = overall) => ({ face, body, overall, confidence: 0.8, ...(bodyType ? { bodyType, bodyTypeConfidence: 0.8 } : {}) });

  test("the gap is a weighted RMS over face / body / overall; overall-only dims reduce to |d overall|", () => {
    expect(appearanceGap(prof("a", ap(1, undefined, 1, 0)), prof("b", ap(0, undefined, 0, 0)), o)).toBeCloseTo(Math.sqrt((0.25 * 1 + 0.5 * 1) / 1), 6);
    expect(appearanceGap(prof("a", ap(1)), prof("b", ap(0.25)), slopOptions({ appearance: { dims: { face: 0, body: 0, overall: 1 } } }))).toBeCloseTo(0.75, 6);
    expect(appearanceGap(prof("a", { ...ap(1), confidence: 0.1 }), prof("b", ap(0)), o)).toBeUndefined();
  });

  test("body type: stated preference first, then revealed, else nothing", () => {
    const b = prof("b", ap(0, "athletic"));
    expect(bodyTypeFactor(prof("a", ap(0), ["athletic", "slim"]), b, o)).toBeCloseTo(Math.exp(0.3), 6);
    expect(bodyTypeFactor(prof("a", ap(0), ["curvy"]), b, o)).toBeCloseTo(Math.exp(-0.3), 6);
    // Revealed: a rated athletic partners above their own mean.
    const rev = prof("a", ap(0), [], [{ type: "athletic", v: 1 }, { type: "athletic", v: 1 }, { type: "average", v: 0 }]);
    expect(bodyTypeFactor(rev, b, o)).toBeGreaterThan(1);
    expect(bodyTypeFactor(prof("a", ap(0)), b, o)).toBe(1); // no preference known: similarity only
    expect(bodyTypeFactor(prof("a", ap(0), ["curvy"]), prof("b", ap(0)), o)).toBe(1); // no body type on b
    expect(bodyTypeFactor(prof("a", ap(0), ["curvy"]), b, slopOptions({ appearance: { mode: "off" } }))).toBe(1);
    for (const t of BODY_TYPES) expect(typeof t).toBe("string");
  });
});

describe("admin bias monitor", () => {
  test("outcome ratios by group; alerts under the four-fifths threshold for groups with n >= minN", () => {
    const rows = [
      ...Array.from({ length: 20 }, () => ({ group: "A", memberMonths: 1, proposals: 2, dates: 1, secondDates: 0.5 })),
      ...Array.from({ length: 20 }, () => ({ group: "B", memberMonths: 1, proposals: 2, dates: 1, secondDates: 0.2 })),
      ...Array.from({ length: 3 }, () => ({ group: "tiny", memberMonths: 1, proposals: 0, dates: 0, secondDates: 0 })),
    ];
    const r = biasMonitor(rows);
    expect(r.groups.A!.ratio.dates).toBeGreaterThan(1);
    expect(r.min.secondDates.group).toBe("B");
    expect(r.alerts.some(a => a.group === "B" && a.metric === "secondDates")).toBe(true);
    expect(r.alerts.some(a => a.group === "tiny")).toBe(false);
    const q = ratingQuintiles(new Map(Array.from({ length: 10 }, (_, i) => [`m${i}`, i] as const)));
    expect(q.get("m0")).toBe("q1");
    expect(q.get("m9")).toBe("q5");
  });
});

// Optional live smoke test (never in CI): LIVE_TESTS=1 CLOUDFLARE_AI_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... bun test slop-rater
const live = process.env.LIVE_TESTS === "1" && !!process.env.CLOUDFLARE_AI_TOKEN && !!process.env.CLOUDFLARE_ACCOUNT_ID;
test.skipIf(!live)("LIVE: one Clef call on a blank image returns answers for every question", async () => {
  // A 1x1 PNG: no person, so the gate should say no; this checks only the API contract.
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="), c => c.charCodeAt(0));
  const r = WorkersAIClefRater.fromEnv(process.env, { model: "clef-flash" });
  const res = await r.ask({ bytes: png, contentType: "image/png" });
  for (const id of Object.keys(CLEF_QUESTIONS)) expect(res.answers[id]).toBeDefined();
  expect(clefFeatures(res.answers).x["gate.one_adult"]).toBeLessThan(0.5);
}, 30_000);

describe("iteration 5: rating-quintile fairness options", () => {
  const prof = (id: string, overall: number, dates = 0) =>
    ({ id, appearance: { face: overall, body: overall, overall, confidence: 0.8 }, wantsBody: [], history: { ratedBody: [], dates } } as unknown as SlopProfile);
  test("gapFree: no penalty up to the threshold, the soft penalty on the excess above it", async () => {
    const { appearanceFactor } = await import("../src/packs/slop/score.ts");
    const o = slopOptions({ appearance: { gapFree: 1, softWeight: 0.2 } });
    expect(appearanceFactor(prof("a", 0), prof("b", 0.9), o)).toBe(1);
    expect(appearanceFactor(prof("a", 0), prof("b", 2), o)).toBeCloseTo(Math.exp(-0.2), 6);
    expect(appearanceFactor(prof("a", 0), prof("b", 2), slopOptions({ appearance: { mode: "tiebreak" } }))).toBe(1); // tiebreak never lowers a value
  });
});

describe("iteration 5: bottom-rated protection (the default)", () => {
  const prof = (id: string, overall: number, quantile: number) =>
    ({ id, appearance: { face: overall, body: overall, overall, confidence: 0.8, quantile }, wantsBody: [], history: { ratedBody: [], dates: 0 } } as unknown as SlopProfile);
  test("no similarity term for a pair with a member in the bottom 40%; unchanged above it", async () => {
    const { appearanceFactor } = await import("../src/packs/slop/score.ts");
    const o = slopOptions();
    expect(o.appearance.protectBelow).toBe(0.4);
    expect(appearanceGap(prof("a", -2, 0.1), prof("b", 2, 0.9), o)).toBeUndefined();
    expect(appearanceFactor(prof("a", -2, 0.39), prof("b", 2, 0.9), o)).toBe(1);
    expect(appearanceFactor(prof("a", 0, 0.5), prof("b", 2, 0.9), o)).toBeLessThan(1);
    expect(appearanceGap(prof("a", -2, 0.1), prof("b", 2, 0.9), slopOptions({ appearance: { protectBelow: 0 } }))).toBeCloseTo(4, 6);
  });
});
