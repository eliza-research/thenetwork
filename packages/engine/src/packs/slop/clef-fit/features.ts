// Feature extraction for fitting: run Clef over a folder of CONSENTED photos of VERIFIED ADULTS and
// cache the answers as feature rows (one JSONL row per photo). File access and the rater are injected
// (scripts/clef-fit.ts wires the file system and WorkersAIClefRater); this module never touches the
// network itself, and nothing here runs in `bun run sim` except against a fake fetch.
//
// Eligibility (checked BEFORE a photo is read): a consent-manifest row for the photo with a consent
// reference, an age, and ageVerified === true, passing `canRatePhotos`. Photos a rater flagged in the
// labelling tool are skipped too. The rater's own `features()` repeats the adults-only check.
import { canRatePhotos, type RatingSubject } from "../appearance.ts";
import { CLEF_MODEL_IDS, type ClefModel } from "../clef.ts";

/** One consent-manifest row (JSONL), kept by the operator next to the signed releases. */
export interface ManifestRow { photo: string; subject: string; age: number; ageVerified: boolean; consent: string }
export interface FeatureCacheRow { id: string; sha256: string; model: string; x: Record<string, number>; confidence: number; extractedAt: string }

/** Clef pricing and token sizes (Cloudflare's published figures, docs/results/2026-10-08-slop-pack.md I4.1). */
export const CLEF_PRICE_PER_M_INPUT: Record<ClefModel, number> = { clef: 0.24, "clef-flash": 0.09 };
export const CLEF_TOKENS_PER_PHOTO = { image: [1000, 1300] as const, questions: 500 };

export function estimateCost(photos: number, model: ClefModel): { photos: number; tokens: [number, number]; usd: [number, number]; model: string } {
  const lo = photos * (CLEF_TOKENS_PER_PHOTO.image[0] + CLEF_TOKENS_PER_PHOTO.questions), hi = photos * (CLEF_TOKENS_PER_PHOTO.image[1] + CLEF_TOKENS_PER_PHOTO.questions);
  const p = CLEF_PRICE_PER_M_INPUT[model] / 1e6;
  return { photos, tokens: [lo, hi], usd: [lo * p, hi * p], model: CLEF_MODEL_IDS[model] };
}

export type SkipReason = "no manifest row" | "no consent reference" | "not a verified adult" | "flagged by a rater" | "cached" | "over 4 MiB";
export interface ExtractionPlan {
  todo: { id: string; subject: RatingSubject; bytes: number }[];
  skipped: Record<SkipReason, string[]>;
}

/** Decide which photos to send, without reading any photo's bytes. */
export function planExtraction(photos: readonly { id: string; bytes: number; sha256?: string }[], manifest: ReadonlyMap<string, ManifestRow>, o: { cache?: ReadonlyMap<string, FeatureCacheRow>; flagged?: ReadonlySet<string>; model: ClefModel }): ExtractionPlan {
  const skipped: ExtractionPlan["skipped"] = { "no manifest row": [], "no consent reference": [], "not a verified adult": [], "flagged by a rater": [], cached: [], "over 4 MiB": [] };
  const todo: ExtractionPlan["todo"] = [];
  for (const p of [...photos].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const m = manifest.get(p.id);
    if (!m) { skipped["no manifest row"].push(p.id); continue; }
    if (!m.consent || typeof m.consent !== "string") { skipped["no consent reference"].push(p.id); continue; }
    const subject: RatingSubject = { age: Number(m.age), ageVerified: m.ageVerified === true };
    if (m.ageVerified !== true || !canRatePhotos(subject)) { skipped["not a verified adult"].push(p.id); continue; }
    if (o.flagged?.has(p.id)) { skipped["flagged by a rater"].push(p.id); continue; }
    if (p.bytes > 4 * 1024 * 1024) { skipped["over 4 MiB"].push(p.id); continue; }
    const c = o.cache?.get(p.id);
    if (c && c.model === o.model && (!p.sha256 || c.sha256 === p.sha256)) { skipped.cached.push(p.id); continue; }
    todo.push({ id: p.id, subject, bytes: p.bytes });
  }
  return { todo, skipped };
}

/** The part of WorkersAIClefRater extraction needs (so a fake can stand in). */
export interface FeatureSource {
  features(subject: RatingSubject, photos: readonly { id: string; bytes?: Uint8Array }[]): Promise<{ photoId: string; x: Record<string, number>; confidence: number }[]>;
}

/** Run the plan: read each photo, ask Clef, hand each row to `write` as soon as it arrives (resumable). */
export async function runExtraction(plan: ExtractionPlan, o: {
  source: FeatureSource; model: ClefModel; now: () => string;
  read(id: string): Promise<{ bytes: Uint8Array; sha256: string }>;
  write(row: FeatureCacheRow): Promise<void>;
  concurrency?: number; onError?: (id: string, e: unknown) => void;
}): Promise<{ done: number; failed: number }> {
  let next = 0, done = 0, failed = 0;
  const worker = async () => {
    while (next < plan.todo.length) {
      const t = plan.todo[next++]!;
      try {
        const img = await o.read(t.id);
        const [r] = await o.source.features(t.subject, [{ id: t.id, bytes: img.bytes }]);
        if (!r) { failed++; continue; }
        await o.write({ id: t.id, sha256: img.sha256, model: o.model, x: r.x, confidence: r.confidence, extractedAt: o.now() });
        done++;
      } catch (e) { failed++; o.onError?.(t.id, e); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, o.concurrency ?? 4) }, worker));
  return { done, failed };
}
