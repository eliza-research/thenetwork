// WorkersAIClefRater: the production appearance rater (iteration 4, founder decision 2026-10-08:
// "turn the attractiveness rater on ... using Cloudflare's clef model ... we do not share the
// attractiveness scores; it goes into our matching").
//
// Approach (after lalalune/jevector): Cloudflare's Clef (`@cf/cloudflare/clef`, `clef-flash`) is a
// multimodal DECISION model. It takes a state, up to 4 images and up to 64 typed questions (noul =
// yes/no, choice, score = ordered levels) and returns answer PROBABILITIES; it returns no embedding.
// As in jevector, the "vector" is the answers to a fixed question bank (CLEF_QUESTIONS). On top of it
// sits a small learned decision model (clefWeights.ts): a linear head per dimension (face, body,
// overall) fitted from labelled pairs (Bradley-Terry, clef-fit/fit.ts), a calibration to a z-like scale
// on the member population, and a categorical body type from Clef's choice probabilities.
//
// Flow, per member, when photos are uploaded (OUTSIDE the engine run; the engine stays pure):
//   1. adults only: `canRatePhotos(subject)` BEFORE any photo is read or sent (and `makeClefRater`
//      wraps the rater in `adultsOnly` as well);
//   2. one Clef call per photo (up to `maxPhotos`), photo as a base64 data URL (Clef accepts no remote
//      URLs); photos the gate says do not show exactly one adult are dropped;
//   3. features -> head -> calibrated z per photo; mean over photos; confidence from the number of
//      photos, their agreement, the gate and Clef's own answer confidence;
//   4. the platform stores the result with `appearanceFacet` (agent_private) and never shows it.
//
// The question bank asks nothing about race, ethnicity, age, gender or disability.
import { canRatePhotos, adultsOnly, BODY_TYPES, type AppearanceRater, type AppearanceScore, type BodyType, type PhotoRef, type RatingSubject } from "./appearance.ts";
import { DEFAULT_CLEF_WEIGHTS, validateClefWeights, type ClefWeights } from "./clefWeights.ts";

export const CLEF_MODEL_IDS = { clef: "@cf/cloudflare/clef", "clef-flash": "@cf/cloudflare/clef-flash" } as const;
export type ClefModel = keyof typeof CLEF_MODEL_IDS;
export const WORKERS_AI_BASE = "https://api.cloudflare.com/client/v4";

export type ClefQuestion =
  | { type: "noul"; instructions: string }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

const LEVELS7 = ["far below typical", "well below typical", "somewhat below typical", "typical", "somewhat above typical", "well above typical", "far above typical"];
const LEVELS5 = ["very low", "low", "medium", "high", "very high"];

/**
 * The fixed question bank (the jevector-style feature vector). Gate questions decide whether a photo
 * is usable; the rest are features for the learned head. Ids are stable: weights refer to them.
 */
export const CLEF_QUESTIONS: Record<string, ClefQuestion> = {
  "gate.one_adult": { type: "noul", instructions: "Does this photo clearly show exactly one person, who is an adult?" },
  "gate.face_visible": { type: "noul", instructions: "Is that person's face clearly visible (not hidden by sunglasses, a mask, a filter or distance)?" },
  "gate.body_visible": { type: "noul", instructions: "Is most of that person's body visible (at least from head to hips)?" },
  "rate.face": { type: "score", instructions: "How attractive would most dating-app users find this person's face?", criteria: LEVELS7 },
  "rate.body": { type: "score", instructions: "How attractive would most dating-app users find this person's body and physique?", criteria: LEVELS7 },
  "rate.overall": { type: "score", instructions: "Overall, how attractive would most dating-app users find this person in this photo?", criteria: LEVELS7 },
  "aux.photo_quality": { type: "score", instructions: "Technical photo quality (focus, lighting, framing).", criteria: LEVELS5 },
  "aux.grooming": { type: "score", instructions: "How well groomed and put-together does the person look?", criteria: LEVELS5 },
  "aux.fitness": { type: "score", instructions: "How physically fit does the person look?", criteria: LEVELS5 },
  "aux.style": { type: "score", instructions: "How stylish is the person's clothing and presentation?", criteria: LEVELS5 },
  "aux.expression": { type: "score", instructions: "How warm and approachable is the person's expression and posture?", criteria: LEVELS5 },
  "aux.smile": { type: "noul", instructions: "Is the person smiling?" },
  "body.type": {
    type: "choice", instructions: "Which body type best describes this person? Answer unclear if the body is not visible.",
    criteria: {
      slim: "slim or slender build", athletic: "athletic or muscular build", average: "average build", curvy: "curvy build",
      plus_size: "larger or plus-size build", unclear: "body not visible enough to say",
    },
  },
};
export const CLEF_STATE = "A dating-profile photo, rated for an internal matching signal that is never shown to anyone. Judge only what is visible in the photo.";

/** Feature names in a fixed order: one per noul / score question, one per choice option. */
export const CLEF_FEATURES: readonly string[] = Object.entries(CLEF_QUESTIONS).flatMap(([id, q]) =>
  q.type === "choice" ? Object.keys(q.criteria).map(k => `${id}=${k}`) : [id]);

/** One Clef answer, as returned by the API (fields we read; tolerant of extras). */
export interface ClefAnswer {
  type?: string; noul?: number; choice?: string; score?: number;
  probabilities?: Record<string, number> | number[]; confidence?: number;
}
export interface ClefResult { model?: string; answers: Record<string, ClefAnswer>; usage?: { input_tokens?: number; output_tokens?: number } }

const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const clampZ = (x: number) => Math.max(-3, Math.min(3, Number.isFinite(x) ? x : 0));

/** Answers -> the feature row (0..1 per feature) and the mean Clef confidence of the rating questions. */
export function clefFeatures(answers: Record<string, ClefAnswer>): { x: Record<string, number>; confidence: number } {
  const x: Record<string, number> = {};
  const confs: number[] = [];
  for (const [id, q] of Object.entries(CLEF_QUESTIONS)) {
    const a = answers[id];
    if (q.type === "noul") { x[id] = clamp01(Number(a?.noul ?? 0.5)); continue; }
    if (q.type === "score") {
      // Expected level (0-based) over the ordered levels, scaled to 0..1; 0.5 when missing.
      let s = Number(a?.score);
      if (!Number.isFinite(s) && Array.isArray(a?.probabilities)) s = a!.probabilities.reduce((t, p, i) => t + p * i, 0);
      x[id] = Number.isFinite(s) ? clamp01(s / (q.criteria.length - 1)) : 0.5;
      if (id.startsWith("rate.") && Number.isFinite(Number(a?.confidence))) confs.push(clamp01(Number(a!.confidence)));
      continue;
    }
    const keys = Object.keys(q.criteria);
    const pr = a?.probabilities;
    const probs = keys.map((k, i) => Number(Array.isArray(pr) ? pr[i] : pr?.[k] ?? (a?.choice === k ? 1 : 0)));
    const z = probs.reduce((t, p) => t + (Number.isFinite(p) ? p : 0), 0) || 1;
    keys.forEach((k, i) => { x[`${id}=${k}`] = clamp01(probs[i]! / z); });
  }
  return { x, confidence: confs.length ? confs.reduce((s, c) => s + c, 0) / confs.length : 0.7 };
}

/** Apply the decision model to one feature row: calibrated z per dimension. */
export function applyHead(w: ClefWeights, x: Record<string, number>): { face: number; body: number; overall: number } {
  const dim = (d: "face" | "body" | "overall") => {
    const h = w.heads[d], c = w.calibration[d];
    let s = h.b;
    for (const [f, k] of Object.entries(h.w)) s += k * (x[f] ?? 0);
    return clampZ((s - c.mean) / (c.sd || 1));
  };
  return { face: dim("face"), body: dim("body"), overall: dim("overall") };
}

export interface ClefRaterOptions {
  /** Cloudflare API token with Workers AI permission (env CLOUDFLARE_AI_TOKEN). */
  token: string;
  /** Cloudflare account id (env CLOUDFLARE_ACCOUNT_ID). */
  accountId: string;
  /** "clef" (27B, default) or "clef-flash" (9B, cheaper, faster). */
  model?: ClefModel;
  /** The decision model (default: the documented placeholder, clefWeights.ts). */
  weights?: ClefWeights;
  /** Injected fetch (tests use a fake; nothing in the engine run calls this). */
  fetch?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
  /** Read a photo's bytes when the ref carries only a storage URL (Clef accepts no remote URLs). */
  loadPhoto?: (p: PhotoRef) => Promise<{ bytes: Uint8Array; contentType?: string } | null>;
  /** Photos rated per member (one Clef call each; default 4). */
  maxPhotos?: number;
  baseUrl?: string;
}

export class ClefError extends Error { constructor(msg: string, readonly status?: number) { super(msg); } }

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
function sniffType(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  return "image/jpeg";
}
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export class WorkersAIClefRater implements AppearanceRater {
  readonly id: string;
  private readonly w: ClefWeights;
  constructor(private o: ClefRaterOptions) {
    if (!o.token || !o.accountId) throw new ClefError("WorkersAIClefRater needs CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID");
    this.w = validateClefWeights(o.weights ?? DEFAULT_CLEF_WEIGHTS);
    this.id = `clef-${o.model ?? "clef"}-${this.w.version}`;
  }

  /** From env: CLOUDFLARE_AI_TOKEN, CLOUDFLARE_ACCOUNT_ID, optional CLEF_MODEL (clef | clef-flash). */
  static fromEnv(env: Record<string, string | undefined> = process.env, o: Partial<ClefRaterOptions> = {}): WorkersAIClefRater {
    const model = (env.CLEF_MODEL === "clef-flash" ? "clef-flash" : "clef") as ClefModel;
    return new WorkersAIClefRater({ token: env.CLOUDFLARE_AI_TOKEN ?? "", accountId: env.CLOUDFLARE_ACCOUNT_ID ?? "", model, ...o });
  }

  /** One Clef call on one photo (raw answers). Exposed for feature extraction when fitting weights. */
  async ask(image: { bytes: Uint8Array; contentType?: string }): Promise<ClefResult> {
    if (image.bytes.byteLength > MAX_IMAGE_BYTES) throw new ClefError("photo over Clef's 4 MiB limit: resize before rating");
    const model = this.o.model ?? "clef";
    const url = `${this.o.baseUrl ?? WORKERS_AI_BASE}/accounts/${encodeURIComponent(this.o.accountId)}/ai/run/${CLEF_MODEL_IDS[model]}`;
    const body = { model, state: CLEF_STATE, questions: CLEF_QUESTIONS, images: [`data:${image.contentType ?? sniffType(image.bytes)};base64,${b64(image.bytes)}`] };
    const f = this.o.fetch ?? (globalThis.fetch as unknown as NonNullable<ClefRaterOptions["fetch"]>);
    const res = await f(url, { method: "POST", headers: { Authorization: `Bearer ${this.o.token}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { success?: boolean; result?: ClefResult; errors?: { message?: string }[] };
    if (!res.ok || j.success === false || !j.result?.answers) throw new ClefError(`Workers AI ${res.status}: ${j.errors?.map(e => e.message).join("; ") || "no answers"}`, res.status);
    return j.result;
  }

  /** Feature rows for a member's photos (adults only), for fitting and auditing the head. */
  async features(subject: RatingSubject, photos: readonly PhotoRef[]): Promise<{ photoId: string; x: Record<string, number>; confidence: number }[]> {
    if (!canRatePhotos(subject)) return []; // adults only, before any photo is read
    const out: { photoId: string; x: Record<string, number>; confidence: number }[] = [];
    for (const p of photos.slice(0, this.o.maxPhotos ?? 4)) {
      const img = p.bytes ? { bytes: p.bytes } : (await this.o.loadPhoto?.(p)) ?? null;
      if (!img) continue;
      const r = await this.ask(img);
      out.push({ photoId: p.id, ...clefFeatures(r.answers) });
    }
    return out;
  }

  async rate(subject: RatingSubject, photos: readonly PhotoRef[]): Promise<AppearanceScore | null> {
    if (!canRatePhotos(subject) || !photos.length) return null; // adults only, before any photo is touched
    const rows = (await this.features(subject, photos)).filter(r => (r.x["gate.one_adult"] ?? 0) >= this.w.gate.oneAdult);
    if (!rows.length) return null;
    const per = rows.map(r => ({ z: applyHead(this.w, r.x), g: r.x["gate.one_adult"]!, faceVis: r.x["gate.face_visible"] ?? 0.5, c: r.confidence }));
    const wsum = per.reduce((s, p) => s + p.g, 0);
    const mean = (k: "face" | "body" | "overall") => per.reduce((s, p) => s + p.g * p.z[k], 0) / wsum;
    const m = { face: mean("face"), body: mean("body"), overall: mean("overall") };
    const spread = per.length > 1 ? Math.sqrt(per.reduce((s, p) => s + (p.z.overall - m.overall) ** 2, 0) / (per.length - 1)) : this.w.confidence.singlePhotoSpread;
    const clefConf = per.reduce((s, p) => s + p.c, 0) / per.length, faceVis = per.reduce((s, p) => s + p.faceVis, 0) / per.length;
    const confidence = clamp01(this.w.confidence.scale * (1 - 1 / (1 + per.length)) * (1 / (1 + spread)) * (0.5 + 0.5 * clefConf) * (0.5 + 0.5 * faceVis) * 2);
    // Body type: Clef's choice probabilities averaged over photos where the body is visible.
    let bodyType: BodyType | undefined, bodyTypeConfidence: number | undefined;
    const vis = rows.filter(r => (r.x["gate.body_visible"] ?? 0) >= 0.5);
    if (vis.length) {
      const pr = BODY_TYPES.map(t => vis.reduce((s, r) => s + (r.x[`body.type=${t}`] ?? 0), 0) / vis.length);
      const unclear = vis.reduce((s, r) => s + (r.x["body.type=unclear"] ?? 0), 0) / vis.length;
      const i = pr.reduce((bi, p, k) => (p > pr[bi]! ? k : bi), 0);
      if (pr[i]! >= this.w.bodyType.minProb && unclear < 0.5) { bodyType = BODY_TYPES[i]; bodyTypeConfidence = clamp01(pr[i]! * (1 - unclear)); }
    }
    return { face: m.face, body: m.body, overall: m.overall, confidence, model: this.id, ...(bodyType ? { bodyType, bodyTypeConfidence } : {}) };
  }
}

/** The production rater, always behind the adults-only guard. */
export function makeClefRater(o: ClefRaterOptions): AppearanceRater {
  return adultsOnly(new WorkersAIClefRater(o));
}
/** Same, from env (CLOUDFLARE_AI_TOKEN, CLOUDFLARE_ACCOUNT_ID, CLEF_MODEL). */
export function makeClefRaterFromEnv(env: Record<string, string | undefined> = process.env, o: Partial<ClefRaterOptions> = {}): AppearanceRater {
  return adultsOnly(WorkersAIClefRater.fromEnv(env, o));
}
