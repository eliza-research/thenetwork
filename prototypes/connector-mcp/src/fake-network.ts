// In-memory stand-in for The Network service behind the connector (design §5.2, §6, §7, §8). The real
// service runs the member's shared-agent turn, the enrichment pipeline, the cleared-items query and
// the opportunity state machine. Only behavior the connector contract depends on is modeled:
// ownership, per-grant handles, surface profiles, member eligibility (minors), tiered confirmation,
// idempotency, receipts and privacy.
import { createHash, createHmac, randomBytes } from "node:crypto";
import type { City, Clock, ParticipationState, PrivacyScope } from "@thenetwork/core";
import type { HostKey, TrustTier } from "./config.ts";
import {
  ACTION_TIER, confirmationTtlMs, effectiveTier, looksAboutSomeoneElse, looksLikeContact, looksLikeCredential, looksLikePhoneOrEmail,
  looksLikeStreetAddress, looksNightlife, looksRomantic, looksSensitive, matchFolded, RateLimiter, type ActionKind, type LimitName, type Tier,
} from "./policy.ts";
import { ADULT_AGE, PROFILES, profileViolation, visibility, type ContentFacts, type SurfaceProfileName } from "./profiles.ts";
import {
  SCOPES, TOOL_NAMES, type AskIn, type AskOut, type ChangeKind, type ItemKind, type ItemOut, type PendingConfirmationOut,
  type Receipt, type RespondIn, type RespondOut, type ResponseValue, type ShareIn, type ShareOut, type ShareRejectReason,
  type TellIn, type TellOut, type ToolErrorCode, type ToolName, type UpdatesIn, type UpdatesOut,
} from "./schemas.ts";

/** Who is calling, built only from the verified access token (design §3.6), never from tool args. */
export interface ConnectorPrincipal {
  memberId: string;
  grantId: string;
  clientId: string;
  hostKey: HostKey;
  hostDisplayName: string;
  scopes: string[];
  surfaceProfile: SurfaceProfileName;
  trustTier: TrustTier;
  grantCreatedAt: number;
}

export interface FakeMember {
  id: string; firstName: string; age: number; city: City; state: ParticipationState;
  phone: string; email: string;
  facets: { value: string; scope: PrivacyScope }[];
}

interface StoredItem {
  internalId: string; // opp_… — never leaves the service
  viewerId: string;
  kind: ItemKind;
  title: string;
  summary: string;
  details: string;
  when?: string;
  where?: string;
  expiresAt: number | null;
  allowedResponses: ResponseValue[];
  facts: ContentFacts;
  counterpartId?: string;
  status: "open" | "answered" | "snoozed";
}

interface Confirmation {
  confirmationId: string;
  memberId: string;
  grantId: string;
  hostDisplayName: string;
  action: ActionKind;
  /** Built by the server at creation and executed exactly; never host-supplied (design §6.2). */
  payload: Record<string, string>;
  summary: string;
  tier: Tier;
  status: "pending" | "done" | "cancelled";
  expiresAt: number;
  confirmedVia?: "host" | "network_channel";
}

export interface AuditEvent {
  memberId: string; grantId: string; hostKey: string; tool: string; summary: string;
  tier?: Tier; receipt?: Receipt; at: number;
}
export interface Effect { memberId: string; action: ActionKind; payload: Record<string, string>; via: "host" | "network_channel" }

export class NetworkError extends Error {
  constructor(public code: ToolErrorCode, message: string, public retryable = false, public retryAfterSeconds?: number) { super(message); }
}

export interface Outcome<T> { result: T; receipt?: Receipt }

const NOT_AVAILABLE = "That isn't available.";
const TEXT_ONLY = "That's something I can only help with by text.";
const IDEM_WINDOW_MS = 10 * 60_000;

const humanDuration = (ms: number) => {
  if (ms >= 48 * 3600_000) return `${Math.round(ms / 86_400_000)} days`;
  if (ms >= 3600_000) { const h = Math.round(ms / 3600_000); return `${h} hour${h === 1 ? "" : "s"}`; }
  return `${Math.max(1, Math.round(ms / 60_000))} minutes`;
};

export class FakeNetwork {
  members = new Map<string, FakeMember>();
  private items: StoredItem[] = [];
  private confirmations = new Map<string, Confirmation>();
  proposals: { memberId: string; field: string; value: string; privacyScope: PrivacyScope; status: "proposed"; provenance: string }[] = [];
  audit: AuditEvent[] = [];
  /** Side effects the Network performed (stand-in for intros, invites, contact swaps, state changes). */
  effects: Effect[] = [];
  /** Messages the Network sent the member on its OWN channel (iMessage/SMS), e.g. tier-2/3 confirmations. */
  channelMessages: { memberId: string; text: string; confirmationId?: string }[] = [];
  private idem = new Map<string, { argsHash: string; result: unknown; receipt?: Receipt; at: number }>();
  private consequentialGrants = new Set<string>();
  private seq = 0;
  private limiter: RateLimiter;

  private handleKey: string;
  private assistantsUrl: string;
  constructor(public clock: Clock, opts: { handleKey?: string; assistantsUrl?: string } = {}) {
    this.limiter = new RateLimiter(clock);
    this.handleKey = opts.handleKey ?? "prototype-item-handle-key";
    this.assistantsUrl = opts.assistantsUrl ?? "ntwrk.love/assistants";
  }

  private id(prefix: string) { return `${prefix}_${(++this.seq).toString(36).padStart(5, "0")}`; }

  addMember(m: FakeMember) { this.members.set(m.id, m); return m; }
  /** The engine clears an item for one viewer; text must already be shareable-only. */
  addItem(viewerId: string, item: Omit<StoredItem, "internalId" | "viewerId" | "status" | "details"> & { details?: string }) {
    const stored: StoredItem = { ...item, details: item.details ?? item.summary, internalId: this.id("opp"), viewerId, status: "open" };
    this.items.push(stored);
    return stored;
  }

  /** Per-grant HMAC handle: two hosts can't correlate items, and a leaked handle is useless elsewhere (§5.6). */
  itemHandle(grantId: string, item: StoredItem): string {
    const mac = createHmac("sha256", this.handleKey).update(`${grantId}|${item.internalId}`).digest();
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return "itm_" + [...mac.subarray(0, 10)].map((b) => alphabet[b % 62]).join("");
  }
  private newConfirmationId() {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    return "cnf_" + [...randomBytes(10)].map((b) => alphabet[b % 62]).join("");
  }

  /**
   * Strings that must never appear in any output to this principal: other members' ids, contact
   * details and non-shareable facets; every internal opportunity id; other members' item text; and
   * the text of this member's items that are hidden by profile or eligibility ("excluded items aren't
   * mentioned", §7.1). Used by the outbound guard and by the tests.
   */
  forbiddenFor(p: ConnectorPrincipal): string[] {
    const out: string[] = [];
    const viewer = this.members.get(p.memberId);
    for (const m of this.members.values()) {
      if (m.id === p.memberId) {
        for (const f of m.facets) if (f.scope === "agent_private") out.push(f.value); // connector egress policy (§8.2.3)
        continue;
      }
      out.push(m.id, m.phone, m.email);
      for (const f of m.facets) if (f.scope !== "shareable") out.push(f.value);
    }
    for (const i of this.items) {
      out.push(i.internalId);
      const hidden = i.viewerId !== p.memberId || !viewer || !this.itemVisible(p, viewer, i);
      if (hidden) out.push(i.title, i.summary, i.details);
    }
    return out;
  }

  /** The member's own agent-private facets (may be echoed only when the member supplied them, §8.2 step 3). */
  ownPrivateFacets(p: ConnectorPrincipal): string[] {
    return this.members.get(p.memberId)?.facets.filter((f) => f.scope === "agent_private").map((f) => f.value) ?? [];
  }

  /**
   * Whether this host may see an item (design §7.1 step 2): the member is eligible, the profile allows
   * the item's category and flags, AND the item's own text is in the profile's vocabulary. The text
   * check means a mislabeled item (category "events" but "happy hour at a brewery") is excluded and
   * never mentioned, instead of tripping the output classifier and failing the whole list.
   */
  private itemVisible(p: ConnectorPrincipal, me: FakeMember, i: StoredItem): boolean {
    const profile = PROFILES[p.surfaceProfile];
    if (visibility(i.facts, me.age, profile) !== "visible") return false;
    return profileViolation([i.title, i.summary, i.details, i.when ?? "", i.where ?? ""].join("\n"), profile, me.age) === null;
  }

  // ------------------------------------------------------------------------------- plumbing
  private member(p: ConnectorPrincipal, tool: ToolName, scope: string): FakeMember {
    const m = this.members.get(p.memberId);
    if (!m) throw new NetworkError("not_member", "This connection isn't linked to an active Network member.");
    if (!p.scopes.includes(scope)) throw new NetworkError("needs_scope", `This assistant isn't allowed to do that yet (needs ${scope}).`);
    const checks: [LimitName, string][] = [["grant_minute", p.grantId], ["grant_day", p.grantId]];
    if (tool === TOOL_NAMES.ask || tool === TOOL_NAMES.tell) checks.push(["agent_turns", p.memberId]);
    if (tool === TOOL_NAMES.share) checks.push(["share_profile", p.memberId]);
    if (tool === TOOL_NAMES.tell || tool === TOOL_NAMES.share || tool === TOOL_NAMES.respond) checks.push(["writes", p.memberId]);
    const retry = this.limiter.hit(checks);
    if (retry !== null) throw new NetworkError("rate_limited", `Too many requests to The Network right now. Try again in about ${humanDuration(retry * 1000)}.`, true, retry);
    return m;
  }

  /** Idempotency (GW-003, §5.1): (grant, tool, key) or (grant, tool, sha256(canonical args)) for 10 min. */
  private once<T>(p: ConnectorPrincipal, tool: ToolName, args: { idempotency_key?: string }, fn: () => Outcome<T>): Outcome<T> {
    const { idempotency_key, ...rest } = args;
    const argsHash = createHash("sha256").update(canonical(rest)).digest("hex");
    const key = `${p.grantId}:${tool}:${idempotency_key ? `k:${idempotency_key}` : `h:${argsHash}`}`;
    const now = this.clock.now();
    const prior = this.idem.get(key);
    // The server fallback key dedupes accidental double calls. It must not hand back a confirmation
    // that has since been confirmed, cancelled or expired: "pause" → confirm → "resume" → "pause"
    // within 10 minutes is a new request, not a replay. An explicit idempotency_key always replays.
    const stale = !idempotency_key && prior !== undefined && this.hasFinishedConfirmation(prior.result);
    if (prior && !stale && (idempotency_key || now - prior.at < IDEM_WINDOW_MS)) {
      if (prior.argsHash !== argsHash) throw new NetworkError("idempotency_conflict", "That idempotency_key was already used with different arguments. Use a new key for a new action.");
      return { result: prior.result as T, receipt: prior.receipt && { ...prior.receipt, replayed: true } };
    }
    const out = fn();
    this.idem.set(key, { argsHash, result: out.result, receipt: out.receipt, at: now });
    return out;
  }

  private hasFinishedConfirmation(result: unknown): boolean {
    const id = (result as { pending_confirmation?: { confirmation_id?: string } | null })?.pending_confirmation?.confirmation_id;
    if (!id) return false;
    const c = this.confirmations.get(id);
    return !c || c.status !== "pending" || c.expiresAt <= this.clock.now();
  }

  private receipt(p: ConnectorPrincipal, tool: ToolName, summary: string, tier?: Tier): Receipt {
    const r: Receipt = { receipt_id: this.id("rcp"), action_id: this.id("act"), at: new Date(this.clock.now()).toISOString(), replayed: false };
    this.audit.push({ memberId: p.memberId, grantId: p.grantId, hostKey: p.hostKey, tool, summary, tier, receipt: r, at: this.clock.now() });
    return r;
  }
  private logRead(p: ConnectorPrincipal, tool: ToolName, summary: string) {
    this.audit.push({ memberId: p.memberId, grantId: p.grantId, hostKey: p.hostKey, tool, summary, at: this.clock.now() });
  }

  private publicConf(c: Confirmation): PendingConfirmationOut {
    return {
      confirmation_id: c.confirmationId, summary: c.summary.slice(0, 300),
      how_to_confirm: c.tier >= 2 ? "member_confirms_in_network_app" : "ask_member_then_respond",
      expires_in: `expires in ${humanDuration(c.expiresAt - this.clock.now())}`,
    };
  }

  private pend(p: ConnectorPrincipal, action: ActionKind, summary: string, payload: Record<string, string>, baseTier: Tier = ACTION_TIER[action]): Confirmation {
    // One open confirmation per (grant, action, payload). Re-asking (a retry with a fresh key, or a
    // prompt-injected loop) returns the same pending row instead of stacking duplicate confirmations
    // and duplicate "Reply YES" texts that could each execute.
    const now = this.clock.now();
    const same = canonical(payload);
    for (const c of this.confirmations.values()) {
      if (c.status === "pending" && c.expiresAt > now && c.grantId === p.grantId && c.memberId === p.memberId && c.action === action && canonical(c.payload) === same) return c;
    }
    const tier = this.tierFor(p, baseTier);
    const c: Confirmation = {
      confirmationId: this.newConfirmationId(), memberId: p.memberId, grantId: p.grantId, hostDisplayName: p.hostDisplayName,
      action, payload, summary, tier, status: "pending", expiresAt: this.clock.now() + confirmationTtlMs(tier),
    };
    this.confirmations.set(c.confirmationId, c);
    if (tier >= 2) this.askOnNetworkChannel(c);
    return c;
  }
  private tierFor(p: ConnectorPrincipal, base: Tier): Tier {
    return effectiveTier(base, { trustTier: p.trustTier, grantCreatedAt: p.grantCreatedAt, hasPriorConsequentialAction: this.consequentialGrants.has(p.grantId) }, this.clock.now());
  }
  /** Out-of-band confirmation request on the member's primary Network channel (§6.2). */
  private askOnNetworkChannel(c: Confirmation) {
    if (this.channelMessages.some((m) => m.confirmationId === c.confirmationId)) return;
    this.channelMessages.push({
      memberId: c.memberId, confirmationId: c.confirmationId,
      text: `${c.hostDisplayName} asked me to: ${c.summary} Reply YES to confirm or NO to cancel.`,
    });
  }

  /**
   * Re-checked at execution time, whoever confirms: the item behind a confirmation must still be open,
   * unexpired and something the member is eligible for. Returns false (and cancels) otherwise.
   */
  private stillActionable(c: Confirmation): boolean {
    if (!c.payload.item) return true;
    const item = this.items.find((i) => i.internalId === c.payload.item);
    const me = this.members.get(c.memberId);
    const now = this.clock.now();
    const ok = !!item && !!me && item.viewerId === me.id && item.status === "open" && (item.expiresAt === null || item.expiresAt > now) &&
      visibility(item.facts, me.age, PROFILES.general_assistant) !== "not_eligible";
    if (!ok) c.status = "cancelled";
    return ok;
  }

  private execute(c: Confirmation, via: "host" | "network_channel") {
    c.status = "done";
    c.confirmedVia = via;
    this.consequentialGrants.add(c.grantId);
    if (c.payload.item) {
      const item = this.items.find((i) => i.internalId === c.payload.item);
      if (item) item.status = "answered";
    }
    if (c.action === "set_state" && c.payload.state) this.members.get(c.memberId)!.state = c.payload.state as ParticipationState;
    this.effects.push({ memberId: c.memberId, action: c.action, payload: c.payload, via });
    this.audit.push({ memberId: c.memberId, grantId: c.grantId, hostKey: via, tool: `action:${c.action}`, summary: `Executed: ${c.summary}`, tier: c.tier, at: this.clock.now() });
  }

  private visibleItems(p: ConnectorPrincipal, me: FakeMember): StoredItem[] {
    const now = this.clock.now();
    return this.items.filter((i) =>
      i.viewerId === me.id && i.status === "open" && (i.expiresAt === null || i.expiresAt > now) && this.itemVisible(p, me, i));
  }
  private findOwnItem(p: ConnectorPrincipal, me: FakeMember, handle: string) {
    return this.items.find((i) => i.viewerId === me.id && this.itemHandle(p.grantId, i) === handle);
  }
  private itemOut(p: ConnectorPrincipal, i: StoredItem): ItemOut {
    const out: ItemOut = { item_id: this.itemHandle(p.grantId, i), kind: i.kind, title: i.title, summary: i.summary, allowed_responses: i.allowedResponses };
    if (i.when) out.when = i.when;
    if (i.where) out.where = i.where;
    if (i.expiresAt !== null) out.expires = `expires in ${humanDuration(i.expiresAt - this.clock.now())}`;
    return out;
  }

  /** Content outside the member's eligibility or this surface's profile (§7.1 step 4, §7.2). */
  private outOfBounds(p: ConnectorPrincipal, me: FakeMember, text: string): string | null {
    if (looksRomantic(text)) return TEXT_ONLY; // romance never through a connector; adult-only in the Network itself
    const minor = me.age < ADULT_AGE;
    if (minor && involvesPeople(text)) return NOT_AVAILABLE; // under-18 members are never connected to people
    if ((minor || !PROFILES[p.surfaceProfile].allowAgeRestrictedVenues) && looksNightlife(text)) return TEXT_ONLY;
    return null;
  }

  // ------------------------------------------------------------------------ ask_network_agent
  ask(p: ConnectorPrincipal, input: AskIn): Outcome<AskOut> {
    const me = this.member(p, TOOL_NAMES.ask, SCOPES.readBasic);
    const q = input.question;
    const visible = this.visibleItems(p, me);
    const related = (items: StoredItem[]) => items.slice(0, 5).map((i) => ({ item_id: this.itemHandle(p.grantId, i), title: i.title }));
    let out: AskOut;
    if (input.about_item_id) {
      const it = this.findOwnItem(p, me, input.about_item_id);
      out = it && visible.includes(it)
        ? { answer: `${it.title}: ${it.details}`, related_items: related([it]), suggested_tool: "respond_to_network_item" }
        : { answer: "I can't find that item. It may have expired or already been answered.", related_items: [], suggested_tool: "get_network_updates" };
    } else if (/\b(who else|list (all |the )?members|everyone (in|who)|member list|members who|is [A-Z][a-z]+ a member|(phone|number|email|address|last name|earn|salary)\b.*\b[A-Z][a-z]+|[A-Z][a-z]+'s (phone|number|email|address|last name))|everything you know about [A-Z]/i.test(q)) {
      out = { answer: "I can't share other members' details or who is in the Network. If someone seems like a good fit for you, I'll suggest it, check with them privately, and only connect you if you both say yes.", related_items: [], suggested_tool: "none" };
    } else if (this.outOfBounds(p, me, q)) {
      out = { answer: this.outOfBounds(p, me, q)!, related_items: [], suggested_tool: "none" };
    } else if (/what do you know about me/i.test(q)) {
      const mine = me.facets.filter((f) => f.scope === "shareable" || f.scope === "matchable").map((f) => f.value);
      out = { answer: `Here's what I use to look out for you: ${mine.join("; ") || "nothing yet"}. You can see and edit everything, including private notes, in The Network.`, related_items: [], suggested_tool: "none" };
    } else if (/\b(new|update|pending|waiting|status|opportunit|anything for me)\b/i.test(q)) {
      out = visible.length
        ? { answer: `You have ${visible.length} thing${visible.length === 1 ? "" : "s"} waiting: ${visible.map((i) => i.title).join("; ")}.`, related_items: related(visible), suggested_tool: "get_network_updates" }
        : { answer: "Nothing new right now. I'll reach out when something genuinely fits.", related_items: [], suggested_tool: "none" };
    } else if (/\b(can you|could you|please|pause|go quiet|introduc|invite|find me|sign me up|remember)\b/i.test(q)) {
      out = { answer: "I can do that if you'd like. Tell me to go ahead and I'll take care of it; anything that involves someone else needs your OK first.", related_items: [], suggested_tool: "tell_network_agent" };
    } else {
      out = { answer: "Good question. I don't have anything specific on that yet; tell me more about what you're after.", related_items: [], suggested_tool: "none" };
    }
    this.logRead(p, TOOL_NAMES.ask, "Answered a question.");
    return { result: out };
  }

  // ------------------------------------------------------------------------ tell_network_agent
  tell(p: ConnectorPrincipal, input: TellIn): Outcome<TellOut> {
    const me = this.member(p, TOOL_NAMES.tell, SCOPES.writeRequests);
    return this.once(p, TOOL_NAMES.tell, input, () => {
      const t = input.instruction;
      const done = (reply: string, status: TellOut["status"], changes: { kind: ChangeKind; summary: string }[] = [], conf: Confirmation | null = null, tier?: Tier): Outcome<TellOut> => ({
        result: { reply, status, changes, pending_confirmation: conf ? this.publicConf(conf) : null },
        receipt: this.receipt(p, TOOL_NAMES.tell, conf ? `Proposed: ${conf.summary}` : changes.map((c) => c.summary).join(" ") || reply.slice(0, 80), tier),
      });
      const pending = (c: Confirmation, reply: string, changes: { kind: ChangeKind; summary: string }[] = []) =>
        c.tier >= 2
          ? done(`${reply} The Network has messaged you directly to confirm; nothing happens until you reply there.`, "confirm_in_network_app", changes, c, c.tier)
          : done(reply, "needs_confirmation", changes, c, c.tier);
      const needsScope = (scope: string) => !p.scopes.includes(scope)
        ? done(`I can't do that from ${p.hostDisplayName}. You can do it by texting me, or enable it at ${this.assistantsUrl}.`, "not_available_here")
        : null;

      // Eligibility and profile first, so no later branch can be reached with an out-of-bounds request.
      const blocked = this.outOfBounds(p, me, t);
      if (blocked) return done(blocked, "not_available_here");
      if (/\b(accept|decline|say yes to|i'?m interested|not for me|pass on)\b/i.test(t))
        return done("To answer an item, tell me which one and your answer, and I'll record it with respond_to_network_item.", "nothing_changed");
      // Phone numbers and emails never travel through a connector (PRD 17.3, design §8.1); contact
      // exchange is the Network's own tier-3 share_contact flow.
      if (looksLikePhoneOrEmail(t))
        return done("I can't take phone numbers or email addresses through an assistant. Text me directly, or ask me to offer a number swap.", "not_available_here");

      if (/\b(report|unsafe|harass\w*|threaten\w*)\b/i.test(t))
        return needsScope(SCOPES.sensitiveSafety) ?? pending(this.pend(p, "safety_report", "Start a private safety report with The Network's safety team.", {}), "I'll start a safety report.");
      if (/share my (number|phone|contact)|swap (numbers|contacts)/i.test(t))
        return needsScope(SCOPES.writeRelay) ?? pending(this.pend(p, "share_contact", "Offer to swap phone numbers with your current match. They are asked separately; numbers are exchanged only if both agree.", {}), "I can offer a number swap.");
      if (/\binvite\b/i.test(t)) {
        const name = /invite (?:my (?:friend|colleague) )?([A-Z][a-z]+)/.exec(t)?.[1] ?? "your friend";
        return needsScope(SCOPES.writeInvites) ?? pending(this.pend(p, "invite", `Create a personal invitation from you for ${name}.`, { name }), `Happy to invite ${name}.`);
      }
      if (/\b(message|tell|text|ask) [A-Z][a-z]+\b/.test(t)) {
        // The member confirms in the Network's channel, so the summary must show exactly what is sent.
        const text = t.slice(0, 240);
        return needsScope(SCOPES.writeRelay) ?? pending(this.pend(p, "relay_message", `Pass this message from you to the other person in your current introduction: "${text}"`, { text }), "I can pass that along.");
      }
      if (/\b(pause|slammed|go quiet|quiet mode|only when i ask|stop sending|resume|unpause)\b/i.test(t)) {
        const state = /\b(resume|unpause)\b/i.test(t) ? "normal" : "quiet";
        const summary = state === "quiet" ? "Switch to Quiet: only messages you ask for, until you say otherwise." : "Switch back to Normal outreach.";
        return pending(this.pend(p, "set_state", summary, { state }), state === "quiet" ? "Want me to go quiet until you check back in?" : "Want me to start reaching out again?");
      }
      if (/\bcancel (my )?(request|ask)\b/i.test(t))
        return pending(this.pend(p, "cancel_request", "Cancel your open request to the Network.", {}), "I can cancel that request.");
      if (/\b(available|free) (on )?(weeknights|weekends|mornings|evenings|after|before|most)/i.test(t))
        return done("Noted. I'll use that when timing comes up.", "done", [{ kind: "availability_updated", summary: `Added availability: ${t.slice(0, 120)}` }]);
      if (/\b(need help|help me|looking for|anyone (know|who)|find (me )?(someone|people|a)|introduc\w*|meet)\b/i.test(t)) {
        const draft = `Draft request: "${t.slice(0, 120)}"`;
        const c = this.pend(p, "submit_request", `Send your request to the Network: "${t.slice(0, 120)}". No one is contacted until you confirm.`, { text: t.slice(0, 500) });
        return pending(c, "I'll check whether a service or place solves this faster first. If people would help more, I've drafted a request; it won't go to anyone until you confirm.", [{ kind: "request_drafted", summary: draft.slice(0, 200) }]);
      }
      if (/\b(more|less|only|into|interested in)\b/i.test(t))
        return done("Got it. I've noted that as a suggestion you can review in The Network.", "done", [{ kind: "profile_proposed", summary: `Preference suggestion: ${t.slice(0, 120)}` }]);
      return done("Got it. Tell me what you'd like more of, or ask me for something specific.", "nothing_changed");
    });
  }

  // ------------------------------------------------------------------------ share_profile_with_network
  shareProfile(p: ConnectorPrincipal, input: ShareIn): Outcome<ShareOut> {
    const me = this.member(p, TOOL_NAMES.share, SCOPES.writeProfile);
    return this.once(p, TOOL_NAMES.share, input, () => {
      const rejected: ShareOut["rejected"] = [];
      let accepted = 0;
      const consider = (field: string, value: string, index?: number) => {
        let reason: ShareRejectReason | null = null;
        if (looksLikeContact(value)) reason = "contact_details_not_accepted";
        else if (looksLikeCredential(value) || looksSensitive(value)) reason = "sensitive_tell_the_network_directly";
        else if (looksAboutSomeoneElse(value)) reason = "about_someone_else";
        else if (field.startsWith("home_area") && looksLikeStreetAddress(value)) reason = "too_precise_location";
        else if (looksRomantic(value)) reason = "not_available_here";
        // Under-18 members are never connected to people, so people-seeking details aren't accepted either.
        else if (me.age < ADULT_AGE && involvesPeople(value)) reason = "not_available_here";
        else if (this.proposals.some((x) => x.memberId === me.id && x.field === field && x.value.toLowerCase() === value.toLowerCase())) reason = "duplicate";
        if (reason) { rejected.push(index === undefined ? { field, reason } : { field, index, reason }); return; }
        // Host-provided details are proposals, matchable at most, below member-stated confidence (§5.5).
        this.proposals.push({ memberId: me.id, field, value, privacyScope: "matchable", status: "proposed", provenance: `connector:${p.hostKey}` });
        accepted++;
      };
      const list = (field: "interests" | "skills_offered" | "goals" | "languages") => input[field]?.forEach((v, i) => consider(field, v, i));
      list("interests"); list("skills_offered"); list("goals");
      input.looking_for?.forEach((v, i) => {
        // Under-18 members are never connected to people: only "things_to_do" is accepted.
        if (me.age < ADULT_AGE && v !== "things_to_do") rejected.push({ field: "looking_for", index: i, reason: "not_available_here" });
        else consider("looking_for", v, i);
      });
      if (input.home_area) {
        consider("home_area.city", input.home_area.city);
        if (input.home_area.neighborhood) consider("home_area.neighborhood", input.home_area.neighborhood);
      }
      if (input.availability_note) consider("availability_note", input.availability_note);
      list("languages");
      if (accepted) this.channelMessages.push({ memberId: me.id, text: `${p.hostDisplayName} suggested ${accepted} detail${accepted === 1 ? "" : "s"} for your profile. Review them in The Network.` });
      return {
        result: {
          status: "proposed_for_member_review", accepted_count: accepted, rejected,
          next_step: accepted
            ? "The Network will ask the member to review these. Nothing is shown to other members until they confirm."
            : "Nothing was saved. The member can tell The Network directly by text.",
        },
        receipt: this.receipt(p, TOOL_NAMES.share, `Received ${accepted} suggested profile detail(s).`, 0),
      };
    });
  }

  // ------------------------------------------------------------------------ get_network_updates
  getUpdates(p: ConnectorPrincipal, input: UpdatesIn): Outcome<UpdatesOut> {
    const me = this.member(p, TOOL_NAMES.updates, SCOPES.readBasic);
    const limit = input.limit ?? 5;
    const offset = input.cursor && /^c[0-9a-z]+$/.test(input.cursor) ? Number.parseInt(input.cursor.slice(1), 36) : 0;
    const all = this.visibleItems(p, me).filter((i) => !input.kinds || input.kinds.includes(i.kind));
    const page = all.slice(offset, offset + limit);
    this.logRead(p, TOOL_NAMES.updates, `Read ${page.length} update(s).`); // seen-via, not delivery (§5.6)
    return {
      result: {
        items: page.map((i) => this.itemOut(p, i)),
        next_cursor: offset + limit < all.length ? `c${(offset + limit).toString(36)}` : null,
        participation_state: me.state,
      },
    };
  }

  // ------------------------------------------------------------------------ respond_to_network_item
  respond(p: ConnectorPrincipal, input: RespondIn): Outcome<RespondOut> {
    const me = this.member(p, TOOL_NAMES.respond, SCOPES.writeResponses);
    return this.once(p, TOOL_NAMES.respond, input, () => {
      const r = (out: RespondOut, summary: string, tier?: Tier): Outcome<RespondOut> => ({ result: out, receipt: this.receipt(p, TOOL_NAMES.respond, summary, tier) });
      const now = this.clock.now();
      if (input.note && looksLikeContact(input.note))
        throw new NetworkError("invalid_input", "The note can't include phone numbers, emails, links or handles.");
      // Unknown, foreign-member and foreign-grant ids are indistinguishable (no enumeration oracle).
      const notFound = () => new NetworkError("item_not_found", "I can't find that item. Check get_network_updates for current items.");

      if (input.item_id.startsWith("cnf_")) {
        const c = this.confirmations.get(input.item_id);
        if (!c || c.memberId !== me.id || c.grantId !== p.grantId) throw notFound();
        if (c.status !== "pending") return r({ status: "already_done", message: c.status === "done" ? "That was already done." : "That was already cancelled.", pending_confirmation: null }, "Answered a finished confirmation.");
        if (c.expiresAt <= now) return r({ status: "expired", message: "That confirmation expired. Nothing was done.", pending_confirmation: null }, "Answered an expired confirmation.");
        if (input.response === "cancel") {
          c.status = "cancelled";
          return r({ status: "done", message: "Cancelled. Nothing was sent.", pending_confirmation: null }, `Cancelled: ${c.summary}`);
        }
        if (input.response !== "confirm")
          return r({ status: "needs_confirmation", message: `Answer with confirm or cancel: ${c.summary}`, pending_confirmation: this.publicConf(c) }, "Asked about a pending confirmation.");
        // Re-evaluate at confirmation time: a tier-1 confirmation can escalate, never de-escalate.
        const tier = Math.max(c.tier, this.tierFor(p, c.tier)) as Tier;
        if (tier >= 2) {
          c.tier = tier;
          c.expiresAt = Math.max(c.expiresAt, now + confirmationTtlMs(tier)); // the member gets the channel's full window
          this.askOnNetworkChannel(c);
          return r({ status: "confirm_in_network_app", message: "The Network has messaged you directly to confirm this. Nothing happens until you reply there.", pending_confirmation: this.publicConf(c) }, `Asked member to confirm in the Network channel: ${c.summary}`, tier);
        }
        if (!this.stillActionable(c))
          return r({ status: "expired", message: "That's no longer open. Nothing was done.", pending_confirmation: null }, "Confirmed an item that is no longer open.");
        this.execute(c, "host");
        return r({ status: "done", message: `Done: ${c.summary}`, pending_confirmation: null }, `Confirmed: ${c.summary}`, tier);
      }

      const it = this.findOwnItem(p, me, input.item_id);
      if (!it) throw notFound();
      // Excluded by profile or not eligible (e.g. an intro for a member under 18): polite, no reason given.
      if (!this.itemVisible(p, me, it))
        return r({ status: "not_available_here", message: NOT_AVAILABLE, pending_confirmation: null }, "Tried to answer an item not available here.");
      if (it.status === "answered") return r({ status: "already_done", message: "You already answered that one.", pending_confirmation: null }, "Answered an item twice.");
      if (it.expiresAt !== null && it.expiresAt <= now) return r({ status: "expired", message: "That one has expired.", pending_confirmation: null }, "Answered an expired item.");
      if (!it.allowedResponses.includes(input.response))
        return r({ status: "not_available_here", message: `That answer isn't available for this item. Options: ${it.allowedResponses.join(", ")}.`, pending_confirmation: null }, "Gave a disallowed answer.");

      if (input.response === "tell_me_more")
        return r({ status: "details", message: it.title, details: it.details, pending_confirmation: null }, "Asked for more detail.", 0);
      if (input.response === "maybe_later") {
        it.status = "snoozed";
        return r({ status: "done", message: "Okay, I'll bring it back later if it's still open.", pending_confirmation: null }, `Snoozed: ${it.title}`, 0);
      }
      const action: ActionKind = input.response === "interested" ? "respond_interested" : input.response === "not_for_me" || input.response === "cancel" ? "respond_not_for_me" : "respond_confirm_item";
      // Saying yes to a contact swap or to a relayed message commits another member: tier 3 (§6.1).
      const base: Tier = (it.facts.connection === "contact" || it.facts.connection === "relay") && action !== "respond_not_for_me" ? 3 : ACTION_TIER[action];
      const summary = `${input.response === "interested" ? "Say you're interested in" : input.response === "confirm" ? "Confirm" : "Pass on"}: ${it.title}.`;
      const c = this.pend(p, action, summary, { item: it.internalId, response: input.response }, base);
      if (c.tier >= 2)
        return r({ status: "confirm_in_network_app", message: "The Network has messaged you directly to confirm this. Nothing happens until you reply there.", pending_confirmation: this.publicConf(c) }, `Asked member to confirm in the Network channel: ${summary}`, c.tier);
      this.execute(c, "host");
      const message = input.response === "interested"
        ? "Great. I'll check with them privately and let you know if it's a yes. If not, you won't hear anything awkward."
        : input.response === "confirm" ? "Confirmed." : "No problem. They won't be told you passed.";
      return r({ status: "done", message, pending_confirmation: null }, summary, c.tier);
    });
  }

  /** The member replies YES on the Network's own channel (tier 2/3). Only this executes those actions. */
  confirmOnNetworkChannel(confirmationId: string, memberId: string): boolean {
    const c = this.confirmations.get(confirmationId);
    if (!c || c.memberId !== memberId || c.status !== "pending" || c.tier < 2 || c.expiresAt <= this.clock.now()) return false;
    if (!this.stillActionable(c)) return false;
    this.execute(c, "network_channel");
    return true;
  }
}

/** Requests that would connect the member with other people (blocked for under-18 members). */
// Runs on folded text (case, Unicode forms, homoglyphs, spacing and leetspeak; policy.ts), and fails
// closed: a false positive is a polite "isn't available", a false negative connects a minor.
const PEOPLE = /\b(introduc\w*|intros?|meet\w*|connect(ed|ing)? (me|with)|find (me )?(someone|somebody|people|a|friends?|partners?)|partners?|buddy|buddies|friends?|friendships?|pen ?pals?|mentors?|mentee|mentoring|mentorship|tutor\w*|teammates?|team|group|club|crew|squad|people|someone|somebody|person|hang ?out|hangout|chat with|talk to|invite\w*|share my (number|phone|contact|email)|swap (numbers|contacts)|need help|help me|looking for|anyone (know|who)|(message|text|dm|call|email|ping) (?!me\b)[a-z]+|let (?!me\b)[a-z]+ know)\b/;
export const involvesPeople = (s: string) =>
  matchFolded(PEOPLE, s) !== null || /\b([Mm]essage|[Tt]ell|[Tt]ext|[Aa]sk|[Ll]et) (?!I\b)[A-Z][a-z]*\b/.test(s.normalize("NFKC"));

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

// ------------------------------------------------------------------------------------------------
/** Small synthetic world for tests and local runs. Clearly fictional; CANARY strings detect leaks. */
export function seedWorld(net: FakeNetwork) {
  const day = 24 * 3600_000;
  const now = net.clock.now();
  const ava = net.addMember({
    id: "mem_ava_7f3a", firstName: "Ava", age: 29, city: "sf", state: "normal", phone: "+14155550101", email: "ava@example.test",
    facets: [
      { value: "Climbs at Mission Cliffs on Thursdays", scope: "shareable" },
      { value: "Wants more low-pressure local friends", scope: "matchable" },
      { value: "CANARY_AVA_PRIVATE_feeling isolated since the move", scope: "agent_private" },
    ],
  });
  const maya = net.addMember({
    id: "mem_maya_91c2", firstName: "Maya", age: 31, city: "sf", state: "open", phone: "+14155550102", email: "maya@example.test",
    facets: [
      { value: "Product designer who loves bouldering", scope: "shareable" },
      { value: "CANARY_MAYA_MATCHABLE_recently divorced", scope: "matchable" },
      { value: "CANARY_MAYA_PRIVATE_job search is secret", scope: "agent_private" },
    ],
  });
  const theo = net.addMember({
    id: "mem_theo_44d0", firstName: "Theo", age: 40, city: "nyc", state: "normal", phone: "+12125550103", email: "theo@example.test",
    facets: [{ value: "CANARY_THEO_PRIVATE_salary 400k", scope: "agent_private" }],
  });
  const kai = net.addMember({
    id: "mem_kai_2b19", firstName: "Kai", age: 16, city: "sf", state: "normal", phone: "+14155550104", email: "kai@example.test",
    facets: [{ value: "Into skateboarding and robotics", scope: "matchable" }],
  });

  const plain = { venueMinAge: 0 as const, alcoholCentric: false, sponsored: false };
  const intro = net.addItem(ava.id, {
    kind: "opportunity", title: "Climbing partner in the Mission",
    summary: "Maya, a product designer who also boulders, is around on Thursday evenings. Want an intro?",
    details: "You both climb on Thursdays and want low-key partners. If you're both in, The Network suggests a time; it would take about an hour, and you can say no at any time.",
    when: "Thursdays after 6pm", where: "Mission District", expiresAt: now + 2 * day,
    allowedResponses: ["interested", "not_for_me", "maybe_later", "tell_me_more"],
    facts: { category: "activity_partners", connection: "intro", ...plain }, counterpartId: maya.id,
  });
  const question = net.addItem(ava.id, {
    kind: "question", title: "Quick question", summary: "Are weekday evenings or weekend mornings better for meeting people?",
    expiresAt: null, allowedResponses: ["not_for_me", "maybe_later", "tell_me_more"],
    facts: { category: "friendship", connection: null, ...plain },
  });
  const trivia = net.addItem(ava.id, {
    kind: "opportunity", title: "Trivia night at a cocktail bar", summary: "A small team needs a fifth for trivia at a cocktail bar in Hayes Valley (21+).",
    when: "Wed 8pm", where: "Hayes Valley", expiresAt: now + 3 * day,
    allowedResponses: ["interested", "not_for_me", "tell_me_more"],
    facts: { category: "nightlife", connection: "group", venueMinAge: 21, alcoholCentric: true, sponsored: false },
  });
  const romance = net.addItem(ava.id, {
    kind: "opportunity", title: "CANARY_ROMANCE_dating match", summary: "CANARY_ROMANCE_someone you might want to date",
    expiresAt: now + 3 * day, allowedResponses: ["interested", "not_for_me"],
    facts: { category: "romance", connection: "intro", venueMinAge: 0, alcoholCentric: false, sponsored: false },
  });
  const sponsored = net.addItem(ava.id, {
    kind: "notice", title: "CANARY_SPONSORED_gym day pass", summary: "CANARY_SPONSORED_partner offer from a climbing gym",
    expiresAt: now + 5 * day, allowedResponses: ["interested", "not_for_me"],
    facts: { category: "events", connection: null, venueMinAge: 0, alcoholCentric: false, sponsored: true },
  });
  const contactSwap = net.addItem(ava.id, {
    kind: "question", title: "Swap numbers with your climbing partner?", summary: "Your climbing partner from last week would like to swap numbers. Only if you both say yes.",
    expiresAt: now + 2 * day, allowedResponses: ["interested", "not_for_me"],
    facts: { category: "activity_partners", connection: "contact", ...plain },
  });
  const mayaItem = net.addItem(maya.id, {
    kind: "opportunity", title: "CANARY_MAYA_ITEM_climbing partner", summary: "CANARY_MAYA_ITEM_someone nearby who climbs on Thursdays would like to meet.",
    expiresAt: now + 2 * day, allowedResponses: ["interested", "not_for_me"],
    facts: { category: "activity_partners", connection: "intro", ...plain }, counterpartId: ava.id,
  });

  // Kai is 16: can be a member, never connected to other people (founder decision 3).
  const kaiIntro = net.addItem(kai.id, {
    kind: "opportunity", title: "CANARY_KAI_INTRO_skate buddy", summary: "CANARY_KAI_INTRO_another member skates at the same park",
    expiresAt: now + 2 * day, allowedResponses: ["interested", "not_for_me", "tell_me_more"],
    facts: { category: "activity_partners", connection: "intro", ...plain },
  });
  const kaiGroup = net.addItem(kai.id, {
    kind: "opportunity", title: "CANARY_KAI_GROUP_robotics team", summary: "CANARY_KAI_GROUP_a group building a robot on Saturdays",
    expiresAt: now + 2 * day, allowedResponses: ["interested", "not_for_me"],
    facts: { category: "activity_partners", connection: "group", ...plain },
  });
  const kaiRelay = net.addItem(kai.id, {
    kind: "notice", title: "CANARY_KAI_RELAY_message from a member", summary: "CANARY_KAI_RELAY_someone sent you a note",
    expiresAt: now + 2 * day, allowedResponses: ["tell_me_more"],
    facts: { category: "friendship", connection: "relay", ...plain },
  });
  const kaiContact = net.addItem(kai.id, {
    kind: "question", title: "CANARY_KAI_CONTACT_swap numbers", summary: "CANARY_KAI_CONTACT_someone wants to swap numbers",
    expiresAt: now + 2 * day, allowedResponses: ["interested", "not_for_me"],
    facts: { category: "friendship", connection: "contact", ...plain },
  });
  const kaiEvent = net.addItem(kai.id, {
    kind: "opportunity", title: "Robotics open lab at the library", summary: "An all-ages drop-in robotics lab at the main library this Saturday afternoon.",
    when: "Sat 1–4pm", where: "Civic Center", expiresAt: now + 4 * day,
    allowedResponses: ["interested", "not_for_me", "tell_me_more"],
    facts: { category: "events", connection: null, ...plain },
  });

  return { ava, maya, theo, kai, intro, question, trivia, romance, sponsored, contactSwap, mayaItem, kaiIntro, kaiGroup, kaiRelay, kaiContact, kaiEvent };
}
