# slop.date onboarding: free-text understanding, read-back and the next question (2026-10-09)

This is the understanding side of critical path item 4 (docs/mvp-plan.md) and prototype P4: free text from a slop.date member becomes the slop facet tags that the engine reads (`packages/engine/src/packs/slop/profile.ts`). The member confirms a read-back, and the agent asks one question at a time until the hard fields are known. The network service owns the conversation loop. This report gives the design, the gate results and the integration notes for that service.

- Code: `packages/engine/src/packs/slop/extract.ts` (the rules, the profile, the tags, the optional LLM reader), `packages/engine/src/packs/slop/onboard.ts` (read-back, corrections, next question). Exports are in `packages/engine/src/packs/slop/index.ts`.
- Corpus: `evals/slop-onboarding/` (444 hand-written SMS rows, append-only).
- Gates: the `onboard` block of `bun run sim` (`scripts/sim/onboard.ts`), in the default run.
- LLM use: none for any number here. `bun run sim` clears the provider keys. The LLM arm runs only with `bun run sim --only onboard --llm`, and it was not run for this report.
- Not touched: `packages/network` (`classify.ts`, `extract.ts`, `service/packs.ts` were read only). They belong to another session.

## Result in brief

- **The corpus gates pass with the rules only.** Hard-field accuracy is 100% (296/296 fields, 156 rows). The held-out set is 100% (70/70) after five general fixes. It was 91.4% (64/70) at its first run, with 0 wrong values: every miss was a field left unset. There are 0 wrong gender or seeking parses, 0 guessed values on 67 ambiguous rows, 100% of teen ages caught (38/38), 0 adults read as minors (32), corrections and confirmations at 100% (45/45), and soft fields at 98.6% (71/72).
- **P4 passes in the sim: 89.7% of the hard fields are filled within 24 hours** (the target is 80% or more). 576 adult personas on seeds 13-14 took part. 79.3% of the personas filled all five hard fields. After 1, 3, 5 and 8 member messages, the fill rate is 47.5%, 68.4%, 85.3% and 89.7%. The median is 6 member messages. By field: gender 97.2%, seeking 95.1%, age range 89.4%, distance 85.8%, location 80.9%.
- **No wrong gender or seeking value survives a confirmation.** No hard value was wrong at the first read-back, and none was wrong after a "yes". 63.5% of the adults confirmed within 24 hours. The others did not reply in time, or a field was still missing.
- **Minors.** Every simulated minor who said an age is flagged (23 of 24; one never said an age), and none is matchable. A minor gets no dating question and no read-back. A stated age under 13 is declined, and the profile is cleared.
- **Read-backs leak nothing.** No read-back on a corpus row or in the sim states a sensitive fact or a field the member did not state.

## Commands

```bash
bun run sim --only onboard            # corpus gates + persona sim (seeds 13-14, 100 per city); about 15 s
bun run sim --only onboard --quick    # seed 13, 40 per city
bun run sim --only onboard --llm      # adds the LLM arm (tracked only; needs SURPLUS_API_KEY or OPENAI_API_KEY)
bun run sim                           # the whole validation run (onboard is in the default blocks)
```

## 1. Design

### 1.1 The onboarding profile (`SlopOnboarding`)

Each field is `{ value, confidence, evidence: { turn, start, end, text }, source: "rules" | "llm" }`. The evidence is the member's exact words: `turn` counts messages over the whole conversation, and `start` and `end` index that message. A field stays unset until words state it.

| Field | Values | Tags written (`slopOnboardTags`) |
|---|---|---|
| age | stated age; the lowest age ever stated wins | none (the age is a person-level fact the service keeps) |
| gender | `woman`, `man` or `nonbinary`: the coarse matching gender | `romance:is:<g>` |
| identity | `trans_woman`, `cis_man`, `genderqueer` and others; never read back | `slop:identity:<id>` (agent_private) |
| orientation | the stated label; never read back | `slop:orientation:<o>` (agent_private) |
| seeks | a set of genders | `romance:seeks:<g>` |
| ageRange | `[lo, hi]`, with `lo` at 18 or more | `romance:age:<lo>-<hi>` |
| distance | `city`, `radius` (miles) or `multi` (markets) | `slop:scope:*`, `slop:max_miles:*` (city and multi use 25, as `packs.ts` does) |
| location | a zip from the table, or a neighborhood that maps to one | `slop:zip:<zip>`, `slop:area:<name>` |
| goal | `casual`, `long_term` or `unsure` | `slop:goal:*` |
| values | smoking, drinking, has kids, wants kids, religion importance (0-3) | `slop:smoking:*` and the others |
| dealbreakers | the nine pack ids, or "none" | `slop:dealbreaker:*` (boundary) |
| interests, activities, free | interest vocabulary tags, first-date ideas, week slots | `<tag>`, `slop:activity:*`, `slop:free:*` |

`minor`, `declined`, `confirmed` and `matchable` are flags. `matchable` is true only for an adult (core `canBeMatched` on the lowest stated age) with all five hard fields set and confirmed.

### 1.2 Rules first, like `packages/network/src/classify.ts`

The reader works sentence by sentence on a length-preserving normal form (lower case, straight quotes, emoji replaced by spaces), so each span indexes the original text. It uses the same patterns as `classify.ts`:

- **Negation scope.** A negator up to four words earlier in the same clause cancels a value ("not into men", "no smokers" is a dealbreaker, "not looking for anything serious" is casual).
- **Self versus others.** Gender comes only from a first-person form ("I'm a ...", "woman, 29", "27f", "m4w", "trans woman here"). A sentence about someone else ("my friend said...", "she dates men") gives nothing.
- **Bare answers.** A bare answer ("30s", "5", "women", "a guy") is read only when the caller says which question it answers (`asked`). A bare singular ("a woman") is a seek only after the seeking question.
- **Age.** The rules follow `agesStated` in `classify.ts`. Numbers must end the clause like an age ("I'm 5'4", "15 minutes", "2 years sober" and "my 12 year old" are not ages). Teen signs without a number (high school, "I'm a minor") set `minor`. Only an explicit statement of an age under 13 declines.
- **Never guess.** These stay unset, and the next question asks again: "both", "a mix", "either", "around my age", "older than me", "close by", "walking distance", "20 minutes on the train", a borough or a city named as home ("brooklyn"), pronouns alone ("she/her"), "i'm trans", "i'm bi", "i'm pan", "queer", and "lesbian" without a gender.
- **Seeking from a label.** Seeking comes from a label only when the label settles it: a straight woman or man, a gay man, a lesbian woman. These get confidence 0.7, and the read-back confirms them. Bi, pan and queer are always asked (PRD 40.5: orientation is asked neutrally, never inferred).
- **Places.** Places use the pack's own zip table (`zips.ts`). The reader takes an exact neighborhood name from the table, or an alias (wburg, LES, UWS, bed stuy, LIC, weho, ktown...). It needs a home context ("I live in", "I'm in", a bare answer to the location question) and skips "work in", "used to live", "dinner in" and "20 minutes from". A name that is in two markets resolves only with the member's `market`. An unknown zip is kept with `known: false`, and the pack's `slop_zip` question asks again.
- **Free times.** Core has no slot parser (`replies.ts` only finds time words), so `extract.ts` maps days and parts of the day to the pack's nine `SLOTS`, with exceptions ("weeknights except mondays", "any night but monday") and busy clauses ("i work weekends so weeknights are best").
- **Messages build on each other.** A newer statement replaces the older one. "too", "also" or "as well" add to seeking. "no men" removes a gender. "smoking's fine actually" removes a dealbreaker. The age keeps the lowest value. A change to a hard field or to the age clears `confirmed`.

### 1.3 Read-back (`readBack`, `readBackFacts`)

The read-back is built only from fields with confidence 0.6 or more: gender, seeking, age range, distance and location, up to four interests or date ideas, the goal, and the dealbreakers. Example:

> so: you're a woman looking for men 28-38 within 5 mi of 11211, into climbing and dinner; dealbreakers: smoking. right?

It never states identity, orientation, the age, kids, faith, smoking or drinking habits, or anything with no evidence. It returns undefined for a minor or a declined person.

`applyCorrection(profile, text)` reads the reply the same way. A change ("no, 30-40", "actually women too", "10 miles not 5", "no 11222 not 11211") updates the field and leaves the profile unconfirmed, so the service reads back again. A yes with no change ("yep", "that's right", "perfect 👍") confirms. A "no" with nothing in it changes nothing and does not confirm.

### 1.4 Next question (`nextQuestion`)

The agent sends one question per message. The hard fields come first, in the order the engine needs them, and their texts are the pack's own asks (`SLOP_ASK_QUESTIONS`, so the reasons match `recentAsks`):

| Order | Reason | When |
|---|---|---|
| 1 | `slop_age` | no age yet (the service usually has it from the join) |
| 2 | `slop_orientation` (pack text) | gender and seeking both missing |
| 3 | `slop_seeks` / `slop_gender` | one of them is missing |
| 4 | `slop_age_range` (pack text) | no age range |
| 5 | `slop_distance` (pack text) | no distance |
| 6 | `slop_zip` (pack text) / `slop_location` | unknown zip / no place |
| 7 | `slop_basics` (pack text), then `slop_goal` | no goal and no dealbreaker answer |
| 8 | `slop_interests`, `slop_activities`, `slop_free` | soft fields |

Each question is asked at most twice (`MAX_ASKS_PER_QUESTION`, the same as the pack's `maxAsksPerField`). `markAsked` records each ask. A minor or a declined person gets no question.

### 1.5 Optional LLM reader

`extractSlopProfileLLM(messages, prior, { llm: { enabled, reader } })` runs the rules first. Then, only when `enabled` is true, it asks the reader about the fields that the rules left unset or below 0.75 confidence. Use `llmSlopReader(defaultLLM())` (gpt-6-luna through core `tryChatJson`, 2 attempts, fail closed). The reader works under these rules:

- The member's words go in a nonce-tagged block, and the prompt says to ignore instructions inside it. This is the same scheme as `network/src/extract.ts`.
- Each value must come with a quote that is in the message, and must be in the vocabulary. Anything else is rejected, and the rules reading stands.
- The reader fills only the fields it was asked about, with confidence 0.7 and `source: "llm"`. The read-back still confirms each value.
- An age that the LLM reads can only mark a minor. It never raises an age and never declines (a decline deletes data, so it needs an explicit rules form).
- The reader is never called for a minor or a declined person.

A scripted-reader gate in `bun run sim` (no model) checks these rules: the flag is off by default, quotes are required, the reader never overrides a confident rules value, and an LLM age only marks a minor. The live arm (`--llm`) reports the same corpus and a 20-per-city sim as tracked gates. Run it for P4's "rules only against rules plus the LLM reader" comparison, then add its numbers here.

## 2. Gates (`bun run sim --only onboard`, rules only)

| Gate | Blocking | Result |
|---|---|---|
| hard.jsonl accuracy >= 95% (156 rows, 296 fields) | yes | 100.0% |
| hard.jsonl: 0 wrong gender or seeking | yes | 0 |
| hard-heldout.jsonl accuracy >= 95% (40 rows, 70 fields) | yes | 100.0% (91.4% at first run, 0 wrong) |
| hard-heldout.jsonl: 0 wrong gender or seeking | yes | 0 |
| ambiguous.jsonl: 0 guessed values (67 rows) | yes | 0 |
| ages.jsonl: teen ages caught 100% (38) | yes | 100% |
| ages.jsonl: 0 adults read as minors (32) | yes | 0 |
| under 13 declined 100%, nobody else declined | yes | pass |
| stated ages read exactly | yes | pass |
| minors: never matchable, no dating question, no read-back | yes | pass |
| corrections.jsonl >= 95% (45) | yes | 100.0% |
| corrections: 0 wrong gender or seeking | yes | 0 |
| soft.jsonl >= 90% (66 rows, 72 fields) | yes | 98.6% |
| read-back: 0 sensitive or unstated facts, every corpus row | yes | 0 |
| LLM hook rules (scripted reader, no model) | yes | pass |
| sim: 0 wrong gender or seeking after confirmation | yes | 0 |
| sim: minors who said an age flagged, none matchable | yes | 23/23 flagged (24 minors), 0 matchable |
| sim: read-backs 0 sensitive or unstated | yes | 0 |
| P4: hard fields filled within 24 h >= 80% | tracked | 89.7% (79.3% of personas complete) |
| fill by field, wrong values at the first read-back, confirmed within 24 h | tracked | see the brief |

The read-back check has three parts. It looks for sensitive words (identity, orientation, the age, kids, faith, habits, race, immigration) outside the member's own dealbreaker list. It checks that each stated fact has evidence that is in the member's messages. On labelled rows, it checks that each fact is about a field the row labels.

Corpus files (`evals/slop-onboarding/`, 444 rows): `hard.jsonl` 156, `hard-heldout.jsonl` 40, `ambiguous.jsonl` 67, `ages.jsonl` 70, `corrections.jsonl` 45, `soft.jsonl` 66. The rows include slang ("lookin 4", "wburg", "m4w", "enbies"), typos ("wmn", "lookng", "womn"), emoji, queer and nonbinary phrasings (trans woman and man, genderqueer, agender, nb, "women and nb folks"), more than one gender ("men and women", "anyone 25-35", "all genders"), negations ("not into smokers", "no men", "not looking for anything serious"), inputs that must stay unset, teen ages in many forms with adult look-alikes ("I'm 5'4", "my son is 15", "I teach 10th grade"), and corrections. Do not delete a row to make a change pass: add the row that fails, then fix the rules.

**Fitting caveat.** The rules were tuned on `hard.jsonl` and the other files. `hard-heldout.jsonl` was written after the tuning and gave 91.4% (64/70) at its first run. Its six misses were all fields left unset, never a wrong value: "woman who likes women", "not picky about gender, anyone 30-45", "nb person here", a comma-separated "5 miles", and "both men and women". Five general fixes followed, so this file is no longer held out. The next held-out set must be written by someone else, or taken from P1 transcripts.

## 3. The onboarding sim

The sim uses slop personas from `generateSlopPersonas` (seeds 13 and 14, 100 per city, 6% minors). Each persona answers from its stated side, which is the slop world's truth for what a person tells the agent. The answers come from templates and a paraphrase bank (`scripts/sim/onboard.ts`, `Speaker`), with this noise:

- **Opening message.** It depends on the persona's richness tier, from "slop" alone to a paragraph with six fields.
- **Text variation.** Mixed case, "lol" or "tbh", emoji (12% each), a dropped letter in one word (6%), and non-answers ("idk", "lol why", "can we skip this one"; 7% of answers).
- **Orientation labels.** 25% of the time, a label replaces a list ("i'm bi", "straight guy", "lesbian woman"). Bi, pan and queer then need the seeking question, and the read-back catches a lesbian label from someone who also dates nonbinary people.
- **Replies.** Reply probability and latency come from the persona's `replyProb` and `latencyMedianMin`. An unanswered question is asked again once, after 6 hours. The horizon is 24 hours.
- **Read-back answers.** The persona compares the read-back with its truth. It corrects the first wrong hard field ("actually women too", "no, 30-40") or says yes. There are up to 3 read-backs.

One limit: the paraphrase bank is narrower than real text, so the 89.7% fill rate is an upper bound for the rules on real members. P1 transcripts should become corpus rows.

## 4. Integration notes for the network service (the conversation loop)

The service owns the conversation (PRD 32.3: either `llmUnderstand` or the Eliza agent, not both). Per inbound slop message, after STOP/HELP/leave and the minor check:

```ts
import { UNDER_MIN_AGE_DECLINE } from "@thenetwork/core";
import { extractSlopProfile, applyCorrection, readBack, nextQuestion, markAsked, hardComplete, slopOnboardTags } from "@thenetwork/engine/src/packs/slop/index.ts";

let p = load(memberId) ?? undefined;                     // persist SlopOnboarding as JSON per member (it is small)
const pending = lastOutbound(memberId);                  // { reason, field } of the last question, or "slop_readback"
p = pending?.reason === "slop_readback"
  ? applyCorrection(p!, body, { market: "nyc" })
  : extractSlopProfile([{ text: body, asked: pending?.field }], p, { market: "nyc" });
if (p.declined) { send(UNDER_MIN_AGE_DECLINE); deleteEverything(); return; }   // core policy: store nothing
if (p.minor) { setLowestAge(p.age?.value ?? 17); return minorFlow(); }       // never matched; no dating questions
const { tags, replaces } = slopOnboardTags(p);           // same shape as packs.ts learn(): AppTag-like {tag, kind, scope}
writeFacets(memberId, tags, replaces, { source: "chat", confidence: t => t.confidence, inferred: false, confirmedByMember: p.confirmed });
if (hardComplete(p) && !p.confirmed) return send(readBack(p)!, { reason: "slop_readback" });
const q = nextQuestion(p);
if (q) { p = markAsked(p, q.reason); send(q.text, { reason: q.reason }); recordAsk(memberId, q.reason); }
save(memberId, p);
```

- **Replacement.** This replaces `packs.ts` `learn()` and `askText()` for slop. The tag names and `replaces` prefixes are the same, so `slopProfiles` reads the result without a change. Record each question in `recentAsks` with its reason, so that the pack's silence fallback and ask caps keep working.
- **Age.** Age stays a person-level fact. Pass `p.age` to the person record with the lowest-age rule, and use core `canJoin`, `isMinor` and `canBeMatched`. Do not use the profile's flags as the only source.
- **Matching after confirmation.** Turn on matching for a member only when `p.matchable` is true. Until then, the pack's `needs_answer` rule holds them back anyway.
- **Market.** Pass `market` (the member's home city) so that a neighborhood name that exists in two markets resolves correctly.
- **The LLM reader.** To use it, call `extractSlopProfileLLM` with `{ llm: { enabled: true, reader: llmSlopReader(defaultLLM()) } }` behind a config flag. It adds one call per inbound message, only while hard fields are missing. Every outbound text (questions and read-backs) still goes through the leak guard.
- **Persistence.** Keep the `SlopOnboarding` JSON private to the agent. Its evidence spans hold the member's words.

## 5. Two other implementations considered

1. **Extend `packages/network/service/packs.ts` `parseOrientation` and its neighbors.** That code is in another session's package, and it has no evidence spans, confidences or ambiguity handling. For example, "bi" maps to men and women, "queer" to everyone, and "a mix" to everyone. Each of these guesses would fail the ambiguous gate.
2. **LLM first, with rules as a check.** This is simpler to write, but it costs a model call on every message, it is not deterministic in `bun run sim`, and it cannot be gated offline. Rules first, with the LLM only filling gaps, keeps the 0-wrong gates deterministic and makes the LLM optional (P4 compares both arms).
