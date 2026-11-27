import { fnv1a } from "@thenetwork/core";

export type EmbedFn = (text: string) => number[];
export const EMBED_DIM = 256;

const STOP = new Set(("a an the and or of to in on for with at by from is are was be been i me my we our you your " +
  "it its this that these those who what want wants like likes love loves into about some someone people " +
  "person get got have has do does just more most also very really can could would will need needs").split(" "));

const NEGATION_CUES = new Set([
  "no", "not", "never", "non", "none", "neither", "nor", "without", "against", "anti",
  "hate", "hates", "hated", "hating", "dislike", "dislikes", "disliked",
  "avoid", "avoids", "avoiding", "detest", "detests", "allergic",
  "dont", "doesnt", "didnt", "wont", "wouldnt", "cant", "cannot", "isnt", "arent", "wasnt", "werent",
  "don't", "doesn't", "didn't", "won't", "wouldn't", "can't", "isn't", "aren't", "wasn't", "weren't",
]);

const CLAUSE_BREAKERS = new Set(["but", "however", "though", "although", "yet", "except", "whereas"]);

function foldText(text: string): string {
  return text.normalize("NFKC").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]+/g, "").normalize("NFC");
}

function stemWord(w: string): string {
  return w.length > 4 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w;
}

export function tokenize(text: string): string[] {
  const folded = foldText(text);
  return (folded.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [])
    .filter(w => w.length > 1 && !STOP.has(w))
    .map(stemWord);
}

function add(vec: Float64Array, feature: string, weight: number): void {
  const h = fnv1a(feature);
  const idx = h % vec.length;
  const sign = (h >>> 31) & 1 ? -1 : 1;
  vec[idx]! += sign * weight;
}

interface ParsedToken {
  word: string;
  negCue?: string;
}

function parseNegationAwareTokens(text: string): ParsedToken[] {
  const folded = foldText(text);
  const out: ParsedToken[] = [];
  const raw = folded.match(/[\p{L}\p{M}\p{N}]+(?:'[\p{L}\p{M}\p{N}]+)?|[.,;:!?/\n()|]+|-/gu);
  if (!raw) return out;

  let activeNegCue: string | undefined;
  let negBudget = 0;

  for (let i = 0; i < raw.length; i++) {
    const tok = raw[i]!;
    const c0 = tok.charCodeAt(0);
    if (tok === "-") continue;
    if ((c0 >= 33 && c0 <= 47) || (c0 >= 58 && c0 <= 63) || c0 === 10 || c0 === 124) {
      activeNegCue = undefined;
      negBudget = 0;
      continue;
    }
    if (CLAUSE_BREAKERS.has(tok)) {
      activeNegCue = undefined;
      negBudget = 0;
      continue;
    }
    const stripped = tok.replace(/'/g, "");
    if (NEGATION_CUES.has(tok) || NEGATION_CUES.has(stripped)) {
      activeNegCue = stemWord(stripped);
      negBudget = 2;
      continue;
    }
    const parts = tok.includes("'") ? tok.split("'") : [tok];
    for (let p = 0; p < parts.length; p++) {
      const w0 = parts[p]!;
      if (w0.length <= 1 || STOP.has(w0)) continue;
      const w = stemWord(w0);
      if (negBudget > 0 && activeNegCue !== undefined) {
        out.push({ word: w, negCue: activeNegCue });
        negBudget--;
        if (negBudget === 0) activeNegCue = undefined;
      } else {
        out.push({ word: w });
      }
    }
  }
  return out;
}

export function localEmbed(text: string, dim = EMBED_DIM): number[] {
  const vec = new Float64Array(dim);
  const toks = parseNegationAwareTokens(text);
  for (let i = 0; i < toks.length; i++) {
    const cur = toks[i]!;
    const w = cur.word;
    if (cur.negCue !== undefined) {
      add(vec, `neg_w:${w}`, 1.0);
      add(vec, `neg_b:${cur.negCue}_${w}`, 0.6);
      add(vec, `w:${w}`, -0.35);
      const padded = `^${w}$`;
      for (let j = 0; j + 3 <= padded.length; j++) {
        const tri = padded.slice(j, j + 3);
        add(vec, `neg_c:${tri}`, 0.25);
        add(vec, `c:${tri}`, -0.1);
      }
      if (i + 1 < toks.length) {
        add(vec, `neg_b2:${w}_${toks[i + 1]!.word}`, 0.4);
      }
    } else {
      add(vec, `w:${w}`, 1);
      if (i + 1 < toks.length && toks[i + 1]!.negCue === undefined) {
        add(vec, `b:${w}_${toks[i + 1]!.word}`, 0.5);
      }
      const padded = `^${w}$`;
      for (let j = 0; j + 3 <= padded.length; j++) add(vec, `c:${padded.slice(j, j + 3)}`, 0.25);
    }
  }
  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    const v = vec[i]!;
    normSq += v * v;
  }
  const invNorm = normSq > 0 ? 1 / Math.sqrt(normSq) : 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = vec[i]! * invNorm;
  return out;
}

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = a.length < b.length ? a.length : b.length;
  let dot = 0;
  let na = 0;
  let nb = 0;
  let i = 0;
  const n4 = n - (n & 3);
  for (; i < n4; i += 4) {
    const a0 = a[i]!, b0 = b[i]!;
    const a1 = a[i + 1]!, b1 = b[i + 1]!;
    const a2 = a[i + 2]!, b2 = b[i + 2]!;
    const a3 = a[i + 3]!, b3 = b[i + 3]!;
    dot += a0 * b0 + a1 * b1 + a2 * b2 + a3 * b3;
    na += a0 * a0 + a1 * a1 + a2 * a2 + a3 * a3;
    nb += b0 * b0 + b1 * b1 + b2 * b2 + b3 * b3;
  }
  for (; i < n; i++) {
    const ai = a[i]!, bi = b[i]!;
    dot += ai * bi;
    na += ai * ai;
    nb += bi * bi;
  }
  if (na === 0 || nb === 0 || dot === 0) return 0;
  const prod = na * nb;
  if (prod > 0.999998 && prod < 1.000002) return dot;
  return dot / Math.sqrt(prod);
}

export function centroid(vs: readonly (readonly number[])[], dim: number): number[] {
  const acc = new Float64Array(dim);
  for (let k = 0; k < vs.length; k++) {
    const v = vs[k]!;
    const len = v.length < dim ? v.length : dim;
    for (let i = 0; i < len; i++) acc[i]! += v[i]!;
  }
  let normSq = 0;
  for (let i = 0; i < dim; i++) {
    const x = acc[i]!;
    normSq += x * x;
  }
  const invNorm = normSq > 0 ? 1 / Math.sqrt(normSq) : 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = acc[i]! * invNorm;
  return out;
}
