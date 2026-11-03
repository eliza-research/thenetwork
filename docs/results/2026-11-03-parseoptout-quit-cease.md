# parseOptOut misses the "quit"/"cease" stop verbs (2026-11-03)

Hand-written report. The numbers come from `bun run sim --only evals` (deterministic, no
model: the eval block clears the provider keys).

## Defect

`parseOptOut` (packages/core/src/replies.ts) is the conversational opt-out reading the inbound
path uses (AGENTS.md audit hand-off: "Use `parseOptOut` on the inbound path"). Its free-text
`LIKELY_EN` pattern accepted only `stop texting me` and dropped the `quit` and `cease` synonyms,
although every sibling reader in the same file treats them as stop verbs:

- `KEYWORDS.stop` includes `QUIT`;
- `EXACT_EN` includes `quit`;
- the carrier reading `optOutPhrase` uses `(?:stop|quit|cease) (?:texting|messaging|…)`.

So a member who answered `quit texting me` or `cease messaging me` was read as `none` (not an
opt-out), while the platform consent ledger (`detectKeyword`) and `optOutPhrase` both read the
same text as a STOP. A documented opt-out reader silently disagreeing with the carrier reading
on a plain opt-out phrase is a consent defect.

## Reproduction

```
$ bun -e 'import {parseOptOut} from "./packages/core/src/replies.ts"; \
  for (const t of ["quit texting me","cease messaging me"]) console.log(t, parseOptOut(t).match)'
quit texting me none          # before
cease messaging me none       # before
```

## Fix

`LIKELY_EN`: `stop (?:texting|…)` → `(?:stop|quit|cease) (?:texting|…)`, matching the carrier
`optOutPhrase` verb set. No new false positives: `quit` is still only an opt-out immediately
before a messaging verb, so `I quit my job today` and `quit peon` stay `none`/app-leave.

## Evidence

Added three rows to `evals/opt-out-parse.jsonl` (the gate `core parseOptOut: every row read as
labelled`): `quit texting me` → `likely`, `cease messaging me` → `likely`, and the negative
`I quit my job today` → `none`.

- Before: the two `likely` rows read as `none`; the gate fails.
- After: `bun run sim --only evals` → 25/25 blocking gates pass; `core parseOptOut (n 43)` passes.

Command and seeds: `bun run sim --only evals` (the eval block is seed-free; it reads the fixed
corpora). `bun run typecheck` (root project) passes.

## Evidence checklist (CONTRIBUTING.md 12.2)

- [x] **The repository is starred and the PR comes from your fork.** `gh api -i user/starred/eliza-research/thenetwork` returns `HTTP/2.0 204 No Content` (starred). The PR is from the contributor's fork.
- [x] **Linked issue or approved requirement.** AGENTS.md audit hand-off (item 11): "Use `parseOptOut` on the inbound path (STOP everywhere, per-app leave)." A documented opt-out reader must agree with the carrier reading on a plain opt-out phrase.
- [x] **The root cause, in plain words.** `parseOptOut`'s free-text `LIKELY_EN` pattern (packages/core/src/replies.ts:273) matched only the `stop` verb before a messaging verb, so `quit texting me` and `cease messaging me` read as `none`. The sibling readers in the same file — `KEYWORDS.stop` (`QUIT`), `EXACT_EN` (`quit`) and the carrier `optOutPhrase` (`(?:stop|quit|cease)`) — all treat quit/cease as stop verbs, so the conversational reader silently disagreed with the carrier reading on a plain opt-out.
- [x] **The fix, and two other implementations you did not use.**
  - **Fix (used):** widen the `LIKELY_EN` verb group from `stop (?:texting|…)` to `(?:stop|quit|cease) (?:texting|…)`, matching the `optOutPhrase` verb set. One line, narrowest consent-safe change; the n-43 corpus guards against drift.
  - **Alternative 1 (not used):** extract a shared `STOP_VERB = "stop|quit|cease"` constant and reference it from both `LIKELY_EN` and the ME-anchored `optOutPhrase` so the two sets can never drift. Rejected: a wider blast radius touching the carrier regex for a consent path, where the minimal regex edit plus the corpus gate already prevent future drift.
  - **Alternative 2 (not used):** delegate `LIKELY_EN`'s free-text stop-verb branch to `optOutPhrase`. Rejected: `optOutPhrase` is anchored on an explicit object (`… me`), so it would miss objectless opt-outs (`stop messaging`, `no more texts`) that `LIKELY_EN` must still catch — it would narrow coverage, not widen it.
- [x] **The before and after results, with the same command, seeds and data.** Before: the two `likely` rows (`quit texting me`, `cease messaging me`) read as `none`; the gate `core parseOptOut: every row read as labelled` fails. After: `bun run sim --only evals` → 25/25 blocking gates pass, `core parseOptOut (n 43)` passes. Same command, same fixed corpus; the eval block is seed-free.
- [x] **Real-LLM evidence.** N/A: `parseOptOut` is a deterministic regex reader with no model call (the eval block clears the provider keys; packages/core/src/replies.ts states "Deterministic, no model").
- [x] **Agent clients tested (section 8).** N/A: no agent-facing surface changes. The fix is an internal reply-parser regex; no SKILL.md, MCP tool, onboarding prompt or site copy changed. The behavior is fully exercised by the deterministic `evals/opt-out-parse.jsonl` corpus.
- [x] **Logs or video when a flow is involved.** N/A: no user flow changes; the change is a pure-function regex. Reproduction is the one-liner in the Reproduction section above.
- [x] **`bun run sim`, `bun run typecheck`, `bun run test:integration` and `bun run test:e2e` pass. Paste the summary lines.**
  - `bun run typecheck` → clean (`tsc --noEmit` across root, sites, observatory, deploy/cloudflare; no output, exit 0).
  - `bun run sim` → `PASS: 305/305 blocking gates, 20 tracked off target, 394.1s` (the 20 tracked are Postgres-only gates skipped because this box has no Postgres; `core parseOptOut (n 43)` passes in the evals block, 25/25).
  - `bun run test:integration` → `364 pass, 252 skip, 23 fail` (`Ran 639 tests across 68 files`). **All 23 failures are environment-caused:** every failing file is a Postgres-backed `.pg.test.ts` / `.integration.test.ts` and every failure is `ERR_POSTGRES_CONNECTION_REFUSED` or `initdb not found: install Postgres` (plus cascading teardown errors from those `beforeAll` failures). This box has no Postgres and no sudo. The fix is a deterministic regex in `packages/core` with no DB path.
  - `bun run test:e2e` → `0 pass, 47 skip, 0 fail` (`Ran 47 tests across 3 files`): "tests/e2e skipped: no Postgres." The e2e suite self-skips cleanly without a database.
- [x] **Test steps and the expected result of each step.**
  1. `bun install` → dependencies install.
  2. `bun run typecheck` → passes (no type errors).
  3. `bun run sim --only evals` → 25/25 blocking gates pass; `core parseOptOut (n 43): every row read as labelled` passes (fails before the fix).
  4. `bun -e 'import {parseOptOut} from "./packages/core/src/replies.ts"; console.log(parseOptOut("quit texting me").match, parseOptOut("cease messaging me").match)'` → `likely likely` (was `none none`).
  5. `bun run sim` → 305/305 blocking gates pass.
- [x] **Risks and trade-offs.** Low: `quit`/`cease` are matched only immediately before a messaging verb, so `I quit my job today` stays `none` and `quit peon` stays an app-scoped leave (both are corpus rows). The change widens opt-out recall (consent-safe direction); the corpus guards against new false positives.
- [x] **No UI change, or the broken-flow exception.** N/A: no UI change (internal parser regex).
- [x] **No secrets, `.env`, `runs/` or member data in the diff.** Confirmed: the fix touches `packages/core/src/replies.ts`, `evals/opt-out-parse.jsonl` and this results doc only.
