# The slop world on the real message path — 27 October 2026

The simulation covered the real message path for the shared line (`scripts/sim/pipeline.ts`)
over about five days. It did not cover the slop world for a full month
(`docs/mvp-gaps.md`, section 4.1). The missing block is now
`scripts/sim/pipeline-slop.ts`, registered as `pipeline-slop` in `scripts/sim.ts`.

The block sends 30 simulated days of slop.date through the same path as production:

- a signed `POST /webhooks/blooio` into `NetworkService`;
- the unit transaction and the persisted queue (`platform.outbound`);
- the `BlooioAdapter` to a fake provider that records every request;
- a throwaway Postgres database on the dev cluster (`:54339`);
- `SimClock` in place of `RealClock`.

Nothing leaves the machine. The fake provider has kind `sim`, the only kind the
adapter accepts with a live gate, and the block never sets a live flag. All phone
numbers are in the reserved range `+1 212 555 01xx`.

## What the world does

Twelve adults join by texting "slop" and "Name, age", answer the onboarding
questions in their own words, and are matched behind the human review queue.
A reviewer approves every item at the next tick, which is the worst case for the
rules. The daters answer probes, book Saturday dates, and give feedback.

The world also contains these cases:

1. The person cap across apps, through the production entry point
   (`service.capRefused` and `service.capRelease`): a proactive batch loses
   exactly the excess.
2. Quiet hours: a transactional row queued at 22:00 New York waits for 09:00.
3. STOP in the middle of a probe: the probe is already on the phone, and only
   compliance follows the STOP.
4. "leave slop" in the middle of a scheduled match: the member and their
   opportunities are gone, and only the confirmation follows.
5. A restart with a row waiting for the morning: a second service instance on
   the same database sends the row once, with the same idempotency key.
6. A ban in the middle of a relay thread: one relayed text passes, the next
   waits under a provider outage, staff ban the match, and the waiting text never
   reaches the banned member. This uses the signed `/internal/turn` and
   `/internal/relay` wire.
7. A minor joins, is welcomed, and is never probed, proposed to or made a
   participant.

A new stored network state starts with matching off. The block turns matching on
through the staff console route (`POST /apps/slop/matching`), as production does;
the network list only sets whether matching is allowed.

## Reproduction and verification

Base: `a0ed7bc`. Windows 11, Bun 1.4.2, PostgreSQL 16.10 on the dev cluster
(`:54339`), `USER=postgres`.

```sh
bun run sim --only pipeline,pipeline-slop
bun run typecheck
```

`pipeline` uses the shared line. `pipeline-slop` uses its own throwaway database
(`pipeline_sim_<pid>`), which it drops at the end.

## Result

Both blocks pass: 29 of 29 blocking gates, 0 tracked gates off target.

`pipeline-slop` (14 blocking gates):

- 30 simulated days ran, with signed webhooks in and the fake provider out.
- 0 lost outbound messages: every request the provider took is one delivered
  row, every delivered row was taken once, and `network.messages.status` agrees
  with `platform.outbound.status`.
- 0 duplicated outbound messages: one provider message per key, and no text goes
  twice to a phone within a minute.
- Every outbound row ends in a terminal status: nothing waits, sends, or sits
  accepted.
- Every probe had a review approval before it went, recorded through the staff
  review API with a time no later than the probe.
- No proactive or transactional send arrived outside 09:00-21:00 New York.
- The 22:00 transactional row was `deferred_quiet_hours`, and the same row was
  `delivered` after 09:00.
- No member received more proactive texts than the person cap in any 24 hours.
- The cap batch refused exactly the excess: one refused send, and the rest
  released.
- The probe was delivered before the STOP, and no non-compliance send followed
  the STOP.
- The member who left is absent from the stored state, their opportunities are
  gone, and no non-compliance send followed the leave.
- The minor is never probed, proposed to, or made a participant.
- The restart sent the waiting row once, in the morning, with the same key.
- The ban raced the waiting relay row: the row did not end `delivered`, and the
  banned member received nothing after the ban.
