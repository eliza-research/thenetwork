// The ONLY thing the recommender model sees about a configuration: a pseudonymous, public view
// built from the engine snapshot (never from Persona objects, never from oracle labels).
//   included: shareable facets, matchable facets (marked do-not-quote), active intents, presence,
//             stated age, participation state, stated preferences, explicit edges among the people.
//   excluded: agent_private facets (boundaries, private disclosures + canaries), hidden truth,
//             names, member ids, oracle verdicts.
// The builder itself lives in packages/engine/src/judgeScreen.ts (pass 1) so the engine and the
// evals build exactly the same prompt input; it is re-exported here unchanged. This file keeps the
// ORIGINAL single-pass prompt (rec-eval-v1) so the previous luna baseline replays byte-identically.
import type { ChatMessage } from "../../core/src/index.ts";
import { prob } from "../../engine/src/judgeCommon.ts";
import type { RecPrediction } from "./types.ts";

export { type PublicPerson, type PublicView } from "../../engine/src/judgeScreen.ts";
import { buildPublicView as buildView, type PublicView, type ScreenConfig } from "../../engine/src/judgeScreen.ts";
import type { WorldSnapshot } from "../../core/src/index.ts";

/** The view rec-eval-v1 was built for (the v2 public view: no evidence notes, no boundary flags). */
export const buildPublicView = (snap: WorldSnapshot, cfg: ScreenConfig): PublicView => buildView(snap, cfg, { version: "v2" });

export const PROMPT_VERSION = "rec-eval-v1";

export const RECOMMENDER_SYSTEM = `You are the recommender for The Network, an invite-only service that introduces adults to each other for friendship, activities, help, professional goals and (only when everyone involved opted in) dating.
You evaluate ONE candidate configuration of people and decide whether the Network should propose it. Be a thoughtful, skeptical friend: precision over volume. Most candidates are NOT good; say yes only when every attending person clearly gains and would plausibly accept.
Hard policy (any violation means good_match=false and dealbreaker=true):
- Everyone involved in ANY role (attending or connector) must be 18 or older.
- Never propose people when one has blocked the other.
- Romance/dating configurations require every attending person to have romance_opt_in=true.
- Everyone must be able to be in the configuration's city during the window (check presence and trips).
Judge from what is listed: intents, interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, and relationships.
Output fields:
- good_match: true if the Network should propose this.
- match_probability: your probability (0-1) that this is a genuinely good, mutually wanted opportunity.
- accept_probability: for each ATTENDING person ref, probability (0-1) they would accept the invitation.
- dealbreaker: true if a hard policy or a clear stated preference makes it inappropriate regardless of fit; dealbreaker_reason: short text or "".
- why: one or two warm sentences that could be shown to the participants, using ONLY items under "shareable" and the configuration's logistics. Never quote matchable_do_not_quote items, never use names, ids, ages, contact details, or anything sensitive.
Return ONLY a JSON object: {"good_match":bool,"match_probability":number,"accept_probability":{"P1":number,...},"dealbreaker":bool,"dealbreaker_reason":string,"why":string}`;

/** Messages sent to the model. Takes ONLY the public view (refs map is dropped). */
export function recommenderMessages(view: PublicView): ChatMessage[] {
  const { refs: _refs, ...visible } = view;
  return [
    { role: "system", content: RECOMMENDER_SYSTEM },
    { role: "user", content: JSON.stringify(visible) },
  ];
}

/** Validate a raw model reply. Throws on schema errors (counted as parse failures). */
export function parseRecPrediction(raw: unknown, attendingRefs: string[]): RecPrediction {
  const o = raw as Record<string, any>;
  if (!o || typeof o !== "object" || Array.isArray(o)) throw new Error("not an object");
  const errs: string[] = [];
  if (typeof o.good_match !== "boolean") errs.push("good_match");
  const mp = prob(o.match_probability);
  if (mp === undefined) errs.push("match_probability");
  if (typeof o.dealbreaker !== "boolean") errs.push("dealbreaker");
  if (typeof o.why !== "string") errs.push("why");
  const acc: Record<string, number> = {};
  for (const r of attendingRefs) {
    const p = prob(o.accept_probability?.[r]);
    if (p === undefined) errs.push(`accept_probability.${r}`); else acc[r] = p;
  }
  if (errs.length) throw new Error(`schema: ${errs.join(", ")}`);
  return {
    goodMatch: o.good_match, matchProbability: mp!, acceptProbability: acc, dealbreaker: o.dealbreaker,
    dealbreakerReason: typeof o.dealbreaker_reason === "string" ? o.dealbreaker_reason : undefined, why: o.why.trim(),
  };
}

/** Final yes/no decision used for accuracy: yes only if good_match and no dealbreaker. */
export const decision = (p: RecPrediction) => p.goodMatch && !p.dealbreaker;
