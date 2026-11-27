import type { City, Facet, Member, MemberId, Presence } from "@thenetwork/core";
import { ADULT_AGE, canBeMatched, DAY, EngineRng, findNeighborhood, getCity } from "@thenetwork/core";
import { tokenize } from "./embed.ts";
import { hood } from "./packs/friends/geo.ts";
import { MARKET_ANCHOR_ZIP, normalizeZip, zipCentroid, zipForArea } from "./packs/slop/zips.ts";

export function canIndexMember(age: number, adultMin: number, held: boolean, paused: boolean): boolean {
  if (!canBeMatched(age) || !(age >= adultMin)) return false;
  if (held || paused) return false;
  return true;
}

export function bandsOverlap(bA: number, bB: number, radius: number): boolean {
  if (!(radius >= 0)) return false;
  const diff = bA >= bB ? bA - bB : bB - bA;
  return diff <= radius;
}

export function agesOverlap(ageA: number, minA: number, maxA: number, ageB: number, minB: number, maxB: number): boolean {
  if (!canBeMatched(ageA) || !canBeMatched(ageB)) return false;
  return ageB >= minA && ageB <= maxA && ageA >= minB && ageA <= maxB;
}

export function ageRangesOverlap(loA: number, hiA: number, loB: number, hiB: number): boolean {
  if (!(loA <= hiA) || !(loB <= hiB)) return false;
  if (!canBeMatched(hiA) || !canBeMatched(hiB)) return false;
  return loA <= hiB && loB <= hiA;
}

export function shouldUseExactScan(shardSize: number, threshold: number): boolean {
  return shardSize < threshold;
}

export const EXACT_SCAN_THRESHOLD = 400;
export const AVAIL_WORDS = 6;

const NUM_STRATA_BANDS = 10;
const LSH_TABLES = 8;
const LSH_BITS = 7;

export type HexResolution = 5 | 6 | 7;
const HEX_EDGE_KM: Record<HexResolution, number> = {
  5: 9.85,
  6: 3.72,
  7: 1.41,
};

const SQRT3 = 1.7320508075688772;
const DEG_TO_RAD = Math.PI / 180;

export interface HexCell {
  res: HexResolution;
  q: number;
  r: number;
  key: string;
}

export function latLonToHex(lat: number, lon: number, res: HexResolution = 6): HexCell {
  const edgeKm = HEX_EDGE_KM[res];
  const yKm = lat * 111.32;
  const xKm = lon * 111.32 * Math.cos(lat * DEG_TO_RAD);
  const qf = ((SQRT3 / 3) * xKm - (1 / 3) * yKm) / edgeKm;
  const rf = ((2 / 3) * yKm) / edgeKm;
  const xf = qf;
  const zf = rf;
  const yf = -xf - zf;

  let rx = Math.round(xf);
  let ry = Math.round(yf);
  let rz = Math.round(zf);
  const dx = Math.abs(rx - xf);
  const dy = Math.abs(ry - yf);
  const dz = Math.abs(rz - zf);

  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;

  const q = rx === 0 ? 0 : rx;
  const r = rz === 0 ? 0 : rz;
  return { res, q, r, key: `h${res}:${q}:${r}` };
}

export function hexGridDisk(center: HexCell, k: number): string[] {
  const ring = Math.max(0, Math.floor(k));
  const out: string[] = [];
  for (let dq = -ring; dq <= ring; dq++) {
    const rLo = Math.max(-ring, -dq - ring);
    const rHi = Math.min(ring, -dq + ring);
    for (let dr = rLo; dr <= rHi; dr++) {
      const q = center.q + dq === 0 ? 0 : center.q + dq;
      const r = center.r + dr === 0 ? 0 : center.r + dr;
      out.push(`h${center.res}:${q}:${r}`);
    }
  }
  return out;
}

export function popcnt32(x: number): number {
  let v = x >>> 0;
  v = v - ((v >>> 1) & 0x55555555);
  v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
  return (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

const hourInQuiet = (h: number, [s, e]: [number, number]): boolean =>
  s === e ? false : s < e ? h >= s && h < e : h >= s || h < e;

function setHourBit(mask: Uint32Array, offset: number, day: number, hour: number): void {
  const bit = day * 24 + hour;
  mask[offset + (bit >>> 5)]! |= (1 << (bit & 31)) >>> 0;
}

function clearHourBit(mask: Uint32Array, offset: number, day: number, hour: number): void {
  const bit = day * 24 + hour;
  mask[offset + (bit >>> 5)]! &= ~(1 << (bit & 31)) >>> 0;
}

const DAY_PATTERNS: readonly { re: RegExp; days: readonly number[] }[] = [
  { re: /\b(weekend|weekends)\b/i, days: [0, 6] },
  { re: /\b(weekday|weekdays|weeknight|weeknights)\b/i, days: [1, 2, 3, 4, 5] },
  { re: /\b(sun|sunday|sundays)\b/i, days: [0] },
  { re: /\b(mon|monday|mondays)\b/i, days: [1] },
  { re: /\b(tue|tues|tuesday|tuesdays)\b/i, days: [2] },
  { re: /\b(wed|wednesday|wednesdays)\b/i, days: [3] },
  { re: /\b(thu|thur|thurs|thursday|thursdays)\b/i, days: [4] },
  { re: /\b(fri|friday|fridays)\b/i, days: [5] },
  { re: /\b(sat|saturday|saturdays)\b/i, days: [6] },
];

const HOUR_PATTERNS: readonly { re: RegExp; hours: readonly [number, number] }[] = [
  { re: /\b(morning|mornings|breakfast|coffee)\b/i, hours: [7, 12] },
  { re: /\b(lunch|midday|noon)\b/i, hours: [11, 14] },
  { re: /\b(afternoon|afternoons|daytime)\b/i, hours: [13, 18] },
  { re: /\b(evening|evenings|night|nights|dinner|after\s*work|after\s*[567])\b/i, hours: [17, 23] },
];

export function buildWeeklyAvailabilityMask(
  quietHours: [number, number] | undefined,
  availabilityTexts: readonly string[] = [],
  target: Uint32Array = new Uint32Array(AVAIL_WORDS),
  offset = 0,
): Uint32Array {
  for (let w = 0; w < AVAIL_WORDS; w++) target[offset + w] = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      if (!quietHours || !hourInQuiet(h, quietHours)) setHourBit(target, offset, d, h);
    }
  }
  if (!availabilityTexts.length) return target;

  const stated = new Uint32Array(AVAIL_WORDS);
  let matchedAny = false;
  for (let t = 0; t < availabilityTexts.length; t++) {
    const raw = availabilityTexts[t]!;
    const days = new Set<number>();
    for (let p = 0; p < DAY_PATTERNS.length; p++) {
      if (DAY_PATTERNS[p]!.re.test(raw)) for (const d of DAY_PATTERNS[p]!.days) days.add(d);
    }
    const hourRanges: (readonly [number, number])[] = [];
    for (let p = 0; p < HOUR_PATTERNS.length; p++) {
      if (HOUR_PATTERNS[p]!.re.test(raw)) hourRanges.push(HOUR_PATTERNS[p]!.hours);
    }
    if (!days.size && !hourRanges.length) continue;
    matchedAny = true;
    const activeDays = days.size ? [...days] : [0, 1, 2, 3, 4, 5, 6];
    const activeHours: (readonly [number, number])[] = hourRanges.length ? hourRanges : [[8, 22]];
    for (const d of activeDays) {
      for (const [h0, h1] of activeHours) {
        for (let h = h0; h < h1; h++) setHourBit(stated, 0, d, h);
      }
    }
  }
  if (!matchedAny) return target;

  let overlapBits = 0;
  for (let w = 0; w < AVAIL_WORDS; w++) {
    overlapBits += popcnt32(target[offset + w]! & stated[w]!);
  }
  if (overlapBits >= 3) {
    for (let w = 0; w < AVAIL_WORDS; w++) target[offset + w] = (target[offset + w]! & stated[w]!) >>> 0;
  } else {
    for (let d = 0; d < 7; d++) {
      for (let h = 0; h < 24; h++) {
        if (quietHours && hourInQuiet(h, quietHours)) clearHourBit(target, offset, d, h);
      }
    }
  }
  return target;
}

export function weeklyMaskOverlapHours(
  masksA: Uint32Array,
  offsetA: number,
  masksB: Uint32Array,
  offsetB: number,
): number {
  let hrs = 0;
  for (let w = 0; w < AVAIL_WORDS; w++) {
    hrs += popcnt32(masksA[offsetA + w]! & masksB[offsetB + w]!);
  }
  return hrs;
}

export interface SpatialMemberVectors {
  profileEmb: readonly number[];
  capEmb: readonly number[];
  desireEmb: readonly number[];
  capFacetEmbs?: readonly (readonly number[])[];
  desireFacetEmbs?: readonly (readonly number[])[];
  matchFacetEmbs?: readonly (readonly number[])[];
}

export interface SpatialMemberInput {
  m: Member;
  held: boolean;
  tags: ReadonlySet<string>;
  profileEmb?: readonly number[];
  capEmb?: readonly number[];
  desireEmb?: readonly number[];
  capFacetEmbs?: readonly (readonly number[])[];
  desireFacetEmbs?: readonly (readonly number[])[];
  matchFacetEmbs?: readonly (readonly number[])[];
  resolveVectors?: () => SpatialMemberVectors;
  presence: readonly Presence[];
  allFacets: readonly Facet[];
  lowExposureOrNew: boolean;
  romance?: { is: string[]; seeks: string[]; ageMin: number; ageMax: number };
  statusPercentile: number;
}

export interface SpatialBuildOptions {
  now: number;
  windowDays: number;
  adultMin: number;
  dim: number;
  seed: number;
}

export type VectorChannel = "caps" | "desires" | "match";

export interface SpatialQueryOptions {
  queryVec: readonly number[];
  channel: VectorChannel;
  pool?: readonly MemberId[];
  cities?: readonly City[];
  tags?: ReadonlySet<string>;
  anchorId?: MemberId;
  minAvailabilityOverlapHours?: number;
  stratumRadius?: number;
  enforceMutualAges?: boolean;
  candidateLimit?: number;
  exposureFloorShare?: number;
}

function resolveMemberCoords(m: Member, presence: readonly Presence[], allFacets: readonly Facet[], now: number, windowEnd: number): {
  cities: City[];
  coords: { lat: number; lon: number }[];
} {
  const cities = new Set<City>([m.homeCity]);
  const coords: { lat: number; lon: number }[] = [];

  for (let i = 0; i < allFacets.length; i++) {
    const f = allFacets[i]!;
    for (let t = 0; t < f.tags.length; t++) {
      const tag = f.tags[t]!;
      if (tag.startsWith("slop:zip:")) {
        const z = zipCentroid(tag.slice("slop:zip:".length));
        if (z) {
          coords.push({ lat: z.lat, lon: z.lon });
          cities.add(z.market);
        }
      }
    }
  }

  for (let i = 0; i < presence.length; i++) {
    const p = presence[i]!;
    const active = (p.from === undefined || p.from < windowEnd) && (p.to === undefined || p.to > now);
    if (!active) continue;
    cities.add(p.city);
    for (let a = 0; a < p.areas.length; a++) {
      const area = p.areas[a]!;
      const zDirect = normalizeZip(area) ? zipCentroid(area) : undefined;
      if (zDirect) {
        coords.push({ lat: zDirect.lat, lon: zDirect.lon });
        continue;
      }
      const cityHood = findNeighborhood(p.city, area);
      if (cityHood) {
        coords.push({ lat: cityHood.lat, lon: cityHood.lng });
        continue;
      }
      const nh = hood(area);
      if (nh) {
        coords.push({ lat: nh.lat, lon: nh.lng });
        continue;
      }
      const zArea = zipForArea(area, p.city);
      if (zArea) coords.push({ lat: zArea.lat, lon: zArea.lon });
    }
  }

  if (!coords.length) {
    for (const c of cities) {
      const spec = getCity(c);
      if (spec) {
        coords.push({ lat: spec.center.lat, lon: spec.center.lng });
        continue;
      }
      const anchorZip = MARKET_ANCHOR_ZIP[c];
      const z = anchorZip ? zipCentroid(anchorZip) : undefined;
      if (z) coords.push({ lat: z.lat, lon: z.lon });
    }
  }
  return { cities: [...cities].sort(), coords };
}

interface LshIndex {
  buckets: number[][][];
}

export class SpatialIndex {
  readonly dim: number;
  readonly slotToId: MemberId[] = [];
  readonly idToSlot = new Map<MemberId, number>();

  readonly ages: Int16Array;
  readonly ageMin: Int16Array;
  readonly ageMax: Int16Array;
  readonly stratumBand: Uint8Array;
  readonly exposureFloorFlag: Uint8Array;
  readonly availMasks: Uint32Array;

  readonly profileVecs: Float32Array;
  readonly capVecs: Float32Array;
  readonly desireVecs: Float32Array;

  readonly hexRes5 = new Map<string, number[]>();
  readonly hexRes6 = new Map<string, number[]>();
  readonly hexRes7 = new Map<string, number[]>();
  readonly memberHex6 = new Map<number, HexCell[]>();

  readonly byCity = new Map<City, number[]>();
  readonly exposureByCity = new Map<City, number[]>();
  readonly byAgeBucket = new Map<number, number[]>();
  readonly byStratum = new Map<number, number[]>();
  readonly tagPostings = new Map<string, number[]>();

  private readonly hyperplanes: Float32Array;
  private readonly lshProfile: LshIndex;
  private readonly lshCap: LshIndex;
  private readonly lshDesire: LshIndex;
  private readonly pendingVectors: (SpatialMemberInput | undefined)[];
  private vectorsLoaded = false;

  constructor(members: readonly SpatialMemberInput[], opts: SpatialBuildOptions) {
    this.dim = opts.dim;
    const windowEnd = opts.now + opts.windowDays * DAY;
    const minAdult = Math.max(ADULT_AGE, opts.adultMin);

    const eligible: SpatialMemberInput[] = [];
    const sorted = [...members].sort((a, b) => (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0));
    for (let i = 0; i < sorted.length; i++) {
      const item = sorted[i]!;
      const m = item.m;
      if (!Number.isFinite(m.age) || !canBeMatched(m.age)) continue;
      if (!canIndexMember(m.age, minAdult, item.held, m.state === "paused")) continue;
      eligible.push(item);
    }

    const M = eligible.length;
    this.ages = new Int16Array(M);
    this.ageMin = new Int16Array(M);
    this.ageMax = new Int16Array(M);
    this.stratumBand = new Uint8Array(M);
    this.exposureFloorFlag = new Uint8Array(M);
    this.availMasks = new Uint32Array(M * AVAIL_WORDS);
    this.profileVecs = new Float32Array(M * this.dim);
    this.capVecs = new Float32Array(M * this.dim);
    this.desireVecs = new Float32Array(M * this.dim);
    this.pendingVectors = new Array<SpatialMemberInput | undefined>(M);

    const rng = new EngineRng((opts.seed ^ 0x51a71a1) >>> 0);
    const totalPlanes = LSH_TABLES * LSH_BITS;
    this.hyperplanes = new Float32Array(totalPlanes * this.dim);
    for (let p = 0; p < totalPlanes; p++) {
      let normSq = 0;
      const base = p * this.dim;
      for (let d = 0; d < this.dim; d++) {
        const v = rng.next() * 2 - 1;
        this.hyperplanes[base + d] = v;
        normSq += v * v;
      }
      const inv = normSq > 0 ? 1 / Math.sqrt(normSq) : 1;
      for (let d = 0; d < this.dim; d++) this.hyperplanes[base + d]! *= inv;
    }

    const makeEmptyLsh = (): LshIndex => ({
      buckets: Array.from({ length: LSH_TABLES }, () => Array.from({ length: 1 << LSH_BITS }, () => [])),
    });
    this.lshProfile = makeEmptyLsh();
    this.lshCap = makeEmptyLsh();
    this.lshDesire = makeEmptyLsh();

    let anyDeferred = false;
    for (let slot = 0; slot < M; slot++) {
      const item = eligible[slot]!;
      const m = item.m;
      this.slotToId.push(m.id);
      this.idToSlot.set(m.id, slot);

      const safeAge = Math.min(30000, Math.max(ADULT_AGE, Math.floor(m.age)));
      this.ages[slot] = safeAge;
      if (!item.romance) {
        this.ageMin[slot] = ADULT_AGE;
        this.ageMax[slot] = 120;
      } else {
        const r = item.romance;
        if (Number.isFinite(r.ageMin) && Number.isFinite(r.ageMax) && r.ageMin <= r.ageMax && canBeMatched(r.ageMax)) {
          const lo = Math.min(30000, Math.max(ADULT_AGE, Math.ceil(r.ageMin)));
          const hi = Math.min(30000, Math.floor(r.ageMax));
          if (lo <= hi && canBeMatched(hi)) {
            this.ageMin[slot] = lo;
            this.ageMax[slot] = hi;
          } else {
            this.ageMin[slot] = 30000;
            this.ageMax[slot] = 0;
          }
        } else {
          this.ageMin[slot] = 30000;
          this.ageMax[slot] = 0;
        }
      }

      const pct = Number.isFinite(item.statusPercentile) ? Math.max(0, Math.min(0.999999, item.statusPercentile)) : 0.5;
      const band = Math.floor(pct * NUM_STRATA_BANDS);
      this.stratumBand[slot] = band;
      if (!this.byStratum.has(band)) this.byStratum.set(band, []);
      this.byStratum.get(band)!.push(slot);

      const ageBkt = Math.floor(safeAge / 5);
      if (!this.byAgeBucket.has(ageBkt)) this.byAgeBucket.set(ageBkt, []);
      this.byAgeBucket.get(ageBkt)!.push(slot);

      this.exposureFloorFlag[slot] = item.lowExposureOrNew ? 1 : 0;

      const availTexts: string[] = [];
      for (let f = 0; f < item.allFacets.length; f++) {
        const fac = item.allFacets[f]!;
        if (fac.kind === "availability_pattern" && (fac.scope === "matchable" || fac.scope === "shareable")) {
          availTexts.push(fac.value);
        }
      }
      buildWeeklyAvailabilityMask(m.prefs.quietHours, availTexts, this.availMasks, slot * AVAIL_WORDS);

      if (item.resolveVectors) {
        this.pendingVectors[slot] = item;
        anyDeferred = true;
      } else {
        this.loadSlotVectors(slot, {
          profileEmb: item.profileEmb ?? [],
          capEmb: item.capEmb ?? [],
          desireEmb: item.desireEmb ?? [],
          capFacetEmbs: item.capFacetEmbs,
          desireFacetEmbs: item.desireFacetEmbs,
          matchFacetEmbs: item.matchFacetEmbs,
        });
      }

      const { cities, coords } = resolveMemberCoords(m, item.presence, item.allFacets, opts.now, windowEnd);
      for (const c of cities) {
        if (!this.byCity.has(c)) this.byCity.set(c, []);
        this.byCity.get(c)!.push(slot);
        if (item.lowExposureOrNew) {
          if (!this.exposureByCity.has(c)) this.exposureByCity.set(c, []);
          this.exposureByCity.get(c)!.push(slot);
        }
      }
      const seen5 = new Set<string>(), seen6 = new Set<string>(), seen7 = new Set<string>();
      const cells6: HexCell[] = [];
      for (let c = 0; c < coords.length; c++) {
        const { lat, lon } = coords[c]!;
        const h5 = latLonToHex(lat, lon, 5);
        const h6 = latLonToHex(lat, lon, 6);
        const h7 = latLonToHex(lat, lon, 7);
        if (!seen5.has(h5.key)) { seen5.add(h5.key); pushMap(this.hexRes5, h5.key, slot); }
        if (!seen6.has(h6.key)) { seen6.add(h6.key); cells6.push(h6); pushMap(this.hexRes6, h6.key, slot); }
        if (!seen7.has(h7.key)) { seen7.add(h7.key); pushMap(this.hexRes7, h7.key, slot); }
      }
      this.memberHex6.set(slot, cells6);

      const memberTerms = new Set<string>();
      for (const rawTag of item.tags) {
        const lower = rawTag.toLowerCase();
        if (lower) memberTerms.add(lower);
        const toks = tokenize(rawTag);
        for (let t = 0; t < toks.length; t++) memberTerms.add(toks[t]!);
      }
      for (let f = 0; f < item.allFacets.length; f++) {
        const fac = item.allFacets[f]!;
        if (fac.scope !== "matchable" && fac.scope !== "shareable") continue;
        for (let t = 0; t < fac.tags.length; t++) {
          const raw = fac.tags[t]!;
          const lower = raw.toLowerCase();
          if (lower) memberTerms.add(lower);
          const toks = tokenize(raw);
          for (let k = 0; k < toks.length; k++) memberTerms.add(toks[k]!);
        }
        const vToks = tokenize(fac.value);
        for (let k = 0; k < vToks.length; k++) memberTerms.add(vToks[k]!);
      }
      for (const term of memberTerms) {
        pushMap(this.tagPostings, term, slot);
      }
    }
    this.vectorsLoaded = !anyDeferred;
  }

  private loadSlotVectors(slot: number, v: SpatialMemberVectors): void {
    const base = slot * this.dim;
    let pNorm = 0, cNorm = 0, dNorm = 0;
    for (let d = 0; d < this.dim; d++) {
      const pv = v.profileEmb[d] ?? 0;
      const cv = v.capEmb[d] ?? 0;
      const dv = v.desireEmb[d] ?? 0;
      this.profileVecs[base + d] = pv;
      this.capVecs[base + d] = cv;
      this.desireVecs[base + d] = dv;
      pNorm += pv * pv;
      cNorm += cv * cv;
      dNorm += dv * dv;
    }
    this.insertMemberLsh(this.lshProfile, pNorm > 0 ? this.profileVecs : undefined, base, v.matchFacetEmbs, slot);
    this.insertMemberLsh(this.lshCap, cNorm > 0 ? this.capVecs : undefined, base, v.capFacetEmbs, slot);
    this.insertMemberLsh(this.lshDesire, dNorm > 0 ? this.desireVecs : undefined, base, v.desireFacetEmbs, slot);
  }

  private ensureSlotVectors(slot: number): void {
    const item = this.pendingVectors[slot];
    if (!item || !item.resolveVectors) return;
    this.pendingVectors[slot] = undefined;
    this.loadSlotVectors(slot, item.resolveVectors());
  }

  private ensureAllVectorsLoaded(): void {
    if (this.vectorsLoaded) return;
    for (let slot = 0; slot < this.pendingVectors.length; slot++) {
      this.ensureSlotVectors(slot);
    }
    this.vectorsLoaded = true;
  }

  get indexedCount(): number {
    return this.slotToId.length;
  }

  hasMember(id: MemberId): boolean {
    return this.idToSlot.has(id);
  }

  availabilityOverlap(a: MemberId, b: MemberId): number {
    const sa = this.idToSlot.get(a);
    const sb = this.idToSlot.get(b);
    if (sa === undefined || sb === undefined) return 0;
    return weeklyMaskOverlapHours(this.availMasks, sa * AVAIL_WORDS, this.availMasks, sb * AVAIL_WORDS);
  }

  fastDot(id: MemberId, q: readonly number[], channel: VectorChannel): number {
    const slot = this.idToSlot.get(id);
    if (slot === undefined) return 0;
    this.ensureSlotVectors(slot);
    const buf = channel === "caps" ? this.capVecs : channel === "desires" ? this.desireVecs : this.profileVecs;
    const base = slot * this.dim;
    let dot = 0;
    const n = q.length < this.dim ? q.length : this.dim;
    for (let i = 0; i < n; i++) dot += buf[base + i]! * q[i]!;
    return dot;
  }

  spatialNeighbors(id: MemberId, ringK = 2): MemberId[] {
    const slot = this.idToSlot.get(id);
    if (slot === undefined) return [];
    const cells = this.memberHex6.get(slot) ?? [];
    const seen = new Uint8Array(this.slotToId.length);
    seen[slot] = 1;
    const out: MemberId[] = [];
    for (let c = 0; c < cells.length; c++) {
      const disk = hexGridDisk(cells[c]!, ringK);
      for (let d = 0; d < disk.length; d++) {
        const post = this.hexRes6.get(disk[d]!);
        if (!post) continue;
        for (let i = 0; i < post.length; i++) {
          const s = post[i]!;
          if (!seen[s]) {
            seen[s] = 1;
            out.push(this.slotToId[s]!);
          }
        }
      }
    }
    return out;
  }

  queryCandidates(opts: SpatialQueryOptions): { ids: MemberId[]; exact: boolean } {
    const M = this.slotToId.length;
    if (M === 0) return { ids: [], exact: true };

    const anchorSlot = opts.anchorId !== undefined ? this.idToSlot.get(opts.anchorId) : undefined;
    const minAvail = opts.minAvailabilityOverlapHours ?? 0;
    const bandRadius = opts.stratumRadius;
    const checkMutualAges = opts.enforceMutualAges === true && anchorSlot !== undefined;

    const passesHardGates = (slot: number): boolean => {
      if (slot === anchorSlot) return false;
      if (anchorSlot !== undefined) {
        if (bandRadius !== undefined && !bandsOverlap(this.stratumBand[anchorSlot]!, this.stratumBand[slot]!, bandRadius)) {
          return false;
        }
        if (checkMutualAges) {
          const bkt = Math.floor(this.ages[slot]! / 5);
          if (!ageRangesOverlap(this.ageMin[anchorSlot]!, this.ageMax[anchorSlot]!, bkt * 5, bkt * 5 + 4)) return false;
          if (!agesOverlap(
            this.ages[anchorSlot]!, this.ageMin[anchorSlot]!, this.ageMax[anchorSlot]!,
            this.ages[slot]!, this.ageMin[slot]!, this.ageMax[slot]!,
          )) return false;
        }
        if (minAvail > 0) {
          const hrs = weeklyMaskOverlapHours(this.availMasks, anchorSlot * AVAIL_WORDS, this.availMasks, slot * AVAIL_WORDS);
          if (hrs < minAvail) return false;
        }
      }
      return true;
    };

    let poolMask: Uint8Array | undefined;
    let shardSlots: number[] = [];
    if (opts.pool !== undefined) {
      if (shouldUseExactScan(opts.pool.length, EXACT_SCAN_THRESHOLD)) {
        const exactIds: MemberId[] = [];
        for (let i = 0; i < opts.pool.length; i++) {
          const id = opts.pool[i]!;
          const slot = this.idToSlot.get(id);
          if (slot === undefined) continue;
          if (passesHardGates(slot)) exactIds.push(id);
        }
        return { ids: exactIds, exact: true };
      }
      poolMask = new Uint8Array(M);
      for (let i = 0; i < opts.pool.length; i++) {
        const slot = this.idToSlot.get(opts.pool[i]!);
        if (slot !== undefined) {
          poolMask[slot] = 1;
          shardSlots.push(slot);
        }
      }
    } else if (opts.cities && opts.cities.length > 0) {
      poolMask = new Uint8Array(M);
      for (const c of opts.cities) {
        const cs = this.byCity.get(c);
        if (!cs) continue;
        for (let i = 0; i < cs.length; i++) {
          const s = cs[i]!;
          if (!poolMask[s]) {
            poolMask[s] = 1;
            shardSlots.push(s);
          }
        }
      }
    } else {
      shardSlots = Array.from({ length: M }, (_, i) => i);
    }

    if (shouldUseExactScan(shardSlots.length, EXACT_SCAN_THRESHOLD)) {
      const out: MemberId[] = [];
      for (let i = 0; i < shardSlots.length; i++) {
        const s = shardSlots[i]!;
        if (passesHardGates(s)) out.push(this.slotToId[s]!);
      }
      return { ids: out, exact: true };
    }

    const limit = Math.max(120, opts.candidateLimit ?? 320);
    const floorShare = opts.exposureFloorShare ?? 0.15;
    const floorTarget = Math.max(12, Math.ceil(limit * floorShare));
    const picked = new Uint8Array(M);
    const candidates: number[] = [];

    const tryAdd = (slot: number): boolean => {
      if (picked[slot]) return false;
      if (poolMask && !poolMask[slot]) return false;
      if (!passesHardGates(slot)) return false;
      picked[slot] = 1;
      candidates.push(slot);
      return true;
    };

    const qHashes = this.hashVec(opts.queryVec, 0);
    const strideSeed = ((qHashes[0]! << 10) ^ (qHashes[1] ?? 0)) >>> 0;
    if (opts.tags && opts.tags.size > 0) {
      const matchedPosts: number[][] = [];
      const seenTerms = new Set<string>();
      for (const raw of opts.tags) {
        const lower = raw.toLowerCase();
        if (lower && !seenTerms.has(lower)) {
          seenTerms.add(lower);
          const p = this.tagPostings.get(lower);
          if (p && p.length > 0) matchedPosts.push(p);
        }
        const subToks = tokenize(raw);
        for (let k = 0; k < subToks.length; k++) {
          const st = subToks[k]!;
          if (!seenTerms.has(st)) {
            seenTerms.add(st);
            const p = this.tagPostings.get(st);
            if (p && p.length > 0) matchedPosts.push(p);
          }
        }
      }
      matchedPosts.sort((a, b) => a.length - b.length);
      const tagCap = Math.max(140, Math.floor(limit * 0.55));
      const perPostCap = Math.max(48, Math.ceil(tagCap / Math.max(1, matchedPosts.length)));
      let addedTag = 0;
      for (let pIdx = 0; pIdx < matchedPosts.length && addedTag < tagCap; pIdx++) {
        const post = matchedPosts[pIdx]!;
        const nPost = post.length;
        if (nPost <= perPostCap) {
          for (let i = 0; i < nPost && addedTag < tagCap; i++) {
            if (tryAdd(post[i]!)) addedTag++;
          }
        } else {
          let step = ((strideSeed + pIdx * 7919) % nPost) | 1;
          while (gcd(step, nPost) !== 1) step = (step + 2) % nPost || 1;
          const start = (strideSeed + pIdx * 104729) % nPost;
          let addedThisPost = 0;
          for (let i = 0; i < nPost && addedThisPost < perPostCap && addedTag < tagCap; i++) {
            const slot = post[(start + i * step) % nPost]!;
            if (tryAdd(slot)) {
              addedThisPost++;
              addedTag++;
            }
          }
        }
      }
    }

    this.ensureAllVectorsLoaded();
    const lsh = opts.channel === "caps" ? this.lshCap : opts.channel === "desires" ? this.lshDesire : this.lshProfile;
    const votes = new Uint8Array(M);
    const touched: number[] = [];
    let maxObservedVote = 0;
    const addVote = (slot: number, delta: number) => {
      if (picked[slot]) return;
      if (poolMask && !poolMask[slot]) return;
      const prev = votes[slot]!;
      if (prev === 0) touched.push(slot);
      const next = prev + delta > 255 ? 255 : prev + delta;
      votes[slot] = next;
      if (next > maxObservedVote) maxObservedVote = next;
    };

    for (let t = 0; t < LSH_TABLES; t++) {
      const bucket = lsh.buckets[t]![qHashes[t]!]!;
      for (let i = 0; i < bucket.length; i++) addVote(bucket[i]!, 3);
    }
    if (opts.channel !== "match") {
      for (let t = 0; t < LSH_TABLES; t++) {
        const bucket = this.lshProfile.buckets[t]![qHashes[t]!]!;
        for (let i = 0; i < bucket.length; i++) addVote(bucket[i]!, 1);
      }
    }
    if (touched.length < limit) {
      for (let bit = 0; bit < LSH_BITS; bit++) {
        const mask = 1 << bit;
        for (let t = 0; t < LSH_TABLES; t++) {
          const neighbor = lsh.buckets[t]![qHashes[t]! ^ mask]!;
          for (let i = 0; i < neighbor.length; i++) addVote(neighbor[i]!, 1);
        }
      }
    }

    if (maxObservedVote > 0) {
      const voteBuckets: number[][] = Array.from({ length: maxObservedVote + 1 }, () => []);
      for (let i = 0; i < touched.length; i++) {
        const s = touched[i]!;
        voteBuckets[votes[s]!]!.push(s);
      }
      for (let v = maxObservedVote; v >= 1 && candidates.length < limit; v--) {
        const vb = voteBuckets[v]!;
        if (vb.length === 0) continue;
        if (vb.length > 1) vb.sort((a, b) => a - b);
        for (let i = 0; i < vb.length && candidates.length < limit; i++) {
          tryAdd(vb[i]!);
        }
      }
    }

    if (anchorSlot !== undefined && candidates.length < limit + 60) {
      const cells = this.memberHex6.get(anchorSlot) ?? [];
      let spatialAdded = 0;
      for (let c = 0; c < cells.length && spatialAdded < 60; c++) {
        const disk = hexGridDisk(cells[c]!, 1);
        for (let d = 0; d < disk.length && spatialAdded < 60; d++) {
          const post = this.hexRes6.get(disk[d]!);
          if (!post) continue;
          for (let i = 0; i < post.length && spatialAdded < 60; i++) {
            if (tryAdd(post[i]!)) spatialAdded++;
          }
        }
      }
    }

    let floorAdded = 0;
    const startIdx = shardSlots.length > 0 ? strideSeed % shardSlots.length : 0;
    for (let step = 0; step < shardSlots.length && floorAdded < floorTarget; step++) {
      const s = shardSlots[(startIdx + step) % shardSlots.length]!;
      if (!this.exposureFloorFlag[s]) continue;
      if (tryAdd(s)) floorAdded++;
    }

    candidates.sort((a, b) => a - b);
    const outIds = new Array<MemberId>(candidates.length);
    for (let i = 0; i < candidates.length; i++) outIds[i] = this.slotToId[candidates[i]!]!;
    return { ids: outIds, exact: false };
  }

  private hashVec(vec: ArrayLike<number>, offset: number): Int32Array {
    const hashes = new Int32Array(LSH_TABLES);
    const len = vec.length - offset < this.dim ? vec.length - offset : this.dim;
    for (let t = 0; t < LSH_TABLES; t++) {
      let code = 0;
      for (let b = 0; b < LSH_BITS; b++) {
        const pBase = (t * LSH_BITS + b) * this.dim;
        let dot = 0;
        for (let d = 0; d < len; d++) dot += this.hyperplanes[pBase + d]! * vec[offset + d]!;
        if (dot >= 0) code |= 1 << b;
      }
      hashes[t] = code;
    }
    return hashes;
  }

  private insertMemberLsh(
    index: LshIndex,
    centroidBuf: Float32Array | undefined,
    centroidOffset: number,
    facetVecs: readonly (readonly number[])[] | undefined,
    slot: number,
  ): void {
    const addedPerTable: Set<number>[] = Array.from({ length: LSH_TABLES }, () => new Set<number>());
    if (centroidBuf) {
      const h = this.hashVec(centroidBuf, centroidOffset);
      for (let t = 0; t < LSH_TABLES; t++) {
        const code = h[t]!;
        addedPerTable[t]!.add(code);
        index.buckets[t]![code]!.push(slot);
      }
    }
    if (facetVecs && facetVecs.length > 0) {
      const cap = facetVecs.length < 12 ? facetVecs.length : 12;
      for (let f = 0; f < cap; f++) {
        const fv = facetVecs[f]!;
        let hasSignal = false;
        for (let d = 0; d < fv.length; d++) {
          if (fv[d] !== 0) { hasSignal = true; break; }
        }
        if (!hasSignal) continue;
        const h = this.hashVec(fv, 0);
        for (let t = 0; t < LSH_TABLES; t++) {
          const code = h[t]!;
          if (!addedPerTable[t]!.has(code)) {
            addedPerTable[t]!.add(code);
            index.buckets[t]![code]!.push(slot);
          }
        }
      }
    }
  }
}

function gcd(a: number, b: number): number {
  let x = a < 0 ? -a : a;
  let y = b < 0 ? -b : b;
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, val: V): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(val);
}
