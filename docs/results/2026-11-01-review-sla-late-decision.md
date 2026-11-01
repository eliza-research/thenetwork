# A review decision after the SLA deadline must expire, not approve

`ConsentNetwork.decide()` accepted a staff decision after `review.deadline` as long as no tick had run for the item: `advance()` was the only place the deadline was checked. A decision in that window ran `approvalCheck` and `begin()`, so the probes went out and the item was counted as approved instead of expired unsent (PRD 32.8). The window is real in production because ticks are once a minute per instance and `pg_try_advisory_lock` makes a saturated instance skip.

The fix checks the deadline first in `decide()` and runs the same expiry path; the expiry body moved to one private `expireReview()` shared with `advance()`.

## Case

`packages/network/test/service.test.ts`, "a review decision after the SLA deadline expires the item unsent instead of approving it": the production service and real Postgres, a member request queued for review, the clock set one minute past the item deadline with no tick, then `POST /review/:id {"decision":"approve"}`.

- command: `bun test packages/network/test/service.test.ts -t "after the SLA"`
- seed: fixed world in the test fixture (`START`, five members, no randomness)
- provider/model: no LLM calls (offline service, dry-run channel)
- request settings: `SimClock`, default 12 h review SLA, one reviewer token
- sample size: one item

Before: `{ ok: true }`, the probe path starts, `reviewExpired` stays 0. After: `{ ok: false, reason: "review_expired" }`, queue empty, no message for the opportunity, saved decision `expired`, one `reviewExpired` after the next tick, and the audit row records the refusal.

Full file: 6 pass. The suite also passes with `bun run test:integration` prerequisites (dev Postgres on 54339); the case is skipped without Postgres like the rest of the file.
