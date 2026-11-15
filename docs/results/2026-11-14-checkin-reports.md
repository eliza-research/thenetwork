# Separate direct denials from safety reports

On November 14, 2026, the same expanded check-in fixture failed
one blocking safety gate on current main. It now passes all 18
Safety gates. It covers harmless payment descriptions, direct
denials, reported speech with a correction, and actual harm or
payment demands. The staff safety integration passed nine tests.

Run `bun run sim --only safety` and the Postgres test at
`packages/network/test/service-safety.test.ts`. The inputs are
hand-written and the journeys use a fixed simulation clock. No
live message, provider call, or external agent client was used.
