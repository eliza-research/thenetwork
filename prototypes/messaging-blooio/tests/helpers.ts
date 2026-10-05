import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { SimClock } from "../../../packages/core/src/clock.ts";
import { SimBus } from "../src/adapters/sim-adapter.ts";
import { InMemoryDedupeStore } from "../src/dedupe.ts";
import { Gateway } from "../src/gateway.ts";
import { ConsentLedger, defaultCopy } from "../src/keywords.ts";
import { OutboundQueue, type QueueOptions } from "../src/outbound-queue.ts";
import type { ChannelAdapter, InboundMessage } from "../src/types.ts";

export const fixture = (name: string): string => readFileSync(resolve(import.meta.dir, "fixtures", name), "utf8");

// 2026-10-05 16:00Z = 09:00 PDT / 12:00 EDT (SimClock default).
export function world(opts: Partial<QueueOptions> & { extraAdapters?: Partial<Record<string, ChannelAdapter>> } = {}) {
  const clock = new SimClock();
  const bus = new SimBus(clock);
  const consent = new ConsentLedger(clock);
  const alerts: string[] = [];
  const queue = new OutboundQueue({
    clock, consent, adapters: { sim: bus.adapter(), ...(opts.extraAdapters ?? {}) },
    onAlert: (r, why) => alerts.push(`${r.idempotencyKey}:${why}`), ...opts,
  });
  const agentInbox: { msg: InboundMessage; optedOut: boolean }[] = [];
  const gateway = new Gateway({
    dedupe: new InMemoryDedupeStore(clock), consent, copy: defaultCopy("help@test"), queue,
    onMessage: (msg, { optedOut }) => { agentInbox.push({ msg, optedOut }); },
  });
  bus.subscribe((ev) => gateway.handle(ev));
  return { clock, bus, consent, queue, gateway, agentInbox, alerts };
}

export type FetchCall = { url: string; init: RequestInit };
export function mockFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: FetchCall[] = [];
  const fn = async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return responder(url, init); };
  return { fn, calls };
}
