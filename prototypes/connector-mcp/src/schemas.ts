// Exact tool contracts for The Network connector (PRD 11.2). Four tools, opaque surface.
// Tool names use underscores: MCP allows dots, but OpenAI and Anthropic function-name rules
// (^[a-zA-Z0-9_-]{1,64}$) do not, and hosts prefix names with the server label. The PRD names
// (network.talk, ...) are kept as tool titles.
import { z } from "zod";

export const TOOL_NAMES = {
  talk: "network_talk",
  share_context: "network_share_context",
  get_updates: "network_get_updates",
  respond: "network_respond",
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

// OAuth scopes (one per capability; members can grant a subset and revoke any time, GW-005).
export const SCOPES = {
  read: "network:updates.read",
  talk: "network:talk",
  context: "network:context.write",
  respond: "network:respond",
} as const;
export const TOOL_SCOPES: Record<ToolName, string> = {
  network_talk: SCOPES.talk,
  network_share_context: SCOPES.context,
  network_get_updates: SCOPES.read,
  network_respond: SCOPES.respond,
};

/** Idempotency key chosen by the host per logical action (GW-003). Same key + same args = same result. */
export const ClientRequestId = z
  .string()
  .regex(/^[A-Za-z0-9_-]{8,64}$/)
  .describe("Unique id for this logical action (e.g. a UUID). Reuse it only when retrying the same call.");

const Iso = z.string().describe("ISO-8601 UTC timestamp");

export const Risk = z.enum(["low", "medium", "high"]);
export const ConfirmVia = z.enum(["host_respond", "host_elicitation", "network_channel"]);

export const PendingConfirmation = z
  .object({
    confirmation_id: z.string(),
    summary: z.string().describe("Plain-language description of exactly what will happen if confirmed."),
    risk: z.enum(["medium", "high"]),
    confirm_via: ConfirmVia.describe(
      "host_respond: ask the member, then call network_respond with decision 'confirm'. " +
        "host_elicitation: the Network asks the member directly through the host's confirmation UI. " +
        "network_channel: the member must confirm in The Network's own app/SMS; the host cannot confirm it.",
    ),
    expires_at: Iso,
  })
  .strict();

export const Receipt = z
  .object({
    receipt_id: z.string(),
    action_id: z.string().describe("Durable server-side action id (GW-003)."),
    tool: z.string(),
    client_id: z.string(),
    at: Iso,
    summary: z.string(),
    replayed: z.boolean().describe("True when this is the stored result of an earlier call with the same client_request_id."),
  })
  .strict();

// ---------- network_talk ----------
export const TalkInput = z
  .object({
    message: z
      .string()
      .trim()
      .min(1)
      .max(4000)
      .describe("The member's request, in their words or a faithful paraphrase. Do not include other people's contact details."),
    conversation_id: z.string().max(64).optional().describe("Return value from a previous network_talk call, to continue a thread."),
    client_request_id: ClientRequestId,
  })
  .strict();
export const TalkOutput = z
  .object({
    reply: z.string().describe("The Network agent's reply to relay to the member."),
    conversation_id: z.string(),
    pending_confirmation: PendingConfirmation.nullable(),
    related_item_ids: z.array(z.string()).describe("Items from network_get_updates relevant to this reply."),
    receipt: Receipt,
  })
  .strict();

// ---------- network_share_context ----------
export const SharedFactKind = z.enum([
  "interest", "skill", "offer", "desire", "goal", "boundary", "trait", "fact", "preference", "availability_pattern",
]);
export const ShareContextInput = z
  .object({
    facts: z
      .array(
        z
          .object({
            kind: SharedFactKind,
            text: z.string().trim().min(2).max(500).describe("One fact about the member only. Never about third parties."),
            source: z.enum(["member_said_in_host", "host_memory", "host_connected_source"]),
          })
          .strict(),
      )
      .min(1)
      .max(25),
    member_reviewed: z
      .literal(true)
      .describe("Set only after showing the member this exact list and getting their OK. Facts still arrive as proposals."),
    client_request_id: ClientRequestId,
  })
  .strict();
export const RejectReason = z.enum([
  "contact_details_not_accepted",
  "credential_like_text",
  "sensitive_topic_tell_network_directly",
  "duplicate",
]);
export const ShareContextOutput = z
  .object({
    status: z.literal("proposed_pending_member_review"),
    accepted: z.array(z.object({ index: z.number().int(), proposal_id: z.string(), kind: SharedFactKind }).strict()),
    rejected: z.array(z.object({ index: z.number().int(), reason: RejectReason }).strict()),
    note: z.string(),
    receipt: Receipt,
  })
  .strict();

// ---------- network_get_updates ----------
export const ItemKind = z.enum(["opportunity", "question", "reminder", "notice"]);
export const Decision = z.enum(["accept", "decline", "tell_me_more", "confirm", "cancel"]);
export const GetUpdatesInput = z
  .object({
    cursor: z.string().max(200).optional(),
    kinds: z.array(ItemKind).min(1).max(4).optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const Item = z
  .object({
    item_id: z.string().describe("Opaque, per-member id. Not shared with any other member."),
    kind: ItemKind,
    title: z.string().max(120),
    body: z.string().max(1000).describe("Already cleared for this member: shareable reasons only."),
    created_at: Iso,
    expires_at: Iso.nullable(),
    allowed_decisions: z.array(Decision),
  })
  .strict();
export const GetUpdatesOutput = z
  .object({
    items: z.array(Item),
    next_cursor: z.string().nullable(),
    member_state: z.enum(["open", "normal", "quiet", "receiving", "paused"]),
  })
  .strict();

// ---------- network_respond ----------
export const RespondInput = z
  .object({
    item_id: z.string().max(100).describe("An item_id from network_get_updates or a confirmation_id from a pending_confirmation."),
    decision: Decision,
    note: z.string().trim().max(500).optional().describe("Optional short note from the member (e.g. a reason or timing)."),
    client_request_id: ClientRequestId,
  })
  .strict();
export const RespondStatus = z.enum([
  "done", "needs_confirmation", "awaiting_network_channel", "not_available", "details",
]);
export const RespondOutput = z
  .object({
    status: RespondStatus,
    message: z.string(),
    item_id: z.string(),
    pending_confirmation: PendingConfirmation.nullable(),
    receipt: Receipt,
  })
  .strict();

export type TalkIn = z.infer<typeof TalkInput>;
export type TalkOut = z.infer<typeof TalkOutput>;
export type ShareIn = z.infer<typeof ShareContextInput>;
export type ShareOut = z.infer<typeof ShareContextOutput>;
export type UpdatesIn = z.input<typeof GetUpdatesInput>;
export type UpdatesOut = z.infer<typeof GetUpdatesOutput>;
export type RespondIn = z.infer<typeof RespondInput>;
export type RespondOut = z.infer<typeof RespondOutput>;
export type PendingConf = z.infer<typeof PendingConfirmation>;
export type ReceiptT = z.infer<typeof Receipt>;
export type ItemT = z.infer<typeof Item>;

/** JSON Schemas as published in tools/list (handy for the docs and non-MCP REST adapters). */
export function jsonSchemas() {
  return {
    network_talk: { input: z.toJSONSchema(TalkInput, { io: "input" }), output: z.toJSONSchema(TalkOutput) },
    network_share_context: { input: z.toJSONSchema(ShareContextInput, { io: "input" }), output: z.toJSONSchema(ShareContextOutput) },
    network_get_updates: { input: z.toJSONSchema(GetUpdatesInput, { io: "input" }), output: z.toJSONSchema(GetUpdatesOutput) },
    network_respond: { input: z.toJSONSchema(RespondInput, { io: "input" }), output: z.toJSONSchema(RespondOutput) },
  };
}
