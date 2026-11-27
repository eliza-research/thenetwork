import {
  ALL_SEED_VENUES,
  applyVenueFeedback,
  chooseFairMidpoint,
  defaultLocalSufficiencyThreshold,
  findNeighborhood,
  getCity,
  MINUTE,
  needsPreRecommendOpenCheck,
  pickPrimaryAndBackupVenue,
  shouldFetchExternalVenues,
  type City,
  type MemberId,
  type MemberVenuePrefs,
  type PrimaryBackupVenuePick,
  type ProviderClosureSignal,
  type VenueFeedbackOutcome,
  type VenueFeedbackReport,
  type VenueRankRequest,
  type VenueRecord,
} from "@thenetwork/core";
import type { VenueFeedbackExtracted, VenueIssue } from "./classify.ts";

export type ExternalOpenResult =
  | ProviderClosureSignal
  | "operational"
  | "closed_temporary"
  | "closed_permanent";

export interface ExternalVenueProvider {
  search(city: City, area: string, nowMs: number): Promise<VenueRecord[]>;
  checkOpen?(venue: VenueRecord, nowMs: number): Promise<ExternalOpenResult>;
}

export interface VenueManagerState {
  venues: VenueRecord[];
  visited: [MemberId, string[]][];
  rejected: [MemberId, string[]][];
  externalFetchCount: number;
  openCheckCount: number;
  customCatalog?: boolean;
}

function normalizeProviderCode(code: ExternalOpenResult | undefined): ProviderClosureSignal | undefined {
  if (!code) return undefined;
  switch (code) {
    case "ProviderOpen":
    case "operational":
      return "ProviderOpen";
    case "ProviderTemporaryClosed":
    case "closed_temporary":
      return "ProviderTemporaryClosed";
    case "ProviderPermanentClosed":
    case "closed_permanent":
      return "ProviderPermanentClosed";
  }
}

function cloneVenue(v: VenueRecord): VenueRecord {
  const personaPriors: VenueRecord["personaPriors"] = {};
  for (const [k, p] of Object.entries(v.personaPriors)) {
    personaPriors[k] = { alpha: p.alpha, beta: p.beta };
  }
  return {
    ...v,
    hours: v.hours.map(h => ({ ...h })),
    ...(v.hobbies !== undefined ? { hobbies: [...v.hobbies] } : {}),
    ...(v.cuisineTags !== undefined ? { cuisineTags: [...v.cuisineTags] } : {}),
    personaPriors,
  };
}

function stringArraysEqual(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function hoursEqual(a: readonly VenueRecord["hours"][number][], b: readonly VenueRecord["hours"][number][]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const ha = a[i]!;
    const hb = b[i]!;
    if (ha.weekday !== hb.weekday || ha.openMin !== hb.openMin || ha.closeMin !== hb.closeMin) return false;
  }
  return true;
}

function personaPriorsEqual(a: VenueRecord["personaPriors"], b: VenueRecord["personaPriors"]): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    const pa = a[k];
    const pb = b[k];
    if (!pa || !pb || pa.alpha !== pb.alpha || pa.beta !== pb.beta) return false;
  }
  return true;
}

function venuesEqual(a: VenueRecord, b: VenueRecord): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.city === b.city &&
    a.neighborhood === b.neighborhood &&
    a.address === b.address &&
    a.lat === b.lat &&
    a.lng === b.lng &&
    a.category === b.category &&
    a.public === b.public &&
    a.status === b.status &&
    a.priceTier === b.priceTier &&
    a.ageMin === b.ageMin &&
    a.allAges === b.allAges &&
    a.isBarOnly === b.isBarOnly &&
    a.alcoholOptional === b.alcoholOptional &&
    a.servesVegetarian === b.servesVegetarian &&
    a.servesVegan === b.servesVegan &&
    a.wheelchairAccessible === b.wheelchairAccessible &&
    a.separateChecks === b.separateChecks &&
    a.walkInGroupCapacity === b.walkInGroupCapacity &&
    a.reservationRequired === b.reservationRequired &&
    a.noiseLevel === b.noiseLevel &&
    a.liveMusicAtNight === b.liveMusicAtNight &&
    a.indoor === b.indoor &&
    a.outdoor === b.outdoor &&
    a.weatherSensitive === b.weatherSensitive &&
    a.arrivalLandmark === b.arrivalLandmark &&
    a.yelpRating === b.yelpRating &&
    a.externalPlaceId === b.externalPlaceId &&
    a.source === b.source &&
    a.lastVerifiedAt === b.lastVerifiedAt &&
    a.geoExpiresAt === b.geoExpiresAt &&
    a.closureReports === b.closureReports &&
    a.quarantinedUntil === b.quarantinedUntil &&
    a.safetyScore === b.safetyScore &&
    a.transitScore === b.transitScore &&
    a.isAlcoholCentric === b.isAlcoholCentric &&
    a.halalFriendly === b.halalFriendly &&
    a.kosherFriendly === b.kosherFriendly &&
    a.glutenFreeFriendly === b.glutenFreeFriendly &&
    a.severeAllergenSafe === b.severeAllergenSafe &&
    a.isSmokeFree === b.isSmokeFree &&
    a.openEventEligible === b.openEventEligible &&
    hoursEqual(a.hours, b.hours) &&
    stringArraysEqual(a.hobbies, b.hobbies) &&
    stringArraysEqual(a.cuisineTags, b.cuisineTags) &&
    personaPriorsEqual(a.personaPriors, b.personaPriors)
  );
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function issueToOutcome(
  issues: readonly VenueIssue[],
  closed: boolean,
  sentiment?: "liked" | "neutral" | "disliked",
): VenueFeedbackOutcome {
  if (closed) return "closed";
  if (issues.includes("too_loud")) return "too_loud";
  if (issues.includes("too_crowded")) return "crowded";
  if (issues.includes("too_expensive")) return "too_expensive";
  if (issues.includes("wrong_vibe") || issues.includes("bad_seating")) return "bad_vibe";
  if (sentiment === "disliked") return "bad_vibe";
  if (sentiment === "liked") return "great";
  return "ok";
}

const SEED_BY_ID = new Map<string, VenueRecord>(
  ALL_SEED_VENUES.filter(v => v.public === true).map(v => [v.id, v]),
);

export class VenueManager {
  private catalog = new Map<string, VenueRecord>();
  private mutatedVenueIds = new Set<string>();
  private defaultSeedMode: boolean;
  private visited = new Map<MemberId, Set<string>>();
  private rejected = new Map<MemberId, Set<string>>();
  private externalFetchCount = 0;
  private openCheckCount = 0;
  private readonly provider?: ExternalVenueProvider;
  private readonly sufficiencyThreshold: number;
  private apiBudgetRemaining: number;

  constructor(
    opts: {
      seedVenues?: readonly VenueRecord[];
      provider?: ExternalVenueProvider;
      sufficiencyThreshold?: number;
      apiBudgetRemaining?: number;
    } = {},
  ) {
    this.provider = opts.provider;
    this.sufficiencyThreshold = opts.sufficiencyThreshold ?? defaultLocalSufficiencyThreshold;
    this.apiBudgetRemaining = opts.apiBudgetRemaining ?? 100;
    this.defaultSeedMode = opts.seedVenues === undefined;
    const seeds = opts.seedVenues ?? ALL_SEED_VENUES;
    for (const v of seeds) {
      if (v.public === true) {
        this.catalog.set(v.id, cloneVenue(v));
      }
    }
  }

  private markMutation(v: VenueRecord): void {
    if (!this.defaultSeedMode) return;
    const seed = SEED_BY_ID.get(v.id);
    if (seed !== undefined && venuesEqual(v, seed)) {
      this.mutatedVenueIds.delete(v.id);
    } else {
      this.mutatedVenueIds.add(v.id);
    }
  }

  private putCatalog(v: VenueRecord): void {
    this.catalog.set(v.id, v);
    this.markMutation(v);
  }

  count(city?: City): number {
    if (!city) return this.catalog.size;
    let n = 0;
    for (const v of this.catalog.values()) if (v.city === city) n++;
    return n;
  }

  stats(): { totalVenues: number; externalFetches: number; openChecks: number } {
    return {
      totalVenues: this.catalog.size,
      externalFetches: this.externalFetchCount,
      openChecks: this.openCheckCount,
    };
  }

  getVenue(id: string): VenueRecord | undefined {
    const v = this.catalog.get(id);
    return v ? cloneVenue(v) : undefined;
  }

  listVenues(city?: City): VenueRecord[] {
    const out: VenueRecord[] = [];
    for (const v of this.catalog.values()) {
      if (!city || v.city === city) out.push(cloneVenue(v));
    }
    return out;
  }

  upsertVenue(v: VenueRecord): boolean {
    if (v.public !== true) return false;
    this.putCatalog(cloneVenue(v));
    return true;
  }

  recordVisit(memberId: MemberId, venueId: string): void {
    let s = this.visited.get(memberId);
    if (!s) {
      s = new Set();
      this.visited.set(memberId, s);
    }
    s.add(venueId);
  }

  recordRejection(memberId: MemberId, venueId: string): void {
    let s = this.rejected.get(memberId);
    if (!s) {
      s = new Set();
      this.rejected.set(memberId, s);
    }
    s.add(venueId);
  }

  visitedBy(memberId: MemberId): string[] {
    return [...(this.visited.get(memberId) ?? [])];
  }

  rejectedBy(memberId: MemberId): string[] {
    return [...(this.rejected.get(memberId) ?? [])];
  }

  excludedIdsFor(memberIds: readonly MemberId[]): Set<string> {
    const out = new Set<string>();
    for (const id of memberIds) {
      for (const vid of this.visited.get(id) ?? []) out.add(vid);
      for (const vid of this.rejected.get(id) ?? []) out.add(vid);
    }
    for (const v of this.catalog.values()) {
      if (v.status !== "active") out.add(v.id);
    }
    return out;
  }

  enrichMemberPrefs(m: MemberVenuePrefs): MemberVenuePrefs {
    const vis = new Set([...m.visitedVenueIds, ...(this.visited.get(m.memberId) ?? [])]);
    const rej = new Set([...m.rejectedVenueIds, ...(this.rejected.get(m.memberId) ?? [])]);
    return { ...m, visitedVenueIds: [...vis], rejectedVenueIds: [...rej] };
  }

  pickForMatch(request: VenueRankRequest, nowMs: number): PrimaryBackupVenuePick {
    const enriched: VenueRankRequest = {
      ...request,
      members: request.members.map(m => this.enrichMemberPrefs(m)),
    };
    const pool = this.listVenues(request.city);
    return pickPrimaryAndBackupVenue(pool, enriched, nowMs);
  }

  async pickForMatchAsync(request: VenueRankRequest, nowMs: number): Promise<PrimaryBackupVenuePick> {
    let pick = this.pickForMatch(request, nowMs);

    if (
      this.provider &&
      this.apiBudgetRemaining > 0 &&
      pick.candidates.length < this.sufficiencyThreshold &&
      shouldFetchExternalVenues(pick.candidates.length)
    ) {
      const midpoint = chooseFairMidpoint(
        request.city,
        request.memberAreas,
        request.mode === "group" ? "group" : "date",
      );
      const area =
        midpoint?.neighborhood.name ??
        request.memberAreas[0] ??
        getCity(request.city)?.neighborhoods[0]?.name ??
        "";
      this.externalFetchCount++;
      this.apiBudgetRemaining = Math.max(0, this.apiBudgetRemaining - 1);
      const fetched = await this.provider.search(request.city, area, nowMs);
      for (const v of fetched) this.upsertVenue(v);
      pick = this.pickForMatch(request, nowMs);
    }

    if (this.provider?.checkOpen) {
      const maxChecks = 3;
      for (let attempt = 0; attempt < maxChecks && pick.primary; attempt++) {
        const ageHours = Math.floor((nowMs - pick.primary.venue.lastVerifiedAt) / (60 * MINUTE));
        const isWeekend = request.isWeekendOrHoliday ?? false;
        if (!pick.primary.needsOpenCheck && !needsPreRecommendOpenCheck(ageHours, isWeekend)) break;
        this.openCheckCount++;
        const rawStatus = await this.provider.checkOpen(pick.primary.venue, nowMs);
        const providerCode = normalizeProviderCode(rawStatus) ?? "ProviderOpen";
        const closed = providerCode !== "ProviderOpen";
        const updated = applyVenueFeedback(
          pick.primary.venue,
          [],
          {
            venueId: pick.primary.venue.id,
            memberId: request.members[0]?.memberId ?? "system",
            at: nowMs,
            outcome: closed ? "closed" : "ok",
            reportedClosed: closed,
            providerCode,
          },
          nowMs,
        );
        this.putCatalog(updated);
        if (!closed) {
          pick = this.pickForMatch(request, nowMs);
          break;
        }
        pick = this.pickForMatch(request, nowMs);
      }
    }

    return pick;
  }

  recordFeedback(
    venueId: string,
    memberId: MemberId,
    memberArchetypes: string[],
    feedback: Omit<VenueFeedbackReport, "venueId" | "memberId" | "at"> | VenueFeedbackExtracted,
    nowMs: number,
  ): VenueRecord | undefined {
    const existing = this.catalog.get(venueId);
    if (!existing) return undefined;

    let report: VenueFeedbackReport;
    let shouldReject = false;
    if ("reportedClosed" in feedback) {
      report = { ...feedback, venueId, memberId, at: nowMs };
      shouldReject = feedback.outcome !== "great" && feedback.outcome !== "ok";
    } else {
      const outcome = issueToOutcome(feedback.venueIssues, feedback.venueClosed, feedback.venueSentiment);
      report = {
        venueId,
        memberId,
        at: nowMs,
        outcome,
        reportedClosed: feedback.venueClosed,
      };
      shouldReject =
        feedback.notInterested ||
        feedback.venueClosed ||
        feedback.venueIssues.length > 0 ||
        feedback.venueSentiment === "disliked";
    }

    const updated = applyVenueFeedback(existing, memberArchetypes, report, nowMs);
    this.putCatalog(updated);
    if (shouldReject) this.recordRejection(memberId, venueId);
    else this.recordVisit(memberId, venueId);
    return cloneVenue(updated);
  }

  quarantineVenue(
    venueId: string,
    memberId: MemberId,
    nowMs: number,
    providerStatus?: ExternalOpenResult,
  ): VenueRecord | undefined {
    const existing = this.catalog.get(venueId);
    if (!existing) return undefined;
    const providerCode = normalizeProviderCode(providerStatus);
    const updated = applyVenueFeedback(
      existing,
      [],
      {
        venueId,
        memberId,
        at: nowMs,
        outcome: "closed",
        reportedClosed: true,
        ...(providerCode ? { providerCode } : {}),
      },
      nowMs,
    );
    this.putCatalog(updated);
    this.recordRejection(memberId, venueId);
    return cloneVenue(updated);
  }

  recordOrganicMention(
    city: City,
    name: string,
    neighborhood: string,
    nowMs: number,
    partial: Partial<Omit<VenueRecord, "id" | "city" | "public">> = {},
  ): VenueRecord {
    const cleanName = name.trim();
    const lower = cleanName.toLowerCase();
    for (const v of this.catalog.values()) {
      if (v.city === city && v.name.toLowerCase() === lower) {
        return cloneVenue(v);
      }
    }
    const spec = getCity(city);
    const hood = findNeighborhood(city, neighborhood) ?? spec?.neighborhoods[0];
    const id = `org-${city}-${slugify(cleanName)}`;
    const isBarOnly = partial.isBarOnly ?? false;
    const record: VenueRecord = {
      id,
      name: cleanName,
      city,
      neighborhood: hood?.name ?? neighborhood,
      address: partial.address ?? `${hood?.name ?? neighborhood}, ${spec?.name ?? city}`,
      lat: partial.lat ?? hood?.lat ?? spec?.center.lat ?? 0,
      lng: partial.lng ?? hood?.lng ?? spec?.center.lng ?? 0,
      category: partial.category ?? "coffee_shop",
      public: true,
      status: "active",
      priceTier: partial.priceTier ?? 2,
      ageMin: partial.ageMin ?? (isBarOnly ? 21 : 0),
      isBarOnly,
      alcoholOptional: partial.alcoholOptional ?? !isBarOnly,
      servesVegetarian: partial.servesVegetarian ?? true,
      servesVegan: partial.servesVegan ?? true,
      wheelchairAccessible: partial.wheelchairAccessible ?? true,
      separateChecks: partial.separateChecks ?? true,
      walkInGroupCapacity: partial.walkInGroupCapacity ?? 6,
      reservationRequired: partial.reservationRequired ?? false,
      noiseLevel: partial.noiseLevel ?? "conversational",
      liveMusicAtNight: partial.liveMusicAtNight ?? false,
      indoor: partial.indoor ?? true,
      outdoor: partial.outdoor ?? false,
      weatherSensitive: partial.weatherSensitive ?? false,
      arrivalLandmark: partial.arrivalLandmark ?? `Inside the main entrance of ${cleanName}`,
      hours:
        partial.hours ??
        [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, openMin: 8 * 60, closeMin: 22 * 60 })),
      source: partial.source ?? "listing",
      lastVerifiedAt: partial.lastVerifiedAt ?? nowMs,
      closureReports: 0,
      safetyScore: partial.safetyScore ?? 8,
      transitScore: partial.transitScore ?? 4,
      personaPriors: partial.personaPriors ?? { default: { alpha: 6, beta: 2 } },
    };
    this.putCatalog(record);
    return cloneVenue(record);
  }

  forgetMember(memberId: MemberId): void {
    this.visited.delete(memberId);
    this.rejected.delete(memberId);
  }

  exportState(): VenueManagerState {
    const venues: VenueRecord[] = [];
    if (this.defaultSeedMode) {
      for (const id of this.mutatedVenueIds) {
        const v = this.catalog.get(id);
        if (v) venues.push(cloneVenue(v));
      }
    } else {
      for (const v of this.catalog.values()) {
        venues.push(cloneVenue(v));
      }
    }
    return {
      venues,
      visited: [...this.visited.entries()].map(([id, set]) => [id, [...set]]),
      rejected: [...this.rejected.entries()].map(([id, set]) => [id, [...set]]),
      externalFetchCount: this.externalFetchCount,
      openCheckCount: this.openCheckCount,
      ...(this.defaultSeedMode ? {} : { customCatalog: true }),
    };
  }

  importState(state: VenueManagerState | undefined): void {
    if (!state) return;
    this.catalog.clear();
    this.mutatedVenueIds.clear();
    this.defaultSeedMode = state.customCatalog !== true;
    if (this.defaultSeedMode) {
      for (const v of ALL_SEED_VENUES) {
        if (v.public === true) this.catalog.set(v.id, cloneVenue(v));
      }
    }
    for (const v of state.venues ?? []) {
      if (v.public === true) this.putCatalog(cloneVenue(v));
    }
    this.visited.clear();
    for (const [id, list] of state.visited ?? []) this.visited.set(id, new Set(list));
    this.rejected.clear();
    for (const [id, list] of state.rejected ?? []) this.rejected.set(id, new Set(list));
    this.externalFetchCount = state.externalFetchCount ?? 0;
    this.openCheckCount = state.openCheckCount ?? 0;
  }
}
