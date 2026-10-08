// Generator building blocks (core, pack-independent): the candidate constructor, shareable labels,
// format inference and provider benefit. Moved verbatim from generators.ts; packs compose their
// generators from these plus retrieval.ts and group.ts. The Network's 11 generators live in
// packs/network/generators.ts.
import type { Facet, Intent } from "@thenetwork/core";
import { cosine } from "./embed.ts";
import type { RetrievalCtx } from "./retrieval.ts";
import type { Rng } from "./rng.ts";
import type { Candidate, Format, NetworkEvent } from "./types.ts";
import { intentText, type MemberIndex, type World } from "./world.ts";

export interface GenCtx extends RetrievalCtx {
  rng: Rng;
  /** Intents for which retrieval found nobody (input to network growth + empty states). */
  unmatchedIntents: Set<string>;
}

export function makeCandidate(p: Omit<Candidate, "key" | "alternates" | "exploration" | "safetyClass" | "timeSensitive" | "riskText" | "warm" | "channels"> & Partial<Candidate>): Candidate {
  const parts = [...p.participants];
  return {
    key: `${p.generator}:${p.kind}:${p.anchor?.id ?? "-"}:${[...parts].sort().join(",")}`,
    alternates: [], exploration: false, safetyClass: "low", timeSensitive: false, riskText: p.objective,
    warm: 0, channels: new Set(), ...p,
  } as Candidate;
}

/** A shareable label for a facet (tags first, then the short value). Only call with shareable facets. */
export function label(f: Facet | undefined): string | undefined {
  if (!f || f.scope !== "shareable") return undefined;
  return f.tags[0] ?? f.value.split(/[.,;]/)[0]!.slice(0, 40);
}

/** Best shareable facet of `of` relative to embedding q (used for objectives / explanations). */
export function bestShareable(w: World, of: MemberIndex, q: number[]): Facet | undefined {
  let best: Facet | undefined; let bs = -1;
  for (const f of of.share) {
    const e = of.facetEmb.get(f.id);
    if (!e) continue;
    const s = cosine(q, e);
    if (s > bs || (s === bs && best && f.id < best.id)) { bs = s; best = f; }
  }
  return best;
}

export function intentFormat(i: Intent): Format { return /\b(group|band|team|crew|club|doubles|people)\b/i.test(intentText(i)) ? "small_group" : "one_to_one"; }

export function benefitForProvider(w: World, provider: MemberIndex, seeker: MemberIndex, facet?: Facet): number {
  const interest = cosine(provider.desireEmb, seeker.profileEmb);
  const enjoys = facet?.kind === "offer" ? 0.6 : facet ? 0.35 : 0.2;
  return Math.min(1, Math.max(enjoys, enjoys + 0.4 * Math.max(0, interest)));
}

/**
 * Warm-path value as an inverted U in tie strength (research: matching-and-graphs.md 4.9,
 * LinkedIn PYMK weak-tie experiments): moderate friend-of-a-friend ties beat both the
 * strongest and the weakest. Peaks at strength 0.5.
 */
export function warmPathValue(strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  return 0.3 + 0.7 * 4 * s * (1 - s);
}

export function eventRiskText(ev: NetworkEvent) { return `${ev.title} ${ev.description ?? ""} ${ev.tags.join(" ")} ${(ev.riskTags ?? []).join(" ")}`; }
