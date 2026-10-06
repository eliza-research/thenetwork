// Explanations (ME-003, Section 17.2): built ONLY from shareable facets, event titles, and the
// member's own request. A leak checker rejects any text (including LLM "why" text and
// objectives) that contains vocabulary found only in non-shareable facets.
import type { Facet, MemberId } from "@thenetwork/core";
import { cosine, tokenize } from "./embed.ts";
import type { Candidate, JudgeVerdict } from "./types.ts";
import type { World } from "./world.ts";

const KIND_PHRASE: Partial<Record<Facet["kind"], string>> = { interest: "is into", goal: "is working toward" };

/** Words that appear only in non-shareable facets of the participants (the leak vocabulary). */
export function privateVocabulary(w: World, ids: MemberId[]): Set<string> {
  const shareable = new Set<string>();
  const priv = new Set<string>();
  for (const id of ids) {
    const mi = w.get(id);
    if (!mi) continue;
    for (const f of mi.share) for (const t of tokenize(`${f.value} ${f.tags.join(" ")}`)) shareable.add(t);
    for (const t of tokenize(mi.m.name)) shareable.add(t);
    for (const v of mi.privateValues) for (const t of tokenize(v)) priv.add(t);
    for (const f of mi.match) if (f.scope !== "shareable") for (const t of tokenize(f.tags.join(" "))) priv.add(t);
  }
  for (const e of w.events) for (const t of tokenize(`${e.title} ${e.tags.join(" ")}`)) shareable.add(t);
  for (const t of [...priv]) if (shareable.has(t) || t.length < 4) priv.delete(t);
  return priv;
}

export function leaks(text: string, vocab: Set<string>): boolean {
  if (/canary/i.test(text)) return true;
  return tokenize(text).some(t => vocab.has(t));
}

function phrase(name: string, f: Facet): string {
  const p = KIND_PHRASE[f.kind];
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
    if (c.kind === "network_growth") {
      bits.push(`You know a lot of people here, and the Network is looking for ${c.anchor?.label ?? "someone new"}.`);
    } else {
      if (c.anchor?.type === "intent" && w.intentById.get(c.anchor.id)?.memberId === me) bits.push("This connects to something you asked about.");
      if (event) bits.push(`It is built around ${event.title}.`);
      if (c.kind === "newcomer_welcome") bits.push(c.roles[me] === "newcomer" ? "A low-key way to meet a few friendly members in your first weeks." : "A newer member could use a warm welcome.");
      if (c.kind === "second_encounter") bits.push("You both enjoyed meeting last time.");
      for (const o of others.slice(0, 3)) {
        const mo = w.get(o)!;
        const ev = (c.evidence[o] ?? []).map(fid => mo.share.find(f => f.id === fid)).filter((f): f is Facet => !!f);
        // Fallback: the other person's shareable facet most relevant to me.
        const q = w.get(me)!.profileEmb;
        const fallback = mo.share.filter(f => f.kind !== "boundary" && f.kind !== "preference" && f.kind !== "availability_pattern")
          .map(f => ({ f, s: cosine(q, mo.facetEmb.get(f.id) ?? []) }))
          .sort((a, b) => (b.s - a.s) || (a.f.id < b.f.id ? -1 : 1))[0]?.f;
        const f = ev[0] ?? fallback;
        bits.push(f ? phrase(mo.m.name, f) : `${mo.m.name} could be a good fit.`);
      }
      if (others.length > 3) bits.push(`Plus ${others.length - 3} more.`);
      if (c.exploration) bits.push("Part of the reason is novelty: it is a bit outside your usual pattern.");
    }
    // Template text is built from shareable facets only, so it is safe by construction; the
    // judge's free text is accepted only if it passes the leak checker.
    let text = bits.join(" ");
    // Pass-3 text (already leak-gated) wins over pass-2 text; both are re-checked here.
    const why = deepWhy?.[me] || verdict?.why?.[me];
    if (why && !leaks(why, vocab)) text = `${why} ${bits.filter(b => b.startsWith("Part of the reason")).join(" ")}`.trim();
    if (/canary/i.test(text)) text = "The Network thinks this could be a good fit for you.";
    out[me] = text;
  }
  return { explanations: out, objective };
}
