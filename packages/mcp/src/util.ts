import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readCappedText } from "@thenetwork/platform/src/body.ts";

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (prefix = "") => prefix + randomBytes(32).toString("base64url");
export const randomId = () => randomBytes(16).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** PKCE S256 (RFC 7636 4.6): BASE64URL(SHA256(ASCII(code_verifier))) == code_challenge. */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}
/** RFC 7636 4.1: 43-128 characters of [A-Z a-z 0-9 - . _ ~]. */
export const validVerifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9\-._~]{43,128}$/.test(v);
/** A S256 challenge is 43 base64url characters. */
export const validChallenge = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9\-_]{43}$/.test(v);

export const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...headers } });
}

export const esc = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A form body (application/x-www-form-urlencoded), at most 16 KiB. Undefined when it is not one. */
export async function readForm(req: Request): Promise<URLSearchParams | undefined> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) return undefined;
  const text = await readCappedText(req, 16_384);
  if (text === "too_large") return undefined;
  const form = new URLSearchParams(text);
  // RFC 6749 3.1 / 3.2: a parameter must not appear more than once.
  const seen = new Set<string>();
  for (const k of form.keys()) { if (seen.has(k)) return undefined; seen.add(k); }
  return form;
}

/** A JSON object body of at most 16 KiB, or undefined. */
export async function readJson(req: Request): Promise<Record<string, unknown> | undefined> {
  const text = await readCappedText(req, 16_384);
  if (text === "too_large") return undefined;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export function cookieValue(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try { return decodeURIComponent(part.slice(i + 1).trim()); } catch { return undefined; }
    }
  }
  return undefined;
}

export const isLoopbackHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
