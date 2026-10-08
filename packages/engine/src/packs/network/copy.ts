// The Network's member-facing copy (networkPack.explain / attention / selection), moved verbatim from
// generators.ts (CATEGORY_LABEL), explain.ts (KIND_PHRASE and the per-kind sentences), policy.ts
// (ASK_QUESTIONS) and attention.ts (GENERIC_ACTIVITY and the probe frames). Every string still passes
// the core leak gate before it is sent. A leaf module (no engine imports), so it is cycle-safe.
import type { Category, Facet } from "@thenetwork/core";

export const CATEGORY_LABEL: Record<Category, string> = {
  social: "a social introduction", professional: "a professional introduction", romance: "a dinner introduction",
  hobby: "a shared-hobby meetup", help: "a bounded help request", events: "an event together", growth: "growing the Network",
};

export const KIND_PHRASE: Partial<Record<Facet["kind"], string>> = { interest: "is into", goal: "is working toward" };

export const NETWORK_SAFE_FALLBACK = "The Network thinks this could be a good fit for you.";

/** Replaces the whole explanation (was the network_growth branch of explain.ts). */
export function networkLeadBits(c: { kind: string; anchor?: { label?: string } }): string[] | undefined {
  if (c.kind === "network_growth") return [`You know a lot of people here, and the Network is looking for ${c.anchor?.label ?? "someone new"}.`];
  return undefined;
}

/** Per-kind sentences after the intent / event bits (was explain.ts). */
export function networkKindBits(c: { kind: string; roles: Record<string, string> }, me: string): string[] {
  const bits: string[] = [];
  if (c.kind === "newcomer_welcome") bits.push(c.roles[me] === "newcomer" ? "A low-key way to meet a few friendly members in your first weeks." : "A newer member could use a warm welcome.");
  if (c.kind === "second_encounter") bits.push("You both enjoyed meeting last time.");
  return bits;
}

/** Ask-before-proposing questions (was policy.ts ASK_QUESTIONS). */
export const ASK_QUESTIONS = {
  no_structured_want: "What would you most like to do or find in the next few weeks? Something specific, like an activity, a skill to learn or the kind of people you'd like to meet, helps me find the right person.",
  few_facets: "Tell me a bit more about you: two or three things you enjoy or are good at help me find people you'd actually like to meet.",
  romance_prefs: "Before I suggest anyone to date: who are you hoping to meet, and what age range feels right?",
} as const;

/** Generic activity phrase per lane for probes (was attention.ts GENERIC_ACTIVITY). */
export const GENERIC_ACTIVITY: Record<Category, string> = {
  social: "meeting new people", hobby: "a shared hobby", professional: "work and career", romance: "dating",
  help: "something you asked for help with", events: "an event nearby", growth: "growing the Network",
};

/** The anonymous consent-first probe (was the `frame` closure of attention.ts buildProbe). */
export function networkProbeText(ctx: { lane: string; kind: string; when: string; othersCount: number; contributor: boolean; mutual?: string }, activity: string, a?: string, ar?: string): string {
  const { when, mutual } = ctx;
  const near = ar ? ` near ${ar}` : "";
  const also = a ? ` They're into ${a.replace(/[.\s]+$/, "")}.` : "";
  if (ctx.lane === "romance") return `There's someone you might like to go on a date with, ${when}${near}.${also} Want me to check if they're up for it? I'll only share who it is if you both say yes.`;
  if (ctx.kind === "network_growth") return `Know someone who'd be great for ${activity}? No pressure either way.`;
  if (ctx.contributor) return `Someone nearby could use a hand with ${activity}, ${when}${near}. Would you be up for helping? An easy no is fine.${also}`;
  if (ctx.othersCount > 1) return `A few people are getting together around ${activity}, ${when}${near}. Want in? I'll share who's coming once enough people say yes.`;
  return `Up for meeting ${mutual ? `a friend of ${mutual}` : "someone"} around ${activity}, ${when}${near}?${also} I'll only share who it is if you both say yes.`;
}
