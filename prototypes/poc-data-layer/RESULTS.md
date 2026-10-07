# P02 PoC: data layer results

Uncertainty being retired (PRD 22.1, 31.4, P02 exit criteria): **one Postgres with pgvector, plus a Postgres job table with leases, is enough for the MVP data layer, and PGlite can stand in locally.**

**Verdict:** the Postgres half holds. Every correctness invariant passed on real Postgres, and throughput and latency are well above MVP needs. PGlite works as a stand-in for schema, SQL semantics and single-session logic. It cannot stand in for anything involving concurrency. It also has a hard failure mode that long simulations will hit: the instance stops working after about 3k SQL errors. pgvector needs explicit tuning. With its defaults, a filtered top-50 query silently returns about 20 rows.

Run: 2026-10-06, Apple Silicon, 16 cores, Bun 1.4.2.
- Postgres: 16.11 (Homebrew) with pgvector 0.8.2. A throwaway cluster is created with `initdb` in a temp dir on port 54329, started with `fsync=off`, `shared_buffers=1GB` and `maintenance_work_mem=2GB`, then stopped. No Docker.
- PGlite: 0.5.8, which is PostgreSQL 18.3 compiled to wasm32, with `@electric-sql/pglite-pgvector` 0.0.9 (pgvector 0.8.1).
- Raw numbers are in `results/results.json`. Reproduce with `bun run bench`. A fast correctness subset runs with `bun test` (11 tests, about 5 s, both engines).

## Measured numbers

| # | Test | Postgres 16 + pgvector | PGlite 0.5.8 (PG18 wasm) |
|---|---|---|---|
| 1 | Migration `0001_network.sql` applies | yes, 47 ms | yes, 113 ms |
| 1 | Catalog fingerprint (columns, types, indexes, constraints, triggers, functions) | 160 entries | identical (160), once PG18's 80 catalogued NOT NULL constraints are excluded |
| 2 | 10k jobs, 8 workers, batch 1, no faults | **6,521 jobs/s** (1.53 s), exactly once | n/a |
| 2 | 10k jobs, 8 workers, 1% crash + 0.5% zombie, lease 500 ms | **1,736 jobs/s** (5.76 s). 102 crashes (connection dropped), 49 zombies fenced, 150 jobs reclaimed. Effects = 10,000, max 1 per job | 1,518 jobs/s, exactly once. The 8 workers are interleaved on one session, so SKIP LOCKED is never contended |
| 2 | Same with batch claim of 10 | 1,645 jobs/s, exactly once. 796 reclaimed and 261 fenced, because a crash abandons the whole batch | not run |
| 3 | Unique partial index, 8 racers inserting the same participant set (half in reversed order) and objective hash | 500/500 rounds: exactly 1 winner and 7 × `23505`, 0 other errors | 100/100 rounds (serialised) |
| 3 | Semantics: reordered set is a duplicate; another objective is allowed; DECLINED frees the slot; terminal duplicates are allowed | all pass | all pass |
| 4 | Advisory lock: 2 runners for `sf` plus 1 for `nyc`, `pg_try_advisory_xact_lock` | 200/200 rounds with exactly one `sf` runner; `nyc` ran 200/200; 0 overlapping `matching_runs` intervals | **cannot be tested**: 0/20 exclusive. One session, locks are re-entrant and transactions are serialised |
| 4 | Lock holder's backend killed (`pg_terminate_backend`) | lock released, the other runner proceeds | n/a |
| 6 | Erase a member, then scan all 11 tables (whole row cast to text) for id, name, phone and email, and every vector column for the member's embeddings | before: hits in 9 tables, 3 embeddings. **After: 0 rows, 0 embeddings.** `erasure_log` holds 1 row (sha256 of the id) | same: 0 rows, 0 embeddings |
| 6 | `events` append-only (UPDATE and DELETE outside erasure) | rejected (`P0001`) | rejected (`P0001`) |
| 6 | Physical bytes in relation files after erasure (CHECKPOINT, then grep) | after DELETE: heap of members, events and outbound; HNSW index; facets TOAST. **After VACUUM: facets TOAST still holds the embedding.** After VACUUM FULL: none | not checked |
| 7 | SQL errors one PGlite instance survives | n/a | **2,978**. Then `54001 stack depth limit exceeded` on every query, permanently. Reproduced on Node 24 too |

### 5. pgvector retrieval: top-50, `WHERE city = $1 ORDER BY embedding <=> $q LIMIT 50`, 1536 dims, cosine, HNSW m=16 and ef_construction=64

The query vector is a random existing member. Cities are split about 50/50, so the filter keeps about half the rows. Each row is 100 queries after 5 warm-up queries. Recall@50 is measured against an exact scan. "HNSW" rows steer the planner to the index with `enable_sort=off`.

| Engine | Members | Data | Load / index build | Exact scan p50 / p95 | Planner default | HNSW defaults (ef_search 40): rows returned, recall | ef 100 + iterative: p50 / p95, recall | ef 200 + iterative | ef 400 + iterative |
|---|---|---|---|---|---|---|---|---|---|
| PG16 | 300 | uniform | 0.02 s / 0.05 s | 0.47 / 1.02 ms | exact | 19.6 rows, 0.39 | 0.45 / 0.74 ms, 1.00 | 0.58 / 2.30, 1.00 | 0.75 / 2.87, 1.00 |
| PG16 | 5,000 | uniform | 0.4 s / 3.2 s | 4.16 / 4.73 ms | exact | 20.0 rows, 0.40 | 2.14 / 3.05 ms, 0.73 | 2.41 / 3.56, 0.85 | 3.45 / 4.10, 0.96 |
| PG16 | 50,000 | uniform | 4.1 s / 59 s | 46.5 / 51.6 ms | exact | 19.8 rows, 0.14 | 3.76 / 6.40 ms, 0.21 | 5.42 / 6.41, 0.26 | 9.64 / 10.6, 0.37 |
| PG16 | 50,000 | clustered (200 topics + noise) | 85 s / 11.7 s | 40.9 / 45.2 ms | exact | 20.4 rows, 0.38 | **0.63 / 0.90 ms, 0.96** | 0.63 / 0.96, 0.97 | 1.45 / 1.99, 0.97 |
| PGlite | 300 | uniform | 0.05 s / 0.29 s | 2.01 / 2.29 ms | exact | 19.6 rows, 0.39 | 2.08 / 2.23 ms, 1.00 | 2.09 / 2.33, 1.00 | 2.15 / 2.33, 1.00 |
| PGlite | 5,000 | uniform | 0.8 s / 15.2 s | 9.56 / 10.5 ms | exact | 19.8 rows, 0.39 | 6.44 / 7.43 ms, 0.74 | 6.42 / 6.96, 0.85 | 8.16 / 10.0, 0.96 |
| PGlite | 50,000 | uniform | 8.0 s / **876 s** (about 4.8 GB RSS) | 123 / 149 ms | exact | 19.6 rows, 0.14 | 16.1 / 18.3 ms, 0.22 | 16.9 / 21.4, 0.26 | 29.1 / 31.6, 0.38 |

Uniform random 1536-d vectors are a worst case for any approximate index: all distances are nearly equal. The clustered row is closer to real embeddings. Results need re-measuring with real embeddings once P12/P13 produce facets.

## P02 exit criteria

| Exit criterion | Result |
|---|---|
| Migrations identical on PGlite and PG18 | **Pass, with a caveat.** The same SQL file produces an identical catalog on PGlite (PG18.3) and Postgres 16.11. A real PG18 server with pgvector was not tested: Homebrew `postgresql@18` is installed but has no pgvector build. |
| Unique partial index rejects a second active opportunity for the same participant set and objective hash | **Pass** on both engines, including a 500-round, 8-way concurrent race on Postgres. |
| Advisory-lock exclusivity test | **Pass** on Postgres (200 rounds, plus release when the holder crashes). **Not testable** on PGlite. |
| Member deletion leaves 0 PII rows outside the retention table and 0 embeddings (row scan) | **Pass** on both engines. Physical purge is a separate gap; see risk 6. |
| (P01) 10k jobs across 8 concurrent workers run exactly once | **Pass** on Postgres, with crashes, zombies and lease reclaim. On PGlite it passes as a logic check only. |
| Projection rebuilt from events equals live tables (300 personas, 30 days) | **Not covered** by this PoC. |
| A profile sync leaves engine tables unchanged | **Not covered** by this PoC. |
| Built with Drizzle | **Not done.** The PoC uses raw SQL migrations. Drizzle would have to emit the IMMUTABLE functions, the generated column, the partial index predicate and the triggers as custom SQL. |

## Surprises and risks

1. **pgvector defaults silently return about 20 of 50 rows.** `hnsw.ef_search=40` caps the number of candidates, and the city filter then discards about half of them. Recall@50 is 0.39 with no error raised. The matcher must set `hnsw.ef_search >= 100` and `hnsw.iterative_scan = relaxed_order` (pgvector 0.8 or later) per transaction, and should assert `rows == LIMIT`.
2. **The planner never chose HNSW for the city-filtered query, even at 50k.** It picked the city btree plus an exact sort (41–47 ms p50 at 50k), which is fine for a batch matcher at MVP scale. To use the index you have to steer the planner, for example with `SET LOCAL enable_sort = off`, per-city partial HNSW indexes, or partitioning by city. With steering, clustered data reaches p50 0.63 ms at recall 0.96.
3. **Cached prepared statements hide plan changes.** Bun.SQL caches prepared statements. Once Postgres switches to a generic plan, later `SET enable_*` changes no longer affect it. The first benchmark run therefore labelled exact scans as "HNSW" (recall 1.0 at exact-scan latency). This is fixed with distinct statement text per configuration. Production code should set planner GUCs with `SET LOCAL` and check plans with `EXPLAIN (GENERIC_PLAN)`.
4. **PGlite stops working after about 3k SQL errors per instance.** The 2,978th caught `23505` leaves it permanently returning `54001`; inside a transaction it becomes `25P02`. This is not Bun-specific (reproduced on Node). Simulations that rely on catching unique violations will hit it within a few simulated weeks. Avoid it by using `ON CONFLICT DO NOTHING` in the sim path or by recycling the instance, and report it upstream.
5. **PGlite is a single session.** There is no SKIP LOCKED contention, advisory locks are re-entrant, and transactions are serialised. Every concurrency invariant from PRD 34.1 (job leasing, the duplicate-opportunity race, the matching lock) therefore has to run against real Postgres in CI. A Docker-free `initdb` cluster starts in about 1–2 s, so this is cheap. PGlite builds HNSW indexes about 5× slower than native Postgres at 5k (15.2 s vs 3.2 s) and about 15× slower at 50k (876 s vs 59 s, with about 4.8 GB of process memory). Exact scans are 2–4× slower. Use 5k members or fewer, or skip the HNSW index, for PGlite sims.
6. **Deletion is logical, not physical.** After `DELETE` and a plain `VACUUM`, the erased member's embedding bytes are still in the facets TOAST file. Only `VACUUM FULL` (or pg_repack) removes them. The HNSW index (cosine opclass) holds a separate normalised copy, which plain VACUUM did clear. WAL and backups were not examined. SEC-005 needs a defined physical-purge window: a periodic repack of `facets` and `intents`, plus WAL and backup retention.
7. **Erasure only works if references are explicit.** Cascades handle owned rows. Other references are redacted by `network.erase_member()`, which relies on these schema rules: every event lists the members it refers to in `subject_ids`; outbound messages list named members in `mentions`; opportunities carry `participants`. Job payloads are matched with `LIKE` on the id, which will be slow at scale, so jobs should get a `member_ids uuid[]` column. Free text that names a member without one of these references, such as another member's facet or an edge's evidence, is not caught. The scan only proves this for the seeded cases.
8. **Lease fencing is required, and batching multiplies rework.** Completion is guarded by `lease_token`. Without it, all 49 zombie completions would have doubled their effects. A crash with batch claims abandons the whole batch (796 reclaimed vs 150 at batch 1). Batch 1 already gives 6.5k jobs/s, orders of magnitude above MVP needs. External side effects such as SMS remain at-least-once and need `outbound_messages.idempotency_key`.
9. **Version skew.** PGlite is PG18, local native Postgres with pgvector is PG16, and the PRD targets PG18 in staging. They differ visibly: PG18 catalogues NOT NULL constraints, which added 80 fingerprint rows. CI should add a PG18 with pgvector target.
10. **Two schema details worth keeping.** The participant set key is computed by the database (an IMMUTABLE `network.participant_key()` feeding a STORED generated column), so callers cannot submit an unsorted set. The "active" state list lives in one IMMUTABLE function, used by both the partial index and erasure.

## Files

- `migrations/0001_network.sql`: the `network` schema. Tables: members, facets and intents with `vector(1536)` and HNSW, edges, opportunities with a unique partial index, participations, outbound_messages, jobs with leases, job_effects, matching_runs, append-only events, erasure_log. Function: `erase_member()`.
- `src/cluster.ts`: throwaway Postgres 16 cluster (initdb / pg_ctl).
- `src/db.ts`: a minimal `Db` interface over Bun.SQL and PGlite; migrate; catalog fingerprint.
- `src/suite.ts`: experiments 2–6.
- `src/bench.ts`: full measurements into `results/results.json`.
- `test/data-layer.test.ts`: fast correctness tests on both engines.

## Fixes (2026-10-06)

The findings above are kept as originally measured. The fixes below are in `migrations/0002_fixes.sql` and in new modules under `src/`. They are tested in `test/fixes.test.ts`: 26 tests, about 55 s, on Postgres 16.11 with pgvector 0.8.2 and on PGlite 0.5.8. The original `test/data-layer.test.ts` still passes (11/11). Retrieval and purge measurements are in `results/fixes.json`; reproduce them with `bun run bench:fixes`.

The same catalog now has 201 entries on both engines, and the fingerprint is still identical between PGlite and PG16.

### 1. `nearestMembers(tx, city, vec, k)` (`src/retrieval.ts`)

What the helper does:
- **Per-transaction settings.** It sets `hnsw.ef_search = max(100, 2·inner)` (capped at 1000), `hnsw.iterative_scan = relaxed_order`, and `plan_cache_mode = force_custom_plan`. All three are set with `set_config(..., true)`, so they last only for the transaction. If it is not given a transaction, it opens one.
  - The ANN subquery fetches `inner = 2k` facet rows and then de-duplicates by member, because a member can have several facets. For k=50 this gives ef_search=200.
- **Query text.** The city is a literal checked against an allowlist, and the statement text is distinct for each (city, k).
  - The planner can only prove the partial-index predicate `city = 'sf'` from a literal. The test shows this: `EXPLAIN (GENERIC_PLAN)` with `city = $1` does not use the index.
  - Plans are re-made for every execution. The test runs the same text 12 times, and EXPLAIN still shows `facets_embedding_hnsw_sf` every time.
- **Fallback.** If the ANN path returns fewer than k members, the helper re-runs the query as an exact scan (`GROUP BY member_id ORDER BY min(distance)`), which no index can serve. The result therefore has exactly k rows whenever at least k candidates exist.
  - Fewer than k candidates returns all of them: a test city with 30 members returns 30.
  - The test forces an under-return by giving one member 300 near-duplicate facets. ANN returns fewer than 50 members, and the exact fallback returns 50 distinct members.
- **Logging.** Every call logs `{plan: "ann" | "exact-fallback", efSearch, rows, annRows, ms}`. It warns when the fallback found more rows than ANN. With `explain: true` it also reports the index that EXPLAIN shows.

Measured on clustered data (200 topics plus noise), k=50, 50–100 queries, recall measured against an exact scan:

| Members | Planner choice (unsteered) | Rows returned (min) | Recall avg / worst query | p50 / p95 |
|---|---|---|---|---|
| 5,000 | exact (seq scan): correct at 2.5k rows per city | 50 | 1.00 / 1.00 | 6.3 / 7.8 ms |
| 5,000, steered to ANN | `facets_embedding_hnsw_<city>` | 50 | 1.00 / 0.98 | 2.5 / 3.0 ms |
| 50,000 | `facets_embedding_hnsw_<city>` | 50 | 0.99 / 0.92–0.94 | 1.7 / 2.2 ms |

None of these runs needed the exact fallback. PGlite at 2k members, steered to ANN, with k=20: 20 rows and recall ≥ 0.95. Latencies include the transaction and the `set_config` round trip.

### 2. Index layout for the city filter: **per-city partial HNSW indexes** (chosen)

Three layouts were measured on the same data, all queried through `nearestMembers` (`src/retrieval-bench.ts`):

| 50k clustered | Build | Index size | Planner, unsteered | p50 / p95 | Recall avg / worst |
|---|---|---|---|---|---|
| Global HNSW plus city filter (original) | 16.6 s | 410 MB | HNSW (with this query shape) | 1.57 / 3.13 ms | 0.96 / **0.06** |
| **Per-city partial `WHERE city = 'sf'`** | 14.2 s | 410 MB | partial HNSW | 1.66 / 2.16 ms | **0.99 / 0.94** |
| List partitions by city, HNSW on each | 30.2 s (includes copying rows) | 410 MB | partition HNSW | 7.1 / 15.3 ms | 0.99 / 0.90 |

At 5k members every layout reaches recall 1.0. Planner-chosen latency is 5–7 ms (seq scan); steered to ANN it is 2.5–2.9 ms.

**Choice: per-city partial indexes.** The deciding numbers:
- **Global index, worst-case recall 0.06.** Even with iterative scan, some filtered queries lose most of their true neighbours. A partial index's graph holds only that city's rows, so nothing is filtered away.
- **Partitioning, recall about the same.** Its recall matched the partial indexes, but it was slower in this run. Part of that is probably the cold cache of a freshly copied table.
- **Partitioning, schema cost.** It would change the primary key to `(id, city)` and complicate foreign keys, for no measured gain.

The one argument for partitioning is the purge: `VACUUM FULL` could rewrite only the erased member's city partition (see section 3). The migration drops `facets_embedding_hnsw` and creates `facets_embedding_hnsw_sf` and `_nyc`. Each new city needs its own partial index, created with `CREATE INDEX CONCURRENTLY` in the city-launch runbook.

### 3. Erasure: `jobs.member_ids` and the physical purge (`src/purge.ts`)

**Jobs reference members explicitly.**
- `jobs.member_ids uuid[] NOT NULL DEFAULT '{}'`, with the GIN index `jobs_member_ids_gin`.
- `erase_member()` v2 matches jobs with `member_ids @> ARRAY[p]`; the `LIKE` scan of `payload::text` is gone. EXPLAIN ANALYZE over 50k jobs shows `jobs_member_ids_gin`.
- Producers must fill `member_ids`. A job that names a member only inside `payload` is no longer caught, so this is a contract on producers.
- v2 also deletes opportunities whose only participant was the erased member. The old function would have violated `cardinality(participants) >= 1` on them.

**Physical purge.**
- `erase_member()` enqueues one coalesced `physical_purge` job per window. Its idempotency key is `physical_purge:<date>T03`, it is due at the next 03:00 UTC (always within 24 h), and its payload carries a deadline of erasure + 24 h.
- `runPurgeJobs()` claims the job with a lease. It runs `VACUUM (FULL, ANALYZE)` on all 11 tables that can hold member data, then `VACUUM (FULL) pg_catalog.pg_statistic`, then `CHECKPOINT`, and completes the job with the fencing token.

**Byte-scan evidence** (Postgres, 2,001 members). Every file under the data directory (about 1,050 files, 110 MB) was searched for the erased member's name, the id as text and as 16 binary bytes, and the first 64 bytes of each embedding, both raw and L2-normalised:

| Stage | Where the erased member's bytes were found (pg_wal excluded) |
|---|---|
| After `erase_member()` + CHECKPOINT | heap of members, events, facets, intents, jobs, profiles, engine_member_state; their PK, GIN and btree indexes; **TOAST of facets, intents and engine_member_state** (raw embeddings); **`facets_embedding_hnsw_sf`** (normalised embedding); **`pg_statistic` and its TOAST** (ANALYZE samples of the name and id) |
| After plain `VACUUM` + CHECKPOINT | still present in the facets heap and its TOAST, 5 indexes, and `pg_statistic` |
| **After the purge job** | **nothing** |

New finding: `pg_statistic` keeps sampled column values, including PII, for any analysed column. The old row versions survive a re-ANALYZE until `pg_statistic` itself is rewritten, which needs superuser. The purge job therefore runs as a maintenance role with superuser rights.

**Purge cost.**
- `VACUUM FULL` of `facets` took 1.2 s at 2k members, 2.3 s at 5k, and **38 s at 50k**, because it rebuilds both HNSW indexes. It holds ACCESS EXCLUSIVE for that whole time, which blocks matching in every city.
- That is why the purge runs in a 03:00 UTC window, coalesced to one per day. Beyond about 50k facets, use `pg_repack`, which takes only short locks, or partition `facets` by city.

**WAL and backups cannot be scrubbed.** After the purge, `pg_wal` still contains every needle. Proposed policy, which the PRD needs to adopt:
- WAL archives and base backups are encrypted and expire after **N = 30 days**.
- No restore may run after an erasure without re-applying `erasure_log`. Its rows hold only sha256 hashes of member ids, so they can identify an erased member to remove again after a restore.
- So erasure is logical immediately, physical in live files within 24 h, and complete in backups within 30 days.
- Disk blocks freed by the rewrite are not zeroed. Rely on volume encryption for those.

### 4. PGlite error accumulation (`repro/`)

- `repro/pglite-error-limit.ts` is the minimal repro. It needs only `@electric-sql/pglite` and behaves identically on Bun 1.4.2 and Node 24.15.
- **Any** caught error counts, not only unique violations. Errors survived before the instance fails:
  - 2,978 for `23505` and for `RAISE`;
  - 1,872 for division by zero;
  - 1,511 for syntax errors, which crash the wasm module (`Out of bounds memory access … _PostgresMainLongJmp`, then `Aborted()`).
- 0.5.8 is the latest version on npm. The upstream issue text is drafted, not filed, in `repro/ISSUE.md`.

**Fix in the sim path** (`src/sim.ts`). Every sim-facing insert helper now uses `INSERT … ON CONFLICT DO NOTHING RETURNING` and returns the new key, or null for a duplicate. The helpers cover member, opportunity (the arbiter is the unique partial index), participation, edge, job and outbound message.

Test: 5,000 duplicate opportunity inserts (half with the participants reversed) plus 50 duplicate member inserts on one PGlite instance. Exactly 1 row is created and no errors are raised. The instance stays healthy, and a raw INSERT still gets `23505`.

Bun.SQL trap found along the way: a JS string bound to `$1::jsonb` is stored as a JSON *string* (`jsonb_typeof = 'string'`). Use `$1::text::jsonb`.

### 5a. Projections rebuilt from events

The event log is now complete for members, opportunities and participations:
- AFTER-ROW triggers (`network.emit_snapshot`) append a snapshot event (the full row after the change) or a tombstone (key only) in the same transaction.
- `network.rebuilt_<projection>()` takes the latest non-redacted event per key and drops tombstones.
- `network.projection_diff()` compares the rebuilt rows with the live ones using `to_jsonb` and EXCEPT in both directions.

Erasure stays consistent with replay:
- Redaction happens first.
- Rows changed by erasure emit fresh snapshots that no longer contain the member: scrubbed opportunities, and `invited_by` set to NULL.
- Changes to rows about the erased member emit nothing.
- Tombstone subjects are limited to members that are part of the key, so redacting one cannot resurrect a row.

Results:
- **Workload:** a randomized run of 5,006 events (seed 11). It covered 488 member creates, 435 updates, 122 deletes (with cascades), **89 erasures**, 574 opportunity creates, 419 transitions, 133 deletes, 485 participation updates and 173 deletes.
- **Diff:** 0/0 for all three projections, on both Postgres and PGlite.
- **Negative control:** a write made with triggers bypassed (`session_replication_role = replica`) is detected as a 1/1 diff.
- **Event ordering:** row locks order concurrent writers to the same key, so event id order matches commit order per key.
- **Trade-off:** these are change-data events, not domain events. Domain events can still be appended alongside them; the snapshots are what make the rebuild exact.

### 5b. Profile sync is separate from engine-learned state

- `network.profiles` holds synced profile data: headline, bio, links, source and `source_rev`. `network.engine_member_state` holds the learned embedding, affinity and response rate. Both are new tables.
- `syncProfile()` writes only the members' contact fields and `profiles`, and declares `network.writer = 'profile_sync'`.
- Statement triggers on the engine tables (`engine_member_state`, `facets`, `intents`, `edges`) reject any write from such a transaction with `P0001`.

Test: 300 syncs over 50 members, with source revisions changing. The fingerprint of all four engine tables is unchanged; it covers both content and `xmin`, so even no-op updates would show. A buggy sync that updates `engine_member_state` is rejected. This passes on both engines.

### 6. Outbound idempotency (`src/outbound.ts`)

`outbound_messages.idempotency_key` is now `UNIQUE NOT NULL`, with new columns `status ∈ {queued, sending, sent, failed}`, `provider_message_id`, `send_attempts` and `sent_at`.

The send job runs these steps:
1. Insert the row with `ON CONFLICT (idempotency_key) DO NOTHING`.
2. Lock the row. If it is `sent`, stop. Otherwise remember whether an earlier attempt reached `sending`, then mark it `sending`.
3. If an earlier attempt reached `sending`, look up the key at the provider first.
4. Otherwise send, using the same key as the provider's Idempotency-Key (Blooio honours it), and mark the row `sent`.

The mock provider dedupes by key and counts every call.

Test results:

| Scenario (both engines) | Rows | Provider deliveries | Provider `send` calls |
|---|---|---|---|
| Crash after the row insert / after marking `sending` / after the provider accepted / after marking `sent`. Each time the lease expires, the job is reaped and retried. | 1 | 1 | **1** (a lookup reconciles the "after provider" case) |
| 1,000 sends, each enqueued twice, 8 workers, 5% crashes at random points (51 crashes) | 1,000 | 1,000 | **1,000** (25 lookups, 16 reconciled, 11 already sent) |
| Zombie: the lease expires while the worker is inside the provider call, and a retry runs concurrently | 1 | 1 | 2 (1 replay absorbed by the provider key) |

The zombie row is the remaining exposure. A lookup cannot see a send that is still in flight, so the guarantee of one delivery depends on the provider honouring the idempotency key. Keys must not contain PII: the erasure scan flagged keys built from a member's name.

### Updated exit criteria

| Exit criterion | Result |
|---|---|
| Projection rebuilt from events equals live tables | **Pass** on both engines: 5,006 randomized events, including 89 erasures. |
| A profile sync leaves engine tables unchanged | **Pass** on both engines. Separate tables, a content + `xmin` fingerprint, and a guard trigger. |
| Member deletion: 0 PII and 0 embeddings, physically | **Pass** for live relation files after the purge job, within 24 h. WAL and backups are covered by the 30-day retention policy above. |

### New files

| File | Contents |
|---|---|
| `migrations/0002_fixes.sql` | All schema changes above |
| `src/retrieval.ts` | `nearestMembers` |
| `src/retrieval-bench.ts` | Index-layout comparison |
| `src/purge.ts` | Purge job runner and data-directory byte scan |
| `src/sim.ts` | `ON CONFLICT` insert helpers |
| `src/projections.ts` | Randomized workload and diff |
| `src/profile.ts` | `syncProfile` and the engine-table fingerprint |
| `src/outbound.ts` | Send job, mock provider and crash injection |
| `src/bench-fixes.ts` | Fixes measurements |
| `test/fixes.test.ts` | Tests for fixes 1–6 |
| `repro/pglite-error-limit.ts` | Minimal repro of the PGlite error limit |
| `repro/ISSUE.md` | Draft upstream issue (not filed) |
