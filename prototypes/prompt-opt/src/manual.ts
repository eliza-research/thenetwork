// "Manual iteration" comparator: the seed prompt plus the pass-1 TEXT fixes recommended in
// docs/results/2026-10-06-luna-error-analysis.md (rec 4, pass 1). Input-view changes (evidence tags,
// boundary flag) are out of scope here because the pilot replays the committed v2 inputs.
// Caveat: that analysis read errors from all four worlds, including this pilot's test worlds, so this
// arm is contaminated on test. The GEPA-lite arm only ever sees dev items.
import { seedPrompt } from "./seed.ts";

export const MANUAL_VERSION = "pass1-screen-v2+manual-text";

export function manualPrompt(seed = seedPrompt()): string {
  const rep = (s: string, a: string, b: string) => { if (!s.includes(a)) throw new Error(`manual edit anchor missing: ${a.slice(0, 40)}`); return s.replace(a, b); };
  let p = seed;
  p = rep(p, "Be a thoughtful, skeptical friend: precision over volume. Most candidates are NOT good; say yes only when every attending person clearly gains and would plausibly accept.",
    "Be a thoughtful, skeptical friend: protect members' attention, and do not withhold an intro that would clearly serve both sides. Say yes when every attending person would plausibly enjoy and benefit from meeting.");
  p = rep(p, "Judge from what is listed: intents, interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, and relationships.",
    `Judge from what is listed: intents, interests/skills (matchable_do_not_quote), shareable facts, preferences, participation state, presence, and relationships.
Judging notes:
- For each attending person, name which of their OWN intents (or skills others need) this serves. When people state the same or complementary intent (both want friends, both want a climbing partner, one needs a skill the other has), that IS the reason to meet; do not require an extra shared hobby.
- If a person's only link is a shared interest and neither person's intent mentions it, the answer is usually no.
- A fit must be mutual: check what each person gets, not only the initiator.
- For groups, judge the group as a whole: yes when most members directly want the objective and no one is clearly mismatched.
- Unknown schedules are normal; reject on logistics only when presence makes meeting impossible.
- Do not anchor an intro on a single inferred or weakly evidenced interest.`);
  p = rep(p, "and whether each would plausibly say yes.", "and whether each would enjoy and benefit from meeting.");
  p = rep(p, "that this is a genuinely good, mutually wanted opportunity.", "that every attending person would enjoy and benefit from this meeting.");
  p = rep(p, "probability (0-1) they would accept the invitation.", "probability (0-1) they would accept the invitation (reported separately; it does not decide the verdict).");
  return p;
}
