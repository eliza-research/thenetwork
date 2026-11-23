// GENERATED from spec/agentEntry.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type LogoMark as brandIdentity_LogoMark, type SharedPart as brandIdentity_SharedPart, type Brand as brandIdentity_Brand, supportEmail as brandIdentity_supportEmail, agentAccessPage as brandIdentity_agentAccessPage, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, accentTokens as brandIdentity_accentTokens, connectorEndpoint as brandIdentity_connectorEndpoint, openaiConnectorEndpoint as brandIdentity_openaiConnectorEndpoint, mayName as brandIdentity_mayName, siteUsesPart as brandIdentity_siteUsesPart, appKeys as brandIdentity_appKeys, brandFor as brandIdentity_brandFor, hubTextsOnAppSurface as brandIdentity_hubTextsOnAppSurface, lawAppEndpointsAreDistinct as brandIdentity_lawAppEndpointsAreDistinct, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, lawSitesShareParts as brandIdentity_lawSitesShareParts, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, lawOnlyTheSkillNamesTheEndpoint as brandIdentity_lawOnlyTheSkillNamesTheEndpoint, partTokens as brandIdentity_partTokens, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct, lawPartsTakeTheBrandTokens as brandIdentity_lawPartsTakeTheBrandTokens } from "./brandIdentity.ts";

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
export type McpEndpoint = "NoEndpoint" | "SiteEndpoint" | "OpenAiEndpoint";
/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
export type Plugin = "ClaudePlugin" | "OpenAiPlugin";
/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
export type EntryKind = "NoEntry" | "FromSite" | "FromClaudePlugin" | "FromOpenAiPlugin" | "FromSkillCatalog" | "FromUpdateLink";
/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
export type EntryPhase = "NotArrived" | "InAgent" | "FollowingSkill" | "Explaining" | "UpdateShown" | "NothingNewShown" | "NeedsConnection" | "EntryRefused";
/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
export type Route = "SkillRoute" | "UpdatesRoute" | "NoRoute";
/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
export interface Entry { phase: EntryPhase; entry: EntryKind; app: brandIdentity_AppKey; skill: string }
/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
export type Channel = "IMessage" | "Sms" | "Telegram";
/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
export type LinkedAssistant = "ChatGptAssistant" | "ClaudeAssistant" | "GrokAssistant";
/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
export type UpdateDelivery = "InThread" | "AssistantLink" | "ButtonPage";

/** One variant per transition in the spec. */
export type Event =
  | { type: "arrive"; entryKind: EntryKind; app: brandIdentity_AppKey }
  | { type: "resolveSkill"; wantsSignup: boolean }
  | { type: "resolveUpdate"; connected: boolean; referenceOwn: boolean };

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
export const noSkill: string = "";
/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
export const updatePromptLead: string = "Ask The Network for update ";
/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
export const updateHandoffPrefix: string = "/t/";
/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
export const openAiManifestApp: brandIdentity_AppKey = "Ntwrk";
/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
export const endpointHost: brandIdentity_AppKey = "Ntwrk";
/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
export const linkedAssistants: LinkedAssistant[] = ["ChatGptAssistant", "ClaudeAssistant", "GrokAssistant"];
/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
export const initial: Entry = { phase: "NotArrived", entry: "NoEntry", app: "Ntwrk", skill: noSkill };

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Entry): boolean {
  return alwaysStartHasNoEntry(current) && alwaysSkillOnlyAfterResolution(current) && alwaysSkillMatchesApp(current) && alwaysOpenAiPluginNeverReachesSlop(current) && alwaysSitePromptStartsSignup(current) && alwaysUpdatesOnlyFromReference(current);
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function appOpenAiEndpointPath(app: brandIdentity_AppKey): string {
  return app === "Ntwrk" ? "/mcp/openai" : (app === "Slop" ? "/mcp/slop/openai" : (app === "Peon" ? "/mcp/peon/openai" : "/mcp/friends/openai"));
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function pluginListsSkill(plugin: Plugin, app: brandIdentity_AppKey): boolean {
  return plugin === "ClaudePlugin" || app !== "Slop";
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function pluginEndpoint(plugin: Plugin, app: brandIdentity_AppKey): McpEndpoint {
  return plugin === "ClaudePlugin" ? "SiteEndpoint" : (app === "Slop" ? "NoEndpoint" : "OpenAiEndpoint");
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function appEndpointPath(app: brandIdentity_AppKey): string {
  return app === "Ntwrk" ? "/mcp" : (app === "Slop" ? "/mcp/slop" : (app === "Peon" ? "/mcp/peon" : "/mcp/friends"));
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function endpointPath(endpoint: McpEndpoint, app: brandIdentity_AppKey): string {
  return endpoint === "SiteEndpoint" ? appEndpointPath(app) : (endpoint === "OpenAiEndpoint" ? appOpenAiEndpointPath(app) : "");
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function lawEveryAppHasItsOwnPath(app: brandIdentity_AppKey, other: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return !(app !== other) || (appEndpointPath(app) !== appEndpointPath(other) && appOpenAiEndpointPath(app) !== appOpenAiEndpointPath(other));
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function lawOpenAiManifestServerIsAListedApp(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return !(app === openAiManifestApp) || (pluginListsSkill("OpenAiPlugin", app) && pluginEndpoint("OpenAiPlugin", app) === "OpenAiEndpoint");
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function lawClaudePluginListsEverySkill(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return pluginListsSkill("ClaudePlugin", app) && pluginEndpoint("ClaudePlugin", app) === "SiteEndpoint";
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function lawOpenAiPluginOmitsSlop(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return pluginListsSkill("OpenAiPlugin", app) === (app !== "Slop") && (pluginEndpoint("OpenAiPlugin", app) === "NoEndpoint") === (app === "Slop");
}

/** Story: Get from an app site or a text into my own agent / The Claude plugin lists four skills and the OpenAI plugin lists three, and every skill uses the ntwrk.party endpoint of its app (spec/agentEntry.md) */
//@ pure
export function lawEveryListedSkillHasAnEndpoint(plugin: Plugin, app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return pluginListsSkill(plugin, app) === (endpointPath(pluginEndpoint(plugin, app), app) !== "");
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function skillFor(app: brandIdentity_AppKey): string {
  return brandIdentity_brandFor(app).skillName;
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function routeFor(entryKind: EntryKind, app: brandIdentity_AppKey): Route {
  return entryKind === "NoEntry" ? "NoRoute" : (entryKind === "FromUpdateLink" ? "UpdatesRoute" : (entryKind === "FromOpenAiPlugin" && app === "Slop" ? "NoRoute" : "SkillRoute"));
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function canArrive(s: Entry, entryKind: EntryKind): boolean {
  return s.phase === "NotArrived" && entryKind !== "NoEntry";
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function arrive(s: Entry, entryKind: EntryKind, app: brandIdentity_AppKey): Entry {
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> alwaysStartHasNoEntry(\result)
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> alwaysSkillOnlyAfterResolution(\result)
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> alwaysSkillMatchesApp(\result)
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> alwaysOpenAiPluginNeverReachesSlop(\result)
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> alwaysSitePromptStartsSignup(\result)
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> alwaysUpdatesOnlyFromReference(\result)
  //@ ensures (inv(s) && canArrive(s, entryKind)) ==> stepUpdateShownOnlyByTheUpdatesTool(s, "arrive", \result)
  return { ...s, entry: entryKind, app: app, phase: "InAgent" };
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function canResolveSkill(s: Entry): boolean {
  return s.phase === "InAgent" && routeFor(s.entry, s.app) !== "UpdatesRoute";
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function resolveSkill(s: Entry, wantsSignup: boolean): Entry {
  //@ ensures (inv(s) && canResolveSkill(s)) ==> alwaysStartHasNoEntry(\result)
  //@ ensures (inv(s) && canResolveSkill(s)) ==> alwaysSkillOnlyAfterResolution(\result)
  //@ ensures (inv(s) && canResolveSkill(s)) ==> alwaysSkillMatchesApp(\result)
  //@ ensures (inv(s) && canResolveSkill(s)) ==> alwaysOpenAiPluginNeverReachesSlop(\result)
  //@ ensures (inv(s) && canResolveSkill(s)) ==> alwaysSitePromptStartsSignup(\result)
  //@ ensures (inv(s) && canResolveSkill(s)) ==> alwaysUpdatesOnlyFromReference(\result)
  //@ ensures (inv(s) && canResolveSkill(s)) ==> stepUpdateShownOnlyByTheUpdatesTool(s, "resolveSkill", \result)
  return routeFor(s.entry, s.app) === "NoRoute" ? ({ ...s, phase: "EntryRefused" } as Entry) : ({ ...s, skill: skillFor(s.app), phase: wantsSignup || s.entry === "FromSite" ? "FollowingSkill" : "Explaining" } as Entry);
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function lawOpenAiPluginHasNoSlopRoute(entryKind: EntryKind): boolean {
  //@ ensures \result === true
  return !(entryKind === "FromOpenAiPlugin") || routeFor(entryKind, "Slop") === "NoRoute";
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function lawRouteNeedsAPluginSkill(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return (routeFor("FromOpenAiPlugin", app) === "SkillRoute") === pluginListsSkill("OpenAiPlugin", app);
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function alwaysStartHasNoEntry(s: Entry): boolean {
  return (s.phase === "NotArrived") === (s.entry === "NoEntry");
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function alwaysSkillOnlyAfterResolution(s: Entry): boolean {
  return !(s.phase !== "FollowingSkill" && s.phase !== "Explaining") || s.skill === noSkill;
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function alwaysSkillMatchesApp(s: Entry): boolean {
  return !(s.phase === "FollowingSkill" || s.phase === "Explaining") || s.skill === skillFor(s.app);
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function alwaysOpenAiPluginNeverReachesSlop(s: Entry): boolean {
  return !(s.entry === "FromOpenAiPlugin") || s.skill !== skillFor("Slop");
}

/** Story: Get from an app site or a text into my own agent / The entry decides the route, and the agent loads only the app's own skill (spec/agentEntry.md) */
//@ pure
export function alwaysSitePromptStartsSignup(s: Entry): boolean {
  return !(s.entry === "FromSite") || s.phase !== "Explaining";
}

/** Story: Get from an app site or a text into my own agent / An update reference shows only the person's own update on their own connection (spec/agentEntry.md) */
//@ pure
export function canResolveUpdate(s: Entry): boolean {
  return s.phase === "InAgent" && routeFor(s.entry, s.app) === "UpdatesRoute";
}

/** Story: Get from an app site or a text into my own agent / An update reference shows only the person's own update on their own connection (spec/agentEntry.md) */
//@ pure
export function resolveUpdate(s: Entry, connected: boolean, referenceOwn: boolean): Entry {
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> alwaysStartHasNoEntry(\result)
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> alwaysSkillOnlyAfterResolution(\result)
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> alwaysSkillMatchesApp(\result)
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> alwaysOpenAiPluginNeverReachesSlop(\result)
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> alwaysSitePromptStartsSignup(\result)
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> alwaysUpdatesOnlyFromReference(\result)
  //@ ensures (inv(s) && canResolveUpdate(s)) ==> stepUpdateShownOnlyByTheUpdatesTool(s, "resolveUpdate", \result)
  return { ...s, phase: !connected ? "NeedsConnection" : (referenceOwn ? "UpdateShown" : "NothingNewShown") };
}

/** Story: Get from an app site or a text into my own agent / An update reference shows only the person's own update on their own connection (spec/agentEntry.md) */
//@ pure
export function alwaysUpdatesOnlyFromReference(s: Entry): boolean {
  return !(s.phase === "UpdateShown" || s.phase === "NothingNewShown" || s.phase === "NeedsConnection") || (s.entry === "FromUpdateLink" && s.skill === noSkill);
}

/** Story: Get from an app site or a text into my own agent / An update reference shows only the person's own update on their own connection (spec/agentEntry.md) */
//@ pure
export function stepUpdateShownOnlyByTheUpdatesTool(before: Entry, via: string, after: Entry): boolean {
  return !(after.phase === "UpdateShown" && before.phase !== "UpdateShown") || via === "resolveUpdate";
}

/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
//@ pure
export function updateLinkTemplate(assistant: LinkedAssistant): string {
  return assistant === "ChatGptAssistant" ? "https://chatgpt.com/?prompt={q}" : (assistant === "ClaudeAssistant" ? "https://claude.ai/new?q={q}" : "https://grok.com/?q={q}");
}

/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
//@ pure
export function updateDeliveryFor(channel: Channel, assistantUsable: boolean): UpdateDelivery {
  return !assistantUsable ? "InThread" : (channel === "IMessage" ? "AssistantLink" : "ButtonPage");
}

/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
//@ pure
export function lawNoAssistantMeansThread(channel: Channel): boolean {
  //@ ensures \result === true
  return updateDeliveryFor(channel, false) === "InThread";
}

/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
//@ pure
export function lawOnlyIMessageLinksDirectly(channel: Channel): boolean {
  //@ ensures \result === true
  return (updateDeliveryFor(channel, true) === "AssistantLink") === (channel === "IMessage");
}

/** Story: Get from an app site or a text into my own agent / An update text links to an assistant only when the person uses one (spec/agentEntry.md) */
//@ pure
export function lawChatGptLinkNeverSends(assistant: LinkedAssistant): boolean {
  //@ ensures \result === true
  return updateLinkTemplate(assistant) !== "https://chatgpt.com/?q={q}";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesFollowingSkill(s: Entry): boolean {
  return s.phase === "FollowingSkill";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesFollowingSkillFromSite(s: Entry): boolean {
  return s.phase === "FollowingSkill" && s.entry === "FromSite";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesFollowingSkillFromCatalog(s: Entry): boolean {
  return s.phase === "FollowingSkill" && s.entry === "FromSkillCatalog";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesFollowingSkillFromClaudePlugin(s: Entry): boolean {
  return s.phase === "FollowingSkill" && s.entry === "FromClaudePlugin";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesFollowingSkillFromOpenAiPlugin(s: Entry): boolean {
  return s.phase === "FollowingSkill" && s.entry === "FromOpenAiPlugin";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesExplaining(s: Entry): boolean {
  return s.phase === "Explaining";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesUpdateShown(s: Entry): boolean {
  return s.phase === "UpdateShown";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesNothingNewShown(s: Entry): boolean {
  return s.phase === "NothingNewShown";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesNeedsConnection(s: Entry): boolean {
  return s.phase === "NeedsConnection";
}

/** Story: Get from an app site or a text into my own agent / Every entry can reach its result (spec/agentEntry.md) */
//@ pure
export function sometimesEntryRefused(s: Entry): boolean {
  return s.phase === "EntryRefused";
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Entry, event: Event): boolean {
  if (event.type === "arrive") return canArrive(current, event.entryKind);
  if (event.type === "resolveSkill") return canResolveSkill(current);
  if (event.type === "resolveUpdate") return canResolveUpdate(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Entry, event: Event): Entry {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "arrive") return canArrive(current, event.entryKind) ? arrive(current, event.entryKind, event.app) : current;
  if (event.type === "resolveSkill") return canResolveSkill(current) ? resolveSkill(current, event.wantsSignup) : current;
  if (event.type === "resolveUpdate") return canResolveUpdate(current) ? resolveUpdate(current, event.connected, event.referenceOwn) : current;
  return current;
}

/**
 * Turn an untrusted value into an event, or undefined if it is not one. Use it wherever events enter the program:
 * the proofs assume whole numbers and plain data, and this is what makes that true. The result is a fresh copy
 * with exactly the fields the event has, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseEvent(x: unknown): Event | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  if (raw.type === "arrive" && (raw.entryKind === "NoEntry" || raw.entryKind === "FromSite" || raw.entryKind === "FromClaudePlugin" || raw.entryKind === "FromOpenAiPlugin" || raw.entryKind === "FromSkillCatalog" || raw.entryKind === "FromUpdateLink") && (raw.app === "Ntwrk" || raw.app === "Slop" || raw.app === "Peon" || raw.app === "Friends")) return { type: "arrive", entryKind: raw.entryKind, app: raw.app };
  if (raw.type === "resolveSkill" && typeof raw.wantsSignup === "boolean") return { type: "resolveSkill", wantsSignup: raw.wantsSignup };
  if (raw.type === "resolveUpdate" && typeof raw.connected === "boolean" && typeof raw.referenceOwn === "boolean") return { type: "resolveUpdate", connected: raw.connected, referenceOwn: raw.referenceOwn };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Entry | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && (raw.phase === "NotArrived" || raw.phase === "InAgent" || raw.phase === "FollowingSkill" || raw.phase === "Explaining" || raw.phase === "UpdateShown" || raw.phase === "NothingNewShown" || raw.phase === "NeedsConnection" || raw.phase === "EntryRefused") && (raw.entry === "NoEntry" || raw.entry === "FromSite" || raw.entry === "FromClaudePlugin" || raw.entry === "FromOpenAiPlugin" || raw.entry === "FromSkillCatalog" || raw.entry === "FromUpdateLink") && (raw.app === "Ntwrk" || raw.app === "Slop" || raw.app === "Peon" || raw.app === "Friends") && typeof raw.skill === "string" && Object.keys(raw).length === 4)) return undefined;
  const parsed: Entry = ({ phase: raw.phase, entry: raw.entry, app: raw.app, skill: raw.skill });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Entry {
  //@ ensures inv(\result)
  return initial;
}
