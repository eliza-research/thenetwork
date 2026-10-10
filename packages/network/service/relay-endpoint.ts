// POST /internal/relay: a member's relay request from Eliza (issues #8, #9, #10; AGENTS.md "Relay (#7)").
//
// Eliza's relay action posts what the member asked for after a match ("tell them I'm running late",
// "send them my number", a photo) during an open turn. The request is signed with SERVICE_TURN_SECRET
// (core svc-auth), idempotent on x-ntwrk-svc-id (= idempotencyKey), size-checked before it is parsed,
// and bound to the original completed open turn and the member's current canonical membership, exactly
// like /internal/set-state: the app and the member come from that turn, never from model output, and
// the recipient is always the member's current match (the relay desk picks it; the model never names
// anyone). The ConsentNetwork's relay desk (packages/network/src/relay.ts) asks the engine relay policy
// (`relayItemAsync` with the Clef classifier when CLOUDFLARE_AI_TOKEN and CLOUDFLARE_ACCOUNT_ID are
// set; rules only otherwise) and only the engine's `rendered` text goes to the other member, through
// the outbound queue and the Cloud deliver path with kind "relay".
//
// The request and response types are local: packages/core/src/svc/contract.ts mirrors the upstream
// plugin-network contract byte for byte and is not edited here. The proposed upstream addition is in
// packages/network/service/README.md ("Relay").
//
//   RelayRequest  {channel, messageId, app, memberId, idempotencyKey, kind: text|contact_share|photo, text: string|null, photoIds: string[]|null}
//   RelayResponse {decision: sent|held|refused, reason (safe to say to the member), replayed}
import { createHash } from "node:crypto";
import type { SQL } from "bun";
import type { Clock } from "@thenetwork/core";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { isAppId, type AppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import type { PhotoService } from "../../platform/src/photos.ts";
import { clefRelayClassifierFromEnv } from "../../engine/src/relayClef.ts";
import type { RelayClassifierHook } from "../../engine/src/relay.ts";
import type { NetworkRuntime } from "./runtime.ts";

export const RELAY_PATH = "/internal/relay";
/** A relay request is small: a message of at most 1000 characters and a few photo ids. */
export const RELAY_MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT = 1000;
const MAX_PHOTOS = 3;

export type RelayRequestKind = "text" | "contact_share" | "photo";
export interface RelayRequest {
  channel: "blooio" | "twilio";
  /** The open turn this action belongs to (platform.inbound id msg:<channel>:<messageId>). */
  messageId: string;
  app: AppId;
  memberId: string;
  /** Equals x-ntwrk-svc-id; one relayed item per key. */
  idempotencyKey: string;
  kind: RelayRequestKind;
  /** The message (text), or an optional caption (photo); null for a number swap. */
  text: string | null;
  /** The member's own photo ids (photo only), else null. */
  photoIds: string[] | null;
}
export interface RelayResponse { decision: "sent" | "held" | "refused"; reason: string; replayed: boolean }

const KEYS = ["channel", "messageId", "app", "memberId", "idempotencyKey", "kind", "text", "photoIds"];

export interface RelayEndpointDeps {
  sql: SQL;
  clock: Clock;
  secret: string | undefined;
  accounts: Accounts;
  photos?: PhotoService;
  runtimeFor(app: AppId): NetworkRuntime | undefined;
  /** The classifier hook; undefined = rules only. */
  hook?: RelayClassifierHook;
}

/**
 * The relay classifier from the environment: Clef (clef-flash by default) when the Workers AI token and
 * account are set, else rules only. Logs which one once, at start.
 */
export function relayClassifierFromEnv(env: Record<string, string | undefined>, log: (s: string) => void): RelayClassifierHook | undefined {
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) { log("relay classifier: rules only"); return undefined; }
  log(`relay classifier: rules + Clef (${env.RELAY_CLEF_MODEL === "clef" ? "clef" : "clef-flash"})`);
  return clefRelayClassifierFromEnv(env, { onEvent: e => { if (e.outcome === "error" || e.outcome === "timeout") log(`[relay] clef ${e.outcome}${e.status ? ` ${e.status}` : ""} (${e.ms} ms)`); } });
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
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== KEYS.length || Object.keys(b).some(k => !KEYS.includes(k))
    || (b.channel !== "blooio" && b.channel !== "twilio") || !id(b.messageId, 512) || !isAppId(b.app) || !id(b.memberId, 256)
    || !id(b.idempotencyKey, 512) || auth.id !== b.idempotencyKey) return json({ error: "invalid_request" }, 400);
  const kind = b.kind as RelayRequestKind;
  const text = b.text, photoIds = b.photoIds;
  if (!["text", "contact_share", "photo"].includes(kind)
    || (text !== null && (typeof text !== "string" || text.length > MAX_TEXT))
    || (photoIds !== null && (!Array.isArray(photoIds) || photoIds.length > MAX_PHOTOS || photoIds.some(p => typeof p !== "string" || p.length > 64)))
    || (kind === "text" && (typeof text !== "string" || !text.trim() || photoIds !== null))
    || (kind === "contact_share" && (text !== null || photoIds !== null))
    || (kind === "photo" && (!Array.isArray(photoIds) || !photoIds.length))) return json({ error: "invalid_relay" }, 400);
  const app = b.app as AppId, memberId = b.memberId as string, key = b.idempotencyKey as string;

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
    // Photos: only the member's own ids; none can be shown to a match until a photo consent exists.
    const owned = kind === "photo" && d.photos ? (await d.photos.list(who.person.id, app)).map(p => p.id) : [];
    const itemId = `r_${receipt.slice(0, 32)}`;
    const outcome = await rt.unitOfWork(net => net.relayRequest(
      { itemId, from: memberId, kind, ...(typeof text === "string" && text.trim() ? { text } : {}), ...(Array.isArray(photoIds) ? { photoIds: photoIds as string[] } : {}) },
      { ...(d.hook ? { hook: d.hook } : {}), contactOf: id => rt.addressOf(id), photos: { ids: owned, showConsent: false } },
    ));
    const result: RelayResponse = { decision: outcome.decision, reason: outcome.reason, replayed: false };
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
