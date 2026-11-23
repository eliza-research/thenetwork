import type { Event, FailureKind, ReceiptLifecycle, ReceiptPhase } from "../../packages/core/src/generated/outboundReceipt.ts";
import { DAY, HOUR, SimClock } from "../../packages/core/src/clock.ts";
import { OutboundQueue, recipientWindowHasher } from "../../packages/blooio/src/outbound-queue.ts";
import { ChannelSendError, type DeliveryStatus, type FailureClass, type SendReceipt } from "../../packages/blooio/src/types.ts";
import { withConformanceDatabase } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";

const unknownTtlMs = HOUR;
const PHASE_OF = new Map<string, ReceiptPhase>([
  ["sending", "Sending"], ["queued", "QueuedBeforeAcceptance"], ["accepted", "ProviderAccepted"], ["sent", "ProviderSent"], ["delivered", "ProviderDelivered"],
  ["read", "ProviderRead"], ["failed", "ProviderFailed"], ["unknown_acceptance", "AcceptanceUnknown"], ["failed_unknown", "AcceptanceExpired"],
  ["retry_scheduled", "RetryScheduled"], ["held_awaiting_reply", "WaitingForReply"], ["blocked", "ProviderBlocked"], ["expired", "OutsideReceipt"],
]);
const PROVIDER_STATUS: Partial<Record<ReceiptPhase, DeliveryStatus>> = {
  ProviderAccepted: "queued", ProviderSent: "sent", ProviderDelivered: "delivered", ProviderRead: "read", ProviderFailed: "failed",
};
const FAILURE: Record<FailureKind, FailureClass> = {
  UnknownResult: "unknown", Retryable: "retryable", NeedReply: "await_recipient", BlockedNumber: "blocked", TerminalError: "invalid",
};

type Pending = { resolve(receipt: SendReceipt): void; reject(error: unknown): void };
type Lane = {
  id: string;
  clock: SimClock;
  queue: OutboundQueue;
  pending?: Pending;
  started?: () => void;
  drain?: Promise<unknown>;
  allowClaim: boolean;
  autoFail?: ChannelSendError;
  lookup: () => Promise<SendReceipt>;
};

const ambiguous = () => Promise.reject(new ChannelSendError("receipt lookup has no answer yet", "unknown", 503, "lookup_pending"));

await withConformanceDatabase("outbound_receipt_conformance", async sql => {
  const lanes = new Map<string, Lane>();
  let counter = 0;

  function newLane(): Lane {
    const n = ++counter;
    const clock = new SimClock(Date.UTC(2026, 9, 9, 16));
    const queue = new OutboundQueue({
      sql, clock, line: `+1212555${String(1000 + n).padStart(4, "0")}`, app: "friends", instance: `receipt-worker-${n}`,
      recipientWindowKey: recipientWindowHasher("synthetic-recipient-window"),
      maxAttempts: 2, baseBackoffMs: 0, unknownTtlMs, ttlMs: 3650 * DAY, ttlProactiveMs: 3650 * DAY,
      checks: {
        live: () => true,
        admit: async () => lane.allowClaim ? { ok: true } : { ok: false, reason: "no further attempt in this journey", retryAt: clock.now() + DAY },
      },
      provider: {
        kind: "blooio",
        send: () => {
          if (lane.autoFail) return Promise.reject(lane.autoFail);
          return new Promise<SendReceipt>((resolve, reject) => {
            lane.pending = { resolve, reject };
            lane.started?.();
          });
        },
        receipt: () => lane.lookup(),
      },
    });
    const lane: Lane = { id: `receipt-conformance-${n}`, clock, queue, allowClaim: true, lookup: ambiguous };
    return lane;
  }

  async function drainUntilSend(lane: Lane): Promise<void> {
    const started = new Promise<void>(resolve => { lane.started = resolve; });
    lane.drain = lane.queue.drain();
    await Promise.race([started, lane.drain]);
    lane.started = undefined;
  }

  async function laneFor(key: string): Promise<Lane> {
    const existing = lanes.get(key);
    if (existing) return existing;
    const lane = newLane();
    lanes.set(key, lane);
    await lane.queue.enqueue(sql, [{
      id: lane.id, to: `+1646555${String(1000 + counter).padStart(4, "0")}`, kind: "compliance",
      text: "Your settings are saved.", timeZone: "America/New_York",
    }]);
    await drainUntilSend(lane);
    if (!lane.pending) throw new Error(`The queue did not claim ${lane.id}: ${await statusOf(lane)}`);
    lane.allowClaim = false;
    return lane;
  }

  async function statusOf(lane: Lane): Promise<string> {
    const [row] = await sql<{ status: string }[]>`select status from platform.outbound where id = ${lane.id}`;
    if (!row) throw new Error(`The outbound row ${lane.id} is missing`);
    return row.status;
  }

  async function phaseOf(lane: Lane): Promise<ReceiptPhase> {
    const status = await statusOf(lane);
    return PHASE_OF.get(status) ?? "OutsideReceipt";
  }

  async function settle(lane: Lane, outcome: { receipt: SendReceipt } | { error: unknown }) {
    const pending = lane.pending!;
    lane.pending = undefined;
    if ("receipt" in outcome) pending.resolve(outcome.receipt);
    else pending.reject(outcome.error);
    await lane.drain;
  }

  async function drainWith(lane: Lane, lookup: () => Promise<SendReceipt>) {
    lane.lookup = lookup;
    try { await lane.queue.drain(); } finally { lane.lookup = ambiguous; }
  }

  async function deliver(lane: Lane, event: Event): Promise<void> {
    const receiptId = `provider-${lane.id}`;
    switch (event.type) {
      case "recordAcceptance": {
        const status = PROVIDER_STATUS[event.providerPhase];
        if (!status) return;
        const receipt: SendReceipt = { providerMessageId: receiptId, status, chatId: "conformance-chat" };
        if (lane.pending) return settle(lane, { receipt });
        return drainWith(lane, async () => receipt);
      }
      case "applyReceipt": {
        const status = PROVIDER_STATUS[event.providerPhase];
        if (!status) return;
        await lane.queue.applyStatus({ kind: "status", channel: "blooio", providerMessageId: receiptId, at: lane.clock.now(), status });
        return;
      }
      case "holdUnrecordedReceipt": {
        const receipt: SendReceipt = { providerMessageId: "", status: "queued" };
        if (lane.pending) return settle(lane, { receipt });
        return drainWith(lane, async () => receipt);
      }
      case "confirmNeverAdmitted": {
        if (lane.pending) return;
        const code = event.neverAdmitted ? "not_found" : "lookup_pending";
        return drainWith(lane, () => Promise.reject(new ChannelSendError("receipt lookup", "unknown", 404, code)));
      }
      case "expireUnknown": {
        if (lane.pending) return;
        if (event.pastLimit) lane.clock.advance(unknownTtlMs + 1);
        return drainWith(lane, ambiguous);
      }
      case "recordProviderError": {
        const error = new ChannelSendError("provider error", FAILURE[event.failure], 500, `conformance_${event.failure}`);
        if (!lane.pending) return drainWith(lane, () => Promise.reject(error));
        await settle(lane, { error });
        if (event.failure !== "Retryable" || event.hasAttemptsLeft) return;
        lane.allowClaim = true;
        lane.autoFail = error;
        try { await lane.queue.drain(); } finally { lane.allowClaim = false; lane.autoFail = undefined; }
        return;
      }
    }
  }

  async function abandonAll() {
    for (const lane of lanes.values()) {
      if (lane.pending) await settle(lane, { error: new ChannelSendError("journey reset", "invalid", 400, "reset") });
    }
    lanes.clear();
    return null;
  }

  await serveJourney<Event>({
    reset: abandonAll,
    async dispatch(key, event) {
      const lane = await laneFor(key);
      const before = await phaseOf(lane);
      await deliver(lane, event);
      return (await phaseOf(lane)) === before ? "refused" : "accepted";
    },
    async observe(key): Promise<ReceiptLifecycle> {
      return { phase: await phaseOf(await laneFor(key)) };
    },
    observeOutput: () => null,
  });
  await abandonAll();
});
