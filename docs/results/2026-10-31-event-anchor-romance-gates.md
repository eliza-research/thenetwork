# Event anchor: disallow group composition for romance events and enforce canMeet on pairs

## Problem and root cause

In `@network/engine` (`packages/engine/src/packs/network/generators.ts`), the `eventAnchor` generator matches members to upcoming public events (Section 33.4).

Two issues were present in `eventAnchor`:

1. **Romance-category events incorrectly composed into groups**:
   At line 256:
   ```typescript
   if (got.length >= w.cfg.group.minSize) {
     const g = composeGroup(w, {
       pool: got.slice(0, w.cfg.group.poolSize).map(r => ({ id: r.id, affinity: r.sim })), category: ev.category,
       minSize: w.cfg.group.minSize, maxSize: Math.min(4, w.cfg.group.maxSize), window: { start: ev.start, end: ev.end },
       preferredCity: ev.city, requireCity: true, needHost: false, format: "event",
       beamWidth: w.cfg.group.beamWidth, minPairwise: w.cfg.group.minPairwise, alternates: w.cfg.group.alternates,
     });
     if (g) {
       out.push(makeCandidate({
         kind: "event_coattend", generator: "event_anchor", category: ev.category,
         participants: g.primary, ...
   ```
   According to the Network PRD and Network Ontology (`packages/engine/src/packs/network/ontology.ts`), the `romance` lane is strictly 1-on-1 pairs (`shipsAlone: true`, `neverInPlans: true`).
   Furthermore, rule `romance_group` in `packages/engine/src/packs/network/rules.ts:99` explicitly states:
   ```typescript
   // Romance is pairs-only (engine-pipeline-15): a romance-category event or theme never becomes a romance group.
   { id: "romance_group", check: (_w, c) => (c.category === "romance" && c.participants.length !== 2 ? "romance_group" : null) }
   ```
   When an event has `category: "romance"` and >= 3 matching attendees, `eventAnchor` ran the expensive `composeGroup` beam search, generated a candidate group of 3-4 people with `category: "romance"`, and pushed it into the candidate queue, where it was subsequently rejected by `romance_group` in `candidateReason`. This wasted computation and polluted funnel rejection metrics.

2. **Pairs generated without checking `w.canMeet([a.id, b.id])`**:
   At line 243-245:
   ```typescript
   for (let i = 0; i < top.length && pairs < 6; i++) for (let j = i + 1; j < top.length && pairs < 6; j++) {
     const a = top[i]!, b = top[j]!;
     if (pairReason(w, a.id, b.id, ev.category)) continue;
   ```
   Unlike other pair generators (`directPair`, `complementaryIntents`, `secondEncounter`, `expansion`, `intentToCapability`), `eventAnchor` did not verify `w.canMeet([a.id, b.id])` for co-attendance pairs before pushing them, allowing candidates between members who lack valid co-location/presence overlap in the opportunity window to consume top-K candidate slots.

## Fix

In `packages/engine/src/packs/network/generators.ts`:

1. **Guard `composeGroup` against romance-category events**:
   ```typescript
   if (ev.category !== "romance" && got.length >= w.cfg.group.minSize) {
     const g = composeGroup(w, ...);
   ```
   Events in the romance lane are strictly pairwise and never run group beam search or produce invalid group candidates.

2. **Enforce `w.canMeet([a.id, b.id])` on pairs**:
   ```typescript
   if (pairReason(w, a.id, b.id, ev.category) || !w.canMeet([a.id, b.id])) continue;
   ```

3. **Unit Tests**:
   Added `packages/network/test/event-anchor-romance-gates.test.ts` covering:
   - Romance-category events never generate group candidates even with >= 4 eligible attendees.
   - Non-romance events continue to generate both pairs and groups when >= 3 attendees match.
   - `canMeet` properly gates out pairs without mutual city presence.

## Verification

```sh
bun test packages/network/test/event-anchor-romance-gates.test.ts
bun run sim --only network --quick
bun run typecheck
```

Results:
- `packages/network/test/event-anchor-romance-gates.test.ts`: 3 pass, 0 fail, 18 expect assertions (53ms).
- `bun run sim --only network --quick`: 47/47 blocking gates pass (98.6s).
- `bun run typecheck`: exit 0 (100% clean).

Deterministic engine logic. Zero model calls. No UI or copy files changed.
