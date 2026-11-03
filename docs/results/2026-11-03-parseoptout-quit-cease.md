# parseOptOut misses the "quit"/"cease" stop verbs (2026-11-03)

Hand-written report. The numbers come from `bun run sim --only evals` (deterministic, no
model: the eval block clears the provider keys).

## Defect

`parseOptOut` (packages/core/src/replies.ts) is the conversational opt-out reading the inbound
path uses (AGENTS.md audit hand-off: "Use `parseOptOut` on the inbound path"). Its free-text
`LIKELY_EN` pattern accepted only `stop texting me` and dropped the `quit` and `cease` synonyms,
although every sibling reader in the same file treats them as stop verbs:

- `KEYWORDS.stop` includes `QUIT`;
- `EXACT_EN` includes `quit`;
- the carrier reading `optOutPhrase` uses `(?:stop|quit|cease) (?:texting|messaging|…)`.

So a member who answered `quit texting me` or `cease messaging me` was read as `none` (not an
opt-out), while the platform consent ledger (`detectKeyword`) and `optOutPhrase` both read the
same text as a STOP. A documented opt-out reader silently disagreeing with the carrier reading
on a plain opt-out phrase is a consent defect.

## Reproduction

```
$ bun -e 'import {parseOptOut} from "./packages/core/src/replies.ts"; \
  for (const t of ["quit texting me","cease messaging me"]) console.log(t, parseOptOut(t).match)'
quit texting me none          # before
cease messaging me none       # before
```

## Fix

`LIKELY_EN`: `stop (?:texting|…)` → `(?:stop|quit|cease) (?:texting|…)`, matching the carrier
`optOutPhrase` verb set. No new false positives: `quit` is still only an opt-out immediately
before a messaging verb, so `I quit my job today` and `quit peon` stay `none`/app-leave.

## Evidence

Added three rows to `evals/opt-out-parse.jsonl` (the gate `core parseOptOut: every row read as
labelled`): `quit texting me` → `likely`, `cease messaging me` → `likely`, and the negative
`I quit my job today` → `none`.

- Before: the two `likely` rows read as `none`; the gate fails.
- After: `bun run sim --only evals` → 25/25 blocking gates pass; `core parseOptOut (n 43)` passes.

Command and seeds: `bun run sim --only evals` (the eval block is seed-free; it reads the fixed
corpora). `bun run typecheck` (root project) passes.
