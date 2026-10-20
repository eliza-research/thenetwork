# Preserve inferred facts when reading profile data

Codex performed this work under Nubs' approval for Network bug fixes. No production data or Google account was accessed.

## Problem

The database records a fact's provenance and review status. `facetOf` preserved its provenance but omitted the `inferred` flag.
The Network's known-profile consumer checks that flag before using unconfirmed guesses. A proposed inferred interest therefore counted as matching evidence.

This concerns PRD sections 9.3 and 32.5: source provenance and the profile knowledge model.

## Change

Set `inferred: true` when the stored provenance is `inferred`. Preserve the existing source and confirmation status.
No schema, endpoint, inference model, profile text, matching switch or Google integration changes.

## Reproduction

The regression uses real local Postgres, the normal snapshot loader and `ConsentNetwork.knownWantMet`.
One fictional member has a confirmed hiking interest. Another has a proposed hiking inference from a connected source.

| State of the second fact | Before | After |
| --- | --- | --- |
| Proposed, not confirmed | Shared-interest score 0.3, incorrect | Score 0 |
| Confirmed | Not reached after the failing assertion | Score 0.3 |
| Rejected | Not reached after the failing assertion | Score 0 |

Run the same regression before and after:

```sh
REQUIRE_PG=1 bun test --conditions eliza-source packages/network/test/crossapp.test.ts --test-name-pattern 'proposed inferred database interest'
```

The local run used Bun 1.4.2, Postgres 17, port 54427 and a dedicated temporary cluster.
The existing cross-app suite also passed: 3 tests, 101 assertions, no failures.
Type checking and plugin snapshot checking passed. Broader validation results are recorded with the pull request.

## Scope and alternatives

Changing only the consumer to check the provenance string would leave other consumers with incomplete facet data.
Removing all proposed facts from the snapshot would change the handling of observed facts and other review workflows.
The conversion fix restores the existing inferred-fact contract without making either broader policy change.

This is deterministic data conversion. No LLM, provider call, paid inference or live agent client was used for this regression.
The change does not prove Google ingestion, universal suggestion approval, Bay Area matching, or production acceptance.
