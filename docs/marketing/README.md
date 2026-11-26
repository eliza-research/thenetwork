# The Network Marketing System (`@thenetwork/marketing`)

This directory holds the strategy, technical Product Requirements Document (PRD), NYC street-team vendor dossier, and future `slop.cash` integration specification for The Network's autonomous marketing application (`apps/marketing`).

The system runs NYC-first across all four apps (`slop.date`, `ntwrk.party`, `peon.biz`, `friends.help`) and the `eliza.app` shared entry, then replicates to every additional city that The Network supports (`sf`, `la`, `chicago`, `miami`, and future metros).

---

## Non-Negotiable Guardrails

Every workflow, agent, adapter, and human hiring pipeline in `apps/marketing` obeys these hard rules from [AGENTS.md](../../AGENTS.md):

1. **No public portals on the four landing sites (2026-10-19 rule):** Do not add login links, dashboards, or campaign pages to `ntwrk.party`, `slop.date`, `peon.biz`, or `friends.help`. The Marketing Command Center runs locally on `127.0.0.1:4949` (or behind staff zero-trust access) for internal operators only.
2. **Zero-cash `packages/capital` wall (2026-11-23 rule):** Internal Network Capital stays non-transferable and zero-cash. All marketing budgets, contractor payments, and attribution ledgers live inside the separate `marketing.*` Postgres schema.
3. **18+ hard floor for hiring, events, filming, and payouts (`inv_adult_only_paid`):** People aged 13-17 follow the strict platform minor age policy, and no person under 18 (or with unknown age) is ever hired for street teams, event activation, or creator shoots, filmed for commercial ads, or paid in any marketing task.
4. **Zero gimmicky hardware:** Street execution relies on real humans, clean printed fliers with unique batch QR codes, in-person event activators, and street-interview YouTubers/creators generating verifiable social video proof.
5. **Single-owner `STOP` fence and daily caps (`inv_stop_fence_respected`):** Any contact marked `STOP` or opted out is blocked across all channels and agents immediately.
6. **Two-level formal modeling (Vibestack + Quint):** Pure policy and device safety decisions are specified in Vibestack ([spec/marketingPolicy.md](../../spec/marketingPolicy.md) and [spec/marketingDevice.md](../../spec/marketingDevice.md)) and published as generated TypeScript (`packages/core/src/generated/marketingPolicy.ts` and `packages/core/src/generated/marketingDevice.ts`) via `pnpm run spec:sync`. High-level state transitions and all 8 safety invariants are verified in the whole-flow Quint model ([spec/models/marketing_campaign.md](../../spec/models/marketing_campaign.md)).
7. **`slop.cash` stays OFF by default (`inv_slop_cash_disabled`):** The `slop.cash` integration is researched and specified for future open-source/dev-agent bounties only. It remains compiled as a disabled stub (`MARKETING_SLOP_CASH_ENABLED=0`) until explicit founder approval.

---

## Documentation Index

| Document | Purpose |
| :--- | :--- |
| [STRATEGY.md](STRATEGY.md) | NYC-first to multi-city growth strategy, `$10,000` Month-1 street-team and creator budget, 5-agent brand roster, 3-zone risk dial, zero-human BD, and organic viral loops. |
| [PRD.md](PRD.md) | Complete technical specification for `apps/marketing`: 4-tier architecture, ChatGPT/Claude/Gemini/Surplus subscription agent lifecycle manager, single-MacBook + Android + iPhone physical bridge, `marketing.*` Postgres schema, HTTP Command Center + REST API + CLI, automated hiring/proof engine, and Vibestack/Quint formal verification contract. |
| [NYC-STREET-TEAMS-AND-AGENCIES.md](NYC-STREET-TEAMS-AND-AGENCIES.md) | Concrete vendor dossier for NYC street teams, flier distribution, brand-ambassador agencies, Craigslist/RentAHuman gig hiring, street-interview YouTubers/creators, NYC legal rules, and zero-human email templates. |
| [SLOP-CASH-INTEGRATION.md](SLOP-CASH-INTEGRATION.md) | Ground-truth research and future integration contract mapping `marketing.tasks` and `marketing.proofs` to `slop.cash` vaults, Base/Solana USDC settlement, legal segregation from US consumer payouts, and the `MARKETING_SLOP_CASH_ENABLED=0` gate. |
| [spec/models/marketing_campaign.md](../../spec/models/marketing_campaign.md) | Whole-flow Quint state-machine model verifying all 8 core safety invariants and non-vacuity witnesses. |

---

## Quickstart Commands

Run all commands from the repository root on Node 26 + `pnpm`:

```bash
# 1. Apply Postgres migrations (includes repeatable 9004_marketing_schema -> apps/marketing/db/schema.sql)
pnpm run db:migrate

# 2. Start the Marketing Command Center + REST API (http://127.0.0.1:4949)
pnpm run marketing

# 3. Inspect and control campaigns, agents, devices, hires, proofs, and spend via CLI
pnpm run marketing:cli -- status
pnpm run marketing:cli -- agent list
pnpm run marketing:cli -- device scan
pnpm run marketing:cli -- discover nyc
pnpm run marketing:cli -- hire list
pnpm run marketing:cli -- spend summary
pnpm run marketing:cli -- risk-dial balanced

# 4. Run formal specification, generated-code, typecheck, and Vitest integration checks
pnpm run spec:sync
pnpm run spec:check-generated
pnpm run quint:check marketing_campaign
pnpm run typecheck
pnpm run test:integration
```

By default, all Tier 3 and Tier 4 paid adapters run in **safe dry-run mode** (`billingArmed = false`, `MARKETING_SLOP_CASH_ENABLED=0`). No external email, paid API call, print order, or payout executes until credentials are set and billing is explicitly armed.

---

## 4-Tier Phased Implementation Map

| Tier | Scope | Implementation Status | Incremental Cash Cost |
| :--- | :--- | :--- | :--- |
| **Tier 1: Zero-Cost Core** | Full runnable `apps/marketing` Node 26 service + CLI + Command Center, Vibestack generated policy/device cores (`packages/core/src/generated/`), whole-flow Quint model, `marketing.*` Postgres schema (`packages/db/migrate.ts`), ChatGPT/Claude/Gemini/Surplus 5-agent coordinator, zero-cost open-web NYC discovery, automated Craigslist/RentAHuman/agency/creator email & proof engine. | **Implemented Now** | `$0 / mo` *(uses existing AI subscriptions + local dev Postgres `:54339`)* |
| **Tier 2: Single-MacBook Local Phones** | Local physical bridge on 1 MacBook connected to 1 dedicated Android (`adb`/`uiautomator2`/`scrcpy`) and 1 dedicated iPhone (`pymobiledevice3`/`xcrun devicectl`/WebDriverAgent) via `@thenetwork/core/runtime/process.ts` (`spawnProcess`) with proved battery (`35-80%`), thermal (`<= 41°C`), warm-up cap, and single-lease guards. | **Implemented Now** | `~$30 / mo` *(2 carrier SIMs on existing phones)* |
| **Tier 3: Credit-Card APIs & Purchases** | Plug-and-play adapters for email (`Resend`/`AgentMail`), telecom (`Twilio Lookup v2`/Eliza Cloud deliver), flier printing (`Printful`/`4over`/`Lob`), `RentAHuman` MCP, `Dub.co` batch QRs, video/voice (`ElevenLabs`/`Hedra`/`Kling`), and fiat payouts (`Stripe Connect`/`Tremendous`). | **Adapters Implemented & Gated Now** | Pay-as-you-go *(blocked until env keys + `billingArmed=true` + spend caps)* |
| **Tier 4: External Humans, Street Teams & Creators** | Zero-human-intervention hiring, screening, clickwrap contracting, proof verification, and payout pipeline for NYC flierers, event activators, street-interview YouTubers/creators, and vetted NYC agencies ([NYC-STREET-TEAMS-AND-AGENCIES.md](NYC-STREET-TEAMS-AND-AGENCIES.md)). | **Automated Pipeline + Dossier Ready** | `$10,000` Month-1 NYC budget *(capped by `inv_budget_never_exceeded`)* |

---

## Canonical 5-Agent Brand Roster

`apps/marketing` coordinates five openly AI-branded agents connected through ChatGPT, Claude, Gemini, or Surplus subscriptions:

| Agent | Target App | Brand Role | Primary NYC Growth Motion |
| :--- | :--- | :--- | :--- |
| **Chadwick** | `ntwrk.party` / `slop.date` | Anti-swipe NYC wingman & connector | Street-interview creator briefs, dating calculator toys, bar & singles event activation |
| **Sloane** | `slop.date` | Razor-sharp red-flag auditor | Street-interview YouTuber/TikTok collabs, Nominate-a-Friend loops, profile roast videos |
| **Peon** | `peon.biz` | Deadpan anti-LinkedIn fixer | Open-web GitHub/arXiv/Form-D/HN scouting, VC & employer BD, MCP/skill directory SEO |
| **Venn** | `friends.help` | Energetic NYC social director | Ticket-funded neighborhood dinners, Luma host partnerships, relocation & run-club activation |
| **The Operator / Eliza** | `ntwrk.party` + `eliza.app` (Cross-App Ops) | Quiet high-trust NYC concierge & ops coordinator | 18-archetype VIP salon outreach, applicant screening, NYLL § 191-d contracting, proof verification & agency RFPs |
