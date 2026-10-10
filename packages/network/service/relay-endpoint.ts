// POST /internal/relay: a member's relay request from Eliza (issues #8, #9, #10; AGENTS.md "Relay (#7)").
//
// The upstream RELAY action (elizaos/eliza plugins/plugin-network, actions/relay.ts) posts the member's
// OWN inbound message during an open turn ("tell them I'm running late", "send them my number"), never
// model output, with at most an `itemId` the model chose from the open turn's active items. The wire
// types are the upstream contract, RelaySendRequest and RelaySendResponse (packages/core/src/svc/contract.ts,
// the byte-identical mirror). The request is signed with SERVICE_TURN_SECRET (core svc-auth), idempotent
// on x-ntwrk-svc-id (the upstream client sends `<messageId>:relay`, one relay per open turn),
// size-checked before it is parsed, and bound to the original completed open turn and the member's
// current canonical membership, exactly like /internal/set-state: the app and the member come from that
// turn, never from model output, and the recipient is always the member's current match (the relay desk
// picks it; the model never names anyone).
//
// The service reads the request itself (engine `parseRelayRequest`): text, number swap, photo or none.
// "none" sends nothing. An `itemId` that is not the member's current open match is refused before
// anything is sent (upstream #34661: an unknown target never selects a different recipient); null means
// the newest open match. Photos are refused until a photo-show consent exists (Legal). Everything else is
// the ConsentNetwork's relay desk (packages/network/src/relay.ts): the engine relay policy
// (`relayItemAsync` with the Clef classifier when CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID are set;
// rules only otherwise; minors are never relayed), and only the engine's `rendered` text goes to the
// other member, through the outbound queue and the Cloud deliver path with kind "relay".
//
//   decision  pass (sent) | hold (staff review, a rate limit or a swap waiting for the other member) |
//             block (never sent) | none (no relay request in the message)
//   senderNotice  a fixed sentence (engine NOTICE, desk NOTICE or below): never the matched text, never a rule
//   delivered     true only when `rendered` was handed to the send path now (not deferred to a reasonable hour)
//
// On the Eliza side the action exists only when NETWORK_RELAY_ENABLED=1 (upstream #34661).
import { createHash } from "node:crypto";
import type { SQL } from "bun";
import type { Clock } from "@thenetwork/core";
import { RELAY_PATH, type RelaySendRequest, type RelaySendResponse } from "../../core/src/svc/contract.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { isAppId, type AppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { clefRelayClassifierFromEnv } from "../../engine/src/relayClef.ts";
import { parseRelayRequest, type RelayClassifierHook } from "../../engine/src/relay.ts";
import type { CostLedger } from "./cost.ts";
import type { NetworkRuntime } from "./runtime.ts";

export { RELAY_PATH };
/** A relay request is small: the member's own message (the upstream action caps it at 2000 characters). */
export const RELAY_MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT = 2000;

const KEYS: readonly (keyof RelaySendRequest)[] = ["channel", "messageId", "app", "memberId", "itemId", "text"];

const NOTICE = {
  unknownItem: "I can only pass messages on to someone you've matched with right now.",
  photoOff: "I can't send photos to a match yet.",
};

export interface RelayEndpointDeps {
  sql: SQL;
  clock: Clock;
  secret: string | undefined;
  accounts: Accounts;
  runtimeFor(app: AppId): NetworkRuntime | undefined;
  /** The classifier hook for an app (each Workers AI call is a cost row for that app); undefined = rules only. */
  hookFor?: (app: AppId) => RelayClassifierHook;
}

/**
 * The relay classifier from the environment, per app: Clef (clef-flash by default) when the Workers AI
 * token and account are set, else rules only (undefined). Logs which one once, at start. With a cost
 * ledger, every Clef call that reached Workers AI is a cost row for the app (cost.ts relayClefEvent).
 */
export function relayClassifierFromEnv(env: Record<string, string | undefined>, log: (s: string) => void, cost?: CostLedger): ((app: AppId) => RelayClassifierHook) | undefined {
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) { log("relay classifier: rules only"); return undefined; }
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
    || (b.itemId !== null && !id(b.itemId, 256)) || auth.id !== `${b.messageId}:relay`) return json({ error: "invalid_request" }, 400);
  if (typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_TEXT) return json({ error: "invalid_relay" }, 400);
  const app = b.app as AppId, memberId = b.memberId as string, key = auth.id, text = b.text, itemId = b.itemId as string | null;

  // The original completed open turn and the member's current membership (as /internal/set-state).
  const turnId = `msg:${b.channel}:${b.messageId}`;
  const [original] = await d.sql`select sender_hash,response from platform.inbound where id=${turnId} and status='done'`;
  if (!original || original.response?.outcome !== "open" || original.response.app !== app || original.response.memberId !== memberId) return json({ error: "turn_scope_invalid", retryable: false }, 403);
  const who = await d.accounts.byPhoneHash(original.sender_hash), rt = d.runtimeFor(app);
  if (!who || !rt) return json({ error: "membership_unavailable", retryable: false }, 403);
  const authorized = async () => (await d.accounts.activeMembership(rt.app, { e164: who.e164, personId: who.person.id }))?.membership.memberId === memberId;
  if (!await authorized()) return json({ error: "membership_unavailable", retryable: false }, 403);

  const receipt = createHash("sha256").update(JSON.stringify([turnId, RELAY_PATH, key])).digest("hex");
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
  let claimed: Response | null;
  try {
    claimed = await d.sql.begin(async tx => {
      const turn = await lock(tx), prior = turn.action_receipts?.[receipt];
      if (prior) {
        if (prior.requestHash !== digest) return json({ error: "action_conflict", retryable: false }, 409);
        if (prior.state !== "completed") return json({ error: "action_unresolved", retryable: false }, 409);
        return json({ ...prior.response, replayed: true });
      }
      if (Object.keys(turn.action_receipts ?? {}).length >= 16) return json({ error: "action_limit", retryable: false }, 429);
      await tx`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "processing" }}::jsonb) where id=${turnId}`;
      return null;
    }) as Response | null;
  } catch { return json({ error: "membership_unavailable", retryable: false }, 403); }
  if (claimed) return claimed;

  try {
    const ask = parseRelayRequest(text);
    const result: RelaySendResponse = ask.kind === "none" ? { decision: "none", senderNotice: "", delivered: false, replayed: false }
      : await rt.unitOfWork(async (net): Promise<RelaySendResponse> => {
        const block = (senderNotice: string): RelaySendResponse => ({ decision: "block", senderNotice, delivered: false, replayed: false });
        // An explicit target must be the member's current open match; it never selects anyone else.
        if (itemId !== null && net.relayMatch(memberId)?.id !== itemId) return block(NOTICE.unknownItem);
        // No member can consent to showing photos to a match yet (Legal), so nothing is sent.
        if (ask.kind === "photo") return block(NOTICE.photoOff);
        const hook = d.hookFor?.(app);
        const outcome = await net.relayRequest(
          { itemId: `r_${receipt.slice(0, 32)}`, from: memberId, kind: ask.kind, ...(ask.kind === "text" ? { text: ask.body } : {}) },
          { ...(hook ? { hook } : {}), contactOf: m => rt.addressOf(m) },
        );
        const decision = outcome.decision === "sent" ? "pass" : outcome.decision === "held" ? "hold" : "block";
        return { decision, senderNotice: outcome.reason, delivered: decision === "pass" && outcome.delivered === true, replayed: false };
      });
    const saved = await d.sql`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "completed", response: result }}::jsonb)
      where id=${turnId} and status='done' and action_receipts->${receipt}->>'requestHash'=${digest} and action_receipts->${receipt}->>'state'='processing' returning id`;
    if (!saved.length) throw new Error("Action ownership changed before completion");
    return json(result);
  } catch {
    await d.sql`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "unresolved" }}::jsonb)
      where id=${turnId} and status='done' and action_receipts->${receipt}->>'requestHash'=${digest} and action_receipts->${receipt}->>'state'='processing'`;
    return json({ error: "action_unresolved", retryable: false }, 409);
  }
}
