// Shared constants and record types for the synthetic member dataset (data/synthetic/).
// Every record is SYNTHETIC: invented people, invented names, fictional contact details.
import type {
  Category, City, Edge, EdgeType, Facet, FacetKind, Intent, Member, ParticipationState, Presence,
  PrivacyScope, Provenance,
} from "../../packages/core/src/index.ts";
import type {
  AdversarialKind, Archetype, Gender, HiddenTruth, PublicProfile, Relationship, Routine,
} from "../../packages/sim/src/persona.ts";
import type { ChatCoverage, ObservationTruth, RichnessTier } from "../../packages/sim/src/sources.ts";
import type { ConnectedSourceSummary, SensitiveCategory, SourceKind, SourceLink, SourceStatus } from "../../packages/core/src/index.ts";

export const DATASET_VERSION = "v1";
export const GENERATOR_VERSION = "synthetic-gen 1.2.1";
export const SEED = 20261005;
/** Snapshot time: Mon 2026-10-12 10:00 PDT / 13:00 EDT. All timestamps are relative to this. */
export const SNAPSHOT_NOW = Date.UTC(2026, 9, 12, 17, 0, 0);
export const PER_CITY = 250;

export const REPO = new URL("../../", import.meta.url).pathname.replace(/\/$/, "");
export const DATA_DIR = `${REPO}/data/synthetic/${DATASET_VERSION}`;
export const CACHE_DIR = `${REPO}/runs/synthetic-cache/${DATASET_VERSION}`; // gitignored

export const FILES = {
  members: "members.jsonl", facets: "facets.jsonl", intents: "intents.jsonl", presence: "presence.jsonl",
  edges: "edges.jsonl", hidden: "hidden_truth.jsonl", manifest: "manifest.json",
} as const;

/** Real neighborhood names. NYC entries carry their borough. */
export const NEIGHBORHOODS: Record<City, { name: string; borough?: string }[]> = {
  sf: [
    "Mission", "Mission Dolores", "Castro", "Noe Valley", "Hayes Valley", "SoMa", "Tenderloin", "Nob Hill",
    "Russian Hill", "North Beach", "Chinatown", "Marina", "Cow Hollow", "Pacific Heights", "Japantown",
    "Western Addition", "NoPa", "Haight-Ashbury", "Lower Haight", "Cole Valley", "Inner Sunset", "Outer Sunset",
    "Inner Richmond", "Outer Richmond", "Bernal Heights", "Potrero Hill", "Dogpatch", "Bayview", "Excelsior",
    "Glen Park", "Mission Bay", "Financial District", "Duboce Triangle", "Portola",
  ].map(name => ({ name })),
  nyc: [
    ...["East Village", "West Village", "Lower East Side", "Chelsea", "Harlem", "Upper West Side", "Upper East Side",
      "Washington Heights", "Inwood", "Murray Hill", "Tribeca", "SoHo", "Chinatown", "Hell's Kitchen", "Gramercy",
      "Financial District", "East Harlem", "Midtown", "Flatiron"].map(name => ({ name, borough: "Manhattan" })),
    ...["Williamsburg", "Greenpoint", "Bushwick", "Park Slope", "Fort Greene", "Crown Heights", "Bed-Stuy",
      "Prospect Heights", "Sunset Park", "Bay Ridge", "Carroll Gardens", "Flatbush", "DUMBO", "Red Hook"].map(name => ({ name, borough: "Brooklyn" })),
    ...["Astoria", "Long Island City", "Jackson Heights", "Flushing", "Ridgewood", "Sunnyside"].map(name => ({ name, borough: "Queens" })),
    ...["Mott Haven", "Riverdale"].map(name => ({ name, borough: "Bronx" })),
    { name: "St. George", borough: "Staten Island" },
  ],
};
export const BUSINESS_AREAS: Record<City, string[]> = {
  sf: ["SoMa", "Financial District", "Mission Bay", "Dogpatch", "Mission", "Hayes Valley"],
  nyc: ["Midtown", "Flatiron", "Financial District", "DUMBO", "Long Island City", "Chelsea", "SoHo"],
};
export const neighborhoodSet = (c: City) => new Set(NEIGHBORHOODS[c].map(n => n.name));

/** Fictional phone area codes; local numbers are always 555-0100..555-0199 (reserved for fiction). */
export const AREA_CODES: Record<City, string[]> = { sf: ["415", "628", "510"], nyc: ["212", "646", "917", "718", "347"] };
export const PHONE_RE = /^\+1-(\d{3})-555-01\d{2}$/;

export type Segment = "adult" | "minor";
export type EdgeRelation = "invite" | "vouch" | "friend" | "coworker" | "roommate" | "block";

export interface MemberProfile {
  pronouns: string;
  neighborhood: string;
  borough?: string;
  /** Present only if the member told the agent (1.2.0). */
  occupation?: string;
  /** "member": a bio the member wrote/said (rich tiers). "summary": built from known facets only. */
  bio: string;
  bioSource: "member" | "summary";
  /** Messages the member actually sent the agent (0-3 kept as samples, by tier). */
  voice: { style: string; samples: string[] };
  /** Present only if the member described their week (1.2.0). */
  routine?: string;
  availability?: string;
  secondaryCity?: City;
  contact: { phone: string; email: string };
  enrichment: "llm" | "template";
  /** Chat history length with the agent. */
  chatMessages: number;
}
export interface MemberRecord extends Member { synthetic: true; segment: Segment; profile: MemberProfile }
export interface FacetRecord extends Facet { synthetic: true }
export interface IntentRecord extends Intent { synthetic: true }
export interface PresenceRecord extends Presence { synthetic: true }
export interface EdgeRecord extends Edge { synthetic: true; relation: EdgeRelation }

/** Ground truth the Network must never read. Enough to rebuild a sim Persona. */
export interface HiddenTruthRecord {
  synthetic: true;
  memberId: string;
  name: string;
  homeCity: City;
  secondaryCity?: City;
  segment: Segment;
  archetype: Archetype;
  gender: Gender;
  community: string;
  workplace?: { id: string; descriptor: string };
  adversarial?: { kind: AdversarialKind; notes: string; scriptedMessages: string[] };
  routine: Routine;
  relationships: Relationship[];
  hidden: HiddenTruth;
  personaPublic: PublicProfile;
  /** Full LLM texture (what the persona would say), whether or not the Network knows it. */
  personaTexture: { occupation: string; routine: string; availability: string; voiceSamples: string[]; offers: string[] };
  /** What the Network knows, and ground truth about it (1.2.0). */
  knowledge: HiddenKnowledge;
}

/** Hidden: richness tier, chat coverage, all source entries, and the truth label of every source facet. */
export interface HiddenKnowledge {
  richness: RichnessTier;
  chat: ChatCoverage;
  sources: ConnectedSourceSummary[];
  /** facet id (facets.jsonl, source-derived) -> correct / stale / wrong_inference (+ why). */
  observationTruth: Record<string, { truth: ObservationTruth; note?: string }>;
}

export interface Manifest {
  synthetic: true;
  dataset: string;
  datasetVersion: string;
  generatorVersion: string;
  simGeneratorSourceSha256: string;
  seed: number;
  snapshotNow: number;
  snapshotNowIso: string;
  generatedAt: string;
  model: string;
  counts: Record<string, any>;
  llm: Record<string, any>;
  files: Record<string, { records: number; sha256: string }>;
  notes: string[];
}

// ---- enumerations tied to core types at compile time (validate.ts uses them) ----------------
type Exhaustive<U, L extends readonly U[]> = [Exclude<U, L[number]>] extends [never] ? L : never;
const tuple = <U>() => <L extends readonly U[]>(l: Exhaustive<U, L>) => l;
export const CITIES = tuple<City>()(["sf", "nyc"] as const);
export const STATES = tuple<ParticipationState>()(["open", "normal", "quiet", "receiving", "paused"] as const);
export const SCOPES = tuple<PrivacyScope>()(["agent_private", "matchable", "shareable", "opportunity_specific"] as const);
export const PROVENANCES = tuple<Provenance>()(["said", "connected_source", "inferred", "vouched"] as const);
export const FACET_KINDS = tuple<FacetKind>()(["interest", "skill", "offer", "desire", "goal", "boundary", "trait", "fact", "resource", "preference", "availability_pattern"] as const);
export const CATEGORIES = tuple<Category>()(["social", "professional", "romance", "hobby", "help", "events", "growth"] as const);
export const EDGE_TYPES = tuple<EdgeType>()(["invited_by", "vouched_for", "knows", "met", "introduced", "helped", "hosted", "enjoyed", "would_interact_again", "group_only", "avoid", "blocked"] as const);
export const SOURCE_KINDS_ALL = tuple<SourceKind>()(["chat", "vouch", "ai_memory", "gmail", "google_calendar", "linkedin", "x", "instagram", "github", "strava", "spotify", "eventbrite", "partiful", "luma", "personal_website"] as const);
export const SENSITIVE_CATEGORIES = tuple<SensitiveCategory>()(["health", "finances", "religion", "sexuality", "relationship", "children"] as const);
export const SOURCE_STATUSES = tuple<SourceStatus>()(["connected", "confirmed", "pending_confirmation", "rejected", "revoked"] as const);
export const SOURCE_LINKS = tuple<SourceLink>()(["oauth", "profile_url", "paste", "found_profile"] as const);
export const FORMATS = ["one_to_one", "small_group", "event"] as const;
export const PRESENCE_TYPES = ["home", "routine", "temporary"] as const;
export const INTENT_STATUS = ["active", "paused", "closed"] as const;

/** Keys that exist only in hidden truth and must never appear in public files. */
export const HIDDEN_ONLY_KEYS = [
  "trueAge", "adversarial", "honesty", "flakiness", "socialEnergy", "capacity", "responsiveness",
  "privateDisclosure", "openness", "verbosity", "archetype", "community", "relationships", "hidden",
  "richness", "observationTruth", "truth", "personaTexture", "knowledge",
];

export const readJsonl = async <T = any>(path: string): Promise<T[]> =>
  (await Bun.file(path).text()).split("\n").filter(l => l.trim()).map(l => JSON.parse(l) as T);

export const sha256 = (s: string) => new Bun.CryptoHasher("sha256").update(s).digest("hex");
