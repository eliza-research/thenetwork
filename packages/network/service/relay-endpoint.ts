import { createHash } from "node:crypto";
import type { SQL } from "../../core/src/runtime/postgres.ts";
import type { Clock, MemberId } from "@thenetwork/core";
import { RELAY_PATH, type RelaySendResponse } from "../../core/src/svc/contract.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { isAppId, type AppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import type { Accounts } from "../../platform/src/accounts.ts";
import { readFileSync } from "node:fs";
import { clefRelayClassifierFromEnv, DEFAULT_RELAY_CLEF_WEIGHTS, validateRelayClefWeights, type RelayClefWeights } from "../../engine/src/relayClef.ts";
import type { ClefResult } from "../../engine/src/packs/slop/clef.ts";
import { classifyRelayText, parseRelayRequest, relayGuard, RELAY_LIMITS, type RelayClassifierHook, type RelayClassifierInput, type RelayClassifierOutput } from "../../engine/src/relay.ts";
import { isPanicHaltedState, withdrawsSwap, type RelayOutcome } from "../src/relay.ts";
import type { NetworkRuntime } from "./runtime.ts";
import type { CostLedger } from "./cost.ts";
import { PHOTO_RELAY_TEXT, type PhotoRelayAnswer, type PhotoRelayFinish } from "./photoRelayFlow.ts";

import { routeEnvelopeAllowed, type NetworkRoutePolicy } from "./route-authority.ts";

export { RELAY_PATH };
export const RELAY_MAX_BODY_BYTES = 16 * 1024;
const MAX_TEXT = 2000;
const KEYS = ["channel", "messageId", "app", "memberId", "itemId", "text"];

const NOTICE = {
  unconfirmed: "I've passed that on, but delivery isn't confirmed yet.",
  sent: "Sent.",
  withdrawn: "Okay, I won't share your number.",
};

export interface RelayEndpointDeps {
  sql: SQL;
  clock: Clock;
  secret: string | undefined;
  routePolicy?: NetworkRoutePolicy;
  accounts: Accounts;
  photoRequest: (input: { app: AppId; personId: string; memberId: string; text: string; threadId: string | null; inboundId: string; photoAsked: boolean; finish: PhotoRelayFinish }) => Promise<PhotoRelayAnswer | undefined>;
  runtimeFor(app: AppId): NetworkRuntime | undefined;
  runtimeOfMember?(app: AppId, memberId: string): Promise<NetworkRuntime | undefined>;
  hookFor: (app: AppId) => RelayClassifierHook;
}

const RELAY_CLEF_LRU_MAX = 512;

class BoundedLru<V> {
  private readonly map = new Map<string, V>();
  constructor(private readonly maxEntries: number) {}
  get(key: string): V | undefined {
    const hit = this.map.get(key);
    if (hit === undefined) return undefined;
    this.map.delete(key);
    this.map.set(key, hit);
    return hit;
  }
  set(key: string, value: V): void {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }
}

function normalizeRoutineRelayText(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  if (/[@$]|https?:\/\/|www\.|\d{4,}/i.test(trimmed)) return undefined;
  const norm = trimmed.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").replace(/[.!?,]+$/g, "").trim();
  return norm || undefined;
}

export function relayClassifierFromEnv(env: Record<string, string | undefined>, log: (s: string) => void, cost?: CostLedger): (app: AppId) => RelayClassifierHook {
  if (!env.CLOUDFLARE_AI_TOKEN || !env.CLOUDFLARE_ACCOUNT_ID) {
    log("relay classifier: Workers AI not configured; every relayed text is blocked");
    const closed: RelayClassifierHook = async () => { throw new Error("relay classifier not configured"); };
    return () => closed;
  }
  const weights = env.RELAY_CLEF_WEIGHTS_PATH ? validateRelayClefWeights(JSON.parse(readFileSync(env.RELAY_CLEF_WEIGHTS_PATH, "utf8")) as RelayClefWeights) : undefined;
  log(`relay classifier: rules + Clef (${env.RELAY_CLEF_MODEL === "clef" ? "clef" : "clef-flash"}, weights ${(weights ?? DEFAULT_RELAY_CLEF_WEIGHTS).version})`);
  const clefCache = new BoundedLru<ClefResult>(RELAY_CLEF_LRU_MAX);
  const routineCache = new BoundedLru<RelayClassifierOutput>(RELAY_CLEF_LRU_MAX);
  const hooks = new Map<AppId, RelayClassifierHook>();
  return app => {
    let h = hooks.get(app);
    if (!h) {
      const meter = cost?.relayClefEvent(app);
      const rawHook = clefRelayClassifierFromEnv(env, {
        ...(weights ? { weights } : {}),
        answers: key => clefCache.get(key),
        record: (key, result) => { clefCache.set(key, result); },
        onEvent: e => {
          meter?.(e);
          if (e.outcome === "error" || e.outcome === "timeout") log(`[relay] clef ${e.outcome}${e.status ? ` ${e.status}` : ""} (${e.ms} ms)`);
        },
      });
      h = async (input: RelayClassifierInput): Promise<RelayClassifierOutput> => {
        const norm = input.kind === "text" ? normalizeRoutineRelayText(input.text) : undefined;
        const routineKey = norm
          ? createHash("sha256").update(JSON.stringify([app, norm, (input.context ?? []).slice(-4), !!input.met])).digest("hex")
          : undefined;
        if (routineKey) {
          const hit = routineCache.get(routineKey);
          if (hit) return hit;
        }
        const out = await rawHook(input);
        if (routineKey && !out.unavailable && out.flags.length === 0 && !(out.block?.length)) {
          routineCache.set(routineKey, out);
        }
        return out;
      };
      hooks.set(app, h);
    }
    return h;
  };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

interface StoredRelay { decision: RelaySendResponse["decision"]; notice: string; outboundId?: string }

function stored(outcome: RelayOutcome): StoredRelay {
  if (outcome.decision === "unnamed") return { decision: "none", notice: outcome.reason };
  if (outcome.decision === "sent") return { decision: "pass", notice: outcome.reason, outboundId: `relay:${outcome.itemId}` };
  return { decision: outcome.decision === "waiting" ? "hold" : "block", notice: outcome.reason };
}

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
  const bytes = await readCapped(req, RELAY_MAX_BODY_BYTES);
  if (bytes === "too_large") return json({ error: "payload_too_large" }, 413);
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return json({ error: "invalid_request" }, 400); }
  const auth = await svcVerify(d.secret, { method: req.method, path: url.pathname, headers: req.headers, body: raw, nowS: Math.floor(d.clock.now() / 1000) });
  if (!auth.ok) return json({ error: auth.reason }, auth.reason === "no_secret" ? 503 : 401);
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return json({ error: "invalid_request" }, 400); }
  if (!routeEnvelopeAllowed(d.routePolicy, b?.networkAuthority, d.clock.now()) || d.routePolicy) return json({ error: "route_authority_invalid" }, 403);
  const id = (v: unknown, max: number) => typeof v === "string" && !!v.trim() && v.length <= max && !/[\r\n\u0000]/.test(v);
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== KEYS.length || Object.keys(b).some(k => !(KEYS as string[]).includes(k))
    || (b.channel !== "blooio" && b.channel !== "twilio") || !id(b.messageId, 512) || !isAppId(b.app) || !id(b.memberId, 256)
    || auth.id !== `${b.messageId}:relay`) return json({ error: "invalid_request" }, 400);
  if ((b.itemId !== null && !id(b.itemId, 200)) || typeof b.text !== "string" || !b.text.trim() || b.text.length > MAX_TEXT) return json({ error: "invalid_relay" }, 400);
  const app = b.app as AppId, memberId = b.memberId as string, text = b.text.trim(), itemId = b.itemId as string | null;

  const turnId = `msg:${b.channel}:${b.messageId}`;
  const [original] = await d.sql`select sender_hash,response from platform.inbound where id=${turnId} and status='done'`;
  if (!original || original.response?.outcome !== "open" || original.response.app !== app || original.response.memberId !== memberId) return json({ error: "turn_scope_invalid", retryable: false }, 403);
  const who = await d.accounts.byPhoneHash(original.sender_hash), rt = d.runtimeOfMember ? await d.runtimeOfMember(app, memberId) : d.runtimeFor(app);
  if (!who || !rt) return json({ error: "membership_unavailable", retryable: false }, 403);
  const authorized = async () => (await d.accounts.activeMembership(rt.app, { e164: who.e164, personId: who.person.id }))?.membership.memberId === memberId;
  if (!await authorized()) return json({ error: "membership_unavailable", retryable: false }, 403);
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
  if (replay) {
    await rt.projectRecordedAges(memberId).catch(() => undefined);
    return json(await answer(d.sql, app, replay, true));
  }

  try {
    const request = parseRelayRequest(text);
    const threadId = itemId ?? await rt.readState(net => net.relayMatch(memberId as MemberId)?.id ?? null);
    const swapWithdrawn = withdrawsSwap(text);
    if (swapWithdrawn && request.kind !== "text") await rt.unitOfWork(net => { net.relayCancelSwap(memberId as MemberId); });
    const photoStored = (photo: PhotoRelayAnswer): StoredRelay => ({ decision: photo.status === "unavailable" || photo.status === "blocked" ? "block" : "none", notice: photo.text });
    const share = request.kind === "contact_share";
    const photo = await d.photoRequest({
      app, personId: who.person.id, memberId, text, threadId, inboundId: `in:${b.channel}:${b.messageId}`, photoAsked: request.kind === "photo",
      finish: async tx => { await lock(tx); return answer => share ? Promise.resolve() : complete(tx, photoStored(answer)); },
    });
    const photoNotice = share && photo && photo.text !== PHOTO_RELAY_TEXT.noneToWithdraw ? photo.text : "";
    let result: StoredRelay;
    if (photo && !share) {
      result = photoStored(photo);
      if (swapWithdrawn && request.kind === "text") await rt.unitOfWork(net => { net.relayCancelSwap(memberId as MemberId); });
    } else if (request.kind === "photo") {
      result = photoStored({ status: "unavailable", text: PHOTO_RELAY_TEXT.unavailable });
      await d.sql.begin(async tx => { await lock(tx); await complete(tx, result); });
    } else if (request.kind === "none" && swapWithdrawn) {
      result = await rt.unitOfWork(async net => {
        net.relayCancelSwap(memberId as MemberId);
        const r: StoredRelay = { decision: "none", notice: NOTICE.withdrawn };
        rt.unit.completeAction = async tx => { await lock(tx); await complete(tx,r); };
        return r;
      });
    } else if (request.kind === "none") {
      result = { decision: "none", notice: "" };
      await d.sql.begin(async tx => { await lock(tx); await complete(tx, result); });
    } else {
      const key = `r_${receipt.slice(0, 32)}`;
      const kind = request.kind;
      const body = request.kind === "text" ? request.body : undefined;
      const targetName = request.targetName;
      type PrecomputedClassifier =
        | { input: RelayClassifierInput; ok: true; output: RelayClassifierOutput }
        | { input: RelayClassifierInput; ok: false; error: unknown };
      let precomputed: PrecomputedClassifier | undefined;
      if (kind === "text" && body !== undefined) {
        const trimmed = body.trim();
        const preInput = trimmed ? await rt.readState(net => {
          const match = net.relayMatch(memberId as MemberId, itemId ?? undefined, targetName);
          if (!match) return undefined;
          const state = net.exportState();
          if (state.relay?.log?.some(r => r.itemId === key)) return undefined;
          if (isPanicHaltedState(state.relay, match.participants, match.id)) return undefined;
          const members = net.memberList();
          const sender = members.find(m => m.id === memberId);
          const otherId = match.participants.find(p => p !== memberId);
          const recipient = otherId ? members.find(m => m.id === otherId) : undefined;
          if (!sender || !recipient || sender.optedOut || recipient.optedOut) return undefined;
          const teenPair = Boolean(sender.minor || recipient.minor);
          const met = !teenPair && match.metAt !== undefined && match.metAt <= d.clock.now();
          if (trimmed.length > RELAY_LIMITS.maxChars) return undefined;
          if (!teenPair) {
            const ruled = classifyRelayText(trimmed);
            const hasRuleBlock = ruled.minorSignal || ruled.codes.some(code => !(code.startsWith("offplatform:") && met));
            if (hasRuleBlock || relayGuard().check(trimmed).length > 0) return undefined;
          }
          const thread = state.relay?.threads?.find(t => t.id === match.id);
          const context = (thread?.messages ?? []).map(x => x.rendered).filter((x): x is string => !!x).slice(-4);
          return { text: trimmed, kind: "text" as const, context, met };
        }) : undefined;
        if (preInput) {
          try {
            precomputed = { input: preInput, ok: true, output: await d.hookFor(app)(preInput) };
          } catch (error) {
            precomputed = { input: preInput, ok: false, error };
          }
        }
      }
      const sameClassifierInput = (a: RelayClassifierInput, b: RelayClassifierInput) =>
        a.kind === b.kind && a.text === b.text && !!a.met === !!b.met
        && (a.context?.length ?? 0) === (b.context?.length ?? 0)
        && (a.context ?? []).every((line, i) => line === b.context?.[i]);
      const hook: RelayClassifierHook = async input => {
        if (precomputed && sameClassifierInput(precomputed.input, input)) {
          if (precomputed.ok) return precomputed.output;
          throw precomputed.error;
        }
        return d.hookFor(app)(input);
      };
      result = await rt.unitOfWork(async net => {
        const match = net.relayMatch(memberId as MemberId, itemId ?? undefined, targetName);
        const canonical = match ? await rt.relayParties([...match.participants]) : undefined;
        const outcome = await net.relayRequest(
          { itemId: key, from: memberId as MemberId, kind, ...(body !== undefined ? { text: body } : {}), ...(targetName !== undefined ? { targetName } : {}), ...(itemId !== null ? { matchId: itemId } : {}) },
          { hook, contactOf: id => rt.addressOf(id), ...(canonical ? { canonical } : {}) },
        );
        const shared = stored(outcome);
        const r = photoNotice ? { ...shared, notice: `${photoNotice} ${shared.notice}`.trim() } : shared;
        rt.unit.completeAction = async tx => { await lock(tx); await complete(tx, r); };
        return r;
      });
    }
    if (request.kind === "text") await rt.projectRecordedAges(memberId).catch(() => undefined);
    return json(await answer(d.sql, app, result, false));
  } catch {
    await d.sql`update platform.inbound set action_receipts=jsonb_set(action_receipts,array[${receipt}],${{ requestHash: digest, state: "unresolved" }}::jsonb)
      where id=${turnId} and status='done' and action_receipts->${receipt}->>'requestHash'=${digest} and action_receipts->${receipt}->>'state'='processing'`;
    return json({ error: "action_unresolved", retryable: false }, 409);
  }
}
