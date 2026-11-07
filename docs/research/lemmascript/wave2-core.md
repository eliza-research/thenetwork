# LemmaScript wave 2: packages/core

Date: 2026-11-07. Toolchain: lsc 0.6.6, Dafny 4.11. Hand-written. No LLM calls: the reply parser and the leak guard use no model.

## Functions proved

| File | Functions | `lsc check` | Production call site | Mutation result |
|---|---|---|---|---|
| `packages/core/src/policy.ts` | `ageInRange`, `joinableAge`, `adultAge` (already proved, kept) | 3 verified, 0 errors | `validAge`, `canJoin`, `isMinor`, `canBeMatched` | Wave 1 |
| `packages/core/src/reply-decision.ts` (new) | `decideReply`, `decideWithoutWords`, `isDecisive`, `verdict`, `lastInSentenceIsNo` | 4 verified, 0 errors | `parseReply` in `replies.ts`. The old inline ladder is gone. | 5 of 5 caught: no question check, no counter check, condition test inverted, `yes_no_conflict` gives yes, no question check in the emoji path. Each gives 3 verified, 1 error. |
| `packages/core/src/fence.ts` (in place) | `defang`, `splitAfter`, `tripleAt`, `isMarker` | 4 verified, 0 errors | `fenceUntrusted` | `splitAfter` always false gives 3 verified, 2 errors. See the note below. |
| `packages/core/src/time.ts` (in place) | `hourInWindow`, plus lemma `hourInWindow_complement` in the `.dfy` | 2 verified, 0 errors | `inQuietHours` | Wrapped window with `&&` gives 0 verified, 2 errors. |
| `packages/core/src/rng.ts` (in place) | `indexOf01` | 2 verified, 0 errors | `Rng.pick`, `EngineRng.int` | `Math.ceil` gives 1 verified, 1 error. |
| `packages/core/src/svc/proof-window.ts` (new) | `proofWindowOk`, `collectionExpiry` | 2 verified, 0 errors | The five proof parsers (`profile-review-owner`, `-source`, `-disconnect`, `-withdrawal`, `learning-consent-context`) and `networkCollectionDeadline` | `expiresAt < now` gives 1 verified, 1 error. `now <= expiresAt` gives 1 verified, 1 error. |
| `packages/core/src/fact-window.ts` (new) | `windowHit` | 17 verified, 0 errors | `factMatches` in `guard.ts`. The inline Map loop is gone. | Off-by-one on the drop gives 16 verified, 1 error. `distinct > need` gives 16 verified, 1 error. |

### What each proof says, and what it does not

- `decideReply`: an answer of "yes" means at least one yes signal, and no "no", "unsure" or counter signal anywhere, every condition is a time, and no yes signal is in a question. No precondition on signal order: the proof works by index, so the wave 1 `requires` on sorted positions is gone. **Not covered:** `extract()` and `normalize()`. A wrong regex gives a wrong signal. The `asked`, `bare`, `condTime` and `contrast` booleans are trusted inputs. The reversal step runs before `decideReply`. Main consent is `consentOf` in `packages/network/src/classify.ts`, where `parseReply` is only a veto on "no".
- `decideWithoutWords`: a yes from an emoji needs a yes emoji, no refusing or doubtful emoji, no counter, no condition, a short reply and no question mark.
- `defang`: the output never has three equal `<` or `>` in a row, so the body cannot hold the literal fence markers. The rewrite gives the same bytes as the old regex. **Note on force:** the spec is the safety claim, not the exact format. Removing only one of the two clauses of `splitAfter` still passes, because `< <<` is also safe. Exact bytes rest on a differential run: 500,000 random strings with markers, emoji and accents, 0 differences. **Not covered:** look-alike characters (`＜＜＜`), which do not match the literal marker. The model reads strings as Unicode scalars; JavaScript reads UTF-16. Markers are ASCII and each code unit is copied, so a surrogate pair stays whole, and the differential run included emoji.
- `hourInWindow`: `s === e` means no window, the normal and wrapped windows read as expected, and for `s !== e` a window and its reverse are exact complements. `localParts` (`Intl`) stays trusted.
- `indexOf01`: `0 <= u < 1` and `len > 0` give an index in range. The bound on `next()` itself has no proof (bit operators). `EngineRng.int` has no guard on `n`.
- `proofWindowOk`: exactly "issued, not expired, ordered, lifetime at most maxTtl". `collectionExpiry`: the deadline is the fixed turn time plus retention, and it is defined exactly while the turn is live. The `Number.isSafeInteger` checks stay in the callers, and the model has unbounded integers. The `unknown` shape checks stay unproved.
- `windowHit`: the result is true exactly when some window of at most `window` tokens that ends in the list holds at least `need` distinct wanted ids. This is both directions: no false negative (a missed leak) and no false positive. The `ensures` is in `proofs/.../fact-window.dfy`, with its spec functions. **Not covered:** the token folding, the stemming, and the map from word to id in `factMatches`.

Differential runs, old code against new (scripts in the scratchpad `research/core/`):

| Change | Inputs | Differences |
|---|---|---|
| `parseReply` | 4,075 distinct texts from `evals/` and `packages/sim/scenarios/` | 41: 35 yes to unsure, 6 unsure with a new reason. 0 changed toward yes or no. |
| `defang` | 500,000 random strings | 0 |
| `windowHit` | 300,000 random cases, 83,912 hits | 0 |
| `proofWindowOk`, `networkCollectionDeadline`, `inQuietHours` | 33,332 cases, including NaN, Infinity, 1.5 and values above 2^53 | 0 |

Of the 35 yes-to-unsure texts, the corpus rows are the intended ones. The rest are statements that the old rule read as yes through `i can` ("I can get you 20% monthly returns", "You'd better reply, I can see you read it"), and questions ("Did you get home ok?", "I'm a minor, is that ok?").

## Defects fixed

### Defect 12: `parseReply` reads questions and reported speech as yes

Before (28 rows appended to `evals/replies.jsonl`, 11 of them regressions guards that passed):

```
reply "yes?" yes want unsure
reply "Are you sure?" yes want unsure
reply "she said yes" yes want unsure
reply "i will report you" yes want unsure
reply "i can tell you're a bot" yes want unsure
reply "ok but i have a question" yes want unsure
... 17 rows in all
```

After: 212 of 212 rows.

The fix has four parts:

1. `extract` sets `asked` on a yes word in a sentence that ends in `?`, and `decideReply` gives "unsure" for it, so that part is under the proof. "Why not?" stays a yes (an idiom). A detail question after the yes stays a yes ("yes, where?", "ok what time?").
2. A reported-speech rule: "she said yes", "he said ok", "they told me yes". "i said yes" and "we said yes" stay a yes.
3. New hedges: "are you sure", "you sure", "what do you mean", "i have a question", "who is this".
4. "i can" and "i will" answer only alone or before a verb of showing up.

Effect on recall: "I can bring wine" was a yes and is now unsure, so the caller asks again. This fails closed.

### Defect 13: `isPhone` lets a labelled number pass

Before (12 rows appended to `evals/guard/leaks.jsonl`):

```
guard contact "id 2125550102" []
guard contact "my id: 2125550102" []
guard contact "case 2125550102" []
guard contact "account 2125550102" []
guard contact "order #2125550102" []
guard contact "#2125550102" []
guard contact "ticket 12125550102" []
guard contact "id +44 7911 123456" []
```

After: 144 of 144 rows.

A label word now excuses a number only when the number cannot be dialed: not `+`, and not a North American number (10 digits, or 11 with a leading 1, area code and exchange starting 2-9).

**Residual, stated plainly:**

- A seven-digit number after a label stays excused ("id 5550102"). The corpus keeps "Booking ref 555-0102" clean and the shape does not tell them apart.
- A foreign number with no `+` after a label stays excused ("id 447911123456").
- A real order number that is NANP-shaped ("order #2125550102") is now held. This is the cost of the fix. Measured: 0 false holds in the guard corpus (144 rows), and the relay (60/60) and safety (17/17) blocks pass. This does not measure live concierge text with real order numbers: the corpus has few of them.

Row correction: my first draft of the row "Booking ref 2105550102" was wrong (210 555 is a valid number). I changed it to 2100550102 in the same session, before any other run.

## `parseOptOut`: who should call it (no change made)

`parseOptOut` has no production caller. Only `scripts/sim/evals.ts` calls it. CLAUDE.md decision 11 says to use it on the inbound path.

**The seam is `NetworkService.inbound()`, `packages/network/service/service.ts:1065`, directly after `platformKeyword(ev.text)` and `leaveTarget` at line 1095.** `packages/network/service/inbox.ts:39,41` reads the same `detectKeyword`, so a change inside `detectKeyword` (`packages/platform/src/consent.ts:81`) would cover both seams.

**Do not wire "likely" as a hard STOP.** I measured it on the hand corpus (`evals/opt-out.jsonl`, with `leaveTarget` first):

| Measure | Result |
|---|---|
| `not_stop` rows that `parseOptOut` reads as an opt-out | 11 of 35: "stop it you're making me laugh", "para mañana a las 7", "bus stop pls send the address", "please don't unsubscribe me" |
| Stop rows that `parseOptOut` misses | 15 of 94: "remove my number", "never text me again", "denme de baja por favor" |
| Member replies newly read as opt-out | 1 of 534: "para nada" |
| Real opt-outs it adds over `detectKeyword` | "remove me from this", "don't text", "stop sending", "no me escribas", "para ya", "i want to stop" |

`match: "exact"` adds nothing over `detectKeyword`. `scope` is wrong for "unsubscribe from peon": `parseOptOut` gives scope "all" and `leaveTarget` gives peon, so `leaveTarget` must run first.

The two file comments disagree: the `replies.ts` header says the caller honors a "likely", and the comment above `OPT_OUT_EN` says the agent should confirm it. This is a product decision, so I did not guess. The options:

1. On "likely", when `detectKeyword` and `leaveTarget` are both undefined, return a handled turn that asks "Do you want to stop? Reply STOP". This needs new copy.
2. Pass "likely" to Eliza as a signal in the open turn context.
3. Remove `parseOptOut` and correct decision 11. Move its extra phrases into `optOutPhrase`, with corpus rows.

## Tests and sims

| Run | Result |
|---|---|
| `lsc check` on all 7 files | 0 errors each (counts in the first table) |
| `heavy bunx tsc --noEmit -p .` | 0 errors in `packages/core`. 2 errors in the whole tree, both in `packages/engine/test/selection-guard.integration.test.ts` (not this area). |
| `bun run sim --only evals` | 25/25 |
| `bun run sim --only onboard` | 19/19, 1 tracked off target |
| `bun run sim --only safety` | 17/17 |
| `bun run sim --only relay` | 60/60, 4 tracked off target |
| `bun run sim --only slop` | 40/40, 8 tracked off target |
| `bun run sim --only network`, shared worktree | **60/61. FAIL:** "trust: no honest member is flagged" (`nyc-g2-0001`, an honest member, has an abuse log). |
| `bun run sim --only network`, HEAD a0ed7bc plus only `packages/core/src` and the two corpus files, in a scratch copy | 61/61 |
| `profile-suggestions.integration.test.ts` | 51 pass, 0 fail |
| `profile-suggestion-disconnect.integration.test.ts` | 4 pass, 0 fail |
| `profile-suggestion-withdrawal.integration.test.ts` | 4 pass, 0 fail |

The network failure does not come from the core changes alone: the same block passes with them on the committed tree. It appears only with the other in-progress areas in the worktree, which change `packages/network/src` (`classify.ts`, `trust.ts`, and others). I did not find the cause. An interaction with the `parseReply` change is not excluded: a changed reply can move a seeded run onto a different message. The coordinator must rerun the block when the areas settle.

The `formal` block was not run by this area. `lsc check` ran on each file directly.

## Trust counts

Added by this area: assume 0, havoc 0, extern 0, axiom 0. The wave 1 plan for `decideReply` had one `//@ extern` (`contrastBetween`), and `collectionExpiry` had one (`Number.isSafeInteger`). I removed both: the first is now the `contrast` input, the second stays in the caller.

## Skipped, with reasons

| Item | Reason |
|---|---|
| C7 `detectKeyword` ladder | `packages/platform/src/consent.ts`, not in this area. |
| Bug 5, `String(x)` accepts arrays (`profile-review-disconnect.ts:23-24`, `-withdrawal.ts:24,48`, `-owner.ts:29-33`) | A fix is one line each, but the failing case must go in a `packages/network/test/` file that the service agent owns. Bodies are signed, so only a trusted caller reaches it. See "Changes needed". |
| `validAge` and friends' `typeof` wrappers | Out of the fragment, one line each. |
| `rng` `next`, `hash32`, `nonceOf`, `gini`, `km`, `fromLocal`, `localParts`, `svcVerify`, `chatJson`, `llm` retry | Bit operators, `Intl`, real math or `await` (core.md section 5). |
| `llm.ts` `closingIndex`, `LLMBudget.take` | Low value: `JSON.parse` validates after `closingIndex`, and the budget is a simple counter. |
| `svc/contract.ts`, `svc/svc-auth.ts` | Byte-pinned. Not touched. |

## Changes needed in files I do not own

- `packages/engine/src/packs/slop/onboard.ts:93`: the read-back regex `^\s*(?:right|correct|...|yup|yep|ya|ye|100|👍)\b` still confirms "yep?" and "ya?". The `parseReply` fix does not reach it. The same line as defect 10.
- `packages/network/test/`: add a case for bug 5, then I or the service agent can fix the `String(x)` checks.
- `proofs/trust.json`: no change needed from this area.
- If the Eliza side copies the `svc/profile-review-*.ts` or `learning-*.ts` files, it now needs `svc/proof-window.ts` too. They are not in the hash pin.
