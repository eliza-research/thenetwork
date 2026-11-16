import type { FacetKind, PrivacyScope, Provenance, SourceKind } from "../../core/src/types.ts";

export const MEMBER_FACT_PAGE_SIZE = 4;
export const MEMBER_FACT_VALUE_LIMIT = 200;
const LAST_PAGE = Math.floor(Number.MAX_SAFE_INTEGER / MEMBER_FACT_PAGE_SIZE);
const REPLY_LENGTH = 1_600;
const REFERENCE = /^pfr_[a-p]{32}$/;
const DRAFT = /^pfc_[a-p]{32}$/;
const unsafeText = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;
const INVISIBLE = new RegExp(unsafeText.source, "gu");

export type EditableMemberFactScope = Exclude<PrivacyScope, "opportunity_specific">;
export type MemberFactChange =
  | { kind: "correct"; value: string }
  | { kind: "remove" }
  | { kind: "scope"; scope: EditableMemberFactScope };
export type MemberFactCommand =
  | { kind: "list"; page: number }
  | ({ ref: string } & MemberFactChange)
  | { kind: "confirm"; draft: string }
  | { kind: "cancel"; draft: string }
  | { kind: "invalid" };

export interface MemberFactView {
  reference: string;
  kind: FacetKind;
  value: string;
  scope: PrivacyScope;
  source?: string | null;
  provenance?: Provenance | null;
}

const PREFIX = /^(?:show[ \t]+my[ \t]+facts|correct[ \t]+fact|remove[ \t]+fact|set[ \t]+fact[ \t]+scope|confirm[ \t]+fact[ \t]+edit|cancel[ \t]+fact[ \t]+edit)\b/i;
const LIST = /^show[ \t]+my[ \t]+facts(?:[ \t]+page[ \t]+([1-9]\d{0,15}))?$/i;
const ALIAS = /^what[ \t]+do[ \t]+you[ \t]+know[ \t]+about[ \t]+me\?$/i;
const CORRECT = /^correct[ \t]+fact[ \t]+(pfr_[a-p]{32})[ \t]+to[ \t]+(.+)$/i;
const REMOVE = /^remove[ \t]+fact[ \t]+(pfr_[a-p]{32})$/i;
const SCOPE = /^set[ \t]+fact[ \t]+scope[ \t]+(pfr_[a-p]{32})[ \t]+to[ \t]+(agent_private|matchable|shareable)$/i;
const CHOOSE = /^(confirm|cancel)[ \t]+fact[ \t]+edit[ \t]+(pfc_[a-p]{32})$/i;

/** Parse the requested action only. The signed service resolves the app, verified member and current references. */
export function memberFactCommand(text: string): MemberFactCommand | undefined {
  const line = text.trim();
  if (ALIAS.test(line)) return { kind: "list", page: 1 };
  if (!PREFIX.test(line)) return;
  const list = LIST.exec(line);
  if (list) {
    const page = list[1] ? Number(list[1]) : 1;
    return Number.isSafeInteger(page) && page <= LAST_PAGE ? { kind: "list", page } : { kind: "invalid" };
  }
  const correct = CORRECT.exec(line);
  if (correct) {
    const value = correct[2]!.trim();
    return value.length > 0 && value.length <= MEMBER_FACT_VALUE_LIMIT && !unsafeText.test(value)
      ? { kind: "correct", ref: correct[1]!.toLowerCase(), value }
      : { kind: "invalid" };
  }
  const remove = REMOVE.exec(line);
  if (remove) return { kind: "remove", ref: remove[1]!.toLowerCase() };
  const scope = SCOPE.exec(line);
  if (scope) return { kind: "scope", ref: scope[1]!.toLowerCase(), scope: scope[2]!.toLowerCase() as EditableMemberFactScope };
  const choose = CHOOSE.exec(line);
  if (choose) return { kind: choose[1]!.toLowerCase() === "confirm" ? "confirm" : "cancel", draft: choose[2]!.toLowerCase() };
  return { kind: "invalid" };
}

const kindLabel: Record<FacetKind, string> = {
  interest: "Interests", skill: "Skills", offer: "Offers", desire: "Wants", goal: "Goals", boundary: "Boundaries",
  trait: "Traits", fact: "Facts", resource: "Resources", preference: "Preferences", availability_pattern: "Availability",
};

const sourceLabel: Record<SourceKind, string> = {
  chat: "You", vouch: "An invitation vouch", ai_memory: "Your agent summary", gmail: "Gmail", google_calendar: "Google Calendar",
  linkedin: "LinkedIn", x: "X", instagram: "Instagram", github: "GitHub", strava: "Strava", spotify: "Spotify",
  eventbrite: "Eventbrite", partiful: "Partiful", luma: "Luma", personal_website: "Your website",
};

const provenanceLabel: Record<Provenance, string> = {
  said: "You", connected_source: "A connected source", inferred: "An inference", vouched: "An invitation vouch",
};

const scopeLabel: Record<PrivacyScope, string> = {
  agent_private: "agent_private", matchable: "matchable", shareable: "shareable", opportunity_specific: "One opportunity",
};

function sourceOf(fact: MemberFactView): string {
  if (fact.source && Object.hasOwn(sourceLabel, fact.source)) {
    const label = sourceLabel[fact.source as SourceKind];
    if (fact.provenance !== "inferred") return label;
    return fact.source === "chat" ? "Inferred from a conversation" : `Inferred from ${label}`;
  }
  return fact.provenance && Object.hasOwn(provenanceLabel, fact.provenance) ? provenanceLabel[fact.provenance] : "Unknown";
}

/** Known stored values may be larger than a text. Display a bounded preview and keep the edit reference. */
function preview(value: string): string {
  const text = value.replace(INVISIBLE, " ").trim();
  if (text.length <= MEMBER_FACT_VALUE_LIMIT) return text;
  return `${text.slice(0, MEMBER_FACT_VALUE_LIMIT - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

const replies = {
  saved: "I applied that edit to your saved facts.",
  cancelled: "I cancelled that edit.",
  invalid: "Use SHOW MY FACTS to see your saved facts and the available edit commands.",
  unavailable: "That fact or edit is unavailable. Use SHOW MY FACTS to get current references.",
} as const;

export function memberFactReply(outcome: keyof typeof replies): string { return replies[outcome]; }

/** Render only facts that the service authorized for this app and member. The existing send guard checks each reply. */
export function memberFactListText({ page, hasMore, facts }: { page: number; hasMore: boolean; facts: readonly MemberFactView[] }): string {
  if (!Number.isSafeInteger(page) || page < 1 || page > LAST_PAGE) return replies.unavailable;
  const groups = new Map<FacetKind, string[]>();
  for (const fact of facts.slice(0, MEMBER_FACT_PAGE_SIZE)) {
    if (!REFERENCE.test(fact.reference) || !Object.hasOwn(kindLabel, fact.kind) || !Object.hasOwn(scopeLabel, fact.scope)) return replies.unavailable;
    const line = `${fact.reference} · ${preview(fact.value)} · Source: ${sourceOf(fact)} · Scope: ${scopeLabel[fact.scope]}`;
    const group = groups.get(fact.kind);
    if (group) group.push(line);
    else groups.set(fact.kind, [line]);
  }
  if (!groups.size) return page === 1 ? "You have no saved facts to show here." : "There are no saved facts on this page. Use SHOW MY FACTS to start again.";
  const body = [
    `Your saved facts · Page ${page}`,
    ...[...groups].flatMap(([kind, lines]) => [kindLabel[kind], ...lines]),
    "Edit with CORRECT FACT <ref> TO <text>, REMOVE FACT <ref>, or SET FACT SCOPE <ref> TO agent_private, matchable or shareable.",
    ...((hasMore || facts.length > MEMBER_FACT_PAGE_SIZE) && page < LAST_PAGE ? [`Next page: SHOW MY FACTS PAGE ${page + 1}`] : []),
  ].join("\n");
  return body.length <= REPLY_LENGTH ? body : replies.unavailable;
}

/** The code identifies the exact pending edit. The confirmation reply needs no old or replacement value. */
export function memberFactEditPrompt({ draft, fact, change }: { draft: string; fact: Pick<MemberFactView, "reference" | "kind">; change: MemberFactChange }): string {
  if (!DRAFT.test(draft) || !REFERENCE.test(fact.reference) || !Object.hasOwn(kindLabel, fact.kind)) return replies.unavailable;
  const target = `${fact.reference} (${kindLabel[fact.kind]})`;
  const action = change.kind === "correct" ? `Replace fact ${target} with the text you just sent.`
    : change.kind === "remove" ? `Remove fact ${target}.`
      : `Set the scope of fact ${target} to ${scopeLabel[change.scope]}.`;
  return `${action}\nReply CONFIRM FACT EDIT ${draft} to apply it, or CANCEL FACT EDIT ${draft}.`;
}
