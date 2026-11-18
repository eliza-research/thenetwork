# `lookingFor` enrolled on a stray "all" (2026-11-01)

## Problem

A person who arrives with no keyword joins The Network, is asked "what are you
looking for?", and the service enrolls them in the apps they name
(`service.ts` `lookingFor(ev.text)` -> `enroll`, founder decision 2).

`lookingFor` (packages/platform/src/apps.ts) read a bare word `all` as a request
to join every app. "all" is a very common word, so answers that are not a request
to join dating and work were read as one:

| Answer | Before | Correct |
|---|---|---|
| `not interested at all` | friends, slop, peon | (none) |
| `just friends, that's all` | friends, slop, peon | friends |
| `I told all my friends about this` | friends, slop, peon | friends |
| `I don't want all apps` | friends, slop, peon | (none) |
| `not everything` | friends, slop, peon | (none) |

A second, related defect stayed after the first fix: the all-apps branch used a
raw `RegExp.test`, so it skipped the `want()` negation guard that every other
branch uses. A negated all-apps answer (`I don't want all apps`, `not
everything`, `dont want all of them`, `without all apps`) still enrolled the
person in all three apps.

The worst case enrolls a person in the adults-only dating app (slop) and in work
(peon) off a word like "at all" — the opposite of consent, and against founder
decision 1 (dating is explicit, adults only).

## Cause

```js
if (/ (all|all of (them|it|these)|everything|all three) /.test(t)) ...enroll every app
```

The leading `all|` alternative matches the bare word "all" anywhere in the answer.
The intent is "all apps" / "everything", not any sentence containing "all".

## Fix

Drop the bare `all` token; keep the explicit "every app" forms and add "all apps"
/ "all of the apps" so the legitimate intent still routes. Route the branch
through the shared `want()` helper (not a raw `RegExp.test`) so it obeys the same
negation guard as the friends/dating/work branches:

```js
if (want("all apps|all of (?:them|it|these|the apps)|everything|all three")) ...
```

## Evidence

A regression case was added to the `evals` block
(`scripts/sim/evals.ts`, "platform lookingFor"): "all apps" / "everything" / "all
three" / "all of them" still enroll in every app; "not interested at all" enrolls
in none; "just friends, that's all" enrolls in friends only; and the negated
all-apps forms ("I don't want all apps", "not everything", "dont want all of
them", "without all apps") enroll in none.

```
bun run sim --only evals
```

- Before the fix (source reverted, test kept):
  `FAIL platform lookingFor ... expected ["not interested at all",["friends","peon","slop"]] to equal ["not interested at all",[]]` — 25/26 gates.
- After the fix: `PASS platform lookingFor ...` — 26/26 blocking gates pass.

`bun run typecheck` passes. The table rows and the eval assertions are hand-written;
the gate output is generated. No model calls are involved (`lookingFor` is an
offline parser).

## Out of scope

`lookingFor` has two other weaknesses left untouched to keep this fix minimal: the
verb "love" ("I'd love to make friends") still pulls in dating, and a negation more
than two words from the want word ("not really interested in dating") is not caught.
Both are word-list / threshold tuning, not this bug.
