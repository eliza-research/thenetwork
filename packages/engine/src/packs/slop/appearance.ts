// Iteration 3 (founder decision 2026-10-08): appearance ratings from photos, used ONLY for an
// assortative-similarity term ("match people whose ratings are close"). A pluggable
// `AppearanceRater` returns { face, body, overall } on a z-like scale (0 = typical, about 1 = one SD)
// with a confidence. Ratings are computed when photos are uploaded (outside the engine run) and
// stored as agent_private facets (`appearanceFacets`); the pack reads them from the snapshot.
//
// Rules (enforced here and tested):
//  - ADULTS ONLY (hard rule): photo processing, photo-in-probe and appearance ratings are for verified
//    18+ members. Every rater refuses a subject who is not `canBeMatched` (13-17, or age unknown or
//    invalid) or whose age is not verified, BEFORE touching a photo (no embedding, no model call);
//    `appearanceFacet` throws for such a subject and the pack ignores any rating on one;
//  - agent_private only: never shown, never in member-facing text (the leak gate treats the facet as
//    private vocabulary), never written in plain text to run logs (the run log carries no facets;
//    a test greps the whole result for the score strings);
//  - KNOWN RISK: published attractiveness models carry racial, age, body-size and disability bias.
//    The slop world measures the outcome gap with a configurable rater bias (docs, iteration 3).
//    PRD 40.5 currently says "never used: photo attractiveness scores"; this needs a PRD change.
import type { Facet, MemberId } from "@thenetwork/core";
import { canBeMatched } from "@thenetwork/core";

export interface AppearanceScore {
  /** z-like scores: 0 = typical, positive = rated more attractive. */
  face: number; body: number; overall: number;
  /** 0..1: how much to trust the rating (photo quality, agreement, number of photos). */
  confidence: number;
  /** Rater id and version (provenance; never shown). */
  model: string;
}
export interface PhotoRef { id: string; url?: string; bytes?: Uint8Array }
/** Who the photos belong to: the rater checks this before processing anything. */
export interface RatingSubject { age: number; /** false = age not verified yet (selfie / ID check pending). */ ageVerified?: boolean }
/** Adults only: verified 18+ (canBeMatched), never 13-17, never an unknown or unverified age. */
export const canRatePhotos = (s: RatingSubject | undefined): boolean => !!s && canBeMatched(s.age) && s.ageVerified !== false;

export interface AppearanceRater {
  id: string;
  /**
   * Rate one member from their photos. Null = refused (not a verified adult) or cannot rate. A
   * conforming rater checks `canRatePhotos(subject)` before processing any photo; use
   * `adultsOnly(rater)` to wrap one that does not.
   */
  rate(subject: RatingSubject, photos: readonly PhotoRef[]): Promise<AppearanceScore | null>;
}

/** Wrap any rater so it can never process a photo of someone who is not a verified adult. */
export function adultsOnly(r: AppearanceRater): AppearanceRater {
  return { id: r.id, rate: (s, photos) => (canRatePhotos(s) ? r.rate(s, photos) : Promise.resolve(null)) };
}

const clampZ = (x: number) => Math.max(-3, Math.min(3, Number.isFinite(x) ? x : 0));
const clamp01 = (x: number) => Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
const cos = (a: readonly number[], b: readonly number[]) => {
  let s = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) { s += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return na && nb ? s / Math.sqrt(na * nb) : 0;
};

/**
 * CLIP-style adapter: image and text embeddings are INJECTED (a local CLIP model, or a hosted one);
 * this module makes no network call. Two modes:
 *   prompts  zero-shot: per dimension, scale x (cos(img, positive prompt) - cos(img, negative prompt));
 *   head     an aesthetic-head style linear probe per dimension over the image embedding.
 * Several photos are averaged; confidence grows with the number of photos and their agreement.
 */
export class ClipAppearanceRater implements AppearanceRater {
  readonly id: string;
  constructor(private o: {
    embedImage(p: PhotoRef): Promise<number[]>;
    embedText?(text: string): Promise<number[]>;
    head?: { face: number[]; body: number[]; overall: number[]; bias?: [number, number, number] };
    scale?: number; version?: string;
  }) { this.id = `clip-${o.head ? "head" : "prompts"}-${o.version ?? "v0"}`; }

  static PROMPTS = {
    face: ["a photo of a person with an attractive face", "a photo of a person with an unattractive face"],
    body: ["a full-body photo of a person with an attractive body", "a full-body photo of a person with an unattractive body"],
    overall: ["a photo of an attractive person", "a photo of an unattractive person"],
  } as const;

  async rate(subject: RatingSubject, photos: readonly PhotoRef[]): Promise<AppearanceScore | null> {
    if (!canRatePhotos(subject) || !photos.length) return null; // adults only, before any photo is touched
    const embs = await Promise.all(photos.map(p => this.o.embedImage(p)));
    const scale = this.o.scale ?? 25;
    const per: [number, number, number][] = [];
    if (this.o.head) {
      const h = this.o.head, b = h.bias ?? [0, 0, 0];
      for (const e of embs) per.push([dot(h.face, e) + b[0], dot(h.body, e) + b[1], dot(h.overall, e) + b[2]]);
    } else {
      if (!this.o.embedText) throw new Error("ClipAppearanceRater: prompts mode needs embedText");
      const t = await Promise.all(Object.values(ClipAppearanceRater.PROMPTS).flat().map(s => this.o.embedText!(s)));
      for (const e of embs) per.push([0, 1, 2].map(d => scale * (cos(e, t[2 * d]!) - cos(e, t[2 * d + 1]!))) as [number, number, number]);
    }
    const mean = [0, 1, 2].map(d => per.reduce((s, x) => s + x[d]!, 0) / per.length);
    const spread = per.length > 1 ? Math.sqrt(per.reduce((s, x) => s + (x[2]! - mean[2]!) ** 2, 0) / (per.length - 1)) : 1;
    return { face: clampZ(mean[0]!), body: clampZ(mean[1]!), overall: clampZ(mean[2]!), confidence: clamp01((1 - 1 / (1 + per.length)) * (1 / (1 + spread))), model: this.id };
  }
}
const dot = (w: readonly number[], e: readonly number[]) => w.reduce((s, x, i) => s + x * (e[i] ?? 0), 0);

/** A vision-capable chat model (image parts). Kept separate from the text-only core LLM interface. */
export interface VisionChat {
  chat(messages: { role: "system" | "user"; content: string | ({ type: "text"; text: string } | { type: "image_url"; url: string })[] }[], opts?: { json?: boolean; maxTokens?: number }): Promise<string>;
}
export const VISION_RATER_SYSTEM = "You rate dating-profile photos for an internal matching signal that is never shown to anyone. Return JSON only: {\"face\": z, \"body\": z, \"overall\": z, \"confidence\": c} where z is a number from -3 to 3 (0 = typical) and c is 0-1. If the photos do not show one adult clearly, return {\"confidence\": 0}. Do not describe the person.";

/** Vision-LLM adapter stub: one call per member with their photos; tolerant JSON parsing, clamped. */
export class VisionLlmAppearanceRater implements AppearanceRater {
  readonly id: string;
  constructor(private llm: VisionChat, model = "vision-llm") { this.id = `vlm-${model}`; }
  async rate(subject: RatingSubject, photos: readonly PhotoRef[]): Promise<AppearanceScore | null> {
    if (!canRatePhotos(subject)) return null; // adults only, before any photo is sent anywhere
    const urls = photos.map(p => p.url).filter((u): u is string => !!u);
    if (!urls.length) return null;
    const raw = await this.llm.chat([
      { role: "system", content: VISION_RATER_SYSTEM },
      { role: "user", content: [{ type: "text", text: "Rate these photos." }, ...urls.map(url => ({ type: "image_url" as const, url }))] },
    ], { json: true, maxTokens: 200 });
    let j: Record<string, unknown>;
    try { j = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1)); } catch { return null; }
    const c = clamp01(Number(j.confidence));
    if (!c) return null;
    return { face: clampZ(Number(j.face)), body: clampZ(Number(j.body)), overall: clampZ(Number(j.overall)), confidence: c, model: this.id };
  }
}

/** Rate a member through the adults-only guard (even if the rater itself forgot the check). */
export async function rateMember(rater: AppearanceRater, member: RatingSubject, photos: readonly PhotoRef[]): Promise<AppearanceScore | null> {
  return adultsOnly(rater).rate(member, photos);
}

export const APPEARANCE_PREFIX = "appearance:";
/** The facet the platform stores (agent_private; the value names no score, the tags carry it). */
export function appearanceFacet(memberId: MemberId, subject: RatingSubject, s: AppearanceScore, at: number): Facet {
  if (!canRatePhotos(subject)) throw new Error("appearance ratings are for verified adults only");
  const f = (x: number) => x.toFixed(2);
  return {
    id: `${memberId}:appearance`, memberId, kind: "fact", value: "photo rating (internal)",
    tags: [`${APPEARANCE_PREFIX}face=${f(s.face)}`, `${APPEARANCE_PREFIX}body=${f(s.body)}`, `${APPEARANCE_PREFIX}overall=${f(s.overall)}`, `${APPEARANCE_PREFIX}conf=${f(s.confidence)}`],
    scope: "agent_private", provenance: "inferred", confidence: s.confidence, validFrom: at, observedAt: at, inferred: true, confirmedByMember: false,
  };
}
/** Read a rating back from tags (undefined when absent or malformed). */
export function parseAppearance(tags: readonly string[]): Omit<AppearanceScore, "model"> | undefined {
  const v: Record<string, number> = {};
  for (const t of tags) if (t.startsWith(APPEARANCE_PREFIX)) { const [k, x] = t.slice(APPEARANCE_PREFIX.length).split("="); v[k!] = Number(x); }
  if (![v.face, v.body, v.overall, v.conf].every(x => Number.isFinite(x))) return undefined;
  return { face: v.face!, body: v.body!, overall: v.overall!, confidence: v.conf! };
}
