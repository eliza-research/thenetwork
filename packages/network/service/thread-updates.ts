import { threadUpdateCommand, threadUpdatePageSize } from "../../core/src/generated/notificationAcknowledgement.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import { composeThreadText } from "../../notify/src/compose.ts";
import type { NotifyStore } from "../../notify/src/store.ts";
import type { InboxItem } from "../../notify/src/types.ts";

const EMPTY_INBOX = "You have no new updates from The Network.";
const MAX_SUMMARY_CHARS = 500;

export function threadUpdateRequested(text: string): boolean {
  return text.trim().toLowerCase() === threadUpdateCommand;
}

/** A delivered thread preview already showed its first summaries. Links and unaccepted sends showed none. */
export async function unpreviewedThreadUpdates(tx: SQL, store: NotifyStore, e164: string, personId: string, items: InboxItem[]): Promise<InboxItem[]> {
  const deliveryIds = [...new Set(items.flatMap(item => item.deliveryId?.startsWith("ntf_") ? [item.deliveryId] : []))];
  if (!deliveryIds.length) return items;
  const receipts = await tx<{ body: string; item_ids: string[] }[]>`select outbound.body,
      array(select 'inb_' || item.id from unnest(delivery.item_ids) with ordinality as item(id,rank) order by item.rank) as item_ids
    from platform.outbound outbound join notify.deliveries delivery on delivery.delivery_id=outbound.id
    where outbound.id in ${tx(deliveryIds)} and outbound.to_address=${e164} and outbound.sent_at is not null and outbound.body is not null
      and outbound.status in ('accepted','sent','delivered','read') and delivery.person_id=${personId}
      and delivery.target in ('imessage','sms')`;
  if (!receipts.length) return items;
  const originals = await store.getItems([...new Set(receipts.flatMap(receipt => receipt.item_ids))]);
  const byId = new Map(originals.filter(item => item.personId === personId).map(item => [item.id, item]));
  const previewed = new Set<string>();
  for (const receipt of receipts) {
    const original = receipt.item_ids.map(id => byId.get(id));
    if (!original.length || !original.every(item => item !== undefined)) continue;
    if (receipt.body !== composeThreadText(original)) continue;
    for (const item of original.slice(0, threadUpdatePageSize)) previewed.add(item.id);
  }
  return items.filter(item => !previewed.has(item.id));
}

export function threadUpdateBody(items: readonly InboxItem[], remaining: number): string {
  if (!items.length) return EMPTY_INBOX;
  const lines = items.map(item => item.summary.replace(/\s+/g, " ").trim().slice(0, MAX_SUMMARY_CHARS));
  if (remaining > 0) lines.push(`+${remaining} more. Reply "${threadUpdateCommand}" to see them.`);
  return lines.join("\n");
}

/** Keep the exact selected inbox ids with the collected reply so a replay can recheck its scope. */
export function threadUpdateReplyId(turnHash: string, items: readonly InboxItem[], remaining: number): string {
  return `thread-updates:${turnHash}:${remaining}:${items.map(item => item.id).join(",")}`;
}

export function threadUpdateReceipt(replyId: string, turnHash: string): { ids: string[]; remaining: number } | undefined {
  const prefix = `thread-updates:${turnHash}:`;
  if (!replyId.startsWith(prefix)) return;
  const match = /^(0|[1-9]\d*):((?:inb_\d+(?:,inb_\d+)*)?)$/.exec(replyId.slice(prefix.length));
  if (!match) return;
  const remaining = Number(match[1]);
  const ids = match[2] ? match[2].split(",") : [];
  if (!Number.isSafeInteger(remaining) || ids.length > threadUpdatePageSize || new Set(ids).size !== ids.length) return;
  return { ids, remaining };
}
