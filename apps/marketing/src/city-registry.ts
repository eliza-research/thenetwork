import { getCity as getCoreCity } from "../../../packages/core/src/cities.ts";
import { BRAND_DOMAINS } from "./constants.ts";
import type { DesireLaneId } from "./desire-lanes.ts";
import type { BrandAppId } from "./types.ts";

export type CityCode = string;

export const CITY_LAUNCH_STAGES = [
  "researching",
  "waitlist_kindling",
  "liquidity_seeding",
  "live_matching",
  "scaling",
] as const;

export type CityLaunchStage = (typeof CITY_LAUNCH_STAGES)[number];

export type LaborClassification =
  | "1099_allowed"
  | "w2_required_ab5"
  | "uk_paye_or_agency"
  | "regulated_agency_required";

export interface OpenDataConnectorSpec {
  readonly id: string;
  readonly kind: "venues" | "liquor_licenses" | "liquor_principals";
  readonly urlTemplate: string;
  readonly adapter: "socrata_json";
  readonly fieldMap: {
    readonly idField: string;
    readonly nameField: string;
    readonly fallbackNameField?: string;
    readonly addressFields: readonly string[];
    readonly categoryField?: string;
    readonly phoneField?: string;
    readonly principalField?: string;
    readonly gradeOrStatusField?: string;
    readonly countyOrBoroField?: string;
    readonly zipField?: string;
  };
  readonly defaultDesireLanes: readonly DesireLaneId[];
}

export interface CityCorridor {
  readonly neighborhood: string;
  readonly landmarks: string;
  readonly bestWindows: string;
  readonly primaryApps: readonly BrandAppId[];
  readonly primaryDesireLanes: readonly DesireLaneId[];
}

export interface CityNeighborhoodPattern {
  readonly label: string;
  readonly patterns: readonly string[];
}

export interface CityDiscoveryEndpoints {
  readonly lumaUrl: string;
  readonly eventbriteUrl: string;
  readonly subreddits: readonly string[];
  readonly githubLocationQuery: string;
  readonly hnQuery: string;
  readonly openAlexQuery: string;
  readonly clinicalLocation: string;
  readonly openDataVenuesUrl: string | null;
  readonly liquorLicensesUrl: string | null;
  readonly openDataConnectors: readonly OpenDataConnectorSpec[];
}

export interface CityLegalRules {
  readonly laborClassification: LaborClassification;
  readonly w2RequiredForStreetTeams: boolean;
  readonly flierLicenceRequired: boolean;
  readonly freelanceStatute: string;
  readonly payoutSlaDays: number;
  readonly antiPostingRule: string;
  readonly transitExclusionRule: string;
  readonly likenessReleaseStatute: string;
  readonly likenessReleaseCopy: string;
  readonly disclosureAuthority: string;
  readonly biometricBanStatute: string | null;
  readonly botDisclosureRequired: boolean;
  readonly quietHoursLocal: { readonly startHour: number; readonly endHour: number };
  readonly permitSummary: string;
}

export interface CityVendorAgency {
  readonly id: string;
  readonly name: string;
  readonly website: string;
  readonly contactEmailOrIntake: string;
  readonly phone?: string;
  readonly localAddress?: string;
  readonly coreServices: string;
  readonly typicalClientRateSummary: string;
  readonly leadTimeBusinessDays: string;
  readonly w2AndInsurance: string;
  readonly zeroTouchBookingReadiness: "high" | "medium_high" | "medium" | "low_m1";
}

export interface CityVendorPlatform {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly pricingModel: string;
  readonly typicalLocalRate: string;
  readonly bookingWorkflow: string;
  readonly bestRoleFit: string;
  readonly month1Priority: "primary" | "secondary" | "scale_later";
}

export interface CityVendorPrinter {
  readonly id: string;
  readonly name: string;
  readonly website: string;
  readonly contactEmail?: string;
  readonly phone?: string;
  readonly pickupLocation: string;
  readonly cost5k4x6PostcardsUsd: string;
  readonly sameDayAvailable: boolean;
  readonly operationalUse: string;
}

export interface CityVendorSeed {
  readonly craigslistSubdomain: string | null;
  readonly craigslistPostFeeCents: number;
  readonly recommendedAgencies: readonly string[];
  readonly recommendedPrinters: readonly string[];
  readonly vettedAgencies: readonly CityVendorAgency[];
  readonly platforms: readonly CityVendorPlatform[];
  readonly printers: readonly CityVendorPrinter[];
}

export interface CityBudgetDefaults {
  readonly monthlyBudgetCents: number;
  readonly dailyCapCents: number;
  readonly maxTaskCents: number;
  readonly targetCpaCents: number;
  readonly streetShiftHourlyCents: number;
  readonly eventActivatorHourlyCents: number;
  readonly microCreatorFlatCents: number;
}

export interface CityReadinessGates {
  readonly minWaitlistAdultsForSeeding: number;
  readonly minSignedVenuesForSeeding: number;
  readonly minActiveAdultsForLiveMatching: number;
  readonly maxActiveAdultsV1Pool: number;
}

export interface CityPack {
  readonly code: CityCode;
  readonly label: string;
  readonly country: string;
  readonly stateCode: string | null;
  readonly currency: string;
  readonly locale: string;
  readonly timezone: string;
  readonly e164DialPrefixes: readonly string[];
  readonly opsEmail: string;
  readonly isPrimaryLaunch: boolean;
  readonly platformActive: boolean;
  readonly stage: CityLaunchStage;
  readonly defaultMonthlyBudgetCents: number;
  readonly defaultDailyCapCents: number;
  readonly defaultMaxTaskCents: number;
  readonly activationWaitlistMinAdults: number;
  readonly activationMinSignedVenues: number;
  readonly budgetDefaults: CityBudgetDefaults;
  readonly readinessGates: CityReadinessGates;
  readonly corridors: readonly CityCorridor[];
  readonly neighborhoodPatterns: readonly CityNeighborhoodPattern[];
  readonly transitKeywords: readonly string[];
  readonly discovery: CityDiscoveryEndpoints;
  readonly legal: CityLegalRules;
  readonly vendors: CityVendorSeed;
}

export interface CityStageMetrics {
  readonly verifiedWaitlistAdults: number;
  readonly signedVenues: number;
  readonly activeAdults?: number;
  readonly parityRatio?: number;
  readonly reviewSlaHealthy?: boolean;
  readonly trailing30dCpaCents?: number | null;
  readonly trailing30dStopRateBps?: number;
  readonly safetyViolations?: number;
}

export interface CityStageReadinessResult {
  readonly city: CityCode;
  readonly currentStage: CityLaunchStage;
  readonly nextStage: CityLaunchStage | null;
  readonly platformActive: boolean;
  readonly canPromote: boolean;
  readonly blockers: readonly string[];
}

export class UnknownCityError extends Error {
  readonly code = "UNKNOWN_CITY" as const;
  readonly city: string;

  constructor(city: string) {
    super(`Unknown city pack: "${city}". Register it via registerCityPack() or use a configured metro.`);
    this.name = "UnknownCityError";
    this.city = city;
  }
}

const CITY_SLUG_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export const SHARED_SELF_SERVICE_PLATFORMS: readonly CityVendorPlatform[] = [
  {
    id: "platform-craigslist",
    name: "Craigslist Local Gigs",
    url: "https://craigslist.org/about/sites",
    pricingModel: "$5-$10/post (evg/lbg/tlg/crg), 30-day listing, 0% per-applicant markup",
    typicalLocalRate: "$20-$28/hr street teams; $28-$35/hr event activators; $250/shoot micro-creators",
    bookingWorkflow: "Human-first casting post -> relay inbox -> screening rubric -> clickwrap + Stripe Connect",
    bestRoleFit: "Primary Month-1 volume engine for 1099-eligible US cities",
    month1Priority: "primary",
  },
  {
    id: "platform-rentahuman",
    name: "RentAHuman.ai",
    url: "https://rentahuman.ai",
    pricingModel: "$0/mo SaaS; 18% buyer service fee on worker payout; 4-day automated review escrow",
    typicalLocalRate: "$35-$60/task (print courier runs, solo spot drops, venue mystery audits)",
    bookingWorkflow: "Native MCP server (https://rentahuman.ai/api/mcp) or REST API with Stripe escrow",
    bestRoleFit: "Print-box courier pickups, solo spot drops, and Day-14 venue audits",
    month1Priority: "primary",
  },
  {
    id: "platform-trusted-herd",
    name: "Trusted Herd",
    url: "https://www.trustedherd.com",
    pricingModel: "Direct gig posting fees; 0% fixed markup on direct bookings",
    typicalLocalRate: "$28-$40+/hr (experienced brand ambassadors)",
    bookingWorkflow: "Web job posting + automated email triage",
    bestRoleFit: "Experienced brand ambassadors & bilingual event activators",
    month1Priority: "primary",
  },
  {
    id: "platform-backstage",
    name: "Backstage",
    url: "https://www.backstage.com",
    pricingModel: "Free employer account; ~$24.95 per casting notice",
    typicalLocalRate: "$30-$40/hr or $150-$350/shoot flat",
    bookingWorkflow: "Casting call + inbox redirect to agent for 20-sec reel review",
    bestRoleFit: "Charismatic street-interview hosts, comics, and event activators",
    month1Priority: "primary",
  },
  {
    id: "platform-collabstr",
    name: "Collabstr",
    url: "https://collabstr.com",
    pricingModel: "Free tier ($0/mo, 10% buyer fee on escrow orders)",
    typicalLocalRate: "$150-$600/video (local micro-creators)",
    bookingWorkflow: "City creator filter + Stripe escrow checkout + deliverable approval",
    bestRoleFit: "Direct TikTok/IG/YouTube street-interview micro-creator hiring",
    month1Priority: "primary",
  },
  {
    id: "platform-passionfroot",
    name: "Passionfroot",
    url: "https://www.passionfroot.me",
    pricingModel: "$0/mo; 5% fee on self-sourced deals, 15% on Partner Network",
    typicalLocalRate: "$200-$1,500/integration",
    bookingWorkflow: "Creator storefront checkout + instant Stripe invoice",
    bestRoleFit: "Zero-friction invoicing & escrow for YouTube/newsletter creators",
    month1Priority: "primary",
  },
  {
    id: "platform-instawork",
    name: "Instawork (W-2)",
    url: "https://www.instawork.com",
    pricingModel: "$0/mo SaaS; 20%-65% markup (all-in W-2, COI, workers' comp)",
    typicalLocalRate: "$22-$28/hr worker pay (~$30-$42/hr client bill)",
    bookingWorkflow: "Self-serve shift posting + GPS clock-in/out",
    bestRoleFit: "Mandatory W-2 shifts in California (AB5) & reliable weekend surges",
    month1Priority: "secondary",
  },
  {
    id: "platform-gigsmart",
    name: "GigSmart",
    url: "https://gigsmart.com",
    pricingModel: "$0/mo SaaS; ~35% service fee on labor",
    typicalLocalRate: "$25-$35/hr worker pay (~$34-$47/hr client bill)",
    bookingWorkflow: "Self-serve shift dispatch portal + instant GPS clock-in",
    bestRoleFit: "Same-day street-team fill-ins & print-box movers",
    month1Priority: "secondary",
  },
  {
    id: "platform-wonolo",
    name: "Wonolo",
    url: "https://www.wonolo.com",
    pricingModel: "$0/mo SaaS; 45% fee (1099) or 55% fee (W-2)",
    typicalLocalRate: "$22-$28/hr worker pay (~$32-$43/hr client bill)",
    bookingWorkflow: "Self-serve shift board + geolocation clock-in",
    bestRoleFit: "Rapid multi-person weekend activation surges",
    month1Priority: "secondary",
  },
  {
    id: "platform-upwork",
    name: "Upwork",
    url: "https://www.upwork.com",
    pricingModel: "5% client fee (3% ACH) + initiation fee",
    typicalLocalRate: "$25-$60/hr",
    bookingWorkflow: "API/web job post + milestone escrow",
    bestRoleFit: "Local field coordinator or fast vertical video editor",
    month1Priority: "secondary",
  },
  {
    id: "platform-thumbtack",
    name: "Thumbtack",
    url: "https://www.thumbtack.com",
    pricingModel: "$0 for hirers; pay quoted pro rate directly",
    typicalLocalRate: "$35-$65/hr",
    bookingWorkflow: "Web request form -> email quote comparison",
    bestRoleFit: "Boutique local event hosts & micro-agencies",
    month1Priority: "scale_later",
  },
  {
    id: "platform-fiverr",
    name: "Fiverr",
    url: "https://www.fiverr.com",
    pricingModel: "5.5% client fee (+$3.50 on orders <$200)",
    typicalLocalRate: "$50-$250/package",
    bookingWorkflow: "Self-serve checkout + milestone review",
    bestRoleFit: "Print-ready CMYK postcard layout and vertical caption/cutdown editing",
    month1Priority: "secondary",
  },
];

const NATIONAL_W2_AGENCIES: readonly CityVendorAgency[] = [
  {
    id: "agency-oppizi",
    name: "Oppizi",
    website: "https://www.oppizi.com",
    contactEmailOrIntake: "contact@oppizi.com | support@oppizi.com | https://www.oppizi.com/contact-sales",
    localAddress: "426 Union Ave, Brooklyn, NY 11211",
    coreServices: "Tech-enabled GPS-tracked hand-to-hand fliering, door-to-door, print + live analytics (US & global)",
    typicalClientRateSummary: "~$1,640 baseline per 1,000 hand-to-hand (incl. print/GPS); drops to $0.70-$1.20/unit at 10k+ vol",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Managed/insured BAs; live GPS proof in Oppizi OS",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-kinetic-events",
    name: "Kinetic Events Staffing",
    website: "https://www.kineticevents.com",
    contactEmailOrIntake: "info@kineticevents.com",
    localAddress: "311 W 43rd St, New York, NY 10036",
    coreServices: "Tech-savvy W-2 brand ambassadors, app demos, street teams, convention staff (nationwide)",
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
    coreServices: "Dedicated street teams, hand-to-hand flier blitzes, guerrilla sampling (national)",
    typicalClientRateSummary: "~$45-$65/hr street team; $55-$85/hr trained BA; 4-hr min",
    leadTimeBusinessDays: "3-7 business days",
    w2AndInsurance: "Insured agency staff; W-2 compliance",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-victory",
    name: "Victory Agency",
    website: "https://www.victory-agency.com",
    contactEmailOrIntake: "info@victory-agency.com",
    coreServices: "High-volume street teams, guerrilla marketing, event staff, digital recap reports",
    typicalClientRateSummary: "~$40-$70/hr blended bill rate; 4-hr min",
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
    coreServices: "National street teams, promotional models, brand ambassadors, event staffing (US & Canada)",
    typicalClientRateSummary: "~$45-$75/hr client bill; 4-5 hr min",
    leadTimeBusinessDays: "3-7 business days",
    w2AndInsurance: "Insured CGL + statutory Workers' Comp; W-2 where required",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-assist-marketing",
    name: "Assist Marketing",
    website: "https://www.assistmarketing.com",
    contactEmailOrIntake: "https://www.assistmarketing.com (web intake portal)",
    coreServices: "Strictly W-2 brand ambassadors, street sampling, experiential staffing (nationwide)",
    typicalClientRateSummary: "~$50-$80/hr client bill; 5-hr daily min",
    leadTimeBusinessDays: "5-10 business days",
    w2AndInsurance: "100% W-2; full CGL + Workers' Comp",
    zeroTouchBookingReadiness: "medium",
  },
  {
    id: "agency-encore-nationwide",
    name: "Encore Nationwide",
    website: "https://www.encorenationwide.com",
    contactEmailOrIntake: "https://www.encorenationwide.com (web quote calculator & intake)",
    coreServices: "100% W-2 national brand ambassadors + outsourced W-2 payroll for client-sourced talent",
    typicalClientRateSummary: "~$45-$75/hr client bill; 4-6 hr min",
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
    coreServices: "National street teams, sampling, pop-ups, convention staffing",
    typicalClientRateSummary: "~$45-$85/hr client bill; 4-hr min",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Fully insured CGL; W-2 field compliance",
    zeroTouchBookingReadiness: "medium",
  },
  {
    id: "agency-attack-marketing",
    name: "Attack! Marketing",
    website: "https://www.attackmarketing.com",
    contactEmailOrIntake: "https://www.attackmarketing.com (web intake form)",
    coreServices: "National experiential marketing, high-volume street sampling & mobile tours",
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
    coreServices: "Large-scale W-2 national experiential staffing & street teams",
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
    coreServices: "Turnkey print + residential door-hanger & flyer distribution",
    typicalClientRateSummary: "Custom turnkey quotes; 1,000-piece minimum (~$0.99-$1.50/door)",
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
    coreServices: "Enterprise GPS-tracked front-door hangers, sample drops & experiential street teams",
    typicalClientRateSummary: "Custom enterprise quotes; 10,000+ unit minimum",
    leadTimeBusinessDays: "10-14 business days",
    w2AndInsurance: "Fully insured national operations; GPS audits",
    zeroTouchBookingReadiness: "low_m1",
  },
];

const NYC_LOCAL_ONLY_AGENCIES: readonly CityVendorAgency[] = [
  {
    id: "agency-broadway-crew",
    name: "Broadway Crew",
    website: "https://www.broadwaycrew.com",
    contactEmailOrIntake: "info@broadwaycrew.com",
    phone: "(332) 333-1889",
    coreServices: "Hyper-local NYC hand-to-hand fliering, Midtown / downtown street teams, hotel routes",
    typicalClientRateSummary: "Custom NYC shift quotes (~$40-$65/hr equiv.); 4-hr min",
    leadTimeBusinessDays: "2-5 business days",
    w2AndInsurance: "NYC-local managed crews; insured",
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
];

const LONDON_AGENCIES: readonly CityVendorAgency[] = [
  {
    id: "agency-elevate-london",
    name: "Elevate Global (London & NYC)",
    website: "https://www.weareelevate.global",
    contactEmailOrIntake: "newbiz@oneelevate.com",
    coreServices: "UK PAYE-insured experiential brand ambassadors, licensed street teams & live event hosts",
    typicalClientRateSummary: "~£28-£45/hr all-in client bill; 4-hr min",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "UK PAYE & employer's liability insured",
    zeroTouchBookingReadiness: "high",
  },
  {
    id: "agency-oppizi-uk",
    name: "Oppizi UK",
    website: "https://www.oppizi.com",
    contactEmailOrIntake: "contact@oppizi.com",
    coreServices: "GPS-tracked hand-to-hand distribution in licensed London boroughs",
    typicalClientRateSummary: "Custom UK volume pricing per 1,000 licensed hand-to-hand",
    leadTimeBusinessDays: "5-7 business days",
    w2AndInsurance: "Managed UK crews; GPS verification",
    zeroTouchBookingReadiness: "high",
  },
];

const SHARED_US_PRINTERS: readonly CityVendorPrinter[] = [
  {
    id: "printer-gotprint",
    name: "GotPrint",
    website: "https://www.gotprint.com",
    pickupLocation: "Burbank CA / KY plants + nationwide shipping",
    cost5k4x6PostcardsUsd: "$100-$160 (+ shipping)",
    sameDayAvailable: false,
    operationalUse: "Scheduled bulk runs and multi-city replication (3-5 day lead).",
  },
  {
    id: "printer-moo",
    name: "MOO",
    website: "https://www.moo.com",
    pickupLocation: "Online delivery (US & UK)",
    cost5k4x6PostcardsUsd: "~$515-$525 (Printfinity rigid card batches)",
    sameDayAvailable: false,
    operationalUse: "Small batches of rigid laminated QR hand-cards for event activators and creators.",
  },
];

const NYC_LOCAL_ONLY_PRINTERS: readonly CityVendorPrinter[] = [
  {
    id: "printer-4over4-astoria",
    name: "4over4.com",
    website: "https://www.4over4.com",
    contactEmail: "support@4over4.com",
    phone: "(718) 932-2700",
    pickupLocation: "19-41 46th St, Astoria, Queens, NY 11105 (Mon-Fri 10am-5:30pm pickup)",
    cost5k4x6PostcardsUsd: "$75-$125",
    sameDayAvailable: true,
    operationalUse: "Primary NYC gang-run bulk printer; RentAHuman courier pickup in Astoria.",
  },
  {
    id: "printer-printleaf-midtown",
    name: "Printleaf",
    website: "https://www.printleaf.com",
    contactEmail: "sales@printleaf.com",
    phone: "(212) 328-1174",
    pickupLocation: "30 W 47th St #405, Midtown Manhattan, NY 10036",
    cost5k4x6PostcardsUsd: "$300-$550 (same-day / 3-hr rush)",
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
];

const LONDON_PRINTERS: readonly CityVendorPrinter[] = [
  {
    id: "printer-solopress-uk",
    name: "Solopress UK",
    website: "https://www.solopress.com",
    pickupLocation: "Next-day Central London courier delivery",
    cost5k4x6PostcardsUsd: "£95-£160",
    sameDayAvailable: true,
    operationalUse: "Fast UK gang-run postcard & QR hand-card printing.",
  },
  {
    id: "printer-instantprint-uk",
    name: "Instantprint UK",
    website: "https://www.instantprint.co.uk",
    pickupLocation: "UK courier delivery",
    cost5k4x6PostcardsUsd: "£90-£150",
    sameDayAvailable: false,
    operationalUse: "Scheduled bulk runs for licensed UK borough campaigns.",
  },
];

function isPlatformCityActive(code: string): boolean {
  return Boolean(getCoreCity(code));
}

function makeOpsEmail(code: string): string {
  return `ops+${code}@${BRAND_DOMAINS.ntwrk}`;
}

const BUILTIN_CITY_PACKS: readonly CityPack[] = [
  {
    code: "nyc",
    label: "New York City",
    country: "US",
    stateCode: "NY",
    currency: "USD",
    locale: "en-US",
    timezone: "America/New_York",
    e164DialPrefixes: ["+1"],
    opsEmail: makeOpsEmail("nyc"),
    isPrimaryLaunch: true,
    platformActive: isPlatformCityActive("nyc"),
    stage: "live_matching",
    defaultMonthlyBudgetCents: 1_000_000,
    defaultDailyCapCents: 100_000,
    defaultMaxTaskCents: 150_000,
    activationWaitlistMinAdults: 0,
    activationMinSignedVenues: 0,
    budgetDefaults: {
      monthlyBudgetCents: 1_000_000,
      dailyCapCents: 100_000,
      maxTaskCents: 150_000,
      targetCpaCents: 858,
      streetShiftHourlyCents: 2_200,
      eventActivatorHourlyCents: 3_000,
      microCreatorFlatCents: 25_000,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 0,
      minSignedVenuesForSeeding: 0,
      minActiveAdultsForLiveMatching: 150,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "West Village",
        landmarks: "Washington Square Park perimeter & West 4th St",
        bestWindows: "Thu-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["slop", "friends"],
        primaryDesireLanes: ["soulmate_dating", "ideal_friends"],
      },
      {
        neighborhood: "SoHo / Nolita",
        landmarks: "Broadway / Prince St / Spring St",
        bestWindows: "Fri-Sun 12:30 PM - 5:30 PM",
        primaryApps: ["ntwrk", "slop"],
        primaryDesireLanes: ["elite_serendipity", "soulmate_dating", "creative_collab"],
      },
      {
        neighborhood: "Williamsburg",
        landmarks: "Bedford Ave & Domino Park perimeter",
        bestWindows: "Sat-Sun 12:00 PM - 6:00 PM",
        primaryApps: ["friends", "slop"],
        primaryDesireLanes: ["ideal_friends", "sport_wellness_crew", "soulmate_dating"],
      },
      {
        neighborhood: "East Village",
        landmarks: "Astor Place & St. Marks Pl",
        bestWindows: "Thu-Sat 4:00 PM - 8:30 PM",
        primaryApps: ["slop", "peon"],
        primaryDesireLanes: ["soulmate_dating", "money_work"],
      },
      {
        neighborhood: "Flatiron / Union Square",
        landmarks: "Union Square South & Flatiron Plaza sidewalks",
        bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
        primaryDesireLanes: ["money_work", "cofounder_venture", "elite_serendipity"],
      },
      {
        neighborhood: "Midtown West",
        landmarks: "Bryant Park exterior public sidewalks",
        bestWindows: "Tue-Thu 12:00 PM - 2:00 PM",
        primaryApps: ["peon", "ntwrk"],
        primaryDesireLanes: ["money_work", "investors_patrons"],
      },
    ],
    neighborhoodPatterns: [
      { label: "West Village", patterns: ["west village", "washington square", "bleecker", "w 4th", "greenwich village"] },
      { label: "East Village", patterns: ["east village", "astor place", "st marks", "st. marks", "alphabet city"] },
      { label: "SoHo / Nolita", patterns: ["soho", "nolita", "prince st", "spring st", "w broadway"] },
      { label: "Flatiron / Union Square", patterns: ["flatiron", "union square", "gramercy", "14th st", "23rd st"] },
      { label: "Williamsburg", patterns: ["williamsburg", "bedford ave", "domino park", "greenpoint", "bushwick"] },
      { label: "Midtown West", patterns: ["midtown", "bryant park", "hudson yards", "hell's kitchen", "times square"] },
      { label: "Lower East Side", patterns: ["lower east side", "ludlow", "orchard st", "bowery", "delancey"] },
      { label: "Brooklyn", patterns: ["brooklyn", "kings", "dumbo", "park slope", "cobble hill"] },
      { label: "Manhattan", patterns: ["manhattan", "new york", "tribeca", "chelsea", "upper west", "upper east"] },
    ],
    transitKeywords: ["nyc", "manhattan", "brooklyn", "queens", "bronx", "subway", "mta", "union sq", "west 4th", "bedford", "astor", "train"],
    discovery: {
      lumaUrl: "https://lu.ma/nyc",
      eventbriteUrl: "https://www.eventbrite.com/d/ny--new-york/events/",
      subreddits: ["nyc", "AskNYC", "nycmeetups", "startups"],
      githubLocationQuery: "location:NYC followers:>25",
      hnQuery: "NYC OR Show HN AI agent",
      openAlexQuery: "New York University OR Columbia University OR Cornell Tech",
      clinicalLocation: "New York, NY",
      openDataVenuesUrl:
        "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit=40&$where=grade='A'&$order=inspection_date%20DESC",
      liquorLicensesUrl:
        "https://data.ny.gov/resource/9s3h-dpkz.json?$limit=40&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
      openDataConnectors: [
        {
          id: "nyc_open_data",
          kind: "venues",
          urlTemplate:
            "https://data.cityofnewyork.us/resource/43nn-pn8j.json?$limit={{limit}}&$where=grade='A'&$order=inspection_date%20DESC",
          adapter: "socrata_json",
          fieldMap: {
            idField: "camis",
            nameField: "dba",
            addressFields: ["building", "street", "boro", "zipcode"],
            categoryField: "cuisine_description",
            phoneField: "phone",
            gradeOrStatusField: "grade",
            countyOrBoroField: "boro",
            zipField: "zipcode",
          },
          defaultDesireLanes: ["soulmate_dating", "ideal_friends"],
        },
        {
          id: "nys_sla",
          kind: "liquor_licenses",
          urlTemplate:
            "https://data.ny.gov/resource/9s3h-dpkz.json?$limit={{limit}}&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
          adapter: "socrata_json",
          fieldMap: {
            idField: "license_serial_number",
            nameField: "dba_name",
            fallbackNameField: "premises_name",
            addressFields: ["actual_address_of_premises_address1", "city", "zip"],
            categoryField: "method_of_operation",
            countyOrBoroField: "county_name_desc",
            zipField: "zip",
          },
          defaultDesireLanes: ["soulmate_dating", "elite_serendipity"],
        },
        {
          id: "nys_sla_pending",
          kind: "liquor_principals",
          urlTemplate:
            "https://data.ny.gov/resource/hrvs-fxs2.json?$limit={{limit}}&$where=county_name_desc='NEW%20YORK'%20OR%20county_name_desc='KINGS'",
          adapter: "socrata_json",
          fieldMap: {
            idField: "license_serial_number",
            nameField: "dba_name",
            fallbackNameField: "premises_name",
            addressFields: ["actual_address_of_premises_address1", "city", "zip"],
            categoryField: "method_of_operation",
            principalField: "principal_name",
            gradeOrStatusField: "license_status",
            countyOrBoroField: "county_name_desc",
            zipField: "zip",
          },
          defaultDesireLanes: ["soulmate_dating", "bespoke_irl_experience"],
        },
      ],
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "NYLL § 191-d (Freelance Isn't Free Act): Itemized written clickwrap retained 6 years; payout within 48 hours of approved proof (hard SLA <= 15 days, statutory cap 30 days).",
      payoutSlaDays: 15,
      antiPostingRule:
        "NYC Administrative Code § 10-119: Hand-to-hand public sidewalk distribution only (>= 8 ft clearance). Zero taping, pasting, or placing fliers on lampposts, poles, trees, mailboxes, or car windshields.",
      transitExclusionRule:
        "21 NYCRR § 1050.6: Commercial flyers strictly prohibited inside MTA subway stations, mezzanines, and platforms. Stay >= 20 ft outside station entrances.",
      likenessReleaseStatute:
        "NY Civil Rights Law §§ 50-51: Prior written commercial likeness release required from every recognizable 18+ interviewee before publication.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under New York Civil Rights Law §§ 50 and 51, I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid social and promotional materials.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken disclosure, prominent first-3s on-screen #Ad / Paid Partnership overlay, and native Commercial Content toggle.",
      biometricBanStatute: null,
      botDisclosureRequired: false,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "No sidewalk hand-to-hand permit required; keep teams < 20 people with zero tables, tents, or amplified sound (56 RCNY § 1-05) and handheld-only filming (NYC MOME).",
    },
    vendors: {
      craigslistSubdomain: "newyork",
      craigslistPostFeeCents: 1_000,
      recommendedAgencies: [
        "Kinetic Events Staffing",
        "Street Teams Co",
        "Broadway Crew",
        "Victory Agency",
        "Oppizi NYC",
        "The PUSH Agency",
        "Mustard Lane",
      ],
      recommendedPrinters: [
        "4over4.com (Astoria, Queens)",
        "Printleaf (Midtown Manhattan)",
        "Bestype Imaging (SoHo)",
        "GotPrint",
      ],
      vettedAgencies: [...NATIONAL_W2_AGENCIES.slice(0, 3), ...NYC_LOCAL_ONLY_AGENCIES, ...NATIONAL_W2_AGENCIES.slice(3)],
      platforms: SHARED_SELF_SERVICE_PLATFORMS,
      printers: [...NYC_LOCAL_ONLY_PRINTERS, ...SHARED_US_PRINTERS],
    },
  },
  {
    code: "sf",
    label: "San Francisco",
    country: "US",
    stateCode: "CA",
    currency: "USD",
    locale: "en-US",
    timezone: "America/Los_Angeles",
    e164DialPrefixes: ["+1"],
    opsEmail: makeOpsEmail("sf"),
    isPrimaryLaunch: false,
    platformActive: isPlatformCityActive("sf"),
    stage: "waitlist_kindling",
    defaultMonthlyBudgetCents: 750_000,
    defaultDailyCapCents: 75_000,
    defaultMaxTaskCents: 150_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    budgetDefaults: {
      monthlyBudgetCents: 750_000,
      dailyCapCents: 75_000,
      maxTaskCents: 150_000,
      targetCpaCents: 950,
      streetShiftHourlyCents: 2_600,
      eventActivatorHourlyCents: 3_200,
      microCreatorFlatCents: 27_500,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 150,
      minSignedVenuesForSeeding: 10,
      minActiveAdultsForLiveMatching: 250,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "Mission / Dolores",
        landmarks: "Valencia St corridor & Dolores Park perimeter sidewalks",
        bestWindows: "Fri-Sun 12:30 PM - 6:00 PM",
        primaryApps: ["slop", "friends"],
        primaryDesireLanes: ["soulmate_dating", "ideal_friends"],
      },
      {
        neighborhood: "Hayes Valley",
        landmarks: "Hayes St & Octavia St pedestrian plaza",
        bestWindows: "Thu-Sun 2:00 PM - 7:30 PM",
        primaryApps: ["ntwrk", "slop"],
        primaryDesireLanes: ["elite_serendipity", "soulmate_dating"],
      },
      {
        neighborhood: "Marina / Cow Hollow",
        landmarks: "Chestnut St & Union St sidewalks",
        bestWindows: "Fri-Sun 1:00 PM - 6:00 PM",
        primaryApps: ["slop", "friends"],
        primaryDesireLanes: ["soulmate_dating", "sport_wellness_crew"],
      },
      {
        neighborhood: "SoMa / Jackson Square",
        landmarks: "2nd St, South Park & Jackson Sq founder corridor",
        bestWindows: "Tue-Thu 11:30 AM - 2:30 PM & 5:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
        primaryDesireLanes: ["money_work", "cofounder_venture", "investors_patrons"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Mission / Dolores", patterns: ["mission", "valencia", "dolores", "16th st", "24th st"] },
      { label: "Hayes Valley", patterns: ["hayes valley", "octavia", "patricia's green"] },
      { label: "Marina / Cow Hollow", patterns: ["marina", "chestnut", "cow hollow", "union st"] },
      { label: "SoMa / Jackson Square", patterns: ["soma", "south park", "jackson square", "fidi", "embarcadero"] },
      { label: "North Beach", patterns: ["north beach", "columbus ave", "washington square sf"] },
      { label: "San Francisco", patterns: ["san francisco", "sf", "bay area"] },
    ],
    transitKeywords: ["sf", "san francisco", "bart", "muni", "caltrain", "mission", "hayes", "marina", "soma", "embarcadero", "montgomery", "powell"],
    discovery: {
      lumaUrl: "https://lu.ma/sf",
      eventbriteUrl: "https://www.eventbrite.com/d/ca--san-francisco/events/",
      subreddits: ["sanfrancisco", "AskSF", "bayarea", "startups"],
      githubLocationQuery: 'location:"San Francisco" followers:>25',
      hnQuery: "San Francisco OR Show HN AI agent",
      openAlexQuery: "UCSF OR Stanford University",
      clinicalLocation: "San Francisco, CA",
      openDataVenuesUrl: "https://data.sfgov.org/resource/pyih-qa8i.json?$limit=40",
      liquorLicensesUrl: null,
      openDataConnectors: [
        {
          id: "sf_open_data_venues",
          kind: "venues",
          urlTemplate: "https://data.sfgov.org/resource/pyih-qa8i.json?$limit={{limit}}",
          adapter: "socrata_json",
          fieldMap: {
            idField: "business_id",
            nameField: "business_name",
            addressFields: ["business_address", "business_city", "business_postal_code"],
            phoneField: "business_phone_number",
            gradeOrStatusField: "inspection_score",
            zipField: "business_postal_code",
          },
          defaultDesireLanes: ["soulmate_dating", "ideal_friends", "money_work"],
        },
      ],
    },
    legal: {
      laborClassification: "w2_required_ab5",
      w2RequiredForStreetTeams: true,
      flierLicenceRequired: false,
      freelanceStatute:
        "California AB5 (Cal. Lab. Code § 2775) & SB 988: Hourly street-team and event-activator labor MUST run through W-2 agencies or W-2 platforms (Instawork, Kinetic, Encore); independent creators receive written SB 988 contracts with <= 15d internal payout SLA.",
      payoutSlaDays: 15,
      antiPostingRule:
        "SF Public Works Code § 184 & Police Code Art. 5.1: Hand-to-hand distribution on public sidewalks only. Zero posting on utility poles, trees, Muni shelters, or parked vehicles.",
      transitExclusionRule:
        "BART & SFMTA Rules: Commercial distribution prohibited inside BART stations, paid fare areas, and Muni vehicles/stations. Stay on outdoor public sidewalks.",
      likenessReleaseStatute:
        "CA Civil Code § 3344: Prior written commercial likeness release required for every recognizable 18+ filmed participant.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under California Civil Code § 3344, I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid social and promotional materials.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & California SB 1001 (Bot Disclosure): Mandatory spoken + on-screen #Ad disclosure and transparent AI agent disclosure.",
      biometricBanStatute: null,
      botDisclosureRequired: true,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "W-2 agency staffing mandatory for hourly street teams under CA AB5; handheld sidewalk filming without exclusive sidewalk occupancy.",
    },
    vendors: {
      craigslistSubdomain: "sfbay",
      craigslistPostFeeCents: 1_000,
      recommendedAgencies: ["Kinetic Events Staffing", "Instawork (W-2)", "Encore Nationwide (W-2)", "Assist Marketing (W-2)", "Oppizi SF"],
      recommendedPrinters: ["GotPrint (Burbank CA fast ship)", "4over Wholesale", "MOO"],
      vettedAgencies: NATIONAL_W2_AGENCIES.filter((a) =>
        ["agency-kinetic-events", "agency-encore-nationwide", "agency-assist-marketing", "agency-oppizi", "agency-attack-marketing"].includes(a.id),
      ),
      platforms: SHARED_SELF_SERVICE_PLATFORMS,
      printers: SHARED_US_PRINTERS,
    },
  },
  {
    code: "la",
    label: "Los Angeles",
    country: "US",
    stateCode: "CA",
    currency: "USD",
    locale: "en-US",
    timezone: "America/Los_Angeles",
    e164DialPrefixes: ["+1"],
    opsEmail: makeOpsEmail("la"),
    isPrimaryLaunch: false,
    platformActive: isPlatformCityActive("la"),
    stage: "waitlist_kindling",
    defaultMonthlyBudgetCents: 750_000,
    defaultDailyCapCents: 75_000,
    defaultMaxTaskCents: 150_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    budgetDefaults: {
      monthlyBudgetCents: 750_000,
      dailyCapCents: 75_000,
      maxTaskCents: 150_000,
      targetCpaCents: 925,
      streetShiftHourlyCents: 2_500,
      eventActivatorHourlyCents: 3_000,
      microCreatorFlatCents: 25_000,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 150,
      minSignedVenuesForSeeding: 10,
      minActiveAdultsForLiveMatching: 250,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "Silver Lake / Echo Park",
        landmarks: "Sunset Junction & Sunset Blvd public sidewalks",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["slop", "friends"],
        primaryDesireLanes: ["soulmate_dating", "creative_collab", "ideal_friends"],
      },
      {
        neighborhood: "Venice / Abbot Kinney",
        landmarks: "Abbot Kinney Blvd & Main St Santa Monica sidewalks",
        bestWindows: "Fri-Sun 12:30 PM - 6:00 PM",
        primaryApps: ["slop", "ntwrk"],
        primaryDesireLanes: ["soulmate_dating", "elite_serendipity"],
      },
      {
        neighborhood: "West Hollywood",
        landmarks: "Melrose Ave & Santa Monica Blvd commercial sidewalks",
        bestWindows: "Thu-Sun 2:00 PM - 7:30 PM",
        primaryApps: ["slop", "ntwrk"],
        primaryDesireLanes: ["soulmate_dating", "bespoke_irl_experience"],
      },
      {
        neighborhood: "Arts District / Culver City",
        landmarks: "E 3rd St & Culver Steps perimeter",
        bestWindows: "Tue-Fri 12:00 PM - 3:00 PM & 5:00 PM - 7:30 PM",
        primaryApps: ["peon", "friends"],
        primaryDesireLanes: ["money_work", "creative_collab", "ideal_friends"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Silver Lake / Echo Park", patterns: ["silver lake", "silverlake", "echo park", "sunset junction"] },
      { label: "Venice / Santa Monica", patterns: ["venice", "abbot kinney", "santa monica", "silicon beach"] },
      { label: "West Hollywood", patterns: ["west hollywood", "weho", "melrose", "fairfax"] },
      { label: "Arts District / DTLA", patterns: ["arts district", "dtla", "downtown la", "culver city"] },
      { label: "Los Angeles", patterns: ["los angeles", "hollywood", "la"] },
    ],
    transitKeywords: ["la", "los angeles", "metro", "silver lake", "venice", "santa monica", "weho", "culver", "dtla", "expo line"],
    discovery: {
      lumaUrl: "https://lu.ma/la",
      eventbriteUrl: "https://www.eventbrite.com/d/ca--los-angeles/events/",
      subreddits: ["LosAngeles", "AskLosAngeles", "LAlist", "startups"],
      githubLocationQuery: 'location:"Los Angeles" followers:>25',
      hnQuery: "Los Angeles OR Venice Beach startup",
      openAlexQuery: "UCLA OR USC OR Caltech",
      clinicalLocation: "Los Angeles, CA",
      openDataVenuesUrl: "https://data.lacity.org/resource/6rrh-rzua.json?$limit=40",
      liquorLicensesUrl: null,
      openDataConnectors: [
        {
          id: "la_open_data_venues",
          kind: "venues",
          urlTemplate: "https://data.lacity.org/resource/6rrh-rzua.json?$limit={{limit}}",
          adapter: "socrata_json",
          fieldMap: {
            idField: "location_account",
            nameField: "dba_name",
            fallbackNameField: "business_name",
            addressFields: ["street_address", "city", "zip_code"],
            categoryField: "primary_naics_description",
            zipField: "zip_code",
          },
          defaultDesireLanes: ["soulmate_dating", "creative_collab", "ideal_friends"],
        },
      ],
    },
    legal: {
      laborClassification: "w2_required_ab5",
      w2RequiredForStreetTeams: true,
      flierLicenceRequired: false,
      freelanceStatute:
        "California AB5 (Cal. Lab. Code § 2775) & SB 988: Hourly street-team and event-activator labor MUST run through W-2 staffing agencies/platforms; independent creators require written SB 988 agreements.",
      payoutSlaDays: 15,
      antiPostingRule:
        "LAMC § 28.04 & § 28.01: Hand-to-hand distribution to willing adults on public sidewalks only. Zero posting on poles, trees, or placing handbills on parked vehicles.",
      transitExclusionRule:
        "LA Metro Customer Code of Conduct: Commercial handbill distribution prohibited inside Metro stations and rail/bus platforms.",
      likenessReleaseStatute:
        "CA Civil Code § 3344: Prior written commercial likeness release required for every recognizable 18+ filmed participant.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under California Civil Code § 3344, I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid social and promotional materials.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & CA SB 1001: Spoken + on-screen #Ad disclosure, Paid Partnership toggle, and open AI disclosure.",
      biometricBanStatute: null,
      botDisclosureRequired: true,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "W-2 staffing mandatory under CA AB5; check FilmLA thresholds (stay strictly handheld, small crew, zero equipment on sidewalk).",
    },
    vendors: {
      craigslistSubdomain: "losangeles",
      craigslistPostFeeCents: 1_000,
      recommendedAgencies: ["Kinetic Events Staffing", "Instawork (W-2)", "Encore Nationwide (W-2)", "The PUSH Agency", "Attack! Marketing"],
      recommendedPrinters: ["GotPrint (Burbank CA local pickup)", "4over Wholesale", "MOO"],
      vettedAgencies: NATIONAL_W2_AGENCIES.filter((a) =>
        ["agency-kinetic-events", "agency-encore-nationwide", "agency-push", "agency-attack-marketing", "agency-oppizi"].includes(a.id),
      ),
      platforms: SHARED_SELF_SERVICE_PLATFORMS,
      printers: SHARED_US_PRINTERS,
    },
  },
  {
    code: "chicago",
    label: "Chicago",
    country: "US",
    stateCode: "IL",
    currency: "USD",
    locale: "en-US",
    timezone: "America/Chicago",
    e164DialPrefixes: ["+1"],
    opsEmail: makeOpsEmail("chicago"),
    isPrimaryLaunch: false,
    platformActive: isPlatformCityActive("chicago"),
    stage: "waitlist_kindling",
    defaultMonthlyBudgetCents: 600_000,
    defaultDailyCapCents: 60_000,
    defaultMaxTaskCents: 120_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    budgetDefaults: {
      monthlyBudgetCents: 600_000,
      dailyCapCents: 60_000,
      maxTaskCents: 120_000,
      targetCpaCents: 850,
      streetShiftHourlyCents: 2_100,
      eventActivatorHourlyCents: 2_800,
      microCreatorFlatCents: 22_500,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 150,
      minSignedVenuesForSeeding: 10,
      minActiveAdultsForLiveMatching: 200,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "West Loop / Fulton Market",
        landmarks: "Randolph St & Fulton Market sidewalks",
        bestWindows: "Thu-Sun 12:30 PM - 7:00 PM",
        primaryApps: ["slop", "peon"],
        primaryDesireLanes: ["soulmate_dating", "money_work"],
      },
      {
        neighborhood: "Wicker Park / Logan Square",
        landmarks: "Milwaukee Ave & Damen Ave intersections",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["friends", "slop"],
        primaryDesireLanes: ["ideal_friends", "soulmate_dating"],
      },
      {
        neighborhood: "River North / Loop",
        landmarks: "Merchandise Mart perimeter & Hubbard St",
        bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
        primaryDesireLanes: ["money_work", "elite_serendipity"],
      },
    ],
    neighborhoodPatterns: [
      { label: "West Loop / Fulton Market", patterns: ["west loop", "fulton market", "randolph st"] },
      { label: "Wicker Park / Logan Square", patterns: ["wicker park", "logan square", "bucktown", "milwaukee ave"] },
      { label: "River North / Loop", patterns: ["river north", "the loop", "streeterville", "gold coast"] },
      { label: "Lincoln Park / Lakeview", patterns: ["lincoln park", "lakeview", "wrigleyville"] },
      { label: "Chicago", patterns: ["chicago", "chi"] },
    ],
    transitKeywords: ["chicago", "cta", "l train", "red line", "blue line", "brown line", "west loop", "wicker park", "logan square", "river north", "loop"],
    discovery: {
      lumaUrl: "https://lu.ma/chicago",
      eventbriteUrl: "https://www.eventbrite.com/d/il--chicago/events/",
      subreddits: ["chicago", "AskChicago", "chicagomeetups", "startups"],
      githubLocationQuery: "location:Chicago followers:>25",
      hnQuery: "Chicago startup OR AI",
      openAlexQuery: "University of Chicago OR Northwestern University",
      clinicalLocation: "Chicago, IL",
      openDataVenuesUrl: "https://data.cityofchicago.org/resource/4ijn-s7e5.json?$limit=40&$where=results='Pass'",
      liquorLicensesUrl: "https://data.cityofchicago.org/resource/nrmj-3kcf.json?$limit=40",
      openDataConnectors: [
        {
          id: "chicago_open_data_venues",
          kind: "venues",
          urlTemplate: "https://data.cityofchicago.org/resource/4ijn-s7e5.json?$limit={{limit}}&$where=results='Pass'",
          adapter: "socrata_json",
          fieldMap: {
            idField: "inspection_id",
            nameField: "dba_name",
            fallbackNameField: "aka_name",
            addressFields: ["address", "city", "zip"],
            categoryField: "facility_type",
            gradeOrStatusField: "results",
            zipField: "zip",
          },
          defaultDesireLanes: ["soulmate_dating", "ideal_friends"],
        },
        {
          id: "chicago_liquor_licenses",
          kind: "liquor_licenses",
          urlTemplate: "https://data.cityofchicago.org/resource/nrmj-3kcf.json?$limit={{limit}}",
          adapter: "socrata_json",
          fieldMap: {
            idField: "license_id",
            nameField: "doing_business_as_name",
            fallbackNameField: "legal_name",
            addressFields: ["address", "city", "zip_code"],
            categoryField: "license_description",
            gradeOrStatusField: "license_status",
            zipField: "zip_code",
          },
          defaultDesireLanes: ["soulmate_dating", "elite_serendipity"],
        },
      ],
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "Illinois Freelance Worker Protection Act (820 ILCS 193): Written itemized contract applied uniformly from $1; payout <= 30 days (internal SLA <= 15 days).",
      payoutSlaDays: 15,
      antiPostingRule:
        "Chicago Municipal Code § 10-8-320: Hand-to-hand sidewalk distribution only; zero posting on poles, trees, or car windshields.",
      transitExclusionRule:
        "CTA Ordinance: Commercial flyer distribution prohibited inside CTA L stations, platforms, and rail cars.",
      likenessReleaseStatute:
        "Illinois Right of Publicity Act (765 ILCS 1075) & IL BIPA (740 ILCS 14): Prior written commercial likeness release required; zero biometric facial-geometry extraction.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under the Illinois Right of Publicity Act (765 ILCS 1075), I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview (with zero biometric extraction).",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken + on-screen #Ad disclosure and native Commercial Content toggle.",
      biometricBanStatute: "Illinois BIPA (740 ILCS 14)",
      botDisclosureRequired: false,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "Public sidewalk hand-to-hand permitted without obstructing pedestrian flow; strictly zero facial-geometry scanning (IL BIPA).",
    },
    vendors: {
      craigslistSubdomain: "chicago",
      craigslistPostFeeCents: 700,
      recommendedAgencies: ["ATN Event Staffing", "Kinetic Events Staffing", "Street Teams Co", "The PUSH Agency"],
      recommendedPrinters: ["GotPrint", "4over Wholesale", "MOO"],
      vettedAgencies: NATIONAL_W2_AGENCIES.filter((a) =>
        ["agency-atn-event-staffing", "agency-kinetic-events", "agency-street-teams-co", "agency-push", "agency-victory"].includes(a.id),
      ),
      platforms: SHARED_SELF_SERVICE_PLATFORMS,
      printers: SHARED_US_PRINTERS,
    },
  },
  {
    code: "miami",
    label: "Miami",
    country: "US",
    stateCode: "FL",
    currency: "USD",
    locale: "en-US",
    timezone: "America/New_York",
    e164DialPrefixes: ["+1"],
    opsEmail: makeOpsEmail("miami"),
    isPrimaryLaunch: false,
    platformActive: isPlatformCityActive("miami"),
    stage: "waitlist_kindling",
    defaultMonthlyBudgetCents: 600_000,
    defaultDailyCapCents: 60_000,
    defaultMaxTaskCents: 120_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    budgetDefaults: {
      monthlyBudgetCents: 600_000,
      dailyCapCents: 60_000,
      maxTaskCents: 120_000,
      targetCpaCents: 875,
      streetShiftHourlyCents: 2_100,
      eventActivatorHourlyCents: 2_800,
      microCreatorFlatCents: 22_500,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 150,
      minSignedVenuesForSeeding: 10,
      minActiveAdultsForLiveMatching: 200,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "Wynwood",
        landmarks: "NW 2nd Ave commercial sidewalks (outside private mural lots)",
        bestWindows: "Thu-Sun 2:00 PM - 8:00 PM",
        primaryApps: ["slop", "ntwrk"],
        primaryDesireLanes: ["soulmate_dating", "creative_collab", "elite_serendipity"],
      },
      {
        neighborhood: "Brickell",
        landmarks: "S Miami Ave & Brickell City Centre perimeter sidewalks",
        bestWindows: "Tue-Fri 12:00 PM - 2:30 PM & 5:30 PM - 8:00 PM",
        primaryApps: ["peon", "slop"],
        primaryDesireLanes: ["money_work", "investors_patrons", "soulmate_dating"],
      },
      {
        neighborhood: "Coconut Grove / Coral Gables",
        landmarks: "Commodore Plaza & Miracle Mile public sidewalks",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["friends", "ntwrk"],
        primaryDesireLanes: ["ideal_friends", "sport_wellness_crew"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Wynwood", patterns: ["wynwood", "nw 2nd ave", "midtown miami"] },
      { label: "Brickell", patterns: ["brickell", "downtown miami", "bayfront"] },
      { label: "Coconut Grove", patterns: ["coconut grove", "coral gables", "miracle mile"] },
      { label: "Miami Beach", patterns: ["miami beach", "south beach", "sunset harbour"] },
      { label: "Miami", patterns: ["miami", "design district", "edgewater"] },
    ],
    transitKeywords: ["miami", "metrorail", "metromover", "brightline", "wynwood", "brickell", "coconut grove", "edgewater"],
    discovery: {
      lumaUrl: "https://lu.ma/miami",
      eventbriteUrl: "https://www.eventbrite.com/d/fl--miami/events/",
      subreddits: ["Miami", "MiamiTech", "startups"],
      githubLocationQuery: "location:Miami followers:>20",
      hnQuery: "Miami startup OR tech",
      openAlexQuery: "University of Miami",
      clinicalLocation: "Miami, FL",
      openDataVenuesUrl: null,
      liquorLicensesUrl: null,
      openDataConnectors: [],
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "Written itemized independent contractor clickwrap agreement retained 6 years; internal payout SLA <= 15 days (48h target post-proof).",
      payoutSlaDays: 15,
      antiPostingRule:
        "Miami Beach Code Ch. 46 & City of Miami Code Ch. 37: Avoid restricted Miami Beach commercial handbill zones (Ocean Dr / Lincoln Rd / Art Deco district); hand-to-hand only in permitted City of Miami corridors with zero pole/car posting.",
      transitExclusionRule:
        "Miami-Dade Transit Rules: Commercial distribution prohibited inside Metrorail and Metromover stations and cars.",
      likenessReleaseStatute:
        "FL Stat. § 540.08: Prior written commercial likeness release required from every recognizable 18+ filmed participant.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under Florida Statutes § 540.08, I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview in organic and paid social and promotional materials.",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken + on-screen #Ad disclosure and native Commercial Content toggle.",
      biometricBanStatute: null,
      botDisclosureRequired: false,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "Avoid Miami Beach commercial handbill ban zones; focus street teams on Brickell/Wynwood public sidewalks and venue-consented activations.",
    },
    vendors: {
      craigslistSubdomain: "miami",
      craigslistPostFeeCents: 700,
      recommendedAgencies: ["Kinetic Events Staffing", "Victory Agency", "The PUSH Agency", "Street Teams Co"],
      recommendedPrinters: ["GotPrint", "4over Wholesale", "MOO"],
      vettedAgencies: NATIONAL_W2_AGENCIES.filter((a) =>
        ["agency-kinetic-events", "agency-victory", "agency-push", "agency-street-teams-co", "agency-air-fresh"].includes(a.id),
      ),
      platforms: SHARED_SELF_SERVICE_PLATFORMS,
      printers: SHARED_US_PRINTERS,
    },
  },
  {
    code: "austin",
    label: "Austin",
    country: "US",
    stateCode: "TX",
    currency: "USD",
    locale: "en-US",
    timezone: "America/Chicago",
    e164DialPrefixes: ["+1"],
    opsEmail: makeOpsEmail("austin"),
    isPrimaryLaunch: false,
    platformActive: isPlatformCityActive("austin"),
    stage: "waitlist_kindling",
    defaultMonthlyBudgetCents: 500_000,
    defaultDailyCapCents: 50_000,
    defaultMaxTaskCents: 100_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    budgetDefaults: {
      monthlyBudgetCents: 500_000,
      dailyCapCents: 50_000,
      maxTaskCents: 100_000,
      targetCpaCents: 800,
      streetShiftHourlyCents: 2_000,
      eventActivatorHourlyCents: 2_600,
      microCreatorFlatCents: 20_000,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 150,
      minSignedVenuesForSeeding: 10,
      minActiveAdultsForLiveMatching: 200,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "East Austin",
        landmarks: "East 6th St & East Cesar Chavez sidewalks",
        bestWindows: "Thu-Sun 2:00 PM - 8:00 PM",
        primaryApps: ["friends", "slop"],
        primaryDesireLanes: ["ideal_friends", "soulmate_dating", "creative_collab"],
      },
      {
        neighborhood: "Downtown / South Congress",
        landmarks: "South Congress Ave (SoCo) & Congress Ave sidewalks",
        bestWindows: "Fri-Sun 12:30 PM - 6:30 PM",
        primaryApps: ["ntwrk", "slop"],
        primaryDesireLanes: ["elite_serendipity", "soulmate_dating"],
      },
      {
        neighborhood: "West Campus / UT Perimeter",
        landmarks: "Guadalupe St (The Drag) public sidewalks (strictly 18+)",
        bestWindows: "Wed-Sat 1:00 PM - 6:00 PM",
        primaryApps: ["friends", "peon"],
        primaryDesireLanes: ["ideal_friends", "money_work"],
      },
    ],
    neighborhoodPatterns: [
      { label: "East Austin", patterns: ["east austin", "east 6th", "cesar chavez", "eastside"] },
      { label: "South Congress", patterns: ["south congress", "soco", "south lamar", "zilker"] },
      { label: "Downtown / Rainey", patterns: ["downtown austin", "rainey", "congress ave", "2nd street"] },
      { label: "Domain / North", patterns: ["the domain", "mueller", "hyde park"] },
      { label: "Austin", patterns: ["austin", "atx"] },
    ],
    transitKeywords: ["austin", "atx", "capmetro", "metrorail", "soco", "east 6th", "downtown", "guadalupe", "congress", "rainey"],
    discovery: {
      lumaUrl: "https://lu.ma/austin",
      eventbriteUrl: "https://www.eventbrite.com/d/tx--austin/events/",
      subreddits: ["Austin", "AustinTech", "startups"],
      githubLocationQuery: "location:Austin followers:>20",
      hnQuery: "Austin startup OR AI",
      openAlexQuery: "University of Texas at Austin",
      clinicalLocation: "Austin, TX",
      openDataVenuesUrl: "https://data.austintexas.gov/resource/ecmv-9xxi.json?$limit=40",
      liquorLicensesUrl: null,
      openDataConnectors: [
        {
          id: "austin_open_data_venues",
          kind: "venues",
          urlTemplate: "https://data.austintexas.gov/resource/ecmv-9xxi.json?$limit={{limit}}",
          adapter: "socrata_json",
          fieldMap: {
            idField: "facility_id",
            nameField: "restaurant_name",
            addressFields: ["address", "zip_code"],
            gradeOrStatusField: "score",
            zipField: "zip_code",
          },
          defaultDesireLanes: ["ideal_friends", "soulmate_dating"],
        },
      ],
    },
    legal: {
      laborClassification: "1099_allowed",
      w2RequiredForStreetTeams: false,
      flierLicenceRequired: false,
      freelanceStatute:
        "Texas written itemized independent contractor clickwrap agreement retained 6 years; internal payout SLA <= 15 days (48h target post-proof).",
      payoutSlaDays: 15,
      antiPostingRule:
        "Austin City Code § 14-9-21 & § 25-10-103: Hand-to-hand distribution on public sidewalks only. Zero posting on utility poles, right-of-way signs, trees, or parked cars.",
      transitExclusionRule:
        "CapMetro Rules: Commercial handbill distribution prohibited inside CapMetro rail stations and buses.",
      likenessReleaseStatute:
        "Texas common-law right of publicity & TX CUBI (Bus. & Com. Code § 503.001): Prior written commercial likeness release required for every 18+ filmed participant; zero biometric extraction.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under Texas publicity law and TX CUBI (Bus. & Com. Code § 503.001), I grant The Network and its authorized creators worldwide, perpetual permission to record and use my name, likeness, image, and voice from today's street interview (with zero biometric extraction).",
      disclosureAuthority:
        "FTC 16 CFR Part 255 & 465: Mandatory spoken + on-screen #Ad disclosure and native Commercial Content toggle.",
      biometricBanStatute: "Texas CUBI (Bus. & Com. Code § 503.001)",
      botDisclosureRequired: false,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "Public sidewalk hand-to-hand permitted; during SXSW obey temporary right-of-way crowd-control zones and stay off private badge-only footprints.",
    },
    vendors: {
      craigslistSubdomain: "austin",
      craigslistPostFeeCents: 700,
      recommendedAgencies: ["Kinetic Events Staffing", "Street Teams Co", "The PUSH Agency", "Victory Agency"],
      recommendedPrinters: ["GotPrint", "4over Wholesale", "MOO"],
      vettedAgencies: NATIONAL_W2_AGENCIES.filter((a) =>
        ["agency-kinetic-events", "agency-street-teams-co", "agency-push", "agency-victory"].includes(a.id),
      ),
      platforms: SHARED_SELF_SERVICE_PLATFORMS,
      printers: SHARED_US_PRINTERS,
    },
  },
  {
    code: "london",
    label: "London",
    country: "UK",
    stateCode: null,
    currency: "GBP",
    locale: "en-GB",
    timezone: "Europe/London",
    e164DialPrefixes: ["+44"],
    opsEmail: makeOpsEmail("london"),
    isPrimaryLaunch: false,
    platformActive: isPlatformCityActive("london"),
    stage: "waitlist_kindling",
    defaultMonthlyBudgetCents: 650_000,
    defaultDailyCapCents: 65_000,
    defaultMaxTaskCents: 130_000,
    activationWaitlistMinAdults: 150,
    activationMinSignedVenues: 10,
    budgetDefaults: {
      monthlyBudgetCents: 650_000,
      dailyCapCents: 65_000,
      maxTaskCents: 130_000,
      targetCpaCents: 900,
      streetShiftHourlyCents: 1_800,
      eventActivatorHourlyCents: 2_500,
      microCreatorFlatCents: 22_000,
    },
    readinessGates: {
      minWaitlistAdultsForSeeding: 150,
      minSignedVenuesForSeeding: 10,
      minActiveAdultsForLiveMatching: 250,
      maxActiveAdultsV1Pool: 2_500,
    },
    corridors: [
      {
        neighborhood: "Shoreditch / Old Street",
        landmarks: "Redchurch St, Brick Lane & Old St roundabout perimeter (licensed Hackney/Tower Hamlets zones)",
        bestWindows: "Thu-Sun 1:00 PM - 7:00 PM",
        primaryApps: ["peon", "ntwrk"],
        primaryDesireLanes: ["money_work", "cofounder_venture", "elite_serendipity"],
      },
      {
        neighborhood: "Soho / Fitzrovia",
        landmarks: "Carnaby / Berwick St & Charlotte St (Westminster/Camden consent required)",
        bestWindows: "Thu-Sat 2:00 PM - 7:30 PM",
        primaryApps: ["slop", "ntwrk"],
        primaryDesireLanes: ["soulmate_dating", "creative_collab", "elite_serendipity"],
      },
      {
        neighborhood: "Clapham / Brixton / Peckham",
        landmarks: "High St commercial corridors (Lambeth/Southwark consent)",
        bestWindows: "Fri-Sun 1:00 PM - 6:30 PM",
        primaryApps: ["friends", "slop"],
        primaryDesireLanes: ["ideal_friends", "soulmate_dating"],
      },
    ],
    neighborhoodPatterns: [
      { label: "Shoreditch / Hackney", patterns: ["shoreditch", "hackney", "old street", "dalston", "hoxton"] },
      { label: "Soho / Fitzrovia", patterns: ["soho london", "fitzrovia", "covent garden", "marylebone", "westminster"] },
      { label: "Camden / King's Cross", patterns: ["camden", "king's cross", "kings cross", "islington", "angel"] },
      { label: "South London", patterns: ["peckham", "brixton", "clapham", "borough", "southwark"] },
      { label: "London", patterns: ["london", "canary wharf", "city of london"] },
    ],
    transitKeywords: ["london", "tube", "underground", "overground", "tfl", "elizabeth line", "shoreditch", "soho", "hackney", "clapham", "islington", "camden"],
    discovery: {
      lumaUrl: "https://lu.ma/london",
      eventbriteUrl: "https://www.eventbrite.co.uk/d/united-kingdom--london/events/",
      subreddits: ["london", "LondonSocialClub", "ukstartups"],
      githubLocationQuery: "location:London followers:>25",
      hnQuery: "London startup OR AI",
      openAlexQuery: "University College London OR Imperial College London",
      clinicalLocation: "London, United Kingdom",
      openDataVenuesUrl: null,
      liquorLicensesUrl: null,
      openDataConnectors: [],
    },
    legal: {
      laborClassification: "uk_paye_or_agency",
      w2RequiredForStreetTeams: true,
      flierLicenceRequired: true,
      freelanceStatute:
        "UK Employment Rights & IR35 Compliance: Use UK-insured PAYE staffing agencies (e.g., Elevate Global London) for hourly street teams; independent creators receive written UK services contracts with <= 15d payout SLA.",
      payoutSlaDays: 15,
      antiPostingRule:
        "UK Environmental Protection Act 1990 Schedule 3A: Designated London boroughs (Westminster, Camden, Hackney, Islington, Lambeth, Southwark, Tower Hamlets) REQUIRE a prior council Free Printed Matter Distribution Licence before ANY commercial hand-to-hand fliering. Fly-posting is a criminal offence.",
      transitExclusionRule:
        "TfL Byelaws: Commercial distribution is strictly prohibited on London Underground, Overground, Elizabeth Line, DLR, and bus station premises.",
      likenessReleaseStatute:
        "UK GDPR & Data Protection Act 2018: Explicit written 18+ commercial image/voice consent and privacy notice required before publishing street-interview footage.",
      likenessReleaseCopy:
        "I confirm I am at least 18 years old. Under UK GDPR and the Data Protection Act 2018, I give explicit written consent for The Network and its authorized creators to record and publish my likeness and voice from today's street interview in organic and paid social materials.",
      disclosureAuthority:
        "UK ASA / CAP Code Rule 2.1 & DMCC Act: Prominent upfront 'Ad' label (not buried hashtags) + spoken disclosure on all paid creator posts.",
      biometricBanStatute: "UK GDPR Art. 9",
      botDisclosureRequired: false,
      quietHoursLocal: { startHour: 21, endHour: 9 },
      permitSummary:
        "HARD GATE: Must hold an active borough Free Printed Matter Distribution Licence reference before dispatching any street fliering shift. Platform core SMS awaits international E.164 support (platformActive=false).",
    },
    vendors: {
      craigslistSubdomain: "london",
      craigslistPostFeeCents: 700,
      recommendedAgencies: ["Elevate Global (London & NYC)", "Oppizi UK"],
      recommendedPrinters: ["Solopress UK", "Instantprint UK", "MOO UK"],
      vettedAgencies: LONDON_AGENCIES,
      platforms: SHARED_SELF_SERVICE_PLATFORMS.filter((p) =>
        ["platform-rentahuman", "platform-backstage", "platform-collabstr", "platform-passionfroot", "platform-upwork", "platform-fiverr"].includes(p.id),
      ),
      printers: [...LONDON_PRINTERS, ...SHARED_US_PRINTERS.filter((p) => p.id === "printer-moo")],
    },
  },
];

const cityPackRegistry = new Map<string, CityPack>(
  BUILTIN_CITY_PACKS.map((pack) => [pack.code, pack]),
);

export function listCityPacks(): readonly CityPack[] {
  return Array.from(cityPackRegistry.values());
}

export function getCityPack(code: string | null | undefined): CityPack | undefined {
  if (!code) return undefined;
  return cityPackRegistry.get(code.trim().toLowerCase());
}

export function requireCityPack(code: string): CityPack {
  const normalized = code.trim().toLowerCase();
  const pack = cityPackRegistry.get(normalized);
  if (!pack) {
    throw new UnknownCityError(code);
  }
  return pack;
}

export function registerCityPack(pack: CityPack): CityPack {
  const normalizedCode = pack.code.trim().toLowerCase();
  if (!CITY_SLUG_PATTERN.test(normalizedCode)) {
    throw new Error(`Invalid city pack code: "${pack.code}". Must match ${CITY_SLUG_PATTERN.source}.`);
  }
  if (!pack.label.trim()) {
    throw new Error("CityPack label is required.");
  }
  if (!pack.timezone.trim() || !pack.currency.trim()) {
    throw new Error(`CityPack "${normalizedCode}" requires currency and timezone.`);
  }
  if (pack.corridors.length === 0) {
    throw new Error(`CityPack "${normalizedCode}" requires at least one activation corridor.`);
  }
  const normalized: CityPack = {
    ...pack,
    code: normalizedCode,
    opsEmail: pack.opsEmail.trim() || makeOpsEmail(normalizedCode),
    platformActive: pack.platformActive ?? isPlatformCityActive(normalizedCode),
  };
  cityPackRegistry.set(normalizedCode, normalized);
  return normalized;
}

export function setCityPackStage(code: string, stage: CityLaunchStage): CityPack {
  const existing = requireCityPack(code);
  const updated: CityPack = { ...existing, stage };
  cityPackRegistry.set(existing.code, updated);
  return updated;
}

export function evaluateCityStageReadiness(
  pack: CityPack,
  metrics: CityStageMetrics,
): CityStageReadinessResult {
  const idx = CITY_LAUNCH_STAGES.indexOf(pack.stage);
  const nextStage =
    idx >= 0 && idx + 1 < CITY_LAUNCH_STAGES.length ? CITY_LAUNCH_STAGES[idx + 1] : null;
  const blockers: string[] = [];

  if (nextStage === "waitlist_kindling") {
    if (pack.corridors.length === 0) blockers.push("At least one city corridor is required.");
    if (!pack.legal.freelanceStatute.trim()) blockers.push("Legal compliance rules must be defined.");
  } else if (nextStage === "liquidity_seeding") {
    if (metrics.verifiedWaitlistAdults < pack.readinessGates.minWaitlistAdultsForSeeding) {
      blockers.push(
        `Waitlist threshold unmet: ${metrics.verifiedWaitlistAdults}/${pack.readinessGates.minWaitlistAdultsForSeeding} verified 18+ adults in ${pack.label}.`,
      );
    }
    if (metrics.signedVenues < pack.readinessGates.minSignedVenuesForSeeding) {
      blockers.push(
        `Venue readiness unmet: ${metrics.signedVenues}/${pack.readinessGates.minSignedVenuesForSeeding} signed partner venues in ${pack.label}.`,
      );
    }
  } else if (nextStage === "live_matching") {
    if (!pack.platformActive) {
      blockers.push(
        `${pack.label} is not active in core platform matching yet (platformActive=false).`,
      );
    }
    const active = metrics.activeAdults ?? 0;
    if (active < pack.readinessGates.minActiveAdultsForLiveMatching) {
      blockers.push(
        `Active adult pool unmet: ${active}/${pack.readinessGates.minActiveAdultsForLiveMatching}.`,
      );
    }
    if (metrics.parityRatio !== undefined && (metrics.parityRatio < 0.45 || metrics.parityRatio > 0.55)) {
      blockers.push(`Cohort parity outside 45-55% band (${Math.round(metrics.parityRatio * 100)}%).`);
    }
    if (metrics.reviewSlaHealthy === false) {
      blockers.push("Core review queue SLA is unhealthy.");
    }
  } else if (nextStage === "scaling") {
    const cpa = metrics.trailing30dCpaCents;
    if (cpa === null || cpa === undefined || cpa > pack.budgetDefaults.targetCpaCents) {
      blockers.push(
        `30d CPA (${cpa ?? "unmeasured"}c) exceeds target (${pack.budgetDefaults.targetCpaCents}c).`,
      );
    }
    if ((metrics.trailing30dStopRateBps ?? 0) >= 300) {
      blockers.push(`STOP rate (${metrics.trailing30dStopRateBps} bps) must be < 300 bps.`);
    }
    if ((metrics.safetyViolations ?? 0) > 0) {
      blockers.push(`Zero safety violations required (found ${metrics.safetyViolations}).`);
    }
  }

  return {
    city: pack.code,
    currentStage: pack.stage,
    nextStage,
    platformActive: pack.platformActive,
    canPromote: nextStage !== null && blockers.length === 0,
    blockers,
  };
}
