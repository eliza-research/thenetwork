export type SiteTelemetryEvent =
  | "page_view"
  | "cta_click"
  | "join_started"
  | "join_completed"
  | "qr_scan"
  | "link_click"
  | "agent_handoff";

export interface SiteAttribution {
  readonly utmSource?: string;
  readonly utmMedium?: string;
  readonly utmCampaign?: string;
  readonly utmContent?: string;
  readonly utmTerm?: string;
  readonly qrBatch?: string;
  readonly ref?: string;
  readonly landingPath?: string;
  readonly referrerHost?: string;
}

const STORAGE_KEY = "tn_attr_v1";
const MAX_FIELD_LEN = 128;

function cleanParam(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FIELD_LEN || /[\r\n\0]/.test(trimmed)) return undefined;
  return trimmed;
}

function safeReferrerHost(): string | undefined {
  if (typeof document === "undefined" || !document.referrer) return undefined;
  try {
    const refUrl = new URL(document.referrer);
    if (typeof window !== "undefined" && refUrl.hostname === window.location.hostname) {
      return undefined;
    }
    return cleanParam(refUrl.hostname);
  } catch {
    return undefined;
  }
}

export function readStoredAttribution(): SiteAttribution | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    const pick = (k: keyof SiteAttribution) =>
      typeof record[k] === "string" ? cleanParam(record[k]) : undefined;
    const result: SiteAttribution = {
      ...(pick("utmSource") ? { utmSource: pick("utmSource") } : {}),
      ...(pick("utmMedium") ? { utmMedium: pick("utmMedium") } : {}),
      ...(pick("utmCampaign") ? { utmCampaign: pick("utmCampaign") } : {}),
      ...(pick("utmContent") ? { utmContent: pick("utmContent") } : {}),
      ...(pick("utmTerm") ? { utmTerm: pick("utmTerm") } : {}),
      ...(pick("qrBatch") ? { qrBatch: pick("qrBatch") } : {}),
      ...(pick("ref") ? { ref: pick("ref") } : {}),
      ...(pick("landingPath") ? { landingPath: pick("landingPath") } : {}),
      ...(pick("referrerHost") ? { referrerHost: pick("referrerHost") } : {}),
    };
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

export function clearStoredAttribution(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    return;
  }
}

export function captureAttributionFromLocation(): SiteAttribution | undefined {
  if (typeof window === "undefined") return undefined;
  const params = new URLSearchParams(window.location.search);
  const existing = readStoredAttribution() ?? {};
  const utmSource = cleanParam(params.get("utm_source")) ?? existing.utmSource;
  const utmMedium = cleanParam(params.get("utm_medium")) ?? existing.utmMedium;
  const utmCampaign = cleanParam(params.get("utm_campaign")) ?? existing.utmCampaign;
  const utmContent = cleanParam(params.get("utm_content")) ?? existing.utmContent;
  const utmTerm = cleanParam(params.get("utm_term")) ?? existing.utmTerm;
  const qrBatch = cleanParam(params.get("qr") ?? params.get("qr_batch")) ?? existing.qrBatch;
  const ref = cleanParam(params.get("ref")) ?? existing.ref;
  const landingPath = existing.landingPath ?? cleanParam(window.location.pathname);
  const referrerHost = existing.referrerHost ?? safeReferrerHost();

  const merged: SiteAttribution = {
    ...(utmSource ? { utmSource } : {}),
    ...(utmMedium ? { utmMedium } : {}),
    ...(utmCampaign ? { utmCampaign } : {}),
    ...(utmContent ? { utmContent } : {}),
    ...(utmTerm ? { utmTerm } : {}),
    ...(qrBatch ? { qrBatch } : {}),
    ...(ref ? { ref } : {}),
    ...(landingPath ? { landingPath } : {}),
    ...(referrerHost ? { referrerHost } : {}),
  };

  if (Object.keys(merged).length === 0) return undefined;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
  } catch {
    return merged;
  }
  return merged;
}

export function sendSiteEvent(
  event: SiteTelemetryEvent,
  opts: { readonly path?: string; readonly cta?: string; readonly app?: string } = {},
): boolean {
  if (typeof window === "undefined") return false;
  const attr = readStoredAttribution();
  const path = cleanParam(opts.path ?? window.location.pathname);
  const payload: Record<string, string> = {
    event,
    ...(path ? { path } : {}),
    ...(opts.cta ? { cta: opts.cta } : {}),
    ...(opts.app ? { app: opts.app } : {}),
    ...(attr?.utmSource ? { utmSource: attr.utmSource } : {}),
    ...(attr?.utmMedium ? { utmMedium: attr.utmMedium } : {}),
    ...(attr?.utmCampaign ? { utmCampaign: attr.utmCampaign } : {}),
    ...(attr?.utmContent ? { utmContent: attr.utmContent } : {}),
    ...(attr?.utmTerm ? { utmTerm: attr.utmTerm } : {}),
    ...(attr?.qrBatch ? { qrBatch: attr.qrBatch } : {}),
    ...(attr?.ref ? { ref: attr.ref } : {}),
    ...(attr?.referrerHost ? { referrerHost: attr.referrerHost } : {}),
  };
  const body = JSON.stringify(payload);
  if (body.length > 2048) return false;
  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon("/_t", blob)) return true;
    }
    void fetch("/_t", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
      credentials: "omit",
    }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
