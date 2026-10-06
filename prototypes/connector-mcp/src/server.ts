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
import { findLeaks, INTERNAL_ID, ISO_TIMESTAMP } from "./policy.ts";
import { PROFILES, profileViolation } from "./profiles.ts";
import {
  renderTools, TOOL_NAMES, TOOL_SCOPES, type AskOut, type ItemOut, type PendingConfirmationOut, type RespondOut,
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

/** Bearer challenge used both in HTTP WWW-Authenticate and in ChatGPT's `_meta["mcp/www_authenticate"]`. */
export function bearerChallenge(cfg: NetworkConfig, p: { scope: string; error?: string; description?: string }): string {
  const parts = [`resource_metadata="${cfg.resourceMetadataUrl}"`, `scope="${p.scope}"`];
  if (p.error) parts.push(`error="${p.error}"`);
  if (p.description) parts.push(`error_description="${p.description.replace(/"/g, "'")}"`);
  return `Bearer ${parts.join(", ")}`;
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

  const scopeChallenge = (scope: string, description: string) =>
    toolError("needs_scope", description, {
      // ChatGPT shows its account-linking UI from this on a tool error [O5]; Claude needs HTTP 401/403 (http.ts).
      "mcp/www_authenticate": [bearerChallenge(cfg, { scope, error: "insufficient_scope", description })],
    });

  async function call(name: ToolName, args: Record<string, unknown>): Promise<CallToolResult> {
    const def = byName.get(name)!;
    const v = validate(def.inputSchema, args);
    if (!v.valid) return toolError("invalid_input", `Invalid input for ${name}: ${v.errors.slice(0, 3).join("; ")}`);
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
        return toolError(err.code, err.message, err.retryAfterSeconds ? { "network/retry_after_seconds": err.retryAfterSeconds } : {}, err.retryable);
      }
      return toolError("temporarily_unavailable", "Something went wrong in The Network. Nothing new was saved.", {}, true);
    }
    return pipeline(def, args, outcome);
  }

  function pipeline(def: ToolDefinition, args: Record<string, unknown>, outcome: Outcome<unknown>): CallToolResult {
    const structured = outcome.result as Record<string, unknown>;
    const out = validate(def.outputSchema, structured);
    if (!out.valid) {
      net.audit.push({ memberId: principal.memberId, grantId: principal.grantId, hostKey: principal.hostKey, tool: def.name, summary: `output_schema_violation:${out.errors[0]}`, at: net.clock.now() });
      return toolError("temporarily_unavailable", "The Network couldn't answer that right now. Nothing new was saved.", {}, true);
    }
    let text = renderText(def.name, structured);
    if (text.length > MAX_TEXT) text = `${text.slice(0, MAX_TEXT - 1)}…`;
    const meta: Record<string, unknown> = outcome.receipt ? { "network/receipt": outcome.receipt } : {};

    if (guardOn) {
      const visible = JSON.stringify({ structured, text });
      const supplied = JSON.stringify(args);
      const member = net.members.get(principal.memberId);
      const forbidden = net.forbiddenFor(principal).filter((f) => !supplied.includes(f));
      const leaks = findLeaks(visible, forbidden);
      if (INTERNAL_ID.test(visible)) leaks.push("internal_id");
      if (ISO_TIMESTAMP.test(visible)) leaks.push("iso_timestamp");
      leaks.push(...findLeaks(JSON.stringify(meta), forbidden).filter((l) => l.startsWith("forbidden:")));
      if (leaks.length) {
        net.audit.push({ memberId: principal.memberId, grantId: principal.grantId, hostKey: principal.hostKey, tool: def.name, summary: `leak_block:${leaks.join(",")}`, at: net.clock.now() });
        return toolError("temporarily_unavailable", PRIVACY_FALLBACK);
      }
      const off = profileViolation(visible, profile, member?.age);
      if (off) {
        net.audit.push({ memberId: principal.memberId, grantId: principal.grantId, hostKey: principal.hostKey, tool: def.name, summary: `profile_block:${principal.surfaceProfile}`, at: net.clock.now() });
        return toolError("not_available_on_this_assistant", PROFILE_FALLBACK);
      }
    }
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
