export function renderCommandCenterJs(): string {
  return String.raw`(function () {
  "use strict";

  const CITIES = ["nyc", "sf", "la", "chicago", "miami", "austin", "london"];
  const APPS = ["all", "ntwrk", "slop", "peon", "friends"];
  const RISK_DIALS = ["conservative", "balanced", "blitz", "lockdown"];
  const PROVIDERS = ["chatgpt", "claude", "gemini", "surplus"];
  const BD_STAGES = ["prospect", "enriched", "pitched", "negotiating", "contracted", "kit_shipped", "live", "audited"];
  const VIDEO_STAGES = ["trend", "script", "voice_render", "qa", "published", "measured", "killed"];
  const DISCOVERY_SOURCES = ["nyc_open_data", "nys_sla", "hn", "github", "arxiv", "reddit", "youtube_rss", "luma", "eventbrite"];

  const VIEWS = [
    { id: "overview", label: "Overview", icon: "overview", key: "1" },
    { id: "campaigns", label: "Campaigns", icon: "campaigns", key: "2" },
    { id: "agents", label: "Agents", icon: "agents", key: "3" },
    { id: "devices", label: "Devices", icon: "devices", key: "4" },
    { id: "field", label: "Field & Proofs", icon: "field", key: "5" },
    { id: "bd", label: "BD & QR", icon: "bd", key: "6" },
    { id: "vip", label: "VIP & Video", icon: "vip", key: "7" },
    { id: "rails", label: "Rails & Discovery", icon: "rails", key: "8" },
  ];

  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(v) {
    if (v === null || v === undefined) return "";
    return String(v).replace(/[&<>"']/g, function (c) { return ESC_MAP[c] || c; });
  }

  function safeUrl(v) {
    if (typeof v !== "string") return null;
    const t = v.trim();
    if (!t) return null;
    try {
      const u = new URL(t);
      return (u.protocol === "https:" || u.protocol === "http:") ? u.href : null;
    } catch {
      return null;
    }
  }

  function clamp(n, lo, hi) {
    const x = Number(n);
    if (!Number.isFinite(x)) return lo;
    return Math.max(lo, Math.min(hi, x));
  }

  function usd(cents) {
    const n = (Number(cents) || 0) / 100;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n >= 1000 ? 0 : 2, maximumFractionDigits: n >= 1000 ? 0 : 2 });
  }

  function usd2(cents) {
    const n = (Number(cents) || 0) / 100;
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function num(v) {
    return Math.max(0, Math.round(Number(v) || 0)).toLocaleString("en-US");
  }

  function human(s) {
    return String(s || "").replace(/_/g, " ");
  }

  function titleCase(s) {
    return human(s).replace(/\b\w/g, function (ch) { return ch.toUpperCase(); });
  }

  function truncLabel(s, maxLen) {
    const clean = String(s || "").trim();
    const limit = maxLen || 19;
    if (clean.length <= limit) return clean;
    return clean.slice(0, limit - 1).trimEnd() + "…";
  }

  const SHORT_TRACK = {
    street_fliering: "Street Fliering",
    creator_video: "Creator Video",
    street_interview_creators: "Creator Video",
    event_activation: "Event Activators",
    event_activators: "Event Activators",
    print_qr: "Print & QR",
    serialized_qr_print: "Print & QR",
    agency_reserve: "Agency Reserve",
    w2_agency_reserve: "Agency Reserve",
    bd_venues: "BD Venues",
    bd_venue: "BD Venues",
    vip_salons: "VIP Salons",
    vip_salon: "VIP Salons",
    video_factory: "Video Factory",
    organic_play: "Organic Loops",
  };

  function shortTrack(key, label) {
    const mapped = SHORT_TRACK[String(key || "").toLowerCase()];
    return mapped || truncLabel(label || key, 19);
  }

  function svgBar(pct, cls) {
    const w = clamp(pct, 0, 100).toFixed(1);
    return '<svg class="' + (cls || "bar-svg") + '" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" width="100" height="6" rx="3"/><rect class="bar-fill" width="' + w + '" height="6" rx="3"/></svg>';
  }

  function brandSvg(appId, size) {
    const sz = size || 20;
    const k = String(appId || "ntwrk").toLowerCase();
    const base = 'width="' + sz + '" height="' + sz + '" viewBox="0 0 64 64" class="brand-mark" aria-hidden="true"';
    if (k === "slop") {
      return '<svg ' + base + '><rect width="64" height="64" rx="15" fill="var(--brand-slop)"/><g fill="var(--brand-slop-fg)"><path d="M32 46C12 32 10 20 19 14c6-4 11 0 13 4 2-4 7-8 13-4 9 6 7 18-13 32Z"/><rect x="21" y="34" width="5" height="16" rx="2.5"/><rect x="38" y="34" width="5" height="12" rx="2.5"/><circle cx="23.5" cy="56" r="2.5"/></g></svg>';
    }
    if (k === "peon") {
      return '<svg ' + base + '><rect width="64" height="64" rx="15" fill="var(--brand-peon)"/><g fill="var(--brand-peon-fg)"><path d="M26 8h12l-3 9h-6Z"/><path d="M28.5 19h7l6 26-9.5 12L22.5 45Z"/></g></svg>';
    }
    if (k === "friends") {
      return '<svg ' + base + '><rect width="64" height="64" rx="15" fill="var(--background)" stroke="var(--border)" stroke-width="2"/><circle cx="24" cy="32" r="15" fill="var(--brand-friends)"/><circle cx="40" cy="32" r="15" fill="var(--foreground)"/><path d="M32 19.3a15 15 0 0 1 0 25.4 15 15 0 0 1 0-25.4Z" fill="var(--background)"/></svg>';
    }
    if (k === "eliza") {
      return '<svg ' + base + '><rect width="64" height="64" rx="15" fill="var(--brand-eliza)"/><path d="M18 20h22M18 32h18M18 44h24" fill="none" stroke="var(--brand-eliza-fg)" stroke-width="5" stroke-linecap="round"/><circle cx="46" cy="20" r="5" fill="var(--brand-eliza-fg)"/></svg>';
    }
    return '<svg ' + base + '><rect width="64" height="64" rx="15" fill="var(--brand-network)"/><path d="M12 44L24 22L38 34L52 14M38 34L46 52" fill="none" stroke="var(--brand-network-fg)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/><g fill="var(--brand-network-fg)"><circle cx="12" cy="44" r="5"/><circle cx="24" cy="22" r="6"/><circle cx="38" cy="34" r="7"/><circle cx="52" cy="14" r="5"/><circle cx="46" cy="52" r="5"/></g></svg>';
  }

  const PROV_PATH = {
    chatgpt: "M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z",
    claude: "M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z",
    gemini: "M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z",
    surplus: "M14.5 2.4A9.8 9.8 0 1021.6 14.5 7.4 7.4 0 0114.5 2.4ZM17.5 4.5a2 2 0 110 4 2 2 0 010-4Z",
  };

  function provSvg(p, sz) {
    const k = PROV_PATH[String(p || "").toLowerCase()] ? String(p).toLowerCase() : "surplus";
    return '<svg width="' + (sz || 14) + '" height="' + (sz || 14) + '" viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" class="provider-icon" aria-hidden="true"><path d="' + PROV_PATH[k] + '"/></svg>';
  }

  function devSvg(plat, sz) {
    const s = sz || 15;
    const p = String(plat || "").toLowerCase();
    const base = 'width="' + s + '" height="' + s + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true"';
    if (p === "macbook") return '<svg ' + base + '><rect x="2.5" y="3" width="11" height="7.5" rx="1.2"/><path d="M1 12.5h14"/></svg>';
    if (p === "ios") return '<svg ' + base + '><rect x="4" y="1.5" width="8" height="13" rx="1.8"/><path d="M6.8 3.4h2.4"/></svg>';
    return '<svg ' + base + '><rect x="4" y="1.5" width="8" height="13" rx="1.4"/><circle cx="8" cy="3.5" r="0.6" fill="currentColor" stroke="none"/></svg>';
  }

  const ICONS = {
    overview: '<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>',
    campaigns: '<path d="M3 14V2.5h9l-2 3.5 2 3.5H3"/>',
    agents: '<circle cx="8" cy="8" r="2.2"/><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.8 3.8l1.4 1.4M10.8 10.8l1.4 1.4M12.2 3.8l-1.4 1.4M5.2 10.8l-1.4 1.4"/>',
    devices: '<rect x="4" y="1.5" width="8" height="13" rx="1.6"/><path d="M7 12h2"/>',
    field: '<circle cx="6" cy="5" r="2.2"/><path d="M2 13.5c.6-2.3 2.1-3.5 4-3.5s3.4 1.2 4 3.5"/><circle cx="11.5" cy="6" r="1.6"/><path d="M11 10.2c1.4.2 2.5 1.2 3 3.3"/>',
    bd: '<path d="M2.5 13.5V4l5.5-2 5.5 2v9.5M1.5 13.5h13M6 6.5h1M9 6.5h1M6 9.5h1M9 9.5h1"/>',
    vip: '<path d="M8 2l1.6 3.6 3.9.4-2.9 2.6.9 3.9L8 10.5l-3.5 2 .9-3.9L2.5 6l3.9-.4Z"/>',
    rails: '<path d="M8 1.8l5.5 2.2v4.3c0 3.1-2.2 5.2-5.5 6.1-3.3-.9-5.5-3-5.5-6.1V4Z"/><path d="M5.8 8.2l1.5 1.5 3-3"/>',
    sun: '<circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1"/>',
    moon: '<path d="M12.8 9.8A5.5 5.5 0 016.2 3.2 5.5 5.5 0 1012.8 9.8Z"/>',
    refresh: '<path d="M13.5 8a5.5 5.5 0 11-1.6-3.9M13.5 2.5v2.7h-2.7"/>',
    plus: '<path d="M8 3v10M3 8h10"/>',
    search: '<circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5L14 14"/>',
    close: '<path d="M4 4l8 8M12 4l-8 8"/>',
    external: '<path d="M9.5 2.5h4v4M13.5 2.5L7.5 8.5M12 9v4.5H2.5V4H7"/>',
    lock: '<rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 015 0v2"/>',
    zap: '<path d="M9 1.5L3.5 9h4.2L7 14.5 12.5 7H8.3Z"/>',
    play: '<path d="M4.5 3l8 5-8 5Z" fill="currentColor" stroke="none"/>',
    pause: '<path d="M5 3.5v9M11 3.5v9" stroke-width="2"/>',
    menu: '<path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11"/>',
    help: '<circle cx="8" cy="8" r="6"/><path d="M6.3 6.3a1.8 1.8 0 013.4.7c0 1.2-1.7 1.5-1.7 2.5"/><circle cx="8" cy="11.8" r="0.6" fill="currentColor" stroke="none"/>',
  };

  function ico(name, sz) {
    return '<svg width="' + (sz || 15) + '" height="' + (sz || 15) + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="ico" aria-hidden="true">' + (ICONS[name] || "") + '</svg>';
  }

  const SHAPE = {
    neutral: "M8 3a5 5 0 1 1 0 10A5 5 0 0 1 8 3Z",
    ok: "M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2Z",
    warn: "M8 2 14.5 13.5h-13Z",
    destructive: "M3 3h10v10H3Z",
    primary: "M8 1.5 14.5 8 8 14.5 1.5 8Z",
  };

  function toneOf(s) {
    const k = String(s || "").toLowerCase();
    if (["ok", "active", "online", "verified", "paid", "ready", "live", "approved", "published", "audited", "onboarded", "delivered", "sent", "idle", "running", "steady_state", "true"].includes(k)) return "ok";
    if (["warn", "warning", "cooldown", "rate_limited", "charging_wait", "thermal_cooldown", "needs_takeover", "dry_run", "pending", "vesting", "quarantined", "disputed", "balanced", "blitz", "reconnecting", "leased"].includes(k)) return "warn";
    if (["destructive", "lockdown", "paused_stop", "offline", "rejected", "killed", "blocked_stop", "blocked_policy", "failed", "cancelled", "banned", "stopped", "declined", "closed_lost", "false"].includes(k)) return "destructive";
    if (["primary", "hired", "contracted", "measured"].includes(k)) return "primary";
    return "neutral";
  }

  function smark(status, label, showLabel) {
    const t = toneOf(status);
    const txt = label || human(status);
    const ring = t === "neutral";
    const a11y = showLabel ? 'aria-hidden="true"' : 'role="img" aria-label="' + esc(txt) + '"';
    return '<span class="smark smark-' + t + '" title="' + esc(txt) + '"><svg width="11" height="11" viewBox="0 0 16 16" ' + a11y + '><path d="' + SHAPE[t] + '" fill="' + (ring ? "none" : "currentColor") + '" stroke="currentColor" stroke-width="' + (ring ? "2" : "0") + '"/></svg>' + (showLabel ? '<span class="smark-label">' + esc(txt) + '</span>' : '') + '</span>';
  }

  function renderBudgetChart(budget, tracks) {
    const mCap = Math.max(1, Number(budget && budget.monthlyBudgetCents) || 1000000);
    const spent = Math.max(0, Number(budget && budget.spentCents) || 0);
    const res = Math.max(0, Number(budget && budget.reservedCents) || 0);
    const rem = Math.max(0, mCap - spent - res);
    const dCap = Math.max(1, Number(budget && budget.dailyCapCents) || 100000);
    const dSpent = Math.max(0, Number(budget && budget.dailySpentCents) || 0);
    const r = 48;
    const c = 2 * Math.PI * r;
    const sLen = clamp(spent / mCap, 0, 1) * c;
    const rLen = clamp(res / mCap, 0, Math.max(0, 1 - spent / mCap)) * c;
    const dRatio = clamp(dSpent / dCap, 0, 1);
    const dColor = dRatio >= 0.9 ? "var(--destructive)" : dRatio >= 0.7 ? "var(--warn)" : "var(--primary)";
    const list = (tracks && tracks.length) ? tracks : [
      { track: "creator_video", label: "Creator Video", capCents: 330000, spentCents: 0 },
      { track: "street_fliering", label: "Street Fliering", capCents: 320000, spentCents: 0 },
      { track: "event_activation", label: "Event Activators", capCents: 170000, spentCents: 0 },
      { track: "agency_reserve", label: "W-2 Agency Reserve", capCents: 100000, spentCents: 0 },
      { track: "print_qr", label: "Print & QR", capCents: 80000, spentCents: 0 },
    ];
    const colors = ["var(--primary)", "var(--ok)", "var(--info)", "var(--warn)", "var(--muted-foreground)"];
    const total = Math.max(1, list.reduce(function (a, b) { return a + (Number(b.capCents || b.amountCents) || 0); }, 0));
    let off = 0;
    const segs = list.map(function (t, i) {
      const cap = Number(t.capCents || t.amountCents) || 0;
      const w = (cap / total) * 100;
      const x = off;
      off += w;
      return '<rect x="' + x.toFixed(2) + '%" y="0" width="' + Math.max(0.4, w - 0.5).toFixed(2) + '%" height="10" rx="2" fill="' + colors[i % colors.length] + '"><title>' + esc(t.label) + ": " + usd(cap) + '</title></rect>';
    }).join("");
    const rows = list.map(function (t, i) {
      const cap = Math.max(1, Number(t.capCents || t.amountCents) || 1);
      const used = Math.max(0, Number(t.spentCents) || 0) + Math.max(0, Number(t.reservedCents) || 0);
      const pct = clamp((used / cap) * 100, 0, 100);
      const toneIdx = i % colors.length;
      const shortName = shortTrack(t.track, t.label);
      return '<div class="track-row" title="' + esc(t.label) + ": " + usd2(used) + " / " + usd(cap) + '"><span class="track-name"><svg width="8" height="8" viewBox="0 0 8 8" class="track-dot-svg tone-' + toneIdx + '" aria-hidden="true"><circle cx="4" cy="4" r="4"/></svg><span class="track-text">' + esc(shortName) + '</span></span><svg class="track-bar-svg" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect class="bar-track" width="100" height="6" rx="3"/><rect class="tone-' + toneIdx + '" width="' + pct.toFixed(1) + '" height="6" rx="3"/></svg><span class="track-val tnum">' + usd(used) + ' / ' + usd(cap) + '</span></div>';
    }).join("");
    return '<div class="budget-chart"><div class="budget-donut-wrap"><svg width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="Remaining budget ' + esc(usd(rem)) + ' of ' + esc(usd(mCap)) + '"><circle cx="64" cy="64" r="' + r + '" fill="none" stroke="var(--muted)" stroke-width="11"/>' +
      (sLen > 0.1 ? '<circle cx="64" cy="64" r="' + r + '" fill="none" stroke="var(--primary)" stroke-width="11" stroke-dasharray="' + sLen.toFixed(2) + ' ' + (c - sLen).toFixed(2) + '" transform="rotate(-90 64 64)"/>' : '') +
      (rLen > 0.1 ? '<circle cx="64" cy="64" r="' + r + '" fill="none" stroke="var(--warn)" stroke-width="11" stroke-dasharray="' + rLen.toFixed(2) + ' ' + (c - rLen).toFixed(2) + '" stroke-dashoffset="' + (-sLen).toFixed(2) + '" transform="rotate(-90 64 64)"/>' : '') +
      '<text x="64" y="61" text-anchor="middle" class="svg-kpi">' + esc(usd(rem)) + '</text><text x="64" y="77" text-anchor="middle" class="svg-sub">of ' + esc(usd(mCap)) + '</text></svg>' +
      '<div class="breaker-bar"><div class="breaker-head"><span>Daily cap</span><span class="tnum">' + usd(dSpent) + ' / ' + usd(dCap) + '</span></div><svg width="100%" height="12" viewBox="0 0 160 12" preserveAspectRatio="none" aria-hidden="true"><rect x="0" y="3" width="154" height="6" rx="3" fill="var(--muted)"/><rect x="0" y="3" width="' + (dRatio * 154).toFixed(1) + '" height="6" rx="3" fill="' + dColor + '"/><line x1="154" y1="1" x2="154" y2="11" stroke="var(--destructive)" stroke-width="2"/></svg></div></div>' +
      '<div class="budget-tracks-wrap"><svg width="100%" height="10" class="stacked-bar" role="img" aria-label="NYC budget track split">' + segs + '</svg><div class="track-list">' + rows + '</div></div></div>';
  }

  function renderFunnelChart(attr) {
    const fliers = (Number(attr && attr.videoViews) || 0) + (Number(attr && attr.siteVisits) || 0);
    const scans = Number(attr && attr.qrScans) || 0;
    const started = Number(attr && attr.signupsStarted) || 0;
    const verified = Number(attr && attr.verifiedAdultSignups) || 0;
    const stages = [
      { label: "Views & Visits", value: fliers, col: "var(--muted-foreground)" },
      { label: "QR Scans", value: scans, col: "var(--info)" },
      { label: "Signups Started", value: started, col: "var(--primary)" },
      { label: "Verified 18+", value: verified, col: "var(--ok)" },
    ];
    const mx = Math.max(1, fliers, scans, started, verified);
    const rows = stages.map(function (st, i) {
      const y = i * 32 + 6;
      const w = st.value > 0 ? Math.max(6, (st.value / mx) * 260) : 2;
      const prev = i > 0 ? stages[i - 1].value : 0;
      const conv = i > 0 && prev > 0 ? Math.round((st.value / prev) * 100) + "%" : "";
      return '<g transform="translate(0 ' + y + ')"><text x="0" y="15" class="svg-label">' + esc(st.label) + '</text><rect x="118" y="4" width="260" height="14" rx="4" fill="var(--muted)"/><rect x="118" y="4" width="' + w.toFixed(1) + '" height="14" rx="4" fill="' + st.col + '"><title>' + esc(st.label) + ": " + num(st.value) + '</title></rect><text x="438" y="15" text-anchor="end" class="svg-num">' + num(st.value) + '</text>' + (conv ? '<text x="484" y="15" text-anchor="end" class="svg-sub">' + conv + '</text>' : '') + '</g>';
    }).join("");
    const cpa = attr && attr.blendedCpaCents;
    const target = 858;
    const hist = (attr && Array.isArray(attr.cpaHistoryCents) && attr.cpaHistoryCents.length >= 2) ? attr.cpaHistoryCents : (cpa ? [target, cpa] : []);
    let spark = '<div class="cpa-empty"><span class="cpa-val-inline"><span>Blended CPA</span><strong class="tnum">' + (cpa !== null && cpa !== undefined ? usd2(cpa) : "—") + '</strong></span><span class="tnum muted">Target ' + usd2(target) + '</span></div>';
    if (hist.length >= 2) {
      const hi = Math.max(target * 1.4, Math.max.apply(null, hist));
      const lo = Math.min(0, Math.min.apply(null, hist));
      const sp = Math.max(1, hi - lo);
      const pts = hist.map(function (v, idx) {
        return { x: 6 + (idx / (hist.length - 1)) * 208, y: 38 - ((v - lo) / sp) * 30, v: v };
      });
      const ty = 38 - ((target - lo) / sp) * 30;
      const last = pts[pts.length - 1];
      const dot = last.v <= target ? "var(--ok)" : last.v <= target * 1.4 ? "var(--warn)" : "var(--destructive)";
      spark = '<div class="cpa-row"><div class="cpa-meta"><span class="svg-sub-txt">Blended CPA</span><strong class="tnum">' + usd2(last.v) + '</strong><span class="cpa-target tnum">target ' + usd2(target) + '</span></div><svg width="220" height="44" viewBox="0 0 220 44" role="img" aria-label="CPA trend ' + esc(usd2(last.v)) + '"><line x1="6" y1="' + ty.toFixed(1) + '" x2="214" y2="' + ty.toFixed(1) + '" stroke="var(--muted-foreground)" stroke-width="1" stroke-dasharray="3 3"/><polyline fill="none" stroke="var(--primary)" stroke-width="2" points="' + pts.map(function (p) { return p.x.toFixed(1) + "," + p.y.toFixed(1); }).join(" ") + '"/><circle cx="' + last.x.toFixed(1) + '" cy="' + last.y.toFixed(1) + '" r="3.5" fill="' + dot + '"/></svg></div>';
    }
    return '<div class="funnel-chart"><svg width="100%" height="136" viewBox="0 0 490 136" role="img" aria-label="Acquisition funnel">' + rows + '</svg>' + spark + '</div>';
  }

  function renderBanditChart(arms) {
    const list = (arms && arms.length ? arms.slice() : [
      { armKey: "creator_video", label: "Creator Video", weight: 0.33, status: "active", cpaCents: null },
      { armKey: "street_fliering", label: "Street Fliering", weight: 0.32, status: "active", cpaCents: null },
      { armKey: "event_activation", label: "Event Activators", weight: 0.17, status: "active", cpaCents: null },
      { armKey: "bd_venues", label: "BD Venues", weight: 0.10, status: "active", cpaCents: null },
      { armKey: "vip_salons", label: "VIP Salons", weight: 0.08, status: "active", cpaCents: null },
    ]).sort(function (a, b) { return (Number(b.weight) || 0) - (Number(a.weight) || 0); });
    const h = list.length * 30 + 10;
    const hasObs = list.some(function (a) { return Number(a.signups) > 0 || a.cpaCents; });
    const barStartX = 160;
    const barMaxW = 250;
    const rows = list.map(function (a, i) {
      const y = i * 30 + 5;
      const pct = clamp((Number(a.weight) || 0) * 100, 0, 100);
      const w = Math.max(2, (pct / 100) * barMaxW);
      const col = a.status === "killed" ? "var(--destructive)" : a.status === "paused" ? "var(--warn)" : (i < 2 && pct >= 20 ? "var(--ok)" : "var(--primary)");
      const cpa = a.cpaCents ? usd2(a.cpaCents) : "—";
      const glyph = a.status === "killed" ? "✕" : pct >= 25 ? "↗" : pct < 12 ? "↘" : "—";
      const lbl = shortTrack(a.track || a.armKey, a.label || a.armKey);
      return '<g transform="translate(0 ' + y + ')"><text x="0" y="15" class="svg-label"><title>' + esc(a.label || a.armKey) + '</title>' + esc(lbl) + '</text><rect x="' + barStartX + '" y="5" width="' + barMaxW + '" height="12" rx="3" fill="var(--muted)"/><rect x="' + barStartX + '" y="5" width="' + w.toFixed(1) + '" height="12" rx="3" fill="' + col + '" opacity="' + (a.status === "killed" ? "0.45" : "1") + '"><title>' + esc(a.label || a.armKey) + ": " + pct.toFixed(1) + "% (" + esc(a.status) + ')</title></rect><text x="458" y="15" text-anchor="end" class="svg-num">' + pct.toFixed(0) + '%</text><text x="484" y="15" text-anchor="middle" class="svg-sub">' + glyph + '</text><text x="554" y="15" text-anchor="end" class="svg-sub">' + esc(cpa) + '</text></g>';
    }).join("");
    return '<div class="bandit-chart"><svg class="chart-svg-full" viewBox="0 0 560 ' + h + '" role="img" aria-label="Bandit arm allocation weights">' + rows + '</svg>' + (!hasObs ? '<div class="chart-foot">Uniform prior · updates on verified 18+ signups</div>' : '') + '</div>';
  }

  function renderDeviceGauges(d) {
    const batt = clamp(d.batteryPct, 0, 100);
    const temp = clamp(d.tempC, 0, 55);
    const battOk = batt >= 35 && batt <= 80;
    const bCol = battOk ? "var(--ok)" : "var(--destructive)";
    const tCol = temp > 41 ? "var(--destructive)" : temp >= 38 ? "var(--warn)" : "var(--ok)";
    const day = Math.max(0, Math.round(Number(d.warmupDay) || 0));
    const tiers = [1, 4, 8, 15, 31];
    const segs = tiers.map(function (minD, i) {
      return '<rect x="' + (i * 31) + '" y="3" width="27" height="6" rx="2" fill="' + (day >= minD ? "var(--primary)" : "var(--muted)") + '"/>';
    }).join("");
    const bCls = battOk ? "val-ok" : "val-destructive";
    const tCls = temp > 41 ? "val-destructive" : temp >= 38 ? "val-warn" : "val-ok";
    const q = Number(d.dailyActionCap) > 0 ? (Number(d.dailyActionsUsed) || 0) + "/" + d.dailyActionCap : "passive";
    return '<div class="dev-gauges">' +
      '<div class="gauge-row"><span class="gauge-k">Battery</span><svg width="150" height="16" viewBox="0 0 150 16" aria-hidden="true"><rect x="0" y="5" width="150" height="6" rx="3" fill="var(--muted)"/><rect x="52.5" y="5" width="67.5" height="6" rx="2" fill="var(--ok)" opacity="0.28"/><line x1="52.5" y1="3" x2="52.5" y2="13" stroke="var(--ok)" stroke-width="1"/><line x1="120" y1="3" x2="120" y2="13" stroke="var(--ok)" stroke-width="1"/><rect x="' + clamp((batt / 100) * 150 - 2.5, 0, 145).toFixed(1) + '" y="2" width="5" height="12" rx="2" fill="' + bCol + '"/></svg><span class="gauge-v tnum ' + bCls + '">' + batt.toFixed(0) + '%</span></div>' +
      '<div class="gauge-row"><span class="gauge-k">Thermal</span><svg width="150" height="16" viewBox="0 0 150 16" aria-hidden="true"><rect x="0" y="5" width="150" height="6" rx="3" fill="var(--muted)"/><rect x="0" y="5" width="' + ((temp / 55) * 150).toFixed(1) + '" height="6" rx="3" fill="' + tCol + '"/><line x1="111.8" y1="2" x2="111.8" y2="14" stroke="var(--destructive)" stroke-width="1.5"/></svg><span class="gauge-v tnum ' + tCls + '">' + temp.toFixed(1) + '°C</span></div>' +
      '<div class="gauge-row"><span class="gauge-k">Warm-up</span><svg width="150" height="12" viewBox="0 0 152 12" aria-hidden="true">' + segs + '</svg><span class="gauge-v tnum">D' + day + ' · ' + esc(q) + '</span></div></div>';
  }

  const hashParams = new URLSearchParams(location.hash.replace(/^#/, ""));
  const hashToken = hashParams.get("token");
  if (hashToken) {
    sessionStorage.setItem("marketing_token", hashToken);
    history.replaceState(null, "", location.pathname + location.search);
  }

  const savedTheme = localStorage.getItem("marketing_theme");
  if (savedTheme === "dark" || savedTheme === "light") {
    document.documentElement.dataset.theme = savedTheme;
  }

  const state = {
    token: sessionStorage.getItem("marketing_token") || "",
    authError: "",
    view: "overview",
    subtab: { field: "tasks", bd: "pipeline", vip: "salons", rails: "adapters" },
    selectedCampaignId: "",
    cityFilter: "all",
    search: "",
    mobileNavOpen: false,
    sseStatus: "connecting",
    daemon: { enabled: false, intervalMs: 60000, lastTickAt: null },
    overview: null,
    campaigns: [],
    agents: [],
    devices: [],
    diagnostics: null,
    humans: [],
    tasks: [],
    proofs: [],
    outreach: [],
    adapters: [],
    liveBillingEnabled: false,
    slopCash: { enabled: false, hooks: [] },
    directory: { agencies: [], platforms: [], printers: [], tracks: [] },
    banditArms: [],
    bdDeals: [],
    qrBatches: [],
    vipProspects: [],
    videoAssets: [],
    antifraudClaims: [],
    discoveredLeads: [],
    selectedDiscoverySources: DISCOVERY_SOURCES.slice(),
    drawer: null,
    modal: null,
    toasts: [],
  };

  let sseAbort = null;
  let pollTimer = null;
  let sseRetryMs = 1500;
  let toastSeq = 0;

  function toast(text, tone) {
    const id = String(++toastSeq);
    state.toasts.push({ id: id, text: text, tone: tone || "ok" });
    if (state.toasts.length > 4) state.toasts.shift();
    renderToasts();
    setTimeout(function () {
      state.toasts = state.toasts.filter(function (t) { return t.id !== id; });
      renderToasts();
    }, 4000);
  }

  function hdrs() {
    return { Authorization: "Bearer " + state.token, "Content-Type": "application/json" };
  }

  async function api(method, path, body, optional) {
    const res = await fetch(path, {
      method: method,
      headers: hdrs(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      state.authError = "Token rejected (401).";
      state.token = "";
      sessionStorage.removeItem("marketing_token");
      stopStreams();
      render();
      return { ok: false, status: 401, data: null };
    }
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok && !optional) {
      toast((data && data.error) ? data.error : ("Request failed (" + res.status + ")"), "destructive");
    }
    return { ok: res.ok, status: res.status, data: data };
  }

  async function optGet(path) {
    try {
      const r = await api("GET", path, undefined, true);
      return r.ok ? r.data : null;
    } catch {
      return null;
    }
  }

  async function refreshAll() {
    if (!state.token) { render(); return; }
    const qCamp = state.selectedCampaignId ? ("?campaignId=" + encodeURIComponent(state.selectedCampaignId)) : "";
    const [ov, camp, ag, dev, hum, tsk, prf, out, ad, sc, dir, ban, bdd, qrb, vip, vid, af, dmn] = await Promise.all([
      api("GET", "/api/overview" + qCamp, undefined, true),
      optGet("/api/campaigns"),
      optGet("/api/agents"),
      optGet("/api/devices"),
      optGet("/api/humans"),
      optGet("/api/tasks" + qCamp),
      optGet("/api/proofs"),
      optGet("/api/outreach" + qCamp),
      optGet("/api/adapters"),
      optGet("/api/slop-cash/status"),
      optGet("/api/directory"),
      optGet("/api/bandit" + qCamp),
      optGet("/api/bd" + qCamp),
      optGet("/api/qr-batches" + qCamp),
      optGet("/api/vips" + qCamp),
      optGet("/api/videos" + qCamp),
      optGet("/api/antifraud" + qCamp),
      optGet("/api/daemon/status"),
    ]);
    if (!ov.ok) return;
    state.overview = ov.data;
    if (camp && camp.campaigns) state.campaigns = camp.campaigns;
    if (!state.selectedCampaignId && state.campaigns.length > 0) {
      state.selectedCampaignId = state.campaigns[0].id;
    }
    if (ag && ag.agents) state.agents = ag.agents;
    if (dev && dev.devices) state.devices = dev.devices;
    if (hum && hum.humans) state.humans = hum.humans;
    if (tsk && tsk.tasks) state.tasks = tsk.tasks;
    if (prf && prf.proofs) state.proofs = prf.proofs;
    if (out && out.messages) state.outreach = out.messages;
    if (ad) {
      state.adapters = ad.adapters || [];
      state.liveBillingEnabled = Boolean(ad.liveBillingEnabled);
    }
    if (sc) state.slopCash = sc;
    if (dir) state.directory = dir;
    if (ban && ban.arms) state.banditArms = ban.arms;
    else if (ov.data && ov.data.banditArms) state.banditArms = ov.data.banditArms;
    if (bdd && bdd.deals) state.bdDeals = bdd.deals;
    if (qrb && qrb.batches) state.qrBatches = qrb.batches;
    if (vip && vip.prospects) state.vipProspects = vip.prospects;
    if (vid && vid.assets) state.videoAssets = vid.assets;
    if (af && af.claims) state.antifraudClaims = af.claims;
    if (dmn) state.daemon = dmn;
    render();
  }

  function stopStreams() {
    if (sseAbort) { sseAbort.abort(); sseAbort = null; }
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function startPollingFallback() {
    state.sseStatus = "polling";
    renderTopStatus();
    if (pollTimer) return;
    pollTimer = setInterval(function () { void refreshAll(); }, 15000);
  }

  async function startSse() {
    stopStreams();
    if (!state.token) return;
    state.sseStatus = "connecting";
    renderTopStatus();
    sseAbort = new AbortController();
    try {
      const res = await fetch("/api/events", {
        headers: { Authorization: "Bearer " + state.token, Accept: "text/event-stream" },
        signal: sseAbort.signal,
      });
      if (res.status === 404 || !res.ok || !res.body) {
        startPollingFallback();
        return;
      }
      state.sseStatus = "live";
      sseRetryMs = 1500;
      renderTopStatus();
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buf += decoder.decode(chunk.value, { stream: true });
        if (buf.includes("\n\n")) {
          const frames = buf.split("\n\n");
          buf = frames.pop() || "";
          if (frames.some(function (f) { return f.includes("data:"); })) {
            void refreshAll();
          }
        }
      }
      throw new Error("stream_ended");
    } catch (err) {
      if (err && err.name === "AbortError") return;
      state.sseStatus = "reconnecting";
      renderTopStatus();
      const wait = sseRetryMs;
      sseRetryMs = Math.min(20000, sseRetryMs * 1.8);
      setTimeout(function () { if (state.token) void startSse(); }, wait);
    }
  }

  function activeCampaign() {
    return state.campaigns.find(function (c) { return c.id === state.selectedCampaignId; }) || state.campaigns[0] || null;
  }

  function renderTopStatus() {
    const el = document.getElementById("sse-slot");
    if (!el) return;
    const map = {
      live: smark("ok", "Live", true),
      reconnecting: smark("warn", "Reconnecting", true),
      connecting: smark("neutral", "Connecting", true),
      polling: smark("primary", "Polling", true),
    };
    el.innerHTML = map[state.sseStatus] || smark("neutral", "Offline", true);
  }

  function renderToasts() {
    const host = document.getElementById("toast-host");
    if (!host) return;
    host.innerHTML = state.toasts.map(function (t) {
      return '<div class="toast" role="status">' + smark(t.tone, t.tone, false) + '<span>' + esc(t.text) + '</span></div>';
    }).join("");
  }

  function isDark() {
    const explicit = document.documentElement.dataset.theme;
    if (explicit) return explicit === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  }

  function matchSearch(parts) {
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return parts.join(" ").toLowerCase().includes(q);
  }

  function renderAlerts() {
    const alerts = [];
    const camp = activeCampaign();
    if (camp && camp.riskDial === "lockdown") {
      alerts.push({ tone: "destructive", msg: "LOCKDOWN active on " + camp.name + " — Tier 3 & Tier 4 spend halted." });
    }
    const takeovers = state.devices.filter(function (d) { return d.status === "needs_takeover"; });
    if (takeovers.length) {
      alerts.push({ tone: "warn", msg: takeovers.length + " device(s) waiting for manual CAPTCHA/2FA takeover: " + takeovers.map(function (d) { return d.label; }).join(", ") });
    }
    const hot = state.devices.filter(function (d) { return Number(d.tempC) > 41 || Number(d.batteryPct) < 35 || Number(d.batteryPct) > 80; });
    if (hot.length) {
      alerts.push({ tone: "destructive", msg: hot.length + " device(s) outside 35–80% / ≤41°C envelope." });
    }
    const quar = state.antifraudClaims.filter(function (c) { return c.status === "quarantined"; });
    if (quar.length) {
      alerts.push({ tone: "warn", msg: quar.length + " anti-fraud claim(s) quarantined for review." });
    }
    return alerts.map(function (a) {
      return '<div class="alert-strip ' + (a.tone === "warn" ? "warn" : "") + '">' + smark(a.tone, a.tone, false) + '<span>' + esc(a.msg) + '</span></div>';
    }).join("");
  }

  function renderOverview() {
    const ov = state.overview;
    if (!ov) return '<div class="empty-inline">Loading telemetry...</div>';
    const b = ov.budget || {};
    const attr = ov.attribution || {};
    const prf = ov.proofs || {};
    const camp = ov.campaigns || {};
    const remTone = (b.remainingMonthlyCents || 0) < (b.monthlyBudgetCents || 1) * 0.15 ? "tone-warn" : "";
    const proofTone = (prf.pending || 0) > 0 ? "tone-warn" : "";
    return '<div class="view-head"><h1 class="view-title">Overview</h1><div class="view-actions">' +
      '<button class="btn btn-primary" data-action="seed-nyc">' + ico("zap", 14) + ' Seed NYC $10k</button>' +
      '<button class="btn" data-action="autopilot-tick">' + ico("play", 14) + ' Autopilot Tick</button>' +
      '<button class="btn" data-action="scan-devices">' + ico("devices", 14) + ' Scan Phones</button>' +
      '<button class="btn" data-action="refresh">' + ico("refresh", 14) + ' Refresh</button>' +
      '</div></div>' +
      renderAlerts() +
      '<div class="kpi-grid">' +
        '<button class="kpi-tile" data-nav="campaigns" title="Remaining monthly budget across active campaigns"><span class="kpi-val tnum ' + remTone + '">' + esc(usd(b.remainingMonthlyCents)) + '</span><span class="kpi-lbl">Budget remaining</span></button>' +
        '<button class="kpi-tile" data-nav="campaigns" title="Active campaigns">' + '<span class="kpi-val tnum">' + num(camp.active) + '</span><span class="kpi-lbl">Active campaigns</span></button>' +
        '<button class="kpi-tile" data-nav="field" title="Verified 18+ adult signups attributed"><span class="kpi-val tnum tone-ok">' + num(attr.verifiedAdultSignups) + '</span><span class="kpi-lbl">Verified 18+ signups</span></button>' +
        '<button class="kpi-tile" data-nav="field" title="Proof submissions waiting verification"><span class="kpi-val tnum ' + proofTone + '">' + num(prf.pending) + '</span><span class="kpi-lbl">Pending proofs</span></button>' +
      '</div>' +
      '<div class="panel-grid">' +
        '<section class="panel"><div class="panel-head"><h2 class="panel-title">Budget & NYC Tracks</h2><span class="tnum muted">' + usd2(b.spentCents) + ' spent</span></div>' + renderBudgetChart(b, state.directory.tracks) + '</section>' +
        '<section class="panel"><div class="panel-head"><h2 class="panel-title">Acquisition Funnel</h2><span class="tnum muted">' + num(attr.qrScans) + ' scans</span></div>' + renderFunnelChart(attr) + '</section>' +
      '</div>' +
      '<div class="panel-grid">' +
        '<section class="panel"><div class="panel-head"><h2 class="panel-title">Bandit Allocation</h2><button class="btn btn-sm" data-action="bandit-rebalance">Rebalance</button></div>' + renderBanditChart(state.banditArms) + '</section>' +
        '<section class="panel"><div class="panel-head"><h2 class="panel-title">Fleet & Hardware</h2><button class="btn btn-sm" data-nav="devices">Inspect</button></div>' +
          '<div class="meta-row"><span>Agents healthy</span><span class="tnum">' + num(ov.agents && ov.agents.healthy) + ' / ' + num(ov.agents && ov.agents.total) + '</span></div>' +
          '<div class="meta-row"><span>Turns today</span><span class="tnum">' + num(ov.agents && ov.agents.turnsUsedToday) + ' / ' + num(ov.agents && ov.agents.dailyTurnCapTotal) + '</span></div>' +
          '<div class="meta-row"><span>Devices online</span><span class="tnum">' + num(ov.devices && ov.devices.online) + ' / ' + num(ov.devices && ov.devices.total) + '</span></div>' +
          '<div class="meta-row"><span>Humans stopped</span><span class="tnum">' + num(ov.humans && ov.humans.stopped) + '</span></div>' +
          '<div class="meta-row"><span>slop.cash rail</span>' + smark(state.slopCash && state.slopCash.enabled ? "ok" : "destructive", state.slopCash && state.slopCash.enabled ? "Enabled" : "Locked off", true) + '</div>' +
        '</section>' +
      '</div>';
  }

  function renderCampaigns() {
    const rows = state.campaigns.filter(function (c) {
      if (state.cityFilter !== "all" && c.city !== state.cityFilter) return false;
      return matchSearch([c.name, c.slug, c.city, c.appId, c.riskDial]);
    });
    const cityOpts = ["all"].concat(CITIES).map(function (c) {
      return '<option value="' + c + '"' + (state.cityFilter === c ? " selected" : "") + '>' + (c === "all" ? "All cities" : c.toUpperCase()) + '</option>';
    }).join("");
    return '<div class="view-head"><h1 class="view-title">Campaigns & Bandit</h1><div class="view-actions">' +
      '<select class="ctrl-select" data-filter="city" aria-label="Filter city">' + cityOpts + '</select>' +
      '<button class="btn" data-action="toggle-daemon">' + ico(state.daemon.enabled ? "pause" : "play", 14) + (state.daemon.enabled ? " Stop Daemon" : " Start Daemon") + '</button>' +
      '<button class="btn" data-action="bandit-rebalance">' + ico("zap", 14) + ' Rebalance Bandit</button>' +
      '<button class="btn btn-primary" data-open-drawer="new-campaign">' + ico("plus", 14) + ' New Campaign</button>' +
      '</div></div>' +
      '<section class="panel"><div class="table-wrap"><table class="dt"><thead><tr><th>Campaign</th><th class="col-city">City</th><th>RiskDial</th><th>Billing</th><th class="num">Spent / Cap</th><th class="num">Daily</th><th>Status</th></tr></thead><tbody>' +
      (rows.length ? rows.map(function (c) {
        const pct = clamp(((Number(c.spentCents) + Number(c.reservedCents)) / Math.max(1, Number(c.monthlyBudgetCents))) * 100, 0, 100);
        return '<tr class="row-click" data-select-campaign="' + esc(c.id) + '">' +
          '<td><span class="cell-flex">' + brandSvg(c.appId, 18) + '<strong>' + esc(c.name) + '</strong></span></td>' +
          '<td class="mono col-city">' + esc(String(c.city || "").toUpperCase()) + '</td>' +
          '<td>' + smark(c.riskDial, c.riskDial, true) + '</td>' +
          '<td>' + smark(c.billingArmed ? "warn" : "neutral", c.billingArmed ? "Armed" : "Disarmed", true) + '</td>' +
          '<td class="num">' + svgBar(pct) + ' ' + usd(c.spentCents) + ' / ' + usd(c.monthlyBudgetCents) + '</td>' +
          '<td class="num">' + usd(c.dailySpentCents) + ' / ' + usd(c.dailyCapCents) + '</td>' +
          '<td>' + smark(c.status, c.status, true) + '</td></tr>';
      }).join("") : '<tr><td colspan="7" class="empty-inline">No campaigns match.</td></tr>') +
      '</tbody></table></div></section>' +
      '<section class="panel"><div class="panel-head"><h2 class="panel-title">Thompson-Sampling Bandit Arms</h2><span class="muted tnum">' + state.banditArms.length + ' arms</span></div>' + renderBanditChart(state.banditArms) + '</section>';
  }

  function renderAgents() {
    const list = state.agents.filter(function (a) { return matchSearch([a.displayName, a.personaId, a.appId, a.provider, a.status]); });
    return '<div class="view-head"><h1 class="view-title">Agents</h1><div class="view-actions">' +
      '<button class="btn btn-primary" data-open-drawer="new-agent">' + ico("plus", 14) + ' Register Agent</button>' +
      '</div></div>' +
      (list.length ? '<div class="agent-card-grid">' + list.map(function (a) {
        const cap = Math.max(1, Number(a.dailyTurnCap) || 60);
        const pct = clamp(((Number(a.turnsUsedToday) || 0) / cap) * 100, 0, 100);
        const paused = a.status === "paused_stop";
        const agentBrand = a.personaId === "chadwick" ? "slop" : a.appId;
        const provOpts = PROVIDERS.map(function (p) {
          return '<option value="' + p + '"' + (a.provider === p ? " selected" : "") + '>' + p + '</option>';
        }).join("");
        return '<article class="panel">' +
          '<div class="panel-head"><span class="cell-flex">' + brandSvg(agentBrand, 24) + '<strong>' + esc(a.displayName) + '</strong></span>' + smark(a.status, human(a.status), true) + '</div>' +
          '<div class="meta-row"><span class="cell-flex">' + provSvg(a.provider, 15) + '<span>' + esc(a.provider) + (a.failoverProvider ? ' → ' + esc(a.failoverProvider) : '') + '</span></span>' + smark(a.sessionHealthy ? "ok" : "destructive", a.sessionHealthy ? "Session healthy" : "Unhealthy", true) + '</div>' +
          '<div class="meta-row"><span class="muted">Turns today</span><span class="tnum">' + svgBar(pct) + ' ' + num(a.turnsUsedToday) + ' / ' + num(cap) + '</span></div>' +
          '<div class="card-foot">' +
            '<select class="ctrl-select ctrl-select-sm" data-agent-provider="' + esc(a.id) + '" aria-label="Provider for ' + esc(a.displayName) + '">' + provOpts + '</select>' +
            '<div class="view-actions">' +
              '<button class="btn btn-sm" data-open-drawer="agent-tick" data-id="' + esc(a.id) + '">' + ico("play", 12) + ' Tick</button>' +
              '<button class="btn btn-sm" data-action="' + (paused ? "agent-resume" : "agent-pause") + '" data-id="' + esc(a.id) + '">' + (paused ? "Resume" : "Pause") + '</button>' +
            '</div></div></article>';
      }).join("") + '</div>' : '<section class="panel"><div class="empty-inline">No agents seeded yet. Click Seed NYC $10k on Overview.</div></section>');
  }

  function renderDevices() {
    const list = state.devices.filter(function (d) { return matchSearch([d.label, d.platform, d.serialOrUdid, d.assignedPersona, d.status]); });
    const diag = state.diagnostics;
    const diagPanel = diag ? '<section class="panel"><div class="panel-head"><h2 class="panel-title">Host Tooling Diagnostics</h2></div><div class="meta-row">' +
      ['adb', 'scrcpy', 'xcrun', 'pymobiledevice3', 'wda'].map(function (tool) {
        const ok = Boolean((diag.tools && diag.tools[tool]) || (tool === "wda" && diag.wdaReachable));
        return '<span class="cell-flex">' + smark(ok ? "ok" : "neutral", tool + (ok ? " ready" : " missing"), true) + '</span>';
      }).join("") + '</div></section>' : '';
    return '<div class="view-head"><h1 class="view-title">Devices</h1><div class="view-actions">' +
      '<button class="btn" data-action="scan-devices">' + ico("refresh", 14) + ' Scan USB / WDA</button>' +
      '<button class="btn btn-primary" data-open-drawer="new-device">' + ico("plus", 14) + ' Register Device</button>' +
      '</div></div>' + diagPanel +
      (list.length ? '<div class="device-card-grid">' + list.map(function (d) {
        const carrier = d.simCarrier || d.hostMachine || "";
        return '<article class="panel">' +
          '<div class="panel-head"><span class="cell-flex">' + devSvg(d.platform, 18) + '<strong>' + esc(d.label) + '</strong></span>' + smark(d.status, human(d.status), true) + '</div>' +
          '<div class="meta-row"><span class="mono muted">' + esc(d.serialOrUdid) + '</span><span class="muted">' + esc(d.assignedPersona || "unassigned") + '</span></div>' +
          renderDeviceGauges(d) +
          '<div class="card-foot card-foot-inline"><span class="muted trunc-meta" title="' + esc(carrier) + '">' + esc(carrier) + '</span>' +
            '<button class="btn btn-sm" data-open-drawer="device-action" data-id="' + esc(d.id) + '">' + ico("zap", 12) + ' Test Action</button></div></article>';
      }).join("") + '</div>' : '<section class="panel"><div class="empty-inline">No local devices registered yet.</div></section>');
  }

  function renderField() {
    const tab = state.subtab.field || "tasks";
    const subtabs = [
      ["tasks", "Tasks (" + state.tasks.length + ")"],
      ["proofs", "Proofs (" + state.proofs.length + ")"],
      ["humans", "Humans (" + state.humans.length + ")"],
      ["directory", "NYC Directory"],
      ["antifraud", "Anti-Fraud (" + state.antifraudClaims.length + ")"],
    ].map(function (pair) {
      return '<button class="subtab-btn" role="tab" aria-selected="' + (tab === pair[0]) + '" data-subtab="field:' + pair[0] + '">' + esc(pair[1]) + '</button>';
    }).join("");

    let body = "";
    if (tab === "tasks") {
      const rows = state.tasks.filter(function (t) { return matchSearch([t.title, t.taskKind, t.vendorChannel, t.qrBatchCode, t.status]); });
      body = '<div class="table-wrap"><table class="dt"><thead><tr><th>Task</th><th>Channel</th><th>QR Batch</th><th class="num">Amount</th><th>Proof</th><th>Status</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (t) {
          return '<tr class="row-click" data-open-drawer="task-detail" data-id="' + esc(t.id) + '">' +
            '<td><strong>' + esc(t.title) + '</strong><div class="muted">' + esc(human(t.taskKind)) + ' · T' + esc(t.tier) + '</div></td>' +
            '<td>' + esc(human(t.vendorChannel)) + '</td>' +
            '<td class="mono">' + esc(t.qrBatchCode || "—") + '</td>' +
            '<td class="num">' + usd2(t.amountCents) + '</td>' +
            '<td>' + smark(t.proofVerified ? "ok" : "neutral", t.proofVerified ? "Verified" : "Pending", true) + '</td>' +
            '<td>' + smark(t.status, human(t.status), true) + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty-inline">No tasks yet.</td></tr>') + '</tbody></table></div>';
    } else if (tab === "proofs") {
      const rows = state.proofs.filter(function (p) { return matchSearch([p.taskId, p.proofKind, p.evidenceUrl, p.verdict]); });
      body = '<div class="table-wrap"><table class="dt"><thead><tr><th>Proof</th><th>Evidence Link</th><th>Checks (FTC / Geo / Release)</th><th class="num">Scans / 18+</th><th>Verdict</th><th>Action</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (p) {
          const href = safeUrl(p.evidenceUrl);
          const link = href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + ico("external", 12) + ' Open proof</a>' : '<span class="muted">No URL</span>';
          return '<tr><td><strong>' + esc(human(p.proofKind)) + '</strong><div class="mono muted">' + esc(p.taskId) + '</div></td>' +
            '<td>' + link + '</td>' +
            '<td><span class="checks-inline">' + smark(p.ftcDisclosed ? "ok" : "destructive", "FTC #Ad", true) + smark(p.geoTimeValid ? "ok" : "destructive", "Geo", true) + smark(p.likenessReleaseOk ? "ok" : "warn", "Release", true) + '</span></td>' +
            '<td class="num">' + num(p.qrScansCount) + ' / ' + num(p.verifiedSignupsCount) + '</td>' +
            '<td>' + smark(p.verdict, p.verdict, true) + '</td>' +
            '<td><div class="view-actions"><button class="btn btn-sm" data-action="proof-approve" data-id="' + esc(p.id) + '">Approve</button><button class="btn btn-sm" data-action="proof-reject" data-id="' + esc(p.id) + '">Reject</button></div></td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty-inline">No proof submissions yet.</td></tr>') + '</tbody></table></div>';
    } else if (tab === "humans") {
      const rows = state.humans.filter(function (h) { return matchSearch([h.displayLabel, h.role, h.channel, h.city]); });
      body = '<div class="table-wrap"><table class="dt"><thead><tr><th>Human / Agency</th><th>Role</th><th>Channel</th><th class="num">Age Floor</th><th>STOP Fence</th><th>Action</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (h) {
          return '<tr><td><strong>' + esc(h.displayLabel) + '</strong></td>' +
            '<td>' + esc(human(h.role)) + '</td>' +
            '<td>' + esc(h.channel) + '</td>' +
            '<td class="num">' + (h.lowestAge !== null && h.lowestAge !== undefined ? esc(h.lowestAge) + "+" : "—") + '</td>' +
            '<td>' + smark(h.stopped || h.banned ? "destructive" : "ok", h.stopped ? "STOPPED" : h.banned ? "BANNED" : "Active", true) + '</td>' +
            '<td>' + (!h.stopped ? '<button class="btn btn-sm btn-danger" data-action="human-stop" data-id="' + esc(h.id) + '">STOP</button>' : '<span class="muted">Blocked</span>') + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty-inline">No humans registered yet.</td></tr>') + '</tbody></table></div>';
    } else if (tab === "directory") {
      const agencies = state.directory.agencies || [];
      const platforms = state.directory.platforms || [];
      const printers = state.directory.printers || [];
      body = '<div class="panel-grid"><div><h3 class="panel-title">Vetted NYC Agencies (' + agencies.length + ')</h3><div class="table-wrap"><table class="dt"><thead><tr><th>Agency</th><th>Rate</th><th>Readiness</th></tr></thead><tbody>' +
        (agencies.length ? agencies.map(function (a) {
          const href = safeUrl(a.website);
          return '<tr><td>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(a.name) + '</a>' : esc(a.name)) + '<div class="muted">' + esc(a.contactEmailOrIntake) + '</div></td><td>' + esc(a.typicalClientRateSummary) + '</td><td>' + esc(human(a.zeroTouchBookingReadiness)) + '</td></tr>';
        }).join("") : '<tr><td colspan="3" class="empty-inline">Directory endpoint not connected.</td></tr>') + '</tbody></table></div></div>' +
        '<div><h3 class="panel-title">Platforms & Local Printers (' + (platforms.length + printers.length) + ')</h3><div class="table-wrap"><table class="dt"><thead><tr><th>Vendor</th><th>Pricing / 5k Cost</th><th>Priority</th></tr></thead><tbody>' +
        platforms.map(function (p) { return '<tr><td><strong>' + esc(p.name) + '</strong></td><td>' + esc(p.typicalNycRate) + '</td><td>' + esc(human(p.month1Priority)) + '</td></tr>'; }).join("") +
        printers.map(function (p) { return '<tr><td><strong>' + esc(p.name) + '</strong><div class="muted">' + esc(p.pickupLocation) + '</div></td><td>' + esc(p.cost5k4x6PostcardsUsd) + '</td><td>' + (p.sameDayAvailable ? "Same-day" : "Standard") + '</td></tr>'; }).join("") +
        '</tbody></table></div></div></div>';
    } else {
      const rows = state.antifraudClaims;
      body = '<div class="table-wrap"><table class="dt"><thead><tr><th>Person / Worker</th><th>Line Type</th><th>Tier</th><th class="num">Amount</th><th>Status</th><th>Reason</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (c) {
          return '<tr><td class="mono">' + esc(c.personKey || c.workerId || c.id) + '</td><td>' + esc(c.phoneLineType || "—") + '</td><td>' + esc(c.vestingTier || "—") + '</td><td class="num">' + usd2(c.amountCents) + '</td><td>' + smark(c.status, c.status, true) + '</td><td>' + esc(c.reason || "—") + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty-inline">No anti-fraud claims flagged.</td></tr>') + '</tbody></table></div>';
    }

    return '<div class="view-head"><h1 class="view-title">Street Teams, Creators & Proofs</h1><div class="view-actions">' +
      '<button class="btn" data-open-drawer="new-human">' + ico("plus", 14) + ' Add Human</button>' +
      '<button class="btn" data-open-drawer="submit-proof">' + ico("plus", 14) + ' Submit Proof</button>' +
      '<button class="btn btn-primary" data-open-drawer="new-task">' + ico("plus", 14) + ' New Task</button>' +
      '</div></div>' +
      '<section class="panel"><div class="subtabs" role="tablist">' + subtabs + '</div>' + body + '</section>';
  }

  function renderBd() {
    const tab = state.subtab.bd || "pipeline";
    const subtabs = [
      ["pipeline", "BD Pipeline (" + state.bdDeals.length + ")"],
      ["qr", "QR Batches (" + state.qrBatches.length + ")"],
    ].map(function (pair) {
      return '<button class="subtab-btn" role="tab" aria-selected="' + (tab === pair[0]) + '" data-subtab="bd:' + pair[0] + '">' + esc(pair[1]) + '</button>';
    }).join("");

    let body = "";
    if (tab === "pipeline") {
      body = '<div class="stage-cols">' + BD_STAGES.map(function (st) {
        const items = state.bdDeals.filter(function (d) { return d.stage === st && matchSearch([d.venueName, d.vertical, d.city]); });
        return '<div class="stage-col"><div class="stage-col-head"><span>' + esc(titleCase(st)) + '</span><span class="tnum muted">' + items.length + '</span></div>' +
          (items.length ? items.map(function (d) {
            return '<div class="stage-item" data-open-drawer="bd-detail" data-id="' + esc(d.id) + '"><strong>' + esc(d.venueName) + '</strong><span class="muted">' + esc(d.vertical) + ' · ' + usd(d.offeredCents) + '</span><span>' + smark(d.phoneCallbackVerified ? "ok" : "neutral", d.phoneCallbackVerified ? "Phone verified" : "Unverified", true) + '</span></div>';
          }).join("") : '<div class="muted">—</div>') + '</div>';
      }).join("") + '</div>';
    } else {
      body = '<div class="table-wrap"><table class="dt"><thead><tr><th>Batch Code</th><th>City</th><th>Assigned</th><th class="num">Print Qty</th><th class="num">Scans</th><th class="num">Verified 18+</th></tr></thead><tbody>' +
        (state.qrBatches.length ? state.qrBatches.map(function (b) {
          return '<tr><td class="mono"><strong>' + esc(b.batchCode) + '</strong></td><td class="mono">' + esc(String(b.city || "").toUpperCase()) + '</td><td>' + esc(human(b.assignedToType || "unassigned")) + '</td><td class="num">' + num(b.printQty) + '</td><td class="num">' + num(b.scans) + '</td><td class="num">' + num(b.verifiedSignups) + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty-inline">No serialized QR batches minted yet.</td></tr>') + '</tbody></table></div>';
    }

    return '<div class="view-head"><h1 class="view-title">BD, Events & QR Batches</h1><div class="view-actions">' +
      '<button class="btn" data-open-drawer="new-qr">' + ico("plus", 14) + ' Mint QR Batch</button>' +
      '<button class="btn btn-primary" data-open-drawer="new-bd">' + ico("plus", 14) + ' New BD Deal</button>' +
      '</div></div>' +
      '<section class="panel"><div class="subtabs" role="tablist">' + subtabs + '</div>' + body + '</section>';
  }

  function renderVip() {
    const tab = state.subtab.vip || "salons";
    const subtabs = [
      ["salons", "VIP Salons (" + state.vipProspects.length + ")"],
      ["video", "Video Factory (" + state.videoAssets.length + ")"],
    ].map(function (pair) {
      return '<button class="subtab-btn" role="tab" aria-selected="' + (tab === pair[0]) + '" data-subtab="vip:' + pair[0] + '">' + esc(pair[1]) + '</button>';
    }).join("");

    let body = "";
    if (tab === "salons") {
      const rows = state.vipProspects.filter(function (v) { return matchSearch([v.name, v.archetype, v.organization, v.status]); });
      body = '<div class="table-wrap"><table class="dt"><thead><tr><th>Prospect</th><th>Archetype</th><th>Source</th><th class="num">Prestige</th><th>Status</th><th>Invite</th></tr></thead><tbody>' +
        (rows.length ? rows.map(function (v) {
          const href = safeUrl(v.sourceUrl);
          return '<tr class="row-click" data-open-drawer="vip-detail" data-id="' + esc(v.id) + '">' +
            '<td><strong>' + esc(v.name) + '</strong><div class="muted">' + esc(v.organization || "") + '</div></td>' +
            '<td>' + esc(human(v.archetype)) + '</td>' +
            '<td>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(v.publicSource) + '</a>' : esc(v.publicSource)) + '</td>' +
            '<td class="num">' + num(v.prestigeScore) + '</td>' +
            '<td>' + smark(v.status, human(v.status), true) + '</td>' +
            '<td class="muted">' + (v.inviteDraft ? esc(String(v.inviteDraft).split(/\s+/).length) + " words" : "—") + '</td></tr>';
        }).join("") : '<tr><td colspan="6" class="empty-inline">No VIP prospects discovered yet.</td></tr>') + '</tbody></table></div>';
    } else {
      body = '<div class="stage-cols">' + VIDEO_STAGES.map(function (st) {
        const items = state.videoAssets.filter(function (v) { return v.stage === st && matchSearch([v.title, v.hook, v.agentId, v.platform]); });
        return '<div class="stage-col"><div class="stage-col-head"><span>' + esc(titleCase(st)) + '</span><span class="tnum muted">' + items.length + '</span></div>' +
          (items.length ? items.map(function (v) {
            return '<div class="stage-item" data-open-drawer="video-detail" data-id="' + esc(v.id) + '"><strong>' + esc(v.title) + '</strong><span class="muted">' + esc(v.platform || "short") + ' · ' + num(v.views) + ' views</span><span>' + smark(v.ftcDisclosed ? "ok" : "warn", v.ftcDisclosed ? "FTC ok" : "Needs #Ad", true) + '</span></div>';
          }).join("") : '<div class="muted">—</div>') + '</div>';
      }).join("") + '</div>';
    }

    return '<div class="view-head"><h1 class="view-title">VIP Salons & Video Factory</h1><div class="view-actions">' +
      '<button class="btn" data-open-drawer="new-vip">' + ico("plus", 14) + ' Add VIP</button>' +
      '<button class="btn btn-primary" data-open-drawer="new-video">' + ico("plus", 14) + ' New Video Script</button>' +
      '</div></div>' +
      '<section class="panel"><div class="subtabs" role="tablist">' + subtabs + '</div>' + body + '</section>';
  }

  function renderRails() {
    const tab = state.subtab.rails || "adapters";
    const subtabs = [
      ["adapters", "Paid Adapters (" + state.adapters.length + ")"],
      ["discovery", "Discovery (" + state.discoveredLeads.length + ")"],
      ["outreach", "Outreach (" + state.outreach.length + ")"],
      ["slopcash", "slop.cash"],
    ].map(function (pair) {
      return '<button class="subtab-btn" role="tab" aria-selected="' + (tab === pair[0]) + '" data-subtab="rails:' + pair[0] + '">' + esc(pair[1]) + '</button>';
    }).join("");

    let body = "";
    if (tab === "adapters") {
      body = '<div class="meta-row"><span>Master live billing gate (<code class="mono">MARKETING_LIVE_BILLING</code>)</span>' +
        smark(state.liveBillingEnabled ? "warn" : "neutral", state.liveBillingEnabled ? "Live billing ON" : "Dry-run only", true) + '</div>' +
        '<div class="adapter-grid">' + state.adapters.map(function (a) {
          const provs = (a.providers || []).map(function (p) {
            return '<div class="meta-row"><span>' + esc(p.label) + '</span>' + (p.configured ? smark("ok", "Configured", true) : '<code class="mono muted">' + esc((p.missingEnv || []).join(", ")) + '</code>') + '</div>';
          }).join("");
          return '<article class="panel"><div class="panel-head"><strong>' + esc(a.label) + '</strong>' + smark(a.readiness, human(a.readiness), true) + '</div><div class="meta-row"><span class="muted">Tier ' + esc(a.tier) + '</span><span class="mono">' + esc(a.activeProvider || "none") + '</span></div>' + provs + '</article>';
        }).join("") + '</div>';
    } else if (tab === "discovery") {
      const checks = DISCOVERY_SOURCES.map(function (src) {
        const checked = state.selectedDiscoverySources.includes(src);
        return '<label class="check-field"><input type="checkbox" data-disc-src="' + esc(src) + '"' + (checked ? " checked" : "") + '/><span>' + esc(human(src)) + '</span></label>';
      }).join("");
      body = '<div class="view-actions">' + checks + '</div>' +
        '<div class="view-actions"><button class="btn btn-primary" data-action="run-discovery">' + ico("zap", 14) + ' Run $0 Discovery</button></div>' +
        '<div class="table-wrap"><table class="dt"><thead><tr><th>Lead</th><th>Vertical</th><th>Source</th><th class="num">Score</th><th>Action</th></tr></thead><tbody>' +
        (state.discoveredLeads.length ? state.discoveredLeads.map(function (l, idx) {
          const href = safeUrl(l.sourceUrl);
          return '<tr><td>' + (href ? '<a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">' + esc(l.title) + '</a>' : esc(l.title)) + '<div class="muted">' + esc(l.neighborhood || l.city || "") + '</div></td>' +
            '<td><span class="cell-flex">' + brandSvg(l.vertical, 16) + esc(l.vertical) + '</span></td>' +
            '<td>' + esc(human(l.source)) + '</td>' +
            '<td class="num">' + num(l.score) + '</td>' +
            '<td><button class="btn btn-sm" data-action="promote-lead" data-idx="' + idx + '">Add Human</button></td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty-inline">Run discovery to pull live open-web leads.</td></tr>') + '</tbody></table></div>';
    } else if (tab === "outreach") {
      body = '<div class="view-actions"><button class="btn btn-primary" data-action="dispatch-outreach">' + ico("play", 14) + ' Dispatch Pending</button></div>' +
        '<div class="table-wrap"><table class="dt"><thead><tr><th>Channel</th><th>Subject / Summary</th><th>Leak Guard</th><th>Status</th></tr></thead><tbody>' +
        (state.outreach.length ? state.outreach.map(function (m) {
          return '<tr><td>' + esc(m.channel) + '</td><td><strong>' + esc(m.subject || "(no subject)") + '</strong><div class="muted">' + esc(m.bodySummary) + '</div></td><td>' + smark(m.leakCheckPass ? "ok" : "destructive", m.leakCheckPass ? "Pass" : "Blocked", true) + '</td><td>' + smark(m.status, human(m.status), true) + '</td></tr>';
        }).join("") : '<tr><td colspan="4" class="empty-inline">No outreach messages queued.</td></tr>') + '</tbody></table></div>';
    } else {
      const sc = state.slopCash || {};
      const hooks = sc.hooks || [];
      body = '<div class="alert-strip warn">' + ico("lock", 16) + '<span>slop.cash settlement is LOCKED OFF (MARKETING_SLOP_CASH_ENABLED=0). Consumer street/creator tasks settle on fiat rails only.</span></div>' +
        '<div class="view-actions"><button class="btn" data-open-drawer="slop-preview">Preview OSS Manifest</button></div>' +
        '<div class="table-wrap"><table class="dt"><thead><tr><th>Task</th><th>Repo</th><th>Chain</th><th class="num">Est. USDC</th><th>Hook State</th></tr></thead><tbody>' +
        (hooks.length ? hooks.map(function (h) {
          return '<tr><td class="mono">' + esc(h.taskId) + '</td><td class="mono">' + esc(h.repoSlug) + '</td><td>' + esc(h.vaultChain) + '</td><td class="num">' + usd2(h.estimatedUsdcCents) + '</td><td>' + smark(h.hookState === "disabled_stub" ? "neutral" : "ok", human(h.hookState), true) + '</td></tr>';
        }).join("") : '<tr><td colspan="5" class="empty-inline">No slop.cash preview hooks recorded.</td></tr>') + '</tbody></table></div>';
    }

    return '<div class="view-head"><h1 class="view-title">Adapters, Discovery & slop.cash</h1></div>' +
      '<section class="panel"><div class="subtabs" role="tablist">' + subtabs + '</div>' + body + '</section>';
  }

  function renderDrawer() {
    if (!state.drawer) return '<div class="drawer-backdrop" hidden></div>';
    const d = state.drawer;
    const camp = activeCampaign();
    const campId = camp ? camp.id : "";
    let title = "Details";
    let inner = "";

    if (d.kind === "new-campaign") {
      title = "New Campaign";
      inner = '<form class="form-grid" data-form="new-campaign">' +
        '<div class="field"><label>Name</label><input class="ctrl-input" name="name" required placeholder="SF Month-1 Launch"/></div>' +
        '<div class="field-row"><div class="field"><label>Slug</label><input class="ctrl-input" name="slug" required placeholder="sf-month-1"/></div>' +
        '<div class="field"><label>City</label><select class="ctrl-select" name="city">' + CITIES.map(function (c) { return '<option value="' + c + '">' + c.toUpperCase() + '</option>'; }).join("") + '</select></div></div>' +
        '<div class="field-row"><div class="field"><label>App</label><select class="ctrl-select" name="appId">' + APPS.map(function (a) { return '<option value="' + a + '">' + a + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Monthly Cap (USD)</label><input class="ctrl-input" type="number" name="monthlyUsd" value="10000" min="100" required/></div></div>' +
        '<div class="field-row"><div class="field"><label>Daily Cap (USD)</label><input class="ctrl-input" type="number" name="dailyUsd" value="1000" min="50" required/></div>' +
        '<div class="field"><label>Max Task (USD)</label><input class="ctrl-input" type="number" name="maxTaskUsd" value="1500" min="25" required/></div></div>' +
        '<button type="submit" class="btn btn-primary">Create Campaign</button></form>';
    } else if (d.kind === "new-agent") {
      title = "Register Agent";
      inner = '<form class="form-grid" data-form="new-agent">' +
        '<div class="field-row"><div class="field"><label>Persona ID</label><select class="ctrl-select" name="personaId"><option>chadwick</option><option>sloane</option><option>peon</option><option>venn</option><option>operator</option></select></div>' +
        '<div class="field"><label>Display Name</label><input class="ctrl-input" name="displayName" required placeholder="Sloane"/></div></div>' +
        '<div class="field-row"><div class="field"><label>App</label><select class="ctrl-select" name="appId"><option>ntwrk</option><option>slop</option><option>peon</option><option>friends</option></select></div>' +
        '<div class="field"><label>Provider</label><select class="ctrl-select" name="provider">' + PROVIDERS.map(function (p) { return '<option>' + p + '</option>'; }).join("") + '</select></div></div>' +
        '<div class="field"><label>Daily Turn Cap</label><input class="ctrl-input" type="number" name="dailyTurnCap" value="60" min="1" max="500"/></div>' +
        '<button type="submit" class="btn btn-primary">Save Agent</button></form>';
    } else if (d.kind === "agent-tick") {
      const a = state.agents.find(function (x) { return x.id === d.id; });
      title = "Dispatch Turn · " + (a ? a.displayName : d.id);
      inner = '<form class="form-grid" data-form="agent-tick"><input type="hidden" name="id" value="' + esc(d.id) + '"/>' +
        '<div class="field"><label>Prompt</label><textarea class="ctrl-textarea" name="prompt">Execute scheduled NYC growth coordination turn.</textarea></div>' +
        '<label class="check-field"><input type="checkbox" name="dryRun" checked/><span>Dry run</span></label>' +
        '<label class="check-field"><input type="checkbox" name="allowFailover" checked/><span>Allow provider failover</span></label>' +
        '<button type="submit" class="btn btn-primary">Dispatch Turn</button></form>';
    } else if (d.kind === "new-device") {
      title = "Register Device";
      inner = '<form class="form-grid" data-form="new-device">' +
        '<div class="field"><label>Label</label><input class="ctrl-input" name="label" required placeholder="pixel-nyc-02"/></div>' +
        '<div class="field-row"><div class="field"><label>Platform</label><select class="ctrl-select" name="platform"><option value="android">Android</option><option value="ios">iPhone (iOS)</option><option value="macbook">MacBook</option></select></div>' +
        '<div class="field"><label>Serial / UDID</label><input class="ctrl-input" name="serialOrUdid" required placeholder="PIXEL-USB-02"/></div></div>' +
        '<button type="submit" class="btn btn-primary">Register Device</button></form>';
    } else if (d.kind === "device-action") {
      const dev = state.devices.find(function (x) { return x.id === d.id; });
      title = "Test Device Action · " + (dev ? dev.label : d.id);
      inner = '<form class="form-grid" data-form="device-action"><input type="hidden" name="id" value="' + esc(d.id) + '"/>' +
        '<div class="field"><label>Action</label><select class="ctrl-select" name="kind"><option value="screenshot">Screenshot</option><option value="tap">Tap (120, 240)</option><option value="ui_dump">UI Hierarchy Dump</option></select></div>' +
        '<label class="check-field"><input type="checkbox" name="dryRun" checked/><span>Dry run (safe probe)</span></label>' +
        '<button type="submit" class="btn btn-primary">Run Action</button></form>';
    } else if (d.kind === "new-human") {
      title = "Add External Human";
      inner = '<form class="form-grid" data-form="new-human">' +
        '<div class="field"><label>Display Label</label><input class="ctrl-input" name="displayLabel" required placeholder="Alex Rivera (SoHo)"/></div>' +
        '<div class="field"><label>Contact HMAC / Key</label><input class="ctrl-input" name="handleOrEmailHmac" required placeholder="human:nyc-01"/></div>' +
        '<div class="field-row"><div class="field"><label>Role</label><select class="ctrl-select" name="role"><option value="street_worker">Street Worker</option><option value="creator">Creator</option><option value="agency">Agency</option><option value="venue">Venue</option><option value="vip">VIP</option><option value="applicant">Applicant</option></select></div>' +
        '<div class="field"><label>Verified Age (18+ paid)</label><input class="ctrl-input" type="number" name="lowestAge" value="22" min="18" max="120"/></div></div>' +
        '<div class="field"><label>Channel</label><select class="ctrl-select" name="channel"><option>email</option><option>craigslist</option><option>rentahuman</option><option>youtube</option><option>tiktok</option><option>instagram</option></select></div>' +
        '<button type="submit" class="btn btn-primary">Save Human</button></form>';
    } else if (d.kind === "new-task") {
      title = "New Marketing Task";
      inner = '<form class="form-grid" data-form="new-task"><input type="hidden" name="campaignId" value="' + esc(campId) + '"/>' +
        '<div class="field"><label>Title</label><input class="ctrl-input" name="title" required placeholder="Wash Sq 4-hr Street Shift"/></div>' +
        '<div class="field-row"><div class="field"><label>Kind</label><select class="ctrl-select" name="taskKind"><option value="street_fliering">Street Fliering</option><option value="creator_video">Creator Video</option><option value="event_activation">Event Activation</option><option value="agency_booking">Agency Booking</option><option value="print_order">Print Order</option></select></div>' +
        '<div class="field"><label>Channel</label><select class="ctrl-select" name="vendorChannel"><option value="craigslist">Craigslist</option><option value="rentahuman">RentAHuman</option><option value="creator_direct">Creator Direct</option><option value="agency_email">Agency Email</option><option value="print_api">Print API</option></select></div></div>' +
        '<div class="field-row"><div class="field"><label>Amount (USD)</label><input class="ctrl-input" type="number" name="amountUsd" value="88" min="1" required/></div>' +
        '<div class="field"><label>QR Batch</label><input class="ctrl-input" name="qrBatchCode" placeholder="NYC-W1-SLOP-01"/></div></div>' +
        '<div class="field"><label>Brief</label><textarea class="ctrl-textarea" name="briefText" required>Hand-to-hand sidewalk distribution only; 8ft clear width; zero posting on poles or MTA.</textarea></div>' +
        '<button type="submit" class="btn btn-primary">Create Task</button></form>';
    } else if (d.kind === "submit-proof") {
      title = "Submit Proof of Work";
      inner = '<form class="form-grid" data-form="submit-proof">' +
        '<div class="field"><label>Task</label><select class="ctrl-select" name="taskId">' + state.tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join("") + '</select></div>' +
        '<div class="field-row"><div class="field"><label>Proof Kind</label><select class="ctrl-select" name="proofKind"><option value="creator_video">Creator Video</option><option value="street_shift">Street Shift</option><option value="event_checkin">Event Check-in</option><option value="print_receipt">Print Receipt</option></select></div>' +
        '<div class="field"><label>Worker Age (18+)</label><input class="ctrl-input" type="number" name="workerAge" value="23" min="18" max="120"/></div></div>' +
        '<div class="field"><label>Evidence / Video URL</label><input class="ctrl-input" type="url" name="evidenceUrl" required placeholder="https://youtube.com/watch?v=..."/></div>' +
        '<div class="field-row"><div class="field"><label>QR Scans</label><input class="ctrl-input" type="number" name="qrScansCount" value="25" min="0"/></div>' +
        '<div class="field"><label>Verified 18+ Signups</label><input class="ctrl-input" type="number" name="verifiedSignupsCount" value="6" min="0"/></div></div>' +
        '<label class="check-field"><input type="checkbox" name="ftcDisclosed" checked/><span>FTC #Ad / Paid Partnership verified</span></label>' +
        '<label class="check-field"><input type="checkbox" name="geoTimeValid" checked/><span>Geo & timestamp check-in valid</span></label>' +
        '<label class="check-field"><input type="checkbox" name="likenessReleaseOk" checked/><span>NY §§ 50-51 written likeness releases verified</span></label>' +
        '<button type="submit" class="btn btn-primary">Submit & Evaluate</button></form>';
    } else if (d.kind === "new-bd") {
      title = "New BD Venue / Event Deal";
      inner = '<form class="form-grid" data-form="new-bd"><input type="hidden" name="campaignId" value="' + esc(campId) + '"/>' +
        '<div class="field"><label>Venue / Host Name</label><input class="ctrl-input" name="venueName" required placeholder="Balthazar Annex"/></div>' +
        '<div class="field-row"><div class="field"><label>Vertical</label><select class="ctrl-select" name="vertical"><option value="friends">friends.help</option><option value="slop">slop.date</option><option value="peon">peon.biz</option><option value="ntwrk">ntwrk.party</option><option value="all">all</option></select></div>' +
        '<div class="field"><label>Offer (USD)</label><input class="ctrl-input" type="number" name="offeredUsd" value="0" min="0"/></div></div>' +
        '<div class="field-row"><div class="field"><label>Contact Email</label><input class="ctrl-input" type="email" name="contactEmail" placeholder="events@venue.nyc"/></div>' +
        '<div class="field"><label>Business Phone</label><input class="ctrl-input" name="businessPhone" placeholder="+12125550199"/></div></div>' +
        '<button type="submit" class="btn btn-primary">Create Deal</button></form>';
    } else if (d.kind === "new-qr") {
      title = "Mint Serialized QR Batch";
      inner = '<form class="form-grid" data-form="new-qr"><input type="hidden" name="campaignId" value="' + esc(campId) + '"/>' +
        '<div class="field-row"><div class="field"><label>Batch Code</label><input class="ctrl-input" name="batchCode" required placeholder="NYC-SOHO-01"/></div>' +
        '<div class="field"><label>Print Qty</label><input class="ctrl-input" type="number" name="printQty" value="5000" min="1"/></div></div>' +
        '<div class="field"><label>Destination URL</label><input class="ctrl-input" type="url" name="destinationUrl" required value="https://go.slop.date/nyc-soho-01"/></div>' +
        '<button type="submit" class="btn btn-primary">Mint Batch</button></form>';
    } else if (d.kind === "new-vip") {
      title = "Add VIP Salon Prospect";
      inner = '<form class="form-grid" data-form="new-vip"><input type="hidden" name="campaignId" value="' + esc(campId) + '"/>' +
        '<div class="field"><label>Name</label><input class="ctrl-input" name="name" required placeholder="Dr. Maya Lin"/></div>' +
        '<div class="field-row"><div class="field"><label>Archetype</label><input class="ctrl-input" name="archetype" required value="ai_researcher"/></div>' +
        '<div class="field"><label>Organization</label><input class="ctrl-input" name="organization" placeholder="NYU Courant"/></div></div>' +
        '<div class="field"><label>Public Source URL</label><input class="ctrl-input" type="url" name="sourceUrl" placeholder="https://arxiv.org/..."/></div>' +
        '<button type="submit" class="btn btn-primary">Add Prospect</button></form>';
    } else if (d.kind === "new-video") {
      title = "New Video Factory Asset";
      inner = '<form class="form-grid" data-form="new-video"><input type="hidden" name="campaignId" value="' + esc(campId) + '"/>' +
        '<div class="field"><label>Title</label><input class="ctrl-input" name="title" required placeholder="Sloane roasts NYC hinge prompts"/></div>' +
        '<div class="field-row"><div class="field"><label>Agent</label><select class="ctrl-select" name="agentId"><option value="agent-sloane">Sloane</option><option value="agent-chadwick">Chadwick</option><option value="agent-peon">Peon</option><option value="agent-venn">Venn</option><option value="agent-operator">The Operator</option></select></div>' +
        '<div class="field"><label>Platform</label><select class="ctrl-select" name="platform"><option>tiktok</option><option>youtube_shorts</option><option>instagram_reels</option></select></div></div>' +
        '<div class="field"><label>3-Second Hook</label><input class="ctrl-input" name="hook" required placeholder="Stop paying $60/mo to get ghosted in West Village."/></div>' +
        '<div class="field"><label>Script</label><textarea class="ctrl-textarea" name="script" required></textarea></div>' +
        '<label class="check-field"><input type="checkbox" name="ftcDisclosed" checked/><span>Includes #Ad disclosure</span></label>' +
        '<button type="submit" class="btn btn-primary">Create Asset</button></form>';
    } else if (d.kind === "slop-preview") {
      title = "Preview slop.cash Manifest";
      inner = '<form class="form-grid" data-form="slop-preview">' +
        '<div class="field"><label>Task</label><select class="ctrl-select" name="taskId">' + state.tasks.map(function (t) { return '<option value="' + esc(t.id) + '">' + esc(t.title) + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>Vault Chain</label><select class="ctrl-select" name="vaultChain"><option value="base">Base</option><option value="solana">Solana</option><option value="robinhood_4663">Robinhood 4663</option></select></div>' +
        '<button type="submit" class="btn btn-primary">Generate Dry-Run Preview</button></form>';
    } else if (d.kind === "task-detail") {
      const t = state.tasks.find(function (x) { return x.id === d.id; });
      title = t ? t.title : "Task";
      inner = t ? '<div class="meta-row"><span class="muted">Status</span>' + smark(t.status, human(t.status), true) + '</div>' +
        '<div class="meta-row"><span class="muted">Budget</span><strong class="tnum">' + usd2(t.amountCents) + '</strong></div>' +
        '<div class="meta-row"><span class="muted">QR Batch</span><span class="mono">' + esc(t.qrBatchCode || "—") + '</span></div>' +
        '<pre class="code-block">' + esc(t.briefText) + '</pre>' : '';
    } else if (d.kind === "bd-detail") {
      const b = state.bdDeals.find(function (x) { return x.id === d.id; });
      title = b ? b.venueName : "BD Deal";
      inner = b ? '<div class="meta-row"><span class="muted">Stage</span>' + smark(b.stage, human(b.stage), true) + '</div>' +
        '<div class="meta-row"><span class="muted">Phone Callback</span>' + smark(b.phoneCallbackVerified ? "ok" : "warn", b.phoneCallbackVerified ? "Verified" : "Unverified", true) + '</div>' +
        '<div class="meta-row"><span class="muted">Contract Hash</span><span class="mono">' + esc(b.contractHash ? b.contractHash.slice(0, 16) + "…" : "unsigned") + '</span></div>' +
        '<div class="view-actions"><button class="btn btn-sm" data-action="bd-contract" data-id="' + esc(b.id) + '">Clickwrap</button><button class="btn btn-sm" data-action="bd-verify-phone" data-id="' + esc(b.id) + '">Verify Callback</button><button class="btn btn-sm btn-primary" data-action="bd-advance" data-id="' + esc(b.id) + '">Advance Stage</button></div>' : '';
    } else if (d.kind === "vip-detail") {
      const v = state.vipProspects.find(function (x) { return x.id === d.id; });
      title = v ? v.name : "VIP Prospect";
      inner = v ? '<div class="meta-row"><span class="muted">Archetype</span><span>' + esc(human(v.archetype)) + '</span></div>' +
        '<div class="view-actions"><button class="btn btn-sm btn-primary" data-action="vip-draft-invite" data-id="' + esc(v.id) + '">Draft <75w Invite</button></div>' +
        '<pre class="code-block">' + esc(v.inviteDraft || "No <75-word invite draft generated yet.") + '</pre>' : '';
    } else if (d.kind === "video-detail") {
      const v = state.videoAssets.find(function (x) { return x.id === d.id; });
      title = v ? v.title : "Video Asset";
      inner = v ? '<div class="meta-row"><span class="muted">Stage</span>' + smark(v.stage, human(v.stage), true) + '</div>' +
        '<div class="meta-row"><span class="muted">Hook</span><span>' + esc(v.hook || "—") + '</span></div>' +
        '<pre class="code-block">' + esc(v.script || "") + '</pre>' : '';
    }

    return '<div class="drawer-backdrop" data-close-backdrop="drawer"><aside class="drawer" role="dialog" aria-label="' + esc(title) + '"><div class="drawer-head"><h2 class="drawer-title">' + esc(title) + '</h2><button class="btn btn-ghost btn-icon" data-close="drawer" aria-label="Close drawer">' + ico("close", 16) + '</button></div><div class="drawer-body">' + inner + '</div></aside></div>';
  }

  function renderModal() {
    if (!state.modal) return '<div class="modal-backdrop" hidden></div>';
    const m = state.modal;
    if (m.kind === "help") {
      return '<div class="modal-backdrop" data-close-backdrop="modal"><div class="modal" role="dialog" aria-label="Keyboard shortcuts"><h2 class="drawer-title">Shortcuts</h2>' +
        '<div class="meta-row"><span>Switch views</span><code class="mono">1 – 8</code></div>' +
        '<div class="meta-row"><span>Focus search</span><code class="mono">/</code></div>' +
        '<div class="meta-row"><span>Refresh data</span><code class="mono">r</code></div>' +
        '<div class="meta-row"><span>Close dialog / drawer</span><code class="mono">Esc</code></div>' +
        '<div class="view-actions"><button class="btn btn-primary" data-close="modal">Done</button></div></div></div>';
    }
    return '<div class="modal-backdrop" data-close-backdrop="modal"><div class="modal" role="dialog" aria-label="' + esc(m.title) + '"><h2 class="drawer-title">' + esc(m.title) + '</h2><p class="muted modal-msg">' + esc(m.message) + '</p><div class="view-actions">' +
      '<button class="btn" data-close="modal">Cancel</button>' +
      '<button class="btn ' + (m.danger ? "btn-danger" : "btn-primary") + '" data-confirm-modal="1">' + esc(m.confirmLabel || "Confirm") + '</button></div></div></div>';
  }

  function renderSignIn() {
    return '<main class="signin-wrap"><form class="signin-card" data-form="signin">' +
      '<div class="cell-flex">' + brandSvg("ntwrk", 24) + '<strong>Marketing</strong></div>' +
      (state.authError ? '<div class="alert-strip">' + smark("destructive", "Error", false) + '<span>' + esc(state.authError) + '</span></div>' : '') +
      '<div class="field"><label for="tok-input">Bearer token</label><input id="tok-input" class="ctrl-input mono" type="password" name="token" required autocomplete="off" placeholder="Paste token from terminal"/></div>' +
      '<button type="submit" class="btn btn-primary">Sign in</button></form></main>';
  }

  function render() {
    const root = document.getElementById("app");
    if (!root) return;
    if (!state.token) {
      root.innerHTML = renderSignIn();
      return;
    }
    const camp = activeCampaign();
    const dial = camp ? camp.riskDial : "conservative";
    const armed = camp ? Boolean(camp.billingArmed) : false;

    const campSelect = state.campaigns.length
      ? '<select class="ctrl-select ctrl-select-sm" data-change-campaign="1" aria-label="Active campaign">' + state.campaigns.map(function (c) {
          return '<option value="' + esc(c.id) + '"' + (camp && c.id === camp.id ? " selected" : "") + '>' + esc(c.city.toUpperCase() + " · " + c.name) + '</option>';
        }).join("") + '</select>'
      : '';

    const dialSegs = '<div class="segments" role="group" aria-label="RiskDial">' + RISK_DIALS.map(function (d) {
      return '<button class="seg-btn' + (d === "lockdown" ? " seg-danger" : "") + '" aria-pressed="' + (dial === d) + '" data-set-dial="' + d + '">' + d.toUpperCase() + '</button>';
    }).join("") + '</div>';

    const viewBody = {
      overview: renderOverview,
      campaigns: renderCampaigns,
      agents: renderAgents,
      devices: renderDevices,
      field: renderField,
      bd: renderBd,
      vip: renderVip,
      rails: renderRails,
    }[state.view]();

    root.innerHTML = '<div class="shell">' +
      '<header class="topbar">' +
        '<button class="btn btn-ghost btn-icon mobile-menu-btn" data-action="toggle-nav" aria-label="Toggle navigation">' + ico("menu", 16) + '</button>' +
        '<button class="brand-btn" data-nav="overview">' + brandSvg("ntwrk", 22) + '<span>Marketing</span></button>' +
        '<div class="topbar-mid">' + campSelect + dialSegs +
          '<button class="switch-btn" aria-pressed="' + armed + '" data-action="toggle-billing">' + smark(armed ? "warn" : "neutral", armed ? "Billing Armed" : "Disarmed", true) + '</button>' +
        '</div>' +
        '<div class="topbar-end">' +
          '<span id="sse-slot"></span>' +
          '<div class="search-wrap">' + ico("search", 14) + '<input id="global-search" class="ctrl-input ctrl-select-sm" type="search" value="' + esc(state.search) + '" placeholder="Filter (/)" aria-label="Filter current view"/></div>' +
          '<button class="btn btn-ghost btn-icon" data-action="toggle-theme" aria-label="Toggle light or dark theme">' + ico(isDark() ? "sun" : "moon", 15) + '</button>' +
          '<button class="btn btn-ghost btn-icon" data-action="open-help" aria-label="Keyboard shortcuts">' + ico("help", 15) + '</button>' +
          '<button class="btn btn-ghost btn-icon" data-action="sign-out" aria-label="Sign out">' + ico("lock", 15) + '</button>' +
        '</div>' +
      '</header>' +
      '<div class="workspace">' +
        '<nav class="rail' + (state.mobileNavOpen ? " open" : "") + '" aria-label="Sections">' +
          VIEWS.map(function (v) {
            return '<button class="rail-btn" data-nav="' + v.id + '"' + (state.view === v.id ? ' aria-current="page"' : '') + '>' + ico(v.icon, 15) + '<span>' + esc(v.label) + '</span><span class="rail-key">' + v.key + '</span></button>';
          }).join("") +
          '<div class="rail-foot">' +
            '<div class="meta-row">' + brandSvg("slop", 16) + brandSvg("peon", 16) + brandSvg("friends", 16) + brandSvg("ntwrk", 16) + brandSvg("eliza", 16) + '</div>' +
          '</div>' +
        '</nav>' +
        '<main class="stage"><div class="stage-inner">' + viewBody + '</div></main>' +
      '</div>' +
      renderDrawer() +
      renderModal() +
      '<div id="toast-host" class="toasts" aria-live="polite"></div>' +
    '</div>';

    renderTopStatus();
    renderToasts();
  }

  document.addEventListener("click", async function (e) {
    const el = e.target && e.target.closest ? e.target.closest("[data-nav],[data-action],[data-subtab],[data-set-dial],[data-open-drawer],[data-close],[data-close-backdrop],[data-confirm-modal],[data-select-campaign]") : null;
    if (!el) return;

    if (el.dataset.closeBackdrop && e.target === el) {
      if (el.dataset.closeBackdrop === "modal") state.modal = null;
      if (el.dataset.closeBackdrop === "drawer") state.drawer = null;
      render();
      return;
    }
    if (el.dataset.close === "modal") { state.modal = null; render(); return; }
    if (el.dataset.close === "drawer") { state.drawer = null; render(); return; }
    if (el.dataset.confirmModal && state.modal && typeof state.modal.onConfirm === "function") {
      const fn = state.modal.onConfirm;
      state.modal = null;
      render();
      await fn();
      return;
    }
    if (el.dataset.nav) {
      state.view = el.dataset.nav;
      state.mobileNavOpen = false;
      render();
      return;
    }
    if (el.dataset.subtab) {
      const parts = el.dataset.subtab.split(":");
      state.subtab[parts[0]] = parts[1];
      render();
      return;
    }
    if (el.dataset.selectCampaign) {
      state.selectedCampaignId = el.dataset.selectCampaign;
      await refreshAll();
      return;
    }
    if (el.dataset.openDrawer) {
      state.drawer = { kind: el.dataset.openDrawer, id: el.dataset.id || "" };
      render();
      return;
    }
    if (el.dataset.setDial) {
      const camp = activeCampaign();
      if (!camp) { toast("Seed or create a campaign first.", "warn"); return; }
      const nextDial = el.dataset.setDial;
      const applyDial = async function () {
        const r = await api("POST", "/api/campaigns/" + encodeURIComponent(camp.id) + "/risk-dial", { riskDial: nextDial, billingArmed: nextDial === "lockdown" ? false : camp.billingArmed });
        if (r.ok) { toast("RiskDial set to " + nextDial.toUpperCase(), nextDial === "lockdown" ? "destructive" : "ok"); await refreshAll(); }
      };
      if (nextDial === "lockdown" || camp.riskDial === "lockdown") {
        state.modal = {
          title: nextDial === "lockdown" ? "Activate Lockdown?" : "Exit Lockdown?",
          message: nextDial === "lockdown" ? "All Tier 3 paid APIs and Tier 4 human payouts halt immediately." : "Switching from Lockdown to " + nextDial.toUpperCase() + ".",
          danger: nextDial === "lockdown",
          confirmLabel: nextDial === "lockdown" ? "Activate Lockdown" : "Switch Mode",
          onConfirm: applyDial,
        };
        render();
      } else {
        await applyDial();
      }
      return;
    }

    const act = el.dataset.action;
    if (!act) return;

    if (act === "toggle-nav") { state.mobileNavOpen = !state.mobileNavOpen; render(); return; }
    if (act === "toggle-theme") {
      const next = isDark() ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("marketing_theme", next);
      render();
      return;
    }
    if (act === "open-help") { state.modal = { kind: "help" }; render(); return; }
    if (act === "sign-out") {
      state.token = "";
      state.authError = "";
      sessionStorage.removeItem("marketing_token");
      stopStreams();
      render();
      return;
    }
    if (act === "refresh") { await refreshAll(); toast("Refreshed.", "ok"); return; }
    if (act === "seed-nyc") {
      const r = await api("POST", "/api/seed/nyc");
      if (r.ok) { toast("Seeded NYC $10k launch.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "autopilot-tick") {
      const camp = activeCampaign();
      const r = await api("POST", "/api/autopilot/tick", camp ? { campaignId: camp.id } : {});
      if (r.ok) { toast("Autopilot tick complete.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "toggle-daemon") {
      const ep = state.daemon.enabled ? "/api/daemon/stop" : "/api/daemon/start";
      const r = await api("POST", ep);
      if (r.ok) { state.daemon = r.data; toast("Autopilot daemon " + (state.daemon.enabled ? "started" : "stopped") + ".", "ok"); render(); }
      return;
    }
    if (act === "toggle-billing") {
      const camp = activeCampaign();
      if (!camp) { toast("No active campaign.", "warn"); return; }
      const nextArmed = !camp.billingArmed;
      const runToggle = async function () {
        const r = await api("POST", "/api/campaigns/" + encodeURIComponent(camp.id) + "/risk-dial", { riskDial: camp.riskDial, billingArmed: nextArmed });
        if (r.ok) { toast("Billing " + (nextArmed ? "armed" : "disarmed") + ".", nextArmed ? "warn" : "ok"); await refreshAll(); }
      };
      if (nextArmed) {
        state.modal = {
          title: "Arm Live Billing?",
          message: "Allows authorized spend up to " + usd(camp.dailyCapCents) + "/day and " + usd(camp.monthlyBudgetCents) + "/month.",
          danger: false,
          confirmLabel: "Arm Billing",
          onConfirm: runToggle,
        };
        render();
      } else {
        await runToggle();
      }
      return;
    }
    if (act === "scan-devices") {
      const r = await api("POST", "/api/devices/scan");
      if (r.ok) { state.diagnostics = r.data && r.data.diagnostics ? r.data.diagnostics : null; toast("USB/WDA device scan complete.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "bandit-rebalance") {
      const camp = activeCampaign();
      const r = await api("POST", "/api/bandit/rebalance", camp ? { campaignId: camp.id } : {});
      if (r.ok) { toast("Bandit weights updated.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "agent-pause" || act === "agent-resume") {
      const ep = act === "agent-pause" ? "pause" : "resume";
      const r = await api("POST", "/api/agents/" + encodeURIComponent(el.dataset.id) + "/" + ep);
      if (r.ok) { toast("Agent " + ep + "d.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "human-stop") {
      const hid = el.dataset.id;
      state.modal = {
        title: "Add to Global STOP Fence?",
        message: "Blocks all future outreach, device actions, and agent turns for this person.",
        danger: true,
        confirmLabel: "Apply STOP",
        onConfirm: async function () {
          const r = await api("POST", "/api/humans/" + encodeURIComponent(hid) + "/stop", { reason: "operator_ui" });
          if (r.ok) { toast("STOP fence applied.", "destructive"); await refreshAll(); }
        },
      };
      render();
      return;
    }
    if (act === "proof-approve" || act === "proof-reject") {
      const verdict = act === "proof-approve" ? "verified" : "rejected";
      const r = await api("POST", "/api/proofs/" + encodeURIComponent(el.dataset.id) + "/review", { verdict: verdict });
      if (r.ok) { toast("Proof marked " + verdict + ".", verdict === "verified" ? "ok" : "warn"); await refreshAll(); }
      return;
    }
    if (act === "run-discovery") {
      const r = await api("POST", "/api/discovery/nyc", { city: state.cityFilter === "all" ? "nyc" : state.cityFilter, includeSources: state.selectedDiscoverySources });
      if (r.ok) {
        state.discoveredLeads = (r.data && r.data.leads) || [];
        toast("Discovered " + state.discoveredLeads.length + " open-web leads.", "ok");
        render();
      }
      return;
    }
    if (act === "promote-lead") {
      const lead = state.discoveredLeads[Number(el.dataset.idx)];
      if (!lead) return;
      const r = await api("POST", "/api/humans", {
        handleOrEmailHmac: "lead:" + lead.dedupeKey,
        displayLabel: lead.title,
        channel: "email",
        role: lead.category === "vip" ? "vip" : lead.category === "creator" ? "creator" : "venue",
        city: lead.city || "nyc",
      });
      if (r.ok) { toast("Added lead to Humans.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "dispatch-outreach") {
      const camp = activeCampaign();
      const r = await api("POST", "/api/outreach/dispatch", { campaignId: camp ? camp.id : undefined, dryRun: true });
      if (r.ok) { toast("Outreach dispatch complete.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "bd-contract") {
      const r = await api("POST", "/api/bd/" + encodeURIComponent(el.dataset.id) + "/contract", { kind: "venue_placement" });
      if (r.ok) { toast("SHA-256 clickwrap generated.", "ok"); state.drawer = null; await refreshAll(); }
      return;
    }
    if (act === "vip-draft-invite") {
      const r = await api("POST", "/api/vips/" + encodeURIComponent(el.dataset.id) + "/invite", {});
      if (r.ok) { toast("VIP <75w invite drafted.", "ok"); await refreshAll(); }
      return;
    }
    if (act === "bd-verify-phone" || act === "bd-advance") {
      const deal = state.bdDeals.find(function (x) { return x.id === el.dataset.id; });
      if (!deal) return;
      if (act === "bd-verify-phone") {
        const r = await api("PATCH", "/api/bd/" + encodeURIComponent(deal.id), { phoneCallbackVerified: true });
        if (r.ok) { toast("Phone callback verified.", "ok"); state.drawer = null; await refreshAll(); }
      } else {
        const idx = BD_STAGES.indexOf(deal.stage);
        const nextStage = BD_STAGES[Math.min(BD_STAGES.length - 1, idx + 1)];
        const r = await api("POST", "/api/bd/" + encodeURIComponent(deal.id) + "/stage", { stage: nextStage });
        if (r.ok) { toast("BD stage -> " + nextStage + ".", "ok"); state.drawer = null; await refreshAll(); }
      }
    }
  });

  document.addEventListener("change", async function (e) {
    const t = e.target;
    if (!t || !t.dataset) return;
    if (t.dataset.changeCampaign) {
      state.selectedCampaignId = t.value;
      await refreshAll();
    } else if (t.dataset.filter === "city") {
      state.cityFilter = t.value;
      render();
    } else if (t.dataset.agentProvider) {
      const id = t.dataset.agentProvider;
      const agent = state.agents.find(function (a) { return a.id === id; });
      if (!agent) return;
      const r = await api("POST", "/api/agents/" + encodeURIComponent(id) + "/provider", { provider: t.value });
      if (r.ok) {
        toast("Switched " + agent.displayName + " to " + t.value + ".", "ok");
        await refreshAll();
      }
    } else if (t.dataset.discSrc) {
      const src = t.dataset.discSrc;
      if (t.checked && !state.selectedDiscoverySources.includes(src)) state.selectedDiscoverySources.push(src);
      if (!t.checked) state.selectedDiscoverySources = state.selectedDiscoverySources.filter(function (s) { return s !== src; });
    }
  });

  document.addEventListener("input", function (e) {
    if (e.target && e.target.id === "global-search") {
      state.search = e.target.value;
      render();
      const inp = document.getElementById("global-search");
      if (inp) { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }
    }
  });

  document.addEventListener("submit", async function (e) {
    const form = e.target && e.target.closest ? e.target.closest("form[data-form]") : null;
    if (!form) return;
    e.preventDefault();
    const kind = form.dataset.form;
    const fd = new FormData(form);
    const get = function (k) { return String(fd.get(k) || "").trim(); };

    if (kind === "signin") {
      state.token = get("token");
      state.authError = "";
      sessionStorage.setItem("marketing_token", state.token);
      await refreshAll();
      void startSse();
      return;
    }

    let r = { ok: false };
    if (kind === "new-campaign") {
      r = await api("POST", "/api/campaigns", {
        name: get("name"), slug: get("slug"), city: get("city"), appId: get("appId"),
        monthlyBudgetCents: Math.round(Number(get("monthlyUsd")) * 100),
        dailyCapCents: Math.round(Number(get("dailyUsd")) * 100),
        maxTaskCents: Math.round(Number(get("maxTaskUsd")) * 100),
      });
    } else if (kind === "new-agent") {
      r = await api("POST", "/api/agents", {
        personaId: get("personaId"), displayName: get("displayName"), appId: get("appId"),
        provider: get("provider"), dailyTurnCap: Number(get("dailyTurnCap")) || 60,
      });
    } else if (kind === "agent-tick") {
      r = await api("POST", "/api/agents/" + encodeURIComponent(get("id")) + "/tick", {
        prompt: get("prompt"), dryRun: fd.get("dryRun") === "on", allowFailover: fd.get("allowFailover") === "on",
      });
    } else if (kind === "new-device") {
      r = await api("POST", "/api/devices", { label: get("label"), platform: get("platform"), serialOrUdid: get("serialOrUdid") });
    } else if (kind === "device-action") {
      const k = get("kind");
      const action = k === "tap" ? { kind: "tap", x: 120, y: 240 } : { kind: k };
      r = await api("POST", "/api/devices/" + encodeURIComponent(get("id")) + "/action", { action: action, dryRun: fd.get("dryRun") === "on" });
    } else if (kind === "new-human") {
      r = await api("POST", "/api/humans", {
        displayLabel: get("displayLabel"), handleOrEmailHmac: get("handleOrEmailHmac"),
        role: get("role"), channel: get("channel"), lowestAge: Number(get("lowestAge")) || null,
      });
    } else if (kind === "new-task") {
      r = await api("POST", "/api/tasks", {
        campaignId: get("campaignId"), tier: 4, taskKind: get("taskKind"), title: get("title"),
        briefText: get("briefText"), vendorChannel: get("vendorChannel"),
        amountCents: Math.round(Number(get("amountUsd")) * 100), qrBatchCode: get("qrBatchCode") || null,
      });
    } else if (kind === "submit-proof") {
      r = await api("POST", "/api/proofs", {
        taskId: get("taskId"), proofKind: get("proofKind"), evidenceUrl: get("evidenceUrl"),
        workerAge: Number(get("workerAge")) || null, qrScansCount: Number(get("qrScansCount")) || 0,
        verifiedSignupsCount: Number(get("verifiedSignupsCount")) || 0,
        ftcDisclosed: fd.get("ftcDisclosed") === "on", geoTimeValid: fd.get("geoTimeValid") === "on",
        likenessReleaseOk: fd.get("likenessReleaseOk") === "on",
      });
    } else if (kind === "new-bd") {
      r = await api("POST", "/api/bd", {
        campaignId: get("campaignId"), venueName: get("venueName"), vertical: get("vertical"),
        offeredCents: Math.round(Number(get("offeredUsd")) * 100), contactEmail: get("contactEmail") || null, businessPhone: get("businessPhone") || null,
      });
    } else if (kind === "new-qr") {
      r = await api("POST", "/api/qr-batches", {
        campaignId: get("campaignId"), batchCode: get("batchCode"), printQty: Number(get("printQty")) || 5000, destinationUrl: get("destinationUrl"),
      });
    } else if (kind === "new-vip") {
      r = await api("POST", "/api/vips", {
        campaignId: get("campaignId"), name: get("name"), archetype: get("archetype"), publicSource: "manual_ui", organization: get("organization") || null, sourceUrl: get("sourceUrl") || null,
      });
    } else if (kind === "new-video") {
      r = await api("POST", "/api/videos", {
        campaignId: get("campaignId"), title: get("title"), agentId: get("agentId"), platform: get("platform"),
        hook: get("hook"), script: get("script"), ftcDisclosed: fd.get("ftcDisclosed") === "on",
      });
    } else if (kind === "slop-preview") {
      r = await api("POST", "/api/slop-cash/preview", { taskId: get("taskId"), vaultChain: get("vaultChain") });
    }

    if (r.ok) {
      state.drawer = null;
      toast("Saved.", "ok");
      await refreshAll();
    }
  });

  document.addEventListener("keydown", function (e) {
    const inField = e.target && e.target.closest && e.target.closest("input, textarea, select");
    if (e.key === "Escape") {
      if (state.modal) { state.modal = null; render(); return; }
      if (state.drawer) { state.drawer = null; render(); return; }
      if (state.search) { state.search = ""; render(); return; }
      return;
    }
    if (inField || e.metaKey || e.ctrlKey || e.altKey || !state.token) return;
    if (e.key === "/") {
      e.preventDefault();
      const s = document.getElementById("global-search");
      if (s) s.focus();
      return;
    }
    if (e.key === "?") { state.modal = { kind: "help" }; render(); return; }
    if (e.key === "r" || e.key === "R") { void refreshAll(); toast("Refreshed.", "ok"); return; }
    const idx = Number(e.key) - 1;
    if (idx >= 0 && idx < VIEWS.length) {
      state.view = VIEWS[idx].id;
      render();
    }
  });

  render();
  if (state.token) {
    void refreshAll();
    void startSse();
  }
})();
`;
}
