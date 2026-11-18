# 2026-11-18 — plain social handles after "is", "at" or a comma; common words after an app name

## Command

```
bun run sim --only evals     # same command, same data, before and after
bun run sim                  # full run, after the fix
bun run typecheck
bun run test:integration
bun run test:e2e
```

Seed: n/a (deterministic text parsing; no LLM). Provider/model: n/a (offline
guard). Request settings: none. Sample size: 236 `guard/leaks.jsonl` rows
(222 before).

## Problem

Two opposite defects in the leak guard's social-handle patterns
(`packages/core/src/guard.ts`), both around `HANDLE_VALUE`:

Missed contacts (fail-open):

- "my snap is mayaxyz", "my signal is maya", "my discord is mayaxyz": a
  plain-letter handle after app + "is" was not read. Only handles with an
  underscore, dot, digit or `#`, or a handle after `:`, `=` or `@`, were.
- "add me on snap, mayaxyz", "hit me up on ig, mayaxyz": a comma between the
  app and the handle broke the find-me-cue pattern (it required a space).
- "whatsapp me at mayaxyz", "snap me at maya_xyz": app + "me" + "at" + handle
  had no pattern at all.

False positives on benign text (fail-closed; the message is withheld):

- "find me on instagram and tiktok" read "and" as a handle.
- "add me on snap sometime", "find me on tiktok after work",
  "hmu on snap whenever you're free" read the common word as a handle.

## Before (upstream main, `ebf3e61f`)

| Text | Result |
|---|---|
| my snap is mayaxyz | no contact found |
| my signal is maya | no contact found |
| my discord is mayaxyz | no contact found |
| add me on snap, mayaxyz | no contact found |
| hit me up on ig, mayaxyz | no contact found |
| whatsapp me at mayaxyz | no contact found |
| snap me at maya_xyz | no contact found |
| find me on instagram and tiktok | contact:handle ("and") |
| add me on snap sometime | contact:handle ("sometime") |
| find me on tiktok after work | contact:handle ("after") |
| hmu on snap whenever you're free | contact:handle ("whenever") |

Evals gate on the new corpus rows (before the code fix): 11 of the 14 new
rows wrong in both directions.

```
FAIL leak guard (n 236): evasions caught, benign text clean:
  contact: "my snap is mayaxyz"; contact: "my signal is maya"; ... (7 rows)
  clean: "find me on instagram and tiktok" ... (4 rows)
```

## Cause

`HANDLE_VALUE` (the bare-handle shape used by the cue patterns) had a short
stop-word list (`a|an|the|me|my|...|later|too|now|today|...`), so every
ordinary 3-letter-plus word after an app name could pass as a handle. There
was no pattern for app + "is"/"at" + plain handle, and the find-me-cue
pattern required a single space between the app and the handle.

## Fix

Three changes in `CONTACT_PATTERNS`, all through `HANDLE_VALUE`:

1. A new pattern: app + optional "me" + "is"/"at" + handle ("my snap is
   mayaxyz", "whatsapp me at mayaxyz").
2. The find-me-cue pattern accepts a comma, semicolon or colon between the
   app and the handle (`[\s,;:]*`), with a `\b` after the app name so the
   handle cannot glue onto a longer app name ("insta" + "gram").
3. `HANDLE_VALUE`'s stop-word list gains the common words that follow an app
   name in ordinary sentences: connectors (and, or, but, then), time words
   (noon, midnight, morning, afternoon, evening, night, sometime, whenever,
   after, before, afterwards, again) and states (down, back, here, there,
   home, free).

## Other implementations considered

1. Require a separator that is never empty (the old single space, plus the
   comma set). Rejected: "hmu on snap:mayaxyz" (no space after the colon)
   would still be missed, and the empty case is what needs the `\b` guard,
   not a wider separator.
2. Add "is"/"at" connectors to the existing app-pattern (156) instead of a
   new pattern. Rejected: that pattern's bare-handle branch is guarded by a
   `[:=@]` lookbehind; widening it would read "whatsapp at noon" style text
   unless the stop-list grew in the same place, and the two changes would be
   harder to review apart.

## After (fix/guard-handle-connector-forms)

All 14 new rows read correctly. Guard rows that must stay clean:
"my instagram is private", "whatsapp me at noon", "my insta is down",
"find me on instagram and tiktok", "find me on insta or tiktok",
"add me on snap sometime", "find me on tiktok after work",
"hmu on snap whenever you're free", "find me on instagram whenever",
"I'm always on insta", "follow us on instagram", "my snapchat is the best",
"signal me when you're free", "whatsapp me later", "snap me tomorrow".

Unchanged: the 222 pre-existing corpus rows read the same, including
"find me on insta samlee", "hmu on snap samleee", "add sam.lee on snap",
"ig: samlee_nyc", "signal boost", "whatsapp group".

## Results

- `bun run sim --only evals` (new corpus rows, before the code fix):
  29/30 blocking gates — the leak-guard gate fails on 11 of the 14 new rows.
- `bun run sim --only evals` (after the fix): 30/30 blocking gates.
- `bun run sim` (full, after the fix): PASS, 365/365 blocking gates,
  15 tracked off target, 313.8s, exit 0. Dev Postgres up; the simulator used
  its standard `review: "auto"` reviewer.
- `bun run typecheck`: pass.
- `bun run test:integration`: 704 pass, 0 fail, 8 skip (182.78s). The same 8
  environment-gated skips are on unmodified main.
- `bun run test:e2e`: 42 pass, 0 fail, 1 skip (12.48s).
- Real-LLM evidence: N/A — the leak guard is deterministic (PRD 32.14) and
  never calls a model.
- Agent clients: N/A — no flow or transport change; the guard runs inside
  the send path and the model-input mask (`maskPii` reuses the same
  patterns, so the new forms are masked before any model call too).
- Vibespec: N/A — no spec or generated module changes; `spec/` is untouched.
