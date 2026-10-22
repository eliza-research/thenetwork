import { parseNetworkCollectionCommand } from "../../core/src/svc/learning-collection-command.ts";
import type { SQL } from "bun";
import { createHash } from "node:crypto";
import { parseNetworkRouteAuthorityV1, type NetworkRouteAuthorityV1 } from "../../core/src/svc/contract.ts";
import type { AppId } from "../../platform/src/apps.ts";
import { isAppId } from "../../platform/src/apps.ts";
import { readCapped } from "../../platform/src/body.ts";
import { svcVerify } from "../../core/src/svc/svc-auth.ts";
import { ProfileSuggestions, collectionProposalMatchesStoredCommand, type SuggestionAuthorization, type SuggestionOwner, type SuggestionProposal } from "./profile-suggestions.ts";
import { renderSuggestionReview, reviewSuggestionMessage } from "./profile-suggestion-review.ts";
import { routeEnvelopeAllowed, type NetworkRoutePolicy } from "./route-authority.ts";

export const SUGGESTION_PATH = "/internal/profile-suggestions/";
export interface SuggestionTurnIdentity {
  personId: string; memberId: string; app: AppId; channel: "blooio" | "twilio"; messageId: string;
  action: "preview" | "decide" | "delete" | "collect"; batchId: string; commandSha256: string;
  networkAuthority?: NetworkRouteAuthorityV1;
  /** Requested retention deadline derived from the validated collection proposal. */
  pendingExpiresAt?: number;
  /** Validated collection proposal; canonical stored turn remains the authority. */
  collectionProposal?: SuggestionProposal;
}
/** Cloud supplies its existing trusted binding lookup, never model-provided identity fields.
 * It must recheck the current user/org/chat binding and revocation using this transaction.
 */
export type SuggestionIdentityResolver = (turn: SuggestionTurnIdentity, tx: SQL) => Promise<(Pick<SuggestionOwner, "userId" | "organizationId" | "chatId"> & {
  validUntil?: number;
  /** Server-local transaction fence; never serialized or supplied in the request body. */
  valid?: () => boolean;
}) | null>;

export interface SuggestionEndpointDeps {
  sql: SQL; now: () => number; secret?: string; routePolicy?: NetworkRoutePolicy;
  resolveIdentity?: SuggestionIdentityResolver;
  authorizeSource?: SuggestionAuthorization;
}
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
const validId = (v: unknown, max: number): v is string => typeof v === "string" && !!v.trim() && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(v);

/** Internal-only review wire. Every store transaction rechecks the canonical turn and Cloud binding. */
export async function profileSuggestionEndpoint(d: SuggestionEndpointDeps, req: Request): Promise<Response> {
  const url = new URL(req.url), action = url.pathname.slice(SUGGESTION_PATH.length);
  if (!["preview", "decide", "delete", "collect"].includes(action)) return json({ error: "not_found" }, 404);
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  if (url.search) return json({ error: "invalid_request" }, 400);
  const bytes = await readCapped(req, 16 * 1024);
  if (bytes === "too_large") return json({ error: "payload_too_large" }, 413);
  let raw: string;
  try { raw = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { return json({ error: "invalid_request" }, 400); }
  const auth = await svcVerify(d.secret, { method: req.method, path: url.pathname, headers: req.headers, body: raw, nowS: Math.floor(d.now() / 1000) });
  if (!auth.ok) return json({ error: auth.reason }, auth.reason === "no_secret" ? 503 : 401);
  if (!d.resolveIdentity) return json({ error: "identity_unavailable" }, 503);
  let b: Record<string, unknown>;
  try { b = JSON.parse(raw); } catch { return json({ error: "invalid_request" }, 400); }
  const keys = ["channel", "messageId", "batchId", ...(action === "preview" ? [] : ["text"]), ...(action === "collect" ? ["proposal"] : []), ...(b?.networkAuthority === undefined ? [] : ["networkAuthority"])];
  if (!b || typeof b !== "object" || Array.isArray(b) || Object.keys(b).length !== keys.length || Object.keys(b).some(k => !keys.includes(k))
    || (b.channel !== "blooio" && b.channel !== "twilio") || !validId(b.messageId, 512) || !uuid(b.batchId)
    || auth.id !== `${b.messageId}:suggestions:${action}` || (action !== "preview" && !validId(b.text, 2000))) return json({ error: "invalid_request" }, 400);
  const proposal = action === "collect" ? parseCollectionProposal(b.proposal) : undefined;
  const collection = action === "collect" && typeof b.text === "string" ? parseNetworkCollectionCommand(b.text) : undefined;
  if (action === "collect" && (!proposal || collection?.kind !== "collect" || collection.batchId !== b.batchId)) return json({ error: "invalid_collection" }, 400);
  const channel = b.channel, messageId = b.messageId, batchId = b.batchId;
  let proofValidUntil: number | undefined;
  let proofValid: (() => boolean) | undefined;
  // Resolve the person from the signed, completed open turn. Model identity fields are not accepted.
  const resolve = async (tx: SQL): Promise<SuggestionOwner | null> => {
    if (!routeEnvelopeAllowed(d.routePolicy, b.networkAuthority, d.now())) return null;
    const [turn] = await tx`select sender_hash,response,network_authority,arrived_at from platform.inbound where id=${`msg:${channel}:${messageId}`} and status='done'`;
    if (!turn || turn.response?.outcome !== "open" || !isAppId(turn.response.app) || !validId(turn.response.memberId, 256)
      || !routeEnvelopeAllowed(d.routePolicy, turn.network_authority ?? undefined, d.now())) return null;
    const app = turn.response.app, memberId = turn.response.memberId;
    await tx`select set_config('app.app_id',${app},true)`;
    const [person] = await tx`select p.id from platform.people p join network.members n on n.person_id=p.id
      where p.phone_hash=${turn.sender_hash} and p.deleted_at is null and n.app_id=${app} and n.id=${memberId}`;
    if (!person) return null;
    const [message] = await tx`select body from network.messages where app_id=${app} and member_id=${memberId}
      and id=${`in:${channel}:${messageId}`} and direction='inbound'`;
    if (!message || typeof message.body !== "string" || (action !== "preview" && message.body !== b.text)) return null;
    if (proposal && !collectionProposalMatchesStoredCommand(proposal, message.body, batchId, new Date(turn.arrived_at).getTime(), d.now())) return null;
    const networkAuthority = parseNetworkRouteAuthorityV1(turn.network_authority);
    const binding = await d.resolveIdentity!({ personId: person.id, memberId, app, channel, messageId,
      action: action as SuggestionTurnIdentity["action"], batchId,
      commandSha256: createHash("sha256").update(message.body).digest("hex"),
      ...(proposal ? { pendingExpiresAt: proposal.expiresAt, collectionProposal: proposal } : {}),
      ...(networkAuthority ? { networkAuthority } : {}) }, tx);
    if (!binding || !validId(binding.userId, 256) || !validId(binding.organizationId, 256) || !validId(binding.chatId, 256)) return null;
    if (binding.validUntil !== undefined && (!Number.isSafeInteger(binding.validUntil) || binding.validUntil <= d.now())) return null;
    proofValidUntil = binding.validUntil;
    proofValid = binding.valid;
    return { personId: person.id, app, userId: binding.userId, organizationId: binding.organizationId, chatId: binding.chatId };
  };
  try {
    const owner = await d.sql.begin(resolve);
    if (!owner) return json({ error: "turn_scope_invalid" }, 403);
    const store = new ProfileSuggestions(d.sql, d.authorizeSource ?? (async () => false), async (who, tx) => {
      const current = await resolve(tx);
      return !!current && Object.keys(who).every(k => who[k as keyof SuggestionOwner] === current[k as keyof SuggestionOwner]);
    }, { now: d.now, valid: () => (proofValidUntil === undefined || d.now() < proofValidUntil)
      && (!proofValid || proofValid())
      && routeEnvelopeAllowed(d.routePolicy, b.networkAuthority, d.now())
      && (!d.routePolicy || d.now() < d.routePolicy.admitUntil) });
    if (action === "collect") {
      const batch = await store.propose(owner, proposal!, d.now(), { batchId, turnId: `msg:${channel}:${messageId}`,
        requestSha256: createHash("sha256").update(raw).digest("hex"), commandSha256: createHash("sha256").update(b.text as string).digest("hex") });
      const reviewText = batch && renderSuggestionReview(batch, owner, d.now());
      return batch && reviewText ? json({ kind: "preview", batch, reviewText })
        : json({ kind: "denied", reviewText: "I couldn’t collect those suggestions. Nothing new was saved." }, 403);
    }
    if (action === "delete") {
      if (b.text !== `delete ${batchId}`) return json({ error: "invalid_command" }, 400);
      return await store.deleteBatch(owner, batchId) ? json({ kind: "deleted", reviewText: "Deleted these suggestions and their linked saved facts." }) : json({ kind: "denied", reviewText: "I couldn’t apply that review. Ask to see your current suggestions." }, 403);
    }
    if (action === "decide") {
      const result = await reviewSuggestionMessage(store, owner, batchId, b.text as string, d.now());
      if (!result || result.kind === "denied") return json({ kind: "denied", reviewText: "I couldn’t apply that review. Ask to see your current suggestions." }, 403);
      if (result.kind === "saved") return json({ ...result, reviewText: `${result.accepted.length} saved; ${result.rejected.length} rejected.` });
      return json({ ...result, reviewText: renderSuggestionReview(result.batch, owner, d.now()) });
    }
    const batch = await store.getPendingBatch(owner, batchId, d.now());
    const reviewText = batch && renderSuggestionReview(batch, owner, d.now());
    if (!batch || !reviewText) return json({ kind: "denied", reviewText: "I couldn’t apply that review. Ask to see your current suggestions." }, 403);
    return json({ kind: "preview", batch, reviewText });
  } catch {
    // No source text, connection details, or database error crosses the internal wire.
    return json({ error: "review_unavailable" }, 503);
  }
}

/** The internal collection wire accepts only bounded minimal suggestions, never raw source objects. */
function parseCollectionProposal(value: unknown): SuggestionProposal | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const p = value as Record<string, unknown>;
  const keys = ["windowStart", "windowEnd", "timezone", "expiresAt", "retainOnDisconnect", "allowedKinds", "suggestions"];
  if (Object.keys(p).length !== keys.length || Object.keys(p).some(k => !keys.includes(k))
    || ![p.windowStart, p.windowEnd, p.expiresAt].every(Number.isSafeInteger) || typeof p.timezone !== "string"
    || p.timezone.length > 100 || typeof p.retainOnDisconnect !== "boolean" || !Array.isArray(p.allowedKinds)
    || !p.allowedKinds.length || p.allowedKinds.length > 3 || new Set(p.allowedKinds).size !== p.allowedKinds.length
    || p.allowedKinds.some(k => !["interest", "goal", "availability_pattern"].includes(k))
    || !Array.isArray(p.suggestions) || !p.suggestions.length || p.suggestions.length > 10) return undefined;
  const suggestionKeys = ["connectionId", "source", "observedAt", "kind", "value", "tags", "confidence", "scope"];
  for (const v of p.suggestions) {
    if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).length !== suggestionKeys.length
      || Object.keys(v).some(k => !suggestionKeys.includes(k)) || !uuid(v.connectionId)
      || !["gmail", "google_calendar"].includes(v.source) || !Number.isSafeInteger(v.observedAt)
      || !p.allowedKinds.includes(v.kind) || typeof v.value !== "string" || v.value.length > 400 || /[\u0000-\u001f\u007f]/u.test(v.value)
      || !Array.isArray(v.tags) || v.tags.some((t: unknown) => typeof t !== "string") || v.tags.length > 12
      || typeof v.confidence !== "number" || !Number.isFinite(v.confidence) || !["agent_private", "matchable"].includes(v.scope)) return undefined;
  }
  return value as SuggestionProposal;
}
