import {
  requireCityPack,
  type CityCorridor,
  type CityLaunchStage,
  type CityLegalRules,
  type CityPack,
  type CityVendorAgency,
  type CityVendorPlatform,
  type CityVendorPrinter,
} from "./city-registry.ts";
import {
  CANONICAL_MARKETING_AGENTS,
  MARKETING_EMAIL_TEMPLATES,
  ON_SITE_RELEASE_FORM_COPY,
  SUPPORTED_SUBSCRIPTION_PROVIDERS,
  renderMarketingEmailTemplate,
  type AutomatedEmailTemplate,
  type EmailTemplateId,
} from "./constants.ts";
import { defaultDesireLaneForApp, type DesireLaneId } from "./desire-lanes.ts";
import type { MarketingStore } from "./store.ts";
import type {
  AgentAuthMode,
  AppId,
  BanditArm,
  BanditArmStatus,
  BdDeal,
  BdDealStage,
  BrandAppId,
  Campaign,
  DeviceNode,
  DevicePlatform,
  DeviceWarmupStage,
  HumanPartner,
  MarketingAgent,
  MarketingTask,
  PersonaId,
  SubscriptionProvider,
  VideoAsset,
  VideoAssetStage,
  VipProspect,
  VipProspectStatus,
} from "./types.ts";
import { buildStarterScriptsForCity } from "./video-factory.ts";

export type SeedSubscriptionProvider = SubscriptionProvider;
export type SeedAgentAuthMode = AgentAuthMode;
export type SeedAppId = AppId;
export type SeedPersonaId = PersonaId;

export {
  ON_SITE_RELEASE_FORM_COPY,
  SUPPORTED_SUBSCRIPTION_PROVIDERS,
  renderMarketingEmailTemplate,
  type AutomatedEmailTemplate,
  type EmailTemplateId,
};

export interface SeedAgentConfig {
  id: string;
  personaId: SeedPersonaId;
  displayName: string;
  appId: SeedAppId;
  primaryDesireLane: DesireLaneId;
  provider: SeedSubscriptionProvider;
  failoverProvider: SeedSubscriptionProvider;
  supportedProviders: readonly SeedSubscriptionProvider[];
  authMode: SeedAgentAuthMode;
  sessionRef: string;
  dailyTurnCap: number;
  roleSummary: string;
}

export interface SeedDeviceSlot {
  id: string;
  label: string;
  platform: DevicePlatform;
  hostMachine: string;
  serialOrUdid: string;
  assignedPersona: SeedPersonaId | null;
  simCarrier: string | null;
  wifiDisabled: boolean;
  batteryPct: number;
  tempC: number;
  warmupStage: DeviceWarmupStage;
  dailyActionCap: number;
  notes: string;
}

export interface BudgetTrackAllocation {
  track: "street_fliering" | "creator_video" | "event_activation" | "print_qr" | "agency_reserve";
  label: string;
  desireLane: DesireLaneId;
  amountCents: number;
  sharePct: number;
  targetSignups: number;
  notes: string;
}

export interface WeeklyRolloutSlice {
  week: 1 | 2 | 3 | 4;
  amountCents: number;
  focus: string;
}

export interface CityActivationCorridor {
  neighborhood: string;
  landmarks: string;
  bestWindows: string;
  primaryApps: readonly SeedAppId[];
  primaryDesireLanes: readonly DesireLaneId[];
}

export interface SeedCampaignConfig {
  id: string;
  slug: string;
  name: string;
  city: string;
  stage: CityLaunchStage;
  platformActive: boolean;
  appId: "all";
  tier: 4;
  riskZone: "zone_2_amber";
  riskDial: "conservative";
  monthlyBudgetCents: number;
  dailyCapCents: number;
  maxTaskCents: number;
  billingArmed: boolean;
  slopCashEnabled: boolean;
  tracks: readonly BudgetTrackAllocation[];
  weeklyRollout: readonly WeeklyRolloutSlice[];
  corridors: readonly CityActivationCorridor[];
}

export interface SeedStarterTask {
  id: string;
  campaignId: string;
  tier: 1 | 2 | 3 | 4;
  taskKind:
    | "street_fliering"
    | "event_activation"
    | "creator_video"
    | "agency_booking"
    | "print_order"
    | "discovery";
  appId: SeedAppId;
  desireLane: DesireLaneId;
  city: string;
  neighborhood: string;
  title: string;
  briefText: string;
  vendorChannel:
    | "craigslist"
    | "rentahuman"
    | "backstage"
    | "agency_email"
    | "creator_direct"
    | "print_local"
    | "internal";
  amountCents: number;
  bonusCapCents: number;
  qrBatchCode: string;
  payoutRail: "none" | "fiat_stripe" | "fiat_tremendous" | "agency_invoice" | "platform_escrow";
}

export interface SeedBanditArm {
  id: string;
  campaignId: string;
  armKey: string;
  label: string;
  track: BudgetTrackAllocation["track"];
  desireLane: DesireLaneId;
  alpha: number;
  beta: number;
  weight: number;
  spendCents: number;
  signups: number;
  stopEvents: number;
  totalContacts: number;
  status: BanditArmStatus;
}

export interface SeedBdDeal {
  id: string;
  campaignId: string;
  city: string;
  neighborhood: string;
  venueName: string;
  vertical: BrandAppId;
  desireLane: DesireLaneId;
  stage: BdDealStage;
  offeredCents: number;
  phoneCallbackVerified: boolean;
  qrBatchCode: string;
  notes: string;
}

export interface SeedVipProspect {
  id: string;
  campaignId: string;
  city: string;
  name: string;
  archetype: string;
  desireLane: DesireLaneId;
  organization: string;
  publicSource: string;
  prestigeScore: number;
  status: VipProspectStatus;
}

export interface SeedVideoAsset {
  id: string;
  campaignId: string;
  personaId: SeedPersonaId;
  appId: BrandAppId;
  desireLane: DesireLaneId;
  city: string;
  scriptId: string;
  title: string;
  hook: string;
  script: string;
  stage: VideoAssetStage;
  platform: "tiktok" | "instagram_reels" | "youtube_shorts";
  ftcDisclosed: boolean;
}

export interface CityLaunchSeedBundle {
  city: string;
  cityLabel: string;
  stage: CityLaunchStage;
  platformActive: boolean;
  legal: CityLegalRules;
  campaign: SeedCampaignConfig;
  agents: SeedAgentConfig[];
  devices: SeedDeviceSlot[];
  starterTasks: SeedStarterTask[];
  banditArms: SeedBanditArm[];
  bdDeals: SeedBdDeal[];
  vipProspects: SeedVipProspect[];
  videoAssets: SeedVideoAsset[];
  agencies: readonly CityVendorAgency[];
  platforms: readonly CityVendorPlatform[];
  printers: readonly CityVendorPrinter[];
  templates: Record<EmailTemplateId, AutomatedEmailTemplate>;
}

export type AgentOverrideMap = Partial<
  Record<
    SeedPersonaId,
    Partial<Pick<SeedAgentConfig, "provider" | "failoverProvider" | "authMode" | "dailyTurnCap">>
  >
>;

export interface BuildCityLaunchSeedOptions {
  readonly agentOverrides?: AgentOverrideMap;
  readonly monthlyBudgetCents?: number;
  readonly dailyCapCents?: number;
  readonly maxTaskCents?: number;
}

export interface SeedCityLaunchOptions extends BuildCityLaunchSeedOptions {
  readonly seedDevices?: boolean;
}

export interface CitySeedResult {
  city: string;
  stage: CityLaunchStage;
  platformActive: boolean;
  campaign: Campaign;
  agents: MarketingAgent[];
  devices: DeviceNode[];
  agenciesPersisted: HumanPartner[];
  tasks: MarketingTask[];
  banditArms: BanditArm[];
  bdDeals: BdDeal[];
  vipProspects: VipProspect[];
  videoAssets: VideoAsset[];
  directory: {
    agenciesCount: number;
    platformsCount: number;
    printersCount: number;
  };
  budgetTracksCents: Record<string, number>;
}

export const CANONICAL_SEED_AGENTS: readonly SeedAgentConfig[] = CANONICAL_MARKETING_AGENTS.map(
  (spec) => ({
    id: spec.id,
    personaId: spec.personaId,
    displayName: spec.displayName,
    appId: spec.personaId === "operator" ? "all" : spec.appId,
    primaryDesireLane: spec.primaryDesireLane,
    provider: spec.provider,
    failoverProvider: spec.failoverProvider,
    supportedProviders: SUPPORTED_SUBSCRIPTION_PROVIDERS,
    authMode: spec.authMode,
    sessionRef: spec.sessionRef,
    dailyTurnCap: spec.dailyTurnCap,
    roleSummary: spec.roleSummary,
  }),
);

export function createCitySeedAgents(overrides?: AgentOverrideMap): SeedAgentConfig[] {
  return CANONICAL_SEED_AGENTS.map((agent) => {
    const patch = overrides?.[agent.personaId];
    if (!patch) return { ...agent };
    const provider = patch.provider ?? agent.provider;
    const failoverProvider = patch.failoverProvider ?? agent.failoverProvider;
    return {
      ...agent,
      provider,
      failoverProvider,
      authMode: patch.authMode ?? agent.authMode,
      dailyTurnCap: patch.dailyTurnCap ?? agent.dailyTurnCap,
      sessionRef: `sub:${provider}:${agent.personaId}`,
    };
  });
}

export function buildTier2DeviceSlots(cityCode: string): SeedDeviceSlot[] {
  const code = requireCityPack(cityCode).code;
  return [
    {
      id: `dev-macbook-${code}-host`,
      label: `macbook-${code}-host`,
      platform: "macbook",
      hostMachine: "local-macbook",
      serialOrUdid: code === "nyc" ? "MACBOOK-LOCAL-HOST-01" : `MACBOOK-${code.toUpperCase()}-HOST-01`,
      assignedPersona: "operator",
      simCarrier: null,
      wifiDisabled: false,
      batteryPct: 75,
      tempC: 34.0,
      warmupStage: "steady_state",
      dailyActionCap: 120,
      notes: "Primary MacBook control plane running adb/uiautomator2/scrcpy, xcrun devicectl/pymobiledevice3, and local Postgres.",
    },
    {
      id: `dev-pixel-${code}-01`,
      label: `pixel-${code}-01`,
      platform: "android",
      hostMachine: "local-macbook",
      serialOrUdid: code === "nyc" ? "PIXEL-USB-SLOT-01" : `PIXEL-${code.toUpperCase()}-SLOT-01`,
      assignedPersona: "chadwick",
      simCarrier: "Prepaid Local SIM ($15/mo)",
      wifiDisabled: true,
      batteryPct: 60,
      tempC: 31.0,
      warmupStage: "birth_passive",
      dailyActionCap: 0,
      notes: "Dedicated unlocked retail Google Pixel (locked bootloader, Wi-Fi OFF, USB debugging ON, safe envelope 35-80% battery & <=41C).",
    },
    {
      id: `dev-iphone-${code}-01`,
      label: `iphone-${code}-01`,
      platform: "ios",
      hostMachine: "local-macbook",
      serialOrUdid: code === "nyc" ? "IPHONE-USB-SLOT-01" : `IPHONE-${code.toUpperCase()}-SLOT-01`,
      assignedPersona: "sloane",
      simCarrier: "Prepaid Local SIM ($15/mo)",
      wifiDisabled: true,
      batteryPct: 62,
      tempC: 30.5,
      warmupStage: "birth_passive",
      dailyActionCap: 0,
      notes: "Dedicated unlocked retail iPhone (iOS 18+, Wi-Fi OFF, prebuilt WebDriverAgent, safe envelope 35-80% battery & <=41C).",
    },
  ];
}

function buildCityBudgetTracks(pack: CityPack, monthlyBudgetCents: number): BudgetTrackAllocation[] {
  const w2Only = pack.legal.w2RequiredForStreetTeams;
  const streetShare = w2Only ? 24 : 32;
  const creatorShare = 33;
  const eventShare = w2Only ? 17 : 17;
  const printShare = 8;
  const agencyShare = 100 - streetShare - creatorShare - eventShare - printShare;

  const streetCents = Math.round((monthlyBudgetCents * streetShare) / 100);
  const creatorCents = Math.round((monthlyBudgetCents * creatorShare) / 100);
  const eventCents = Math.round((monthlyBudgetCents * eventShare) / 100);
  const printCents = Math.round((monthlyBudgetCents * printShare) / 100);
  const agencyCents = monthlyBudgetCents - streetCents - creatorCents - eventCents - printCents;

  const targetCpa = Math.max(250, pack.budgetDefaults.targetCpaCents);
  const streetLabel = w2Only
    ? `W-2 / Agency Street Teams (${pack.label} — ${pack.legal.laborClassification})`
    : `Direct Street Teams (${pack.label} Local Gigs + RentAHuman.ai)`;

  return [
    {
      track: "street_fliering",
      label: streetLabel,
      desireLane: "soulmate_dating",
      amountCents: streetCents,
      sharePct: streetShare,
      targetSignups: Math.round(streetCents / targetCpa),
      notes: `${pack.label} public-sidewalk QR hand-to-hand shifts (${pack.legal.permitSummary}).`,
    },
    {
      track: "creator_video",
      label: `${pack.label} YouTube, TikTok & IG Street-Interview Creators`,
      desireLane: "soulmate_dating",
      amountCents: creatorCents,
      sharePct: creatorShare,
      targetSignups: Math.round(creatorCents / targetCpa),
      notes: `Micro-creators + anchor creator shoots in ${pack.corridors[0]?.neighborhood ?? pack.label} (${pack.legal.disclosureAuthority} + ${pack.legal.likenessReleaseStatute}).`,
    },
    {
      track: "event_activation",
      label: `In-Person ${pack.label} Event & Venue Activators`,
      desireLane: "money_work",
      amountCents: eventCents,
      sharePct: eventShare,
      targetSignups: Math.round(eventCents / targetCpa),
      notes: `Curated ${pack.label} mixers, supper clubs, and venue host activations.`,
    },
    {
      track: "print_qr",
      label: `Serialized 4x6 QR Flier Print & ${pack.label} Rush Reserve`,
      desireLane: "ideal_friends",
      amountCents: printCents,
      sharePct: printShare,
      targetSignups: 0,
      notes: `Serialized 4x6 14pt postcards via ${pack.vendors.printers[0]?.name ?? "local printer"} + rigid laminated QR hand-cards.`,
    },
    {
      track: "agency_reserve",
      label: `W-2 ${pack.label} Agency Blitz & Surge Reserve`,
      desireLane: "elite_serendipity",
      amountCents: agencyCents,
      sharePct: agencyShare,
      targetSignups: Math.round(agencyCents / Math.round(targetCpa * 1.25)),
      notes: w2Only
        ? `Primary W-2 staffing reserve (${pack.legal.freelanceStatute}) deployed via vetted agencies (${pack.vendors.recommendedAgencies.slice(0, 3).join(", ")}).`
        : "Held unspent until Day 15; deploys as W-2 agency blitz if direct no-show >15%, else reallocates to lowest-CPA Week-4 winner.",
    },
  ];
}

function buildCityWeeklyRollout(pack: CityPack, monthlyBudgetCents: number): WeeklyRolloutSlice[] {
  const w1 = Math.round(monthlyBudgetCents * 0.18);
  const w2 = Math.round(monthlyBudgetCents * 0.26);
  const w3 = Math.round(monthlyBudgetCents * 0.28);
  const w4 = monthlyBudgetCents - w1 - w2 - w3;
  const c0 = pack.corridors[0]?.neighborhood ?? pack.label;
  const c1 = pack.corridors[1]?.neighborhood ?? c0;
  return [
    {
      week: 1,
      amountCents: w1,
      focus: `Order initial serialized QR flier batches, post ${pack.label} hiring/agency intake, and run pilot shifts + 2 creator shoots in ${c0} & ${c1}.`,
    },
    {
      week: 2,
      amountCents: w2,
      focus: `Print follow-on fliers on winning copy, scale ${pack.label} street shifts, event activations, and 3 micro-creator shoots.`,
    },
    {
      week: 3,
      amountCents: w3,
      focus: `Scale top-converting ${pack.label} corridors, run 5 event activations, and shoot 1 mid-tier local anchor creator.`,
    },
    {
      week: 4,
      amountCents: w4,
      focus: `Complete final ${pack.label} shifts, settle verified bonuses (${pack.legal.payoutSlaDays}-day SLA), and reallocate surge reserve to top bandit arm.`,
    },
  ];
}

function buildCityStarterTasks(pack: CityPack, campaignId: string): SeedStarterTask[] {
  const code = pack.code;
  const codeUpper = code.toUpperCase();
  const c0: CityCorridor | undefined = pack.corridors[0];
  const c1: CityCorridor | undefined = pack.corridors[1] ?? c0;
  const c2: CityCorridor | undefined = pack.corridors[2] ?? c1 ?? c0;
  const printer = pack.vendors.printers[0];
  const agency = pack.vendors.vettedAgencies[0];
  const w2Required = pack.legal.w2RequiredForStreetTeams;
  const flierLicenceClause = pack.legal.flierLicenceRequired
    ? " Mandatory municipal distribution licence must be held before shift start."
    : "";

  const shiftAmount = pack.budgetDefaults.streetShiftHourlyCents * 4;
  const eventAmount = pack.budgetDefaults.eventActivatorHourlyCents * 3 + 2_500;
  const creatorAmount = pack.budgetDefaults.microCreatorFlatCents;

  return [
    {
      id: `task-${code}-print-batch-001`,
      campaignId,
      tier: 3,
      taskKind: "print_order",
      appId: "all",
      desireLane: "ideal_friends",
      city: code,
      neighborhood: printer?.pickupLocation ?? pack.label,
      title: `Print Batch ${codeUpper}-001..003 (15,000 x 4x6 14pt Serialized QR Postcards)`,
      briefText: `Order 3 serialized 5,000-unit 4x6 14pt postcard batches from ${printer?.name ?? "local gang-run printer"} (${printer?.pickupLocation ?? pack.label}) with unique batch QR codes ${codeUpper}-001, ${codeUpper}-002, ${codeUpper}-003.`,
      vendorChannel: "print_local",
      amountCents: 33_000,
      bonusCapCents: 0,
      qrBatchCode: `${codeUpper}-PRINT-W1`,
      payoutRail: "fiat_stripe",
    },
    {
      id: `task-${code}-street-001`,
      campaignId,
      tier: 4,
      taskKind: w2Required ? "agency_booking" : "street_fliering",
      appId: c0?.primaryApps[0] ?? "slop",
      desireLane: c0?.primaryDesireLanes[0] ?? "soulmate_dating",
      city: code,
      neighborhood: c0?.neighborhood ?? pack.label,
      title: w2Required
        ? `W-2 Agency Street-Team Shift #1 — ${c0?.neighborhood ?? pack.label} (4 hrs, 18+)`
        : `Pilot Street-Team Shift #1 — ${c0?.neighborhood ?? pack.label} (4 hrs, 18+)`,
      briefText: `Hand-to-hand public sidewalk flier distribution near ${c0?.landmarks ?? pack.label}. Compliance: ${pack.legal.antiPostingRule}; ${pack.legal.transitExclusionRule}.${flierLicenceClause}${w2Required ? ` Book via W-2 agency (${agency?.name ?? "vetted agency"}) per ${pack.legal.freelanceStatute}.` : ""}`,
      vendorChannel: w2Required ? "agency_email" : "craigslist",
      amountCents: w2Required ? Math.max(shiftAmount, 22_000) : shiftAmount,
      bonusCapCents: w2Required ? 0 : 8_000,
      qrBatchCode: `${codeUpper}-001`,
      payoutRail: w2Required ? "agency_invoice" : "fiat_stripe",
    },
    {
      id: `task-${code}-creator-001`,
      campaignId,
      tier: 4,
      taskKind: "creator_video",
      appId: c1?.primaryApps[0] ?? "slop",
      desireLane: c1?.primaryDesireLanes[0] ?? "soulmate_dating",
      city: code,
      neighborhood: c1?.neighborhood ?? pack.label,
      title: `Pilot Street-Interview Creator Shoot #1 — ${c1?.neighborhood ?? pack.label} (60-90s + 2 Cutdowns)`,
      briefText: `Handheld camera + mic street interviews with 3+ genuine 18+ ${pack.label} locals trying live signup on camera. Mandatory ${pack.legal.disclosureAuthority} spoken + on-screen #Ad disclosure and signed ${pack.legal.likenessReleaseStatute} mobile releases for every recognizable interviewee.`,
      vendorChannel: "creator_direct",
      amountCents: creatorAmount,
      bonusCapCents: 15_000,
      qrBatchCode: `CR-${codeUpper}-01`,
      payoutRail: "fiat_stripe",
    },
    {
      id: `task-${code}-event-001`,
      campaignId,
      tier: 4,
      taskKind: "event_activation",
      appId: "peon",
      desireLane: "money_work",
      city: code,
      neighborhood: c2?.neighborhood ?? pack.label,
      title: `${pack.label} Builder Mixer Event Activator Shift #1 (3 hrs + Entry Stipend)`,
      briefText: `Charismatic 18+ activator attends curated ${c2?.neighborhood ?? pack.label} founder mixer carrying rigid laminated QR card EVT-${codeUpper}-01, introduces The Network & peon.biz naturally, and submits arrival + mid-event check-ins.`,
      vendorChannel: w2Required ? "agency_email" : "backstage",
      amountCents: eventAmount,
      bonusCapCents: 5_000,
      qrBatchCode: `EVT-${codeUpper}-01`,
      payoutRail: w2Required ? "agency_invoice" : "fiat_stripe",
    },
    {
      id: `task-${code}-courier-001`,
      campaignId,
      tier: 4,
      taskKind: w2Required ? "agency_booking" : "street_fliering",
      appId: "all",
      desireLane: "ideal_friends",
      city: code,
      neighborhood: `${printer?.name ?? "Local Printer"} -> ${c0?.neighborhood ?? pack.label}`,
      title: `${w2Required ? "Courier" : "RentAHuman"} Print-Box Pickup & Handoff (${pack.label})`,
      briefText: `Pick up 3 boxed flier batches from ${printer?.name ?? "local printer"} (${printer?.pickupLocation ?? pack.label}) and deliver to shift lead at ${c0?.neighborhood ?? pack.label} with pickup + handoff GPS photos.`,
      vendorChannel: w2Required ? "agency_email" : "rentahuman",
      amountCents: 5_900,
      bonusCapCents: 0,
      qrBatchCode: `RAH-${codeUpper}-01`,
      payoutRail: w2Required ? "agency_invoice" : "platform_escrow",
    },
  ];
}

function buildCityBdDeals(pack: CityPack, campaignId: string): SeedBdDeal[] {
  const code = pack.code;
  const codeUpper = code.toUpperCase();
  const c0 = pack.corridors[0]?.neighborhood ?? pack.label;
  const c1 = pack.corridors[1]?.neighborhood ?? c0;
  const c2 = pack.corridors[2]?.neighborhood ?? c1;
  const c3 = pack.corridors[3]?.neighborhood ?? c2;

  return [
    {
      id: `bd-${code}-bar-01`,
      campaignId,
      city: code,
      neighborhood: c0,
      venueName: `${c0} Cocktail Bar Partner (${pack.label})`,
      vertical: "slop",
      desireLane: "soulmate_dating",
      stage: "prospect",
      offeredCents: 20_000,
      phoneCallbackVerified: false,
      qrBatchCode: `BD-${codeUpper}-01`,
      notes: `200 serialized slop.date coasters + bar-top QR stand for Thu-Sat crowd in ${c0}; requires phone callback verification before shipping kit.`,
    },
    {
      id: `bd-${code}-cafe-01`,
      campaignId,
      city: code,
      neighborhood: c1,
      venueName: `${c1} Specialty Coffee & Work-Cafe Partner`,
      vertical: "peon",
      desireLane: "money_work",
      stage: "prospect",
      offeredCents: 15_000,
      phoneCallbackVerified: false,
      qrBatchCode: `BD-${codeUpper}-02`,
      notes: `Counter QR placard + peon.biz builder table tent in ${c1}; phone callback + signed terms required prior to kit shipment.`,
    },
    {
      id: `bd-${code}-supper-01`,
      campaignId,
      city: code,
      neighborhood: c2,
      venueName: `${c2} Run & Supper Club Host Partner`,
      vertical: "friends",
      desireLane: "ideal_friends",
      stage: "prospect",
      offeredCents: 18_000,
      phoneCallbackVerified: false,
      qrBatchCode: `BD-${codeUpper}-03`,
      notes: `friends.help 3+3 weekend table seating co-host kit in ${c2}; strictly platonic community framing.`,
    },
    {
      id: `bd-${code}-salon-01`,
      campaignId,
      city: code,
      neighborhood: c3,
      venueName: `${c3} Founder Salon & Member Lounge Partner`,
      vertical: "ntwrk",
      desireLane: "elite_serendipity",
      stage: "prospect",
      offeredCents: 25_000,
      phoneCallbackVerified: false,
      qrBatchCode: `BD-${codeUpper}-04`,
      notes: `Curated monochrome ntwrk.party invite cards at check-in desk for vetted ${pack.label} dinners.`,
    },
  ];
}

function buildCityVipProspects(pack: CityPack, campaignId: string): SeedVipProspect[] {
  const code = pack.code;
  const c0 = pack.corridors[0]?.neighborhood ?? pack.label;
  const c1 = pack.corridors[1]?.neighborhood ?? c0;
  return [
    {
      id: `vip-${code}-founder-01`,
      campaignId,
      city: code,
      name: `${pack.label} Seed/Series-A Infrastructure Founder (Public Discovery Slot)`,
      archetype: "startup_founder",
      desireLane: "cofounder_venture",
      organization: `${c1} Founder Cohort`,
      publicSource: "hn_show_hn",
      prestigeScore: 92,
      status: "discovered",
    },
    {
      id: `vip-${code}-researcher-01`,
      campaignId,
      city: code,
      name: `${pack.label} Frontier ML / Bio Lab Lead (Public Discovery Slot)`,
      archetype: "ai_biotech_researcher",
      desireLane: "cofounder_venture",
      organization: `${pack.label} Research Lab`,
      publicSource: "arxiv_cs_ai",
      prestigeScore: 90,
      status: "discovered",
    },
    {
      id: `vip-${code}-hospitality-01`,
      campaignId,
      city: code,
      name: `${c0} Hospitality Director & Supper Host (Public Discovery Slot)`,
      archetype: "michelin_chef_hospitality",
      desireLane: "bespoke_irl_experience",
      organization: `${c0} Hospitality`,
      publicSource: "city_open_data",
      prestigeScore: 86,
      status: "discovered",
    },
    {
      id: `vip-${code}-creative-01`,
      campaignId,
      city: code,
      name: `${c1} Independent Film & Design Director (Public Discovery Slot)`,
      archetype: "filmmaker_artist",
      desireLane: "creative_collab",
      organization: `${c1} Independent Studio`,
      publicSource: `luma_${code}_creative`,
      prestigeScore: 84,
      status: "discovered",
    },
  ];
}

export function buildCityLaunchSeed(
  cityCode: string,
  opts?: BuildCityLaunchSeedOptions,
): CityLaunchSeedBundle {
  const pack = requireCityPack(cityCode);
  const code = pack.code;
  const monthlyBudgetCents = opts?.monthlyBudgetCents ?? pack.budgetDefaults.monthlyBudgetCents;
  const dailyCapCents = opts?.dailyCapCents ?? pack.budgetDefaults.dailyCapCents;
  const maxTaskCents = opts?.maxTaskCents ?? pack.budgetDefaults.maxTaskCents;

  const campaignId = `camp-${code}-month-1`;
  const tracks = buildCityBudgetTracks(pack, monthlyBudgetCents);
  const weeklyRollout = buildCityWeeklyRollout(pack, monthlyBudgetCents);
  const corridors: CityActivationCorridor[] = pack.corridors.map((c) => ({
    neighborhood: c.neighborhood,
    landmarks: c.landmarks,
    bestWindows: c.bestWindows,
    primaryApps: [...c.primaryApps],
    primaryDesireLanes: [...c.primaryDesireLanes],
  }));

  const campaign: SeedCampaignConfig = {
    id: campaignId,
    slug: `${code}-month-1-launch`,
    name: `${pack.label} Month-1 Full-Stack Human Acquisition Launch`,
    city: code,
    stage: pack.stage,
    platformActive: pack.platformActive,
    appId: "all",
    tier: 4,
    riskZone: "zone_2_amber",
    riskDial: "conservative",
    monthlyBudgetCents,
    dailyCapCents,
    maxTaskCents,
    billingArmed: false,
    slopCashEnabled: false,
    tracks,
    weeklyRollout,
    corridors,
  };

  const starterTasks = buildCityStarterTasks(pack, campaignId);
  const banditArms: SeedBanditArm[] = tracks.map((track) => ({
    id: `arm-${code}-${track.track}`,
    campaignId,
    armKey: `${code}:${track.track}`,
    label: track.label,
    track: track.track,
    desireLane: track.desireLane,
    alpha: 1,
    beta: 1,
    weight: track.sharePct / 100,
    spendCents: 0,
    signups: 0,
    stopEvents: 0,
    totalContacts: 0,
    status: "active",
  }));

  const bdDeals = buildCityBdDeals(pack, campaignId);
  const vipProspects = buildCityVipProspects(pack, campaignId);
  const localizedScripts = buildStarterScriptsForCity(code);
  const videoAssets: SeedVideoAsset[] = localizedScripts.map((script, idx) => ({
    id: `video-${code}-${String(idx + 1).padStart(2, "0")}-${script.personaId}`,
    campaignId,
    personaId: script.personaId,
    appId: script.appId,
    desireLane: script.desireLane ?? defaultDesireLaneForApp(script.appId),
    city: code,
    scriptId: script.id,
    title: script.title,
    hook: script.hookText,
    script: `${script.hookText} ${script.dialogue} ${script.punchline} ${script.ctaText}`,
    stage: "script",
    platform: idx % 3 === 0 ? "tiktok" : idx % 3 === 1 ? "instagram_reels" : "youtube_shorts",
    ftcDisclosed: !script.sponsored || Boolean(script.ftcDisclosureText),
  }));

  return {
    city: code,
    cityLabel: pack.label,
    stage: pack.stage,
    platformActive: pack.platformActive,
    legal: pack.legal,
    campaign,
    agents: createCitySeedAgents(opts?.agentOverrides),
    devices: buildTier2DeviceSlots(code),
    starterTasks,
    banditArms,
    bdDeals,
    vipProspects,
    videoAssets,
    agencies: pack.vendors.vettedAgencies,
    platforms: pack.vendors.platforms,
    printers: pack.vendors.printers,
    templates: MARKETING_EMAIL_TEMPLATES,
  };
}

export async function seedCityLaunch(
  store: MarketingStore,
  cityCode: string,
  opts?: SeedCityLaunchOptions,
): Promise<CitySeedResult> {
  const seed = buildCityLaunchSeed(cityCode, opts);

  let campaign = await store.getCampaignBySlug(seed.campaign.slug);
  if (!campaign) {
    campaign = await store.createCampaign({
      id: seed.campaign.id,
      slug: seed.campaign.slug,
      name: seed.campaign.name,
      city: seed.campaign.city,
      appId: seed.campaign.appId,
      riskZone: seed.campaign.riskZone,
      riskDial: seed.campaign.riskDial,
      monthlyBudgetCents: seed.campaign.monthlyBudgetCents,
      dailyCapCents: seed.campaign.dailyCapCents,
      maxTaskCents: seed.campaign.maxTaskCents,
      billingArmed: seed.campaign.billingArmed,
      slopCashEnabled: seed.campaign.slopCashEnabled,
      status: "active",
    });
  }

  const agents: MarketingAgent[] = [];
  for (const agentCfg of seed.agents) {
    const existing = await store.getAgentByPersona(agentCfg.personaId);
    if (existing) {
      agents.push(existing);
    } else {
      const appId: BrandAppId = agentCfg.appId === "all" ? "ntwrk" : agentCfg.appId;
      agents.push(
        await store.upsertAgent({
          id: agentCfg.id,
          personaId: agentCfg.personaId,
          displayName: agentCfg.displayName,
          appId,
          provider: agentCfg.provider,
          failoverProvider: agentCfg.failoverProvider,
          authMode: agentCfg.authMode,
          sessionRef: agentCfg.sessionRef,
          sessionHealthy: true,
          dailyTurnCap: agentCfg.dailyTurnCap,
          turnsUsedToday: 0,
          status: "idle",
        }),
      );
    }
  }

  const devices: DeviceNode[] = [];
  const shouldSeedDevices = opts?.seedDevices ?? true;
  if (shouldSeedDevices) {
    const existingDevices = await store.listDevices({ limit: 500 });
    const bySerial = new Map(existingDevices.map((d) => [d.serialOrUdid, d]));
    for (const slot of seed.devices) {
      const existing = bySerial.get(slot.serialOrUdid);
      if (existing) {
        devices.push(existing);
      } else {
        devices.push(
          await store.upsertDevice({
            id: slot.id,
            label: slot.label,
            platform: slot.platform,
            hostMachine: slot.hostMachine,
            serialOrUdid: slot.serialOrUdid,
            assignedPersona: slot.assignedPersona,
            simCarrier: slot.simCarrier,
            batteryPct: slot.batteryPct,
            tempC: slot.tempC,
            warmupDay: slot.warmupStage === "steady_state" ? 30 : 0,
            warmupStage: slot.warmupStage,
            dailyActionsUsed: 0,
            dailyActionCap: slot.dailyActionCap,
            status: "online",
            preserveCounters: true,
          }),
        );
      }
    }
  }

  const agenciesPersisted: HumanPartner[] = [];
  for (const agency of seed.agencies) {
    const hmac = seed.city === "nyc" ? `agency:${agency.id}` : `agency:${seed.city}:${agency.id}`;
    const existing = await store.getHumanByHmac(hmac);
    if (existing) {
      agenciesPersisted.push(existing);
    } else {
      agenciesPersisted.push(
        await store.upsertHuman({
          handleOrEmailHmac: hmac,
          displayLabel: `${agency.name} (${agency.contactEmailOrIntake})`,
          channel: "email",
          role: "agency",
          city: seed.city,
          lowestAge: null,
          stopped: false,
          banned: false,
        }),
      );
    }
  }

  const existingTasks = await store.listTasks({ campaignId: campaign.id, limit: 500 });
  const existingBatch = new Set(existingTasks.map((t) => t.qrBatchCode).filter(Boolean));
  const tasks: MarketingTask[] = [...existingTasks];
  for (const starter of seed.starterTasks) {
    if (existingBatch.has(starter.qrBatchCode)) continue;
    const vendorChannel =
      starter.vendorChannel === "backstage"
        ? "agency_email"
        : starter.vendorChannel === "print_local"
          ? "print_api"
          : starter.vendorChannel;
    const payoutRail =
      starter.payoutRail === "agency_invoice" || starter.payoutRail === "platform_escrow"
        ? "fiat_stripe"
        : starter.payoutRail;
    const taskKind = starter.taskKind === "discovery" ? "digital_outreach" : starter.taskKind;
    tasks.push(
      await store.createTask({
        id: starter.id,
        campaignId: campaign.id,
        tier: starter.tier,
        taskKind,
        city: starter.city,
        title: starter.title,
        briefText: starter.briefText,
        vendorChannel,
        amountCents: starter.amountCents,
        qrBatchCode: starter.qrBatchCode,
        payoutRail,
        status: "drafted",
      }),
    );
  }

  const existingArms = await store.listBanditArms({ campaignId: campaign.id, limit: 200 });
  const armByKey = new Map(existingArms.map((a) => [a.armKey, a]));
  const banditArms: BanditArm[] = [];
  for (const armSeed of seed.banditArms) {
    const existing = armByKey.get(armSeed.armKey);
    if (existing) {
      banditArms.push(existing);
    } else {
      banditArms.push(
        await store.upsertBanditArm({
          id: armSeed.id,
          campaignId: campaign.id,
          armKey: armSeed.armKey,
          label: armSeed.label,
          track: armSeed.track,
          alpha: armSeed.alpha,
          beta: armSeed.beta,
          weight: armSeed.weight,
          spendCents: armSeed.spendCents,
          signups: armSeed.signups,
          stopEvents: armSeed.stopEvents,
          totalContacts: armSeed.totalContacts,
          status: armSeed.status,
        }),
      );
    }
  }

  const existingDeals = await store.listBdDeals({ campaignId: campaign.id, limit: 200 });
  const dealById = new Map(existingDeals.map((d) => [d.id, d]));
  const bdDeals: BdDeal[] = [];
  for (const dealSeed of seed.bdDeals) {
    const existing = dealById.get(dealSeed.id);
    if (existing) {
      bdDeals.push(existing);
    } else {
      bdDeals.push(
        await store.createBdDeal({
          id: dealSeed.id,
          campaignId: campaign.id,
          city: dealSeed.city,
          venueName: dealSeed.venueName,
          vertical: dealSeed.vertical,
          stage: dealSeed.stage,
          offeredCents: dealSeed.offeredCents,
          phoneCallbackVerified: dealSeed.phoneCallbackVerified,
          notes: dealSeed.notes,
        }),
      );
    }
  }

  const existingVips = await store.listVipProspects({ campaignId: campaign.id, limit: 200 });
  const vipById = new Map(existingVips.map((v) => [v.id, v]));
  const vipProspects: VipProspect[] = [];
  for (const vipSeed of seed.vipProspects) {
    const existing = vipById.get(vipSeed.id);
    if (existing) {
      vipProspects.push(existing);
    } else {
      vipProspects.push(
        await store.createVipProspect({
          id: vipSeed.id,
          campaignId: campaign.id,
          city: vipSeed.city,
          name: vipSeed.name,
          archetype: vipSeed.archetype,
          organization: vipSeed.organization,
          publicSource: vipSeed.publicSource,
          prestigeScore: vipSeed.prestigeScore,
          status: vipSeed.status,
        }),
      );
    }
  }

  const existingVideos = await store.listVideoAssets({ campaignId: campaign.id, limit: 200 });
  const videoById = new Map(existingVideos.map((v) => [v.id, v]));
  const videoAssets: VideoAsset[] = [];
  for (const vidSeed of seed.videoAssets) {
    const existing = videoById.get(vidSeed.id);
    if (existing) {
      videoAssets.push(existing);
    } else {
      videoAssets.push(
        await store.createVideoAsset({
          id: vidSeed.id,
          campaignId: campaign.id,
          agentId: `agent-${vidSeed.personaId}`,
          title: vidSeed.title,
          hook: vidSeed.hook,
          script: vidSeed.script,
          stage: vidSeed.stage,
          platform: vidSeed.platform,
          ftcDisclosed: vidSeed.ftcDisclosed,
        }),
      );
    }
  }

  const budgetTracksCents: Record<string, number> = {};
  for (const t of seed.campaign.tracks) {
    budgetTracksCents[t.track] = t.amountCents;
  }

  return {
    city: seed.city,
    stage: seed.stage,
    platformActive: seed.platformActive,
    campaign,
    agents,
    devices,
    agenciesPersisted,
    tasks,
    banditArms,
    bdDeals,
    vipProspects,
    videoAssets,
    directory: {
      agenciesCount: seed.agencies.length,
      platformsCount: seed.platforms.length,
      printersCount: seed.printers.length,
    },
    budgetTracksCents,
  };
}
