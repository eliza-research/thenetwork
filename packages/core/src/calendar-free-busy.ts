import {
  calendarBusyIntervalLimit, calendarCoverageAllowed, calendarGrantCurrent, calendarIntervalWithin, calendarIntervalsOverlap,
  calendarObservationCurrent, calendarObservationFresh, calendarSchedulingPurpose, calendarSignal, calendarSource,
} from "./generated/calendarFreeBusy.ts";

export interface CalendarInterval { start: number; end: number }

export interface CalendarAvailabilityEvidence {
  observedAt: number;
  expiresAt: number;
  coverage: CalendarInterval;
  busy: readonly CalendarInterval[];
}

export interface CalendarFreeBusyScope {
  app: string;
  memberId: string;
  purpose: typeof calendarSchedulingPurpose;
  now: number;
}

export interface CalendarFreeBusyGrant {
  app: string;
  memberId: string;
  purpose: typeof calendarSchedulingPurpose;
  provider: typeof calendarSource;
  connectionId: string;
  active: boolean;
  grantedAt: number;
  expiresAt: number;
}

/** Trusted scheduling view. The grant is resolved independently of the untrusted provider payload. */
export type CalendarFreeBusyAuthority = (scope: CalendarFreeBusyScope) => {
  grant: CalendarFreeBusyGrant;
  observation: unknown;
} | undefined;

function timestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function record(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const o = value as Record<string, unknown>, own = Object.keys(o);
  return own.length === keys.length && keys.every(key => Object.hasOwn(o, key)) ? o : undefined;
}

function interval(value: unknown): CalendarInterval | undefined {
  const o = record(value, ["start", "end"]);
  return o && timestamp(o.start) && timestamp(o.end) && o.start < o.end ? { start: o.start, end: o.end } : undefined;
}

/** Decode only bounded, connection-bound, anonymous free/busy intervals. Never retain the input. */
export function readCalendarFreeBusy(
  scope: CalendarFreeBusyScope, localOptIn: boolean, eligibleOwner: boolean, authority?: CalendarFreeBusyAuthority,
): CalendarAvailabilityEvidence | undefined {
  if (!authority || !localOptIn || !eligibleOwner || !timestamp(scope.now)) return;
  try {
    const current = authority({ ...scope });
    if (!current) return;
    const { grant } = current;
    if (!grant || typeof grant.connectionId !== "string" || !grant.connectionId.trim() || grant.connectionId.length > 128
      || !timestamp(grant.grantedAt) || !timestamp(grant.expiresAt)) return;
    if (!calendarGrantCurrent(localOptIn, eligibleOwner, grant.active === true,
      grant.app === scope.app && grant.memberId === scope.memberId && grant.purpose === calendarSchedulingPurpose && grant.provider === calendarSource,
      grant.grantedAt, grant.expiresAt, scope.now)) return;

    const source = record(current.observation, ["app", "memberId", "purpose", "provider", "connectionId", "observedAt", "coverage", "busy"]);
    if (!source || !timestamp(source.observedAt) || !Array.isArray(source.busy) || source.busy.length > calendarBusyIntervalLimit) return;
    const exactScope = source.app === scope.app && source.memberId === scope.memberId && source.purpose === scope.purpose
      && source.provider === grant.provider && source.connectionId === grant.connectionId;
    const coverage = interval(source.coverage);
    if (!coverage || !calendarCoverageAllowed(coverage.start, coverage.end, source.busy.length)) return;
    const busy: CalendarInterval[] = [];
    for (const raw of source.busy) {
      const block = interval(raw);
      if (!block || !calendarIntervalWithin(coverage.start, coverage.end, block.start, block.end)) return;
      busy.push(block);
    }
    if (!calendarObservationCurrent(exactScope, true, grant.grantedAt, source.observedAt, scope.now)) return;
    return { observedAt: source.observedAt, expiresAt: grant.expiresAt, coverage, busy };
  } catch {
    return;
  }
}

export function calendarAvailability(evidence: CalendarAvailabilityEvidence | undefined, slot: CalendarInterval, now: number): "unknown" | "busy" | "free" {
  if (!evidence || !timestamp(now) || !timestamp(slot.start) || !timestamp(slot.end) || slot.start >= slot.end) return "unknown";
  const current = now < evidence.expiresAt && calendarObservationFresh(evidence.observedAt, now);
  if (!current) return "unknown";
  const overlap = evidence.busy.some(b => calendarIntervalsOverlap(slot.start, slot.end, b.start, b.end));
  const covered = calendarIntervalWithin(evidence.coverage.start, evidence.coverage.end, slot.start, slot.end);
  switch (calendarSignal(current, overlap, covered)) {
    case "CalendarBusy": return "busy";
    case "CalendarFree": return "free";
    case "CalendarUnknown": return "unknown";
  }
}

/** Only the member's exact scheduling preference command changes local consent. */
export function calendarPreferenceCommand(body: string): "enabled" | "disabled" | undefined {
  const command = /^\W*(?:yes,?\s+)?calendar(\s+off)?\W*$/i.exec(body);
  return command ? command[1] ? "disabled" : "enabled" : undefined;
}
