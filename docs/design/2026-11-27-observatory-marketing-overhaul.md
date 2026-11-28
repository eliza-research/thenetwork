# Observatory & Marketing Engine Production Overhaul Design

Date: 2026-11-27
Status: Approved for implementation

## 1. Goals

1. Remove UI clutter, broken data bindings, and ad-hoc vanilla-JS divergence in `apps/marketing` and `apps/observatory`; align both consoles on React 19, `@thenetwork/ui`, and `@thenetwork/design-system` tokens.
2. Prepare data storage, trajectory recording, analytics, and outreach pacing for 1,000,000 realtime users without overloading Postgres or violating platform terms of service or privacy laws.
3. Deliver unified, game-like full-system simulation across both Observatory and Marketing Engine backed by stateful external HTTP mock services (`packages/mock-services`) and a dual pre-canned + LLM (`gpt-6-luna`) response engine.
4. Wire first-party, privacy-safe, age-safe site visit, attribution, intent, and cohort retention tracking end-to-end across the four brand sites, platform API, ConsentNetwork, Marketing Engine, and Observatory.

## 2. Architecture Decisions & Design Defense

### 2.1 Four-Tier Realtime Data & Trajectory Architecture

- **Tier 1 (OLTP Postgres):** Normalized relational state, monthly range-partitioned logs (`messages`, `events`, `outbound`, `attribution_events`, `trajectory_manifests`), composite indexes, PgBouncer transaction-mode pooling, and primary/read-replica separation.
- **Tier 2 (Hot Cache):** `HotCache` abstraction (`MemoryHotCache` on `Clock` for dev/sim; Valkey 8 for production) fronting rate limits, sessions, `contact_fence`, materialized Observatory/Marketing snapshots, and WS/SSE Pub/Sub.
- **Tier 3 (Streaming & Queues):** Cloudflare Pipelines + Cloudflare Queues + Postgres transactional outbox (`SELECT ... FOR UPDATE SKIP LOCKED`).
- **Tier 4 (Data Lake & Trajectory Store):** Dedicated private Cloudflare R2 bucket (`TRAJECTORY_R2_BUCKET`) storing batched `NDJSON.zst` (Node 26 native `zstdCompress`) and compacted Iceberg Parquet files, paired with a compact Postgres manifest index (`analytics.trajectory_manifests`) and O(1) GDPR Art. 17 crypto-shredding via per-person AES-256-GCM DEKs (`analytics.trajectory_deks`). Minor/under-13 spans store redacted structural metadata only.

**Two alternatives considered:**
1. *All-in-Postgres (`jsonb` + TimescaleDB/Citus):* Rejected at 1M users due to 10×–30× higher storage/IOPS cost ($1.8k–$4k/mo vs ~$25–$60/mo on R2+DuckDB), `pg_dump` bloat, slow multi-step funnel/cohort scans, and table-rewrite friction on GDPR erasure.
2. *Enterprise Kafka + ClickHouse + Snowflake from Day 1:* Rejected for launch/growth due to $1.5k–$3k/mo fixed floor, cross-cloud egress fees, heavy operational overhead, and poor offline/sim parity. Writing open Iceberg/Parquet to R2 lets ClickHouse attach at 500k+ users with zero data migration.

### 2.2 External HTTP Mock Services & Dual Response Engine

- `packages/mock-services` runs real loopback HTTP servers (`serveHttp`) for Social (X, Instagram, TikTok, Reddit, LinkedIn, Discord), Messaging/Email (Blooio v4/v1 with real HMAC webhooks, Twilio, Resend/SendGrid/Postmark/AgentMail with Svix webhooks), Ads (Meta/Google/TikTok), S3/R2 XML + Multipart, Web Analytics Beacon + Dub.co shortlinks, and Discovery — with synced `SimClock`, seeded `Rng`, `/_mock/traffic` SSE log, and live Chaos injection.
- `DualResponseEngine` (`packages/sim/src/responseEngine.ts`) separates deterministic behavioral choices from generated text across `canned`, `hybrid`, and `llm` modes via `defaultLLM()` (`gpt-6-luna`) with shared `LLMBudget`, caching, leak scrubbing, and automatic graceful fallback to `canned`.

**Two alternatives considered:**
1. *In-process `global.fetch` monkey-patching:* Rejected because it hides real HTTP serialization, header signing, multipart S3 uploads, retry/timeout behavior, and multi-process testing.
2. *Always-on live LLM for every simulated turn:* Rejected because LLM calls introduce non-determinism, over-acceptance bias, and prohibitive cost/latency at 100×–1000× game speeds.

### 2.3 High-Volume Scale & Platform ToS Compliance

- 5-level atomic GCRA hierarchical token buckets (`Org -> Platform -> Account -> Campaign -> Recipient/MX`), AIMD adaptive concurrency respecting `Retry-After`, multi-signal circuit breakers persisted in Postgres, seeded quiet-hours wakeup jitter (`09:00–10:15`), and priority-lane load shedding (`P3` cold sheds before `P0` compliance).
- Fail-closed `ComplianceGate` (`GREEN`/`AMBER`/`RED`) blocking phone-farm automation, unauthenticated scraping, cold SMS without PEWC, and consumer CLI subscription automation in staging/production; direct Blooio bypass removed from `paid.ts`; fail-closed `PgNetworkCoreBridge`; bidirectional Global Suppression Sync; RFC 8058 one-click unsubscribe + CAN-SPAM postal address + `ComplianceCopyLinter` + 64-bit `SimHash` near-duplicate guard.

**Two alternatives considered:**
1. *Fixed-window in-memory rate limiters:* Rejected because fixed windows double bursts across boundaries and lose state across replicas/restarts.
2. *Soft warning-only compliance flags:* Rejected because accidental misconfiguration on shared carrier lines or unconsented SMS creates catastrophic TCPA/platform-ban blast radius across all four apps.
