// Prompt-independent judge constants shared by the core pass runner (judgeCommon.ts) and every
// pack's prompt module. A leaf module: it imports nothing, so prompt templates can interpolate these
// at load time without an import cycle.

/** Shared wording: how to cite facts and what stays internal. Embedded in every pass prompt. */
export const CITATION_RULES = `Cite facts by field using the person's ref and the field path exactly as it appears in the input (for example P1.intents[0], P2.matchable_do_not_quote[1], P1.preferences.formats, P2.presence[0], relationships[0]). Quote or closely paraphrase the actual value you rely on; do not cite fields that do not exist.`;

/** Facts older than this are flagged as possibly stale in every pass. */
export const STALE_DAYS = 180;
/** An unconfirmed inferred/observed fact below this confidence is a hypothesis (never a sole anchor). */
export const HYPOTHESIS_CONFIDENCE = 0.65;
