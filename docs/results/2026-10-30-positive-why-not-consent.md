# Positive "why not" consent replies

Date: 2026-10-30

## Result

The Network read five ordinary affirmative replies as a refusal or an unclear
answer. The core reply parser and the Network consent reader now treat them as
yes:

- "why the hell not"
- "why the heck not"
- "I don't see why not"
- "I can't see why not"
- "I do not see why not"

This failure stopped a member who accepted an invitation from being counted as
available. A member who said "I can't see why not" is not making a refusal. The
word "not" belongs to the positive phrase.

## Cause

The core parser had positive idioms for "why not" and "why the hell not". It
did not cover "heck" or the "see why not" forms.

The Network reader scans refusals first. Its general negation checks saw the
"not" in "I don't see why not". Its "hell not" refusal rule also caught "why
the hell not". The core parser is the final consent veto, so both readers must
agree.

## Fix

Add the positive "why not" forms to the shared core parser.

Mask the same forms before the Network refusal scan. The mask changes only
these positive phrases. All other consent rules stay in their current order.

The new `every yes reply reads as yes` gate also prevents a later change from
silently turning an accepted invitation into a refusal.

## Reproduction

Command:

```bash
bun run sim --only evals --quick
```

Options used by the network corpus:

```text
a = Thursday 7pm
b = Saturday 11am
c = Sunday 2pm
```

Sample size: 327 Network consent rows and 189 core reply rows.

Before the fix:

```text
FAIL consent replies consent-replies.jsonl: every yes reply reads as yes:
why the hell not | why the heck not | I don't see why not |
I can't see why not | I do not see why not
26/27 blocking gates pass
```

The core corpus would also fail its zero-miss test on `why the heck not` and
`I can't see why not`.

After the fix:

```text
PASS consent replies consent-replies.jsonl: accuracy >= 97% (n 327): 100.0%
PASS consent replies consent-replies.jsonl: every yes reply reads as yes
PASS consent replies consent-heldout.jsonl: every yes reply reads as yes
PASS core replies (n 189): every row read as labelled
PASS: 27/27 blocking gates, 0 tracked off target
```

Direct controls:

```text
why the hell not              -> yes
why the heck not              -> yes
I don't see why not           -> yes
I can't see why not           -> yes
I do not see why not          -> yes
absolutely not                -> no
not this time                 -> no
why not, actually no          -> no
I don't see why not, but I can't -> no
```

## Verification

Linux x64 with Bash and PostgreSQL 16:

```text
bun run sim --quick
PASS: 301/301 blocking gates, 17 tracked gates off target

bun run typecheck
exit 0

bun run test:integration
681 pass, 8 skip, 0 fail

bun run test:e2e
42 pass, 1 skip, 0 fail
```

The eight integration skips need isolated PostgreSQL cleanup authority. The
one e2e skip is the optional browser feedback case.

The first Windows host run could not execute the Bash deploy guard or the
PostgreSQL suites. The Linux run above covers both. The full simulation still
exits 0 with tracked gates off target.

## Provider and model

No model was called. This result is deterministic and needs no API key.

Authoring provider: `custom`

Authoring model: `deepseek-v4.1-flash`

Client: Codex Desktop `0.166.0-alpha.5.1`

Request settings: not applicable. The parser makes no network request.

## Limits

The mask applies only to the reproduced positive "why not" forms. It does not
change conditions, hedges, counters, time restrictions or refusals.

The tests use the parser directly and the existing simulation corpus. No live
message was sent. No external agent client was tested because this change has
no client or MCP contract change.
