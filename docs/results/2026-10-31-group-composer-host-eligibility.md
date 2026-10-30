# Group composer host eligibility and role coverage gates — 31 October 2026

The group composer (`packages/engine/src/group.ts`) performs beam search over eligible candidate pools to form small groups, optionally requiring a host (`opts.needHost = true`).

Previously, `evaluateGroup` and the seed sort only checked the static member flag `w.get(id)!.isHost`.
However, `host` is a contributor role (`CONTRIBUTOR_ROLES.has("host") === true`). A member with the `isHost` flag may be prohibited from hosting by member-level eligibility rules (`memberReason`):
- `state_receiving_contributor`: members in the `receiving` state cannot serve in contributor roles.
- `contribution_budget`: members who have reached their contribution limit.
- `category_quota` / `category_cooldown`: members subject to quota limits or cooldown declines in the category.
- `safety_hold`: members with active holds.

When a group containing such a member was evaluated:
1. `evaluateGroup` computed `hasHost = true` and `roleCoverage = 1`.
2. Beam search treated the group as having a valid host.
3. During role assignment (`roles` mapping), the member failed `memberReason` and was demoted to `"guest"`.
4. As a result, `composeGroup` returned a group where `roles` lacked a `"host"`, violating the `needHost` invariant and causing callers (such as `newcomerWelcome` in `generators.ts:511`) to drop the candidate entirely.

## Fix

In `packages/engine/src/group.ts`:
- Introduce a helper `canHost(w, id, opts)` checking both `w.get(id)?.isHost` and `!memberReason(w, id, { category: opts.category, role: "host", format: opts.format ?? "small_group", timeSensitive: false })`.
- Use `canHost` in `evaluateGroup` when computing `hasHost` and `roleCoverage`.
- Use `canHost` in seed ordering when `opts.needHost` is requested.
- Use `canHost` in role assignment.

## Verification

- `bun test packages/network/test/group-composer-host-gates.test.ts` (2 pass, 0 fail, 8 assertions).
- `bun run sim --only network --quick` (47/47 blocking gates pass).
- `bun run typecheck` (tsc pass).
