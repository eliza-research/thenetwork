// MCP surface (design §4, §5): five tools rendered per surface profile, two prompts and one MCP Apps
// resource. Built per request from the verified ConnectorPrincipal (stateless, §2.3). Uses the
// SDK's low-level Server so tools/list publishes the design's literal JSON Schemas.
//
// Every tool result passes the output pipeline (§8.2): output-schema check → leak guard (other
// members, contact patterns, internal ids, ISO timestamps, hidden items) → surface-profile
// classifier → length cap. Internal ids and timestamps travel only in `_meta`.
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema, GetPromptRequestSchema, ListPromptsRequestSchema, ListResourcesRequestSchema,
  ListToolsRequestSchema, ReadResourceRequestSchema, McpError, ErrorCode, type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { loadConfig, type NetworkConfig } from "./config.ts";
import { FakeNetwork, NetworkError, type ConnectorPrincipal, type Outcome } from "./fake-network.ts";
import { validate, withDefaults, workerSafeValidator } from "./json-schema.ts";
import { findLeaks } from "./policy.ts";
import { PROFILES, profileViolation } from "./profiles.ts";
import {
  ALL_AS_SCOPES, renderTools, TOOL_NAMES, TOOL_SCOPES, type AskOut, type ItemOut, type PendingConfirmationOut, type RespondOut,
  type ShareOut, type TellOut, type ToolDefinition, type ToolErrorCode, type ToolName, type UpdatesOut,
} from "./schemas.ts";
import { ITEM_CARD_HTML, ITEM_CARD_URI, UI_EXTENSION, WIDGET_MIME } from "./widget.ts";

export const SERVER_VERSION = "0.2.0";
export const MAX_TEXT = 8000; // ~8 KB of model-visible text per result (§2.2)
const PRIVACY_FALLBACK = "I can't share that here; text me and I'll explain.";
const PROFILE_FALLBACK = "That's something I can only help with by text.";

export interface ServerOptions {
  cfg?: NetworkConfig;
  /** Disable the outbound guard (tests only: proves the leak tests would catch a bug). */
  guard?: boolean;
}

/**
 * RFC 6750 §3 Bearer challenge, used both in the HTTP `WWW-Authenticate` header (401/403) and, for
 * ChatGPT, as the single string inside the `_meta["mcp/www_authenticate"]` array [O5].
 */
export function bearerChallenge(cfg: NetworkConfig, p: { scope: string; error?: string; description?: string }): string {
  const parts = [`resource_metadata="${cfg.resourceMetadataUrl}"`, `scope="${p.scope}"`];
  if (p.error) parts.push(`error="${p.error}"`);
  // RFC 6750: error_description is %x20-21 / %x23-5B / %x5D-7E (no quote, no backslash, ASCII only).
  if (p.description) parts.push(`error_description="${p.description.replace(/"/g, "'").replace(/[^\x20-\x7e]|\\/g, "")}"`);
  return `Bearer ${parts.join(", ")}`;
}

/**
 * Scope for an insufficient_scope challenge: the scopes already granted plus the one needed (MCP
 * 2025-11-25 recommended approach, so step-up never loses a granted scope), limited to scopes our AS
 * can issue and listed in a stable order.
 */
export function stepUpScope(granted: readonly string[], need: string): string {
  return ALL_AS_SCOPES.filter((s) => s === need || granted.includes(s)).join(" ");
}

/** Every string value inside `v` (object keys excluded: they are fixed by the schemas). */
export function stringLeaves(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringLeaves(x, out);
  else if (v && typeof v === "object") for (const x of Object.values(v)) stringLeaves(x, out);
  return out;
}

const WORD = /[\p{L}\p{N}_']+/gu;
const foldWord = (w: string) => w.normalize("NFKC").toLowerCase();

/**
 * `text` with every run of two or more words that the caller sent verbatim blanked out. The guard
 * checks the masked text, so echoing the caller's own words back can never fail a call: whether a
 * call fails no longer depends on whether the echoed words match a private fact (audit
 * plugin-prototypes-21, the guard was an oracle). The host still gets the unmasked text, which holds
 * nothing it did not send. A leak the Network adds itself (other words, a reordering) is still caught.
 */
export function maskEchoes(text: string, supplied: string[]): string {
  const hay = ` ${supplied.map((s) => (s.match(WORD) ?? []).map(foldWord).join(" ")).join(" \u0000 ")} `;
  if (!hay.trim()) return text;
  const words = [...text.matchAll(WORD)].map((m) => ({ at: m.index!, end: m.index! + m[0].length, w: foldWord(m[0]) }));
  let out = text;
  for (let i = 0; i < words.length;) {
    let j = i + 1;
    while (j < words.length && hay.includes(` ${words.slice(i, j + 1).map((x) => x.w).join(" ")} `)) j++;
    if (j - i >= 2) {
      out = out.slice(0, words[i]!.at) + " ".repeat(words[j - 1]!.end - words[i]!.at) + out.slice(words[j - 1]!.end);
      i = j;
    } else i++;
  }
  return out;
}

function toolError(code: ToolErrorCode, message: string, extraMeta: Record<string, unknown> = {}, retryable = false): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
    // Not in structuredContent: SDK clients validate structuredContent against outputSchema even on
    // errors, so an {error} object would be rejected as a schema violation.
    _meta: { "network/error": { code, message, retryable }, ...extraMeta },
  };
}

export function createMcpServer(net: FakeNetwork, principal: ConnectorPrincipal, opts: ServerOptions = {}) {
  const cfg = opts.cfg ?? loadConfig();
  const guardOn = opts.guard ?? true;
  const profile = PROFILES[principal.surfaceProfile];
  const tools = renderTools(principal.surfaceProfile);
  const byName = new Map(tools.map((t) => [t.name, t] as const));

  const server = new Server(
    { name: "the-network", title: "The Network", version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false }, prompts: {}, resources: {} }, instructions: profile.instructions, jsonSchemaValidator: workerSafeValidator },
  );

  const clientDeclaresUi = () => {
    const caps = server.getClientCapabilities() as any;
    return Boolean(caps?.extensions?.[UI_EXTENSION] ?? caps?.experimental?.[UI_EXTENSION]);
  };

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => {
      if (t.name !== TOOL_NAMES.updates || !clientDeclaresUi()) return t;
      // MCP Apps card only for clients that declare the UI extension (§9.2).
      return { ...t, _meta: { ...t._meta, ui: { resourceUri: ITEM_CARD_URI }, "openai/outputTemplate": ITEM_CARD_URI } };
    }),
  }));

  const audit = (tool: string, summary: string) =>
    net.audit.push({ memberId: principal.memberId, grantId: principal.grantId, hostKey: principal.hostKey, tool, summary, at: net.clock.now() });

  /**
   * Strings that must not reach this host: everything in forbiddenFor(), except that the member's
   * OWN agent-private facets may be echoed when the member's own message supplied them (§8.2 step 3).
   * Verbatim echoes of any caller input are masked before the check (maskEchoes), so the guard's
   * verdict never depends on whether the caller guessed someone's private fact.
   */
  const forbiddenStrings = (args: Record<string, unknown>) => {
    const supplied = stringLeaves(args).join("\n");
    const own = new Set(net.ownPrivateFacets(principal));
    return net.forbiddenFor(principal).filter((f) => !(own.has(f) && findLeaks(supplied, [f], { facts: [f] }).length > 0));
  };
  /** The subset of forbidden strings that are private facts: these also match on fragments/leetspeak/reordering. */
  const factsIn = (forbidden: string[]) => {
    const facts = new Set(net.privateFactsFor(principal));
    return forbidden.filter((f) => facts.has(f));
  };

  /** Output pipeline for any model-visible text: leak guard, then the surface-profile classifier. */
  const check = (visibleText: string, forbidden: string[], args: Record<string, unknown> = {}): { kind: "leak" | "profile"; detail: string } | null => {
    if (!guardOn) return null;
    const leaks = findLeaks(maskEchoes(visibleText, stringLeaves(args)), forbidden, { facts: factsIn(forbidden) });
    if (leaks.length) return { kind: "leak", detail: leaks.join(",") };
    const off = profileViolation(visibleText, profile, net.members.get(principal.memberId)?.age);
    return off ? { kind: "profile", detail: principal.surfaceProfile } : null;
  };

  /** Tool errors are model-visible too, so their text passes the same checks (it can echo input). */
  const guardedError = (tool: ToolName, code: ToolErrorCode, message: string, extraMeta: Record<string, unknown> = {}, retryable = false, args: Record<string, unknown> = {}) => {
    const hit = check(message, forbiddenStrings(args), args);
    if (!hit) return toolError(code, message, extraMeta, retryable);
    audit(tool, `${hit.kind}_block_error:${hit.detail}`);
    return toolError(code, code === "invalid_input" ? `Invalid input for ${tool}.` : PRIVACY_FALLBACK, extraMeta, retryable);
  };

  const scopeChallenge = (scope: string, description: string) =>
    toolError("needs_scope", description, {
      // ChatGPT shows its account-linking UI from this on a tool error [O5]. OpenAI specifies an ARRAY
      // of WWW-Authenticate challenge strings, each with error and error_description
      // (https://developers.openai.com/apps-sdk/build/auth, "Triggering authentication UI").
      // Claude needs HTTP 401/403 instead (http.ts).
      "mcp/www_authenticate": [bearerChallenge(cfg, { scope: stepUpScope(principal.scopes, scope), error: "insufficient_scope", description })],
    });

  async function call(name: ToolName, args: Record<string, unknown>): Promise<CallToolResult> {
    const def = byName.get(name)!;
    const v = validate(def.inputSchema, args);
    if (!v.valid) return guardedError(name, "invalid_input", `Invalid input for ${name}: ${v.errors.slice(0, 3).join("; ")}`, {}, false, args);
    const scope = TOOL_SCOPES[name];
    if (!principal.scopes.includes(scope))
      return scopeChallenge(scope, `Connect The Network again to allow this (${scope}).`);

    let outcome: Outcome<unknown>;
    try {
      const a = withDefaults(def.inputSchema, args) as any;
      outcome =
        name === TOOL_NAMES.ask ? net.ask(principal, a)
        : name === TOOL_NAMES.tell ? net.tell(principal, a)
        : name === TOOL_NAMES.share ? net.shareProfile(principal, a)
        : name === TOOL_NAMES.updates ? net.getUpdates(principal, a)
        : net.respond(principal, a);
    } catch (err) {
      if (err instanceof NetworkError) {
        if (err.code === "needs_scope") return scopeChallenge(scope, err.message);
        return guardedError(name, err.code, err.message, err.retryAfterSeconds ? { "network/retry_after_seconds": err.retryAfterSeconds } : {}, err.retryable, args);
      }
      return toolError("temporarily_unavailable", "Something went wrong in The Network. Nothing new was saved.", {}, true);
    }
    return pipeline(def, args, outcome);
  }

  function pipeline(def: ToolDefinition, args: Record<string, unknown>, outcome: Outcome<unknown>): CallToolResult {
    const structured = outcome.result as Record<string, unknown>;
    const out = validate(def.outputSchema, structured);
    if (!out.valid) {
      audit(def.name, `output_schema_violation:${out.errors[0]}`);
      return toolError("temporarily_unavailable", "The Network couldn't answer that right now. Nothing new was saved.", {}, true);
    }
    let text = renderText(def.name, structured);
    const meta: Record<string, unknown> = outcome.receipt ? { "network/receipt": outcome.receipt } : {};

    if (guardOn) {
      // Raw string leaves, not JSON: JSON escapes newlines and quotes, which hid "the\nbar" from a
      // word-boundary check and kept forbidden strings containing quotes from matching.
      const forbidden = forbiddenStrings(args);
      const hit = check([text, ...stringLeaves(structured)].join("\n"), forbidden, args);
      // _meta is hidden from the model on ChatGPT but not on every host: no forbidden strings there either.
      const metaLeak = findLeaks(maskEchoes(stringLeaves(meta).join("\n"), stringLeaves(args)), forbidden, { facts: factsIn(forbidden) }).filter((l) => l.startsWith("forbidden:"));
      if (hit?.kind === "leak" || metaLeak.length) {
        audit(def.name, `leak_block:${[hit?.detail, ...metaLeak].filter(Boolean).join(",")}`);
        return toolError("temporarily_unavailable", PRIVACY_FALLBACK);
      }
      if (hit?.kind === "profile") {
        audit(def.name, `profile_block:${hit.detail}`);
        return toolError("not_available_on_this_assistant", PROFILE_FALLBACK);
      }
    }
    if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 1)}…`;
    return { content: [{ type: "text", text }], structuredContent: structured, ...(Object.keys(meta).length ? { _meta: meta } : {}) };
  }

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name as ToolName;
    if (!byName.has(name)) throw new McpError(ErrorCode.InvalidParams, `Unknown tool: ${req.params.name}`);
    return call(name, (req.params.arguments ?? {}) as Record<string, unknown>);
  });

  // ---- prompts (user-invoked; §4)
  const PROMPTS = [
    { name: "network_checkin", title: "Check in with my Network", description: "What's new from my Network?" },
    {
      name: "network_help_request", title: "Ask my Network for help",
      description: "Search first, then ask The Network if people would help more.",
      arguments: [{ name: "need", description: "What you need help with", required: true }],
    },
  ];
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPTS }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    if (req.params.name === "network_checkin")
      return { messages: [{ role: "user", content: { type: "text", text: "What's new from my Network?" } }] };
    if (req.params.name === "network_help_request") {
      const need = String(req.params.arguments?.need ?? "").slice(0, 500);
      return {
        messages: [{
          role: "user",
          content: { type: "text", text: `I need help with: ${need}. Look for a service, place or answer yourself first. If other people would help more, ask my Network with tell_network_agent.` },
        }],
      };
    }
    throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${req.params.name}`);
  });

  // ---- resources: only the MCP Apps item card; never a graph or member directory (GW-001)
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [{ uri: ITEM_CARD_URI, name: "item-card", title: "Network item card", description: "Cards for items from get_network_updates.", mimeType: WIDGET_MIME }],
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    if (req.params.uri !== ITEM_CARD_URI) throw new McpError(ErrorCode.InvalidParams, "Unknown resource");
    return {
      contents: [{
        uri: ITEM_CARD_URI, mimeType: WIDGET_MIME, text: ITEM_CARD_HTML,
        _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
      }],
    };
  });

  return server;
}

// --------------------------------------------------------------------------------- text renderings
// Complete human-readable text for hosts that ignore structuredContent (Grok, Muse; §9.2).
// Only opaque handles (itm_/cnf_) appear; no internal ids, no timestamps.

function pendingText(p: PendingConfirmationOut | null | undefined): string {
  if (!p) return "";
  return p.how_to_confirm === "ask_member_then_respond"
    ? `\nNeeds the member's OK: ${p.summary} (confirmation ${p.confirmation_id}, ${p.expires_in ?? "expires soon"}).`
    : `\nThe member confirms this in The Network's own messages; the assistant can't confirm it: ${p.summary}`;
}

function itemText(i: ItemOut, n: number): string {
  const extra = [i.when && `When: ${i.when}`, i.where && `Where: ${i.where}`, i.expires && i.expires[0]!.toUpperCase() + i.expires.slice(1)].filter(Boolean).join(". ");
  return `${n}. ${i.title} (${i.kind}, ${i.item_id}): ${i.summary}${extra ? ` ${extra}.` : ""} Answers: ${i.allowed_responses.join(", ")}.`;
}

export function renderText(name: ToolName, s: Record<string, unknown>): string {
  switch (name) {
    case TOOL_NAMES.ask: {
      const o = s as unknown as AskOut;
      const rel = o.related_items.length ? `\nRelated: ${o.related_items.map((r) => `${r.title} (${r.item_id})`).join("; ")}` : "";
      return `${o.answer}${rel}`;
    }
    case TOOL_NAMES.tell: {
      const o = s as unknown as TellOut;
      const ch = o.changes.length ? `\nChanges: ${o.changes.map((c) => c.summary).join("; ")}` : "";
      return `${o.reply}${ch}${pendingText(o.pending_confirmation)}`;
    }
    case TOOL_NAMES.share: {
      const o = s as unknown as ShareOut;
      const rej = o.rejected.length ? `\nNot accepted: ${o.rejected.map((r) => `${r.field}${r.index !== undefined ? `[${r.index}]` : ""} (${r.reason.replace(/_/g, " ")})`).join("; ")}` : "";
      return `Sent ${o.accepted_count} detail${o.accepted_count === 1 ? "" : "s"} for the member to review.${rej}\n${o.next_step}`;
    }
    case TOOL_NAMES.updates: {
      const o = s as unknown as UpdatesOut;
      if (!o.items.length) return "Nothing new from The Network right now.";
      return [`${o.items.length} item${o.items.length === 1 ? "" : "s"} from The Network:`, ...o.items.map((i, n) => itemText(i, n + 1)), o.next_cursor ? "More items are available." : ""].filter(Boolean).join("\n");
    }
    case TOOL_NAMES.respond: {
      const o = s as unknown as RespondOut;
      return `${o.message}${o.details ? `\n${o.details}` : ""}${pendingText(o.pending_confirmation)}`;
    }
  }
}
