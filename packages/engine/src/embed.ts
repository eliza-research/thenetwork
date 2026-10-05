// Deterministic local embedding (Section 33.5): signed feature hashing of word unigrams,
// bigrams and character trigrams, L2-normalised. Works offline so tests are hermetic; a real
// embedding model can be plugged in through `deps.embed`.
import { fnv1a } from "./rng.ts";

export type EmbedFn = (text: string) => number[];
export const EMBED_DIM = 256;

const STOP = new Set(("a an the and or of to in on for with at by from is are was be been i me my we our you your " +
  "it its this that these those who what want wants like likes love loves into about some someone people " +
  "person get got have has do does just more most also very really can could would will need needs").split(" "));

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(w => (w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w));
}

function add(vec: Float64Array, feature: string, weight: number) {
  const h = fnv1a(feature);
  const idx = h % vec.length;
  const sign = (h >>> 31) & 1 ? -1 : 1;
  vec[idx]! += sign * weight;
}

export function localEmbed(text: string, dim = EMBED_DIM): number[] {
  const vec = new Float64Array(dim);
  const toks = tokenize(text);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i]!;
    add(vec, `w:${w}`, 1);
    if (i + 1 < toks.length) add(vec, `b:${w}_${toks[i + 1]}`, 0.5);
    const padded = `^${w}$`;
    for (let j = 0; j + 3 <= padded.length; j++) add(vec, `c:${padded.slice(j, j + 3)}`, 0.25);
  }
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i]! * vec[i]!;
  norm = Math.sqrt(norm) || 1;
  return Array.from(vec, v => v / norm);
}

export function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

/** Mean of vectors, re-normalised (used for profile / capability centroids). */
export function centroid(vs: number[][], dim: number): number[] {
  const out = new Array<number>(dim).fill(0);
  for (const v of vs) for (let i = 0; i < dim; i++) out[i]! += v[i] ?? 0;
  const norm = Math.sqrt(out.reduce((s, x) => s + x * x, 0)) || 1;
  return out.map(x => x / norm);
}
