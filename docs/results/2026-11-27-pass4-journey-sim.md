# Pass 4 Multi-Channel Journey Simulation & Performance Report

## Run Metadata

- **Offline Full Command:** `pnpm run sim --only journeys`
- **Offline Quick Command:** `pnpm run sim --only journeys --quick`
- **Live-LLM Opt-In Command:** `pnpm run sim --only journeys --llm --max-cost-usd 0.25 --max-requests 80`
- **Standalone Report Command:** `node --import tsx packages/sim/src/journeys/runner.ts --seed 42 --report docs/results/2026-11-27-pass4-journey-sim.md`
- **Pinned Seeds:** `42, 43` (full), `42` (quick + replay)
- **Model / Request Settings:** Offline deterministic (`SURPLUS_API_KEY`, `OPENAI_API_KEY`, `CLOUDFLARE_AI_TOKEN` stripped in `scripts/sim.ts`). In `--llm` mode, uses `defaultLLM()` and `judgeLLM()` (`gpt-6-luna` on Surplus Intelligence with OpenAI fallback), capped by `LLMBudget` (`maxCostUsd=0.25`, `maxRequests=80`). When no provider key is set in the environment, `--llm` records `skipped (no_provider_key)` as a tracked gate and exits `0`.
- **Sample Size:** 8 journey suites per seed (16 journeys across seeds `42, 43`), 28 stratified personas per seed, 14 speaking styles, 6 age brackets, 4 communication clarity bands, 6 status strata, 14 channels (4 in-network + 10 out-of-network).
- **Determinism Digest (Seed 42):** `b40a6411ce806c14` (bit-exact across repeated runs and replay check).
- **Hand-Written vs Generated:**
  - **Hand-written:** Journey cohort generator (`packages/sim/src/journeys/cohort.ts`), channel harnesses (`channels.ts`), leak/friction rubric (`rubric.ts`), runner & reporter (`runner.ts`, `report.ts`), sim block (`scripts/sim/journeys.ts`), `withLLMCache` (`packages/core/src/llmCache.ts`), and guard/schedule caches (`outbound-queue.ts`, `mcp/src/leaks.ts`, `runtime.ts`, `outreach.ts`).
  - **Generated (Vibestack / Quint / Dafny):** Pure policy modules `packages/core/src/generated/qualityAndLeague.ts`, `friendIntroAge.ts`, `workIntroChannel.ts`, and `marketingPolicy.ts`.

## Validation Gate Results

| Mode | Command | Blocking Gates | Tracked Gates | Max Seed Wall Time | Sum Wall Time | Digest (Seed 42) |
|---|---|---:|---:|---:|---:|---|
| Full Offline | `pnpm run sim --only journeys` | **9/9 PASS** | 2/2 on target | `1104 ms` | `1392 ms` (2 seeds) | `b40a6411ce806c14` |
| Quick Offline | `pnpm run sim --only journeys --quick` | **9/9 PASS** | 2/2 on target | `1326 ms` | `1326 ms` (1 seed) | `b40a6411ce806c14` |
| Live-LLM (No Key) | `pnpm run sim --only journeys --llm --max-cost-usd 0.25 --max-requests 80` | **9/9 PASS** | 3/3 on target (`skipped (no_provider_key)`) | `1116 ms` | `1320 ms` (2 seeds) | `b40a6411ce806c14` |

## Coverage & Invariant Summary

| Metric | Measured Value | Target |
|---|---:|---:|
| Journeys Passed (Seed 42) | 8/8 (95% Wilson CI `[67.6%, 100.0%]`) | 100% |
| Journeys Passed (Seeds 42 + 43) | 16/16 (95% Wilson CI `[80.6%, 100.0%]`) | 100% |
| Speaking Styles Covered | 14 / 14 | 14 |
| Age Brackets Covered (`<13`, `13-17`, `18-24`, `25-39`, `40-54`, `55-75+`) | 6 / 6 | 6 |
| Communication Clarity Bands Covered | 4 / 4 | 4 |
| Status Strata Covered | 6 / 6 | 6 |
| Channels Covered (In-Network + 10 External Platforms) | 14 / 14 | 14 |
| Privacy & Canary Leaks | **0** | 0 |
| Internal Ranking / Status / Clef Leaks | **0** | 0 |

## Journey Matrix Results (Seed 42)

| ID | Category | Channel | Pass | Leaks | Summary |
|---|---|---|---:|---:|---|
| `J-STYLES-14` | `speaking_style` | `imessage_sms` | PASS | 0 | All 14 speaking styles, 5 launch cities (zero wrong `"New York time"`), natural reschedule, and live `ConsentNetwork` turn verified. |
| `J-AGE-TIERS` | `age_policy` | `imessage_sms` | PASS | 0 | All 6 age brackets verified; `<13` declined; `13-17` 2-year gap, friend-only lane, group bounds `2..6`, all-ages daytime venues, zero number/photo relay, and `lawMinorsNeverLeagueGated` hold. |
| `J-CLARITY-4` | `clarity_band` | `imessage_sms` | PASS | 0 | All 4 clarity bands parsed cleanly; conditional yes (`"though I cannot do bars"`) stays `"unsure"` for explicit confirmation. |
| `J-CHAN-MCP` | `channel_surface` | `mcp_claude` | PASS | 0 | Own-agent `/mcp` and `/mcp/openai` accept 4-digit years/ratings (`2022`, `1600 elo`, `$1500`), block OTP/phone leaks, isolate `slop` off OpenAI surface, and keep output gate clean. |
| `J-CHAN-WORK-EMAIL` | `channel_surface` | `warm_email` | PASS | 0 | `peon.biz` selects `WarmEmail` by default (zero physical venues, zero unsolicited video); selects `ScheduledVideo` only on mutual video request. |
| `J-CHAN-EXT-10` | `channel_surface` | `reddit` (+9) | PASS | 0 | All 10 canonical out-of-network platforms pass value-first playbooks, block spammy drafts via `evaluateReportRisk`, qualify high-signal intake, and reject cold-seller slop and minors. |
| `J-BAD-ACTORS` | `bad_actor` | `imessage_sms` | PASS | 0 | Serial flakers, creeps/SD-072 retaliation, pitch-slap vampires, VoIP slop, prompt injectors (`fenceUntrusted` + `packetSuspect`), and `internal:ranking` leaks all contained; quiet VIPs and newcomers protected. |
| `J-LEAGUE-BILATERAL` | `league_bilateral` | `imessage_sms` | PASS | 0 | Bilateral value admits verified step-ahead mentors and shared-guild friends, blocks extractive grifters, and enforces `peon` and aesthetic firewalls. |

## LLM Caching & Runtime Performance Telemetry

| Optimization | Scope | Measurement | Result |
|---|---|---|---|
| `withLLMCache` LRU + TTL + singleflight coalescing | `packages/core/src/llmCache.ts` | 3 concurrent identical calls + 1 sequential repeat (`SimClock`) | `underlyingCalls=1`, `hits=1`, `misses=1`, `coalesced=2` (**75% fewer upstream calls**) |
| Provider prompt-cache & reasoning controls | `packages/core/src/llm.ts`, `venues.ts`, `extract.ts`, `cost.ts` | Forwards `prompt_cache_key`, `reasoning_effort: "low"`, logs `cachedTokens`/`cacheWriteTokens`, short-circuits single/clear-winner venue rerank (`margin >= 25`) | Stable system prefix before dynamic context (`llmAgent.ts`), reasoning-first JSON verdicts (`llmJudges.ts`) |
| Cached `LeakGuard` reuse | `packages/blooio/src/outbound-queue.ts`, `packages/network/service/runtime.ts` | `N=1,000` checks (fresh vs cached guard, same fact set) | `308.85 ms` -> `153.44 ms` (**2.0x faster**; eliminates 2 guard constructions per outbound SMS) |
| Cached MCP output gate | `packages/mcp/src/leaks.ts` | `N=1,000` `outputLeaks()` calls via `DEFAULT_OUTPUT_GUARD` + 64-entry LRU | `114.90 ms` (`0.115 ms/call`) |
| Batch booking receipts | `packages/network/service/runtime.ts` | Replaced per-booking `bookingNoticeReceipts` N+1 loop with single `currentBookingReceipts()` query | 1 DB round-trip per tick instead of N |
| Security & queue regression suite | `packages/blooio/test/outbound-queue.test.ts`, `packages/mcp/test/oauth.test.ts` | `pnpm exec vitest run` | **97/97 PASS** (`35/35` + `62/62` in `2.10 s`) |

## Sample Redacted Trajectories (Seed 42)

### J-STYLES-14 (Multi-City & Speaking Styles)
- **Member(terse) -> Eliza:** `Sounds good.`
- **Eliza -> Member(terse):** `Could your meeting move from Thu 18:00 to Fri 18:30 (San Francisco time)? The original booking stays until everyone agrees. Reply RESCHEDULE YES ref-demo or RESCHEDULE NO ref-demo (or just YES / NO if this is your only open change).`
- **Member(warm) -> Eliza:** `Sounds good! Thursday at 6pm works great for me. Appreciate it :)`
- **Eliza -> Member(warm):** `Could your meeting move from Thu 18:00 to Fri 18:30 (Los Angeles time)? The original booking stays until everyone agrees. Reply RESCHEDULE YES ref-demo or RESCHEDULE NO ref-demo (or just YES / NO if this is your only open change).`

### J-AGE-TIERS (`<13` Decline & `13-17` Teen Safety)
- **Maya -> Eliza:** `Hi I am 12 years old`
- **Eliza -> Maya:** `Thanks for reaching out — you need to be at least 13 to join.`
- **Sam -> Eliza:** `Looking for daytime board game friends on friends.help`
- **Eliza -> Sam:** `I can suggest all-ages daytime spots like Ferry Building Marketplace in Embarcadero / FiDi.`

### J-CHAN-MCP (Own-Agent MCP Surface)
- **Member(mcp_claude) -> Eliza:** `submit_profile: Moved to SF in 2022, 1600 elo chess.`
- **Eliza -> Member(mcp_claude):** `Profile saved. Match with Priya (meeting Thu) — shared interest in ceramics.`
- **Member(mcp_openai) -> Eliza:** `get_updates on friends.help`
- **Eliza -> Member(mcp_openai):** `Pending introduction waiting for your reply`

### J-CHAN-EXT-10 (Value-First Out-of-Network Samples)
- **Network -> Prospect(reddit):** `If you're looking for a low-key small group around ceramics and espresso, showing up to a consistent 4-5 person public hang in Mission / Dolores beats giant mixers every time. I help organize a quiet 18+ table Thursday around 7pm — reply if you ever want details, totally fine to pass.`
- **Network -> Prospect(linkedin):** `Hi Theo — read your note on ceramics and espresso. Not recruiting or selling anything; happy to connect you with a vetted local peer around shared craft in Silver Lake / Echo Park if useful, zero pressure.`
- **Network -> Prospect(bumble):** `hey Jonah — saw you're into ceramics and espresso. i organize small 4-5 person coffee hangs in Wynwood for folks new-ish or looking to expand their circle (totally platonic). doing one Thursday around 7pm — want me to save you a spot?`
