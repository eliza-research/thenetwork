// Ready-to-run NYC Launch Campaign Seed Dataset for @thenetwork/marketing (Node 26).
// Zero gimmicks, zero wearable hardware, real NYC street teams, event activators,
// street-interview creators, vetted NYC agencies, local printers, and compliant email templates.

export type SeedSubscriptionProvider = "chatgpt" | "claude" | "gemini" | "surplus";
export type SeedAgentAuthMode = "cli" | "mcp" | "oauth" | "browser" | "api";
export type SeedAppId = "slop" | "peon" | "friends" | "ntwrk" | "all";
export type SeedPersonaId = "chadwick" | "sloane" | "peon" | "venn" | "operator";

export const SUPPORTED_SUBSCRIPTION_PROVIDERS: readonly SeedSubscriptionProvider[] = [
  "chatgpt",
  "claude",
  "gemini",
  "surplus",
] as const;

export interface SeedAgentConfig {
  id: string;
  personaId: SeedPersonaId;
  displayName: string;
  appId: SeedAppId;
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
  platform: "macbook" | "android" | "ios";
  hostMachine: string;
  serialOrUdid: string;
  assignedPersona: SeedPersonaId | null;
  simCarrier: string | null;
  wifiDisabled: boolean;
  batteryPct: number;
  tempC: number;
  warmupStage: "birth_passive" | "light_organic" | "branded_cadence" | "steady_state";
  dailyActionCap: number;
  notes: string;
}

export interface BudgetTrackAllocation {
  track: "street_fliering" | "creator_video" | "event_activation" | "print_qr" | "agency_reserve";
  label: string;
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

export interface NycActivationCorridor {
  neighborhood: string;
  landmarks: string;
  bestWindows: string;
  primaryApps: readonly SeedAppId[];
}

export interface SeedCampaignConfig {
  id: string;
  slug: string;
  name: string;
  city: "nyc";
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
  corridors: readonly NycActivationCorridor[];
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
  city: "nyc";
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

export interface VettedNycAgency {
  id: string;
  name: string;
  website: string;
  contactEmailOrIntake: string;
  phone?: string;
  nycAddress?: string;
  coreServices: string;
  typicalClientRateSummary: string;
  leadTimeBusinessDays: string;
  w2AndInsurance: string;
  zeroTouchBookingReadiness: "high" | "medium_high" | "medium" | "low_m1";
}

export interface SelfServicePlatform {
  id: string;
  name: string;
  url: string;
  pricingModel: string;
  typicalNycRate: string;
  bookingWorkflow: string;
  bestRoleFit: string;
  month1Priority: "primary" | "secondary" | "scale_later";
}

export interface NycLocalPrinter {
  id: string;
  name: string;
  website: string;
  contactEmail?: string;
  phone?: string;
  pickupLocation: string;
  cost5k4x6PostcardsUsd: string;
  sameDayAvailable: boolean;
  operationalUse: string;
}

export type EmailTemplateId =
  | "craigslist_gig_post"
  | "applicant_screening_hire_reply"
  | "agency_rfp"
  | "creator_street_interview_brief"
  | "proof_of_work_reminder";

export interface AutomatedEmailTemplate {
  id: EmailTemplateId;
  title: string;
  channel: "craigslist" | "email";
  subjectTemplate: string;
  bodyTemplate: string;
  requiredVariables: readonly string[];
  legalGuardrails: readonly string[];
}

export const NYC_SEED_AGENTS: readonly SeedAgentConfig[] = [
  {
    id: "agent-chadwick",
    personaId: "chadwick",
    displayName: "Chadwick",
    appId: "ntwrk",
    provider: "chatgpt",
    failoverProvider: "claude",
    supportedProviders: SUPPORTED_SUBSCRIPTION_PROVIDERS,
    authMode: "cli",
    sessionRef: "sub:chatgpt:chadwick",
    dailyTurnCap: 60,
    roleSummary: "The Network flagship connector — orchestrates NYC launches, event invitations, and Craigslist gig copy.",
  },
  {
    id: "agent-sloane",
    personaId: "sloane",
    displayName: "Sloane",
    appId: "slop",
    provider: "claude",
    failoverProvider: "chatgpt",
    supportedProviders: SUPPORTED_SUBSCRIPTION_PROVIDERS,
    authMode: "cli",
    sessionRef: "sub:claude:sloane",
    dailyTurnCap: 60,
    roleSummary: "slop.date dating growth lead — negotiates NYC street-interview creators, West/East Village drops, and cocktail-bar partners.",
  },
  {
    id: "agent-peon",
    personaId: "peon",
    displayName: "Peon",
    appId: "peon",
    provider: "gemini",
    failoverProvider: "claude",
    supportedProviders: SUPPORTED_SUBSCRIPTION_PROVIDERS,
    authMode: "cli",
    sessionRef: "sub:gemini:peon",
    dailyTurnCap: 60,
    roleSummary: "peon.biz founder & builder scout — runs Flatiron/Union Sq & Midtown West activations plus HN/GitHub/arXiv outreach.",
  },
  {
    id: "agent-venn",
    personaId: "venn",
    displayName: "Venn",
    appId: "friends",
    provider: "claude",
    failoverProvider: "gemini",
    supportedProviders: SUPPORTED_SUBSCRIPTION_PROVIDERS,
    authMode: "cli",
    sessionRef: "sub:claude:venn",
    dailyTurnCap: 60,
    roleSummary: "friends.help NYC community lead — partners with run clubs, supper clubs, and Williamsburg/Washington Sq activators.",
  },
  {
    id: "agent-operator",
    personaId: "operator",
    displayName: "The Operator",
    appId: "all",
    provider: "chatgpt",
    failoverProvider: "claude",
    supportedProviders: SUPPORTED_SUBSCRIPTION_PROVIDERS,
    authMode: "cli",
    sessionRef: "sub:chatgpt:operator",
    dailyTurnCap: 80,
    roleSummary: "Cross-app ops coordinator — screens 18+ applicants, dispatches NYLL § 191-d agreements, audits proofs, and manages agency RFPs.",
  },
] as const;

export function createNycSeedAgents(
  overrides?: Partial<
    Record<
      SeedPersonaId,
      Partial<Pick<SeedAgentConfig, "provider" | "failoverProvider" | "authMode" | "dailyTurnCap">>
    >
  >,
): SeedAgentConfig[] {
  return NYC_SEED_AGENTS.map((agent) => {
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

export const NYC_TIER2_DEVICES: readonly SeedDeviceSlot[] = [
  {
    id: "dev-macbook-nyc-host",
    label: "macbook-nyc-host",
    platform: "macbook",
    hostMachine: "local-macbook",
    serialOrUdid: "MACBOOK-LOCAL-HOST-01",
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
    id: "dev-pixel-nyc-01",
    label: "pixel-nyc-01",
    platform: "android",
    hostMachine: "local-macbook",
    serialOrUdid: "PIXEL-USB-SLOT-01",
    assignedPersona: "chadwick",
    simCarrier: "Tello / US Mobile Prepaid ($15/mo)",
    wifiDisabled: true,
    batteryPct: 60,
    tempC: 31.0,
    warmupStage: "birth_passive",
    dailyActionCap: 0,
    notes: "Dedicated unlocked retail Google Pixel (locked bootloader, Wi-Fi OFF, USB debugging ON, safe envelope 35-80% battery & <=41C).",
  },
  {
    id: "dev-iphone-nyc-01",
    label: "iphone-nyc-01",
    platform: "ios",
    hostMachine: "local-macbook",
    serialOrUdid: "IPHONE-USB-SLOT-01",
    assignedPersona: "sloane",
    simCarrier: "Tello / US Mobile Prepaid ($15/mo)",
    wifiDisabled: true,
    batteryPct: 62,
    tempC: 30.5,
    warmupStage: "birth_passive",
    dailyActionCap: 0,
    notes: "Dedicated unlocked retail iPhone (iOS 18+, Wi-Fi OFF, prebuilt WebDriverAgent, safe envelope 35-80% battery & <=41C).",
  },
] as const;

export const NYC_MONTH1_BUDGET_TRACKS: readonly BudgetTrackAllocation[] = [
  {
    track: "street_fliering",
    label: "Direct Street Teams (Craigslist NYC + RentAHuman.ai)",
    amountCents: 320_000,
    sharePct: 32,
    targetSignups: 450,
    notes: "9 CL NYC posts ($90) + 25x4hr shifts @ $22/hr ($2,200) + $2/signup bonus pool ($320) + RentAHuman couriers/spot drops ($590 incl. 18% fee).",
  },
  {
    track: "creator_video",
    label: "YouTube, TikTok & IG Street-Interview Creators",
    amountCents: 330_000,
    sharePct: 33,
    targetSignups: 435,
    notes: "Backstage & CL talent casting ($100) + 8 micro-creators x $250 ($2,000) + 1 mid-tier anchor ($750) + $2.50/signup bonus pool ($450).",
  },
  {
    track: "event_activation",
    label: "In-Person NYC Event & Venue Activators",
    amountCents: 170_000,
    sharePct: 17,
    targetSignups: 190,
    notes: "14 curated NYC events x 3hr shifts @ $30/hr ($1,260) + entry/drink stipends ($240) + quality onboarding bonus pool ($200).",
  },
  {
    track: "print_qr",
    label: "Serialized 4x6 QR Flier Print & NYC Rush Reserve",
    amountCents: 80_000,
    sharePct: 8,
    targetSignups: 0,
    notes: "25,000 4x6 14pt postcards across 5 serialized QR batches ($550) + NYC same-day rush reserve ($200) + rigid laminated QR hand-cards ($50).",
  },
  {
    track: "agency_reserve",
    label: "W-2 NYC Agency Weekend Blitz Surge Reserve",
    amountCents: 100_000,
    sharePct: 10,
    targetSignups: 90,
    notes: "Held unspent until Day 15; deploys as 1x4-personx4hr W-2 blitz if direct no-show >15%, else reallocates to lowest-CPA Week-4 winner.",
  },
] as const;

export const NYC_MONTH1_WEEKLY_ROLLOUT: readonly WeeklyRolloutSlice[] = [
  {
    week: 1,
    amountCents: 180_000,
    focus: "Order first 15,000 fliers (3 QR batches), post CL & Backstage listings, run 4 test shifts + 2 pilot micro-creator shoots in Wash Sq & SoHo.",
  },
  {
    week: 2,
    amountCents: 260_000,
    focus: "Print final 10,000 fliers on winning copy, run 8 street-team shifts, 4 event activations, and 3 micro-creator shoots.",
  },
  {
    week: 3,
    amountCents: 280_000,
    focus: "Run 8 street-team shifts, 5 event activations, 3 micro-creator shoots, and 1 mid-tier NYC anchor creator shoot.",
  },
  {
    week: 4,
    amountCents: 280_000,
    focus: "Run final 5 street-team shifts, 5 event activations, settle performance bonuses, and deploy $1,000 surge reserve.",
  },
] as const;

export const NYC_ACTIVATION_CORRIDORS: readonly NycActivationCorridor[] = [
  {
    neighborhood: "West Village",
    landmarks: "Washington Square Park perimeter & West 4th St",
    bestWindows: "Thu-Sun 1:00 PM - 6:30 PM",
    primaryApps: ["slop", "friends"],
  },
  {
    neighborhood: "SoHo / Nolita",
    landmarks: "Broadway / Prince St / Spring St",
    bestWindows: "Fri-Sun 12:30 PM - 5:30 PM",
    primaryApps: ["ntwrk", "slop"],
  },
  {
    neighborhood: "Williamsburg",
    landmarks: "Bedford Ave & Domino Park perimeter",
    bestWindows: "Sat-Sun 12:00 PM - 6:00 PM",
    primaryApps: ["friends", "slop"],
  },
  {
    neighborhood: "East Village",
    landmarks: "Astor Place & St. Marks Pl",
    bestWindows: "Thu-Sat 4:00 PM - 8:30 PM",
    primaryApps: ["slop", "peon"],
  },
  {
    neighborhood: "Flatiron / Union Square",
    landmarks: "Union Square South & Flatiron Plaza sidewalks",
    bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:00 PM - 7:00 PM",
    primaryApps: ["peon", "ntwrk"],
  },
  {
    neighborhood: "Midtown West",
    landmarks: "Bryant Park exterior public sidewalks",
    bestWindows: "Tue-Thu 12:00 PM - 2:00 PM",
    primaryApps: ["peon", "ntwrk"],
  },
] as const;

export const NYC_LAUNCH_CAMPAIGN: SeedCampaignConfig = {
  id: "camp-nyc-month-1",
  slug: "nyc-month-1-launch",
  name: "NYC Month-1 Full-Stack Human Acquisition Launch",
  city: "nyc",
  appId: "all",
  tier: 4,
  riskZone: "zone_2_amber",
  riskDial: "conservative",
  monthlyBudgetCents: 1_000_000,
  dailyCapCents: 100_000,
  maxTaskCents: 150_000,
  billingArmed: false,
  slopCashEnabled: false,
  tracks: NYC_MONTH1_BUDGET_TRACKS,
  weeklyRollout: NYC_MONTH1_WEEKLY_ROLLOUT,
  corridors: NYC_ACTIVATION_CORRIDORS,
};

export const NYC_STARTER_TASKS: readonly SeedStarterTask[] = [
  {
    id: "task-nyc-print-batch-001",
    campaignId: NYC_LAUNCH_CAMPAIGN.id,
    tier: 3,
    taskKind: "print_order",
    appId: "all",
    city: "nyc",
    neighborhood: "Astoria / Pickup",
    title: "Print Batch NYC-001..003 (15,000 x 4x6 14pt Serialized QR Postcards)",
    briefText: "Order 3 serialized 5,000-unit 4x6 14pt matte/gloss double-sided postcard batches from 4over4.com (Astoria, Queens pickup) with unique batch QR codes NYC-001, NYC-002, NYC-003.",
    vendorChannel: "print_local",
    amountCents: 33_000,
    bonusCapCents: 0,
    qrBatchCode: "NYC-PRINT-W1",
    payoutRail: "fiat_stripe",
  },
  {
    id: "task-nyc-street-washsq-001",
    campaignId: NYC_LAUNCH_CAMPAIGN.id,
    tier: 4,
    taskKind: "street_fliering",
    appId: "slop",
    city: "nyc",
    neighborhood: "West Village",
    title: "Pilot Street-Team Shift #1 — Washington Sq Perimeter (4 hrs, 18+)",
    briefText: "Hand-to-hand public sidewalk flier distribution near Washington Square Park & West 4th St (8ft sidewalk clearance; zero posting on poles/trees/cars under NYC Admin Code § 10-119; zero MTA subway entry under 21 NYCRR § 1050.6).",
    vendorChannel: "craigslist",
    amountCents: 8_800,
    bonusCapCents: 8_000,
    qrBatchCode: "NYC-001",
    payoutRail: "fiat_stripe",
  },
  {
    id: "task-nyc-creator-soho-001",
    campaignId: NYC_LAUNCH_CAMPAIGN.id,
    tier: 4,
    taskKind: "creator_video",
    appId: "slop",
    city: "nyc",
    neighborhood: "SoHo / Nolita",
    title: "Pilot Street-Interview Creator Shoot #1 — SoHo / Wash Sq (60-90s + 2 Cutdowns)",
    briefText: "Handheld camera + lav/shotgun mic street interviews with 3+ genuine 18+ New Yorkers trying live signup on camera. Mandatory FTC 16 CFR Part 255 spoken + on-screen #Ad disclosure and signed NY Civil Rights Law §§ 50-51 mobile releases for every recognizable interviewee.",
    vendorChannel: "creator_direct",
    amountCents: 25_000,
    bonusCapCents: 15_000,
    qrBatchCode: "CR-NYC-01",
    payoutRail: "fiat_stripe",
  },
  {
    id: "task-nyc-event-flatiron-001",
    campaignId: NYC_LAUNCH_CAMPAIGN.id,
    tier: 4,
    taskKind: "event_activation",
    appId: "peon",
    city: "nyc",
    neighborhood: "Flatiron / Union Square",
    title: "NYC Tech Mixer Event Activator Shift #1 (3 hrs + Entry Stipend)",
    briefText: "Charismatic 18+ activator attends curated Flatiron/Union Sq founder mixer carrying rigid laminated QR card EVT-NYC-01, explains The Network & peon.biz naturally, and submits arrival + mid-event check-ins.",
    vendorChannel: "backstage",
    amountCents: 11_500,
    bonusCapCents: 5_000,
    qrBatchCode: "EVT-NYC-01",
    payoutRail: "fiat_stripe",
  },
  {
    id: "task-nyc-courier-astoria-001",
    campaignId: NYC_LAUNCH_CAMPAIGN.id,
    tier: 4,
    taskKind: "street_fliering",
    appId: "all",
    city: "nyc",
    neighborhood: "Astoria -> Union Square",
    title: "RentAHuman Print-Box Pickup & Handoff (4over4 Astoria -> Union Sq)",
    briefText: "Pick up 3 boxed flier batches from 4over4.com (19-41 46th St, Astoria) and hand off to shift lead at Union Square South with pickup + handoff GPS photos.",
    vendorChannel: "rentahuman",
    amountCents: 5_900,
    bonusCapCents: 0,
    qrBatchCode: "RAH-NYC-01",
    payoutRail: "platform_escrow",
  },
] as const;

export const VETTED_NYC_AGENCIES: readonly VettedNycAgency[] = [
  {
    id: "agency-oppizi",
    name: "Oppizi",
    website: "https://www.oppizi.com",
    contactEmailOrIntake: "contact@oppizi.com | support@oppizi.com | https://www.oppizi.com/contact-sales",
    nycAddress: "426 Union Ave, Brooklyn, NY 11211",
    coreServices: "Tech-enabled GPS-tracked hand-to-hand fliering, door-to-door, print + live analytics (NYC + global)",
    typicalClientRateSummary: "~$1,640 baseline per 1,000 NYC hand-to-hand (incl. print/GPS); drops to $0.70-$1.20/unit at 10k+ vol",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Managed/insured BAs; live GPS proof in Oppizi OS",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-kinetic-events",
    name: "Kinetic Events Staffing",
    website: "https://www.kineticevents.com",
    contactEmailOrIntake: "info@kineticevents.com",
    nycAddress: "311 W 43rd St, New York, NY 10036",
    coreServices: "Tech-savvy W-2 NYC brand ambassadors, app demos, street teams, convention staff (nationwide)",
    typicalClientRateSummary: "~$45-$75/hr all-in client bill; 4-hr shift min",
    leadTimeBusinessDays: "3-5 business days",
    w2AndInsurance: "100% W-2; CGL + Workers' Comp included",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-street-teams-co",
    name: "Street Teams Co",
    website: "https://www.streetteamsco.com",
    contactEmailOrIntake: "hello@streetteamsco.com",
    phone: "(303) 720-6060",
    coreServices: "Dedicated NYC street teams, hand-to-hand flier blitzes, guerrilla sampling (all 5 boroughs + national)",
    typicalClientRateSummary: "~$45-$65/hr street team; $55-$85/hr trained BA; 4-hr min",
    leadTimeBusinessDays: "3-7 business days",
    w2AndInsurance: "Insured agency staff; W-2 compliance",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-broadway-crew",
    name: "Broadway Crew",
    website: "https://www.broadwaycrew.com",
    contactEmailOrIntake: "info@broadwaycrew.com",
    phone: "(332) 333-1889",
    coreServices: "Hyper-local NYC hand-to-hand fliering, Times Sq / Midtown / downtown street teams, hotel routes",
    typicalClientRateSummary: "Custom NYC shift quotes (~$40-$65/hr equiv. or per-shift block); 4-hr min",
    leadTimeBusinessDays: "2-5 business days",
    w2AndInsurance: "NYC-local managed crews; insured",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-victory",
    name: "Victory Agency",
    website: "https://www.victory-agency.com",
    contactEmailOrIntake: "info@victory-agency.com",
    coreServices: "High-volume NYC & national street teams, guerrilla marketing, event staff, digital recap reports",
    typicalClientRateSummary: "~$40-$70/hr blended bill rate (worker pay $22-$35/hr + mgmt); 4-hr min",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "W-2 / insured compliance; digital photo recaps",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-push",
    name: "The PUSH Agency (PUSH Models)",
    website: "https://www.pushagency.com",
    contactEmailOrIntake: "sales@yourpush.com",
    phone: "(888) 502-7575",
    coreServices: "National + NYC street teams, promotional models, brand ambassadors, event staffing (US & Canada)",
    typicalClientRateSummary: "~$45-$75/hr client bill (NYC talent pay avg ~$27/hr); 4-5 hr min",
    leadTimeBusinessDays: "3-7 business days",
    w2AndInsurance: "Insured CGL + statutory Workers' Comp; W-2 where required",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-mustard-lane",
    name: "Mustard Lane",
    website: "https://www.mustardlane.com",
    contactEmailOrIntake: "kristal@mustardlane.com",
    phone: "(212) 686-1876",
    coreServices: "NYC-native charismatic actors/hosts ('Laners') for street teams, flyering, live event onboarding",
    typicalClientRateSummary: "~$50-$80/hr client bill; 4-hr shift min",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "W-2 & jurisdiction-compliant staffing; agency insured",
    zeroTouchBookingReadiness: "medium_high",
  },
  {
    id: "agency-think-flyers",
    name: "Think Flyers",
    website: "https://www.thinkflyers.com",
    contactEmailOrIntake: "accardi@thinkflyers.com",
    coreServices: "NYC 5-borough GPS-tracked hand-to-hand street teams, door-to-door drops, EDDM saturation",
    typicalClientRateSummary: "Door/EDDM from $0.52-$0.64+/pc; custom hand-to-hand; ~5,000-flier typical min",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Managed crews; live GPS + photo verification",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-assist-marketing",
    name: "Assist Marketing",
    website: "https://www.assistmarketing.com",
    contactEmailOrIntake: "https://www.assistmarketing.com (web intake portal)",
    coreServices: "Strictly W-2 NYC & national brand ambassadors, street sampling, experiential staffing",
    typicalClientRateSummary: "~$50-$80/hr client bill (NYC BA pay $25-$30/hr); 5-hr daily min",
    leadTimeBusinessDays: "5-10 business days",
    w2AndInsurance: "100% W-2; full CGL + Workers' Comp",
    zeroTouchBookingReadiness: "medium",
  },
  {
    id: "agency-encore-nationwide",
    name: "Encore Nationwide",
    website: "https://www.encorenationwide.com",
    contactEmailOrIntake: "https://www.encorenationwide.com (web quote calculator & intake)",
    coreServices: "100% W-2 national + NYC brand ambassadors + outsourced W-2 payroll for client-sourced talent",
    typicalClientRateSummary: "~$45-$75/hr client bill (BA pay $21-$28/hr); 4-6 hr min",
    leadTimeBusinessDays: "5-10 business days",
    w2AndInsurance: "100% W-2; full CGL + Workers' Comp; co-employment shield",
    zeroTouchBookingReadiness: "medium",
  },
  {
    id: "agency-air-fresh",
    name: "Air Fresh Marketing",
    website: "https://www.airfreshmarketing.com",
    contactEmailOrIntake: "https://www.airfreshmarketing.com (web quote form)",
    phone: "(303) 720-6060",
    coreServices: "Five-borough NYC street teams, sampling, pop-ups, convention staffing (nationwide)",
    typicalClientRateSummary: "~$45-$85/hr client bill (inclusive of recruiting, training & CGL); 4-hr min",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Fully insured CGL; W-2 field compliance",
    zeroTouchBookingReadiness: "medium",
  },
  {
    id: "agency-attack-marketing",
    name: "Attack! Marketing",
    website: "https://www.attackmarketing.com",
    contactEmailOrIntake: "https://www.attackmarketing.com (web intake form)",
    coreServices: "National + NYC experiential marketing, high-volume street sampling & mobile tours",
    typicalClientRateSummary: "Street sampling from ~$1.00+/item at scale; 4-6 hr shift mins",
    leadTimeBusinessDays: "7-14 business days",
    w2AndInsurance: "W-2 supervised field teams; full CGL + Workers' Comp",
    zeroTouchBookingReadiness: "medium",
  },
  {
    id: "agency-atn-event-staffing",
    name: "ATN Event Staffing",
    website: "https://www.atneventstaffing.com",
    contactEmailOrIntake: "https://www.atneventstaffing.com/contact-us/",
    phone: "(773) 755-0000",
    coreServices: "Large-scale W-2 national + NYC experiential staffing & street teams",
    typicalClientRateSummary: "~$45-$75/hr client bill; $7,500 minimum program spend",
    leadTimeBusinessDays: "10-14 business days",
    w2AndInsurance: "100% W-2; full CGL + Workers' Comp",
    zeroTouchBookingReadiness: "low_m1",
  },
  {
    id: "agency-direct-to-door",
    name: "Direct to Door Marketing",
    website: "https://www.doorhangerswork.com",
    contactEmailOrIntake: "https://www.doorhangerswork.com (20-min web intake quote)",
    coreServices: "Turnkey print + NYC residential door-hanger & flyer distribution",
    typicalClientRateSummary: "Custom turnkey quotes; 1,000-piece minimum (~$0.99-$1.50/door labor in NYC)",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Managed delivery crews; photo verification",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-power-direct",
    name: "Power Direct Marketing",
    website: "https://www.powerdirect.net",
    contactEmailOrIntake: "info@PowerDirect.net",
    phone: "(877) 737-8977",
    coreServices: "Enterprise GPS-tracked front-door hangers, sample drops & experiential street teams (national)",
    typicalClientRateSummary: "Custom enterprise quotes; 10,000+ unit minimum",
    leadTimeBusinessDays: "10-14 business days",
    w2AndInsurance: "Fully insured national operations; GPS audits",
    zeroTouchBookingReadiness: "low_m1",
  },
] as const;

export const SELF_SERVICE_PLATFORMS: readonly SelfServicePlatform[] = [
  {
    id: "platform-craigslist-nyc",
    name: "Craigslist NYC Gigs",
    url: "https://newyork.craigslist.org/gigs",
    pricingModel: "$10/post in NYC (evg/lbg/tlg/crg), 30-day listing, 0% per-applicant markup",
    typicalNycRate: "$22/hr street teams; $30/hr event activators; $250/shoot micro-creators",
    bookingWorkflow: "Post gig with human-filter token -> anonymized email relay -> automated screening rubric -> NYLL § 191-d clickwrap + Stripe Connect",
    bestRoleFit: "Primary Month-1 volume engine for NYC hand-to-hand fliering, student videographers, and bilingual activators",
    month1Priority: "primary",
  },
  {
    id: "platform-rentahuman",
    name: "RentAHuman.ai",
    url: "https://rentahuman.ai",
    pricingModel: "$0/mo SaaS; exact 18% buyer service fee on top of worker payout; 4-day automated review escrow",
    typicalNycRate: "$35-$60/task (print courier runs, solo spot drops, agency spot audits)",
    bookingWorkflow: "Native MCP server (https://rentahuman.ai/api/mcp) or REST API (X-API-Key) with Stripe fiat escrow",
    bestRoleFit: "Agent-native print-box courier pickups (4over4 Astoria / Printleaf Midtown), solo spot drops, and independent street-team spot audits",
    month1Priority: "primary",
  },
  {
    id: "platform-trusted-herd",
    name: "Trusted Herd",
    url: "https://www.trustedherd.com",
    pricingModel: "Software / direct gig posting fees; no fixed % markup on direct bookings",
    typicalNycRate: "$28-$40+/hr (experienced NYC brand ambassadors)",
    bookingWorkflow: "Web job posting + automated email triage of applicant profiles",
    bestRoleFit: "Experienced NYC brand ambassadors & bilingual event activators",
    month1Priority: "primary",
  },
  {
    id: "platform-backstage",
    name: "Backstage",
    url: "https://www.backstage.com",
    pricingModel: "Free employer account; ~$24.95 per casting notice",
    typicalNycRate: "$30-$40/hr or $150-$350/shoot flat",
    bookingWorkflow: "Web casting call + inbox/email redirect to agent for 20-sec reel review",
    bestRoleFit: "Charismatic NYC street-interview hosts, comedic interviewers, and high-energy event activators",
    month1Priority: "primary",
  },
  {
    id: "platform-collabstr",
    name: "Collabstr",
    url: "https://collabstr.com",
    pricingModel: "Free tier ($0/mo, 10% buyer fee on escrow orders)",
    typicalNycRate: "$150-$600/video (NYC micro-creators)",
    bookingWorkflow: "Self-serve NYC creator filter + Stripe escrow checkout + deliverable approval",
    bestRoleFit: "Direct NYC TikTok/IG/YouTube street-interview micro-creator hiring",
    month1Priority: "primary",
  },
  {
    id: "platform-passionfroot",
    name: "Passionfroot",
    url: "https://www.passionfroot.me",
    pricingModel: "$0/mo; 5% fee on self-sourced deals, 15% on Partner Network",
    typicalNycRate: "$200-$1,500/integration",
    bookingWorkflow: "Creator storefront checkout + instant Stripe invoice",
    bestRoleFit: "Zero-friction invoicing & escrow for YouTube/newsletter NYC creators",
    month1Priority: "primary",
  },
  {
    id: "platform-instawork",
    name: "Instawork",
    url: "https://www.instawork.com",
    pricingModel: "$0/mo SaaS; 20%-65% markup (all-in W-2, COI, workers' comp)",
    typicalNycRate: "$21.50-$26/hr worker pay (~$30-$40/hr client bill)",
    bookingWorkflow: "Self-serve shift posting + automated GPS clock-in/out",
    bestRoleFit: "Reliable last-minute W-2 event support & surge flier crews (and CA AB5 cities)",
    month1Priority: "secondary",
  },
  {
    id: "platform-gigsmart",
    name: "GigSmart",
    url: "https://gigsmart.com",
    pricingModel: "$0/mo SaaS; ~35% service fee on labor",
    typicalNycRate: "$25-$35/hr worker pay (~$34-$47/hr client bill)",
    bookingWorkflow: "Self-serve shift dispatch portal + instant GPS clock-in",
    bestRoleFit: "Same-day NYC street-team fill-ins & box movers",
    month1Priority: "secondary",
  },
  {
    id: "platform-wonolo",
    name: "Wonolo",
    url: "https://www.wonolo.com",
    pricingModel: "$0/mo SaaS; 45% fee (1099) or 55% fee (W-2)",
    typicalNycRate: "$22-$28/hr worker pay (~$32-$43/hr client bill)",
    bookingWorkflow: "Self-serve shift board + geolocation clock-in",
    bestRoleFit: "Rapid 5-person weekend activation surges",
    month1Priority: "secondary",
  },
  {
    id: "platform-upwork",
    name: "Upwork",
    url: "https://www.upwork.com",
    pricingModel: "5% client fee (3% ACH) + initiation fee",
    typicalNycRate: "$25-$60/hr",
    bookingWorkflow: "API/web job post + milestone escrow",
    bestRoleFit: "Remote NYC field coordinator or fast video editor for raw creator clips",
    month1Priority: "secondary",
  },
  {
    id: "platform-thumbtack",
    name: "Thumbtack",
    url: "https://www.thumbtack.com",
    pricingModel: "$0 for hirers; pay quoted pro rate directly",
    typicalNycRate: "$35-$65/hr",
    bookingWorkflow: "Web request form -> email quote comparison by agent",
    bestRoleFit: "Boutique NYC event hosts & local micro-agencies",
    month1Priority: "scale_later",
  },
  {
    id: "platform-fiverr",
    name: "Fiverr",
    url: "https://www.fiverr.com",
    pricingModel: "5.5% client fee (+$3.50 on orders <$200)",
    typicalNycRate: "$50-$250/package",
    bookingWorkflow: "Self-serve checkout + milestone review",
    bestRoleFit: "Print-ready CMYK flier layout and vertical caption/cutdown editing",
    month1Priority: "secondary",
  },
] as const;

export const NYC_LOCAL_PRINTERS: readonly NycLocalPrinter[] = [
  {
    id: "printer-4over4-astoria",
    name: "4over4.com",
    website: "https://www.4over4.com",
    contactEmail: "support@4over4.com",
    phone: "(718) 932-2700",
    pickupLocation: "19-41 46th St, Astoria, Queens, NY 11105 (Mon-Fri 10am-5:30pm pickup)",
    cost5k4x6PostcardsUsd: "$75-$125",
    sameDayAvailable: true,
    operationalUse: "Primary NYC gang-run bulk printer; agent orders online via card and dispatches RentAHuman courier for same/next-day Astoria pickup.",
  },
  {
    id: "printer-printleaf-midtown",
    name: "Printleaf",
    website: "https://www.printleaf.com",
    contactEmail: "sales@printleaf.com",
    phone: "(212) 328-1174",
    pickupLocation: "30 W 47th St #405, Midtown Manhattan, NY 10036",
    cost5k4x6PostcardsUsd: "$300-$550 (order by 12 PM for same-day / 3-hr rush)",
    sameDayAvailable: true,
    operationalUse: "Emergency Midtown Manhattan same-day rush batches and quick copy pivots.",
  },
  {
    id: "printer-bestype-soho",
    name: "Bestype Imaging",
    website: "https://www.bestypeimaging.com",
    contactEmail: "imaging@bestype.net",
    phone: "(212) 966-6886",
    pickupLocation: "285 W Broadway, SoHo/Tribeca, NY 10013",
    cost5k4x6PostcardsUsd: "$350-$650 (CMYK PDF, 300 dpi, 0.125\" bleed)",
    sameDayAvailable: true,
    operationalUse: "Downtown rush print next to SoHo / West Village / Washington Sq shoot zones.",
  },
  {
    id: "printer-gotprint",
    name: "GotPrint",
    website: "https://www.gotprint.com",
    pickupLocation: "Online gang-run shipping to NYC pickup address/locker",
    cost5k4x6PostcardsUsd: "$100-$160 (+ shipping)",
    sameDayAvailable: false,
    operationalUse: "Scheduled bulk runs and multi-city replication (3-5 day lead).",
  },
  {
    id: "printer-moo",
    name: "MOO",
    website: "https://www.moo.com",
    pickupLocation: "Online delivery",
    cost5k4x6PostcardsUsd: "~$515-$525 (Printfinity small rigid card batches)",
    sameDayAvailable: false,
    operationalUse: "Small batches of rigid laminated QR hand-cards for event activators and street-interview creators.",
  },
] as const;

export const ON_SITE_RELEASE_FORM_COPY =
  "I confirm I am at least 18 years old. Under New York Civil Rights Law §§ 50 and 51, I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid commercial advertising, social media, and promotional materials, with no additional compensation owed.";

export const NYC_EMAIL_TEMPLATES: Record<EmailTemplateId, AutomatedEmailTemplate> = {
  craigslist_gig_post: {
    id: "craigslist_gig_post",
    title: "Craigslist NYC Gig Post (evg/lbg Street Team)",
    channel: "craigslist",
    subjectTemplate:
      "$22/hr + Bonus — NYC Hand-to-Hand Flier & App Launch Street Team (4-Hr Shift, {{NEIGHBORHOOD}})",
    bodyTemplate: [
      "We are hiring outgoing, reliable 18+ NYC locals for paid 4-hour street-team shifts promoting a new NYC social and dating network (ntwrk.party / slop.date / friends.help).",
      "",
      "SHIFT DETAILS:",
      "- Date & Time: {{SHIFT_DATE}}, {{START_TIME}} - {{END_TIME}} (4 hours)",
      "- Location: Public sidewalks near {{LANDMARK_AND_NEIGHBORHOOD}}",
      "- Pay: $22/hr guaranteed base ($88 per 4-hr shift) PLUS $2 bonus for every verified NYC 18+ signup scanned from your unique batch QR code.",
      "- Payout: Paid via Stripe / direct deposit within 48 hours of verified shift completion (written NYLL § 191-d contractor agreement provided before shift).",
      "",
      "DUTIES & STRICT RULES:",
      "- Hand fliers directly person-to-person to willing adult pedestrians and give a friendly 10-second pitch.",
      "- NEVER tape, glue, or post fliers on lampposts, poles, trees, or car windshields (NYC Admin Code § 10-119 — zero tolerance).",
      "- NEVER enter subway stations/mezzanines (21 NYCRR § 1050.6) or block doorways (keep 8ft sidewalk clearance).",
      "- Submit 3 timestamped GPS check-in photos (shift start, midpoint, end) via our check-in link.",
      "",
      "REQUIREMENTS:",
      "- Must be 18+ with valid US tax/payout eligibility (1099 contractor, W-9 via Stripe).",
      "- Smartphone with working camera and GPS.",
      "- Friendly, clear English communicator who shows up on time.",
      "",
      "HOW TO APPLY (REQUIRED):",
      "Reply to this email and start your first line with your closest NYC subway stop + \"18+ CONFIRMED\". Include:",
      "1. Your first name and neighborhood",
      "2. 1-2 sentences on any promo, hospitality, sales, or street-team experience",
      "3. Confirm you can make {{SHIFT_DATE}} {{START_TIME}}-{{END_TIME}}",
      "",
      "Replies missing the subway stop + \"18+ CONFIRMED\" line are automatically skipped.",
    ].join("\n"),
    requiredVariables: [
      "NEIGHBORHOOD",
      "SHIFT_DATE",
      "START_TIME",
      "END_TIME",
      "LANDMARK_AND_NEIGHBORHOOD",
    ],
    legalGuardrails: [
      "18+ strict paid worker floor (inv_adult_only_paid)",
      "NYC Admin Code § 10-119 anti-posting ban",
      "21 NYCRR § 1050.6 MTA subway commercial flyer ban",
      "NYLL § 191-d written contractor disclosure",
    ],
  },

  applicant_screening_hire_reply: {
    id: "applicant_screening_hire_reply",
    title: "Automated Email Screening, Hiring & NYLL § 191-d Reply",
    channel: "email",
    subjectTemplate: "Re: {{ORIGINAL_SUBJECT}} — Shift Offer & Quick Confirmation ({{SHIFT_ID}})",
    bodyTemplate: [
      "Hi {{FIRST_NAME}},",
      "",
      "Thanks for applying. You passed our initial screen for the {{SHIFT_DATE}} ({{START_TIME}}-{{END_TIME}}) NYC street-team shift at {{LANDMARK_AND_NEIGHBORHOOD}}.",
      "",
      "YOUR CONTRACT TERMS (NYLL § 191-d Written Summary):",
      "- Role: Independent Contractor — Legal Hand-to-Hand Flier Distribution (Batch QR #{{BATCH_ID}})",
      "- Base Compensation: $88.00 flat for completed 4-hour shift ($22/hr)",
      "- Performance Bonus: +$2.00 per unique verified NYC 18+ signup from Batch QR #{{BATCH_ID}} above 6 signups (capped at +$80/shift)",
      "- Payment Method & Due Date: Stripe Connect direct deposit within 48 hours of approved proof-of-work (no later than 15 days after shift completion, well inside the 30-day NYLL § 191-d statutory limit)",
      "- Mandatory Compliance: 18+ confirmed; hand-to-hand on public sidewalks only (8ft clear path); zero posting on poles/trees/cars (NYC Admin Code § 10-119); zero subway interior distribution (21 NYCRR § 1050.6).",
      "",
      "LOCK YOUR SHIFT IN 2 MINUTES:",
      "1. Review & e-sign the NYLL § 191-d contractor agreement + set up instant payout here: {{ONBOARDING_AND_CONTRACT_URL}}",
      "2. Reply \"CONFIRMED\" to this email once signed.",
      "",
      "CHECK-IN & FLIER PICKUP PROTOCOL:",
      "- You will receive an automated confirmation ping 24 hours and 3 hours before shift start. You must reply YES by {{T_MINUS_3H_TIME}} or the shift automatically moves to our standby bench.",
      "- Flier pickup: {{PICKUP_INSTRUCTIONS_OR_COURIER_HANDOFF}}",
      "- Upload your 3 timestamped GPS check-in photos (Start / Mid / End) here: {{PROOF_UPLOAD_URL}}",
      "",
      "Reply with any logistics question — our ops system monitors this inbox 24/7.",
      "",
      "Best,",
      "NYC Field Ops | The Network",
      "ops-nyc@ntwrk.party",
    ].join("\n"),
    requiredVariables: [
      "ORIGINAL_SUBJECT",
      "SHIFT_ID",
      "FIRST_NAME",
      "SHIFT_DATE",
      "START_TIME",
      "END_TIME",
      "LANDMARK_AND_NEIGHBORHOOD",
      "BATCH_ID",
      "ONBOARDING_AND_CONTRACT_URL",
      "T_MINUS_3H_TIME",
      "PICKUP_INSTRUCTIONS_OR_COURIER_HANDOFF",
      "PROOF_UPLOAD_URL",
    ],
    legalGuardrails: [
      "NYLL § 191-d itemized written contract & <=15d payout SLA",
      "18+ confirmed age gate",
      "NYC Admin Code § 10-119 & 21 NYCRR § 1050.6 compliance",
    ],
  },

  agency_rfp: {
    id: "agency_rfp",
    title: "Vetted NYC Agency RFP & Zero-Call Direct Booking Email",
    channel: "email",
    subjectTemplate:
      "NYC Street-Team Quote & Direct Booking Request — {{TARGET_DATES}} ({{HEADCOUNT}} W-2 Staff, 4-Hr Shift)",
    bodyTemplate: [
      "Hello {{AGENCY_NAME}} Team,",
      "",
      "We are booking a compliant, insured W-2 street-team activation in New York City and would like to confirm availability and book directly over email (no discovery call needed).",
      "",
      "ACTIVATION BRIEF:",
      "- Brand: The Network (ntwrk.party / slop.date / friends.help) — 18+ NYC social & dating platform",
      "- City & Zones: {{NEIGHBORHOODS}} (outdoor public sidewalks only; zero tables, tents, or sound; zero MTA subway interiors; zero posting on poles/property)",
      "- Dates & Shift Length: {{TARGET_DATES}}, {{SHIFT_HOURS}} (4 hours)",
      "- Staffing Needed: {{HEADCOUNT}} energetic, outgoing W-2 Brand Ambassadors (21+ preferred, 18+ mandatory)",
      "- Collateral: We will supply pre-printed 4x6\" postcards with unique batch QR codes (delivered to your NYC office or local courier handoff)",
      "- Required Proof of Work: GPS clock-in/out logs + start, midpoint, and end timestamped photos from each ambassador + leftover flier count",
      "",
      "PLEASE REPLY WITH:",
      "1. All-in hourly client bill rate per W-2 ambassador (confirming CGL + Workers' Comp COI included)",
      "2. Total itemized quote including any management, rush, or minimum fees",
      "3. Confirmation that we can approve via email SOW and pay immediately via credit card or Stripe/ACH invoice",
      "",
      "If the quote fits our budget cap (${{BUDGET_CAP}}), we will issue immediate email approval and submit payment today.",
      "",
      "Thank you,",
      "Campaign Ops | The Network",
      "ops-nyc@ntwrk.party",
    ].join("\n"),
    requiredVariables: [
      "AGENCY_NAME",
      "TARGET_DATES",
      "HEADCOUNT",
      "NEIGHBORHOODS",
      "SHIFT_HOURS",
      "BUDGET_CAP",
    ],
    legalGuardrails: [
      "100% W-2 + CGL + Workers' Comp confirmation",
      "18+ mandatory ambassador age floor",
      "Outdoor public sidewalks only; zero posting; zero MTA subway interiors",
    ],
  },

  creator_street_interview_brief: {
    id: "creator_street_interview_brief",
    title: "NYC Street-Interview Creator Brief (FTC #Ad + NY Civil Rights Law §§ 50-51)",
    channel: "email",
    subjectTemplate:
      "Paid NYC Street-Interview Collab (${{FLAT_FEE}} Flat + $2.50/Signup Bonus) — {{CREATOR_NAME}}",
    bodyTemplate: [
      "Hi {{CREATOR_NAME}},",
      "",
      "We love your NYC street-interview videos — especially {{RECENT_VIDEO_TITLE}}. We want to sponsor a 60-90 second NYC street-interview piece for The Network (ntwrk.party / slop.date / friends.help), an AI-powered real-world social and dating network launching across NYC.",
      "",
      "THE CONCEPT (AUTHENTIC VOX-POP, ZERO SCRIPTED ACTORS):",
      "- Shoot location: Public sidewalk in {{NEIGHBORHOOD}} (handheld camera + lav/shotgun mic only — zero light stands or C-stands so no MOME permit needed).",
      "- Hook ideas: \"What's your worst NYC dating app story — would you let an AI agent set up a real-world match instead?\" OR \"Would you let an AI find you 3 real NYC friends this weekend?\"",
      "- On-camera proof: Have 3+ real 18+ interviewees scan your unique QR card live on camera and react to the quick onboarding flow.",
      "",
      "DELIVERABLES & COMPENSATION (NYLL § 191-d Written Terms):",
      "- Deliverables:",
      "  1. 1 main edited video (60-90s) published publicly on {{PRIMARY_PLATFORM}}",
      "  2. 2 vertical cutdowns (20-35s) + raw clips uploaded to our folder (perpetual organic + paid social usage rights included)",
      "  3. Unique QR card shown clearly on screen + unique link ({{CREATOR_SHORTLINK}}) pinned in top comment & bio for 30 days",
      "- Fee: ${{FLAT_FEE}} guaranteed flat fee paid within 48 hours of approved publication + $2.50 bonus per verified 18+ NYC signup from your unique link/QR (bonus capped at +${{BONUS_CAP}}, settled at Day 14).",
      "",
      "MANDATORY LEGAL & COMPLIANCE REQUIREMENTS (NON-NEGOTIABLE):",
      "1. FTC Disclosure (16 CFR Part 255): Include BOTH a spoken disclosure (\"Sponsored by The Network\") AND clear on-screen text (\"#Ad\" or \"Paid Partnership with The Network\") in the first 3 seconds, plus enable the platform's Paid Partnership / Commercial Content toggle.",
      "2. NY Civil Rights Law §§ 50-51 Commercial Releases: Every recognizable interviewee shown in your final edit MUST be 18+ and sign our 10-second mobile release QR ({{RELEASE_FORM_URL}}) on site. Blur or cut anyone who does not sign.",
      "3. Age Floor: Do not film or onboard anyone under 18.",
      "",
      "ON-SITE MOBILE RELEASE TEXT (NY Civil Rights Law §§ 50-51):",
      `"${ON_SITE_RELEASE_FORM_COPY}"`,
      "",
      "ACCEPT & LOCK IN:",
      "Sign the clickwrap creator agreement and set up instant Stripe/Passionfroot payout here: {{CREATOR_CONTRACT_URL}}",
      "Target publish date: {{TARGET_PUBLISH_DATE}}.",
      "",
      "Best,",
      "Creator Partnerships | The Network",
      "ops-nyc@ntwrk.party",
    ].join("\n"),
    requiredVariables: [
      "CREATOR_NAME",
      "RECENT_VIDEO_TITLE",
      "NEIGHBORHOOD",
      "PRIMARY_PLATFORM",
      "CREATOR_SHORTLINK",
      "FLAT_FEE",
      "BONUS_CAP",
      "RELEASE_FORM_URL",
      "CREATOR_CONTRACT_URL",
      "TARGET_PUBLISH_DATE",
    ],
    legalGuardrails: [
      "FTC 16 CFR Part 255 spoken + on-screen #Ad disclosure",
      "NY Civil Rights Law §§ 50-51 written commercial likeness releases",
      "NYC MOME handheld-only sidewalk filming rules",
      "18+ creator and interviewee floor",
    ],
  },

  proof_of_work_reminder: {
    id: "proof_of_work_reminder",
    title: "Automated Proof-of-Work Verification & Fast Payout Reminder",
    channel: "email",
    subjectTemplate: "Action Required for 48-Hr Payout — Submit Proof for {{TASK_TITLE}} ({{BATCH_ID}})",
    bodyTemplate: [
      "Hi {{FIRST_NAME}},",
      "",
      "Thanks for completing your NYC activation for The Network ({{TASK_TITLE}}, Batch #{{BATCH_ID}}).",
      "",
      "To trigger automatic Stripe payout within 48 hours (well inside our NYLL § 191-d SLA), please upload all required verification items here: {{PROOF_UPLOAD_URL}}",
      "",
      "REQUIRED PROOF CHECKLIST:",
      "- Street Teams & Event Activators:",
      "  1. Timestamped GPS check-in photos (Start / Midpoint / End) within the assigned NYC zone",
      "  2. Photo of remaining flier stack / QR card at end of shift",
      "- Street-Interview Creators:",
      "  1. Live public URL of the published main video (60-90s)",
      "  2. Folder link with 2 vertical cutdowns (20-35s) + raw clips",
      "  3. Confirmation of spoken + on-screen FTC #Ad / Paid Partnership disclosure (16 CFR Part 255)",
      "  4. Signed 18+ NY Civil Rights Law §§ 50-51 mobile releases matching every recognizable interviewee",
      "",
      "Once our automated verifier confirms your submission, your base payout (${{BASE_PAY_USD}}) releases immediately and verified 18+ signup bonuses for Batch #{{BATCH_ID}} settle on schedule.",
      "",
      "Questions or upload issue? Reply directly to this thread.",
      "",
      "Best,",
      "Verification & Payouts | The Network",
      "ops-nyc@ntwrk.party",
    ].join("\n"),
    requiredVariables: [
      "FIRST_NAME",
      "TASK_TITLE",
      "BATCH_ID",
      "PROOF_UPLOAD_URL",
      "BASE_PAY_USD",
    ],
    legalGuardrails: [
      "inv_proof_required_before_payout",
      "FTC 16 CFR Part 255 disclosure audit",
      "NY Civil Rights Law §§ 50-51 release audit",
      "NYLL § 191-d timely payout SLA",
    ],
  },
};

export function renderEmailTemplate(
  templateId: EmailTemplateId,
  variables: Record<string, string>,
): { subject: string; body: string; missingVariables: string[] } {
  const tpl = NYC_EMAIL_TEMPLATES[templateId];
  const missingVariables = tpl.requiredVariables.filter(
    (key) => variables[key] === undefined || variables[key].trim() === "",
  );
  const replaceTokens = (input: string) =>
    input.replace(/\{\{([A-Z0-9_]+)\}\}/g, (full, key: string) =>
      variables[key] !== undefined ? variables[key] : full,
    );
  return {
    subject: replaceTokens(tpl.subjectTemplate),
    body: replaceTokens(tpl.bodyTemplate),
    missingVariables,
  };
}

export interface NycLaunchSeedBundle {
  campaign: SeedCampaignConfig;
  agents: SeedAgentConfig[];
  devices: SeedDeviceSlot[];
  starterTasks: SeedStarterTask[];
  agencies: readonly VettedNycAgency[];
  platforms: readonly SelfServicePlatform[];
  printers: readonly NycLocalPrinter[];
  templates: Record<EmailTemplateId, AutomatedEmailTemplate>;
}

export function buildNycLaunchSeed(
  agentOverrides?: Parameters<typeof createNycSeedAgents>[0],
): NycLaunchSeedBundle {
  return {
    campaign: {
      ...NYC_LAUNCH_CAMPAIGN,
      tracks: [...NYC_MONTH1_BUDGET_TRACKS],
      weeklyRollout: [...NYC_MONTH1_WEEKLY_ROLLOUT],
      corridors: [...NYC_ACTIVATION_CORRIDORS],
    },
    agents: createNycSeedAgents(agentOverrides),
    devices: NYC_TIER2_DEVICES.map((d) => ({ ...d })),
    starterTasks: NYC_STARTER_TASKS.map((t) => ({ ...t })),
    agencies: VETTED_NYC_AGENCIES,
    platforms: SELF_SERVICE_PLATFORMS,
    printers: NYC_LOCAL_PRINTERS,
    templates: NYC_EMAIL_TEMPLATES,
  };
}
