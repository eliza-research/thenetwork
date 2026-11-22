# 2026-11-15 — the "15 y.o." age form reads as a minor

## Command

```
node --import tsx --env-file-if-exists=.env --conditions eliza-source scripts/sim.ts --only evals
node_modules/.bin/tsc --noEmit -p .
```

Seed: n/a (deterministic, no LLM). Provider/model: n/a (offline parser gate). Request settings: none. Sample size: 259 teen-age corpus rows (252 + 7 appended), 31 blocking eval gates.

## Before (vibestack, `f662eda0`)

| Message | `statedAge` | `minorSignal` |
|---|---|---|
| I'm 15 y.o. | none | false |
| im 15 y.o. | none | false |
| I'm 15 y.o., nyc | none | false |
| I'm 15 y.o. I live in nyc | none | false |
| I'm 25 y.o. | none | false |

(The `main` baseline at `ebf3e61f` carries the identical `sentencesOf` regex, so the same readings hold there.)

## After (fix/network-y-o-age-form)

| Message | `statedAge` | `minorSignal` |
|---|---|---|
| I'm 15 y.o. | 15 | true |
| im 15 y.o. | 15 | true |
| I'm 15 y.o., nyc | 15 | true |
| I'm 15 y.o. I live in nyc | 15 | true |
| I'm 25 y.o. | 25 | false |
| I'm 30 y.o. I live in Queens | 30 | false |
| my teacher is so mean.i have a math test tomorrow | — | true |

Unchanged: "I'm 30. I'm 15." → 15, "I am 40 years old. I am 12 years old." → 12,
"Rae. I am 30 years old. I am 15." → 15, "I'm 25 y.o." → adult, "I'm 4 years sober" → no age,
consent replies (yes / no / no thanks / ok fine yes / mixed / conditional) all read the same.

## Fix

`sentencesOf` split on every period, so "15 y.o." became the two sentences "15 y." and "o.",
and the `y.o` age form (already declared by the `YEARS_OLD` regex) was never reached. It now
splits at real sentence punctuation (`! ? ; .` and newlines) but not inside a single-letter
period — the `y.o` / `e.g` shape — so a real sentence boundary like `word.word` still splits
while the abbreviation stays whole. The earlier `bun:test` unit test was dropped; the repo runs
vitest and the sim's evals gate covers this path.

## Results

- `sim --only evals`: 31/31 blocking gates pass; teen ages recall 100.0% (n 259),
  0 adults (or teachers) read as minors; stated ages correct; abuse recall 100.0%, wrong kind 0%.
- Counterfactual: with the vibestack baseline splitter, the `y.o` rows fail the "stated ages"
  gate (`"I'm 15 y.o." -> none (want 15)`), confirming the appended rows are the proof, not vacuous.
- `tsc --noEmit -p .`: `packages/network/src/classify.ts` is clean. The only local errors are in
  `tools/vibestack` (a separate tool whose own dependencies this workspace does not install);
  they are pre-existing and unrelated to this change.
- Real-LLM evidence: N/A — the fix and its gate are in the deterministic offline parser
  (`classify.ts`), which by design (PRD 32.14) never depends on a model.
- Agent clients: N/A — no flow or transport change.
- Logs/video: N/A — single-function classifier, covered by the sim's evals gate.
- Vibespec: N/A — no spec or generated-module change; the rule the code already declared
  (the `YEARS_OLD` form `y\.?/?o\.?`) is now actually reached.
