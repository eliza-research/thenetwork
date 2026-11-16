# Text intake uses the youngest age and a full reply interval

On November 14, 2026, the deterministic Evals and PostgreSQL Safety
run passed 45 of 48 gates before these changes and 48 of 48 after.
New conditions cover ages in first-person descriptions, 30 answers to
the age question, and a photo notice across midnight UTC. The active
Postgres service also passed the signup and invite-only continuation
journey with 69 assertions. A 12-year-old self-description is declined
before membership. A two-message signup retains the first name when
the member replies with a spelled-out age.

Run `REQUIRE_PG=1 bun run sim --only evals,safety` and
`bun test --conditions eliza-source packages/network/test/service-apps.test.ts -t 'text joins'`.
Fixtures use a fixed clock, synthetic people, and no provider calls.
