// Deterministic member resolution for BLOCK_OR_REPORT ("block Jake", "report sarah k from last week").
// Resolves against the member's FULL contact/opportunity history, not just active items.
import type { HistoryEntry } from "./contexts.ts";

export type Resolution =
  | { kind: "resolved"; entry: HistoryEntry; via: string }
  | { kind: "ambiguous"; candidates: HistoryEntry[] }
  | { kind: "pronoun"; candidates: HistoryEntry[] }   // "he made me feel unsafe": candidates = counterpart(s) of the attributed item
  | { kind: "unknown" };

const PRONOUN = /^(he|him|she|her|they|them|this (person|guy|girl|dude|man|woman)|that (person|guy|girl|dude|man|woman)|the (guy|girl|person|man|woman)|someone|somebody|unknown|unclear)\b/i;
const toks = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[‘’]/g, "'").split(/[^\p{L}\p{N}_]+/u).filter(Boolean);
const first = (e: HistoryEntry) => toks(e.name)[0];
const lastInitial = (e: HistoryEntry) => toks(e.name)[1]?.[0];
const NOISE = new Set(["the", "a", "an", "from", "with", "at", "in", "on", "my", "i", "me", "who", "guy", "girl", "and", "last", "this", "that", "week", "coffee", "intro", "completed", "open"]);

/**
 * @param ref       the model's member_ref (may be a name, "Jake R.", an id, or a pronoun)
 * @param evidence  the member's own words (used for descriptors like "jake from climbing")
 * @param history   full contact/opportunity history
 * @param attributedItems  items the inbound message is attributed to (for pronoun candidates)
 */
export function resolveMember(ref: string, evidence: string, history: HistoryEntry[], attributedItems: string[] = []): Resolution {
  const r = ref.trim();
  const byId = history.find(e => e.member_id === r);
  if (byId) return { kind: "resolved", entry: byId, via: "member_id" };
  const refT = toks(r).filter(t => !NOISE.has(t));
  let cands = history.filter(e => refT.includes(first(e)));
  if (!cands.length) {
    // the ref may be a pronoun or a description; try names in the member's own words
    const evT = toks(evidence);
    cands = history.filter(e => evT.includes(first(e)));
    if (!cands.length) {
      if (PRONOUN.test(r) || !refT.length) {
        const c = history.filter(e => attributedItems.includes(e.item_id));
        return { kind: "pronoun", candidates: dedupe(c) };
      }
      return { kind: "unknown" };
    }
  }
  cands = dedupe(cands);
  if (cands.length === 1) return { kind: "resolved", entry: cands[0], via: "name" };
  // several people share the first name: narrow by last name/initial, then by descriptor words
  const allT = new Set([...refT, ...toks(evidence)]);
  const byInitial = cands.filter(e => { const li = lastInitial(e); return li && [...allT].some(t => t === li || (t.length > 1 && toks(e.name)[1] === t)); });
  if (byInitial.length === 1) return { kind: "resolved", entry: byInitial[0], via: "last name/initial" };
  const pool = byInitial.length ? byInitial : cands;
  const descr = [...allT].filter(t => !NOISE.has(t) && t.length > 2 && !pool.some(e => first(e) === t));
  const scored = pool.map(e => ({ e, s: descr.filter(t => toks(e.summary + " " + e.when).some(w => w.startsWith(t) || t.startsWith(w) && w.length > 3)).length }));
  const best = Math.max(...scored.map(x => x.s));
  const top = scored.filter(x => x.s === best);
  if (best > 0 && top.length === 1) return { kind: "resolved", entry: top[0].e, via: "descriptor" };
  return { kind: "ambiguous", candidates: pool };
}

const dedupe = (xs: HistoryEntry[]) => [...new Map(xs.map(e => [e.member_id, e])).values()];

export function whichQuestion(res: Resolution): string {
  const d = (e: HistoryEntry) => `${e.name} (${e.summary}, ${e.when})`;
  if (res.kind === "ambiguous") return `Which one do you mean: ${res.candidates.map(d).join(" or ")}?`;
  if (res.kind === "pronoun") return res.candidates.length === 1 ? `Just to be sure, do you mean ${d(res.candidates[0])}?` : "Who is this about? A first name is enough.";
  if (res.kind === "unknown") return "I couldn't find that person in your intros. Who is it? A first name or when you met is enough.";
  return "";
}
