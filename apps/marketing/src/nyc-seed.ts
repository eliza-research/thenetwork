import {
  CANONICAL_SEED_AGENTS,
  ON_SITE_RELEASE_FORM_COPY,
  SUPPORTED_SUBSCRIPTION_PROVIDERS,
  buildCityLaunchSeed,
  createCitySeedAgents,
  renderMarketingEmailTemplate,
  seedCityLaunch,
  type AgentOverrideMap,
  type AutomatedEmailTemplate,
  type BudgetTrackAllocation,
  type CityActivationCorridor,
  type CityLaunchSeedBundle,
  type EmailTemplateId,
  type SeedAgentAuthMode,
  type SeedAgentConfig,
  type SeedAppId,
  type SeedBanditArm,
  type SeedBdDeal,
  type SeedCampaignConfig,
  type SeedDeviceSlot,
  type SeedPersonaId,
  type SeedStarterTask,
  type SeedSubscriptionProvider,
  type SeedVideoAsset,
  type SeedVipProspect,
  type WeeklyRolloutSlice,
} from "./city-launch-engine.ts";
import {
  type CityVendorAgency,
  type CityVendorPlatform,
  type CityVendorPrinter,
} from "./city-registry.ts";
import { MARKETING_EMAIL_TEMPLATES } from "./constants.ts";

export {
  ON_SITE_RELEASE_FORM_COPY,
  SUPPORTED_SUBSCRIPTION_PROVIDERS,
  buildCityLaunchSeed,
  createCitySeedAgents,
  seedCityLaunch,
  type AutomatedEmailTemplate,
  type BudgetTrackAllocation,
  type EmailTemplateId,
  type SeedAgentAuthMode,
  type SeedAgentConfig,
  type SeedAppId,
  type SeedBanditArm,
  type SeedBdDeal,
  type SeedCampaignConfig,
  type SeedDeviceSlot,
  type SeedPersonaId,
  type SeedStarterTask,
  type SeedSubscriptionProvider,
  type SeedVideoAsset,
  type SeedVipProspect,
  type WeeklyRolloutSlice,
};

export type NycActivationCorridor = CityActivationCorridor;

export interface VettedNycAgency extends CityVendorAgency {
  readonly nycAddress?: string;
}

export interface SelfServicePlatform extends CityVendorPlatform {
  readonly typicalNycRate: string;
}

export type NycLocalPrinter = CityVendorPrinter;

export interface NycLaunchSeedBundle extends Omit<CityLaunchSeedBundle, "agencies" | "platforms" | "printers"> {
  readonly agencies: readonly VettedNycAgency[];
  readonly platforms: readonly SelfServicePlatform[];
  readonly printers: readonly NycLocalPrinter[];
}

const NYC_SEED_BASE = buildCityLaunchSeed("nyc");

export const NYC_SEED_AGENTS: readonly SeedAgentConfig[] = CANONICAL_SEED_AGENTS;

export function createNycSeedAgents(overrides?: AgentOverrideMap): SeedAgentConfig[] {
  return createCitySeedAgents(overrides);
}

export const NYC_TIER2_DEVICES: readonly SeedDeviceSlot[] = NYC_SEED_BASE.devices;

export const NYC_MONTH1_BUDGET_TRACKS: readonly BudgetTrackAllocation[] =
  NYC_SEED_BASE.campaign.tracks;

export const NYC_MONTH1_WEEKLY_ROLLOUT: readonly WeeklyRolloutSlice[] =
  NYC_SEED_BASE.campaign.weeklyRollout;

export const NYC_ACTIVATION_CORRIDORS: readonly NycActivationCorridor[] =
  NYC_SEED_BASE.campaign.corridors;

export const NYC_LAUNCH_CAMPAIGN: SeedCampaignConfig = NYC_SEED_BASE.campaign;

export const NYC_STARTER_TASKS: readonly SeedStarterTask[] = NYC_SEED_BASE.starterTasks;

export const NYC_STARTER_BANDIT_ARMS: readonly SeedBanditArm[] = NYC_SEED_BASE.banditArms;

export const NYC_STARTER_BD_DEALS: readonly SeedBdDeal[] = NYC_SEED_BASE.bdDeals;

export const NYC_STARTER_VIP_PROSPECTS: readonly SeedVipProspect[] = NYC_SEED_BASE.vipProspects;

export const NYC_STARTER_VIDEO_ASSETS: readonly SeedVideoAsset[] = NYC_SEED_BASE.videoAssets;

export const VETTED_NYC_AGENCIES: readonly VettedNycAgency[] = NYC_SEED_BASE.agencies.map((a) => ({
  ...a,
  nycAddress: a.localAddress,
}));

export const SELF_SERVICE_PLATFORMS: readonly SelfServicePlatform[] = NYC_SEED_BASE.platforms.map(
  (p) => ({
    ...p,
    typicalNycRate: p.typicalLocalRate,
  }),
);

export const NYC_LOCAL_PRINTERS: readonly NycLocalPrinter[] = NYC_SEED_BASE.printers;

export const NYC_EMAIL_TEMPLATES: Record<EmailTemplateId, AutomatedEmailTemplate> =
  MARKETING_EMAIL_TEMPLATES;

export const renderEmailTemplate = renderMarketingEmailTemplate;

export function buildNycLaunchSeed(agentOverrides?: AgentOverrideMap): NycLaunchSeedBundle {
  const base = buildCityLaunchSeed("nyc", { agentOverrides });
  return {
    ...base,
    agencies: base.agencies.map((a) => ({ ...a, nycAddress: a.localAddress })),
    platforms: base.platforms.map((p) => ({ ...p, typicalNycRate: p.typicalLocalRate })),
    printers: base.printers,
  };
}
