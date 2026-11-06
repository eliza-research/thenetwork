# Leak guard: spoken double and triple

Date: 2026-11-06. Base: `a0ed7bc` (`upstream/main`). Hand-written: this file and the new rows in `evals/guard/leaks.jsonl`. Generated: the command output below.

The leak guard turns number words into digits (`two` → `2`). It left the words `double`, `triple` and Spanish `doble` in place. A phone number that uses those words did not match. The same number with every digit spoken one by one did match.

## Before (base guard, new corpus rows)

Command (Bun 1.4.2, no model, no seed): score `evals/guard/leaks.jsonl` with `findLeaks` from `a0ed7bc`.

```
BASE rows 142 miss 6
MISS contact "my cell is five five five double oh one two" []
MISS contact "text me at five five five double zero one two" []
MISS contact "call two one two triple five double oh one two" []
MISS contact "ring 212 triple 5 0102" []
MISS contact "call five five five double-oh one two" []
MISS contact "llamame al cinco cinco cinco doble cero uno dos" []
```

The four clean rows in the same note (`double feature`, `triple shot`, `seeing double`, `double it`) were not misses.

## After

Same file, same command, with `expandSpokenRepeats` in `contactVariants`: `rows 142 miss 0`.

`bun run sim --only evals` (Bun 1.4.2, no model, no seed): `PASS: 25/25 blocking gates, 0 tracked off target, 0.4s`. The leak gate is `leak guard (n 142): evasions caught, benign text clean`.
