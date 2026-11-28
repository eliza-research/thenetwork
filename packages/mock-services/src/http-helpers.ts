import { createHash } from "node:crypto";
import type { ChaosEngine } from "./chaos.ts";
import type { MockServiceName, MockSessionState, MockStateRegistry } from "./state.ts";
import type { WebhookDispatcher } from "./webhooks.ts";

export interface ServiceContext {
  registry: MockStateRegistry;
  state: MockSessionState;
  chaos: ChaosEngine;
  webhooks: WebhookDispatcher;
  baseUrl: string;
}

export interface ServiceResult {
  response: Response;
  service: MockServiceName;
  requestSummary?: Record<string, unknown>;
  responseSummary?: Record<string, unknown>;
  rateLimit?: { limit: number; remaining: number; resetAtSec: number };
  chaosApplied?: string;
  webhookTriggered?: string[];
}

export function jsonResponse(
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

export function sha256Hex(raw: string | Uint8Array): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function md5Hex(raw: string | Uint8Array): string {
  return createHash("md5").update(raw).digest("hex");
}

export function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function parseJsonBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (!text.trim()) return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : { value: parsed };
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

export async function parseFormBody(req: Request): Promise<Record<string, string>> {
  const text = await req.text();
  if (!text.trim()) return {};
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed)) {
        out[k] = typeof v === "string" ? v : String(v ?? "");
      }
      return out;
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(text);
  const out: Record<string, string> = {};
  for (const [k, v] of params.entries()) {
    out[k] = v;
  }
  return out;
}

export function strField(obj: Record<string, unknown>, key: string, fallback = ""): string {
  const val = obj[key];
  return typeof val === "string" ? val : fallback;
}

export function numField(obj: Record<string, unknown>, key: string, fallback = 0): number {
  const val = obj[key];
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    const n = Number(val);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
