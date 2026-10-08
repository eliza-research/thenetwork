// Public surface. mintLeakChecked is deliberately NOT exported: only runGate() can produce a LeakCheckedMessage.
export { send, type LeakCheckedMessage, type OutboundTransport } from "./brand.ts";
export { runGate, decide, GATE_VERSION, PIPELINE_VERSION, DEFAULT_LLM_TIMEOUT_MS, ASYNC_LLM_TIMEOUT_MS, LIVE_LLM_TIMEOUT_MS, LIVE_HEDGE_AFTER_MS, timeoutFor, type GateOptions, type GateOutcome, type Decision, type DecideResult, type DecideOptions, type DecideReason, type ReasonCode } from "./gate.ts";
export { deterministicCheck, LEXICON, REVIEW_TOPICS, sensitiveMentionsAboutOthers, romanceWithoutOptIn, subjectOf } from "./deterministic.ts";
export { classifyLeak, renderGateContext, PROMPTS, CURRENT_PROMPT, CURRENT_CONTEXT, SENSITIVE_TOPICS, type ContextVersion } from "./classifier.ts";
export { scrubText, scrubFacet, hasRawContact } from "./scrub.ts";
export { PatternTracker, extractSchedule, type PatternAlert } from "./pattern.ts";
export { visibility } from "./visibility.ts";
export * from "./types.ts";
