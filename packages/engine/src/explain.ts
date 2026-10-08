// Explanations (ME-003, Section 17.2): built ONLY from shareable facets, event titles, and the
// member's own request. A leak checker rejects any text (including LLM "why" text and
// objectives) that contains vocabulary found only in non-shareable facets.
import { isSensitiveTerm, type Facet, type MemberId } from "@thenetwork/core";
import { cosine, tokenize } from "./embed.ts";
import { leaksMemberFacing } from "./judgeCommon.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import type { World } from "./world.ts";

/** Shown with every exploration pick: the member is told it is outside their usual pattern. */
export const EXPLORATION_LABEL = "Part of the reason is novelty: it is a bit outside your usual pattern.";

// The Network's phrases moved verbatim to packs/network/copy.ts (networkPack.explain).

/**
 * Words that appear only in non-shareable facets of the participants (the leak vocabulary).
 * Ordinary words are dropped when anyone involved shares them, or when shorter than 4 letters.
 * Sensitive terms (core SENSITIVE_TERMS: "gay", "hiv", "aa", "ivf", "sober"...) are kept however
 * short, and only the member's own shareable facets can clear them: another member's shareable
 * text never whitelists someone's private sensitive word (audit core-1 / engine-pipeline-3).
 */
export function privateVocabulary(w: World, ids: MemberId[]): Set<string> {
  const shareable = new Set<string>();
  const priv = new Set<string>();
  const sensitive = new Set<string>();
  for (const id of ids) {
    const mi = w.get(id);
    if (!mi) continue;
    const own = new Set<string>();
    for (const f of mi.share) for (const t of tokenize(`${f.value} ${f.tags.join(" ")}`)) { shareable.add(t); own.add(t); }
    for (const t of tokenize(mi.m.name)) shareable.add(t);
    const mine = new Set<string>();
    for (const v of mi.privateValues) for (const t of tokenize(v)) mine.add(t);
    for (const f of mi.match) if (f.scope !== "shareable") for (const t of tokenize(f.tags.join(" "))) mine.add(t);
    for (const t of mine) { priv.add(t); if (isSensitiveTerm(t) && !own.has(t)) sensitive.add(t); }
  }
  for (const e of w.events) for (const t of tokenize(`${e.title} ${e.tags.join(" ")}`)) shareable.add(t);
  for (const t of [...priv]) if (shareable.has(t) || t.length < 4) priv.delete(t);
  // Pack vocabulary that is never private (slopPack: "date", "dating", pronouns from its facet templates). Absent for networkPack.
  for (const t of w.pack.explain.publicWords ?? []) priv.delete(t);
  for (const t of sensitive) priv.add(t);
  return priv;
}

/** Leak gate for explanation text: the shared core guard plus the engine's canary/vocabulary checks (judgeCommon.ts). */
export function leaks(text: string, vocab: Set<string>): boolean {
  return leaksMemberFacing(text, vocab);
}

function phrase(w: World, name: string, f: Facet): string {
  const p = w.pack.explain.facetPhrase[f.kind];
  return p ? `${name} ${p} ${f.value}.` : `${name}: ${f.value}.`;
}

export function explain(w: World, c: Candidate, verdict?: JudgeVerdict | null, deepWhy?: Record<MemberId, string>): { explanations: Record<MemberId, string>; objective: string } {
  const vocab = privateVocabulary(w, c.participants);
  const objective = leaks(c.objective, vocab) ? `Proposed ${c.kind.replace(/_/g, " ")}` : c.objective;
  const out: Record<MemberId, string> = {};
  const event = c.anchor?.type === "event" ? w.events.find(e => e.id === c.anchor!.id) : undefined;
  for (const me of c.participants) {
    const others = c.participants.filter(o => o !== me);
    const bits: string[] = [];
    const E = w.pack.explain;
    const lead = E.leadBits?.(w, c, me);
    if (lead) {
      bits.push(...lead);
    } else {
      if (c.anchor?.type === "intent" && w.intentById.get(c.anchor.id)?.memberId === me) bits.push("This connects to something you asked about.");
      // Member- or source-written inserts are leak-gated, not assumed safe (engine-pipeline-21): an
      // event title or a facet value that carries another participant's private word is dropped.
      if (event && !leaks(event.title, vocab)) bits.push(`It is built around ${event.title}.`);
      if (E.kindBits) bits.push(...E.kindBits(w, c, me));
      for (const o of others.slice(0, 3)) {
        const mo = w.get(o)!;
        const ev = (c.evidence[o] ?? []).map(fid => mo.share.find(f => f.id === fid)).filter((f): f is Facet => !!f);
        // Fallback: the other person's shareable facet most relevant to me.
        const q = w.get(me)!.profileEmb;
        const fallback = mo.share.filter(f => f.kind !== "boundary" && f.kind !== "preference" && f.kind !== "availability_pattern")
          .map(f => ({ f, s: cosine(q, mo.facetEmb.get(f.id) ?? []) }))
          .sort((a, b) => (b.s - a.s) || (a.f.id < b.f.id ? -1 : 1))[0]?.f;
        const f = ev[0] ?? fallback;
        // The other person's own shareable words are theirs to show; anyone else's private words are not.
        const ownWords = new Set(mo.share.flatMap(x => tokenize(`${x.value} ${x.tags.join(" ")}`)));
        const safe = f && !leaks(f.value, new Set([...vocab].filter(t => !ownWords.has(t))));
        bits.push(safe ? phrase(w, mo.m.name, f) : `${mo.m.name} could be a good fit.`);
      }
      if (others.length > 3) bits.push(`Plus ${others.length - 3} more.`);
      if (c.exploration) bits.push(EXPLORATION_LABEL);
    }
    // Template text is the pack's fixed copy plus gated inserts (above); the judge's free text is
    // accepted only if it passes the leak checker.
    let text = bits.join(" ");
    // Pass-3 text (already leak-gated) wins over pass-2 text; both are re-checked here.
    const why = deepWhy?.[me] || verdict?.why?.[me];
    if (why && !leaks(why, vocab)) text = `${why} ${bits.filter(b => b.startsWith("Part of the reason")).join(" ")}`.trim();
    if (/canary/i.test(text)) text = E.safeFallback;
    // An exploration pick is always labelled, whatever path built the text (engine-pipeline-21).
    if (c.exploration && !text.includes(EXPLORATION_LABEL)) text = `${text} ${EXPLORATION_LABEL}`.trim();
    out[me] = text;
  }
  return { explanations: out, objective };
}
