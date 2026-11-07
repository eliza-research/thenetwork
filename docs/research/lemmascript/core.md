# LemmaScript research: packages/core

Scope: every file in `packages/core/src`, including `svc/`. Tool: lsc 0.6.6, Dafny 4.11, through the throttled shim. No file in `packages/core` was changed. Trial files are in `/private/tmp/claude-501/-Users-nubs-thenetwork/71ebb7fb-9e02-4dbf-b300-9c31fec118b5/scratchpad/research/core/` (`t2` policy, `t3` quiet hours, `t4` parseReply decision core, `t4m1` and `t4m2` mutants, `t5` deadline and proof window, `t6` fence and rng, `t7` sliding window, `probe.ts` and `probe2.ts` behavior probes).

Summary of the result:

- Core has few proof targets, but they are the base of the safety rules. Four trial proofs passed: age predicates, parseReply decision core, quiet hours, deadline and proof window. Two further proofs passed: fence defang (a rewrite) and index bound.
- No shipping function in core verifies with a byte-identical body except `networkCollectionDeadline`. Every other target needs a small extraction, because the bodies use `unknown`, regex or `Intl`.
- The real risk in consent and opt-out text reading is in the regex tables, which LemmaScript cannot model. Bugs 1 and 2 below are in that layer. A proof of the decision core does not find or fix them. Corpus gates must do that.

## 1. Files reviewed

| File | Verdict | Why |
|---|---|---|
| `policy.ts` | EXTRACT core then prove | `age: unknown`, `typeof`, `Number.isFinite`: `lsc gen` fails. A numeric core proves. See C1. |
| `replies.ts` | EXTRACT core then prove | `parseReply` lines 217-253 are a pure decision over signals: proved after extraction (C2). `normalize`, `extract`, `parseOptOut`, `optOutPhrase`, `foldKeywordText`, `keywordKey` are regex or Unicode: not provable. |
| `guard.ts` | EXTRACT core then prove (one loop only) | The sliding window in `factMatches` is in the fragment after extraction (C6). `stem`, `grams` are in-fragment but low value. All else is regex, Unicode folding and a class with Maps: NOT APPLICABLE. |
| `fence.ts` | EXTRACT core then prove | `defang` is a regex replace. A character-loop rewrite proves "no three equal markers in a row" (C5). `nonceOf` uses `>>>` and `Math.imul`: no lowering. |
| `time.ts` | EXTRACT core then prove | The last line of `inQuietHours` is pure: proved after extraction (C3). `localParts`, `fromLocal` use `Intl` and `Date`: NOT APPLICABLE. |
| `rng.ts` | MODEL ONLY, low value | `>>>`, `Math.imul`, class state: no lowering. Only the index bound can be proved (C8). The sim replay checks cover the rest. |
| `stats.ts` | NOT APPLICABLE | `gini`: sort with comparator and reduce over reals. The bound proof is L effort for an eval metric. |
| `geo.ts` | NOT APPLICABLE | `Math.sin`, `cos`, `asin`, `sqrt` have no lowering. |
| `clock.ts` | NOT APPLICABLE | Interface, `Date.now`, and a small class with `Number.isFinite`. `SimClock` monotonic behavior is three lines. |
| `pii.ts` | NOT APPLICABLE | Regex only. |
| `llm.ts` | MODEL ONLY, low value | Network, `await`, `any`. `backoffMs` uses `**` (no lowering). `closingIndex` is in the fragment (not tried), but `JSON.parse` validates the result after it, so a proof adds little. `LLMBudget.take` could use an extracted predicate. |
| `chatJson.ts` | NOT APPLICABLE | Real `await` and callbacks. |
| `runlog.ts` | NOT APPLICABLE | Types and `JSON.parse`. |
| `network.ts` | NOT APPLICABLE | Types and one constant table. |
| `types.ts` | NOT APPLICABLE | Types, plus `isAppId(v: unknown)`, which is a `typeof` guard. LS can import these types into proofs. |
| `index.ts` | NOT APPLICABLE | Re-exports. |
| `svc/learning-collection-command.ts` | PROVE in place (one function) | `networkCollectionDeadline` proved with its body unchanged (C4). `parseNetworkCollectionScope`, `parseNetworkCollectionCommand`, `absoluteTime` use regex and `Date`: NOT APPLICABLE. Hash and serialize functions: no. |
| `svc/profile-review-owner.ts` | EXTRACT core then prove | `value: unknown`, regex. Only the time window (lines 51-53) is provable (C4). |
| `svc/profile-review-source.ts` | EXTRACT core then prove | The same, lines 66-68. |
| `svc/profile-review-disconnect.ts` | EXTRACT core then prove | The same, lines 49-52. |
| `svc/profile-review-withdrawal.ts` | EXTRACT core then prove | The same, lines 44-47. |
| `svc/learning-consent-context.ts` | EXTRACT core then prove | The same, lines 54-62, plus the `collectionExpiresAt` ordering. |
| `svc/network-delegation.ts` | NOT APPLICABLE | `unknown`, `Object.entries`, regex. Its time check mixes seconds and milliseconds on purpose (`issuedAt` is seconds, as in `platform/src/api.ts:436`), so it cannot share the C4 predicate. |
| `svc/contract.ts` | NOT APPLICABLE (pinned) | See "Pinned mirrors" below. |
| `svc/svc-auth.ts` | NOT APPLICABLE (pinned) | See "Pinned mirrors" below. Real `await`, WebCrypto, bit operators. |

### Pinned mirrors: `svc/contract.ts` and `svc/svc-auth.ts`

`packages/core/test/contract-mirror.test.ts` pins the SHA-256 of both files, and upstream elizaOS/eliza pins the same values. A `//@` comment changes the bytes, so the test fails. An extraction also changes the bytes. What this means:

- Nothing can be annotated or extracted in place. A change goes upstream first, with new pins on both sides, and it adds proof comments to a file that the Eliza side owns.
- A copy that production does not run is a shadow model, which the brief forbids.
- One clean option exists if a proof is wanted later: a generated overlay file. It holds the mirror plus only `//@` lines, and a check strips the `//@` lines and compares the SHA-256 with the pin. Then the proof covers the exact shipping bytes. I did not build this, and I do not recommend it now: the logic in these two files has low proof value.
- Blocks to any proof there: `parseNetworkRouteAuthorityV1` and `parseApprovedRelayPhotos` take `unknown` and use regex. `svcVerify` has real `await`. The one numeric rule in `svcVerify` is `Math.abs(now - ts) > 60`. In `parseApprovedRelayPhotos` it is lines 275-280.
- A caller can state a contract for these functions with `//@ extern` from a non-pinned file. That contract is trusted, not proved. Keep the mirror check and the security suite as the assurance for these two files.

## 2. Candidates ranked by value

All trial runs used `lsc check --backend=dafny`.

### C1. Age predicates (minors never matched). `policy.ts:15-24`. Effort S. Trial: 3 verified, 0 errors.

Property: `canBeMatched` is true only for ages from 18 to 120. `canJoin` is true only for ages from 13 to 120. Under 13 cannot join. Each reads the same bound.

Protects: "Minors (13-17) are never matched" and "Under 13 cannot join". At least 30 non-test files call these predicates.

In place failed: `ERROR: Dafny emission failed for 'validAge' in policy.ts: Unsupported Dafny method call: .isFinite() on unknown`. LS has no narrowing by `typeof` on `unknown` (SPEC: "`typeof` stays unsupported").

Recommended change, with the same behavior:

```ts
//@ verify
//@ ensures \result === (age >= 0 && age <= MAX_AGE)
export function ageInRange(age: number): boolean { //@ type age real
  return age >= 0 && age <= MAX_AGE; }
//@ verify
//@ ensures \result ==> age >= 18 && age <= 120
//@ ensures age < 18 ==> !\result
export function adultAge(age: number): boolean { //@ type age real
  return ageInRange(age) && age >= ADULT_AGE; }
// joinableAge the same with MIN_MEMBER_AGE.
export const validAge = (age: unknown): age is number => typeof age === "number" && ageInRange(age);
export const canJoin = (age: unknown): boolean => typeof age === "number" && joinableAge(age);
export const isMinor = (age: unknown): boolean => !(typeof age === "number" && adultAge(age));
```

Notes on what the proof covers:

- `Number.isFinite` can be removed with no change in behavior. In JavaScript `NaN >= 0` is false and `Infinity <= 120` is false, so the range check already rejects both. `probe.ts` showed the current results for NaN, Infinity, -1, 12.99, 17.999, "18", null, `[18]` and an object with `valueOf`.
- LS has no NaN. So "NaN fails closed" rests on the argument above, not on Dafny. State this in a comment.
- `number` is `int` by default. `//@ type age real` is needed so that 17.5 is covered. Without it the proof would say nothing about fractional ages. Note that `//@ type` in a function with an empty body was ignored (`age` came out as `int`), so a void lemma function fails to resolve.
- The `typeof` wrappers stay unproved, one line each. They need review, and the safety block of `bun run sim` runs them.
- The proof is not person-level. "The lowest age ever stated wins" is not in core: `effectiveAge` was removed. That property belongs to the platform and network reports.

### C2. parseReply decision core (consent only on yes). `replies.ts:217-253`. Effort M. Trial: 4 verified, 0 errors.

Property, for a signal list with a decisive signal, in strict position order: if the answer is "yes", then there is a yes signal, no "no" signal, no "unsure" signal, no counter signal, and every condition is a time condition.

```ts
//@ requires exists(d: nat, d < sig.length && isDecisive(sig[d].kind))
//@ requires forall(i: nat, forall(j: nat, i < j && j < sig.length ==> sig[i].at < sig[j].at))
//@ ensures \result.answer === "yes" ==> exists(i: nat, i < sig.length && sig[i].kind === "yes")
//@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length ==> sig[i].kind !== "no")
//@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length ==> sig[i].kind !== "counter")
//@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length ==> sig[i].kind !== "unsure")
//@ ensures \result.answer === "yes" ==> forall(i: nat, i < sig.length && sig[i].kind === "cond" ==> sig[i].condTime)
```

Trial file: `t4/decide.ts`. The extraction turns lines 217-253 into `decide(sig)`, with a loop that finds the first decisive signal, and `.some` in place of `.filter`, `.find`, `.at(-1)`. `CONTRAST.test` becomes an `//@ extern contrastBetween`. The caller keeps the `constraints` and `leaning` output. The trial returns only answer and reason, so the shipping extraction must carry them too.

Non-vacuous check: removing the `if (counter)` line gives a failed postcondition (`t4m1`). Restoring the shipped `.strong` test gives a failed postcondition (`t4m2`), see "Finding from the proof" in section 3.

Limits, which matter:

- Trust base: `extract()` and `normalize()`. The proof says nothing about whether a signal is correct. Bug 2 lives there.
- The reversal step (lines 196-198) runs before `decide`, so the claims are about the signals after a reversal. "No. Actually yes" is still "yes", by design.
- The emoji branch (lines 206-215) is outside `decide`. Extract it as a second small function if needed.
- **Main consent is not here.** The live probe, plan and crew path is `parseYesNo` in `packages/network/src/classify.ts`, with its own regex tables. There `parseReply` is only a veto (line 601). Direct callers of a parseReply "yes" are `packages/network/service/packs.ts:128` (radius widen) and `packages/engine/src/packs/slop/onboard.ts:93` (read-back confirm). The network report should treat `consentOf` the same way: extract its final ladder (lines 596-601).

### C3. Quiet hours window. `time.ts:37-41`. Effort S. Trial: 2 verified, 0 errors.

Property: `s === e` means no quiet hours. The non-wrapped window and the wrapped window read as expected. For `s !== e`, the window and its reverse are exact complements, so a wrapped window has no hole.

```ts
//@ ensures s === e ==> !\result
//@ ensures s < e ==> (\result === (s <= h && h < e))
//@ ensures s > e ==> (\result === (s <= h || h < e))
export function hourInWindow(h: number, s: number, e: number): boolean
// lemma: //@ requires s !== e   //@ ensures hourInWindow(h, s, e) !== hourInWindow(h, e, s)
```

`inQuietHours` calls `hourInWindow(localParts(ts, tz).hour, s, e)`. Protects quiet hours and the minor overnight rule in `packages/engine/src/attention.ts:270-272`. `localParts` stays trusted (`Intl`).

### C4. Time windows of the signed proofs and the collection deadline. Effort S. Trial: 2 verified, 0 errors.

`networkCollectionDeadline` (`svc/learning-collection-command.ts:65-69`) proved with its body unchanged, only `//@` lines added. `Number.isSafeInteger` became an uninterpreted axiom function, so nothing is assumed about its result:

```ts
//@ ensures \result !== undefined ==> turnReceivedAt > 0 && now >= turnReceivedAt
//@ ensures \result !== undefined ==> \result === turnReceivedAt + NETWORK_COLLECTION_RETENTION_MS && now < \result
```

`proofWindowOk(issuedAt, expiresAt, now, maxTtl)`: the same four comparisons appear in the five proof parsers (`profile-review-owner.ts:52-53`, `profile-review-source.ts:67-68`, `profile-review-disconnect.ts:51-52`, `profile-review-withdrawal.ts:46-47`, `learning-consent-context.ts:61-62`). Extract one shared predicate. This also removes repeated code.

```ts
//@ ensures \result ==> issuedAt <= now && now < expiresAt && expiresAt - issuedAt <= maxTtl
```

Protects: Google data collection consent lifetime, and replay limits on signed owner proofs. The `value: unknown` shape checks stay unproved. Each predicate is checked in the profile-suggestion integration tests.

Caution: arithmetic is unbounded in the model, so the proof does not cover values above 2^53. The `isSafeInteger` checks in the code cover the input range, and the `expiresAt` sum is checked again at runtime.

### C5. Fence defang (prompt injection). `fence.ts:21`. Effort S. Trial: 2 verified, 0 errors.

Property: the fenced body never has three equal `<` or `>` in a row, so it cannot close the fence. The trial replaces the regex with a character loop that adds a space before a third equal marker. The output differs from today's for marker runs only: `<<<` gives `<< <`, today `< < <`. The prompt cache changes for those inputs only. Trial file: `t6/fence.ts`, with `charCodeAt` in the spec because `text[i]` is a char and does not join with `string` in the generated Dafny.

This is a rewrite that the design must accept, not a pure extraction. It does not cover look-alike characters (`＜＜＜`, `<​<<`, shown by `probe.ts`). Those do not match the literal fence marker, so the claim stays true, but a model may read them as markers.

### C6. Fuzzy fact sliding window (leak check). `guard.ts:376-384`. Effort L. Trial: gen passes, check gives 2 expected errors, no spec written.

Property wanted: no false negative. If a window of `f.window` tokens holds at least `f.need` distinct wanted tokens, the function returns true. Extract `windowHit(tt, want, need, window)`.

Trial without a spec: `lsc gen` accepts the body, including Map and Set. `check` gives `index out of range` (needs `window >= 1`) and `element might not be in domain` (`counts.get(drop)!` needs the invariant that a dropped wanted token was counted). The full proof needs a count invariant over the window: `counts[k]` is the number of `k` in the window, and `distinct` is the size of the set of wanted tokens with count above 0. Expect a recursive count function and several lemmas.

By reading, the loop is correct today. Do this one only after C1 to C5. It is the only piece of the leak guard that LS can reach. The rest of the guard (regex, Unicode) stays with the corpus.

### C7. STOP reader ordering. Effort S, not tried.

`detectKeyword` is in `packages/platform/src/consent.ts:65`, which is outside this report. A ladder over booleans (stop-all word, stop word, phrase, start, help) can show that a stop reading always wins over START and HELP. That is easy and small. The bug is in the word lists, so do Bug 1 first.

### C8. Index bound for pick. `rng.ts:43`, `rng.ts:106`. Effort S, low value. Trial: 2 verified, 0 errors.

`0 <= u < 1`, `len > 0` gives `0 <= Math.floor(u * len) < len`. The bound on `next()` itself is not provable (bit operators). Skip unless a wave wants easy gains.

## 3. Bugs

Reproduce with `bun run <path>/probe.ts` and `probe2.ts` (scratchpad `research/core`). They need no database and send nothing.

### Bug 1 (high). Common STOP phrasings are not read as STOP on the production path.

`detectKeyword` (platform consent, used by `packages/network/service/service.ts:1049` and `inbox.ts`) returns undefined for: "STOP NOW", "stop now please", "STOP IT", "stop it", "stop this", "stop pls", "stop thanks", "stop thank you", "stop already", "please stop now", "STOPALL please", "i said stop", "quit it", "stop for now", "remove me from this", "you never stop texting me", "can't stop getting these texts, unsubscribe me".

Causes: the keyword sets match the whole message. `optOutPhrase` (`replies.ts:368`) needs an object such as "texting me". `NOT_OPT_OUT` (line 361) rejects the whole message on `can't stop` or `never stop`, even with "unsubscribe me" in the same message.

Effect: the person keeps getting proactive messages. `/internal/signals` opt_out signals wait for staff and do not act on their own (`service.ts:1957`). I found no other automatic free-text stop on this path, but I did not trace every branch of the inbound flow, so confirm this with the network report. The file comment in `replies.ts` claims the TCPA "reasonable means" rule, and the founder decision says STOP stops every app.

`parseOptOut` reads several of these correctly ("stop now", "please stop") as "likely". But see Bug 3.

Fix path (needs a maintainer decision on the phrases): accept a stop word followed by courtesy or urgency words. Add a failing case to `packages/sim/scenarios/` or an integration test first. `sim/src/channel.ts:21` has its own smaller reader, so the simulator cannot catch this.

### Bug 2 (medium). parseReply reads questions and non-answers as yes.

`parseReply` gives "yes" for: "yes?", "ok?", "are you sure?", "you sure?", "is that ok?", "sure about that?", "she said yes", "my sister said yes", "i will report you", "i will block you", "i can tell you're a bot", "what do you mean okay", "ok but i have a question", "yes who is this".

Causes: the strong yes rule matches `sure`, `ok`, `i will`, `i can` anywhere. A `?` is read only when no word decides (line 210).

Reach: the file header says "Anything it cannot read confidently is unsure". Live effect: "are you sure?" to the radius question widens the slop search to 25 miles (`packs.ts:128`), and it can confirm a read-back (`onboard.ts:93`). The main probe path has its own question check, so `consentOf` returns unclear for a question. I read that code but did not run it on these inputs. `packages/sim/src/agent/policy.ts:44` and `snapshot.ts:384` use `parseReply` in the simulator.

Fix path: a reply that ends in `?` and has no refusal is "unsure". Reported speech ("said yes") is "unsure". Add corpus rows that fail first.

### Bug 3 (medium). `parseOptOut` has no caller.

A repo grep over `packages`, `deploy` and `tests` finds `parseOptOut` only in `replies.ts`. CLAUDE.md decision 11 says to use it on the inbound path. So one of two things must happen: wire it, or remove it and correct the instruction. There are two readers of opt-out text with different answers: "stop now" is "likely" and `optOutPhrase` is false; "how do i stop these texts" is "none" and `optOutPhrase` is true.

It also has its own miss. Line 286 treats the member's own "i said stop" as reported speech, so it returns "none". Line 288 returns "none" for "stop for now" and "stop at once".

### Bug 4 (medium). Contact check bypass with an id prefix.

`isPhone` (`guard.ts:188-194`) drops a phone match after `#`, `id`, `ref`, `case`, `order`, `account` and similar. `findLeaks` returns nothing for "id 2125550102", "my id: 2125550102", "case 2125550102", "ref 2125550102", "account 2125550102", "order #2125550102". The relay path uses this check on member text (`packages/engine/src/relay.ts:354`), so a member can pass a phone number with one word in front. The `exact` list still catches a known number of that member.

Fix path: keep the exception only for digit counts that are not phone-shaped, or only in Network-written text. Add a relay corpus row. A change may raise false holds on order numbers in concierge text, so measure it.

### Bug 5 (low). `String(x)` validation accepts arrays.

`parseProfileReviewDisconnectRequest({ ..., operation: ["disconnect"], app: ["slop"] })` returns the object with arrays where the type says string (shown by `probe2.ts`). `String(["slop"])` is `"slop"`. The same pattern is at `profile-review-disconnect.ts:23-24`, `profile-review-withdrawal.ts:24` and `:48`, and `profile-review-owner.ts:29-33`. These bodies are signed, so only a trusted caller can send them. Fix: test `typeof` first, or use `includes(v as string)`. I did not check whether upstream has the same text, and these files are not in the hash pin.

### Finding from the proof (not a defect today).

`if (laterNo.some(s => s.strong))` (`replies.ts:246`) is always true when `laterNo` is not empty, because every "no" rule has `strong = true` and a negated yes sets it too. If a weak "no" rule is added, the "yes" answer becomes possible with a "no" in the text: `t4m2` fails on exactly this path. Drop the `.strong` test in the extraction, so the safe path needs no outside invariant.

### Small notes (no action needed)

- `km` gave no NaN on the two antipodal inputs tried. `clamp01(NaN)` returns NaN.
- `tryChatJson` with `attempts: 0` returns `{ ok: false, error: undefined }`.

## 4. Runtime guards

| Proved predicate | Replaces or backs up | What exercises the same code |
|---|---|---|
| `adultAge`, `joinableAge`, `ageInRange` | Become the body of `canBeMatched`, `isMinor`, `canJoin`, `validAge`. No new check needed, because every caller keeps its call. | `bun run sim --only safety` (minor contacts gate), and the slop, peon and friends blocks. |
| `decide` | Replaces lines 217-253 of `parseReply`. | `bun run sim --only onboard`, `--only network`; simulator persona reply reading (`sim/src/agent/policy.ts:44`). Bug 2 needs a corpus row. |
| `hourInWindow` | Replaces the last line of `inQuietHours`. | `bun run sim --only network`, `--only safety`; engine `attention.ts:270-272`. |
| `networkCollectionDeadline` | Annotation only. | `packages/network/test/profile-suggestions.integration.test.ts`. |
| `proofWindowOk` | Replaces the four repeated comparisons in five parsers. | `profile-suggestions`, `profile-suggestion-disconnect`, `profile-suggestion-withdrawal` integration tests. |
| `defang` | Replaces the regex in `fence.ts:21`. | `bun run sim --only evals` for prompts that use the fence. No dedicated test was found. |

The repo has no unit tests by policy, so a proof gate is the natural home for these small predicates. Run `lsc check` in CI on the changed files. A byte check of `.dfy.gen` against source (`lsc regen`) stops the proof from going stale.

## 5. What not to verify

- **Regex tables** (`RULES`, `CONTACT_PATTERNS`, `OPT_OUT_EN`, `normalize`, folding). LS has no regex and `//@ extern` makes them axioms, so a proof "about" them only restates the trust base. Bugs 1, 2 and 4 are all in this layer. Use adversarial corpus rows.
- **`LeakGuard.check` as a whole.** Unicode normalization, `\p{}` classes, a class with Maps. An `autohavoc` proof could show only control flow. The one fact it could give, "too long fails closed", is one line to read. The invariant "every outbound message goes through the check" is about callers: prove that in the network send path.
- **`unknown` shape parsers in `svc/`**, including the mirrors. Their job is the part LS cannot see: `typeof`, key sets, regex. Keep the integration and security suite tests.
- **`svcVerify`, `svcSign`.** Crypto and `await`. A proof with an extern HMAC would only restate the code. It is also pinned.
- **`Rng`, `EngineRng`, `hash32`, `fnv1a`, `nonceOf`, `labelHash`.** Bit operators have no faithful lowering: SPEC says `>>>` has none, and bitwise on `number` has no int32 wrap. A proof would describe another function. `bun run sim` pinned seeds cover replay.
- **`fromLocal`, `localParts`.** `Intl` time zone data. The logic is the DST correction, which depends on data the model lacks.
- **`llm.ts` retry loop, `chatJson.ts`.** I/O and `await`. Bounds are simple counters.
- **`gini`, `km`.** Eval and distance math with real functions.

Model limits to state in every proof report: `number` is an ideal integer or real, with no NaN, Infinity, -0 or 2^53 limit. Strings use Unicode scalars by default, not UTF-16 (`javascript-utf16` is opt-in). `split` is a trusted axiom. ASCII-only case conversion.

## Trial log

| Trial | Command | Result |
|---|---|---|
| `validAge` in place | `lsc gen` | Failed: `.isFinite() on unknown` |
| `t2/policy.ts` | `lsc check` | 3 verified, 0 errors |
| `t3/quiet.ts` | `lsc check` | 2 verified, 0 errors |
| `t4/decide.ts` | `lsc check` | 4 verified, 0 errors |
| `t4m1` (counter line removed) | `lsc check` | 3 verified, 1 error, as expected |
| `t4m2` (`.strong` test restored) | `lsc check` | 3 verified, 1 error, as expected |
| `t5/deadline.ts` | `lsc check` | 2 verified, 0 errors |
| `t6/fence.ts` | `lsc check` | 2 verified, 0 errors (first form with `text[i]` failed to resolve: char is not string) |
| `t6/rngcore.ts` | `lsc check` | 2 verified, 0 errors |
| `t7/win.ts`, no spec | `lsc check` | 0 verified, 2 errors, as listed in C6 |
