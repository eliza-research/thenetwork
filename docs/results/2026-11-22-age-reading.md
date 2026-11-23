# Stated ages in text and Slop onboarding

PRs #444, #517, and #572 fix the text readers that supply the [member age](../../spec/memberAge.md) and [Slop onboarding](../../spec/slopOnboarding.md) rules. The [membership](../../spec/models/join_age.md) and [matching engine](../../spec/models/matching_engine.md) models take the readers' output as input. The same generated rules govern join eligibility, matching, the lowest age, and prompt withholding.

| Corpus input | Base reader | Repaired reader |
|---|---|---|
| “I'm 12.5 minutes away” | Network reports age 12 | Network reports no age |
| “I'm 3 and 0 this season” | Slop reads age 3 and declines | Slop reports no age |
| “turning 16 next month” | Network reports no age | Network reports age 15 and a minor signal |
| “I'm a 17 year old trans girl looking for guys” | Both readers miss the age, and the Slop hook returns dating tags | Both readers report age 17, and the Slop hook returns no dating tags or next question |

The same four hand-written rows ran against the base code at f662eda0 and the repaired code. The command was `pnpm run sim --only evals,onboard` with Node 26.13.0 and pnpm 10.24.0. Blocking gates improved from 43/50 to 50/50. The onboarding run used 576 adult personas on seeds 13 and 14. The same tracked parser coverage gate missed its target on both runs. The deterministic readers made no model calls.

Direct probes of the Slop service hook and the Network classifier also checked possessive phrases and durations. The phrase “I'm a 12 year old girl's father” does not set an age. “I'm twelve and a half months sober” does not set an age. “I'm 12 and a half” still marks the member as a minor. The Network keeps this reading as a stated age, without marking it explicit for an under-13 refusal.

The shared article ending requires an age clause or a recognized self-description. Removing the article restriction from the generic age rule would also accept a child's age. Rewriting the input before parsing would change which substring the onboarding profile records as evidence. The focused pattern keeps the original text and span.
