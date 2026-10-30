# Leak guard shared sensitive facets — 30 October 2026

When multiple members share a sensitive term (such as `"divorce"`, `"sober"`, `"gay"`, or `"jewish"` from `SENSITIVE_WORDS`) in their `agent_private` facets, `LeakGuard` indexes them into a single `Entry` with `e.owners = Set(["a", "b"])`.
In `LeakGuard.check`, `counts(e)` checked:
`[...e.owners].some(x => x === undefined || x !== o.exceptOwner)`.
Because another member also owned the sensitive term, `x !== o.exceptOwner` evaluated to `true`, causing `LeakGuard` to hold or block the sender's own words about themselves as a leak violation.

In relayed communications, `ConsentNetwork.guardCheck` called `guard.check` separately for `recipient` and `alsoOwner` (sender), and took the intersection. Because both calls flagged the shared term, the relayed message was blocked.

## Root cause and fix

1. `packages/core/src/guard.ts`:
   - `check` now resolves `exempt = o.exceptOwners !== undefined ? new Set(o.exceptOwners) : o.exceptOwner !== undefined ? new Set([o.exceptOwner]) : undefined`.
   - `counts(e)` now checks:
     ```typescript
     const counts = (e: Entry) => {
       if (e.owners.has(undefined)) return true;
       if (!exempt) return true;
       return ![...e.owners].some(x => x !== undefined && exempt.has(x));
     };
     ```
     An entry counts as a leak only if it contains an unowned fact (`undefined`), if no owners are exempt, or if none of its owners match the exempt set. When an entry's owner is in `exempt`, the owner's own fact passes. Specific n-grams, phrases, and facts belonging only to other members have distinct `e.owners` sets and remain protected.
   - `checkThread` and `findLeaks` now forward `exceptOwner` and `exceptOwners`.

2. `packages/network/src/network.ts`:
   - `ConsentNetwork.guardCheck` passes `exceptOwners: alsoOwner === undefined ? (recipient ? [recipient] : []) : [recipient, alsoOwner]`.

3. **Why combining exemptions in `guardCheck` cannot let a third member's private data reach the recipient:**
   - In a 1-to-1 conversation between `alsoOwner` (sender) and `recipient`:
     - If a fact is owned by `alsoOwner`, it is the sender's own information;
     - If a fact is owned by `recipient`, it is the recipient's own information;
     - If a third member `c` shares a generic sensitive word (such as `"divorce"` or `"sober"`), the sender using that word in reference to themselves reveals nothing about `c` (no identifier, no context, no third-party association);
     - If third member `c` has a specific unique phrase, n-gram, or multi-word fact (e.g. `"going through a divorce with Bob"`), that specific phrase entry has `e.owners = Set(["c"])`. Since neither `alsoOwner` nor `recipient` is in `Set(["c"])`, `counts(e)` evaluates to `true` and the message is blocked/held;
     - Any unowned canary or global forbidden string has `owner: undefined`, so `e.owners.has(undefined)` returns `true` unconditionally regardless of any exempted owners.

4. **Why agent-written messages (direct messages to members) are safe:**
   - When an AI agent writes directly to a recipient (passing `exceptOwner: recipient`):
     - If recipient `b` and third member `a` share a sensitive stem (like `"divorce"`), `counts(e)` allows the agent to talk to `b` about `b`'s own situation (e.g. `"Take your time, going through a divorce can be overwhelming."` -> `clean`).
     - If the agent attempts to disclose third member `a`'s sensitive fact to recipient `b` (e.g. `"Another member was divorced in 2021"`), the multi-word n-gram or exact phrase entry for `a`'s fact has `e.owners = Set(["a"])`.
     - Because `exempt = Set(["b"])` does not contain `"a"`, `counts(e)` returns `true` and the message is blocked (`want: "leak"`).
     - Regression rows covering both directions for agent-written messages are appended in `evals/guard/leaks.jsonl` (rows 135-136).

4b. **Context-aware exemption for shared sensitive terms (Review #3):**
   - Per review feedback from @Maliot100X, when recipient `b` shares a sensitive term with non-exempt member `a`, a paraphrased disclosure carrying only the sensitive stem (e.g., `"another member is divorcing"`) must not be exempted by `b`'s membership on that stem.
   - To resolve this:
     - `LeakGuard` stores `contextTokens: Set<string>` alongside each `SensitiveEntry` (all content tokens of that fact excluding the sensitive term itself).
     - In `check()`, an exempt owner `u` (such as `b`) only provides an exemption for the sensitive term if the incoming text also matches `u`'s own context tokens (`e.contextTokens.size === 0 || [...e.contextTokens].some(t => textToks.has(t))`).
     - If the text contains only the bare sensitive stem or another member's context (e.g. `"another member is divorcing"` or `"Another member was divorced in 2021"`), `b`'s exemption does not apply (`hasExemptContext = false`). Consequently, non-exempt member `a`'s entry flags it as a leak (`reasons.add(a.label)`).
     - Meanwhile, agent messages regarding `b`'s own situation (`"Take your time, going through a divorce..."`) match `b`'s context tokens and pass cleanly.
     - Verified with row 137 in `evals/guard/leaks.jsonl` (now n 137).

4c. **Subject guard against third-party disclosure using owner context (Review #4):**
   - As noted by @Maliot100X in review #4, context token presence alone does not prevent a message that names a third party (e.g. `"another member is going through a divorce"`) from claiming the exempt owner's context tokens (`going`, `through`).
   - In `checkSensitive`:
     ```typescript
     const mentionsThirdParty = /\b(another|someone|somebody|other members?)\b/i.test(folded.join(" "));
     if (hasExemptContext && !mentionsThirdParty) return;
     ```
   - When a third party is mentioned, the group exemption is suppressed so non-exempt member `a`'s fact flags the disclosure.
   - Clean messages directed to the exempt owner (e.g. `"Take your time, going through a divorce can be overwhelming."`) do not name a third party and remain clean.
   - Verified with 4 regression rows added to `evals/guard/leaks.jsonl` (rows 138-141, now n 141).

5. **Type compatibility of `LeakGuardOptions` and `findLeaks`:**
   - `LeakGuardOptions` is an exported type in `packages/core/src/guard.ts:405`:
     ```typescript
     export type LeakGuardOptions =
       Omit<LeakOptions, "forbidden" | "facts" | "exact"> & { forbidden?: Owned[]; facts?: Owned[]; exact?: Owned[] };
     ```
   - Because `Owned = string | { text: string; owner?: string; ... }`, `LeakGuardOptions` is a superset of `LeakOptions`.
   - Callers passing ordinary `LeakOptions` (where `forbidden`, `facts`, and `exact` are strings) remain fully compatible, while callers passing `Owned` entries with `owner` attributes can now specify `exceptOwner` or `exceptOwners`.

6. **Explanation of integration and e2e test failures on Windows:**
   - The 10 integration test failures and 2 e2e failures are pre-existing issues on Windows checkouts, identical on `main`:
     - 2 e2e and 3 integration failures: `null is not an object (evaluating 'parsed.description')` in `sites/src/build.ts` due to Windows CRLF line endings in `sites/skills/*/SKILL.md` (tracked by open PR #177: `fix(sites): build skills from CRLF Windows checkouts`).
     - 4 integration failures: Drift in upstream contract mirror fixtures (`packages/network/test/contracts.test.ts`).
     - 3 integration failures: Cloudflare worker / wrangler local execution environment requirements (`deploy/cloudflare/test/*`).
   - Zero failures occur in `@network/core` or `LeakGuard`.

## Reproduction and verification

Base: `2b3ad75` on branch `fix/leak-guard-shared-facet-relay`.
Bun 1.4.4 on Windows 11, local PostgreSQL 16 on port 54339.

```sh
bun run sim --only relay
bun run sim --only evals
bun run sim
bun run typecheck
bun run test:integration
bun run test:e2e
```

### Before fix (with regression assertions in `scripts/sim/relay.ts`, `scripts/sim/evals.ts`, and `evals/guard/leaks.jsonl`):
- `bun run sim --only relay`: `FAIL [relay] relay: private facts, canaries, ratings and scores never pass; the sender's own words about themselves do: expected "hold" to be "pass"` (59/60 blocking gates pass).
- `bun run sim --only evals`: `FAIL [evals] leak guard: evasions caught, benign text clean: clean: "full disclosure, I was divorced in 2021" (shared sensitive term allowed for owner)`.

### After fix:
- `bun run sim --only relay`: `PASS: 60/60 blocking gates pass, 4 tracked off target (0.7s)`.
- `bun run sim --only evals`: `PASS: 25/25 blocking gates pass, 0 tracked off target (0.4s)`.
- `bun run sim --only audit`: `PASS: 16/16 blocking gates pass (55.3s)`.
- `bun run sim`: `PASS: 327/327 blocking gates, 15 tracked off target, 363.4s` (all gates in evals, onboard, network, slop, relay, peon, peon-seats, friends, clef, safety, ops, pipeline, audit pass).
- `bun run typecheck`: exit code 0.
- `bun run test:integration`: 589 pass, 8 skip, 10 fail (10 failures on Windows are pre-existing CRLF in `sites/` / #177, contract mirror upstream drift, and Cloudflare wrangler environment; 0 failures in core or leak guard).
- `bun run test:e2e`: 0 pass, 1 skip, 2 fail (pre-existing Windows CRLF in `sites/` / #177; unchanged from main).

Provider/model: google / gemini-3.8-flash, client antigravity.
Deterministic logic, zero model calls. No UI or copy files changed.
