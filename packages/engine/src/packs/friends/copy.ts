// friends.help member-facing copy. Activity-first, never romance framing ("friends, not dates"):
// no dates, singles, flirting or chemistry language anywhere. Never mentions loneliness, being new
// to the city or a breakup (agent-private; domain research C4 "Explanation norms"). Every string
// still passes the core leak gate before it is sent. A leaf module.
import type { Category, Facet } from "@thenetwork/core";

export const FRIENDS_LANE_LABEL: Partial<Record<Category, string>> = { social: "a small-group meetup", hobby: "an activity buddy" };
export const FRIENDS_KIND_PHRASE: Partial<Record<Facet["kind"], string>> = { interest: "is into" };
export const FRIENDS_SAFE_FALLBACK = "friends.help thinks you'd enjoy this.";
export const FRIENDS_ACTIVITY: Record<string, string> = {
  social: "meeting a few people nearby", hobby: "an activity together", professional: "meeting a few people nearby",
  romance: "meeting a few people nearby", help: "meeting a few people nearby", events: "an event nearby", growth: "meeting a few people nearby",
};
export const FRIENDS_ASK_QUESTIONS = {
  no_structured_want: "What are two or three things you'd love to do with new people, and one you'd try?",
  few_facets: "Tell me a bit more: what do you like doing on a free evening or weekend?",
} as const;

/** Words friends.help never uses toward members (the "friends, not dates" norm); tests assert none appears. */
export const ROMANCE_FRAMING = /\b(date|dates|dating|romantic|romance|singles?|flirt\w*|crush|chemistry|soulmate|match(ed|es)? with)\b/i;

export function friendsProbeText(ctx: { lane: string; kind: string; when: string; othersCount: number }, activity: string, a?: string, ar?: string): string {
  const near = ar ? ` near ${ar}` : "";
  const also = a ? ` They're into ${a.replace(/[.\s]+$/, "")}.` : "";
  if (ctx.kind === "second_encounter") return `Want to do ${activity} again with the same people from last time, ${ctx.when}${near}? I'll confirm once they're in too.`;
  if (ctx.othersCount > 1) return `${ctx.when}: ${activity}${near} with ${ctx.othersCount} others. Want in? I'll share who's coming once enough people say yes.`;
  return `Up for ${activity} with one other person, ${ctx.when}${near}?${also} I'll only share who it is if you both say yes.`;
}

export function friendsKindBits(c: { kind: string }): string[] {
  if (c.kind === "second_encounter" || c.kind === "group") return c.kind === "second_encounter" ? ["You both said you'd like to do this again."] : [];
  return [];
}
