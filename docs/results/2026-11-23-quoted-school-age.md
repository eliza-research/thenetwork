# Quoted school grades in Slop signup

PR #599 separates [age evidence from youth cues](../../spec/memberAge.md#quoted-age-evidence-does-not-change-the-sender). Slop's grade reader still used an allowed youth cue as numeric age evidence. A 29-year-old's Slop onboarding record changed to age 12 after they quoted their own earlier statement “I’m in 7th grade.”

The reader now calls the existing numeric-age guard before it estimates an age from a grade. The same quote still sets the youth flag and clears dating tags. A direct grade statement still estimates age 12. Dropping the quoted cue entirely would remove a safety signal. Changing how the app saves every age would reach beyond the grade reader and would leave the incorrect age in onboarding state.

The hand-written regression reproduced the age change in the Slop service onboarding hook at `c1aa0b16`. With the correction, all 27 cases in that integration file and all 112 blocking eval, onboarding, and relay gates passed. The same correction on the #581 combination passed 35 integration cases and 120 blocking gates. The checks ran with Node 26.13.0, pnpm 10.24.0, local PostgreSQL, and the existing pinned seeds. These readers are deterministic. The commands made no model calls.

```sh
REQUIRE_PG=1 node node_modules/vitest/vitest.mjs run --project integration packages/network/test/shared-agent.integration.test.ts
pnpm run sim --only evals,onboard,relay
```
