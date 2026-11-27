# The Network Marketing System (`@thenetwork/marketing`)

This directory holds the strategy, technical Product Requirements Document (PRD), global city-by-city launch playbook, NYC vendor dossier, and future `slop.cash` integration specification for The Network's autonomous marketing application (`apps/marketing`).

The system launches NYC-first across all four apps (`slop.date`, `ntwrk.party`, `peon.biz`, `friends.help`) and the `eliza.app` shared entry, and scales city by city via declarative `CityPack` configs (`nyc`, `sf`, `la`, `chicago`, `miami`, `austin`, `london`, plus any custom city via `registerCityPack()`) layered under the universal `DesireLane` taxonomy.

---

## Non-Negotiable Guardrails

Every workflow, agent, adapter, and human hiring pipeline in `apps/marketing` obeys these hard rules from [AGENTS.md](../../AGENTS.md):

1. **No public portals on the four landing sites (2026-10-19 rule):** Do not add login links, contractor forms, or campaign pages to `ntwrk.party`, `slop.date`, `peon.biz`, or `friends.help`. All operator release/contract/proof links resolve under `MARKETING_OPS_BASE_URL` (default `https://ops.ntwrk.party`), and the Observatory-sibling Global Growth Command Center runs locally on `127.0.0.1:4949` (or behind staff Zero-Trust access).
2. **Zero-cash `packages/capital` wall (2026-11-23 rule):** Internal Network Capital stays non-transferable and zero-cash. All marketing budgets, contractor payments, bandit allocations, BD deals, LLM trajectories, enrichment caches, platform interactions, intake candidates, and attribution ledgers live inside the isolated `marketing.*` Postgres schema (**25 tables**).
3. **18+ hard floor for hiring, events, filming, and payouts (`inv_adult_only_paid`):** People aged 13–17 follow the strict platform minor age policy; no person under 18 (or with unknown age) is ever hired for street teams, event activation, or creator shoots, filmed for commercial ads, or paid in any marketing task. Youngest recorded age reading always wins (`minAgeReading`), reinforced cross-schema by `marketing.contact_fence` (including `platform.external_prospect_suppressions`).
4. **Zero gimmicky hardware:** Street execution relies on real humans, clean serialized printed fliers with unique batch QR codes, in-person event activators, and street-interview YouTubers/creators generating verifiable social video proof.
5. **Unified Contact Hygiene & Core Backpressure (`inv_stop_fence_respected`):** Any contact marked `STOP`, suppressed in `marketing.contact_suppression`, or flagged by `NetworkCoreBridge.checkContactFence()` is blocked across all channels and agents immediately (and immediately purges cached enrichment rows). Cold outreach enforces proved cooldowns (`14d`, max `2/30d`, max `2` unanswered) and city-local quiet hours (`isLocalQuietHours`), and core review/outbound backpressure (`queuePressurePaused`) pauses cold intake automatically.
6. **Two-level formal verification (Vibestack/Dafny + Quint):** Pure policy and device safety decisions are specified in Vibestack ([spec/marketingPolicy.md](../../spec/marketingPolicy.md) — **26 Dafny-proved obligations**; [spec/marketingDevice.md](../../spec/marketingDevice.md) — **4 Dafny-proved obligations**; **30 total**) and published as generated TypeScript (`packages/core/src/generated/marketingPolicy.ts` and `packages/core/src/generated/marketingDevice.ts`) via `pnpm run spec:sync`. End-to-end state transitions and all safety invariants are checked in the whole-flow Quint model ([spec/models/marketing_campaign.md](../../spec/models/marketing_campaign.md)).
7. **`slop.cash` stays OFF by default (`inv_slop_cash_disabled`):** The `slop.cash` integration is researched and specified for future `oss_dev_bounty` tasks only. It stays compiled as a fail-closed stub (`MARKETING_SLOP_CASH_ENABLED=0`) until explicit written founder approval.

---

## Documentation Index

| Document | Purpose |
| :--- | :--- |
| [APOLLO-AND-OUTREACH-PLAYBOOK.md](APOLLO-AND-OUTREACH-PLAYBOOK.md) | Pass-4 Apollo.io dual-mode enrichment adapter (`0`-credit search -> `1`-credit match, 30d cache, Dafny credit caps), 28 high-status/high-agency VIP archetypes & bilateral offers, 10-platform zero-annoyance playbooks (`reddit`, `x`, `linkedin`, `tinder`, `bumble`, `hinge`, `meetup`, `eventbrite`, `luma`, `partiful`) with report-risk gate (`<= 24`) & circuit breakers, and Out-of-Network -> In-Network Quality Intake Bridge. |
| [CITY-LAUNCH-PLAYBOOK.md](CITY-LAUNCH-PLAYBOOK.md) | Step-by-step global city-by-city expansion guide: `CityPack` registry, 5-stage launch readiness, statutory labor/fliering matrix (NYC/CA AB5/UK Schedule 3A), Universal `DesireLane` taxonomy & air-gaps, `NetworkCoreBridge` (`contact_fence` + `supply_demand_k5`), LLM `PromptCache`/caps, and offline `pnpm run sim --only marketing`. |
| [STRATEGY.md](STRATEGY.md) | City-by-city global growth strategy (NYC first), Universal Desire & Experience Graph, `$10,000` Month-1 street-team and creator budget, 5-agent brand roster, 3-zone risk dial, Contextual Bandit, Anti-Fraud vesting, Zero-Human BD, 18-Archetype VIP salon outreach, and 5-Agent Short-Form Video Factory. |
| [PRD.md](PRD.md) | Complete technical specification for `apps/marketing`: 4-tier architecture, canonical foundation (`types`, `constants`, `policy`, `validation`, `sse`, `desire-lanes`, `city-registry`, `city-launch-engine`, `network-bridge`, `llm-cache`, `sim`), 21-table `marketing.*` Postgres schema + 2 guarded RPCs, 5-agent subscription lifecycle coordinator, single-MacBook + Android + iPhone physical bridge, Command Center UI, REST API, CLI, and 27-obligation Vibestack/Dafny + Quint formal verification contract. |
| [NYC-STREET-TEAMS-AND-AGENCIES.md](NYC-STREET-TEAMS-AND-AGENCIES.md) | Concrete vendor dossier for NYC street teams, flier distribution, 15 vetted NYC agencies, Craigslist/RentAHuman gig hiring, street-interview YouTubers/creators, 7-metro legal rules (incl. CA AB5 W-2 and London EPA 1990 Schedule 3A), and canonical zero-human email templates. |
| [SLOP-CASH-INTEGRATION.md](SLOP-CASH-INTEGRATION.md) | Ground-truth research and future integration contract mapping `oss_dev_bounty` tasks and `oss_pr_merge` proofs to `slop.cash` vaults, Base/Solana USDC settlement, legal segregation from US consumer fiat payouts, and the `MARKETING_SLOP_CASH_ENABLED=0` three-layer lock. |
| [spec/models/marketing_campaign.md](../../spec/models/marketing_campaign.md) | Whole-flow Quint state-machine model verifying all safety invariants, reachability witnesses, and deterministic `run` tests. |

---

## Quickstart Commands

Run all commands from the repository root on Node 26 + `pnpm`:

```bash
# 1. Apply Postgres migrations (includes repeatable 9004_marketing_schema -> apps/marketing/db/schema.sql)
pnpm run db:migrate

# 2. Start the Global Growth Command Center + REST API + live SSE hub (http://127.0.0.1:4949)
pnpm run marketing

# 3. Inspect and control cities, campaigns, agents, devices, bandit, BD, VIPs, videos, and spend via CLI
pnpm run marketing:cli -- seed --city nyc
pnpm run marketing:cli -- status
pnpm run marketing:cli -- scan-devices
pnpm run marketing:cli -- discover --city sf
pnpm run marketing:cli -- tick
pnpm run marketing:cli -- bandit
pnpm run marketing:cli -- hire-batch --role street_fliering --city nyc --budget 25000
pnpm run marketing:cli -- bd-list
pnpm run marketing:cli -- vip-invite
pnpm run marketing:cli -- apollo-search --city nyc --archetype startup_founder
pnpm run marketing:cli -- apollo-enrich --name "Elena Vance" --domain heliossystems.io
pnpm run marketing:cli -- playbook-lint --platform reddit --text "Happy to intro you to two local regulars."
pnpm run marketing:cli -- intake-audit --city nyc
pnpm run marketing:cli -- video-lint
pnpm run marketing:cli -- slop-cash-preview
pnpm run marketing:cli -- serve --port 4949

# 4. Run offline 30-day multi-city deterministic marketing simulation (15 blocking gates, <1s)
pnpm run sim --only marketing
pnpm run sim --only marketing --quick

# 5. Run formal specification, generated-code, typecheck, UI lint, and Postgres+HTTP integration checks
pnpm run spec:sync
pnpm run spec:check-generated
pnpm run quint:check marketing_campaign
pnpm run typecheck
pnpm run lint:ui
pnpm exec vitest run --project integration apps/marketing/test/marketing.integration.test.ts apps/observatory/test/migrations.test.ts
```

By default, all Tier 3 and Tier 4 paid adapters run in **safe dry-run mode** (`billingArmed = false`, `MARKETING_LIVE_BILLING=0`, `MARKETING_LIVE_SEND=0`, `MARKETING_LIVE_DEVICE=0`, `MARKETING_SLOP_CASH_ENABLED=0`). No external email, paid API call, print order, phone action, or payout executes until credentials are set and billing is explicitly armed.

---

## 4-Tier Phased Implementation Map

| Tier | Scope | Implementation Status | Incremental Cash Cost |
| :--- | :--- | :--- | :--- |
| **Tier 1: Zero-Cost Core & Global Growth Engines** | Runnable `apps/marketing` Node 26 service + CLI + Observatory-sibling Global Growth Command Center UI (OKLCH design tokens, SVG charts, live SSE `/api/events`), Vibestack/Dafny generated policy/device cores (**27** proved obligations), whole-flow Quint model, **21-table** `marketing.*` Postgres schema + `contact_fence` / `supply_demand_k5` RPCs, `CityPack` registry + `CityLaunchEngine`, Universal `DesireLane` graph, 5-agent subscription coordinator (`ChatGPT`/`Claude`/`Gemini`/`Surplus`) + `PromptCache` & trajectory ledger, multi-city Socrata/open-web discovery, Contextual Bandit, Autopilot Daemon, Anti-Fraud + O(N) Sybil scanner, 8-stage BD + QR engine, 18-archetype VIP salon engine, 5-agent Short-Form Video Factory, and offline 30-day simulator (`pnpm run sim --only marketing`). | **Implemented Now** | `$0 / mo` *(uses existing AI subscriptions + local dev Postgres `:54339`)* |
| **Tier 2: Single-MacBook Local Phones** | Local physical bridge on 1 MacBook connected to 1 dedicated Android (`adb`/`uiautomator2`/`scrcpy`) and 1 dedicated iPhone (`pymobiledevice3`/`xcrun devicectl`/WebDriverAgent) via `@thenetwork/core/runtime/process.ts` (`spawnProcess`) with proved battery (`35–80%`), thermal (`0–41°C`), monotone warm-up cap, single-owner expiring lease, `needsTakeover` CAPTCHA halt, and strict command-injection/SSRF validation. | **Implemented Now** | `~$30 / mo` *(2 carrier SIMs on existing phones)* |
| **Tier 3: Credit-Card APIs & Purchases** | Hardened plug-and-play adapters for email (`Resend`/`AgentMail`/fail-closed `SMTP_RELAY_URL`), telecom (`Twilio` SMS/Voice `/Calls.json`/Lookup v2 `sms_pumping_risk`, `Blooio`), flier printing (`Printful`/`4over`/`Lob`), `RentAHuman` MCP (`create_bounty`), `Dub.co` batch QRs (`POST`/`PATCH`), `Luma Plus` events, video/voice (`ElevenLabs`/`Hedra`/`Kling`), and fiat payouts (`Stripe Connect`/`Tremendous`) with strict spend binding (`C-03`). | **Adapters Implemented & Gated Now** | Pay-as-you-go *(blocked until env keys + `MARKETING_LIVE_BILLING=1` + `billingArmed=true` + spend caps)* |
| **Tier 4: External Humans, Street Teams & Creators** | Zero-human-intervention hiring, multi-city legal gating (NYLL § 191-d, CA AB5 W-2, London EPA 1990 Schedule 3A), applicant screening (`>= 75` auto-hire, `>= 50` standby bench), proof verification (FTC `#Ad` + likeness releases on `ops.ntwrk.party`), anti-fraud vesting, and fiat payout pipeline ([CITY-LAUNCH-PLAYBOOK.md](CITY-LAUNCH-PLAYBOOK.md), [NYC-STREET-TEAMS-AND-AGENCIES.md](NYC-STREET-TEAMS-AND-AGENCIES.md)). | **Automated Pipeline + Dossier Ready** | `$10,000` Month-1 NYC budget *(hard-enforced by `inv_budget_never_exceeded`)* |

---

## Canonical 5-Agent Brand Roster

`apps/marketing` coordinates five openly AI-branded agents defined once in `apps/marketing/src/constants.ts` and connected through ChatGPT, Claude, Gemini, or Surplus subscriptions:

| Agent | Target App | Primary Desire Lane | Primary -> Failover | Brand Role | Primary Growth Motion |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Chadwick** | `slop.date` | `soulmate_dating` | `chatgpt` -> `claude` | Blunt anti-swipe wingman | Street-interview creator briefs, dating comedy videos, bar & singles event activation |
| **Sloane** | `slop.date` | `soulmate_dating` | `claude` -> `chatgpt` | Razor-sharp red-flag auditor | Street-interview YouTuber/TikTok collabs, Nominate-a-Friend loops, unsent-draft & case-file shorts |
| **Peon** | `peon.biz` | `money_work` | `gemini` -> `claude` | Deadpan anti-LinkedIn fixer | Open-web GitHub/arXiv/Form-D/HN scouting, VC & employer BD, MCP/skill directory SEO, corporate jargon parodies |
| **Venn** | `friends.help` | `ideal_friends` | `claude` -> `gemini` | Warm local social director | Ticket-funded neighborhood dinners, Luma host partnerships, relocation & run-club activation (strict platonic framing) |
| **The Operator / Eliza** | `ntwrk.party` + `eliza.app` (Cross-App Ops) | `elite_serendipity` | `chatgpt` -> `claude` | Quiet high-trust concierge & ops coordinator | 28-archetype VIP bilateral & salon outreach (`< 75` words), Apollo enrichment, 10-platform playbooks, quality intake bridge, clickwrap contracting & proof verification |
