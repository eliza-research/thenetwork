// The words of one notification. One message per send, however many items and apps it covers.

import { ASSISTANT_LABEL, assertSendableUrl, assistantLink, buttonPageLink, updatePrompt } from "./links.ts";
import type { Delivery } from "./surface.ts";
import type { InboxItem } from "./types.ts";

export const MAX_THREAD_LINES = 3;

export function headline(n: number): string {
  return n === 1 ? "You have a new update from The Network." : `You have ${n} new updates from The Network.`;
}

export function composeText(items: InboxItem[], delivery: Delivery, token?: string, pageBase?: string): string {
  if (items.length === 0) throw new Error("nothing to compose");
  if (delivery.mode === "thread") {
    const lines = items.slice(0, MAX_THREAD_LINES).map(i => i.summary.trim());
    const more = items.length - lines.length;
    if (more > 0) lines.push(`+${more} more. Reply "updates" to see them.`);
    return lines.join("\n");
  }
  if (!token) throw new Error("a link delivery needs a task token");
  if (delivery.mode === "deeplink") {
    const url = assertSendableUrl(assistantLink(delivery.assistant, updatePrompt(token)));
    return `${headline(items.length)} Tap to open it in ${ASSISTANT_LABEL[delivery.assistant]}, or reply here.\n${url}`;
  }
  const url = assertSendableUrl(buttonPageLink(token, pageBase), pageBase ? [new URL(pageBase).hostname] : []);
  return `${headline(items.length)} Open it here, or reply to this text.\n${url}`;
}
