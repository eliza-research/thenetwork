import { parseItems } from "./attribution.ts";
// Conversation contexts (what the ACTIVE_ITEMS provider would give the agent). Shared by generator and evals.
export interface Ctx { kind: string; active_items: string[]; last_agent_message?: string; last_relayed_message?: string }

export const CONTEXTS: Record<string, Ctx[]> = {
  none: [{ kind: "none", active_items: [] }],
  pending_invite: [
    { kind: "pending_invite", active_items: ["PENDING INVITE opp_311: 1:1 intro to Priya (ceramicist, Mission) for coffee Thu 6pm. Awaiting member's answer."],
      last_agent_message: "Priya (ceramicist in the Mission) is up for a low-key coffee Thu 6pm. Want me to connect you? An easy no is totally fine." },
    { kind: "pending_invite", active_items: ["PENDING INVITE opp_402: small-group dinner (5 people, all into indie games) Sat 7pm in Williamsburg. Awaiting member's answer."],
      last_agent_message: "A few people who make indie games are doing dinner Sat 7pm in Williamsburg. Want in? 4 of 5 spots filled." },
    { kind: "pending_invite", active_items: ["PENDING INVITE opp_515: 2 compatible members are going to the Noise Pop show Fri; offer to introduce member there. Awaiting member's answer."],
      last_agent_message: "Two people you'd probably like are going to the Noise Pop show Friday. Want me to introduce you there?" },
  ],
  active_relay: [
    { kind: "active_relay", active_items: ["ACCEPTED intro thread_88 with Marcus (climbing partner intro). Relay open. No meetup time set yet."],
      last_relayed_message: "From Marcus: hey! stoked to climb sometime, I'm usually at Dogpatch Boulders" },
    { kind: "active_relay", active_items: ["ACCEPTED intro thread_42 with Dana (fellow PM). Coffee confirmed Fri 5pm at Ritual Coffee, Valencia St."],
      last_relayed_message: "From Dana: see you friday!" },
  ],
  scheduling: [
    { kind: "scheduling", active_items: ["ACCEPTED intro thread_42 with Dana (fellow PM). Agent is collecting availability for a coffee."],
      last_agent_message: "Dana's in! What times work for you this week? I'll find an overlap." },
  ],
  feedback_ask: [
    { kind: "feedback_ask", active_items: ["COMPLETED group dinner opp_207 last night with Sam, Lee and Ana."],
      last_agent_message: "How was dinner last night?" },
    { kind: "feedback_ask", active_items: ["COMPLETED intro thread_31 with Jordan (coffee, yesterday)."],
      last_agent_message: "How did coffee with Jordan go? One word is fine." },
  ],
};

// Busy context: several active items at once (the realistic case that causes mis-binding).
CONTEXTS.multi = [
  { kind: "multi", active_items: [
      "ACCEPTED intro thread_88 with Marcus (climbing partner intro). Relay open. Climb planned Sat 10am at Dogpatch Boulders.",
      "PENDING INVITE opp_311: 1:1 intro to Priya (ceramicist, Mission) for coffee Thu 6pm. Awaiting member's answer.",
      "COMPLETED intro thread_19 with Sarah K. (coffee last week). Contacts not swapped."],
    last_agent_message: "Priya (ceramicist in the Mission) is up for a low-key coffee Thu 6pm. Want me to connect you? An easy no is totally fine.",
    last_relayed_message: "From Marcus: yo still on for saturday?" },
];

export function renderCtx(c: Ctx): string {
  const lines = [`Active items: ${c.active_items.length ? "\n- " + c.active_items.join("\n- ") : "(none)"}`];
  if (c.last_agent_message) lines.push(`Agent's last message to member: "${c.last_agent_message}"`);
  if (c.last_relayed_message) lines.push(`Last relayed message delivered to member: "${c.last_relayed_message}"`);
  return lines.join("\n");
}

// ------------------------------------------------------------------ v2 context: channel envelope, outbound timeline, history
// In production these come from the database / channel adapter, never from the model:
// - outbound: every message the agent delivered to the member, tagged with the item it belongs to (or null for
//   non-item messages such as concierge results), newest last. `agoMin` = minutes before the inbound message.
// - channel: what the SMS/chat adapter knows about the inbound message (reply-to if the channel supports quoted
//   replies; the item whose thread the member last opened/saw).
// - history: the member's full contact/opportunity history (not just active items), used to resolve names.
export interface Outbound { item: string | null; agoMin: number; kind: "relay" | "agent" }
export interface Channel { reply_to?: string; last_seen?: string }
export interface HistoryEntry { member_id: string; name: string; item_id: string; when: string; summary: string }
export interface CtxV2 extends Ctx { outbound?: Outbound[]; channel?: Channel; history?: HistoryEntry[] }

/** Alex's full interaction history (fixture). Covers every name the generated sets use, plus a past Jake. */
export const DEFAULT_HISTORY: HistoryEntry[] = [
  { member_id: "m_201", name: "Marcus D.", item_id: "thread_88", when: "this week", summary: "climbing partner intro, relay open" },
  { member_id: "m_202", name: "Priya S.", item_id: "opp_311", when: "today", summary: "pending coffee intro, ceramicist" },
  { member_id: "m_203", name: "Sarah K.", item_id: "thread_19", when: "last week", summary: "coffee intro, completed" },
  { member_id: "m_204", name: "Dana L.", item_id: "thread_42", when: "this week", summary: "fellow PM, coffee at Ritual" },
  { member_id: "m_205", name: "Jordan P.", item_id: "thread_31", when: "yesterday", summary: "coffee intro, completed" },
  { member_id: "m_206", name: "Sam W.", item_id: "opp_207", when: "yesterday", summary: "group dinner" },
  { member_id: "m_207", name: "Lee C.", item_id: "opp_207", when: "yesterday", summary: "group dinner" },
  { member_id: "m_208", name: "Ana R.", item_id: "opp_207", when: "yesterday", summary: "group dinner" },
  { member_id: "m_209", name: "Jake R.", item_id: "thread_07", when: "in August", summary: "climbing meetup at Mission Cliffs, completed" },
];


/**
 * Build the outbound timeline for an eval context from its last_* messages (production records it at send time).
 * The last relayed message is the newest outbound; the last agent message precedes it by `agentAgoMin`
 * (or is newest when there is no relay). The item is found by the counterpart's name, else the only active item.
 */
export function withTimeline(ctx: Ctx, o: { agentAgoMin?: number; relayAgoMin?: number; extra?: Outbound[]; channel?: Channel; history?: HistoryEntry[] } = {}): CtxV2 {
  const items = parseItems(ctx);
  const itemFor = (msg: string): string | null => {
    const words = new Set(msg.toLowerCase().split(/[^a-z]+/));
    const hit = items.find(it => it.names.some(n => words.has(n)));
    if (hit) return hit.id;
    return items.length === 1 && !/^Here are \d/.test(msg) ? items[0].id : null;
  };
  const outbound: Outbound[] = [...(o.extra ?? [])];
  const hasRelay = !!ctx.last_relayed_message;
  if (ctx.last_agent_message) outbound.push({ item: itemFor(ctx.last_agent_message), agoMin: o.agentAgoMin ?? (hasRelay ? 45 : 2), kind: "agent" });
  if (ctx.last_relayed_message) outbound.push({ item: itemFor(ctx.last_relayed_message.replace(/^From (\w+):.*$/s, "From $1:")), agoMin: o.relayAgoMin ?? 2, kind: "relay" });
  outbound.sort((a, b) => b.agoMin - a.agoMin);
  return { ...ctx, outbound, channel: o.channel ?? {}, history: o.history ?? DEFAULT_HISTORY };
}
