# Slop multi-market radius correction

Historical record. The [original revision](https://github.com/eliza-research/thenetwork/blob/1e2caa5028ade43ec7cb6a90de16466584f7ead0/docs/results/2026-10-13-slop-multi-market-radius.md) retains the commands and toolchain used for the observations. Updated command spellings here describe the current project where the same entrypoints exist.

Date: 2026-10-13. This is a reproduced bug fix, not a new matching market rollout.

## Problem

A member selects SF and NYC with a travel radius. A later radius correction removes the selected cities. Multi-market persistence also replaces an explicit radius with 25 miles.

## Change

Multi-market preferences retain an optional explicit radius. Parsing, later corrections, private tags, read-back, and LLM schema validation preserve it. Legacy profiles without an explicit radius retain the 25-mile default.

Home location, physical presence, mutual distance limits, and the NYC-only production pilot remain unchanged. The fix does not make SF home accounts eligible for that pilot.

## Reproduction and validation

Runtime: the former runtime 1.4.2. Base: `61d5663b2f56cbdd2f54cc1c6bbb6d09ddd1f21d`. Implementation: `29431581bce07504172248b47be42df4971b84e2`.

The primary case uses fictional adults through actual HTTP MCP intake and local PostgreSQL. It checks durable onboarding state and private tags, then the runtime pack and actual geographic matching.

```sh
REQUIRE_PG=1 OBSERVATORY_PG_PORT=54349 pnpm exec vitest run --conditions eliza-source tests/e2e/platform.e2e.test.ts -t "multi-market radius"
node --import tsx --env-file-if-exists=.env --conditions eliza-source scripts/sim.ts --only onboard
pnpm exec tsc --noEmit
```

The test environment uses the existing owned local test cluster. Set `OBSERVATORY_PG_DIR` to that cluster's data directory. Do not reset another cluster.

| Check | Before | After |
| --- | --- | --- |
| Same final HTTP/PostgreSQL regression | Fails: expected multi-market plus 50 miles, received radius-only 50 miles | 1 passed, 0 failed, 39 assertions |
| Official onboarding simulation, pinned seeds 13/14 | Not run for this fix | 19/19 blocking gates passed; hard fields 306/306; corrections 100% |
| Typecheck | Not a regression baseline | Exit 0 |

The matching case checks mutual 50-versus-25-mile limits and rejects a farther peer. A separate fictional SF registry preserves SF home and ZIP while the actual NYC-only runtime excludes the account. No production registry is changed.

One existing tracked simulation target remains off target: persona completion is 79.3%, below 80%. This change does not claim to fix it.

## Evidence limits

No real member, OTP, messaging delivery, deployment, or new infrastructure was used. The official offline simulation cleared model keys. The separate real-model run below used the existing authorized service provider without exporting credentials.

### Hosted qualification

Exact source head `d32c63d60211b86856c3e02a143c72281c84f819` passed hosted run [38349564158](https://github.com/eliza-research/thenetwork/actions/runs/38349564158).

- Integration: 533 passed, 0 failed, 11,196 assertions.
- E2E: 38 passed, 0 failed, 490 assertions; PostgreSQL checks ran.
- Simulation: 329/329 blocking gates passed; 14 tracked targets remain off target.
- Type checks, plugin snapshot, and production site build passed.

### Real LLM extraction

Date: 2026-10-13. Provider: Surplus Intelligence. Requested and returned model: `gpt-6-luna` for every response.

A portable bundle contains the actual base and candidate readers plus the existing core `defaultLLM()` implementation.
Source candidate: `d32c63d60211b86856c3e02a143c72281c84f819`; base: `61d5663b2f56cbdd2f54cc1c6bbb6d09ddd1f21d`.
Bundle SHA-256: `aa2beee5819aaccd5279aa99dbc06c8a6d5d72004fd9a5b1e678d34199bf84f3`.
Local and remote hashes matched before execution. Runtime: the former runtime 1.4.2.

Execution command, after verifying the existing provider and model:

```sh
RADIUS_PROVIDER_MODEL_VERIFIED=1 LLM_MAX_RETRIES=0 node ./real-llm-radius.portable.mjs --execute-real
```

Two fixed synthetic inputs ran against each source version. The inputs were declared before any model call:

1. `I'm a man, 32. I date in San Francisco as well as New York City, within fifty miles.`
2. `I'm a woman, 30. My dating markets are San Francisco; New York City. My radius is seventy-five miles.`

| Input | Actual base output | Actual candidate output |
| --- | --- | --- |
| Fifty miles | `{"mode":"radius","miles":50}` | `{"mode":"multi","markets":["nyc","sf"],"miles":50}` |
| Seventy-five miles | `{"mode":"radius","miles":75}` | `{"mode":"multi","markets":["nyc","sf"],"miles":75}` |

All four HTTP responses were 200. Each case used one physical request, no retry, fallback, or token regrowth.
Each request allowed 500 completion tokens and 12 seconds; the entire run allowed 55 seconds.
The provider reported costs of 34, 41, 44, and 44 micro-USD: **163 micro-USD ($0.000163) total**.
This is provider-reported response cost, not an independently reconciled invoice.
The soft SDK cost guard was 5,000 micro-USD; it stops subsequent calls, not an already-issued request.
Actual synthetic model text, prompt hashes, usage, bundle hash, and the former runtime binary hash were retained privately.
Only the owned temporary bundle and directory were removed after collection.

These two extraction cases prove the reader regression. They do not measure population quality or prove real user acceptance.
Actual synthetic Codex MCP client qualification and recorded terminal playback are documented below; public ChatGPT/native OAuth and personal signup acceptance remain open. Deferred clients remain deferred.

This is source-level bug evidence. Real app membership and canonical Cloud account, assistant, and website history acceptance remain separate work.

Attribution: automated Codex/agent implementation and independent source review under Nubs's project preapproval. It does not imply individual human review.

## Actual local Codex client, 2026-10-13

One actual `codex-cli 0.160.1` invocation used native Streamable HTTP MCP against the real candidate service/router on loopback. Normal ChatGPT-account authentication and configured `gpt-6.1-sol` / medium reasoning were preserved. The CLI JSON did not emit the resolved startup/returned model field, so that field remains unavailable. No model/provider override or retry was used.

The fictional Alex, age 27, had preauthorized normal synthetic OAuth and fake local OTP; this does not qualify Codex-native OAuth login. Before the client, normal MCP intake and independent PostgreSQL/state readback showed SF+NYC with 100 miles. The actual client performed exactly three calls:

1. `check_status({app:"slop"})` returned `active`.
2. `submit_profile` sent: "Only change my dating distance to 50 miles, not 100. Keep my SF and NYC dating markets and my Bay Area home unchanged." It returned `submitted:true`.
3. `check_status({app:"slop"})` returned `active`.

Independent stored-state readback verified 50 miles, both markets, the same person/member/OAuth grant, unchanged home city SF and private scope/max-mile tags. Presence remained empty before and after; no physical presence is claimed. `check_status` itself does not expose preferences.

Client exit 0, no timeout, 17.98 seconds. CLI aggregate usage: 145701 input tokens, 87168 cached input tokens, 331 output tokens. One CLI attempt is not a measured physical model-request count; that count and invoice cost are unavailable. The Network fixture made zero external provider calls and one fake local OTP send; actual Codex account model usage is separate.

[Recorded terminal playback](media/2026-10-13-slop-codex-client-playback.mp4) (142484 bytes; SHA256 `dd57101be69939af1fa2dbd06a020d395e5dc21492169cf2044672a88e3528a2`) retains genuine native MCP request/result events and their recorded times. Warnings, private paths/session metadata and agent narration were omitted. It is terminal playback, not browser video or live screen capture. The complete sanitized recording is retained privately. The later paired comparison below adds the actual baseline recording; earlier HTTP/PostgreSQL and real-model broken/working evidence remains separately scoped above.

Cleanup verified the exact owned database absent, all five owned listeners stopped, synthetic bearer retired, and existing root PostgreSQL/default database intact. No personal account/history, real OTP or production configuration changed.

Client source was exact `f904e3f55b4b7db43d634853600be1cdade0f3a3`. The later local merge `df8642cf21cbce8598598d9957e5ec818fdce25f` incorporates main's truthful-home fix and preserves the radius product files byte-for-byte. Its root/sites types pass; integrated HTTP/PostgreSQL and full CI must still qualify that merged source. No deployed ChatGPT signup, personal Slop eligibility or production SF matching is claimed. OpenClaw, Hermes and Cursor remain deferred.

## Same-input actual client comparison

The additional baseline invocation used exact product source `61d5663b2f56cbdd2f54cc1c6bbb6d09ddd1f21d`. Its sole tracked change was test-only SF registry setup in the E2E harness (7 added lines, 1 changed line; patch SHA256 `1a997eaa67e41b541d330d9b52dab83f0e2720a34ec0ea18314a7337e2f59fde`). The extractor and onboarding product files remained byte-identical to that commit. The fixed client used `f904e3f`. Both used the same fictional Alex, age 27 facts and initial profile text, and the same three actual native MCP tool arguments; argument equality was checked from the recordings.

The baseline prompt truthfully said the profile **requested** 100 miles, without claiming storage had retained100. This context sentence differed from the earlier candidate prompt; the exact correction sent to `submit_profile` was identical. Baseline prompt SHA256: `e9e22b93e9ad0035b6d612ec965ad13012c5f28421ce128d26072bcaf763ed88`. Candidate prompt SHA256: `b859b9a30f2c62097306a5585159054e0de5445a8c7d79a4b979c7b527192ebd`.

| Observation | Baseline 61d | Fixed f904 |
| --- | --- | --- |
| Native client sequence | active → submitted:true → active | active → submitted:true → active |
| Initial requested radius | 100 | 100 |
| Initial durable distance | multi NYC+SF, no miles; private `max_miles:25` | multi NYC+SF, miles 100; private `max_miles:100` |
| After exact 50-mile correction | multi NYC+SF, no miles; private `max_miles:25` | multi NYC+SF, miles 50; private `max_miles:50` |
| Home and presence | home SF unchanged; presence empty | home SF unchanged; presence empty |
| Mapping | own person/member/grant unchanged | own person/member/grant unchanged |

These were independent fictional fixtures; no claim equates the two fixtures' IDs. This exact client input exposes silently ignored miles while retaining the markets. The earlier shorter HTTP correction exposed loss of market selection; those are separate observed cases.

- [Actual client before the fix](media/2026-10-13-slop-codex-before.mp4): 22.6 seconds, 175240 bytes; SHA256 `51a7068420367a4c67f5dbf65b7b1759a22e4835e1957b29e069f4f9015a8fc1`.
- [Actual client after the fix](media/2026-10-13-slop-codex-after.mp4): 21.4 seconds, 175427 bytes; SHA256 `2abcda6a32753a00094144a40533ede738c31f99eb50cd5946d3f536c6cadbf6`.

Both videos preserve genuine recorded tool events/times and append a clearly separate panel titled **Independent stored-state readback (not MCP response)**, projected from the saved SQL qualification receipts. Private IDs/paths/session metadata, warnings and narration are omitted. Original complete sanitized casts and SQL receipts remain privately retained. No client UI, tool reply or expected failure was fabricated.

Baseline CLI exit 0 in 19.957 seconds means the client calls completed; the desired stored 50-mile result failed. Baseline fixture capture exit 0 is not a product pass. Its aggregate CLI usage was 141988 input, 122496 cached input and 332 output tokens; physical model-request count and invoice cost remain unavailable. Configured `gpt-6.1-sol` / medium was preserved, with returned startup model field unavailable. There was one baseline invocation and one earlier candidate invocation, no retries.

Both fixtures independently verified final SQL then removed their exact created database/listeners and retired synthetic bearers while preserving existing PostgreSQL/default database. Each fixture used one fake local OTP and zero external Network provider calls; actual Codex account model usage is separate. No real signup/profile, native OAuth login, deployed ChatGPT flow, personal history or production SF pilot acceptance is claimed.

Combined product source `78859cb` subsequently passed full hosted CI 38373213177: 533 integration tests / 11196 assertions, 40 E2E tests / 555 assertions and 329/329 blocking gates. Both truthful-home cases and the multi-market radius case passed with required PostgreSQL; 14 preexisting tracked targets remain off target. This paired-recording follow-up changes only documentation/media and will receive its own normal CI before merge.
