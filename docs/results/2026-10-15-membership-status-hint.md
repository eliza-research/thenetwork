# Confirm membership without promising delivery

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-15-membership-status-hint.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Attribution: Automated. Codex made this fix under the user's project approval.
Base: `4ecfd9aa76efbde011da01826669661bbcd02e1a`.
Scope: PRD 28.3 agent-first onboarding and the existing `check_status` contract.

## Problem

The active-member hint said:

> Active. Nothing to do. The agent texts when it has something worth the person's time.

The handler selected this text from membership state alone.
It had no matching or delivery-enabled state to support the future-text claim.
The real isolated Friends acceptance had active membership and only dry-run outbound rows.
An ordinary agent response then told the person that Friends would text them.
Private profile text, account identifiers and browser images are not published here.

## Change

The active-member hint now says:

> You are signed up.

The response still returns the same `app`, `status`, `next_step` and `manage_url` fields.
The status remains `active`. Scopes and authentication do not change.
Onboarding, paused, held and consent-related messages are unchanged.
The patch adds no readiness, matching or delivery status.

Other implementations considered:

1. Add matching and delivery flags to this response. That expands the contract beyond this defect.
2. Remove `next_step`. That changes the existing response shape unnecessarily.

## Before and after

One case uses the existing MCP Streamable HTTP integration harness with real platform and OAuth code.
Only test phones, in-memory stores and the existing test OTP provider are used.
It connects with `membership:read`, then requests the actual `check_status` response.
It checks membership fields, the absence of unsupported delivery promises, unchanged membership and no additional test-provider send.
This is a server response regression, not a mocked model response or a genuine signup test.

| Check | Result |
|---|---|
| Same case on base | Expected failure: the hint promises future texts |
| Patched case | 1 pass, 7 assertions |
| Owning MCP, OAuth and updates suites | 48 pass, 331 assertions |
| Root and sites TypeScript | Pass |
| Whitespace | Pass |

```sh
pnpm exec vitest run --conditions eliza-source packages/mcp/test/mcp.test.ts --test-name-pattern 'active membership status stays read-only'
pnpm exec vitest run --conditions eliza-source packages/mcp/test/mcp.test.ts packages/mcp/test/oauth.test.ts packages/mcp/test/updates.test.ts
pnpm run typecheck
```

Local the former runtime: 1.3.14. Normal CI uses the former runtime 1.4.2 and remains a separate gate.
No dependency was installed or added.
Real LLM, browser video and agent-client testing: not applicable to this deterministic HTTP response change; no model calls or cost.
Full simulations, Postgres integration and full e2e were not rerun locally.
The actual private stage acceptance is separate from this local regression.

## Release boundary

`packages/mcp/src/tools.ts` is a backend image input.
Rebuilding site assets cannot put this fix into the existing backend image.
A normal backend image qualification and reviewed release are still required.
No live token, profile, provider, browser, database or runtime action was performed by this work.
