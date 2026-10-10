# MCP profile contact guard regression

## Reproduction

On `c29e330`, the ZIP exception admitted grouped phone numbers and OTPs through
the real Slop custom connection. HTTP submission returned success and Postgres stored the text.
Two five-digit phone groups and the six-digit code `12 34 56` reproduced the failure.
The latter also passed with mixed separators such as `12-34 56` in an initial fix.
All data and OTP providers were fictional; no model, real account or provider was used.

## Correction

The guard now checks the complete numeric run. It permits a standalone five-digit ZIP,
or one ordered age range with bounds from 1 to 120. Phone runs with at least seven digits
are refused even beside letters. Other standalone runs with at least four digits are refused.
Existing email rejection remains. Natural-language ZIP, age and distance fields
remain supported; ambiguous combined numeric runs are refused instead of guessed.
No new parser, provider, dependency or identity field was added.

## Evidence

The one new Postgres-backed HTTP E2E case fails before the correction and passes afterward:
one pass, zero failures, 25 assertions. It verifies seven refused formats produce zero profile writes,
and three valid profiles persist only to the authorized person's Slop member with status readback.
Three existing profile cases also pass with 70 assertions.
An independent review found the mixed-separator bypass and verified its correction.

Use Bun 1.4.2, `REQUIRE_PG=1`, the isolated Postgres port 54349 and this checkout's `runs/pg`.
The focused command is `bun test --conditions eliza-source --timeout 180000 tests/e2e/platform.e2e.test.ts -t 'split phone'`.
On the pre-upstream-resolution candidate, full integration passes 510 tests with zero failures
and 10,677 assertions in 108.08 seconds. Typechecks and plugin snapshot checks also pass.
An initial invocation used Bun 1.3.14 and failed Observatory reads. That log was preserved;
the explicit Bun 1.4.2 run passes every affected group. No product change was made for that runner issue.
The resolved combined-source E2E suite passes 35 tests, zero failures and 400 assertions
in 6.27 seconds. Final combined-source integration and hosted CI qualification follow in the PR.
No production deployment or live ChatGPT acceptance is implied by these results.
