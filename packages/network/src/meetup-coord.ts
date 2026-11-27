import {
  canBeMatched,
  evaluateArrivalRelaySafe,
  evaluateBackupPivotV2,
  evaluateNoShow,
  evaluateVenueQuarantine,
  formatBackupVenuePivot,
  LeakGuard,
  MINUTE,
  shouldPivotToBackupV2,
  shouldQuarantineVenue,
  type AppId,
  type ArrivalState,
  type ArrivalUpdate,
  type City,
  type MeetupPhase,
  type MemberId,
  type Owned,
  type VenueRecord,
} from "@thenetwork/core";
import { meetupPhase } from "../../core/src/generated/meetupCoordination.ts";
import { RELAY_RULES } from "../../engine/src/relay.ts";
import { appearanceLeak } from "../../engine/src/packs/slop/appearance.ts";
import { whenPhrase } from "./copy.ts";
import { tzForCity } from "./outreach.ts";
import type { VenueManager } from "./venue-manager.ts";

const PRE_BRIEF_WIDE_START_MIN = -90;
const LATE_NOTICE_EARLY_START_MIN = -60;

function evaluateMeetupPhase(nowMs: number, startMs: number, allMet = false): MeetupPhase {
  if (allMet) return "closed";
  const deltaMin = Math.floor((nowMs - startMs) / MINUTE);
  if (deltaMin >= PRE_BRIEF_WIDE_START_MIN && deltaMin < -75) return "pre_brief";
  return meetupPhase(deltaMin) as MeetupPhase;
}

function canPivotBackup(
  reportedClosed: boolean,
  reportedFull: boolean,
  hasVerifiedBackup: boolean,
  nowMs: number,
  startMs: number,
  alreadyPivoted: boolean,
): boolean {
  const deltaMin = Math.floor((nowMs - startMs) / MINUTE);
  const effectiveNowMs = deltaMin >= PRE_BRIEF_WIDE_START_MIN && deltaMin < -75 ? startMs - 75 * MINUTE : nowMs;
  return evaluateBackupPivotV2(reportedClosed, reportedFull, hasVerifiedBackup, effectiveNowMs, startMs, alreadyPivoted);
}

export const GROUP_DIGEST_DEBOUNCE_MS = 75_000;

export interface MeetupPartyInfo {
  id: MemberId;
  firstName: string;
  lastName?: string;
  age: number | undefined;
  optedOut: boolean;
  confirmed: boolean;
}

export interface ProvisionalNoShowEvent {
  readonly oppId: string;
  readonly missingMemberIds: readonly MemberId[];
  readonly arrivedMemberIds: readonly MemberId[];
  readonly at: number;
}

export interface MeetupCoordHost {
  venues: VenueManager;
  party(meetupId: string, id: MemberId): MeetupPartyInfo | undefined;
  blocked(a: MemberId, b: MemberId): boolean;
  panicTriggered?(meetupId: string, senderId: MemberId, recipientId: MemberId): boolean;
  privateFacts(): { forbidden: Owned[]; canaries: string[] };
  ratesPhotos: boolean;
  send(
    to: MemberId,
    body: string,
    meta: {
      meetupId: string;
      kind: "pre_brief" | "arrival_relay" | "arrival_ack" | "backup_pivot" | "no_show_ping" | "waiting_notice";
    },
  ): void;
}

export interface MeetupCoordRecord {
  meetupId: string;
  oppId?: string;
  app: AppId;
  city: City;
  mode: "one_to_one" | "group";
  startMs: number;
  participants: MemberId[];
  confirmed: MemberId[];
  primaryVenueId: string;
  backupVenueId?: string;
  activeVenueId: string;
  venueName?: string;
  venueAddress?: string;
  arrivalLandmark?: string;
  pivoted: boolean;
  preBriefSent: boolean;
  met: boolean;
  closed: boolean;
  noShowPingSent: boolean;
  waitingNotified: boolean;
  firstArrivedAtMs?: number;
  arrivedIds: MemberId[];
  checkedInIds: MemberId[];
  updates: ArrivalUpdate[];
  pendingDigest: ArrivalUpdate[];
  lastDigestAt?: number;
}

export interface ParsedArrival {
  state: ArrivalState;
  etaMinutes?: number;
  safeOutfitCue?: string;
  spotLandmark?: string;
}

export interface ArrivalHandleResult {
  handled: boolean;
  meetupId?: string;
  phase?: MeetupPhase;
  state?: ArrivalState;
  relayedTo: MemberId[];
  queuedDigest?: boolean;
  pivotedToVenueId?: string;
  blockedReason?: string;
}

export interface MeetupCoordState {
  meetups: MeetupCoordRecord[];
}

const PII_PHONE_RX = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const PII_EMAIL_RX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PII_HANDLE_RX = /(?:^|\s)@[A-Za-z0-9_.]{2,}/g;
const PII_URL_RX = /https?:\/\/\S+|www\.\S+/gi;

const OUTFIT_COLORS =
  "red|blue|green|black|white|grey|gray|yellow|orange|purple|pink|brown|tan|beige|navy|olive|maroon|burgundy|cream|denim|plaid|striped";
const OUTFIT_MODIFIERS =
  "leather|floral|puffer|trench|baseball|bucket|jean|canvas|linen|wool|knit|knitted|oversized|vintage|checkered|hooded|dark|light|bright|long|short";
const OUTFIT_ITEMS =
  "jacket|coat|sweater|hoodie|shirt|t-shirt|tee|dress|blouse|blazer|vest|hat|cap|baseball\\s+cap|beanie|scarf|backpack|tote(?:\\s+bag)?|bag|glasses|sunglasses|cardigan|flannel|pullover|windbreaker|parka|trench";
const OUTFIT_RX = new RegExp(
  `\\b(?:(?:a|an|my|the)\\s+)?((?:${OUTFIT_COLORS})(?:\\s+(?:and\\s+(?:${OUTFIT_COLORS})))?\\s+(?:${OUTFIT_ITEMS}))\\b`,
  "i",
);
const OUTFIT_UNCOLORED_RX = new RegExp(
  `\\b(?:wearing|in|got\\s+on|carrying|with)\\s+(?:(?:a|an|my|the)\\s+)?((?:(?:${OUTFIT_MODIFIERS})\\s+)?(?:${OUTFIT_ITEMS}))\\b`,
  "i",
);

const LANDMARK_RX =
  /\b((?:by|near|at|outside|inside|in front of|next to|under)\s+(?:the\s+)?(?:main\s+|front\s+|back\s+|side\s+|corner\s+|window\s+|patio\s+)?(?:entrance|door|bar|counter|window|patio|tables?|booths?|benches?|clock|arch(?:way)?|fountain|stairs|steps|host\s+stand|awning|sign|gate|lobby|courtyard|atrium|garden|bridge|overlook|plaza))\b/i;

const ETA_RX = /\b(?:in\s+(?:about\s+|like\s+)?|about\s+|like\s+)?(\d{1,2})(?:\s*-\s*\d{1,2})?\s*(?:min|mins|minutes?|m(?=\s*(?:out|away|late|behind|$|[.,!?])))\b/i;

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeArrivalCue(text: string, lastNames: readonly string[] = []): string {
  let out = text
    .replace(PII_PHONE_RX, "")
    .replace(PII_EMAIL_RX, "")
    .replace(PII_HANDLE_RX, "")
    .replace(PII_URL_RX, "");
  for (const last of lastNames) {
    const clean = last.trim();
    if (clean.length < 2) continue;
    out = out.replace(new RegExp(`\\b${escapeRegex(clean)}\\b`, "gi"), "");
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 80);
}

export function parseArrivalText(body: string, lastNames: readonly string[] = []): ParsedArrival | undefined {
  const raw = body.trim();
  if (!raw) return undefined;
  const cleanedRaw = sanitizeArrivalCue(raw, lastNames);
  const t = raw.toLowerCase().replace(/[\u2018\u2019\u02bc]/g, "'");

  let state: ArrivalState | undefined;
  if (
    /\b(?:it'?s|it is|(?:the\s+)?(?:place|spot|venue|cafe|coffee\s+shop|bar|restaurant|bakery|brewery|shop|store|park)\s+(?:is|was)|they(?:'re| are)?)\s+(?:permanently\s+|temporarily\s+)?(?:closed(?:\s+early|\s+today|\s+down)?|shut\s*down|shuttered|locked\s*up|boarded\s*up|not\s+open)\b|\b(?:closed\s+(?:for\s+a\s+private\s+event|early|today)|doors?\s+(?:are|is)\s+locked|sign\s+says\s+closed|boarded\s*up)\b/.test(
      t,
    )
  ) {
    state = "venue_closed";
  } else if (
    /\b(?:(?:it'?s|it is|(?:the\s+)?(?:place|spot|venue|cafe|coffee\s+shop|bar|restaurant|bakery|brewery|shop|patio|room)\s+(?:is|was)|they(?:'re| are))\s+(?:completely\s+|totally\s+|super\s+|way\s+too\s+|too\s+)?(?:full|packed|at\s+capacity|over\s+capacity|sold\s+out|crowded\s+out)|no\s+(?:tables?|seats?|seating|space|room)\s+(?:left|available|open)|(?:long|huge|crazy|\d+\s*(?:min|mins|minute|minutes|hour|hours)|hour)\s+wait(?:\s+for\s+a\s+table)?|line\s+(?:is\s+)?(?:out\s+the\s+door|around\s+the\s+block|crazy)|fully\s+booked|packed\s+out|at\s+capacity)\b/.test(
      t,
    )
  ) {
    state = "venue_full";
  } else if (
    /\b(?:found\s+(?:each\s+other|them|him|her|everyone|the\s+group|you)|spotted\s+(?:them|him|her|everyone)|we\s+met|we'?re\s+together|i'?m\s+with\s+(?:them|him|her)|im\s+with\s+(?:them|him|her)|i\s+see\s+(?:them|him|her|you|everyone)|met\s+up|all\s+here\s+together|sitting\s+together|(?:i'?m\s+|im\s+)?with\s+(?!a\b|an\b|the\b|my\b|our\b|no\b|some\b|any\b)[a-z][a-z'-]+\s+now|sitting\s+with\s+(?!a\b|an\b|the\b|my\b|our\b|no\b|some\b|any\b)[a-z][a-z'-]+|(?:found|met)\s+(?!a\b|an\b|the\b|my\b|our\b|no\b|some\b|any\b|out\b|it\b)[a-z][a-z'-]+(?:\s+now)?(?=\s*(?:$|[.,!?;])))\b/.test(
      t,
    )
  ) {
    state = "met";
  } else if (
    /\b(?:can'?t\s+(?:find|spot)|cant\s+(?:find|spot)|cannot\s+find|don'?t\s+see\s+(?:you|u|them|anyone)|dont\s+see\s+(?:you|u|them|anyone)|where\s+(?:are|r)\s+(?:you|u|y'?all|everyone)|looking\s+for\s+(?:you|u|them|everyone)|which\s+(?:entrance|table|door)|lost\s+trying\s+to\s+find)\b/.test(
      t,
    )
  ) {
    state = "cannot_find";
  } else if (
    /\b(?:seated|got\s+(?:us\s+)?a\s+(?:table|booth|spot)|grabbed\s+(?:a\s+table|seats?|a\s+booth)|at\s+a\s+(?:table|booth)|sitting\s+(?:at|by|near|on|outside|inside)|saved\s+a\s+table|found\s+(?:a\s+table|seats?))\b/.test(
      t,
    )
  ) {
    state = "seated";
  } else if (
    /^\s*here[.!?\s]*$/.test(t) ||
    /\b(?:i'?m\s+(?:here|outside|out\s+front)|im\s+(?:here|outside|out\s+front)|i\s+am\s+here|just\s+(?:arrived|got\s+here|walked\s+in|pulled\s+up|made\s+it)|made\s+it|here\s+now|i\s+arrived|waiting\s+(?:by|at|outside|inside|near|out\s+front)|standing\s+(?:by|at|outside|inside|near|out\s+front)|at\s+the\s+(?:entrance|door|bar|patio))\b/.test(
      t,
    )
  ) {
    state = "arrived";
  } else if (
    /\b(?:runn?i?n?g?\s+(?:(?:about|like)\s+)?(?:a\s+few\s+(?:min|mins|minutes?)\s+|\d+\s*(?:min|mins|minutes?|m)\s+)?(?:late|behind)|(?:gonna|going\s+to|gunna|will)\s+be\s+(?:a\s+few\s+(?:min|mins|minutes?)\s+|\d+\s*(?:min|mins|minutes?|m)\s+)?late|be\s+(?:a\s+few\s+mins?\s+|\d+\s*(?:min|mins|minutes?)\s+)?late|late\s+by\s+\d+|\d+\s*(?:min|mins|minutes?|m)\s+(?:late|behind)|delayed|stuck\s+in\s+traffic|traffic\s+is\s+(?:bad|crazy|awful)|(?:train|subway|bus)\s+(?:is\s+)?(?:delayed|stuck)|sorry\s+i'?m\s+late)\b/.test(
      t,
    )
  ) {
    state = "late";
  } else if (
    /^\s*(?:in\s+)?(?:about\s+|like\s+)?\d{1,2}\s*(?:min|mins|minutes?)(?:\s+(?:out|away))?[.!]*\s*$/.test(t) ||
    /\b(?:on\s+(?:my|the)\s+way|omw|otw|en\s*route|head(?:ing|ed)\s+(?:over|there|now)|leaving\s+now|almost\s+there|\d+\s*(?:min|mins|minutes?|m)\s+(?:away|out)|(?:be\s+there|arriving|getting\s+there)\s+in\s+(?:about\s+)?\d{1,2}\s*(?:min|mins|minutes?)|walking\s+(?:over|there)|in\s+(?:an?\s+)?(?:uber|lyft|cab|taxi)|just\s+left)\b/.test(
      t,
    )
  ) {
    state = "en_route";
  }

  if (!state) return undefined;

  const etaMatch = ETA_RX.exec(t);
  const etaMinutes = etaMatch ? Math.min(90, Math.max(1, Number(etaMatch[1]))) : undefined;
  const outfitMatch = OUTFIT_RX.exec(cleanedRaw) ?? OUTFIT_UNCOLORED_RX.exec(cleanedRaw);
  const safeOutfitCue = outfitMatch ? sanitizeArrivalCue(outfitMatch[1]!, lastNames) : undefined;
  const landmarkMatch = LANDMARK_RX.exec(cleanedRaw);
  const spotLandmark = landmarkMatch ? sanitizeArrivalCue(landmarkMatch[1]!, lastNames) : undefined;

  return {
    state,
    ...(etaMinutes !== undefined ? { etaMinutes } : {}),
    ...(safeOutfitCue ? { safeOutfitCue } : {}),
    ...(spotLandmark ? { spotLandmark } : {}),
  };
}

function formatSingleUpdate(firstName: string, update: ArrivalUpdate): string {
  const details = [
    update.safeOutfitCue ? `wearing ${update.safeOutfitCue}` : undefined,
    update.spotLandmark,
  ]
    .filter(Boolean)
    .join(", ");
  const suffix = details ? ` (${details})` : "";
  switch (update.state) {
    case "en_route":
      return `${firstName} is on the way${update.etaMinutes ? ` (about ${update.etaMinutes} min out)` : ""}.`;
    case "late":
      return `${firstName} is running${update.etaMinutes ? ` about ${update.etaMinutes} min` : " a few min"} late.`;
    case "arrived":
      return `${firstName} just arrived${suffix}.`;
    case "seated":
      return `${firstName} is seated${suffix}.`;
    case "cannot_find":
      return `${firstName} is looking for you${suffix}.`;
    case "met":
      return `${firstName} checked in that you found each other. Have a great time!`;
    case "venue_closed":
      return `${firstName} reported the spot is closed.`;
    case "venue_full":
      return `${firstName} reported the spot is full.`;
    default:
      return `${firstName} sent an arrival update${suffix}.`;
  }
}

export class MeetupCoordinator {
  private meetups = new Map<string, MeetupCoordRecord>();
  private readonly host: MeetupCoordHost;
  private readonly digestDebounceMs: number;
  private readonly onProvisionalNoShow?: (event: ProvisionalNoShowEvent) => void;

  constructor(
    host: MeetupCoordHost,
    opts: { digestDebounceMs?: number; onProvisionalNoShow?: (event: ProvisionalNoShowEvent) => void } = {},
  ) {
    this.host = host;
    this.digestDebounceMs = opts.digestDebounceMs ?? GROUP_DIGEST_DEBOUNCE_MS;
    this.onProvisionalNoShow = opts.onProvisionalNoShow;
  }

  registerMeetup(input: {
    meetupId: string;
    oppId?: string;
    app: AppId;
    city: City;
    startMs: number;
    participants: MemberId[];
    confirmed?: MemberId[];
    primaryVenueId: string;
    backupVenueId?: string;
    venueName?: string;
    venueAddress?: string;
    arrivalLandmark?: string;
  }): MeetupCoordRecord {
    const mode: "one_to_one" | "group" = input.participants.length >= 3 ? "group" : "one_to_one";
    const record: MeetupCoordRecord = {
      meetupId: input.meetupId,
      ...(input.oppId ? { oppId: input.oppId } : {}),
      app: input.app,
      city: input.city,
      mode,
      startMs: input.startMs,
      participants: [...input.participants],
      confirmed: [...(input.confirmed ?? input.participants)],
      primaryVenueId: input.primaryVenueId,
      ...(input.backupVenueId ? { backupVenueId: input.backupVenueId } : {}),
      activeVenueId: input.primaryVenueId,
      ...(input.venueName ? { venueName: input.venueName } : {}),
      ...(input.venueAddress ? { venueAddress: input.venueAddress } : {}),
      ...(input.arrivalLandmark ? { arrivalLandmark: input.arrivalLandmark } : {}),
      pivoted: false,
      preBriefSent: false,
      met: false,
      closed: false,
      noShowPingSent: false,
      waitingNotified: false,
      arrivedIds: [],
      checkedInIds: [],
      updates: [],
      pendingDigest: [],
    };
    this.meetups.set(record.meetupId, record);
    return record;
  }

  getMeetup(meetupId: string): MeetupCoordRecord | undefined {
    return this.meetups.get(meetupId);
  }

  activeMeetupFor(memberId: MemberId, nowMs: number): MeetupCoordRecord | undefined {
    for (const m of this.meetups.values()) {
      if (m.closed || m.met) continue;
      if (!m.confirmed.includes(memberId)) continue;
      const phase = evaluateMeetupPhase(nowMs, m.startMs, m.met);
      if (phase === "active_arrival" || phase === "pre_brief") return m;
    }
    return undefined;
  }

  /** Record a late check-in handled by the existing groupLateArrival path without duplicating its relay. */
  recordLateCheckIn(meetupId: string, memberId: MemberId, nowMs: number): void {
    const meetup = this.meetups.get(meetupId);
    if (!meetup || meetup.closed || meetup.met) return;
    if (!meetup.checkedInIds.includes(memberId)) meetup.checkedInIds.push(memberId);
    meetup.updates.push({ meetupId, memberId, state: "late", at: nowMs });
  }

  private meetupHasMinor(meetup: MeetupCoordRecord): boolean {
    for (const id of meetup.participants) {
      const p = this.host.party(meetup.meetupId, id);
      if (!p || !canBeMatched(p.age)) return true;
    }
    return false;
  }

  /** True only when a teen meetup is on friends/ntwrk and every member is strictly aged 13-18 (zero adults 19+). */
  private teenOnlyFriendMeetup(meetup: MeetupCoordRecord): boolean {
    if (meetup.app !== "friends" && meetup.app !== "ntwrk") return false;
    if (meetup.participants.length < 2) return false;
    let hasMinor = false;
    for (const id of meetup.participants) {
      const age = this.host.party(meetup.meetupId, id)?.age;
      if (age === undefined || age < 13 || age > 18) return false;
      if (age < 18) hasMinor = true;
    }
    return hasMinor;
  }

  private lastNamesFor(meetup: MeetupCoordRecord): string[] {
    const out: string[] = [];
    for (const id of meetup.participants) {
      const last = this.host.party(meetup.meetupId, id)?.lastName;
      if (last) out.push(last);
    }
    return out;
  }

  private buildSafetyGuards(): { rawGuard: LeakGuard; outGuard: LeakGuard } {
    const facts = this.host.privateFacts();
    return {
      rawGuard: new LeakGuard({
        forbidden: facts.forbidden,
        canaries: facts.canaries,
        contacts: false,
      }),
      outGuard: new LeakGuard({
        forbidden: facts.forbidden,
        canaries: facts.canaries,
      }),
    };
  }

  private passesSafety(
    rawBody: string,
    rendered: string,
    senderId: MemberId,
    recipientId: MemberId,
    guards: { rawGuard: LeakGuard; outGuard: LeakGuard },
  ): { leakClean: boolean; safetyClean: boolean; reason?: string } {
    for (const rule of RELAY_RULES) {
      if (rule.re.test(rawBody) || rule.re.test(rendered)) {
        return { leakClean: true, safetyClean: false, reason: rule.code };
      }
    }
    if (this.host.ratesPhotos && (appearanceLeak(rawBody) || appearanceLeak(rendered))) {
      return { leakClean: true, safetyClean: false, reason: "rating:appearance" };
    }
    const rawLeaks = guards.rawGuard.check(rawBody, { exceptOwner: senderId });
    if (rawLeaks.length > 0) return { leakClean: false, safetyClean: true, reason: `leak:${rawLeaks[0]}` };
    const outLeaks = guards.outGuard.check(rendered, { exceptOwner: recipientId });
    if (outLeaks.length > 0) return { leakClean: false, safetyClean: true, reason: `leak:${outLeaks[0]}` };
    return { leakClean: true, safetyClean: true };
  }

  private resolveVenue(
    venueId: string,
    fallback?: MeetupCoordRecord,
  ): { name: string; address: string; landmark: string } {
    const v: VenueRecord | undefined = this.host.venues.getVenue(venueId);
    if (v) {
      return {
        name: v.name,
        address: v.address,
        landmark: v.arrivalLandmark,
      };
    }
    return {
      name: fallback?.venueName ?? venueId,
      address: fallback?.venueAddress ?? "",
      landmark: fallback?.arrivalLandmark ?? "near the main entrance",
    };
  }

  handleInbound(senderId: MemberId, body: string, nowMs: number, meetupId?: string): ArrivalHandleResult {
    const meetup = meetupId ? this.meetups.get(meetupId) : this.activeMeetupFor(senderId, nowMs);
    if (!meetup || meetup.closed || meetup.met) {
      return { handled: false, relayedTo: [] };
    }
    const phase = evaluateMeetupPhase(nowMs, meetup.startMs, meetup.met);
    if (phase === "before" || phase === "closed") {
      if (phase === "closed") meetup.closed = true;
      return { handled: false, meetupId: meetup.meetupId, phase, relayedTo: [] };
    }

    const parsed = parseArrivalText(body, this.lastNamesFor(meetup));
    if (!parsed) return { handled: false, meetupId: meetup.meetupId, phase, relayedTo: [] };

    const sender = this.host.party(meetup.meetupId, senderId);
    if (!sender || !sender.confirmed) return { handled: false, meetupId: meetup.meetupId, phase, relayedTo: [] };

    const anyMinorInEvent = this.meetupHasMinor(meetup);
    if (anyMinorInEvent) {
      if ((parsed.state === "venue_closed" || parsed.state === "venue_full") && this.teenOnlyFriendMeetup(meetup)) {
        const reportedClosed = parsed.state === "venue_closed";
        const reportedFull = parsed.state === "venue_full";
        if (evaluateVenueQuarantine(reportedClosed, reportedFull)) {
          this.host.venues.quarantineVenue(meetup.activeVenueId, senderId, nowMs);
        }
        const backup = meetup.backupVenueId ? this.host.venues.getVenue(meetup.backupVenueId) : undefined;
        const teenSafeBackup = !!backup && backup.status === "active" && backup.ageMin === 0 && !backup.isBarOnly;
        const canPivot = evaluateBackupPivotV2(reportedClosed, reportedFull, teenSafeBackup, nowMs, meetup.startMs, meetup.pivoted);
        if (canPivot && backup) {
          meetup.activeVenueId = backup.id;
          meetup.pivoted = true;
          meetup.pendingDigest = [];
          const relayedTo: MemberId[] = [];
          const primaryName = this.resolveVenue(meetup.primaryVenueId, meetup).name;
          const reasonText = reportedFull ? "is full" : "is closed";
          const msg = `Quick pivot: ${primaryName} ${reasonText}, so the meetup moved to ${backup.name} (${backup.address}). Look for each other ${backup.arrivalLandmark}.`;
          for (const recipientId of meetup.confirmed) {
            const rec = this.host.party(meetup.meetupId, recipientId);
            if (!rec || rec.optedOut || rec.age === undefined || rec.age < 13 || rec.age > 18) continue;
            if (
              recipientId !== senderId &&
              (this.host.blocked(senderId, recipientId) ||
                this.host.panicTriggered?.(meetup.meetupId, senderId, recipientId))
            ) {
              continue;
            }
            this.host.send(recipientId, msg, { meetupId: meetup.meetupId, kind: "backup_pivot" });
            relayedTo.push(recipientId);
          }
          return {
            handled: true,
            meetupId: meetup.meetupId,
            phase,
            state: parsed.state,
            relayedTo,
            pivotedToVenueId: backup.id,
          };
        }
        return { handled: true, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo: [] };
      }
      return {
        handled: false,
        meetupId: meetup.meetupId,
        phase,
        state: parsed.state,
        relayedTo: [],
        blockedReason: "minor_policy",
      };
    }

    const update: ArrivalUpdate = {
      meetupId: meetup.meetupId,
      memberId: senderId,
      state: parsed.state,
      at: nowMs,
      ...(parsed.etaMinutes !== undefined ? { etaMinutes: parsed.etaMinutes } : {}),
      ...(parsed.safeOutfitCue ? { safeOutfitCue: parsed.safeOutfitCue } : {}),
      ...(parsed.spotLandmark ? { spotLandmark: parsed.spotLandmark } : {}),
    };
    meetup.updates.push(update);
    if (!meetup.checkedInIds.includes(senderId)) meetup.checkedInIds.push(senderId);
    if ((parsed.state === "arrived" || parsed.state === "seated") && !meetup.arrivedIds.includes(senderId)) {
      meetup.arrivedIds.push(senderId);
      if (meetup.firstArrivedAtMs === undefined) {
        meetup.firstArrivedAtMs = Math.max(meetup.startMs, nowMs);
      }
    }

    if (parsed.state === "venue_closed" || parsed.state === "venue_full") {
      const reportedClosed = parsed.state === "venue_closed";
      const reportedFull = parsed.state === "venue_full";
      if (evaluateVenueQuarantine(reportedClosed, reportedFull)) {
        this.host.venues.quarantineVenue(meetup.activeVenueId, senderId, nowMs);
      }
      const backup = meetup.backupVenueId ? this.host.venues.getVenue(meetup.backupVenueId) : undefined;
      const canPivot = canPivotBackup(
        reportedClosed,
        reportedFull,
        !!backup && backup.status === "active",
        nowMs,
        meetup.startMs,
        meetup.pivoted,
      );
      const primaryName = this.resolveVenue(meetup.activeVenueId, meetup).name;
      if (canPivot && backup) {
        meetup.activeVenueId = backup.id;
        meetup.pivoted = true;
        meetup.pendingDigest = [];
        const relayedTo: MemberId[] = [];
        const msg = formatBackupVenuePivot(primaryName, backup.name, reportedFull ? "full" : "closed", {
          address: backup.address,
          landmark: backup.arrivalLandmark,
        });
        for (const recipientId of meetup.confirmed) {
          const rec = this.host.party(meetup.meetupId, recipientId);
          if (!rec || rec.optedOut || !canBeMatched(rec.age)) continue;
          if (
            recipientId !== senderId &&
            (this.host.blocked(senderId, recipientId) ||
              this.host.panicTriggered?.(meetup.meetupId, senderId, recipientId))
          ) {
            continue;
          }
          this.host.send(recipientId, msg, { meetupId: meetup.meetupId, kind: "backup_pivot" });
          relayedTo.push(recipientId);
        }
        return {
          handled: true,
          meetupId: meetup.meetupId,
          phase,
          state: parsed.state,
          relayedTo,
          pivotedToVenueId: backup.id,
        };
      }
      const noBackupMsg = reportedFull
        ? `Heads up: ${primaryName} was reported full and I don't have a verified backup nearby right now. Let me know if you find space nearby or want to pick another public spot.`
        : `Heads up: ${primaryName} was reported closed and I don't have a verified backup nearby right now. Let me know if you pick another public spot nearby or want to reschedule.`;
      const relayedTo: MemberId[] = [];
      for (const recipientId of meetup.confirmed) {
        const rec = this.host.party(meetup.meetupId, recipientId);
        if (!rec || rec.optedOut || !canBeMatched(rec.age)) continue;
        if (recipientId !== senderId && this.host.blocked(senderId, recipientId)) continue;
        this.host.send(recipientId, noBackupMsg, { meetupId: meetup.meetupId, kind: "backup_pivot" });
        relayedTo.push(recipientId);
      }
      return { handled: true, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo };
    }

    if (parsed.state === "met") {
      meetup.met = true;
      meetup.closed = true;
      meetup.pendingDigest = [];
      return { handled: true, meetupId: meetup.meetupId, phase: "closed", state: "met", relayedTo: [] };
    }

    const deltaMin = Math.floor((nowMs - meetup.startMs) / MINUTE);
    const earlyLateAllowed = phase === "pre_brief" && parsed.state === "late" && deltaMin >= LATE_NOTICE_EARLY_START_MIN;
    if (phase !== "active_arrival" && !earlyLateAllowed) {
      if (phase === "pre_brief") {
        const note = parsed.state === "late"
          ? `Got it — noted you're running${parsed.etaMinutes ? ` about ${parsed.etaMinutes} min` : ""} late. I'll keep everyone posted as meetup time gets closer.`
          : "Got it — noted. I'll keep everyone posted as meetup time gets closer.";
        if (!sender.optedOut) {
          this.host.send(senderId, note, { meetupId: meetup.meetupId, kind: "arrival_ack" });
        }
        return { handled: true, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo: [] };
      }
      return { handled: false, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo: [] };
    }
    const relayNowMs = earlyLateAllowed ? Math.max(nowMs, meetup.startMs - 30 * MINUTE) : nowMs;

    const rendered = formatSingleUpdate(sender.firstName, update);
    const recipients = meetup.confirmed.filter(id => id !== senderId);
    const allowedRecipients: MemberId[] = [];
    let blockedReason: string | undefined;
    const guards = this.buildSafetyGuards();

    for (const recipientId of recipients) {
      const rec = this.host.party(meetup.meetupId, recipientId);
      if (!rec) continue;
      const panicTriggered = Boolean(this.host.panicTriggered?.(meetup.meetupId, senderId, recipientId));
      if (panicTriggered) {
        blockedReason = "panic_triggered";
      }
      const safety = this.passesSafety(body, rendered, senderId, recipientId, guards);
      if (!safety.leakClean || !safety.safetyClean) {
        blockedReason = safety.reason;
      }
      const allowed = evaluateArrivalRelaySafe({
        senderAge: sender.age ?? 0,
        recipientAge: rec.age ?? 0,
        anyMinorInEvent,
        senderConfirmed: sender.confirmed,
        recipientConfirmed: rec.confirmed,
        blocked: this.host.blocked(senderId, recipientId),
        panicTriggered,
        senderOptedOut: sender.optedOut,
        recipientOptedOut: rec.optedOut,
        nowMs: relayNowMs,
        startMs: meetup.startMs,
        alreadyMet: meetup.met,
        passedSafetyAndLeakCheck: safety.leakClean && safety.safetyClean,
      });
      if (allowed) allowedRecipients.push(recipientId);
    }

    if (allowedRecipients.length === 0) {
      return {
        handled: true,
        meetupId: meetup.meetupId,
        phase,
        state: parsed.state,
        relayedTo: [],
        ...(blockedReason ? { blockedReason } : {}),
      };
    }

    if (meetup.mode === "group" && parsed.state !== "cannot_find") {
      meetup.pendingDigest.push(update);
      if (meetup.lastDigestAt === undefined) meetup.lastDigestAt = nowMs;
      if (nowMs - meetup.lastDigestAt >= this.digestDebounceMs) {
        const flushed = this.flushGroupDigest(meetup, nowMs);
        if (!sender.optedOut && flushed.length > 0) {
          this.host.send(senderId, "Got it — I've updated the group.", { meetupId: meetup.meetupId, kind: "arrival_ack" });
        }
        return { handled: true, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo: flushed };
      }
      if (!sender.optedOut) {
        this.host.send(senderId, "Got it — I'll pass that along to the group shortly.", { meetupId: meetup.meetupId, kind: "arrival_ack" });
      }
      return { handled: true, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo: [], queuedDigest: true };
    }

    for (const recipientId of allowedRecipients) {
      this.host.send(recipientId, rendered, { meetupId: meetup.meetupId, kind: "arrival_relay" });
    }
    if (!sender.optedOut) {
      const ack = parsed.state === "late"
        ? "Got it — I let them know you're running late."
        : parsed.state === "arrived" || parsed.state === "seated"
          ? "Got it — I let them know you're there."
          : parsed.state === "cannot_find"
            ? "Got it — I let them know you're looking for them."
            : "Got it — I've passed that along.";
      this.host.send(senderId, ack, { meetupId: meetup.meetupId, kind: "arrival_ack" });
    }
    return { handled: true, meetupId: meetup.meetupId, phase, state: parsed.state, relayedTo: allowedRecipients };
  }

  private flushGroupDigest(meetup: MeetupCoordRecord, nowMs: number): MemberId[] {
    const anyMinorInEvent = this.meetupHasMinor(meetup);
    if (meetup.pendingDigest.length === 0 || meetup.closed || meetup.met || anyMinorInEvent) return [];
    const phase = evaluateMeetupPhase(nowMs, meetup.startMs, meetup.met);
    if (phase !== "active_arrival") return [];
    const batch = meetup.pendingDigest.splice(0, meetup.pendingDigest.length);
    meetup.lastDigestAt = nowMs;
    const sentTo: MemberId[] = [];
    const guards = this.buildSafetyGuards();

    for (const recipientId of meetup.confirmed) {
      const rec = this.host.party(meetup.meetupId, recipientId);
      if (!rec) continue;
      const lines: string[] = [];
      for (const u of batch) {
        if (u.memberId === recipientId) continue;
        const sender = this.host.party(meetup.meetupId, u.memberId);
        if (!sender) continue;
        const line = formatSingleUpdate(sender.firstName, u);
        const panicTriggered = Boolean(this.host.panicTriggered?.(meetup.meetupId, u.memberId, recipientId));
        const safety = this.passesSafety(line, line, u.memberId, recipientId, guards);
        const ok = evaluateArrivalRelaySafe({
          senderAge: sender.age ?? 0,
          recipientAge: rec.age ?? 0,
          anyMinorInEvent,
          senderConfirmed: sender.confirmed,
          recipientConfirmed: rec.confirmed,
          blocked: this.host.blocked(u.memberId, recipientId),
          panicTriggered,
          senderOptedOut: sender.optedOut,
          recipientOptedOut: rec.optedOut,
          nowMs,
          startMs: meetup.startMs,
          alreadyMet: meetup.met,
          passedSafetyAndLeakCheck: safety.leakClean && safety.safetyClean,
        });
        if (ok) lines.push(line);
      }
      if (lines.length > 0) {
        const digest = `Arrival update: ${lines.join(" ")}`;
        this.host.send(recipientId, digest, { meetupId: meetup.meetupId, kind: "arrival_relay" });
        sentTo.push(recipientId);
      }
    }
    return sentTo;
  }

  tick(nowMs: number, opts: { proactiveBriefs?: boolean } = {}): {
    preBriefs: string[];
    digestsFlushed: string[];
    noShowPings: string[];
    waitingNotices: string[];
    closed: string[];
  } {
    const proactiveBriefs = opts.proactiveBriefs ?? true;
    const summary = {
      preBriefs: [] as string[],
      digestsFlushed: [] as string[],
      noShowPings: [] as string[],
      waitingNotices: [] as string[],
      closed: [] as string[],
    };

    for (const meetup of this.meetups.values()) {
      if (meetup.closed) continue;
      const phase = evaluateMeetupPhase(nowMs, meetup.startMs, meetup.met);

      if (phase === "closed" || meetup.met) {
        if (!meetup.met && meetup.arrivedIds.length > 0) {
          const missingMemberIds = meetup.confirmed.filter(id => !meetup.checkedInIds.includes(id));
          if (missingMemberIds.length > 0) {
            this.onProvisionalNoShow?.({
              oppId: meetup.meetupId,
              missingMemberIds,
              arrivedMemberIds: [...meetup.arrivedIds],
              at: nowMs,
            });
          }
        }
        meetup.closed = true;
        meetup.pendingDigest = [];
        summary.closed.push(meetup.meetupId);
        continue;
      }

      if (this.meetupHasMinor(meetup)) continue;

      if (proactiveBriefs && phase === "pre_brief" && !meetup.preBriefSent) {
        meetup.preBriefSent = true;
        const v = this.resolveVenue(meetup.activeVenueId, meetup);
        const backup = meetup.backupVenueId ? this.host.venues.getVenue(meetup.backupVenueId) : undefined;
        const backupNote = backup ? ` Backup: ${backup.name}.` : "";
        const when = whenPhrase(meetup.startMs, tzForCity(meetup.city));
        for (const id of meetup.confirmed) {
          const rec = this.host.party(meetup.meetupId, id);
          if (!rec || rec.optedOut || !canBeMatched(rec.age)) continue;
          const others = meetup.confirmed
            .filter(x => x !== id && !this.host.blocked(id, x))
            .map(x => this.host.party(meetup.meetupId, x)?.firstName)
            .filter((n): n is string => !!n);
          const withWho = others.length ? ` with ${others.join(", ")}` : "";
          const addr = v.address ? ` (${v.address})` : "";
          const brief = `Heads up for ${when}${withWho}: ${v.name}${addr}. Meet ${v.landmark}.${backupNote} Text me when you head over or arrive and I'll help you find each other.`;
          this.host.send(id, brief, { meetupId: meetup.meetupId, kind: "pre_brief" });
        }
        summary.preBriefs.push(meetup.meetupId);
      }

      if (phase === "active_arrival" && meetup.mode === "group" && meetup.pendingDigest.length > 0) {
        if (meetup.lastDigestAt === undefined || nowMs - meetup.lastDigestAt >= this.digestDebounceMs) {
          const sent = this.flushGroupDigest(meetup, nowMs);
          if (sent.length > 0) summary.digestsFlushed.push(meetup.meetupId);
        }
      }

      if (phase === "active_arrival" && meetup.confirmed.length >= 2 && meetup.arrivedIds.length > 0) {
        const missingIds = meetup.confirmed.filter(id => !meetup.checkedInIds.includes(id));
        const partnerCheckedIn = missingIds.length === 0;
        const arrivedAtMs = meetup.firstArrivedAtMs ?? meetup.startMs;
        const decision = evaluateNoShow(
          nowMs,
          arrivedAtMs,
          meetup.arrivedIds.length > 0,
          partnerCheckedIn,
          meetup.noShowPingSent,
          meetup.waitingNotified,
        );

        if (decision === "ping_late") {
          meetup.noShowPingSent = true;
          for (const id of missingIds) {
            const rec = this.host.party(meetup.meetupId, id);
            if (!rec || rec.optedOut || !canBeMatched(rec.age)) continue;
            this.host.send(id, "Quick check: are you still able to make it? Let me know so I can update everyone.", {
              meetupId: meetup.meetupId,
              kind: "no_show_ping",
            });
          }
          summary.noShowPings.push(meetup.meetupId);
        } else if (decision === "notify_waiting") {
          meetup.waitingNotified = true;
          for (const id of meetup.arrivedIds) {
            const rec = this.host.party(meetup.meetupId, id);
            if (!rec || rec.optedOut || !canBeMatched(rec.age)) continue;
            this.host.send(
              id,
              "Still haven't heard back from the others. No pressure to keep waiting if you'd rather head out — let me know how it goes.",
              { meetupId: meetup.meetupId, kind: "waiting_notice" },
            );
          }
          summary.waitingNotices.push(meetup.meetupId);
        }
      }
    }

    return summary;
  }

  removeMember(memberId: MemberId, meetupId?: string): void {
    for (const m of this.meetups.values()) {
      if (meetupId !== undefined && m.meetupId !== meetupId && m.oppId !== meetupId) continue;
      m.confirmed = m.confirmed.filter(id => id !== memberId);
      m.arrivedIds = m.arrivedIds.filter(id => id !== memberId);
      if (m.confirmed.length < 2) m.closed = true;
    }
  }

  exportState(clone = true): MeetupCoordState {
    const state: MeetupCoordState = { meetups: [...this.meetups.values()] };
    return clone ? (JSON.parse(JSON.stringify(state)) as MeetupCoordState) : state;
  }

  importState(state: MeetupCoordState | undefined, clone = true): void {
    this.meetups.clear();
    if (!state) return;
    for (const m of state.meetups ?? []) {
      this.meetups.set(m.meetupId, clone ? (JSON.parse(JSON.stringify(m)) as MeetupCoordRecord) : m);
    }
  }
}
