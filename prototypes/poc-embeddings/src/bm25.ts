import { tokenize } from "../../../packages/engine/src/embed.ts";

/** Okapi BM25 over a fixed corpus (k1 = 1.2, b = 0.75), engine tokenizer. */
export class BM25 {
  private tf = new Map<string, Map<string, number>>();
  private len = new Map<string, number>();
  private df = new Map<string, number>();
  private avg = 0;
  constructor(docs: Map<string, string>, private k1 = 1.2, private b = 0.75) {
    let total = 0;
    for (const [id, text] of docs) {
      const toks = tokenize(text);
      const m = new Map<string, number>();
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
      this.tf.set(id, m); this.len.set(id, toks.length); total += toks.length;
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = total / Math.max(1, docs.size);
  }
  score(query: string, id: string): number {
    const n = this.tf.size, m = this.tf.get(id)!, L = this.len.get(id)!;
    let s = 0;
    for (const q of new Set(tokenize(query))) {
      const f = m.get(q); if (!f) continue;
      const df = this.df.get(q) ?? 0;
      const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
      s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * L / this.avg));
    }
    return s;
  }
}
