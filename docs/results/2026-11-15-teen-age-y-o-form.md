# 2026-11-15 — the "15 y.o." age form reads as a minor

## Command

```
bun run sim --quick        # and: bun run sim (full)
bun test --conditions eliza-source packages/network/test/classify-age.test.ts
bun run typecheck
```

Seed: n/a (deterministic, no LLM). Provider/model: n/a (offline parser gate). Request settings: none. Sample size: 258 teen-age corpus rows (252 + 6 appended), 298 blocking sim gates.

## Before (upstream main, `ebf3e61f`)

| Message | `statedAge` | `minorSignal` |
|---|---|---|
| I'm 15 y.o. | none | false |
| im 15 y.o. | none | false |
| I'm 15 y.o., nyc | none | false |
| I'm 15 y.o. I live in nyc | none | false |

## After (fix/network-y-o-age-form)

| Message | `statedAge` | `explicitAge` | `minorSignal` |
|---|---|---|---|
| I'm 15 y.o. | 15 | 15 | true |
| im 15 y.o. | 15 | 15 | true |
| I'm 15 y.o., nyc | 15 | 15 | true |
| I'm 15 y.o. I live in nyc | 15 | 15 | true |
| I'm 25 y.o. | 25 | 25 | false |
| I'm 30 y.o. I live in Queens | 30 | 30 | false |

Unchanged: "I'm 30. I'm 15." → 15, "I am 40 years old. I am 12 years old." → 12,
"Rae. I am 30 years old. I am 15." → 15, "I'm 25 y.o." → adult, "I'm 4 years sober" → no age,
consent replies (yes / no / no thanks / ok fine yes / mixed / conditional) all read the same.

## Results

- `bun run sim --quick`: 298/298 blocking gates pass; teen ages recall 100.0% (n 258), 0 adults read as minors.
- `bun run sim` (full): see PR description (exit 0, blocking gates pass).
- `bun run typecheck`: pass.
- `bun test ... classify-age.test.ts`: 7 pass, 0 fail.
- Real-LLM evidence: N/A — the fix and its gate are in the deterministic offline parser (`classify.ts`), which by design (PRD 32.14) never depends on a model.
- Agent clients: N/A — no flow or transport change.
- Logs/video: N/A — single-function classifier, covered by the unit test and the sim's evals gate.
- Vibespec: N/A — no spec or generated-module change; the rule the code already declared (the `YEARS_OLD` form `y\.?/?o\.?`) is now actually reached.
