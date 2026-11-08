import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { readCappedText } from "@thenetwork/platform/src/body.ts";
import { cookiePartIndex, cookiePartValue, hasDuplicateKey, pkceChallengeShape, pkceVerifierShape } from "./request-core.ts";

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
/** RFC 7636 4.1: 43-128 characters of [A-Z a-z 0-9 - . _ ~] (request-core.ts, proved). */
export const validVerifier = (v: unknown): v is string => typeof v === "string" && pkceVerifierShape(v);
/** A S256 challenge is 43 base64url characters (request-core.ts, proved). */
export const validChallenge = (v: unknown): v is string => typeof v === "string" && pkceChallengeShape(v);

export const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" };

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...NO_STORE, ...headers } });
}

export { esc } from "./html-core.ts";

/** A form body (application/x-www-form-urlencoded), at most 16 KiB. Undefined when it is not one. */
export async function readForm(req: Request): Promise<URLSearchParams | undefined> {
  const type = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("application/x-www-form-urlencoded")) return undefined;
  const text = await readCappedText(req, 16_384);
  if (text === "too_large") return undefined;
  const form = new URLSearchParams(text);
  // RFC 6749 3.1 / 3.2: a parameter must not appear more than once (request-core.ts, proved).
  return hasDuplicateKey([...form.keys()]) ? undefined : form;
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

/** The first cookie with the name (request-core.ts, proved), decoded. Undefined when absent or not decodable. */
export function cookieValue(header: string | null, name: string): string | undefined {
  const parts = (header ?? "").split(";");
  const i = cookiePartIndex(parts, name);
  if (i < 0) return undefined;
  try { return decodeURIComponent(cookiePartValue(parts[i]!)); } catch { return undefined; }
}

export const isLoopbackHost = (hostname: string) => hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
