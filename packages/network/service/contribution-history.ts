import { CITY_TZ } from "@thenetwork/core";
import { CapitalLedger, type CapitalEvent, type EarnCategory } from "../../capital/src/index.ts";
import {
  contributionEventReplayPriority, contributionHistoryAllowed, contributionHistoryEntryVisible, contributionHistoryPageSize,
} from "../../core/src/generated/contributionHistory.ts";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { memberCommandOwner, type MemberCommandOwner } from "./member-command.ts";

const descriptions: Record<EarnCategory, string> = {
  vouch: "Vouched for someone who became active",
  attendance: "Attended a plan",
  feedback: "Gave feedback after a plan",
  help: "Helped a member who confirmed it was useful",
  organizing: "Organized a public plan",
  needs_answered: "Answered a Network need",
  review: "Helped review for the Network",
};

export function contributionHistoryRequest(text: string): number | undefined {
  const request = /^(?:(?:show|list)(?: me)? my contribution history(?: page ([1-9]\d{0,5}))?|what have i contributed)[.!?]?$/i.exec(text.trim());
  if (request) return Number(request[1] ?? 1);
}

/** Read only committed contributions after binding the sender to this app's current adult member. */
export async function contributionHistoryReply(
  tx: SQL, accounts: Pick<Accounts, "activeMembership" | "lowestAge">, owner: MemberCommandOwner, page: number,
): Promise<string | undefined> {
  const binding = await memberCommandOwner(tx, accounts, owner);
  if (!binding?.member) return;
  const age = await accounts.lowestAge(owner.e164, binding.person);
  if (!contributionHistoryAllowed(true, age ?? 0)) return;

  // The committed app log includes evidence from other members needed to verify
  // vouches, help, attendance and reversals. Only the owner's entries reach the reply.
  const events = (await tx<{ event: CapitalEvent }[]>`select event from network.capital_events
    where app_id = ${owner.app.id} order by t, id`).map(row => row.event);
  events.sort((a, b) => a.t - b.t || contributionEventReplayPriority(a.type) - contributionEventReplayPriority(b.type));
  const entries = CapitalLedger.replay(events).entriesFor({ member: owner.memberId }, owner.memberId);
  const reversed = new Set(entries.flatMap(entry => entry.provenance.reverses ? [entry.provenance.reverses] : []));
  const visible = entries.filter(entry => contributionHistoryEntryVisible(entry.sign === 1, reversed.has(entry.id))).reverse();
  const title = `Your contributions in ${owner.app.name}`;
  if (!visible.length) return `${title}\nNo confirmed contributions yet.`;

  const pages = Math.ceil(visible.length / contributionHistoryPageSize);
  if (page > pages) return `${title}\nPage ${page} is unavailable. You can ask for page 1 through ${pages}.`;
  const date = new Intl.DateTimeFormat("en-US", { timeZone: CITY_TZ[binding.member.home_city], dateStyle: "medium" });
  const start = (page - 1) * contributionHistoryPageSize;
  const items = visible.slice(start, start + contributionHistoryPageSize).map(entry =>
    `• ${date.format(entry.t)}: ${descriptions[entry.category as EarnCategory]}`);
  if (page < pages) items.push(`Send "Show my contribution history page ${page + 1}" for more.`);
  return [`${title} (${page} of ${pages})`, ...items].join("\n");
}
