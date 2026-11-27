import { LeakGuard } from "./guard.ts";
import { cityTimezone } from "./time.ts";

export const SMS_MAX_CHARS = 360;

export function cityTzLabel(city?: string | null): string {
  const key = city?.trim().toLowerCase();
  if (!key || key === "nyc") return "New York time";
  const tz = cityTimezone(key);
  if (tz === "America/Los_Angeles") return "Pacific time";
  if (tz === "America/Chicago") return "Central time";
  if (tz === "America/Denver") return "Mountain time";
  if (tz === "America/New_York") return "Eastern time";
  return tz ? `${tz} time` : "local time";
}

export function cleanPhrase(text: string): string {
  return text.replace(/_/g, " ").replace(/\?/g, "").replace(/\s+/g, " ").trim();
}

export function clampSms(text: string, fallback?: string, maxLen = SMS_MAX_CHARS): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  const candidate = fallback ? fallback.replace(/\s+/g, " ").trim() : normalized;
  if (candidate.length <= maxLen) return candidate;
  const hasQuestion = candidate.endsWith("?");
  const suffix = hasQuestion ? "...?" : "...";
  const cut = Math.max(0, maxLen - suffix.length);
  const head = candidate.slice(0, cut).replace(/[\s,.;:!?]+$/, "");
  return `${head}${suffix}`;
}

function stripAllowedTokens(text: string, allow?: readonly string[]): string {
  if (!allow?.length) return text;
  let out = text;
  for (const token of allow) {
    if (!token) continue;
    out = out.split(token).join(" ");
  }
  return out;
}

export interface StyleViolationOptions {
  firstContact?: boolean;
  contactAllow?: readonly string[];
}

export function styleViolations(text: string, opts: StyleViolationOptions = {}): string[] {
  const v: string[] = [];
  if (text.length > SMS_MAX_CHARS) v.push("too_long");
  if ((text.match(/\?/g) ?? []).length > 1) v.push("more_than_one_question");
  const scrubbed = stripAllowedTokens(text, opts.contactAllow);
  if (/\+?\d{3}[-.\s]\d{3}[-.\s]\d{4}|@\w+\.\w+/.test(scrubbed)) v.push("contact_details");
  if (/!{2,}|you won't believe|act now|last chance/i.test(text)) v.push("pushy");
  if (opts.firstContact && !/STOP/.test(text)) v.push("missing_opt_out");
  if (/\b(?:reply|text|say|send|type)\s+["'“]?cancel\b/i.test(text)) v.push("asks_cancel");
  if (/\bthey (?:say they )?(?:plays|has|does|works|teaches|gives|cooks|throws|shoots|sings|edits|loves|ha|doe|[A-Z]{2,}|[a-z]+ (?:engineer|designer|player))\b|\b(?:asked me for|someone for) (?:meet|make|find|get|play|join|go|try|start|be|learn)\b/.test(text)) v.push("grammar");
  if (/\b[a-z]+_[a-z_]+\b/.test(scrubbed)) v.push("raw_tag");
  return v;
}

export function validateSmsCopyRules(text: string, opts: StyleViolationOptions = {}): string[] {
  return styleViolations(text, opts);
}

export interface OutboundSmsValidationOptions extends StyleViolationOptions {
  leakGuard?: LeakGuard;
  forbidden?: string[];
  facts?: string[];
  contacts?: boolean;
}

export function validateOutboundSms(text: string, opts: OutboundSmsValidationOptions = {}): string[] {
  const violations = styleViolations(text, opts);
  const allow = opts.contactAllow ? [...opts.contactAllow] : undefined;
  const guard =
    opts.leakGuard ??
    new LeakGuard({
      allow,
      contacts: opts.contacts ?? true,
      forbidden: opts.forbidden,
      facts: opts.facts,
    });
  const leaks = guard.check(text, { contactAllow: allow });
  return [...violations, ...leaks];
}

export interface TopOneVenueSuggestionOptions {
  partner?: string;
  why?: string;
  pivot?: number;
  mode?: "date" | "group" | "solo" | "professional";
  maxPivots?: number;
  exhausted?: boolean;
}

export function formatTopOneVenueSuggestion(
  venue: string,
  area: string,
  when: string,
  opts: TopOneVenueSuggestionOptions = {}
): string {
  if (opts.exhausted) {
    return "Looks like my picks aren't hitting the mark. Want to name a public spot you like nearby, or try again next week?";
  }
  const v = cleanPhrase(venue);
  const a = cleanPhrase(area);
  const w = cleanPhrase(when);
  const partner = opts.partner ? cleanPhrase(opts.partner) : undefined;
  const why = opts.why ? ` (${cleanPhrase(opts.why)})` : "";
  const pivot = opts.pivot ?? 0;
  const maxPivots = opts.maxPivots ?? 3;
  const mode = opts.mode;

  let text: string;
  if (pivot <= 0) {
    if (partner && (mode === undefined || mode === "date" || mode === "professional")) {
      text = `You're both in: meet ${partner} ${w} at ${v} in ${a}${why}. Works for you, or want to swap the spot or vibe?`;
    } else if (mode === "group") {
      text = `I picked ${v} in ${a} for ${w}${why}. Works for you, or want to swap the spot?`;
    } else if (mode === "professional") {
      text = `Quiet spot for ${w}: ${v} in ${a}${why}. Works for you, or want to swap the spot?`;
    } else {
      text = `Top pick for ${w}: ${v} in ${a}${why}. Works for you, or want to swap the spot?`;
    }
  } else if (pivot >= maxPivots - 1) {
    text = `Got it. How about ${v} in ${a} for ${w}${why}, or want to name a public spot you prefer?`;
  } else {
    text = `Fair call. How about ${v} in ${a} for ${w}${why} instead?`;
  }
  return clampSms(text, `How about ${v} in ${a} for ${w}?`);
}

export function formatCrowdExpectation(
  mode: "network_curated" | "external_open",
  opts: { interest?: string; platforms?: string; sparseAnchor?: boolean; cityName?: string; brandName?: string } = {}
): string {
  const brand = cleanPhrase(opts.brandName || "the Network");
  if (mode === "network_curated") {
    return clampSms(
      `This is a small ${brand} meetup — everyone coming is a confirmed member of the group.`,
      "This is a small meetup — everyone coming is a confirmed member of the group."
    );
  }
  const interest = cleanPhrase(opts.interest || "this meetup");
  const platforms = cleanPhrase(opts.platforms || "Luma/Meetup");
  if (opts.sparseAnchor) {
    const cityBit = opts.cityName ? ` in ${cleanPhrase(opts.cityName)}` : "";
    return clampSms(
      `Heads up: you'll help host ${interest}${cityBit} with local guests we checked from ${platforms}. If fewer than 3 people confirm 24 hours before, I'll cancel early so you don't waste a trip.`,
      "Heads up: this is an open meetup with local guests we checked. If fewer than 3 people confirm 24 hours before, I'll cancel early."
    );
  }
  return clampSms(
    `Heads up: this is an open ${interest} meetup with regulars from ${brand} plus local guests from ${platforms} we checked beforehand. Free public meetups sometimes have last-minute changes, so we invite a few extra.`,
    "Heads up: this is an open meetup with regulars from the group plus local guests we checked beforehand, so we invite a few extra."
  );
}

export function formatBackupVenuePivot(
  primaryVenue: string,
  backupVenue: string,
  reason: "full" | "closed",
  opts: { address?: string; landmark?: string } = {}
): string {
  const p = cleanPhrase(primaryVenue);
  const b = cleanPhrase(backupVenue);
  const why = reason === "full" ? "is full" : "is closed";
  const addr = opts.address ? ` (${cleanPhrase(opts.address)})` : "";
  const landmark = opts.landmark ? ` Meet ${cleanPhrase(opts.landmark)}.` : "";
  return clampSms(
    `Quick pivot: ${p} ${why}, so let's meet at ${b}${addr} instead.${landmark} Reply if your plans change.`,
    `Quick pivot: ${p} ${why}, so let's meet at ${b} instead. Reply if your plans change.`
  );
}

export function formatAnchorOrQuorumCancel(
  reason: "anchor_drop" | "low_quorum" | "co_anchor_promoted",
  opts: { activity?: string; when?: string; venue?: string } = {}
): string {
  const act = cleanPhrase(opts.activity || "this meetup");
  const when = opts.when ? ` ${cleanPhrase(opts.when)}` : "";
  const venue = opts.venue ? ` at ${cleanPhrase(opts.venue)}` : "";
  if (reason === "co_anchor_promoted") {
    return clampSms(
      `Quick update: our host changed, so ${act}${when}${venue} is still on as planned. Reply if your plans change.`,
      `Quick update: our host changed, so ${act} is still on. Reply if your plans change.`
    );
  }
  if (reason === "anchor_drop") {
    return clampSms(
      `Quick update: ${act}${when} is off since the host can't make it, sorry about that. I'll look for another time soon.`,
      "Quick update: this meetup is off since the host can't make it, sorry about that. I'll look for another time."
    );
  }
  return clampSms(
    `Quick update: not enough people came together for ${act}${when}, so I'm calling it early so you don't waste a trip. I'll keep an eye out for next week.`,
    "Quick update: not enough people came together this time, so I'm calling it early. I'll keep an eye out for next week."
  );
}
