# Backup, restore and monitoring runbook

How the data is backed up, how a restore is tested and done, and what watches the live service. PRD 36.9 (data, backup and recovery), 28.5 ("backup restore tested"), 35.2 and 36.4 (alerts and budgets), 37.1 items 2, 11 and 12. Deploy steps are in [deploy.md](deploy.md); the schema and the service are in [runbook-real.md](runbook-real.md).

Nothing in this file is live until the backend is deployed. **[FOUNDER]** marks a decision or a number only the founder sets.

## 1. Targets

| Target | Value | Note |
|---|---|---|
| RPO (data we may lose) | **[FOUNDER]** placeholder: 24 hours | Railway daily backups give 24 h. Point-in-time recovery (PRD 36.9) would give minutes; it needs a plan that offers it. |
| RTO (time to serve again) | **[FOUNDER]** placeholder: 4 hours | The local drill takes under 10 minutes for a 14-day simulated pilot (section 3). Add the time to find the problem and to repoint the service. |
| Drill cadence | Before launch, then monthly, and after every migration that changes or moves data | Record each drill in the incident log (date, build id, the drill's summary line). |
| Nightly export | Every night, local files | Section 4. Remote upload stays off until the founder approves a bucket. |

## 2. What is backed up

- **The database.** One Postgres holds every schema: `network`, `platform`, `notify`, `oauth` and the ledger `public.__migrations`. Railway → Postgres → **Backups**: turn on daily backups **[FOUNDER] [CREDENTIALS]** (deploy.md 2.1). The Network's whole state (`network.network_state`) is in it, so a restore brings back review queues, safety cases and reports.
- **Not in the database.** Photos live in R2 (private bucket); a restore does not bring them back. The outbound queue's in-memory counters restart from zero (audit network-service-12). Secrets live in Railway variables only.

## 3. The restore drill

`scripts/restore-drill.ts` checks that a dump restores into a working backend. It runs on the local dev cluster (:54339) only.

```
bun run scripts/restore-drill.ts            # dump the dev database `network`
bun run scripts/restore-drill.ts --seed     # dump a freshly seeded database instead (14 simulated days)
bun run scripts/restore-drill.ts --keep     # keep the restored database to look at it
```

What it does: `pg_dump` (custom format), restore into a new database `restore_drill_<pid>`, run `migrate()`, compare the row count of every table in the `network`, `platform`, `notify` and `public` schemas, boot the backend on the copy (dry-run sends, a one-off staff token) and check `/healthz` and the staff `/health`, stop it and drop the copy. It prints one line per step and a JSON summary, and exits 1 on any mismatch or failed check.

Last local run (2026-10-08, `--seed`): 47 tables and 13,780 rows matched; `/healthz` and `/health` answered 200; the backend exited 0. 7.5 minutes, most of it seeding.

**A drill of the production backup** (before launch, then monthly) **[FOUNDER] [CREDENTIALS]**:

1. Railway → Postgres → Backups → restore the newest backup into a **new** Postgres service (never over the live volume).
2. From a machine with access, `pg_dump -Fc` that new database to a local file, then `pg_restore` it into a local database and run `bun run scripts/restore-drill.ts --url postgres://<you>@localhost:54339/<that database>`. The drill never connects to a remote host.
3. Compare the row counts with the live database (`select count(*)` on `network.members`, `network.messages`, `platform.people`) at the backup's time.
4. Delete the restored Railway service. Write the result in the incident log.

## 4. The nightly export

`scripts/export-nightly.ts` writes one JSON-lines file per table and a `manifest.json` (rows and sha256 per file) to `runs/exports/<date>/`. Message bodies, names, bios, facet values, notes, phone numbers, addresses and emails are replaced by `[scrubbed]`; tables with secrets or the whole Network state (sessions, codes, tokens, `network_state`, stored engine inputs) are left out. `--full` also writes a `pg_dump` next to it, which is **not** scrubbed and stays local.

Remote upload (PRD 36.9: "nightly export to R2") is behind two settings that stay unset: `EXPORT_UPLOAD_URL` and `EXPORT_UPLOAD_APPROVED=1` **[FOUNDER]**. Without both, `--upload` refuses and exits 2. Only the scrubbed files would go up.

## 5. Restore for real

1. Stop the damage: stop the `backend` service in Railway (nothing is sent while it is stopped; queued review items expire at their SLA instead of going out late).
2. Restore the last good backup into a **new** Postgres service (step 3.1). Never restore over the primary.
3. Run `bun run db:migrate -- --plan --url <new>` from a machine that can reach it. It lists pending migrations, changed baselines and edited migrations without applying anything. Then let the backend apply them at boot (`MIGRATE_ON_BOOT`, with `MIGRATION_DATABASE_URL` pointing at the new database).
4. Create the service login on the new database (deploy.md 2.1) or keep the old one if the restore kept its roles.
5. Point `NETWORK_DATABASE_URL` and `MIGRATION_DATABASE_URL` at the new database. Start the backend. Check `/healthz`, the staff `/health` (last tick, backlog), and that sends are still dry-run or as approved.
6. Check the monitor's alerts (section 6) for an hour. Write the incident down: the build ids, the backup time, what was lost between the backup and the failure.

## 6. Monitoring and alerts

The monitor (`packages/network/service/monitor.ts`) runs every 5 minutes, inside the backend with `MONITOR=1`, or on its own with `bun run scripts/monitor.ts` (`--once --state <file>` for a cron). It checks, per app:

| Check | Alert |
|---|---|
| `/healthz` (when given a URL or in process) | bad when it does not answer 200 |
| A network's last tick | bad after 10 minutes |
| Sends waiting for the sender (not quiet hours) | warn after 30 minutes |
| `queue_alert` events from the outbound queue | warn, per kind and line, for an hour |
| Blooio failures in the last 24 h | warn over 2%, bad over 10% (20 sends or more) |
| Review items | bad past the deadline or the app's SLA; warn when due within the hour |
| Safety reports | bad: urgent open over 1 hour, any report about a minor at once; warn: others over 24 hours |
| Stuck opportunities | warn: probing over 7 days, or still scheduled a day after the meeting |
| Invariant violations | bad, per rule, for 24 hours (the monitor runs the invariant job first) |
| `bias_report` events | warn on "alert", bad on "pause" |
| Spend | warn at 80%, bad at 100% of `COST_BUDGET_DAILY_USD` or `COST_BUDGET_MONTHLY_USD` |
| Pilot gates (PRD 37.3), last 7 days | bad when a pause threshold is crossed with 20 or more in the sample |

Each alert goes out once, again every 6 hours while it lasts (`ALERT_REALERT_MS`), and once more when it clears. Where alerts go:

| Variable | What |
|---|---|
| (always) | The process log: `[alert] firing bad <key>: <text>` |
| `ALERT_FILE` | JSON lines appended to that file |
| `ALERT_WEBHOOK_URL` | A JSON POST `{ text, alerts }` (an https URL only; Slack-style incoming webhooks accept it). A secret. **[FOUNDER] [CREDENTIALS]** |

Alerts never go out by SMS or iMessage: the member line is not an alert channel.

The invariant job (`packages/network/service/invariants.ts`) writes `invariant_violation` events, which the console counts: a probe or connection message without an approved review, a minor in a multi-person opportunity or sent a connection message, a send after an opt-out, a person over the cross-app daily cap, an outbound message that the leak guard refuses.

## 7. Costs

Every LLM call the backend makes is a row of `network.llm_usage` (model, tokens, cost, latency; never the text), through the usage hook in `packages/core/src/llm.ts`. Blooio messages per day are counted from `network.messages` into `network.usage_daily`; Workers AI calls are counted by the caller (`countUsage`). These numbers are founder numbers and stay unset until decided **[FOUNDER]**:

| Variable | What | Unset |
|---|---|---|
| `COST_BUDGET_DAILY_USD`, `COST_BUDGET_MONTHLY_USD` | All apps, one UTC day or month | No cost alert |
| `COST_TARGET_PER_MEMBER_USD` | Target cost per active member per month (PRD 36.4) | The scorecard shows the value without a target |
| `BLOOIO_COST_PER_MESSAGE_USD`, `WORKERS_AI_COST_PER_CALL_USD` | Unit prices | That kind counts as $0 |

## 8. Replaying an engine run

Each live engine run stores what it read (`network.matching_run_inputs`, migration 0016: the engine input with phone numbers scrubbed, the resolved config, the exposure debt, the model versions and the proposals) for 30 days. `bun run scripts/replay-run.ts --list` lists them; `bun run scripts/replay-run.ts <run id>` runs the engine again and diffs the proposals (exit 1 when they differ). Use the migration login: the table has member data and row-level security.
