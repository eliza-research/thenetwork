// The shared line for the backend (server.ts): one SharedLine, so one OutboundQueue, per Blooio line, built
// once and handed to every app's runtime with its app id (packages/network/service/shared-line.ts).
//   blooio          live: the Blooio API. An app sends with BLOOIO_ALLOW_SEND=1 and its <APP>_LIVE_APPROVED=1;
//                   the line's system replies (HELP, STOP/START, leave, "not open yet") with BLOOIO_ALLOW_SEND=1
//                   and any app live.
//   queue-dry-run   the default: the same queue and checks (quiet hours, caps, line safety, the reply window,
//                   the leak guard) against a recording fake provider; QUEUE_DRY_RUN_APPS (default every app)
//                   stands in for the live flags. Its state is stored apart from live state (mode 'dry_run').
//   dry-run         log only (NETWORK_CHANNEL=dry-run): the service's DryRunAdapter, no queue.
import type { SQL } from "bun";
import type { Clock } from "../../packages/core/src/clock.ts";
import { BlooioClient } from "../../packages/blooio/src/blooio/client.ts";
import { BlooioAdapter as ProviderAdapter, DryRunAdapter as RecordingProvider } from "../../packages/blooio/src/adapters/blooio-adapter.ts";
import { NETWORK_LINE, resolveSenderLine } from "../../packages/blooio/src/line.ts";
import { PgQueueStore } from "../../packages/blooio/src/pg-queue-store.ts";
import type { QueueOptions } from "../../packages/blooio/src/outbound-queue.ts";
import type { ChannelAdapter as Provider } from "../../packages/blooio/src/types.ts";
import { BlooioAdapter, type ChannelAdapter } from "../../packages/network/service/channel.ts";
import { appApproved, liveFlag, SharedLine } from "../../packages/network/service/shared-line.ts";
import type { NetworkRuntime } from "../../packages/network/service/runtime.ts";
import type { BackendConfig } from "./backend.ts";

export interface LineChannel {
  /** Undefined for the log-only dry run. */
  line?: SharedLine;
  /** The recording fake provider of the queue dry run (what would have been sent). */
  recorded?: RecordingProvider;
  /** For NetworkService's `adapter` option. Undefined: the service's log-only DryRunAdapter. */
  adapter?: (net: NetworkRuntime["net"], rt: NetworkRuntime) => ChannelAdapter;
  /** Bind the store to the service's pool and load the queue's state. Call before the service starts. */
  start(sql: () => SQL): Promise<void>;
  /** How this app's sends go, for the boot log. */
  label(app: string): string;
}

export interface LineChannelOptions {
  clock: Clock;
  env?: Record<string, string | undefined>;
  log?: (line: string) => void;
  /** Tests: the provider instead of the Blooio API or the recording fake. */
  provider?: Provider;
  /** Tests: queue options (caps). */
  queue?: Partial<Omit<QueueOptions, "clock" | "adapters" | "consent" | "store">>;
}

export function lineChannel(c: Pick<BackendConfig, "channel">, o: LineChannelOptions): LineChannel {
  const env = o.env ?? process.env;
  const log = o.log ?? console.log;
  if (c.channel === "dry-run") return { start: async () => {}, label: () => "dry-run" };
  const live = c.channel === "blooio";
  const from = resolveSenderLine(env) ?? (live ? undefined : NETWORK_LINE);
  let recorded: RecordingProvider | undefined;
  let provider = o.provider;
  if (!provider && live) provider = new ProviderAdapter(new BlooioClient({ apiKey: env.BLOOIO_API_KEY! }), from);
  if (!provider) {
    // Nothing leaves the machine: the inner provider is never called; the log line would hold the text, so it is dropped.
    recorded = new RecordingProvider({ kind: "blooio", send: async () => { throw new Error("dry run"); } }, () => {});
    provider = recorded;
  }
  let sql: (() => SQL) | undefined;
  const mode = live ? "live" : "dry_run";
  const store = new PgQueueStore(() => { if (!sql) throw new Error("the line's store is not bound yet (call start)"); return sql(); }, { mode });
  const line = new SharedLine({ provider, clock: o.clock, from, mode, env, log, store, hashKey: env.PLATFORM_HASH_KEY, ...(o.queue ? { queue: o.queue } : {}) });
  return {
    line, recorded,
    adapter: (net, rt) => new BlooioAdapter({ net, line, clock: o.clock, memberOf: rt.memberOf, app: rt.app.id, city: rt.city, log }),
    start: async s => { sql = s; await line.start(); },
    label: app => (live
      ? (appApproved(env, app, "live") ? "live" : `refused (${liveFlag(app)} is off)`)
      : (line.approved(app) ? "queue-dry-run" : "queue-dry-run (not open)")),
  };
}
