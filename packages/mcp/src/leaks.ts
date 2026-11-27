// The output leak gate for model-visible tool content (ported from the retired
// prototypes/connector-mcp output pipeline, design section 5.1). Text that reaches an assistant must
// carry no phone number or email, no internal identifier and no machine timestamp, no prompt injection,
// no canary shapes, no stray contact details (unless explicitly whitelisted), and none of the strings
// or sensitive terms that could disclose private facts. The folding and fuzzy matching are the shared
// core guard's. Applied to the text an assistant reads that did not come from this package's own copy.
// A summary that fails is withheld, never shown in part.
import { detectExternalPromptInjection } from "../../core/src/externalEvents.ts";
import { findContactKinds, LeakGuard, plainVariants, SENSITIVE_TERMS } from "../../core/src/guard.ts";

const PHONE_OR_EMAIL = new Set(["phone", "email", "email_spelled"]);

/**
 * Internal identifiers across network, meetup, OAuth, notify, and platform records
 * (member, opportunity, activity, recipient, grant, proposal, decision, venue visit,
 * meetup action, RSVP, external event/plan, notification delivery, OAuth client/grant/token,
 * venue, external prospect, matchmaker, ticket, inbox item, profile fact).
 */
export const INTERNAL_ID =
  /\b(?:mem|opp|act|rcp|grt|prp|dcr|vv|ma|rsvp|ep|plan|ntf|mcp|grant_cloud|grant|ntwa|ntwr|ntwc|ntws|ven|ext|mm|tkt|inb|pfr|pfc)_[a-z0-9_-]+/i;

/** An ISO timestamp in prose ("2026-10-08T19:30"): machine data, never model-visible text. */
export const ISO_TIMESTAMP = /\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i;

const SENSITIVE_PHRASE_VOCAB = [
  "eating disorder", "self harm", "trying to conceive", "in recovery", "laid off",
  "chronic illness", "sex work", "sex worker", "domestic violence", "sexual assault",
  "mental health", "hiv positive", "on probation", "on parole",
];

const OWN_APP_URL_TOKEN =
  /^[(\[]?(?:https:\/\/)?(?:ntwrk\.party|slop\.date|peon\.biz|friends\.help)(?:\/[a-z0-9/_?&=#.-]*)?[)\],.;!?]*$/i;

function ownAppContactTokens(text: string): string[] {
  const out: string[] = [];
  for (const token of text.match(/\S+/gu) ?? []) {
    if (!OWN_APP_URL_TOKEN.test(token)) continue;
    if (token.includes("@") || token.includes("..")) continue;
    if (token.replace(/\D/g, "").length >= 7) continue;
    out.push(token);
  }
  return out;
}

const DEFAULT_PRIVATE_VOCAB = [...SENSITIVE_TERMS, ...SENSITIVE_PHRASE_VOCAB];

const DEFAULT_GUARD = new LeakGuard({
  privateVocab: DEFAULT_PRIVATE_VOCAB,
  contacts: true,
  canaryShapes: true,
});

export interface OutputLeakOptions {
  forbidden?: string[];
  facts?: string[];
  contacts?: boolean;
  /** Explicitly whitelisted booking links or venue addresses exempted from contact checks. */
  allow?: string[];
  canaryShapes?: boolean;
  /** Screen sensitive personal/dietary/health/recovery vocabulary (default true). */
  sensitiveTerms?: boolean;
  /** Screen external prompt-injection directives (default true). */
  promptInjection?: boolean;
  /** Allow vetted first-party app URLs like https://peon.biz (default true). */
  allowOwnAppUrls?: boolean;
}

/**
 * The violations in `text` (empty = clean). `forbidden` are exact strings (ids, names, contact values),
 * `facts` private facts matched fuzzily. `contacts` runs the full core contact patterns (handles,
 * addresses, URLs, phones, emails) with first-party app URLs and explicit `allow` entries whitelisted.
 * Labels never contain the matched value.
 */
export function outputLeaks(text: string, o: OutputLeakOptions = {}): string[] {
  const forbidden = (o.forbidden ?? []).filter(Boolean);
  const facts = (o.facts ?? []).filter(Boolean);
  const allow = (o.allow ?? []).filter(Boolean);
  const contactsOn = o.contacts ?? true;
  const canaryShapes = o.canaryShapes ?? true;
  const sensitiveTerms = o.sensitiveTerms ?? true;
  const promptInjection = o.promptInjection ?? true;
  const allowOwnAppUrls = o.allowOwnAppUrls ?? true;

  const useDefault = !forbidden.length && !facts.length && !allow.length && contactsOn && canaryShapes && sensitiveTerms;
  const guard = useDefault
    ? DEFAULT_GUARD
    : new LeakGuard({
        exact: forbidden,
        facts,
        privateVocab: sensitiveTerms ? DEFAULT_PRIVATE_VOCAB : [],
        allow,
        contacts: contactsOn,
        canaryShapes,
      });

  const contactAllow = contactsOn && allowOwnAppUrls ? ownAppContactTokens(text) : undefined;
  const v = guard.check(text, contactAllow?.length ? { contactAllow } : undefined);
  if (v[0] === "too_long") return v;

  const phoneOrEmail = findContactKinds(text, { kinds: PHONE_OR_EMAIL, phoneExemptions: false });
  if (phoneOrEmail.includes("phone")) v.push("phone_pattern");
  if (phoneOrEmail.includes("email") || phoneOrEmail.includes("email_spelled")) v.push("email_pattern");

  const variants = plainVariants(text);
  if (variants.some(t => INTERNAL_ID.test(t))) v.push("internal_id");
  if (variants.some(t => ISO_TIMESTAMP.test(t))) v.push("iso_timestamp");

  if (promptInjection) {
    const injection = detectExternalPromptInjection(text);
    if (injection) v.push(`prompt_injection:${injection}`);
  }
  return v;
}

export const passesOutputGate = (text: string, o?: OutputLeakOptions): boolean => outputLeaks(text, o).length === 0;
