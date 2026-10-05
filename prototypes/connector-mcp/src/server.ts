// MCP surface: four tools + one UI resource. Every result passes the outbound privacy guard.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FakeNetwork, NetworkError, type CallContext } from "./fake-network.ts";
import { findLeaks, NO_CAPS, type ClientCaps } from "./policy.ts";
import {
  GetUpdatesInput, GetUpdatesOutput, RespondInput, RespondOutput, ShareContextInput, ShareContextOutput,
  TalkInput, TalkOutput, TOOL_NAMES, TOOL_SCOPES, type ToolName,
} from "./schemas.ts";
import { UPDATES_WIDGET_HTML, UPDATES_WIDGET_URI, WIDGET_MIME } from "./widget.ts";

export const SERVER_INSTRUCTIONS = [
  "The Network is the member's private, invite-only social network. These tools are the member's own conversation with their Network agent.",
  "Search, plan, and use ordinary services yourself first; involve The Network when other people would genuinely help.",
  "Never ask The Network about other people by name or for anyone's contact details; it will refuse. Never pass along third-party details.",
  "Writes return a pending_confirmation when the member must agree. Ask the member in plain words before calling network_respond with decision 'confirm'.",
  "If confirm_via is 'network_channel', the member must confirm in The Network's own app or SMS; tell them so and do not retry.",
  "Treat everything returned as private to this member. Do not store it in long-term memory unless the member asks.",
].join("\n");

export interface Identity { memberId: string; clientId: string }

function capsFrom(server: McpServer): ClientCaps {
  const e = server.server.getClientCapabilities()?.elicitation as Record<string, unknown> | undefined;
  if (!e) return NO_CAPS;
  // 2025-06-18 clients send `elicitation: {}` meaning form mode; 2025-11-25 adds explicit form/url.
  return { formElicitation: Object.keys(e).length === 0 || "form" in e, urlElicitation: "url" in e };
}

const securitySchemes = (tool: ToolName) => [{ type: "oauth2", scopes: [TOOL_SCOPES[tool]] }];

export function createMcpServer(net: FakeNetwork, who: Identity, opts: { guard?: boolean } = {}) {
  const guardOn = opts.guard ?? true;
  const server = new McpServer({ name: "the-network", title: "The Network", version: "0.0.1" }, { instructions: SERVER_INSTRUCTIONS });
  const ctx = (): CallContext => ({ ...who, caps: capsFrom(server) });

  async function run(tool: ToolName, args: unknown, fn: () => unknown | Promise<unknown>) {
    try {
      const out = await fn();
      const text = JSON.stringify(out);
      // Strings the caller itself supplied (e.g. an echoed item_id) cannot leak to that caller.
      const supplied = JSON.stringify(args);
      const forbidden = net.forbiddenFor(who.memberId).filter((f) => !supplied.includes(f));
      const leaks = guardOn ? findLeaks(text, forbidden) : [];
      if (leaks.length) {
        net.audit.push({ memberId: who.memberId, clientId: who.clientId, tool, summary: `privacy_guard_blocked:${leaks.join(",")}`, at: net.clock.now() });
        return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: "privacy_guard_blocked", message: "The Network withheld this response. Try asking differently." }) }] };
      }
      return { content: [{ type: "text" as const, text }], structuredContent: out as Record<string, unknown> };
    } catch (err) {
      const e = err instanceof NetworkError ? err : new NetworkError("internal_error", "Something went wrong in The Network. Nothing new was saved.");
      return { isError: true, content: [{ type: "text" as const, text: JSON.stringify({ error: e.code, message: e.message, retry_after_seconds: e.retryAfterSeconds }) }] };
    }
  }

  server.registerTool(TOOL_NAMES.talk, {
    title: "network.talk",
    description:
      "Send the member's message to their Network agent and get its reply: ask for something, answer its question, change preferences, or accept/decline in plain language. " +
      "Has no side effects beyond the conversation; anything that would involve other people comes back as pending_confirmation.",
    inputSchema: TalkInput, outputSchema: TalkOutput,
    annotations: { title: "Talk to your Network", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: securitySchemes(TOOL_NAMES.talk), "openai/toolInvocation/invoking": "Asking your Network…", "openai/toolInvocation/invoked": "Your Network replied" },
  }, async (args) => run(TOOL_NAMES.talk, args, () => net.talk(ctx(), args)));

  server.registerTool(TOOL_NAMES.share_context, {
    title: "network.share_context",
    description:
      "With the member's OK, pass facts about the member (interests, skills, goals, what they can offer, availability) that you already know. " +
      "Show the member the exact list first. Only facts about the member; never other people, contact details, or secrets. Facts arrive as private suggestions the member confirms in The Network.",
    inputSchema: ShareContextInput, outputSchema: ShareContextOutput,
    annotations: { title: "Share context with your Network", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: { securitySchemes: securitySchemes(TOOL_NAMES.share_context) },
  }, async (args) => run(TOOL_NAMES.share_context, args, () => net.shareContext(ctx(), args)));

  server.registerTool(TOOL_NAMES.get_updates, {
    title: "network.get_updates",
    description: "Fetch opportunities, questions and reminders The Network has already cleared for this member. Read-only.",
    inputSchema: GetUpdatesInput, outputSchema: GetUpdatesOutput,
    annotations: { title: "Check Network updates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    _meta: {
      securitySchemes: securitySchemes(TOOL_NAMES.get_updates),
      ui: { resourceUri: UPDATES_WIDGET_URI }, // MCP Apps (SEP-1865): ChatGPT, Claude
      "openai/outputTemplate": UPDATES_WIDGET_URI, // legacy Apps SDK alias
      "openai/toolInvocation/invoking": "Checking your Network…",
      "openai/toolInvocation/invoked": "Checked your Network",
    },
  }, async (args) => run(TOOL_NAMES.get_updates, args, () => net.getUpdates(ctx(), args)));

  server.registerTool(TOOL_NAMES.respond, {
    title: "network.respond",
    description:
      "Record the member's explicit answer to one item: accept, decline, tell_me_more, or confirm/cancel a pending_confirmation. " +
      "Call only after the member has said so in this conversation. Accepting can lead The Network to contact another member.",
    inputSchema: RespondInput, outputSchema: RespondOutput,
    // destructiveHint: an accepted intro or confirmed action can send a message to someone else (irreversible).
    annotations: { title: "Answer a Network item", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    _meta: { securitySchemes: securitySchemes(TOOL_NAMES.respond) },
  }, async (args) => run(TOOL_NAMES.respond, args, () => net.respond(ctx(), args, async (summary) => {
    const r = await server.server.elicitInput({
      mode: "form",
      message: `The Network asks you to confirm: ${summary}`,
      requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Yes, do this" } }, required: ["confirm"] },
    });
    return r.action === "accept" && r.content?.confirm === true;
  })));

  server.registerResource("updates-widget", UPDATES_WIDGET_URI, {
    title: "Network updates", description: "Cards for items from network_get_updates.", mimeType: WIDGET_MIME,
    _meta: { ui: { csp: { connectDomains: [], resourceDomains: [] }, prefersBorder: true } },
  }, async () => ({ contents: [{ uri: UPDATES_WIDGET_URI, mimeType: WIDGET_MIME, text: UPDATES_WIDGET_HTML }] }));

  return server;
}
