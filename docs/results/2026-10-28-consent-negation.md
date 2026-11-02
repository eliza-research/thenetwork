# Consent negation correction

Date: 2026-10-28. Base: PR #167, `b695b3f3ddfb125460acc22dee10555db8ebeffd`.

The PR cancelled bookings for requests such as "Yes, please don't cancel".
This change reads negated withdrawal phrases as unclear. It preserves explicit refusals.
Standalone "please do not" accepts sentence punctuation.
Requests not to arrange a meeting or send an introduction still refuse the connection.

## Verification

Runtime: Bun 1.4.2. Dependencies installed with `bun install --frozen-lockfile --ignore-scripts`.

| Check | PR head | Corrected version |
| --- | --- | --- |
| Updated consent corpus | 328/329 | 329/329 |
| Unchanged held-out corpus | 75/75 | 75/75 |
| `bun run sim --only evals` | 25/25 | 25/25 |

`bun run typecheck` passed for the root, sites, Observatory and Cloudflare configurations.
The added corpus row fails on the PR head and passes after this change.

Local review harness: 36 parser cases and 35 complete in-memory booking scenarios passed.
Cases include punctuation, genuine refusals, negated withdrawal, mixed replies and unrelated negation.
Synthetic adults use the real Mini/ConsentNetwork flow with a simulated auto reviewer and recording channels.
"Yes, do not deal me out" now retains the booking.
"Please do not!" and "Please do not arrange this meeting" cancel it.

The first local attempt missed those cases. Moving the generic refusal scan also briefly broke "no can do".
The final scan reads all overlapping patterns against the same masked text, restoring that corpus case.

## Scope and alternatives

An exact-string exception would miss punctuation and wording variations.
A blanket unclear result for every "please don't" request would ignore clear refusals in booked conversations.
The chosen rules distinguish withdrawal phrases from requests not to arrange the connection.

This remains a bounded deterministic parser, not a general language-understanding solution.
Unclear booked replies retain the meeting without a reply. The existing mixed-answer policy is unchanged.
Full integration/e2e and real-model runs were not performed. Model calls: zero; provider cost: zero.
The change does not modify the conversation UI or call external messaging providers.
