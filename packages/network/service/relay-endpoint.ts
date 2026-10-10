// POST /internal/relay: a member's relay request from Eliza Cloud's RELAY action (issues #8, #9, #10;
// AGENTS.md "Relay (#7)"). The wire is Cloud's: RelaySendRequest / RelaySendResponse in
// packages/core/src/svc/contract.ts, the byte-for-byte mirror of elizaOS/eliza plugin-network (b763).
//
//   RelaySendRequest  {channel, messageId, app, memberId, itemId: string|null, text}
//   RelaySendResponse {decision: pass|hold|block|none, senderNotice, delivered, replayed}
//
// Cloud signs it with SERVICE_TURN_SECRET (core svc-auth) and x-ntwrk-svc-id = "<messageId>:relay": one
// relay per open turn, idempotent on that key. The request is size-checked before it is parsed and bound
// to the original completed open turn and the member's current canonical membership, exactly like
// /internal/set-state: the app and the member come from that turn, never from model output. `text` must be
// that turn's own inbound message (network.messages "in:<channel>:<messageId>"), never model wording; the
// service reads the request from it (engine parseRelayRequest: a text, "send them my number", a photo, or
// nothing to relay). `itemId` may only narrow the match to an active item the turn's context offered.
//
// The ConsentNetwork's relay desk (packages/network/src/relay.ts) is the one owner of the decision: it
// picks the member's current mutual match (the model never names anyone), asks the engine relay policy
// (`relayItemAsync` with the Clef classifier when CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID are set;
// rules only otherwise), holds for staff, swaps numbers only after both members asked, and sends only the
// engine's `rendered` text, through the outbound queue ("relay:<item>", Cloud deliver kind "relay"). The
// canonical owners' word on both members (consent ledger and STOP, bans, holds, membership, the lowest
// age) tightens the desk's view for the request, and the queue reads the match and both members again at
// final dispatch (runtime.ts relayAdmission). Photos are not on this wire (no attachment in Cloud's
// DeliverRequest), so a photo request is refused.
//
// The action receipt, the relay log, the messages and the queued rows commit in one transaction (the
// unit's save). `delivered` is true only for a pass whose outbound row Cloud accepted with provider ids
// and recorded history; a replay reads that again (an unknown acceptance is recovered by the queue's
// receipt-only lookup, never by a second send).
import { createHash } from "node:crypto";
import type { SQL } from "bun";
import type { Clock, MemberId } from "@thenetwork/core";
import { RELAY_PATH, type RelaySendResponse } from "../../core/src/svc/contract.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { isAppId, type AppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { clefRelayClassifierFromEnv } from "../../engine/src/relayClef.ts";
import { parseRelayRequest, type RelayClassifierHook } from "../../engine/src/relay.ts";
import { withdrawsSwap, type RelayOutcome } from "../src/relay.ts";
import type { NetworkRuntime } from "./runtime.ts";
import type { CostLedger } from "./cost.ts";
import { isProduction } from "../../platform/src/env.ts";

export { RELAY_PATH };
/** A relay request is small: Cloud caps the text at 2000 characters. */
export const RELAY_MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT = 2000;
const KEYS = ["channel", "messageId", "app", "memberId", "itemId", "text"];

const NOTICE = {
  photo: "I can't send photos to a match yet.",
  unconfirmed: "I've passed that on, but delivery isn't confirmed yet.",
  sent: "Sent.",
  withdrawn: "Okay, I won't share your number.",
};

export interface RelayEndpointDeps {
  sql: SQL;
  clock: Clock;
  secret: string | undefined;
  accounts: Accounts;
  runtimeFor(app: AppId): NetworkRuntime | undefined;
  /** The network ('<app>:<city>') this member belongs to; falls back to runtimeFor(app) when absent. */
  runtimeOfMember?(app: AppId, memberId: string): Promise<NetworkRuntime | undefined>;
  /** The classifier hook for an app (each Workers AI call is a cost row for that app); undefined = rules only. */
  hookFor?: (app: AppId) => RelayClassifierHook;
}

/**
 * The relay classifier from the environment, per app: Clef (clef-flash by default) when the Workers AI
 * token and account are set, else rules only (undefined). Logs which one once, at start. With a cost
 * ledger, every Clef call that reached Workers AI is a cost row for the app (cost.ts relayClefEvent).
 * Production without Clef fails closed: the hook always errors, so every text the rules pass is held for
 * staff (the go-live checklist requires Clef wired); dev and staging run on the rules alone.
 */
export function relayClassifierFromEnv(env: Record<string, string | undefined>, log: (s: string) => void, cost?: CostLedger): ((app: AppId) => RelayClassifierHook) | undefined {
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    if (isProduction(env)) {
      log("relay classifier: not configured in production; every relayed text is held for staff");
      const closed: RelayClassifierHook = async () => { throw new Error("relay classifier not configured"); };
      return () => closed;
    }
    log("relay classifier: rules only");
    return undefined;
  }
  log(`relay classifier: rules + Clef (${env.RELAY_CLEF_MODEL === "clef" ? "clef" : "clef-flash"})`);
  const hooks = new Map<AppId, RelayClassifierHook>();
  return app => {
    let h = hooks.get(app);
    if (!h) {
      const meter = cost?.relayClefEvent(app);
      h = clefRelayClassifierFromEnv(env, { onEvent: e => {
        meter?.(e);
        if (e.outcome === "error" || e.outcome === "timeout") log(`[relay] clef ${e.outcome}${e.status ? ` ${e.status}` : ""} (${e.ms} ms)`);
      } });
      hooks.set(app, h);
    }
    return h;
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** What the action receipt keeps: the decision and the desk's notice, and the outbound id of a pass. */
interface StoredRelay { decision: RelaySendResponse["decision"]; notice: string; outboundId?: string }

/** The desk's outcome on the Cloud wire. */
function stored(outcome: RelayOutcome): StoredRelay {
  if (outcome.decision === "sent") return { decision: "pass", notice: outcome.reason, outboundId: `relay:${outcome.itemId}` };
  return { decision: outcome.decision === "held" ? "hold" : "block", notice: outcome.reason };
}

/**
 * The answer for a stored decision. Delivered only when Cloud accepted the outbound row with provider ids
 * and recorded it in history; until then a pass says so plainly (Cloud never reports it as sent).
 */
async function answer(sql: SQL, app: AppId, s: StoredRelay, replayed: boolean): Promise<RelaySendResponse> {
  if (s.decision !== "pass" || !s.outboundId) return { decision: s.decision, senderNotice: s.notice, delivered: false, replayed };
  const [row] = await sql.begin(async tx => {
    await tx`select set_config('app.app_id',${app},true)`;
    return tx`select status,provider_message_ids,history_recorded from platform.outbound where app_id=${app} and id=${s.outboundId!}`;
  });
  const delivered = !!row && ["accepted", "sent", "delivered", "read"].includes(row.status) && row.history_recorded === true
    && Array.isArray(row.provider_message_ids) && row.provider_message_ids.length > 0;
  return { decision: "pass", senderNotice: delivered ? NOTICE.sent : s.notice && s.notice !== NOTICE.sent ? s.notice : NOTICE.unconfirmed, delivered, replayed };
}

export async function relayEndpoint(d: RelayEndpointDeps, req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (url.search) return json({ error: "invalid_request" }, 400);
  // Size first: nothing is parsed or verified past the cap.
  const bytes = await readCapped(req, RELAY_MAX_BODY_BYTES);
  if (bytes === "too_large") return json({ error: "payload_too_large" }, 413);
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return json({ error: "invalid_request" }, 400); }
  const auth = await svcVerify(d.secret, { method: req.method, path: url.pathname, headers: req.headers, body: raw, nowS: Math.floor(d.clock.now() / 1000) });
  if (!auth.ok) return json({ error: auth.reason }, auth.reason === "no_secret" ? 503 : 401);
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return json({ error: "invalid_request" }, 400); }
  const id = (v: unknown, max: number) => typeof v === "string" && !!v.trim() && v.length <= max && !/[\r\n\u0000]/.test(v);
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== KEYS.length || Object.keys(b).some(k => !(KEYS as string[]).includes(k))
    || (b.channel !== "blooio" && b.channel !== "twilio") || !id(b.messageId, 512) || !isAppId(b.app) || !id(b.memberId, 256)
    || auth.id !== `${b.messageId}:relay`) return json({ error: "invalid_request" }, 400);
  if ((b.itemId !== null && !id(b.itemId, 200)) || typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_TEXT) return json({ error: "invalid_relay" }, 400);
  const app = b.app as AppId, memberId = b.memberId as string, text = b.text.trim(), itemId = b.itemId as string | null;

  // The original completed open turn and the member's current membership (as /internal/set-state).
  const turnId = `msg:${b.channel}:${b.messageId}`;
  const [original] = await d.sql`select sender_hash,response from platform.inbound where id=${turnId} and status='done'`;
  if (!original || original.response?.outcome !== "open" || original.response.app !== app || original.response.memberId !== memberId) return json({ error: "turn_scope_invalid", retryable: false }, 403);
  // The member's own network (a second city of the app keeps its own matches, relay log and held items).
  const who = await d.accounts.byPhoneHash(original.sender_hash), rt = d.runtimeOfMember ? await d.runtimeOfMember(app, memberId) : d.runtimeFor(app);
  if (!who || !rt) return json({ error: "membership_unavailable", retryable: false }, 403);
  const authorized = async () => (await d.accounts.activeMembership(rt.app, { e164: who.e164, personId: who.person.id }))?.membership.memberId === memberId;
  if (!await authorized()) return json({ error: "membership_unavailable", retryable: false }, 403);
  // The text is the member's own message of that turn, and an item is one the turn's context offered.
  const [source] = await rt.scoped(tx => tx`select body from network.messages where app_id=${app} and id=${`in:${b.channel}:${b.messageId}`}
    and member_id=${memberId} and direction='inbound'`);
  const offered = (original.response.context?.activeItems ?? []) as { id: string }[];
  if (!source || typeof source.body !== "string" || source.body.trim() !== text || (itemId !== null && !offered.some(item => item?.id === itemId)))
    return json({ error: "relay_source_invalid", retryable: false }, 403);

  const receipt = createHash("sha256").update(JSON.stringify([turnId, RELAY_PATH, auth.id])).digest("hex");
  const digest = createHash("sha256").update(raw).digest("hex");
  const lock = async (tx: SQL) => {
    await tx`select id from platform.people where id=${who.person.id} and deleted_at is null for update`;
    await tx`select set_config('app.app_id',${app},true)`;
    await tx`select member_id from platform.memberships where person_id=${who.person.id} and app_id=${app} for update`;
    const [turn] = await tx`select status,response,sender_hash,action_receipts from platform.inbound where id=${turnId} for update`;
    if (!turn || turn.status !== "done" || turn.sender_hash !== original.sender_hash || turn.response?.outcome !== "open"
      || turn.response.app !== app || turn.response.memberId !== memberId || !await authorized()) throw new Error("Original turn authority changed");
    return turn;
  };
  const complete = async (tx: SQL, result: StoredRelay) => {
    const saved = await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "completed", response: result }}::jsonb)
      where id=${turnId} and status='done' and action_receipts->${receipt}->>'requestHash'=${digest} and action_receipts->${receipt}->>'state'='processing' returning id`;
    if (!saved.length) throw new Error("Action ownership changed before completion");
  };
  let replay: StoredRelay | null | Response;
  try {
    replay = await d.sql.begin(async tx => {
      const turn = await lock(tx), prior = turn.action_receipts?.[receipt];
      if (prior) {
        if (prior.requestHash !== digest) return json({ error: "action_conflict", retryable: false }, 409);
        if (prior.state !== "completed") return json({ error: "action_unresolved", retryable: false }, 409);
        return prior.response as StoredRelay;
      }
      if (Object.keys(turn.action_receipts ?? {}).length >= 16) return json({ error: "action_limit", retryable: false }, 429);
      await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "processing" }}::jsonb) where id=${turnId}`;
      return null;
    }) as StoredRelay | null | Response;
  } catch { return json({ error: "membership_unavailable", retryable: false }, 403); }
  if (replay instanceof Response) return replay;
  // A replay classifies and sends nothing: it reads the stored decision and the outbound row again.
  if (replay) return json(await answer(d.sql, app, replay, true));

  try {
    const request = parseRelayRequest(text);
    let result: StoredRelay;
    if (request.kind === "none" && withdrawsSwap(text)) {
      // "Don't send my number": the member takes back a pending number swap (committed with the receipt).
      result = await rt.unitOfWork(async net => {
        // The turn's own message may already have withdrawn it (network.ts); either way nothing of theirs is pending.
        net.relayCancelSwap(memberId as MemberId);
        const r: StoredRelay = { decision: "none", notice: NOTICE.withdrawn };
        rt.unit.completeAction = async tx => { await lock(tx); await complete(tx, r); };
        return r;
      });
    } else if (request.kind === "none" || request.kind === "photo") {
      // Nothing to relay ("none"), or a photo, which this wire cannot carry: the receipt alone.
      result = request.kind === "none" ? { decision: "none", notice: "" } : { decision: "block", notice: NOTICE.photo };
      await d.sql.begin(async tx => { await lock(tx); await complete(tx, result); });
    } else {
      const key = `r_${receipt.slice(0, 32)}`;
      result = await rt.unitOfWork(async net => {
        // The canonical owners' word on both members of the match the desk will pick (fails closed).
        const match = net.relayMatch(memberId as MemberId, itemId ?? undefined);
        const canonical = match ? await rt.relayParties([...match.participants]) : undefined;
        const hook = d.hookFor?.(app);
        const outcome = await net.relayRequest(
          { itemId: key, from: memberId as MemberId, kind: request.kind, ...(request.kind === "text" ? { text: request.body } : {}), ...(itemId !== null ? { matchId: itemId } : {}) },
          { ...(hook ? { hook } : {}), contactOf: id => rt.addressOf(id), ...(canonical ? { canonical } : {}) },
        );
        const r = stored(outcome);
        // Committed with the relay log, the messages and the queued rows of this unit (runtime.ts writeUnit).
        rt.unit.completeAction = async tx => { await lock(tx); await complete(tx, r); };
        return r;
      });
    }
    return json(await answer(d.sql, app, result, false));
  } catch {
    await d.sql`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "unresolved" }}::jsonb)
      where id=${turnId} and status='done' and action_receipts->${receipt}->>'requestHash'=${digest} and action_receipts->${receipt}->>'state'='processing'`;
    return json({ error: "action_unresolved", retryable: false }, 409);
  }
}
