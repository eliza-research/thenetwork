// Exact tool contracts from docs/research/mcp-server-design.md §5.3–§5.7 (approved: five tools).
// Published as literal JSON Schema 2020-12 objects so tools/list matches the design byte for byte;
// tests parse the design doc and compare. Inputs are validated server-side with ./json-schema.ts.
import type { SurfaceProfileName } from "./profiles.ts";

export const TOOL_NAMES = {
  ask: "ask_network_agent",
  tell: "tell_network_agent",
  share: "share_profile_with_network",
  updates: "get_network_updates",
  respond: "respond_to_network_item",
} as const;
export type ToolName = (typeof TOOL_NAMES)[keyof typeof TOOL_NAMES];

/** PRD B.3 scope vocabulary (design §3.4). */
export const SCOPES = {
  readBasic: "network.read.basic",
  writeRequests: "network.write.requests",
  writeProfile: "network.write.profile",
  writeResponses: "network.write.responses",
  writeRelay: "network.write.relay",
  writeInvites: "network.write.invites",
  sensitiveSafety: "network.sensitive.safety",
  offline: "offline_access",
} as const;
/** Scopes granted by default on consent and advertised in protected resource metadata. */
export const DEFAULT_SCOPES = [SCOPES.readBasic, SCOPES.writeRequests, SCOPES.writeProfile, SCOPES.writeResponses, SCOPES.offline];
/** Everything the authorization server can issue (optional P2 scopes included). */
export const ALL_AS_SCOPES = [
  SCOPES.readBasic, SCOPES.writeRequests, SCOPES.writeProfile, SCOPES.writeResponses,
  SCOPES.writeRelay, SCOPES.writeInvites, SCOPES.sensitiveSafety, SCOPES.offline,
];

export const TOOL_SCOPES: Record<ToolName, string> = {
  ask_network_agent: SCOPES.readBasic,
  tell_network_agent: SCOPES.writeRequests,
  share_profile_with_network: SCOPES.writeProfile,
  get_network_updates: SCOPES.readBasic,
  respond_to_network_item: SCOPES.writeResponses,
};
export const WRITE_TOOLS: ReadonlySet<ToolName> = new Set([TOOL_NAMES.tell, TOOL_NAMES.share, TOOL_NAMES.respond]);

export type JsonSchema = { [k: string]: unknown };

const IDEMPOTENCY_KEY = { type: "string", pattern: "^[A-Za-z0-9_-]{8,64}$" };

const PENDING_CONFIRMATION: JsonSchema = {
  type: "object", additionalProperties: false,
  required: ["confirmation_id", "summary", "how_to_confirm"],
  properties: {
    confirmation_id: { type: "string", pattern: "^cnf_[A-Za-z0-9]{6,12}$" },
    summary: { type: "string", maxLength: 300, description: "Exactly what will happen if the member confirms." },
    how_to_confirm: {
      type: "string", enum: ["ask_member_then_respond", "member_confirms_in_network_app"],
      description:
        "ask_member_then_respond: show the summary to the member and, only if they agree, call respond_to_network_item with item_id = confirmation_id and response = confirm. member_confirms_in_network_app: the Network has messaged the member directly; the assistant cannot confirm this.",
    },
    expires_in: { type: "string", maxLength: 40 },
  },
};

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  annotations: { title: string; readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint: boolean };
  _meta: Record<string, unknown>;
}

const LOOKING_FOR = ["new_friends", "activity_partners", "professional_connections", "mentoring_others", "being_mentored", "local_help", "things_to_do", "collaborators"] as const;
export type LookingFor = (typeof LOOKING_FOR)[number];

// ---------------------------------------------------------------------------------------- §5.3
const ASK: ToolDefinition = {
  name: "ask_network_agent",
  title: "Ask your Network agent",
  description:
    "Ask the member's private Network agent a question and get its answer: what it knows about the member's requests, the status of an introduction or plan, why it suggested something, or local ideas it already has. Read-only: never changes anything and never contacts anyone. To ask the Network to do something, use tell_network_agent.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: {
      question: {
        type: "string", minLength: 1, maxLength: 2000,
        description: "The member's question in their words or a faithful paraphrase. Do not include other people's phone numbers, emails, or addresses.",
      },
      about_item_id: { type: "string", pattern: "^itm_[A-Za-z0-9]{6,12}$", description: "Optional item_id from get_network_updates the question is about." },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["answer", "related_items", "suggested_tool"],
    properties: {
      answer: { type: "string", maxLength: 4000, description: "The Network agent's answer to show or relay to the member." },
      related_items: {
        type: "array", maxItems: 5, items: {
          type: "object", additionalProperties: false, required: ["item_id", "title"],
          properties: { item_id: { type: "string" }, title: { type: "string", maxLength: 120 } },
        },
      },
      suggested_tool: {
        type: "string", enum: ["none", "tell_network_agent", "respond_to_network_item", "get_network_updates"],
        description: "If the member seems to want an action, the tool that would do it. Only call it if the member asks.",
      },
    },
  },
  annotations: { title: "Ask your Network agent", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: {
    securitySchemes: [{ type: "oauth2", scopes: ["network.read.basic"] }],
    "openai/toolInvocation/invoking": "Asking your Network…",
    "openai/toolInvocation/invoked": "The Network answered",
  },
};

// ---------------------------------------------------------------------------------------- §5.4
const TELL: ToolDefinition = {
  name: "tell_network_agent",
  title: "Tell your Network agent",
  description:
    "Ask the member's Network agent to do or remember something for the member: start a request for help or an introduction, change their availability, participation state or notification preferences, or update what they're looking for. Changes only the member's own Network settings and requests. It never contacts other people directly: anything that would involve someone else comes back as a pending confirmation that the member must approve. Does not accept or decline items; use respond_to_network_item for that.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["instruction"],
    properties: {
      instruction: { type: "string", minLength: 1, maxLength: 2000, description: "What the member wants the Network to do, in their words or a faithful paraphrase." },
      about_item_id: { type: "string", pattern: "^itm_[A-Za-z0-9]{6,12}$" },
      idempotency_key: { ...IDEMPOTENCY_KEY, description: "Optional. Reuse the same value only when retrying this exact call." },
    },
  },
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["reply", "status", "changes", "pending_confirmation"],
    properties: {
      reply: { type: "string", maxLength: 4000 },
      status: { type: "string", enum: ["done", "needs_confirmation", "confirm_in_network_app", "not_available_here", "nothing_changed"] },
      changes: {
        type: "array", maxItems: 10, items: {
          type: "object", additionalProperties: false, required: ["kind", "summary"],
          properties: {
            kind: { type: "string", enum: ["request_drafted", "request_submitted", "preference_updated", "availability_updated", "state_changed", "profile_proposed"] },
            summary: { type: "string", maxLength: 200 },
          },
        },
      },
      pending_confirmation: { oneOf: [{ type: "null" }, { $ref: "#/$defs/PendingConfirmation" }] },
    },
    $defs: { PendingConfirmation: PENDING_CONFIRMATION },
  },
  annotations: { title: "Tell your Network agent", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: {
    securitySchemes: [{ type: "oauth2", scopes: ["network.write.requests"] }],
    "openai/toolInvocation/invoking": "Telling your Network…",
    "openai/toolInvocation/invoked": "The Network replied",
  },
};

// ---------------------------------------------------------------------------------------- §5.5
const SHARE: ToolDefinition = {
  name: "share_profile_with_network",
  title: "Share profile details with The Network",
  description:
    "Send The Network specific details about the member that the member has reviewed and approved, to help with onboarding. Each detail arrives as a proposal the member can edit or remove in The Network; nothing is shown to other members without the Network's privacy rules. Only send facts about the member, never about other people. Do not send conversation history or summaries.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["member_approved"],
    minProperties: 2,
    properties: {
      interests: { type: "array", maxItems: 15, items: { type: "string", minLength: 2, maxLength: 80 }, description: "Hobbies and interests, e.g. 'bouldering', 'jazz piano'." },
      skills_offered: { type: "array", maxItems: 10, items: { type: "string", minLength: 2, maxLength: 80 }, description: "Things the member is glad to help others with." },
      goals: { type: "array", maxItems: 5, items: { type: "string", minLength: 2, maxLength: 160 }, description: "What the member wants more of right now." },
      looking_for: { type: "array", maxItems: 6, uniqueItems: true, items: { type: "string", enum: [...LOOKING_FOR] } },
      home_area: {
        type: "object", additionalProperties: false, required: ["city"],
        properties: { city: { type: "string", maxLength: 60 }, neighborhood: { type: "string", maxLength: 60 } },
        description: "City and optional neighborhood only. Never a street address.",
      },
      availability_note: { type: "string", maxLength: 200, description: "e.g. 'weeknights after 7, most Sunday mornings'." },
      languages: { type: "array", maxItems: 5, items: { type: "string", maxLength: 40 } },
      member_approved: { const: true, description: "Set only after showing the member exactly these details and getting their OK." },
      idempotency_key: { ...IDEMPOTENCY_KEY },
    },
  },
  outputSchema: {
    type: "object", additionalProperties: false,
    required: ["status", "accepted_count", "rejected", "next_step"],
    properties: {
      status: { const: "proposed_for_member_review" },
      accepted_count: { type: "integer", minimum: 0 },
      rejected: {
        type: "array", maxItems: 50, items: {
          type: "object", additionalProperties: false, required: ["field", "reason"],
          properties: {
            field: { type: "string" }, index: { type: "integer" },
            reason: { type: "string", enum: ["contact_details_not_accepted", "about_someone_else", "sensitive_tell_the_network_directly", "not_available_here", "duplicate", "too_precise_location"] },
          },
        },
      },
      next_step: { type: "string", maxLength: 300 },
    },
  },
  annotations: { title: "Share profile details with The Network", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: "oauth2", scopes: ["network.write.profile"] }] },
};

// ---------------------------------------------------------------------------------------- §5.6
const ITEM_KINDS = ["opportunity", "question", "reminder", "notice"] as const;
const RESPONSES = ["interested", "not_for_me", "maybe_later", "tell_me_more", "confirm", "cancel"] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type ResponseValue = (typeof RESPONSES)[number];

const UPDATES: ToolDefinition = {
  name: "get_network_updates",
  title: "Get Network updates",
  description:
    "List items The Network has already cleared for this member: opportunities, questions for the member, and reminders. Use when the member asks what's new from The Network. Read-only.",
  inputSchema: {
    type: "object", additionalProperties: false,
    properties: {
      kinds: { type: "array", uniqueItems: true, maxItems: 4, items: { type: "string", enum: [...ITEM_KINDS] } },
      limit: { type: "integer", minimum: 1, maximum: 10, default: 5 },
      cursor: { type: "string", maxLength: 200 },
    },
  },
  outputSchema: {
    type: "object", additionalProperties: false,
    required: ["items", "next_cursor", "participation_state"],
    properties: {
      items: {
        type: "array", maxItems: 10, items: {
          type: "object", additionalProperties: false,
          required: ["item_id", "kind", "title", "summary", "allowed_responses"],
          properties: {
            item_id: { type: "string", pattern: "^itm_[A-Za-z0-9]{6,12}$" },
            kind: { type: "string", enum: [...ITEM_KINDS] },
            title: { type: "string", maxLength: 120 },
            summary: { type: "string", maxLength: 600, description: "Cleared for this member: shareable reasons only." },
            when: { type: "string", maxLength: 80 },
            where: { type: "string", maxLength: 80, description: "Neighborhood-level at most." },
            expires: { type: "string", maxLength: 40 },
            allowed_responses: { type: "array", items: { type: "string", enum: [...RESPONSES] } },
          },
        },
      },
      next_cursor: { type: ["string", "null"] },
      participation_state: { type: "string", enum: ["open", "normal", "quiet", "receiving", "paused"] },
    },
  },
  annotations: { title: "Get Network updates", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: "oauth2", scopes: ["network.read.basic"] }] },
};

// ---------------------------------------------------------------------------------------- §5.7
const RESPOND: ToolDefinition = {
  name: "respond_to_network_item",
  title: "Respond to a Network item",
  description:
    "Record the member's answer to an item from get_network_updates, or confirm/cancel a pending confirmation. Call only with the member's explicit answer. 'interested' tells The Network the member wants to go ahead (others are only contacted under The Network's consent rules); 'not_for_me' declines; 'maybe_later' snoozes; 'tell_me_more' returns more detail; 'confirm'/'cancel' answer a pending confirmation.",
  inputSchema: {
    type: "object", additionalProperties: false,
    required: ["item_id", "response"],
    properties: {
      item_id: { type: "string", pattern: "^(itm|cnf)_[A-Za-z0-9]{6,12}$" },
      response: { type: "string", enum: [...RESPONSES] },
      note: { type: "string", maxLength: 300, description: "Optional short note from the member, such as timing. No contact details." },
      idempotency_key: { ...IDEMPOTENCY_KEY },
    },
  },
  outputSchema: {
    type: "object", additionalProperties: false,
    required: ["status", "message"],
    properties: {
      status: { type: "string", enum: ["done", "details", "needs_confirmation", "confirm_in_network_app", "expired", "not_available_here", "already_done"] },
      message: { type: "string", maxLength: 1000 },
      details: { type: "string", maxLength: 1500, description: "Present for tell_me_more; cleared content only." },
      pending_confirmation: { oneOf: [{ type: "null" }, { $ref: "#/$defs/PendingConfirmation" }] },
    },
    // The design writes this as "same as tell_network_agent"; published here in full.
    $defs: { PendingConfirmation: PENDING_CONFIRMATION },
  },
  annotations: { title: "Respond to a Network item", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  _meta: { securitySchemes: [{ type: "oauth2", scopes: ["network.write.responses"] }] },
};

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [ASK, TELL, SHARE, UPDATES, RESPOND];

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * tools/list text rendered per surface profile (design §7.1 step 1). ChatGPT (teen_safe_directory)
 * and Claude (general_assistant) get the design text verbatim: it contains no romance, dating or
 * nightlife vocabulary and `looking_for` has no romance value on any profile. The enterprise profile
 * narrows `looking_for` to work-context values.
 */
export function renderTools(profile: SurfaceProfileName): ToolDefinition[] {
  const tools = TOOL_DEFINITIONS.map(clone);
  if (profile === "enterprise_professional") {
    const share = tools.find((t) => t.name === TOOL_NAMES.share)!;
    const lf = (share.inputSchema.properties as any).looking_for;
    lf.items.enum = ["professional_connections", "mentoring_others", "being_mentored", "local_help", "collaborators"];
    lf.maxItems = 5;
  }
  return tools;
}

export const toolDefinition = (name: ToolName, profile: SurfaceProfileName = "general_assistant") =>
  renderTools(profile).find((t) => t.name === name)!;

// ------------------------------------------------------------------ TypeScript shapes of the above

export interface AskIn { question: string; about_item_id?: string }
export interface AskOut { answer: string; related_items: { item_id: string; title: string }[]; suggested_tool: "none" | "tell_network_agent" | "respond_to_network_item" | "get_network_updates" }

export interface PendingConfirmationOut {
  confirmation_id: string; summary: string;
  how_to_confirm: "ask_member_then_respond" | "member_confirms_in_network_app";
  expires_in?: string;
}
export type ChangeKind = "request_drafted" | "request_submitted" | "preference_updated" | "availability_updated" | "state_changed" | "profile_proposed";
export interface TellIn { instruction: string; about_item_id?: string; idempotency_key?: string }
export interface TellOut {
  reply: string;
  status: "done" | "needs_confirmation" | "confirm_in_network_app" | "not_available_here" | "nothing_changed";
  changes: { kind: ChangeKind; summary: string }[];
  pending_confirmation: PendingConfirmationOut | null;
}

export interface ShareIn {
  interests?: string[]; skills_offered?: string[]; goals?: string[]; looking_for?: LookingFor[];
  home_area?: { city: string; neighborhood?: string }; availability_note?: string; languages?: string[];
  member_approved: true; idempotency_key?: string;
}
export type ShareRejectReason = "contact_details_not_accepted" | "about_someone_else" | "sensitive_tell_the_network_directly" | "not_available_here" | "duplicate" | "too_precise_location";
export interface ShareOut {
  status: "proposed_for_member_review"; accepted_count: number;
  rejected: { field: string; index?: number; reason: ShareRejectReason }[]; next_step: string;
}

export interface UpdatesIn { kinds?: ItemKind[]; limit?: number; cursor?: string }
export interface ItemOut {
  item_id: string; kind: ItemKind; title: string; summary: string;
  when?: string; where?: string; expires?: string; allowed_responses: ResponseValue[];
}
export interface UpdatesOut { items: ItemOut[]; next_cursor: string | null; participation_state: "open" | "normal" | "quiet" | "receiving" | "paused" }

export interface RespondIn { item_id: string; response: ResponseValue; note?: string; idempotency_key?: string }
export interface RespondOut {
  status: "done" | "details" | "needs_confirmation" | "confirm_in_network_app" | "expired" | "not_available_here" | "already_done";
  message: string; details?: string; pending_confirmation?: PendingConfirmationOut | null;
}

/** Internal receipt; returned to hosts only in `_meta["network/receipt"]` (design §5.1, §8.5). */
export interface Receipt { receipt_id: string; action_id: string; at: string; replayed: boolean }

export type ToolErrorCode =
  | "not_member" | "not_available_on_this_assistant" | "item_not_found" | "item_expired" | "rate_limited"
  | "idempotency_conflict" | "invalid_input" | "temporarily_unavailable" | "needs_scope";
