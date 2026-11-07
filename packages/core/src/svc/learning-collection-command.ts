import { collectionExpiry } from "./proof-window.js";
/** Explicit same-turn Google collection scope. Identity, connector ownership and consent are server-owned. */
export type NetworkCollectionSource = "gmail" | "google_calendar";
export type NetworkCollectionField = "interest" | "goal" | "availability_pattern";
export interface NetworkCollectionScope {
  sources: NetworkCollectionSource[];
  windowStart: number;
  windowEnd: number;
  timezone: string;
  fields: NetworkCollectionField[];
  retainAcceptedOnDisconnect: boolean;
}
export type NetworkCollectionCommand =
  | { kind: "help"; batchId: string }
  | { kind: "collect"; batchId: string; scope: NetworkCollectionScope };
export interface NetworkCollectionSelection extends Omit<NetworkCollectionScope, "sources"> {
  sources: { source: NetworkCollectionSource; connectionId: string }[];
  pendingExpiresAt: number;
  expiresAt: number;
}
export const NETWORK_COLLECTION_MAX_WINDOW_MS = 31 * 86_400_000;
export const NETWORK_COLLECTION_RETENTION_MS = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Date.parse alone normalizes impossible dates. Check the wall clock before applying its explicit offset. */
function absoluteTime(text: string): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
  if (!m) return undefined;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (year! < 1970 || month! < 1 || month! > 12 || day! < 1 || day! > 31 || hour! > 23 || minute! > 59 || second! > 59) return undefined;
  const wall = new Date(0);
  wall.setUTCFullYear(year!, month! - 1, day!); wall.setUTCHours(hour!, minute!, second!, 0);
  if (wall.getUTCFullYear() !== year || wall.getUTCMonth() !== month! - 1 || wall.getUTCDate() !== day) return undefined;
  const offsetHours = Number(m[9] ?? 0), offsetMinutes = Number(m[10] ?? 0);
  if (offsetHours > 23 || offsetMinutes > 59) return undefined;
  const offset = (m[8] === "-" ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  const value = wall.getTime() - offset;
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Matches Cloud's explicit source/window/field/retention grammar; never infer a missing choice. */
export function parseNetworkCollectionScope(text: string): NetworkCollectionScope | undefined {
  if (typeof text !== "string" || text.length > 512 || /[\u0000-\u001f\u007f]/u.test(text)) return undefined;
  const m = /^(gmail|calendar|gmail,calendar) from (\S+) until (\S+) timezone (\S+) fields (\S+) retain (keep|delete)$/.exec(text);
  if (!m) return undefined;
  const windowStart = absoluteTime(m[2]!), windowEnd = absoluteTime(m[3]!);
  if (windowStart === undefined || windowEnd === undefined || windowEnd <= windowStart || windowEnd - windowStart > NETWORK_COLLECTION_MAX_WINDOW_MS) return undefined;
  const fields = m[5]!.split(",");
  if (!fields.length || fields.length > 3 || new Set(fields).size !== fields.length || fields.some(x => !["interest", "goal", "availability_pattern"].includes(x))) return undefined;
  if (m[4]!.length > 100) return undefined;
  try { new Intl.DateTimeFormat("en", { timeZone: m[4] }); } catch { return undefined; }
  return { sources: m[1]!.split(",").map(s => s === "calendar" ? "google_calendar" : "gmail"), windowStart, windowEnd, timezone: m[4]!, fields: fields as NetworkCollectionField[], retainAcceptedOnDisconnect: m[6] === "keep" };
}

/** Do not trim the original text: callers hash exactly the stored inbound bytes, separately. */
export function parseNetworkCollectionCommand(text: string): NetworkCollectionCommand | undefined {
  if (typeof text !== "string" || text.length > 557 || /[\u0000-\u001f\u007f]/u.test(text)) return undefined;
  const m = /^collect ([0-9a-f-]{36})(?: (.+))?$/.exec(text);
  if (!m || !UUID.test(m[1]!)) return undefined;
  if (m[2] === undefined) return { kind: "help", batchId: m[1]! };
  const scope = parseNetworkCollectionScope(m[2]);
  return scope ? { kind: "collect", batchId: m[1]!, scope } : undefined;
}

/** Fixed lifetime from the verified stored turn, never from retry/collection execution time. */
export function networkCollectionDeadline(turnReceivedAt: number, now: number): number | undefined {
  if (!Number.isSafeInteger(turnReceivedAt) || !Number.isSafeInteger(now)) return undefined;
  const expiresAt = collectionExpiry(turnReceivedAt, now, NETWORK_COLLECTION_RETENTION_MS);
  return Number.isSafeInteger(expiresAt) ? expiresAt : undefined;
}

/** Stable key order, explicit source order from the command, exact connector IDs; no identity fields. */
export function serializeNetworkCollectionSelection(selection: NetworkCollectionSelection): string {
  return JSON.stringify({ sources: selection.sources.map(s => ({ source: s.source, connectionId: s.connectionId })), windowStart: selection.windowStart, windowEnd: selection.windowEnd, timezone: selection.timezone, fields: selection.fields, retainAcceptedOnDisconnect: selection.retainAcceptedOnDisconnect, pendingExpiresAt: selection.pendingExpiresAt, expiresAt: selection.expiresAt });
}

/** Hash the stable DTO, never a normalized replacement for commandSha256(original inbound bytes). */
export async function hashNetworkCollectionSelection(selection: NetworkCollectionSelection): Promise<string> {
  const bytes = new TextEncoder().encode(serializeNetworkCollectionSelection(selection));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
}
