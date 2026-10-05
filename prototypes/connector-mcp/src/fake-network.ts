// In-memory stand-in for The Network service. The real service is the Network agent turn
// (network_talk), the enrichment pipeline (share_context), member-visible opportunities
// (get_updates) and the consent workflow (respond). Only behavior the connector contract depends
// on is modeled: ownership, cleared items, confirmations, idempotency, receipts, privacy.
import type { Clock, PrivacyScope, ParticipationState, City } from "@thenetwork/core";
import {
  CAPABILITY_RISK, confirmVia, looksLikeContact, looksLikeCredential, looksSensitive,
  RateLimiter, type Capability, type ClientCaps,
} from "./policy.ts";
import type {
  ItemT, PendingConf, ReceiptT, RespondIn, RespondOut, ShareIn, ShareOut, TalkIn, TalkOut, UpdatesIn, UpdatesOut,
} from "./schemas.ts";

export interface FakeMember {
  id: string; firstName: string; city: City; state: ParticipationState;
  phone: string; email: string;
  facets: { value: string; scope: PrivacyScope }[];
}
interface StoredItem extends ItemT { viewerId: string; opportunityId: string; counterpartId?: string; status: "open" | "accepted" | "declined" }
interface Confirmation extends PendingConf {
  memberId: string; clientId: string; capability: Capability; payload: Record<string, string>;
  status: "pending" | "done" | "cancelled" | "awaiting_channel";
}
export interface AuditEvent { memberId: string; clientId: string; tool: string; receipt?: ReceiptT; summary: string; at: number }

/** Who is calling: resolved from the OAuth access token, never from tool arguments. */
export interface CallContext { memberId: string; clientId: string; caps: ClientCaps }
/** Lets the MCP layer ask the human directly (MCP elicitation) for medium-risk confirmations. */
export type AskMember = (summary: string) => Promise<boolean>;

export class NetworkError extends Error {
  constructor(public code: string, message: string, public retryAfterSeconds?: number) { super(message); }
}

export class FakeNetwork {
  members = new Map<string, FakeMember>();
  private items: StoredItem[] = [];
  private confirmations = new Map<string, Confirmation>();
  proposals: { id: string; memberId: string; kind: string; text: string; scope: PrivacyScope; status: "proposed" }[] = [];
  audit: AuditEvent[] = [];
  /** Side effects the Network performed (stand-in for SMS, invites, contact swaps). */
  effects: { memberId: string; capability: Capability; payload: Record<string, string> }[] = [];
  private idem = new Map<string, { argsKey: string; result: any }>();
  private seq = 0;
  private limiter: RateLimiter;

  constructor(public clock: Clock) { this.limiter = new RateLimiter(clock); }

  private id(prefix: string) { return `${prefix}_${(++this.seq).toString(36).padStart(5, "0")}`; }
  private iso(t: number) { return new Date(t).toISOString(); }

  addMember(m: FakeMember) { this.members.set(m.id, m); return m; }
  /** The engine clears an opportunity for one viewer; body must already be shareable-only text. */
  addItem(viewerId: string, item: Omit<ItemT, "item_id" | "created_at"> & { counterpartId?: string; createdAt?: number }) {
    const stored: StoredItem = {
      item_id: this.id("itm"), kind: item.kind, title: item.title, body: item.body,
      created_at: this.iso(item.createdAt ?? this.clock.now()), expires_at: item.expires_at,
      allowed_decisions: item.allowed_decisions, viewerId, opportunityId: this.id("opp"),
      counterpartId: item.counterpartId, status: "open",
    };
    this.items.push(stored);
    return stored;
  }

  /** Strings that must never appear in tool output for this viewer (used by the output guard and tests). */
  forbiddenFor(viewerId: string): string[] {
    const out: string[] = [];
    for (const m of this.members.values()) {
      if (m.id === viewerId) continue;
      out.push(m.id, m.phone, m.email);
      for (const f of m.facets) if (f.scope !== "shareable") out.push(f.value);
    }
    for (const i of this.items) { out.push(i.opportunityId); if (i.viewerId !== viewerId) out.push(i.item_id); }
    return out;
  }

  // ---------- shared plumbing ----------
  private guard(ctx: CallContext, tool: string) {
    const m = this.members.get(ctx.memberId);
    if (!m) throw new NetworkError("member_not_found", "This connection is not linked to an active Network member.");
    const retry = this.limiter.hit(ctx.memberId, tool);
    if (retry !== null) throw new NetworkError("rate_limited", `Too many ${tool} calls. Try again in ${retry}s.`, retry);
    return m;
  }
  private once<T extends { receipt: ReceiptT }>(ctx: CallContext, tool: string, key: string, args: unknown, fn: () => T): T {
    const k = `${ctx.memberId}:${tool}:${key}`;
    const argsKey = JSON.stringify(args);
    const prior = this.idem.get(k);
    if (prior) {
      if (prior.argsKey !== argsKey) throw new NetworkError("idempotency_conflict", "client_request_id was already used with different arguments.");
      return { ...prior.result, receipt: { ...prior.result.receipt, replayed: true } };
    }
    const result = fn();
    this.idem.set(k, { argsKey, result });
    return result;
  }
  private receipt(ctx: CallContext, tool: string, summary: string, actionId = this.id("act")): ReceiptT {
    const r: ReceiptT = { receipt_id: this.id("rcp"), action_id: actionId, tool, client_id: ctx.clientId, at: this.iso(this.clock.now()), summary, replayed: false };
    this.audit.push({ memberId: ctx.memberId, clientId: ctx.clientId, tool, receipt: r, summary, at: this.clock.now() });
    return r;
  }
  private pend(ctx: CallContext, capability: Exclude<Capability, "get_me" | "search_world" | "find_possibilities">, summary: string, payload: Record<string, string>): Confirmation {
    const risk = CAPABILITY_RISK[capability] as "medium" | "high";
    const c: Confirmation = {
      confirmation_id: this.id("cnf"), summary, risk, confirm_via: confirmVia(risk, ctx.caps),
      expires_at: this.iso(this.clock.now() + 24 * 3600_000),
      memberId: ctx.memberId, clientId: ctx.clientId, capability, payload, status: "pending",
    };
    this.confirmations.set(c.confirmation_id, c);
    return c;
  }
  private publicConf(c: Confirmation): PendingConf {
    const { confirmation_id, summary, risk, confirm_via, expires_at } = c;
    return { confirmation_id, summary, risk, confirm_via, expires_at };
  }
  private execute(c: Confirmation, via: string) {
    c.status = "done";
    this.effects.push({ memberId: c.memberId, capability: c.capability, payload: c.payload });
    this.audit.push({ memberId: c.memberId, clientId: via, tool: `capability:${c.capability}`, summary: `Executed: ${c.summary}`, at: this.clock.now() });
  }

  // ---------- network_talk ----------
  talk(ctx: CallContext, input: TalkIn): TalkOut {
    const me = this.guard(ctx, "network_talk");
    return this.once(ctx, "network_talk", input.client_request_id, input, () => {
      const msg = input.message;
      const conversation_id = input.conversation_id ?? this.id("cnv");
      let reply: string, pending: Confirmation | null = null;
      const open = this.items.filter((i) => i.viewerId === me.id && i.status === "open");
      if (/share my (number|phone|contact)/i.test(msg)) {
        pending = this.pend(ctx, "share_contact", "Offer to swap phone numbers with your current match. They are asked separately; numbers are exchanged only if both agree.", {});
        reply = "I can offer a number swap. You'll get a confirmation from The Network directly; nothing is shared until you and they both say yes.";
      } else if (/\binvite\b/i.test(msg)) {
        const name = msg.match(/invite (?:my (?:friend|colleague) )?([A-Z][a-z]+)/)?.[1] ?? "your friend";
        pending = this.pend(ctx, "invite", `Create a personal invitation from you for ${name}.`, { name });
        reply = `Happy to. I'll send you a link to forward to ${name}; confirm it in The Network app or by text first.`;
      } else if (/\b(who else|list (all |the )?members|everyone (in|who)|member list|their (phone|number|email|address)|('s|s') (phone|number|email|address|last name))\b/i.test(msg)) {
        reply = "I can't share other members' details or who is in the Network. If someone seems like a fit for you, I'll suggest it, ask them privately, and only connect you if you both say yes.";
      } else if (/\b(pause|slammed|quiet|only when i ask|stop sending)\b/i.test(msg)) {
        pending = this.pend(ctx, "set_state", "Switch to Quiet: only messages you ask for, until you say otherwise.", { state: "quiet" });
        reply = "Want me to go quiet until you check back in?";
      } else if (/\b(need help|help me|looking for|anyone (know|who)|find (me )?(someone|people))\b/i.test(msg)) {
        pending = this.pend(ctx, "ask_for_help", `Draft a request to the Network: "${msg.slice(0, 120)}". No one is contacted until you confirm.`, { text: msg.slice(0, 500) });
        reply = "First, a service or place may solve this faster; I'll check that. If people would help more, I can draft a request. It won't go to anyone until you confirm.";
      } else if (/\b(update|anything new|what'?s new|pending|opportunit)/i.test(msg)) {
        reply = open.length ? `You have ${open.length} item(s) waiting. Ask me to show them, or use network_get_updates.` : "Nothing new yet. I'll reach out when something genuinely fits.";
      } else if (/what do you know about me/i.test(msg)) {
        const mine = me.facets.filter((f) => f.scope === "shareable" || f.scope === "matchable").map((f) => f.value);
        reply = `Here is what I use for matching: ${mine.join("; ") || "nothing yet"}. You can see and edit everything, including private notes, on your Network page.`;
      } else {
        reply = "Got it. Tell me what you'd like more of, or ask me for something specific.";
      }
      return {
        reply, conversation_id,
        pending_confirmation: pending ? this.publicConf(pending) : null,
        related_item_ids: /update|new|pending|opportunit/i.test(msg) ? open.map((i) => i.item_id) : [],
        receipt: this.receipt(ctx, "network_talk", pending ? `Proposed: ${pending.summary}` : "Talked with your Network agent."),
      };
    });
  }

  // ---------- network_share_context ----------
  shareContext(ctx: CallContext, input: ShareIn): ShareOut {
    const me = this.guard(ctx, "network_share_context");
    return this.once(ctx, "network_share_context", input.client_request_id, input, () => {
      const accepted: ShareOut["accepted"] = [], rejected: ShareOut["rejected"] = [];
      input.facts.forEach((f, index) => {
        if (looksLikeContact(f.text)) return rejected.push({ index, reason: "contact_details_not_accepted" });
        if (looksLikeCredential(f.text)) return rejected.push({ index, reason: "credential_like_text" });
        if (looksSensitive(f.text)) return rejected.push({ index, reason: "sensitive_topic_tell_network_directly" });
        if (this.proposals.some((p) => p.memberId === me.id && p.text.toLowerCase() === f.text.toLowerCase()))
          return rejected.push({ index, reason: "duplicate" });
        const proposal_id = this.id("prp");
        // Host-provided facts start agent-private and unconfirmed; the member confirms and sets scope in the Network (F5, F7).
        this.proposals.push({ id: proposal_id, memberId: me.id, kind: f.kind, text: f.text, scope: "agent_private", status: "proposed" });
        accepted.push({ index, proposal_id, kind: f.kind });
      });
      return {
        status: "proposed_pending_member_review" as const, accepted, rejected,
        note: "Saved as private suggestions. Your Network agent will confirm them with you before using them for matching; nothing is shown to other members.",
        receipt: this.receipt(ctx, "network_share_context", `Received ${accepted.length} suggested fact(s) from your assistant.`),
      };
    });
  }

  // ---------- network_get_updates ----------
  getUpdates(ctx: CallContext, input: UpdatesIn): UpdatesOut {
    const me = this.guard(ctx, "network_get_updates");
    const limit = input.limit ?? 10;
    const after = input.cursor ? Number.parseInt(input.cursor.replace(/^c_/, ""), 36) : -1;
    const now = this.clock.now();
    const mine = this.items
      .map((it, idx) => ({ it, idx }))
      .filter(({ it, idx }) =>
        it.viewerId === me.id && it.status === "open" && idx > after &&
        (!it.expires_at || Date.parse(it.expires_at) > now) &&
        (!input.kinds || input.kinds.includes(it.kind)));
    const page = mine.slice(0, limit);
    this.audit.push({ memberId: me.id, clientId: ctx.clientId, tool: "network_get_updates", summary: `Read ${page.length} update(s).`, at: now });
    return {
      items: page.map(({ it }) => ({
        item_id: it.item_id, kind: it.kind, title: it.title, body: it.body,
        created_at: it.created_at, expires_at: it.expires_at, allowed_decisions: it.allowed_decisions,
      })),
      next_cursor: mine.length > limit ? `c_${page.at(-1)!.idx.toString(36)}` : null,
      member_state: me.state,
    };
  }

  // ---------- network_respond ----------
  async respond(ctx: CallContext, input: RespondIn, askMember?: AskMember): Promise<RespondOut> {
    const me = this.guard(ctx, "network_respond");
    const k = `${ctx.memberId}:network_respond:${input.client_request_id}`;
    const prior = this.idem.get(k);
    if (prior) {
      if (prior.argsKey !== JSON.stringify(input)) throw new NetworkError("idempotency_conflict", "client_request_id was already used with different arguments.");
      return { ...prior.result, receipt: { ...prior.result.receipt, replayed: true } };
    }
    const result = await this.respondOnce(ctx, me, input, askMember);
    this.idem.set(k, { argsKey: JSON.stringify(input), result });
    return result;
  }

  private notAvailable(ctx: CallContext, input: RespondIn): RespondOut {
    // Same answer for "does not exist", "belongs to someone else" and "expired": no enumeration oracle.
    return { status: "not_available", message: "That item is no longer available.", item_id: input.item_id, pending_confirmation: null, receipt: this.receipt(ctx, "network_respond", "Tried to answer an unavailable item.") };
  }

  private async respondOnce(ctx: CallContext, me: FakeMember, input: RespondIn, askMember?: AskMember): Promise<RespondOut> {
    const now = this.clock.now();
    const conf = this.confirmations.get(input.item_id);
    if (conf) {
      if (conf.memberId !== me.id || Date.parse(conf.expires_at) <= now || conf.status === "done" || conf.status === "cancelled")
        return this.notAvailable(ctx, input);
      if (input.decision === "cancel" || input.decision === "decline") {
        conf.status = "cancelled";
        return { status: "done", message: "Cancelled. Nothing was sent.", item_id: input.item_id, pending_confirmation: null, receipt: this.receipt(ctx, "network_respond", `Cancelled: ${conf.summary}`) };
      }
      if (input.decision !== "confirm") return { status: "needs_confirmation", message: conf.summary, item_id: input.item_id, pending_confirmation: this.publicConf(conf), receipt: this.receipt(ctx, "network_respond", "Asked about a pending action.") };
      if (conf.risk === "high") {
        // The host model cannot complete a high-risk action, whatever it claims about the member.
        conf.status = "awaiting_channel";
        return {
          status: "awaiting_network_channel",
          message: "The Network sent you a confirmation by text/app. Reply there to finish; nothing happens until you do.",
          item_id: input.item_id, pending_confirmation: this.publicConf(conf),
          receipt: this.receipt(ctx, "network_respond", `Requested member confirmation on Network channel: ${conf.summary}`),
        };
      }
      if (conf.confirm_via === "host_elicitation") {
        const yes = askMember ? await askMember(conf.summary) : false;
        if (!yes) return { status: "needs_confirmation", message: "Not confirmed by the member. Nothing was done.", item_id: input.item_id, pending_confirmation: this.publicConf(conf), receipt: this.receipt(ctx, "network_respond", "Member did not confirm.") };
      }
      this.execute(conf, ctx.clientId);
      return { status: "done", message: `Done: ${conf.summary}`, item_id: input.item_id, pending_confirmation: null, receipt: this.receipt(ctx, "network_respond", `Confirmed: ${conf.summary}`) };
    }
    const item = this.items.find((i) => i.item_id === input.item_id);
    if (!item || item.viewerId !== me.id || item.status !== "open" || (item.expires_at && Date.parse(item.expires_at) <= now) || !item.allowed_decisions.includes(input.decision))
      return this.notAvailable(ctx, input);
    if (input.decision === "tell_me_more")
      return { status: "details", message: `${item.body} It would take about an hour; you can say no at any time.`, item_id: item.item_id, pending_confirmation: null, receipt: this.receipt(ctx, "network_respond", "Asked for more detail.") };
    item.status = input.decision === "accept" ? "accepted" : "declined";
    const message = item.status === "accepted"
      ? "Great. I'll check with them privately and let you know if it's a yes. If not, you won't hear anything awkward."
      : "No problem. They won't be told you passed.";
    return { status: "done", message, item_id: item.item_id, pending_confirmation: null, receipt: this.receipt(ctx, "network_respond", `${item.status === "accepted" ? "Accepted" : "Declined"}: ${item.title}`) };
  }

  /** Simulates the member replying YES on the Network's own SMS/app channel for a high-risk action. */
  confirmOnNetworkChannel(confirmationId: string, memberId: string) {
    const c = this.confirmations.get(confirmationId);
    if (!c || c.memberId !== memberId || c.status !== "awaiting_channel") return false;
    this.execute(c, "network_channel");
    return true;
  }
}

/** Small synthetic world for tests and local runs. Clearly fictional; canary strings detect leaks. */
export function seedWorld(net: FakeNetwork) {
  const ava = net.addMember({
    id: "mem_ava_7f3a", firstName: "Ava", city: "sf", state: "normal", phone: "+14155550101", email: "ava@example.test",
    facets: [
      { value: "Climbs at Mission Cliffs on Thursdays", scope: "shareable" },
      { value: "Wants more low-pressure local friends", scope: "matchable" },
      { value: "CANARY_AVA_PRIVATE_feeling isolated since the move", scope: "agent_private" },
    ],
  });
  const maya = net.addMember({
    id: "mem_maya_91c2", firstName: "Maya", city: "sf", state: "open", phone: "+14155550102", email: "maya@example.test",
    facets: [
      { value: "Product designer who loves bouldering", scope: "shareable" },
      { value: "CANARY_MAYA_MATCHABLE_recently divorced", scope: "matchable" },
      { value: "CANARY_MAYA_PRIVATE_job search is secret", scope: "agent_private" },
    ],
  });
  const theo = net.addMember({
    id: "mem_theo_44d0", firstName: "Theo", city: "nyc", state: "normal", phone: "+12125550103", email: "theo@example.test",
    facets: [{ value: "CANARY_THEO_PRIVATE_salary 400k", scope: "agent_private" }],
  });
  const day = 24 * 3600_000;
  const intro = net.addItem(ava.id, {
    kind: "opportunity", title: "Climbing partner in the Mission",
    body: "Maya, a product designer who also boulders, is around on Thursday evenings. Want an intro?",
    expires_at: new Date(net.clock.now() + 2 * day).toISOString(), allowed_decisions: ["accept", "decline", "tell_me_more"], counterpartId: maya.id,
  });
  const question = net.addItem(ava.id, {
    kind: "question", title: "Quick question", body: "Are weekday evenings or weekend mornings better for meeting people?",
    expires_at: null, allowed_decisions: ["decline"],
  });
  const mayaItem = net.addItem(maya.id, {
    kind: "opportunity", title: "Climbing partner", body: "Someone nearby who climbs on Thursdays would like to meet. Interested?",
    expires_at: new Date(net.clock.now() + 2 * day).toISOString(), allowed_decisions: ["accept", "decline"], counterpartId: ava.id,
  });
  return { ava, maya, theo, intro, question, mayaItem };
}
