import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Event, ReceiptPhase, TurnReceipt } from "../../packages/core/src/generated/turnReceipt.ts";
import { SimClock } from "../../packages/core/src/clock.ts";
import { serveHttp, type HttpServer } from "../../packages/core/src/runtime/http.ts";
import { TURN_PATH, TURN_RECEIPT_PATH, type NetworkRouteAuthorityV1, type TurnReceiptRequest, type TurnRequest } from "../../packages/core/src/svc/contract.ts";
import { svcSign } from "../../packages/core/src/svc/svc-auth.ts";
import { DryRunAdapter } from "../../packages/network/service/channel.ts";
import { NetworkService } from "../../packages/network/service/service.ts";
import { withConformanceDatabase } from "./conformanceDatabase.ts";
import { serveJourney } from "./serveJourney.ts";

// One key is one gateway receipt for a member's handled STOP turn, sent through the signed POST /internal/turn-receipt of a staging
// service with a route authority policy. The shell (recordSignedTurnReceipt) takes every step of one receipt inside one
// request, between two database reads, so no step can be held open from outside. The worker therefore keeps, per key,
// the facts of the steps the spec has accepted, and reads the current step from the real service: each observation
// makes a fresh handled STOP through POST /internal/turn, gives the stored turn and the receipt the accepted facts, gives
// every later step the facts that make it fail, and sends the receipt. The step that answers is where the shell is: a
// failure of a step with no accepted facts is that step still waiting, a failure of a step with accepted facts is its
// end state, and a stored receipt before recordReceipt is the write the shell is about to make. A step the shell skips or
// takes out of order answers with another step's failure. The stored turn changes authority while the receipt request
// waits on the turn's row lock, because the service checks the authority once before the lock and again after it.

type Previous = Omit<Extract<Event, { type: "readPrevious" }>, "type">;
type Scope = Omit<Extract<Event, { type: "checkScope" }>, "type">;
type Delivery = Omit<Extract<Event, { type: "checkDelivery" }>, "type">;
type Facts = { handled?: boolean; validAuthority?: boolean; previous?: Previous; scope?: Scope; delivery?: Delivery; recorded?: true };
type Receipt = { facts: Facts; phase?: ReceiptPhase };

const START = Date.UTC(2026, 9, 9, 16);
const DAY = 86_400_000;
const SECRET = "synthetic-turn-receipt-conformance-secret";
const AUTHORITY: NetworkRouteAuthorityV1 = { version: 1, routeId: "receipt-route", generation: "g1", audience: "receipt-qa", realmId: "receipt-qa" };
const MEMBER = "+12125551234";
const STRAY_REPLY = "receipt-conformance-stray-reply";

const NEXT: Partial<Record<ReceiptPhase, Event["type"]>> = {
  ReadingTurn: "checkTurn", CheckingAuthority: "checkAuthority", CheckingPrevious: "readPrevious", CheckingScope: "checkScope",
  CheckingDelivery: "checkDelivery", AwaitingEmptyWrite: "recordReceipt", AwaitingReplyWrite: "recordReceipt",
};

const delivered = (outcome: TurnReceiptRequest["outcome"]) =>
  outcome === "accepted" ? "sent" : outcome === "unknown" ? "send_unknown" : "refused_gateway";

await withConformanceDatabase("turn_receipt_conformance", async (sql, url) => {
  // Staging is the only realm where the service enforces a route authority.
  await sql`update platform.settings set value = 'staging' where key = 'environment'`;
  const clock = new SimClock(START);
  const service = new NetworkService({
    url, clock, instance: "turn-receipt-conformance", photoStorage: null,
    env: {
      PLATFORM_ENV: "staging", PLATFORM_HASH_KEY: "synthetic-turn-receipt-conformance-key", SERVICE_TURN_SECRET: SECRET,
      NETWORK_ROUTE_AUTHORITY_POLICY: JSON.stringify({ authority: AUTHORITY, admitUntil: START + 30 * DAY, drainUntil: START + 60 * DAY }),
    },
    networks: [{ id: "ntwrk:nyc", matchingEnabled: false }, { id: "slop:nyc", matchingEnabled: false }, { id: "friends:nyc", matchingEnabled: false }],
    network: { seed: 1 },
    adapter: () => new DryRunAdapter(() => { throw new Error("A receipt test sent a message"); }),
    log: () => {},
  });
  let server: HttpServer | undefined;
  try {
    await service.start();
    const http = await serveHttp({ hostname: "127.0.0.1", port: 0, fetch: request => service.fetch(request) });
    server = http;
    const receipts = new Map<string, Receipt>();
    let cases = 0;

    async function post(path: string, id: string, body: string): Promise<Response> {
      return fetch(new URL(path, http.url), {
        method: "POST", body, signal: AbortSignal.timeout(20_000),
        headers: { "content-type": "application/json", ...await svcSign(SECRET, { method: "POST", path, id, body, nowS: Math.floor(clock.now() / 1000) }) },
      });
    }

    let turns = 0;
    async function sendTurn(text: string) {
      clock.advance(60_000);
      const turn: TurnRequest = {
        messageId: `receipt-turn-${++turns}`, from: MEMBER, text, channel: "blooio", to: null, transport: "imessage",
        receivedAt: clock.now(), app: "friends", networkAuthority: AUTHORITY,
      };
      const response = await post(TURN_PATH, turn.messageId, JSON.stringify(turn));
      const body = await response.json() as { outcome?: string; replyIds?: string[]; replyKind?: string; memberId?: string | null };
      if (response.status !== 200 || body.outcome !== "handled") throw new Error(`The turn ${text} answered ${response.status}: ${JSON.stringify(body)}`);
      return { id: `msg:blooio:${turn.messageId}`, messageId: turn.messageId, body };
    }

    // One friends member, onboarded by text; each receipt case is a STOP of that member after a START.
    for (const text of ["friends.help", "Talia, 29", "I enjoy hiking and cooking", "Saturday afternoons work for me", "Small groups are good"]) await sendTurn(text);

    /** A handled STOP of the member: one collected compliance reply, stored in the member's history. */
    async function handledTurn(): Promise<{ id: string; messageId: string; replyIds: string[] }> {
      if (++cases > 1) await sendTurn("START");
      const { id, messageId, body } = await sendTurn("STOP");
      if (body.replyKind !== "compliance" || !body.memberId || body.replyIds?.length !== 1) throw new Error(`The STOP turn answered ${JSON.stringify(body)}`);
      return { id, messageId, replyIds: body.replyIds };
    }

    /** The receipt the gateway sends: accepted facts where they exist, otherwise the facts that fail each step. */
    function receiptFor(facts: Facts, messageId: string, replyIds: string[], serial: number): TurnReceiptRequest {
      const { previous, scope, delivery } = facts;
      const priorFinal = previous && !previous.identical && previous.alreadyStored ? previous.finalDelivery : undefined;
      const outcome: TurnReceiptRequest["outcome"] = delivery
        ? (delivery.accepted ? "accepted" : priorFinal ? "rejected" : "unknown")
        : priorFinal === false ? "unknown" : "accepted";
      const emptyScope = scope && !scope.collectedReplies ? scope : undefined;
      const providerIds = delivery ? delivery.providerIds : emptyScope ? emptyScope.providerIds : false;
      const history = delivery ? delivery.history : emptyScope ? emptyScope.history : false;
      return {
        networkAuthority: AUTHORITY, channel: "blooio", messageId,
        replyIds: !scope || !scope.orderedIdsMatch ? [STRAY_REPLY] : scope.collectedReplies ? replyIds : [],
        outcome, providerMessageIds: providerIds ? [`provider-receipt-${serial}`] : [], historyRecorded: history,
      };
    }

    async function replyStatuses(id: string): Promise<string[]> {
      const rows = await sql<{ status: string }[]>`select status from network.messages where app_id = 'friends' and inbound_id = ${id} order by id`;
      return rows.map(row => row.status);
    }

    /** Send the receipt while a transaction holds the turn's row, and change the turn's authority before it lets go. */
    async function sendPastAuthorityChange(id: string, raw: string, messageId: string): Promise<Response> {
      let release!: () => void;
      const released = new Promise<void>(resolve => { release = resolve; });
      let locked!: (pid: number) => void;
      const pid = new Promise<number>(resolve => { locked = resolve; });
      const holder = sql.begin(async tx => {
        const [row] = await tx<{ pid: number }[]>`select pg_backend_pid() as pid from platform.inbound where id = ${id} for update`;
        if (!row) throw new Error("The stored turn is missing");
        locked(row.pid);
        await released;
        await tx`update platform.inbound set network_authority = ${{ ...AUTHORITY, generation: "g2" }}::jsonb where id = ${id}`;
      });
      const holderPid = await pid;
      const response = post(TURN_RECEIPT_PATH, `${messageId}:receipt`, raw);
      try {
        for (let tries = 0; ; tries++) {
          const [waiting] = await sql`select pid from pg_stat_activity where ${holderPid}::int = any(pg_blocking_pids(pid)) limit 1`;
          if (waiting) break;
          if (tries >= 1000) throw new Error("The receipt never waited on the stored turn");
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      } finally {
        release();
        await holder;
      }
      return response;
    }

    /** Run the receipt for these facts through the service and name the step that answered. */
    async function probe(facts: Facts): Promise<ReceiptPhase> {
      const turn = await handledTurn();
      const body = receiptFor(facts, turn.messageId, turn.replyIds, cases);
      const raw = JSON.stringify(body);
      const digest = createHash("sha256").update(raw).digest("hex");
      const { previous, scope, delivery } = facts;
      // A turn the gateway still converses in (an open turn) is not a handled turn; a stuck turn would hold the sender.
      if (facts.handled !== true) await sql`update platform.inbound set response = jsonb_set(response, '{outcome}', '"open"') where id = ${turn.id}`;
      if (scope && !scope.collectedReplies) await sql`update platform.inbound set replies = '[]'::jsonb where id = ${turn.id}`;
      if (delivery) {
        await sql`update platform.inbound set response = jsonb_set(response, '{accountEligible}', ${!delivery.accountFree}::text::jsonb) where id = ${turn.id}`;
      }
      if (!previous || previous.identical) {
        await sql`update platform.inbound set receipt_hash = ${digest}, receipt = ${body}::jsonb where id = ${turn.id}`;
      } else if (previous.alreadyStored) {
        const earlier = { ...body, outcome: previous.previouslyUnknown ? "unknown" : "rejected", providerMessageIds: ["provider-earlier-receipt"] };
        await sql`update platform.inbound set receipt_hash = ${`earlier-${digest}`}, receipt = ${earlier}::jsonb where id = ${turn.id}`;
      }
      const [before] = await sql<{ receipt_hash: string | null; receipt: unknown }[]>`select receipt_hash, receipt from platform.inbound where id = ${turn.id}`;
      const statuses = await replyStatuses(turn.id);
      if (statuses.length !== 1 || statuses[0] !== "collected") throw new Error(`The STOP reply was stored as ${statuses}`);

      const response = facts.validAuthority === true
        ? await post(TURN_RECEIPT_PATH, `${turn.messageId}:receipt`, raw)
        : await sendPastAuthorityChange(turn.id, raw, turn.messageId);
      const answer = await response.json() as { ok?: boolean; replayed?: boolean; error?: string };
      const [after] = await sql<{ receipt_hash: string | null; receipt: unknown }[]>`select receipt_hash, receipt from platform.inbound where id = ${turn.id}`;
      const written = await replyStatuses(turn.id);
      const stored = response.status === 200 && answer.ok === true && answer.replayed === false;
      if (!stored && (after?.receipt_hash !== before?.receipt_hash || !isDeepStrictEqual(after?.receipt, before?.receipt) || !isDeepStrictEqual(written, statuses))) {
        throw new Error(`A receipt answered ${response.status} ${JSON.stringify(answer)} and still changed the stored turn`);
      }
      if (stored) {
        if (after?.receipt_hash !== digest || !isDeepStrictEqual(after.receipt, body)) throw new Error("A stored receipt is not the one the gateway sent");
        const changed = !isDeepStrictEqual(written, statuses);
        if (changed && written.some(status => status !== delivered(body.outcome))) throw new Error(`The replies were stored as ${written} for ${body.outcome}`);
        if (facts.recorded) return "Stored";
        return changed ? "AwaitingReplyWrite" : "AwaitingEmptyWrite";
      }
      const failed = (open: boolean, waiting: ReceiptPhase, ended: ReceiptPhase) => open ? waiting : ended;
      if (response.status === 409 && answer.error === "turn_unavailable") return failed(facts.handled === undefined, "ReadingTurn", "TurnUnavailable");
      if (response.status === 403 && answer.error === "route_authority_invalid") return failed(facts.validAuthority === undefined, "CheckingAuthority", "AuthorityInvalid");
      if (response.status === 200 && answer.ok === true && answer.replayed === true) return failed(previous === undefined, "CheckingPrevious", "Replayed");
      if (response.status === 409 && answer.error === "receipt_conflict" && previous) return "Conflict";
      if (response.status === 409 && answer.error === "receipt_scope_invalid") return failed(scope === undefined, "CheckingScope", "ScopeInvalid");
      if (response.status === 400 && answer.error === "invalid_receipt") return failed(delivery === undefined, "CheckingDelivery", "DeliveryInvalid");
      throw new Error(`Unexpected receipt answer ${response.status}: ${JSON.stringify(answer)}`);
    }

    function receiptOf(key: string): Receipt {
      let receipt = receipts.get(key);
      if (!receipt) receipts.set(key, receipt = { facts: {} });
      return receipt;
    }

    async function phaseOf(receipt: Receipt): Promise<ReceiptPhase> {
      receipt.phase ??= await probe(receipt.facts);
      return receipt.phase;
    }

    function accept(facts: Facts, event: Event) {
      switch (event.type) {
        case "checkTurn": facts.handled = event.handled; return;
        case "checkAuthority": facts.validAuthority = event.validAuthority; return;
        case "readPrevious": {
          const { type: _, ...previous } = event;
          facts.previous = previous;
          return;
        }
        case "checkScope": {
          const { type: _, ...scope } = event;
          facts.scope = scope;
          return;
        }
        case "checkDelivery": {
          const { type: _, ...delivery } = event;
          facts.delivery = delivery;
          return;
        }
        case "recordReceipt": facts.recorded = true; return;
      }
    }

    await serveJourney<Event>({
      reset: () => { receipts.clear(); return null; },
      async dispatch(key, event) {
        const receipt = receiptOf(key);
        if (NEXT[await phaseOf(receipt)] !== event.type) return "refused";
        accept(receipt.facts, event);
        receipt.phase = undefined;
        return "accepted";
      },
      async observe(key): Promise<TurnReceipt> {
        return { phase: await phaseOf(receiptOf(key)) };
      },
      observeOutput: () => null,
    });
  } finally {
    await server?.stop(true);
    await service.close();
  }
}, 8);
