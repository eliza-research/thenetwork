import { isDeepStrictEqual } from "node:util";
import type { DeliveryReport, Event, ReceiptJourney, ReceiptJourneyResult, ReceiptObservation } from "../../packages/core/src/generated/turnReceiptJourney.ts";
import type { TurnReceiptRequest } from "../../packages/core/src/svc/contract.ts";
import { serveJourney } from "./serveJourney.ts";
import { withSignedTurnFixture } from "./signedTurnFixture.ts";

const primaryId = "fixture-primary-receipt";
const alternateId = "fixture-alternate-receipt";
const delivery: Record<DeliveryReport, Pick<TurnReceiptRequest, "outcome" | "providerMessageIds" | "historyRecorded">> = {
  UnknownReport: { outcome: "unknown", providerMessageIds: [], historyRecorded: false },
  AcceptedReport: { outcome: "accepted", providerMessageIds: [primaryId], historyRecorded: true },
  AlternativeAcceptance: { outcome: "accepted", providerMessageIds: [alternateId], historyRecorded: true },
  RejectedReport: { outcome: "rejected", providerMessageIds: [], historyRecorded: false },
};

type CollectedTurn = { messageId: string; replyId: string; out: ReceiptJourneyResult[] };

function observeReceipt(receipt: TurnReceiptRequest | null, turn: CollectedTurn): ReceiptObservation {
  if (receipt === null) return { tag: "NoReceipt" };
  if (receipt.channel !== "blooio" || receipt.messageId !== turn.messageId || receipt.replyIds.length !== 1 || receipt.replyIds[0] !== turn.replyId) {
    throw new Error("The stored receipt is not bound to the collected reply");
  }
  const { outcome, historyRecorded, providerMessageIds } = receipt;
  const [report] = Object.entries(delivery).find(([, expected]) =>
    isDeepStrictEqual(expected, { outcome, historyRecorded, providerMessageIds })) ?? [];
  if (!isDeliveryReport(report)) throw new Error("The stored receipt has an unexpected delivery result");
  return { tag: "SavedReceipt", report };
}

function isDeliveryReport(report: string | undefined): report is DeliveryReport {
  return report !== undefined && Object.hasOwn(delivery, report);
}

await withSignedTurnFixture(async ({ createMember, sendTurn, sendReceipt, service }) => {
  const turns = new Map<string, CollectedTurn>();

  async function turnFor(key: string): Promise<CollectedTurn> {
    const existing = turns.get(key);
    if (existing) return existing;
    const { phone } = await createMember();
    const { response, messageId } = await sendTurn(phone, "STOP", { app: "slop" });
    if (response.outcome !== "handled" || response.delivery !== "collected" || response.replyIds.length !== 1) {
      throw new Error("The STOP turn must collect one reply");
    }
    const [replyId] = response.replyIds;
    if (!replyId) throw new Error("The collected reply has no ID");
    const turn: CollectedTurn = { messageId, replyId, out: [] };
    turns.set(key, turn);
    return turn;
  }

  await serveJourney<Event>({
    reset: () => { turns.clear(); return null; },
    async dispatch(key, event): Promise<"accepted"> {
      const turn = await turnFor(key);
      const response = await sendReceipt({
        channel: "blooio", messageId: turn.messageId, replyIds: [turn.replyId], ...delivery[event.report],
      });
      const body: unknown = await response.json();
      if (response.status === 200 && body && typeof body === "object" && "ok" in body && body.ok === true &&
          "replayed" in body && typeof body.replayed === "boolean") {
        turn.out = [body.replayed ? "ReportReplayed" : "ReportStored"];
      } else if (response.status === 409 && body && typeof body === "object" && "error" in body && body.error === "receipt_conflict") {
        turn.out = ["ReportConflict"];
      } else throw new Error(`Unexpected receipt response ${response.status}: ${JSON.stringify(body)}`);
      return "accepted"; // A valid report reaches the service even when it conflicts with a stored result.
    },
    async observe(key): Promise<ReceiptJourney> {
      const turn = await turnFor(key);
      const [row] = await service.sql<{ receipt: TurnReceiptRequest | null; status: string }[]>`
        select i.receipt, m.status from platform.inbound i
        join network.messages m on m.inbound_id = i.id
        where i.id = ${`msg:blooio:${turn.messageId}`} and m.app_id = 'slop' and m.id = ${turn.replyId}`;
      if (!row) throw new Error("The collected receipt or reply row is missing");
      return { receipt: observeReceipt(row.receipt, turn), replyStatus: row.status };
    },
    async observeOutput(key) { return (await turnFor(key)).out; },
  });
});
