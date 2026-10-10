# Slop custom ChatGPT entry correction

## Problem and change

The merged custom pilot is off by default and admits only approved adult accounts.
The Slop skill nevertheless told every OpenAI client to stop, even outside the public plugin.
An enabled, approved custom connection would therefore receive incorrect instructions.

Skill version 1.0.2 distinguishes the excluded public plugin from the private custom pilot.
It requires operator confirmation, person authorization and Slop status before collecting a profile.
Unavailable or unapproved connections must report unfinished onboarding.
The deployment guide names the existing flags and explains separate binding and grant rollback.
No runtime, account, permission or deployment setting changed.

## Validation

On base main `ba88f4c`, and after the skill correction:
`bun test --conditions eliza-source --timeout 120000 sites/test/sites.test.ts`
passes 70 tests, zero failures and 1141 assertions. It builds the four sites and exercises
their HTTP server, discovery files, exact prompt links and proxy contract.
`git diff --check` passes. No model, paid provider or real message was used.

A separate ignored harness journey on base `ba88f4c` uses real Postgres and HTTP with fictional OTP.
Both ordinary-agent and custom-ChatGPT connections retain the same person after number change.
The old site session is rejected; linked OAuth grants migrate to the new keyed number.
Reusing the old number creates a separate person, with zero profile writes crossing to that account.
Existing bearer, refresh, reconnection and original-member profile readback pass.
This validates local account continuity, not deployed OTP or hosted ChatGPT acceptance.

Full integration, E2E and simulation qualification of the pilot implementation is recorded in
`2026-10-09-chatgpt-custom-pilot.md`. Those suites were not repeated for this instruction-only change.
Live site deployment, real authorization and actual ChatGPT profile submission remain pending.
