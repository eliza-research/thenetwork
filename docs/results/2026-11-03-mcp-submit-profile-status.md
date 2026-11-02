# submit_profile reports "not_joined" to an active member whose profile is refused

Date: 2026-11-03
Area: agent integration (MCP server, `packages/mcp`)
Type: bug fix (deterministic, offline; no LLM call)

## Problem

A member's own AI agent sends the member's profile with the `submit_profile` MCP
tool (founder decision 10). The handler in `packages/mcp/src/tools.ts` first reads
the member's public status, then calls the `submitProfile` hook.

When the member is `active` or `onboarding` but the hook answers `"not_member"`,
the handler returned a hardcoded `status: "not_joined"` and the join next step.
The sibling branch one line above (a stopped or held member) returns the member's
real status. So the two branches disagreed.

This case is reachable. `NetworkService.submitProfile`
(`packages/network/service/service.ts`) answers `"not_member"` for an active
member whose phone number is banned (`accounts.banned(e164)`). The status hook
(`packages/mcp/src/hooks.ts`) derives the status from the membership state only,
so it still reads `active`. The agent then told an active member "Not joined. To
join, open <join url> and sign up there."

## Fix

In `packages/mcp/src/tools.ts`, the refused-profile branch now returns the real
`status` variable and `NEXT[status]`, like the stopped/held branch directly above
it:

```
-      if (r !== "accepted") return { kind: "ok", data: { app: a.id, submitted: false, status: "not_joined", next_step: NEXT.not_joined(a) } };
+      if (r !== "accepted") return { kind: "ok", data: { app: a.id, submitted: false, status, next_step: NEXT[status](a) } };
```

The ban is not explained to an agent (hooks.ts policy); the member's real status
is reported with `submitted: false`.

## Other implementations considered

1. Re-read the status after the failed hook call. Extra round trip, and the hook
   answer (`"accepted" | "not_member"`) carries no status, so it still would not
   explain a ban. Rejected: more work, same result as trusting the status already
   read one line above.
2. Add a new `"banned"` public status. That would reveal a safety restriction to
   the agent, against the hooks.ts policy, and is a new wire field (out of scope).

## Evidence

Regression test: `packages/mcp/test/mcp.test.ts`, "an active member whose profile
is refused keeps the active status, not not_joined". It makes the `submitProfile`
hook answer `"not_member"` for an `active` member and asserts the response status.

```
bun test packages/mcp/test/mcp.test.ts -t "active member whose profile is refused"
```

| State | Result |
|---|---|
| Before fix | FAIL: status is `not_joined` (received), expected `active` |
| After fix | PASS |

Full file: `bun test packages/mcp/test/mcp.test.ts` -> 14 pass, 0 fail.
Schema check: `bun test packages/mcp/test/output-schemas.integration.test.ts` -> 2 pass.
`bun run typecheck` -> pass.

Offline test only; no model is called. Sample size and seeds do not apply.
</content>
</invoke>
