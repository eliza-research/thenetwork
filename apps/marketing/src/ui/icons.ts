export type BrandMarkKey = "ntwrk" | "network" | "slop" | "peon" | "friends" | "eliza" | "all";
export type ProviderLogoKey = "chatgpt" | "claude" | "gemini" | "surplus";
export type DeviceIconKey = "macbook" | "android" | "ios";
export type NavIconKey =
  | "overview"
  | "campaigns"
  | "agents"
  | "devices"
  | "field"
  | "bd"
  | "vip"
  | "rails"
  | "sun"
  | "moon"
  | "refresh"
  | "plus"
  | "search"
  | "close"
  | "external"
  | "shield"
  | "lock"
  | "zap"
  | "play"
  | "pause"
  | "menu"
  | "help";
export type ChannelIconKey =
  | "craigslist"
  | "rentahuman"
  | "creator"
  | "agency"
  | "print"
  | "bd"
  | "vip"
  | "video"
  | "event"
  | "outreach";
export type StatusTone = "ok" | "warn" | "destructive" | "primary" | "neutral";

const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : JSON.stringify(value);
  return raw.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

export function safeHref(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

export const NETWORK_FAVICON_DATA_URI =
  "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><path d='M12 44L24 22L38 34L52 14M38 34L46 52' fill='none' stroke='currentColor' stroke-width='3.5' stroke-linecap='round' stroke-linejoin='round'/><g fill='currentColor'><circle cx='12' cy='44' r='5'/><circle cx='24' cy='22' r='6'/><circle cx='38' cy='34' r='7'/><circle cx='52' cy='14' r='5'/><circle cx='46' cy='52' r='5'/></g></svg>";

export function brandMarkSvg(appId: string, size = 20, label?: string): string {
  const key = appId.toLowerCase();
  const a11y = label
    ? `role="img" aria-label="${escHtml(label)}"`
    : `aria-hidden="true"`;
  const dims = `width="${size}" height="${size}" viewBox="0 0 64 64" class="brand-mark"`;

  if (key === "slop" || key === "slop.date") {
    return `<svg ${dims} ${a11y}><rect width="64" height="64" rx="15" fill="var(--brand-slop)"/><g fill="var(--brand-slop-fg)"><path d="M32 46C12 32 10 20 19 14c6-4 11 0 13 4 2-4 7-8 13-4 9 6 7 18-13 32Z"/><rect x="21" y="34" width="5" height="16" rx="2.5"/><rect x="38" y="34" width="5" height="12" rx="2.5"/><circle cx="23.5" cy="56" r="2.5"/></g></svg>`;
  }
  if (key === "peon" || key === "peon.biz") {
    return `<svg ${dims} ${a11y}><rect width="64" height="64" rx="15" fill="var(--brand-peon)"/><g fill="var(--brand-peon-fg)"><path d="M26 8h12l-3 9h-6Z"/><path d="M28.5 19h7l6 26-9.5 12L22.5 45Z"/></g></svg>`;
  }
  if (key === "friends" || key === "friends.help") {
    return `<svg ${dims} ${a11y}><rect width="64" height="64" rx="15" fill="var(--background)" stroke="var(--border)" stroke-width="2"/><circle cx="24" cy="32" r="15" fill="var(--brand-friends)"/><circle cx="40" cy="32" r="15" fill="var(--foreground)"/><path d="M32 19.3a15 15 0 0 1 0 25.4 15 15 0 0 1 0-25.4Z" fill="var(--background)"/></svg>`;
  }
  if (key === "eliza" || key === "eliza.app") {
    return `<svg ${dims} ${a11y}><rect width="64" height="64" rx="15" fill="var(--brand-eliza)"/><path d="M18 20h22M18 32h18M18 44h24" fill="none" stroke="var(--brand-eliza-fg)" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="20" r="5" fill="var(--brand-eliza-fg)"/></svg>`;
  }
  return `<svg ${dims} ${a11y}><rect width="64" height="64" rx="15" fill="var(--brand-network)"/><path d="M12 44L24 22L38 34L52 14M38 34L46 52" fill="none" stroke="var(--brand-network-fg)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><g fill="var(--brand-network-fg)"><circle cx="12" cy="44" r="5"/><circle cx="24" cy="22" r="6"/><circle cx="38" cy="34" r="7"/><circle cx="52" cy="14" r="5"/><circle cx="46" cy="52" r="5"/></g></svg>`;
}

const PROVIDER_PATHS: Readonly<Record<ProviderLogoKey, string>> = {
  chatgpt:
    "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z",
  claude:
    "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z",
  gemini:
    "M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z",
  surplus:
    "M14.5 2.4A9.8 9.8 0 1021.6 14.5 7.4 7.4 0 0114.5 2.4ZM17.5 4.5a2 2 0 110 4 2 2 0 010-4Z",
};

export function providerLogoSvg(provider: string, size = 15, label?: string): string {
  const key = (provider.toLowerCase() as ProviderLogoKey) in PROVIDER_PATHS
    ? (provider.toLowerCase() as ProviderLogoKey)
    : "surplus";
  const a11y = label ? `role="img" aria-label="${escHtml(label)}"` : `aria-hidden="true"`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" class="provider-icon" ${a11y}><path d="${PROVIDER_PATHS[key]}"/></svg>`;
}

export function deviceIconSvg(platform: string, size = 16, label?: string): string {
  const key = platform.toLowerCase();
  const a11y = label ? `role="img" aria-label="${escHtml(label)}"` : `aria-hidden="true"`;
  const base = `width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="ico" ${a11y}`;
  if (key === "macbook") {
    return `<svg ${base}><rect x="2.5" y="3" width="11" height="7.5" rx="1.2"/><path d="M1 12.5h14"/></svg>`;
  }
  if (key === "ios" || key === "iphone") {
    return `<svg ${base}><rect x="4" y="1.5" width="8" height="13" rx="1.8"/><path d="M6.8 3.4h2.4"/></svg>`;
  }
  return `<svg ${base}><rect x="4" y="1.5" width="8" height="13" rx="1.4"/><circle cx="8" cy="3.5" r="0.6" fill="currentColor" stroke="none"/></svg>`;
}

const CHANNEL_ICONS: Readonly<Record<ChannelIconKey, string>> = {
  craigslist: `<rect x="2" y="2.5" width="12" height="11" rx="1.5"/><path d="M5 6h6M5 8.5h6M5 11h3.5"/>`,
  rentahuman: `<circle cx="8" cy="5" r="2.2"/><path d="M3.5 13.5c.6-2.5 2.4-3.8 4.5-3.8s3.9 1.3 4.5 3.8"/>`,
  creator: `<rect x="1.8" y="3" width="12.4" height="10" rx="2"/><path d="M6.8 6l3.4 2-3.4 2Z" fill="currentColor" stroke="none"/>`,
  agency: `<path d="M2.5 14V3.5L8 1.8l5.5 1.7V14M1.5 14h13M6 6h1M9 6h1M6 9h1M9 9h1M7 14v-2.5h2V14"/>`,
  print: `<rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.6"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.6"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.6"/><path d="M9.5 9.5h1.5v1.5H9.5ZM12 12h1.5v1.5H12Z" fill="currentColor" stroke="none"/>`,
  bd: `<circle cx="4" cy="8" r="2"/><circle cx="12" cy="4.5" r="2"/><circle cx="12" cy="11.5" r="2"/><path d="M5.8 7.2l4.4-2M5.8 8.8l4.4 2"/>`,
  vip: `<path d="M8 1.8l1.7 3.8 4.1.4-3.1 2.7.9 4-3.6-2.1-3.6 2.1.9-4-3.1-2.7 4.1-.4Z"/>`,
  video: `<rect x="2" y="4.5" width="12" height="9" rx="1.5"/><path d="M2.5 4.5l2-2.5h9l-2 2.5M6.5 4.5l1.5-2.5M10 4.5l1.5-2.5"/>`,
  event: `<rect x="2" y="3.5" width="12" height="10.5" rx="1.5"/><path d="M5 1.8v2.7M11 1.8v2.7M2 7h12"/>`,
  outreach: `<path d="M2 3.5h12v9H2Z"/><path d="M2 4l6 4.5L14 4"/>`,
};

export function channelIconSvg(channel: string, size = 14): string {
  const c = channel.toLowerCase();
  let key: ChannelIconKey = "outreach";
  if (c.includes("craigslist") || c.includes("street")) key = "craigslist";
  else if (c.includes("rentahuman")) key = "rentahuman";
  else if (c.includes("creator") || c.includes("youtube") || c.includes("tiktok")) key = "creator";
  else if (c.includes("agency")) key = "agency";
  else if (c.includes("print") || c.includes("qr")) key = "print";
  else if (c.includes("bd") || c.includes("venue")) key = "bd";
  else if (c.includes("vip")) key = "vip";
  else if (c.includes("video")) key = "video";
  else if (c.includes("event")) key = "event";
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">${CHANNEL_ICONS[key]}</svg>`;
}

const NAV_ICONS: Readonly<Record<NavIconKey, string>> = {
  overview: `<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>`,
  campaigns: `<path d="M3 14V2.5h9l-2 3.5 2 3.5H3"/>`,
  agents: `<circle cx="8" cy="8" r="2.2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4"/>`,
  devices: `<rect x="4" y="1.5" width="8" height="13" rx="1.6"/><path d="M7 12h2"/>`,
  field: `<circle cx="6" cy="5" r="2.2"/><path d="M2 13.5c.6-2.3 2.1-3.5 4-3.5s3.4 1.2 4 3.5"/><circle cx="11.5" cy="6" r="1.6"/><path d="M11 10.2c1.4.2 2.5 1.2 3 3.3"/>`,
  bd: `<path d="M2.5 13.5V4l5.5-2 5.5 2v9.5M1.5 13.5h13M6 6.5h1M9 6.5h1M6 9.5h1M9 9.5h1"/>`,
  vip: `<path d="M8 2l1.6 3.6 3.9.4-2.9 2.6.9 3.9L8 10.5l-3.5 2 .9-3.9L2.5 6l3.9-.4Z"/>`,
  rails: `<path d="M8 1.8l5.5 2.2v4.3c0 3.1-2.2 5.2-5.5 6.1-3.3-.9-5.5-3-5.5-6.1V4Z"/><path d="M5.8 8.2l1.5 1.5 3-3"/>`,
  sun: `<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>`,
  moon: `<path d="M12.8 9.8A5.5 5.5 0 016.2 3.2 5.5 5.5 0 1012.8 9.8Z"/>`,
  refresh: `<path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v2.7h-2.7"/>`,
  plus: `<path d="M8 3v10M3 8h10"/>`,
  search: `<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>`,
  close: `<path d="M4 4l8 8M12 4l-8 8"/>`,
  external: `<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9v4.5H2.5V4H7"/>`,
  shield: `<path d="M8 1.8l5.5 2.2v4.3c0 3.1-2.2 5.2-5.5 6.1-3.3-.9-5.5-3-5.5-6.1V4Z"/>`,
  lock: `<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>`,
  zap: `<path d="M9 1.5L3.5 9h4.2L7 14.5 12.5 7H8.3Z"/>`,
  play: `<path d="M4.5 3l8 5-8 5Z" fill="currentColor" stroke="none"/>`,
  pause: `<path d="M5 3.5v9M11 3.5v9" stroke-width="2"/>`,
  menu: `<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>`,
  help: `<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 013.4.7c0 1.2-1.7 1.5-1.7 2.5"/><circle cx="8" cy="11.8" r="0.6" fill="currentColor" stroke="none"/>`,
};

export function navIconSvg(name: NavIconKey, size = 16): string {
  return `<svg width="${size}" height="${size}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">${NAV_ICONS[name]}</svg>`;
}

const STATUS_SHAPES: Readonly<Record<StatusTone, string>> = {
  neutral: "M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Z",
  ok: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2Z",
  warn: "M8 2 14.5 13.5h-13Z",
  destructive: "M3 3h10v10H3Z",
  primary: "M8 1.5 14.5 8 8 14.5 1.5 8Z",
};

export function resolveStatusTone(status: string): StatusTone {
  const s = status.toLowerCase();
  if (
    s === "ok" ||
    s === "active" ||
    s === "online" ||
    s === "verified" ||
    s === "paid" ||
    s === "ready" ||
    s === "live" ||
    s === "approved" ||
    s === "published" ||
    s === "audited" ||
    s === "onboarded" ||
    s === "delivered" ||
    s === "sent" ||
    s === "idle" ||
    s === "running" ||
    s === "steady_state"
  ) {
    return "ok";
  }
  if (
    s === "warn" ||
    s === "warning" ||
    s === "cooldown" ||
    s === "rate_limited" ||
    s === "charging_wait" ||
    s === "thermal_cooldown" ||
    s === "needs_takeover" ||
    s === "dry_run" ||
    s === "pending" ||
    s === "vesting" ||
    s === "quarantined" ||
    s === "disputed" ||
    s === "balanced" ||
    s === "blitz" ||
    s === "reconnecting" ||
    s === "leased"
  ) {
    return "warn";
  }
  if (
    s === "destructive" ||
    s === "lockdown" ||
    s === "paused_stop" ||
    s === "offline" ||
    s === "rejected" ||
    s === "killed" ||
    s === "blocked_stop" ||
    s === "blocked_policy" ||
    s === "failed" ||
    s === "cancelled" ||
    s === "banned" ||
    s === "stopped" ||
    s === "declined" ||
    s === "closed_lost"
  ) {
    return "destructive";
  }
  if (s === "primary" || s === "hired" || s === "contracted" || s === "measured") {
    return "primary";
  }
  return "neutral";
}

export function statusMarkSvg(
  status: string,
  label?: string,
  showLabel = false,
): string {
  const tone = resolveStatusTone(status);
  const text = label ?? status.replace(/_/g, " ");
  const ring = tone === "neutral";
  const a11y = showLabel
    ? `aria-hidden="true"`
    : `role="img" aria-label="${escHtml(text)}"`;
  const fill = ring ? "none" : "currentColor";
  const strokeWidth = ring ? "2" : "0";
  const svg = `<svg width="11" height="11" viewBox="0 0 16 16" class="smark-ico" ${a11y}><path d="${STATUS_SHAPES[tone]}" fill="${fill}" stroke="currentColor" stroke-width="${strokeWidth}"/></svg>`;
  return `<span class="smark smark-${tone}" title="${escHtml(text)}">${svg}${showLabel ? `<span class="smark-label">${escHtml(text)}</span>` : ""}</span>`;
}
