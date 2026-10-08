# Network hardening: member-text understanding, consent and safety order

Date: 2026-10-08. Worktree the `thenetwork-console` worktree, branch `obs/network-console`, base `f270286`. Tests and runs used no API keys and no `LIVE_TESTS`. Every simulated run used the simulated reviewer (`review: "auto"`).

This work fixes the `packages/network` findings in [the audit](../audit/2026-10-08-weaknesses.md): the six P0 findings, the P1 network findings and the cheap P2 and P3 ones. Section 5 lists what is still open.

## 0. Update at HEAD 19d9c1e (after the merge of origin/main's judge, engine and simulator)

The merge brought stricter judge rules (PRD 32.9 budgets per state, PH-003 pause path, proactive labels, minor contacts through plans copy). Run at HEAD before the fix, the consent arm broke them:

| Run (`--only consent`, template arm) | Invariants | By rule |
|---|---|---|
| 1 day, seed 1 | 11 | minor_contact 11 |
| 21 days, seed 1 | 1308 | pause_path_missing 690, proactive_mislabeled 336, over_budget 212, minor_contact 50, decliner_exposed 15, two_unanswered 3, name_before_reveal 2 |
| 21 days, seed 2 | 1443 | (same rules) |

What changed in `packages/network/src` (each has a regression test or corpus line):

| Finding | Fix |
|---|---|
| minor_contact via `copy.plans` | `onPlans` offers "see if anyone else is up" only when the member can be matched and matching is on; otherwise `copy.plansNoOffer`. |
| pause_path_missing, proactive_mislabeled, over_budget, two_unanswered | One outreach controller in `send()`: a send is unsolicited unless it is a reply (15 min, at most 3), inside an opportunity the member said yes to (or asked for), or one of 2 follow-ups to the member's own ask within 48 h. An unsolicited send is marked proactive (the weekly check-in keeps its own lane), gets `Reply STOP anytime to opt out.` (engine `withPausePath`), counts on the judge's `PRD_BUDGETS` / `LANE_BUDGETS`, and is refused after 2 unanswered (the one re-engagement aside). Asks and notices never take the last state slot. Plan invites on the allowance carry `lane: "plan"`. |
| decliner_exposed | Three misreadings that booked people who said no: emoji decoration ("…Anything come up? 💯") counted as a yes; a member's own question ("Anyone around who'd want to…? Honestly this is great timing.") counted as a yes; "great" inside a description counted as a yes. A yes that core `parseReply` reads as a refusal is now unclear. A bare "👍" after two messages in a row is unclear. Asks (growth, check-in) are not sent while a probe or booked plan waits, and a probe waits up to a day for an open ask's answer. The booked text says "Reply if your plans change." and a drop notice no longer names who dropped. |
| name_before_reveal | One first name per opportunity: alternates and replacements never share a first name with anyone in it, and a request never pairs two people with one first name. |
| blocked_pair_proposed | Alternates blocked with a participant, or with another alternate, are left out. |
| minor_contact after a late minor signal | An opportunity a new minor was in (participant, or alternate while it is still open) is closed, never carried on with a replacement. |
| A friend called "Yes" | A one-word "Yes!" to a growth ask no longer invites a friend named "Yes". |

Results at the fixed code, same command: `bun run packages/network/harness/experiment.ts --only consent --days 21 --seed <s> [--paraphrase]`, simulated reviewer, no API keys.

| Arm, seed | Proposals | Everyone yes | Meetings | Enjoyed share | Precision (probed) | Invariants | Canary leaks | Minor contacts |
|---|---|---|---|---|---|---|---|---|
| template 1 | 74 | 65 | 50 | 0.300 | 0.198 | 0 | 0 | 0 |
| template 2 | 86 | 69 | 47 | 0.340 | 0.229 | 0 | 0 | 0 |
| template 3 | 80 | 68 | 46 | 0.261 | 0.226 | 0 | 0 | 0 |
| paraphrase 1 | 74 | 65 | 49 | 0.224 | 0.216 | 0 | 0 | 0 |
| paraphrase 2 | 82 | 69 | 53 | 0.264 | 0.196 | 1 | 0 | 1 |
| paraphrase 3 | 78 | 58 | 46 | 0.239 | 0.205 | 4 | 0 | 4 |

- Everyone-yes, pooled: template 202/240 = 0.842; paraphrase 192/234 = 0.821.
- Meetings, mean: template 47.7 (seed 1 at HEAD before the fix: 48); paraphrase 49.3.
- `cross_app_leak`: 0 in every run. Opt-outs: 0.
- **The 5 remaining minor contacts (paraphrase seeds 2 and 3) are all one case:** reminders, cancellations and feedback about a plan already booked between two adults, where a person who was only an unused alternate later said they are a minor. Nothing about the minor was sent to anyone. The judge counts every member of an opportunity's probe record, alternates included. The Network does not cancel a booked plan between adults for this. This needs a judge decision (ENGINE-SESSION) or a founder decision to cancel such plans.
- Re-run at 03:30 after the last reader change (unasked sexual demands such as "send nudes" now score as harassment; a story about someone who asked is a disclosure): every number in the table above came out identical (seeds 1-3, both arms), and so did the slop pack runs below.
- The slop pack on the slop world (`packages/network/test/slopworld.ts`, 120 NYC personas, 10% minors, 14 days, seeds 1-3): 196, 202 and 184 proposals; 0 with a minor (stated or hidden); 0 outside either side's stated filters (gender, age range, shared city within distance, oracle `statedMutual`); every proposal a pair and waiting for a human reviewer (no probe sent).

## 1. Result

- A refusal is never read as a yes. On 393 hand-written replies, the parser reads 100% correctly. The 75 held-out replies scored 97.3% (73 of 75) on their first run, with 0 refusals read as yes.
- Members' own words now produce matches. With paraphrased personas, the Network made 88 proposals and 56 meetings per run. Before, it made 20 proposals and 13 meetings. The paraphrase arm is now within 5% of the template arm.
- Safety order is fixed. A report is never scored as the reporter's abuse. Every report opens a staff case. The safety record about adults survives an under-13 delete.
- ~~The safety counts stayed 0 in every run.~~ **Not true after the merge of origin/main (HEAD 19d9c1e):** the new judge rules found 1308 invariants in a 21-day seed-1 run. Section 0 has the fix and the new numbers.

## 2. Member-text understanding

### 2.1 What changed

| Part | File | What it does |
|---|---|---|
| Consent parser | `src/classify.ts` `consentOf`, `parseYesNo`, `parseProbeReply` | It reads each sentence and clause, and it reads refusals first. A conditional ("only with a woman"), a hedge ("who is it? thursday maybe") or a refusal followed by a pick ("no, Saturday works") returns `unclear`. A named time counts only with a yes or a firm pick ("Saturday works"). A bare mention ("I'm at a wedding saturday") does not count. The parser is now in `packages/network`, so the simulator no longer grades its own parser. |
| Offline extractor | `src/classify.ts` `extractProfile`, `areaOf` | It uses a concept lexicon for each want, interest and skill, with a negation scope. A skill counts only in the first person ("I play bass", not "looking for a bassist"). An unknown neighborhood stays unset and sets `areaUnknown`. It is never "Midtown". |
| LLM reader | `src/extract.ts` `llmUnderstand` | It runs gpt-6-luna through core `tryChatJson`, with a strict JSON schema. Only ids from the taxonomy and the neighborhood list are allowed. The member's words go inside a delimited block. Its closing tag carries a nonce derived from the message, and the member cannot forge it. A failure or a reply out of shape returns nothing, and the Network then uses the offline reading alone. |
| Merge rules | `src/extract.ts` `mergeConsent`, `network.ts` `withUnderstanding` | The LLM can add a yes only where the rules found no signal. It can never change a refusal, a conditional, a hedge or a mix. An LLM age can only make a member younger, and it never declines anyone. |
| Unclear probe answers | `network.ts` `clarify` | The Network asks once: "Just to check: is that a yes or a no? Either is fine." Nothing is booked. |

`NetworkOptions.understand` turns on the LLM reader. The service must pass `llmUnderstand(defaultLLM())`. That wiring is in `packages/network/service`, which this work does not own.

### 2.2 Corpora and parser gates

All lines were written by hand for these tests. They are not simulator templates. The `*-heldout` file was written after tuning and scored once before any fix.

| Corpus | Lines | Result | Gate |
|---|---|---|---|
| `test/fixtures/consent-replies.jsonl` | 318 (109 yes, 120 no, 89 unclear) | accuracy 1.000, refusals as yes 0 | >= 0.97, 0 |
| `test/fixtures/consent-heldout.jsonl` | 75 | first run 0.973 (2 misses, 0 refusals as yes). After 2 general fixes, 1.000 | >= 0.97, 0 |
| `test/fixtures/paraphrases.jsonl` | 323 (20 wants, 10-25 lines each, 30 no-want lines) | recall 0.94-1.00 per want, false positives <= 0.003 | >= 0.8, <= 0.05 |
| `test/fixtures/areas.jsonl` | 197 (131 known, 66 unknown) | recall 1.00, 0 guesses on unknown places | >= 0.9 |
| `test/fixtures/negations.jsonl` | 102 | 0 wants, 0 interests, 0 requests | 0 |
| `test/fixtures/teen-age.jsonl` | 161 (83 teen, 58 adult, 20 third-party) | teen recall 1.00, 0 adult false positives, 20/20 third-party | >= 0.95 |
| `test/fixtures/benign-adult.txt` | 220 | abuse precision 1.00, 0 minor signals | >= 0.99 |
| `test/fixtures/abuse.jsonl` | 103 | recall 1.00, right kind 103/103 | >= 0.95 |

Limits:
- The person who tuned the rules also wrote these corpora. Only the held-out consent file is independent of the tuning. A second author must write the next held-out set.
- The paraphrase corpus has 10-25 lines for each want. The test plan asks for 50 or more.

## 3. Safety, consent and matching fixes

| Finding | Fix |
|---|---|
| network-consent-1, -2 | Refusals are read first. A conditional, a hedge or a mix is `unclear` and the member is asked again. |
| network-consent-3 | `minorAfterContact` runs before the decline. Each adult gets a `contact_with_minor` case event with ids only, and that event survives `forget()`. |
| network-consent-4 | Blocks and reports run before hold and abuse scoring. A third-party narrative ("he asked me to venmo him $50") is a disclosure and is never counted as the sender's abuse. Money asked for the sender ("send me $100") always counts. |
| network-consent-5, -26, matching-e2e-3 | A probe "no" marks the pair declined. Searches, rerolls and replacements check pair history: a decline, or a meeting or no-show in the last 60 days. A requester gets at most one confirm question per request every 72 hours. A second "no" closes the request. |
| network-consent-6, -7, -14 | Every report opens a staff case. Points need a shared interaction and a reporter not counted before. A staff lift clears old corroboration. Blocking people you met is never block abuse. Repeat blocks count once. |
| network-consent-8 | The abuse patterns are narrower. No single message from a clean record reaches hold. An abusive message that is also a request still opens the request. |
| network-consent-9, -10, -19, network-service-1 | Teen phrasings are read ("I'm only 15", "15f here", "junior at Lincoln High"). Teacher and parent sentences are not minor signals. "I act like I'm 12" is not an age. An attested adult who states an under-join age is held for staff (`age_conflict` case), never deleted. A report that a member is under 18 takes them out of matching and opens a case that lists who they met. `clearMinorSignal` is an audited staff action. An app configured 18+ sends no teen copy. |
| network-consent-11 | Member-facing reasons use shareable facets only. Engine explanations are rebuilt from shareable facts. |
| network-consent-12 | The `onAgeStated(memberId, age, { explicit, declined })` callback fires for every stated age and every decline. The service must write it to `people.lowest_age`. |
| network-consent-13, -18 | "report back when ..." is not a report. A block gives the same reply for a member never met and for a name that matches nobody. A block after booking sends the other member one neutral cancellation and logs `meeting_cancelled`. |
| network-consent-15, -16, -17, -20, -23, -24, -25, -27 | Two-letter names are checked in probes. `forget()` scrubs every per-member map and plan list. One "never showed" counts only after the other member stays silent. Unknown `briefId` sends are refused. An invite needs explicit intent. A member on watch gets one honest reply. Feedback logs keep flags, not the member's text. The watch duration is now documented. |
| matching-e2e-1, -M1 | Section 2. Unknown areas stay unset. Travel is computed only between known neighborhoods. |
| matching-e2e-2 | Engine romance proposals skip the want gate after `romanceGate`. The gate requires exactly 2 people, record opt-ins, a verified adult record age, stated preferences on both sides and mutual is/seeks. `ALLOWED_CATEGORIES`: slop is romance only, friends is social and hobby, peon is professional, and ntwrk is everything except romance. Nothing outside the app's categories is ever queued. |
| matching-e2e-M2 | The judge runs only when `engineLLM` is wired. `effectiveEngineConfig()` reports `judge.enabled`. |
| matching-e2e-6, -7, -15 | Exposure debt round-trips through the state. A request is "fulfilled" only after the requester and someone else attended. Reveal decisions are counted when they happen: `revealYes + revealNo + revealExpired = reveals`. Request search has a load term and a seeded tie-break. |
| attention-MISSED-1, -2 | `planLedger` carries `repliedAt`. A blocked pair in a plan drops only the later joiner. |
| core-m2, capital-m1, capital-m4, engine-attention-plans-7, -15 | The guard cache key includes facet values. `ledgerReader` uses the ledger's own config. Review credit is counted once per item and reviewer. `view()` passes `categoriesOptIn`. An unknown age is treated as a minor. |
| (found in this work) | A plan probe went to a member on an announced trip. The Network now checks `inNyc` up to the plan's end before it sends a plan probe. |
| (found in this work) | The snapshot cache could be up to 20 minutes stale after a member's own message, for example a trip just announced. A restarted Network then saw a different snapshot than an uninterrupted one. Every inbound message now refreshes the snapshot. |

## 4. Simulation: before and after

Command: `bun run packages/network/harness/experiment.ts --only consent --days 21 --seed N`, for seeds 1, 2 and 3. The paraphrase arm adds `--paraphrase` (`harness/paraphrase.ts`). The personas decide as before, but the Network sees other words. "Before" is the base code run with the new harness metrics. The table gives means over the 3 seeds.

| Metric | Before, template | After, template | Before, paraphrase | After, paraphrase |
|---|---|---|---|---|
| Proposals revealed | 93.3 | 88.0 | 19.7 | 88.3 |
| Meetings held | 57.3 | 53.7 | 12.7 | 56.3 |
| Enjoyed share | 0.285 | 0.249 | 0.317 | 0.325 |
| Precision, revealed | 0.350 | 0.320 | 0.335 | 0.353 |
| Precision, started (every probed opp) | 0.206 | 0.206 | 0.179 | 0.203 |
| Probe yes rate | 0.371 | 0.374 | 0.216 | 0.382 |
| Request fulfil rate | 0.320 (at booking) | 0.199 (after attendance) | 0.047 | 0.182 |
| No revealed proposal (honest adults) | 0.535 | 0.554 | 0.863 | 0.576 |
| No meeting (honest adults) | 0.653 | 0.668 | 0.905 | 0.688 |
| Meeting Gini | 0.729 | 0.729 | 0.916 | 0.762 |
| Holds | 9.3 | 7.0 | 7.3 | 8.0 |
| Honest members restricted | 0 | 0 | 0 | 0 |
| Judge invariants, canary leaks, minor contacts | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 | 0, 0, 0 |

Notes:
- The fulfil rate changed definition: it now counts attendance, not booking. The two rows cannot be compared directly.
- `unsafe` (oracle flags on revealed proposals) was 2.3 before and 1.3 after (template). These flags come from hidden truth that the Network cannot know: adversarial participants that were not yet caught, boundary conflicts and one minor who lied about their age.
- Holds went down because one message from a clean record now stops at watch. Every adversary still left matching (`adversariesRestricted` was 7/7 to 10/10 in every run).
- On the template arm, meetings went from 57.3 to 53.7 and enjoyed share went from 0.285 to 0.249. Seed 1 accounts for most of the drop (0.274 to 0.186). The likely causes are fewer reasons in probes (shareable facets only) and declined pairs that are not probed again. Seeds 2 and 3 are within noise.
- Everyone-yes on revealed proposals went from 225/280 (0.804) to 208/264 (0.788), pooled over the 3 seeds. An A/B on seed 1 isolates the cause: with the pair-decline rule (network-consent-5) off, the result is 72/90 (0.80). With the rule on, it is 56/76 (0.74). A pair that one side declined is no longer probed again until that side says yes. The floor in `network.test.ts` went from 0.80 to the new Wilson lower bound (0.73), as that test's own comment requires. The audit (matching-e2e-4) asks to gate on outcome metrics, not on accept rates.
- Engine order in `dailyRun` (matching-e2e-5) was tested and not kept. An A/B on seeds 1-3 compared the engine's own order with the score sort. With the engine order, enjoyed share was 0.194 (0.164 / 0.152 / 0.265). With the score sort, it was 0.249. The no-meeting share was 0.674 and 0.668, so the fairness gain was none. The score sort stays until a larger run (8 seeds, 42 days) decides.

## 5. Tests

- New: `test/classify.golden.test.ts` (corpora and parser gates) and `test/extract.test.ts` (LLM reader, with a fake model and no keys).
- New tests in `test/units.test.ts`: NET-01, -02 (a 200-case property test), -04, -10, -16, -21, -30, -31, -32, -46, -54, -63, network-service-1 and attention-MISSED-1.
- New tests in `test/flows.test.ts`: NET-05, -07, -08, -09, -11, -13, -15, -17, -18, -22, -23 (romance on slop), -24 (category scope property), -25, -26, -27, -39, -40, -44, -47, -48, -50, -51, -52, -60 and -66.
- Changed on purpose:
  - An attested adult who states "I am 12 years old" is now held for staff, not declined (network-service-1).
  - "sure, if the sun's out" and "no, Saturday works" are now `unclear`.
  - Teacher phrasing is no longer a minor signal.
  - The scenarios `scam_money` (watch, a staff case and no relay) and `corroborated_report` (strangers' reports open cases and add no points) now check the audit rules.
  - The traveler scenario counts only announced trips.
  - The reveal invariant for plans counts only the booked members.
  - The review-gate test accepts an item that closed in review before its SLA, for example when a participant went on watch. Nothing is sent either way.
  - The everyone-yes floor went to 0.73 (section 4).

## 6. Open

- The service must wire `understand: llmUnderstand(defaultLLM())`, `onAgeStated` (to `people.lowest_age` and the membership removal; NET-34 and NET-35) and `engineLLM`. This work does not own `packages/network/service`.
- The simulator (`packages/sim` StubNetwork and personas), the Observatory takeover and the engine experiments still use the simulator's own `parseYesNo`.
- The "smaller" plan fallback books two yes-sayers from a group plan as a pair, with no new one-to-one question (engine-attention-plans-10).
- These tests were not written: NET-36, NET-37, NET-42, NET-43, NET-45, NET-49 (property), NET-53 (load), NET-55, NET-57, NET-58, NET-59, NET-61, NET-62, NET-64, NET-65, NET-68, NET-69 to NET-71, and MQ-01 to MQ-07.
- The paraphrase corpus needs 50 or more lines for each want, and a held-out set by a second author.
- The probe-clarify text, the request-out-of-scope text, the watch reply and the unmatched-report reply are new member-facing copy. They need the CONTRIBUTING.md 3.5 videos.
