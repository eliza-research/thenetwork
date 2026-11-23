# Slop attendance evidence and booking overlap

The Slop simulator now keeps a missed encounter without assigning a no-show to either member before a check-in supplies that evidence. The previous simulation fed a private attendance draw back into matching as a known person's absence. Production keeps a member's qualifying check-in as the source for that attribution.

## Controlled comparison

Run `pnpm sim --only slop`. The pinned evaluation uses seeds 13–16, four weeks, and 300 personas per city in San Francisco, New York and Los Angeles. The world uses a 0.5% catfish share, body types, verification, the engine relay, three-day simulated review, widening and check-in. The Slop arm uses the rater and does not show probe photos. These cases use the recorded world and deterministic behavior. There are no model requests, so provider, model and request settings do not apply.

For the paired control, restore only the hidden `noShowBy` array in `resolveWeek` from the parent of `9d4370ba`. Run the same Slop arm and `gates3` aggregation. Use the same configuration for the repaired arm with that array removed. The simulation code and scenarios are hand-written. The encounter counts and ratios come from the seeded runs.

| Measure | Hidden attribution | Check-in evidence only |
| --- | ---: | ---: |
| Lowest rating quintile dates per member-month relative to all rated members | 0.845385× | 0.870218× |
| Lowest quintile dates, as counted in the gate | 121 | 127 |
| Lowest quintile member-months | 596.548 | 596.548 |
| All rated members' dates, as counted in the gate | 713 | 727 |
| All rated member-months | 2,971.692 | 2,971.692 |
| Declared minor contacts across the four runs | 0 | 0 |

The paired changes for the lowest quintile were 0, +4, +2 and 0 dates. Changes to the raw encounter counts across all members were 0, +7, +1 and 0. The four seeds are a fixed gate sample. The observed spread does not establish a population effect. The blocking requirement stays at 0.85×.

## Active booking check

The live simulation uses seeds 21–22. Seed 22 recorded `slop.nw-22-154` closing before the replacement `slop.nw-22-156` was reviewed and booked. The earlier booking still had a future scheduled time. The gate now removes the exact closed opportunity in recorded order and still fails if two different bookings for one member are active at once. Rescheduling the same opportunity updates its existing slot.
