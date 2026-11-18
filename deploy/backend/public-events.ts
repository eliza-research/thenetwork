import type { Clock } from "../../packages/core/src/clock.ts";
import type { SQL } from "../../packages/core/src/runtime/postgres.ts";
import { publicEventRefreshDue } from "../../packages/core/src/generated/publicEventCatalog.ts";
import { importPublicEvents } from "../../packages/network/service/import-public-events.ts";

export type PublicEventRefresh =
  | { kind: "lease_held" }
  | { kind: "not_due" }
  | { kind: "scanned"; published: boolean; events: number };

/**
 * The scheduled public event catalog refresh of the deployed backend. `sql` is the catalog's ingest login
 * (NETWORK_PUBLIC_EVENTS_DATABASE_URL) with room for two connections: one holds the session lease, the
 * importer publishes on the other. A failed scan throws to the tick round, which logs it.
 */
// spec/publicEventCatalog.md, "The backend scans once a day, at most one process at a time, and waits after a failed attempt"
export function createPublicEventRefresh(o: { sql: SQL; clock: Clock; request?: typeof fetch }): () => Promise<PublicEventRefresh> {
  let attemptedAt: number | undefined;
  return async () => {
    const lease = await o.sql.reserve();
    try {
      const [held] = await lease<{ locked: boolean }[]>`select pg_try_advisory_lock(hashtext('thenetwork-public-events-refresh')) as locked`;
      if (!held?.locked) return { kind: "lease_held" };
      try {
        const [last] = await lease<{ checked_at: Date | null }[]>`select max(checked_at) as checked_at from network.public_event_imports`;
        const asOf = o.clock.now();
        const checkedAt = last?.checked_at ? last.checked_at.getTime() : undefined;
        if (!publicEventRefreshDue(checkedAt !== undefined, checkedAt ?? 0, attemptedAt !== undefined, attemptedAt ?? 0, asOf)) return { kind: "not_due" };
        attemptedAt = asOf;
        const scan = await importPublicEvents(o.sql, o.clock, o.request);
        return { kind: "scanned", ...scan };
      } finally {
        await lease`select pg_advisory_unlock(hashtext('thenetwork-public-events-refresh'))`;
      }
    } finally {
      lease.release();
    }
  };
}
