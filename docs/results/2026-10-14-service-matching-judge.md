# Service matching judge qualification

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-14-service-matching-judge.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

This fixes the missing LLM connection in the service matching path (PRD 28.3, 33.6).
Baseline: main `aea941fff26ccc9a37791e381267660b2728f5a3`.
Attribution: Automated. Codex performed the implementation and tests under Nubs' approval.

The service now builds the existing per-app `recommenderLLM()` when `NETWORK_ENGINE_JUDGE=1`.
It records each app's priced responses under `engine_judge` in the existing cost ledger.
Both normal entry points use this service constructor. No new provider client was added.
Matching switches, human review, consent, age rules and send flags are unchanged.

## Method

The existing Slop date-path integration uses a throwaway local Postgres database and the real NetworkService.
Two fictional adults use signed webhook requests. The clock is simulated. Delivery uses DryRunAdapter.
The script acts as the reviewer and as each fictional member. This is not real-person consent.
No member text, OTP, photo, or provider delivery was sent.

Command, the former runtime 1.4.2, seed 1:

```bash
NETWORK_ENGINE_JUDGE=1 NETWORK_ENGINE_JUDGE_BUDGET_USD=0.25 NETWORK_ENGINE_JUDGE_MAX_REQUESTS=12 \
  pnpm exec vitest run --testTimeout 300000 \
  packages/network/test/slop-date-path.integration.test.ts --test-name-pattern 'join, onboard'
```

The live runs used the existing Surplus key, `surplus/gpt-6-luna`, and no OpenAI key.
Settings: 60-second HTTP timeout, 120-second total call deadline, zero HTTP retries.
The core client keeps its real clock for I/O deadlines, separate from the simulated business clock.
The budget is shared across all app clients and includes retries. It resets when the service restarts.

## Results

Hand-written: this report and the profiles in the maintained test. Generated: the following counts and costs.

| Run | Result |
|---|---|
| Original full date-path file, judge off | 3 pass, 68 assertions, 7.24 seconds |
| New opt-in acceptance on unchanged service source | Fails: zero matching-judge cost receipts |
| First real-model qualification | 1 pass, 67 assertions, 23.45 seconds; one priced response, $0.000056 |
| Final clock and coverage checks | 1 pass, 68 assertions, 16.85 seconds; one priced response, $0.000051 |
| Existing pipeline block | 15/15 blocking gates pass, 8.3 seconds |
| Final date-path file, judge off | 3 pass, 70 assertions, 18.40 seconds |

Each live run recorded one call, one valid verdict, zero failures, one selected candidate and one judged selection.
The test joins the reviewed opportunity to its actual persisted matching-run summary within the same app.
It requires complete selected coverage and zero judge failures, separately from the paid-response receipts.
No contact is recorded before review. Each member's own yes is required. An MCP profile cannot supply that consent.
The flow reaches booking, check-in, a safety report and exclusion of the reported pair.

This is functional evidence for one fictional pair, not a quality or calibration estimate.
Two runs of the same pair are not independent samples. They cost $0.000107 in total.
No weights or prompts were tuned on these results.

## Limits and next release check

This proves the real-model service/Postgres flow locally. It does not prove a deployed staging image or a live introduction.
The existing staging account and history must be preserved. Never point the destructive integration harness at that database.
Use the normal staging source release and its release checks. Keep matching and sends off during deployment.

Judge failures or budget exhaustion can leave heuristic candidates eligible under the existing engine policy.
Inspect `matchingJudge` coverage before calling a run AI-qualified. Friends has no judge pack and makes no judge calls.
The service still matches NYC candidates only. Bay Area profile intake does not prove Bay Area matching.

Full offline validation: `pnpm run sim` passed 326/326 blocking gates in 1014.2 seconds. Fourteen tracked targets remain off target.
`pnpm run typecheck` passed. These results do not establish pilot matching quality.
