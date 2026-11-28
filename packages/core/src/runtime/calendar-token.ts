import { createHmac, timingSafeEqual } from "node:crypto";
import type { CalendarTokenPayload } from "../ics.ts";

const TOKEN_VERSION_PREFIX = "cal:v1:";
const TOKEN_PART_RE = /^[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 512;

export function signCalendarToken(payload: CalendarTokenPayload, secret: string): string {
  if (!secret) throw new Error("Calendar token signing secret is required");
  if (!payload.app || !payload.oppId || !payload.memberId || !Number.isSafeInteger(payload.exp)) {
    throw new Error("Calendar token payload is incomplete");
  }
  const wire: Record<string, unknown> = {
    a: payload.app,
    o: payload.oppId,
    m: payload.memberId,
    e: payload.exp,
    ...(payload.rev !== undefined ? { r: payload.rev } : {}),
  };
  const body = Buffer.from(JSON.stringify(wire), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(`${TOKEN_VERSION_PREFIX}${body}`).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyCalendarToken(token: string, secret: string, now: number): CalendarTokenPayload | undefined {
  if (!secret || !token || token.length > MAX_TOKEN_LENGTH || !Number.isFinite(now)) return undefined;
  const cleaned = token.endsWith(".ics") ? token.slice(0, -4) : token;
  const dot = cleaned.indexOf(".");
  if (dot <= 0 || dot !== cleaned.lastIndexOf(".")) return undefined;
  const body = cleaned.slice(0, dot);
  const sig = cleaned.slice(dot + 1);
  if (!TOKEN_PART_RE.test(body) || !TOKEN_PART_RE.test(sig)) return undefined;
  const expected = createHmac("sha256", secret).update(`${TOKEN_VERSION_PREFIX}${body}`).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sig, "base64url");
  } catch {
    return undefined;
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const raw = parsed as Record<string, unknown>;
  if (typeof raw.a !== "string" || !raw.a || typeof raw.o !== "string" || !raw.o || typeof raw.m !== "string" || !raw.m) {
    return undefined;
  }
  if (typeof raw.e !== "number" || !Number.isSafeInteger(raw.e)) return undefined;
  if (raw.r !== undefined && (typeof raw.r !== "number" || !Number.isSafeInteger(raw.r) || raw.r < 0)) {
    return undefined;
  }
  if (now >= raw.e) return undefined;
  return {
    app: raw.a,
    oppId: raw.o,
    memberId: raw.m,
    exp: raw.e,
    ...(typeof raw.r === "number" ? { rev: raw.r } : {}),
  };
}
