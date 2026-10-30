# Home-entry rule: solo help candidates passed a safety rule they should fail

## Defect

`packages/engine/src/packs/network/rules.ts`, `NETWORK_CANDIDATE_POST_RULES`
(`home_entry_rule`, the F14 rule): help that enters a home needs 2+ helpers, or
helpers who already met the requester. The check was:

```ts
const acquainted = helpers.every(h => w.edgeHas(requester, h, "met")
  || w.edgeHas(requester, h, "knows") || w.edgeHas(requester, h, "helped"));
if (helpers.length < 2 && !acquainted) return "home_entry_rule";
```

`Array.prototype.every` on an empty list is vacuously true, so a help candidate
with **no helpers at all** (only the requester) passed the rule and was marked
`medium` safety — the exact case the rule exists to block.

## Fix

Require at least one helper before the acquaintance check can pass:

```ts
const acquainted = helpers.length > 0 && helpers.every(h => ...);
```

Nothing else changes: 1 unacquainted helper is still rejected, 2+ helpers still
pass, 1 acquainted helper still passes, and non-home help is unaffected.

## Reachability (stated plainly)

Today's `helpRequest` generator requires `helpers.length >= need` with
`need >= 1`, so it never emits a solo help candidate. This defect bites the
post-rule's own contract: any caller that hands `candidateReason` a help
candidate with no helpers — a future generator, a hand-built candidate, or a
pack that reuses the rule — gets a false safety pass. The gate demonstrates it
at the direct `candidateReason` API, the same level PR 211's gate demonstrated
its contract defect.

## Evidence

Sim gate `scripts/sim/engine-home-entry.ts`, wired into the network block of
`bun run sim`:

- solo help + home-entry text → `home_entry_rule` (fails on upstream source,
  where `candidateReason` returns `null`; passes with the fix)
- 1 unacquainted helper + home-entry text → `home_entry_rule` (control)
- 2 helpers + home-entry text → passes, `safetyClass` `medium` (control)
- 1 acquainted (`met` edge) helper + home-entry text → passes (control)
- solo help + non-home text → passes (control)

Full validation: `bun run sim --only network` PASS (see PR body),
`bun run typecheck` pass, `bun run test:integration` and `bun run test:e2e`
same environment-limited results as the repo's other engine PRs (see PR body).
