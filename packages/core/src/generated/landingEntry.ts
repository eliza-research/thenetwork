// GENERATED from spec/landingEntry.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type SharedPart as brandIdentity_SharedPart, type LogoMark as brandIdentity_LogoMark, type Brand as brandIdentity_Brand, supportEmail as brandIdentity_supportEmail, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, accentTokens as brandIdentity_accentTokens, mayName as brandIdentity_mayName, siteUsesPart as brandIdentity_siteUsesPart, appKeys as brandIdentity_appKeys, brandFor as brandIdentity_brandFor, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, lawSitesShareParts as brandIdentity_lawSitesShareParts, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, partTokens as brandIdentity_partTokens, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct, lawPartsTakeTheBrandTokens as brandIdentity_lawPartsTakeTheBrandTokens } from "./brandIdentity.ts";

/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export type CopyState = "CopyHidden" | "CopyReady" | "CopyCopied" | "CopySelected";
/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export type StatusLine = "StatusEmpty" | "AgentOpening" | "PasteInAgent" | "SendToAgentApp" | "CopyByHand" | "MessageCopied" | "TextTheNumber";
/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export type MessagesState = "MessagesIdle" | "MessagesLinkFollowed" | "MessagesWaiting" | "MessagesOpened" | "MessagesFallback";
/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export type AgentId = "ChatGpt" | "Claude" | "Grok" | "Muse" | "Gemini" | "Perplexity" | "Cursor" | "OpenClaw" | "Hermes";
/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export type DeviceKind = "NotDetected" | "Phone" | "MacDesktop" | "OtherDesktop";
/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export interface Landing { mounted: boolean; device: DeviceKind; copy: CopyState; status: StatusLine; messages: MessagesState; messageCopied: boolean; agentFollowed: boolean; lastAgent: AgentId; statusAgent: AgentId }
/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
export type TileKind = "OpensWithPrompt" | "OpensForPaste" | "OpensInstalledApp" | "CopyOnly";
/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
export type LandingItem = "BrandMarkItem" | "HeadlineItem" | "PromptItem" | "CopyButtonItem" | "AgentRowItem" | "MessagesItem" | "StatusItem" | "PrivacyLinkItem" | "TermsLinkItem" | "SignInItem" | "SettingsItem" | "DashboardItem" | "SafetyNoticeItem" | "ComplianceItem" | "ExplainerItem";

/** One variant per transition in the spec. */
export type Event =
  | { type: "mount"; device: DeviceKind }
  | { type: "pressCopy"; copied: boolean }
  | { type: "chooseAgent"; agent: AgentId; copied: boolean }
  | { type: "chooseMessages"; copied: boolean }
  | { type: "settleMessages"; pageLeft: boolean };

/** Story: Start in Messages instead / The Messages entry writes `join <keyword>` to the shared line (spec/landingEntry.md) */
export const messagesEntryLabel: string = "Use in iMessage";
/** Story: Start in Messages instead / The Messages entry writes `join <keyword>` to the shared line (spec/landingEntry.md) */
export const joinMessagePrefix: string = "join ";
/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
export const messageCopiedTemplate: string = "Message copied. Text it to {number} if iMessage did not open.";
/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
export const textTheNumberTemplate: string = "Text “{message}” to {number}.";
/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
export const messagesWaitMs: number = 1500;
/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
export const landingWordLimit: number = 45;
/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
export const landingHeadingCount: number = 1;
/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
export const promptLead: string = "Read https://";
/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
export const promptSkillPath: string = "/SKILL.md";
/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
export const openTileLabelLead: string = "Open in ";
/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
export const copyTileLabelLead: string = "Copy the prompt for ";
/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
export const promptVersionQuery: string = "?version=";
/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
export const copyByHandText: string = "Copy the prompt, then paste it into your agent.";
/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
export const promptTail: string = " and follow it.";
/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
export const landingItems: LandingItem[] = ["BrandMarkItem", "HeadlineItem", "PromptItem", "CopyButtonItem", "AgentRowItem", "MessagesItem", "StatusItem", "PrivacyLinkItem", "TermsLinkItem"];
/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
export const neverOnLanding: LandingItem[] = ["SignInItem", "SettingsItem", "DashboardItem", "SafetyNoticeItem", "ComplianceItem", "ExplainerItem"];
/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
export const initial: Landing = { mounted: false, device: "NotDetected", copy: "CopyHidden", status: "StatusEmpty", messages: "MessagesIdle", messageCopied: false, agentFollowed: false, lastAgent: "ChatGpt", statusAgent: "ChatGpt" };
/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
export const agentOrder: AgentId[] = ["ChatGpt", "Claude", "Grok", "Muse", "Gemini", "Perplexity", "Cursor", "OpenClaw", "Hermes"];

/** Every `always` rule at once. Holds initially and after every transition. */
//@ pure
export function inv(current: Landing): boolean {
  return alwaysCopyButtonNeedsScript(current) && alwaysDeviceKnownOnlyWithScript(current) && alwaysFollowedAgentHasLink(current) && alwaysNoDesktopAgentOnPhone(current) && alwaysAgentStatusNamesPressedAgent(current) && alwaysLinkFollowedOnlyWithoutScript(current) && alwaysFallbackNeedsScript(current) && alwaysWaitOnlyWhereMessagesOpens(current) && alwaysStatusNeedsScript(current);
}

/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
//@ pure
export function promptCarriesVersion(app: brandIdentity_AppKey): boolean {
  return app !== "Slop";
}

/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
//@ pure
export function promptDomain(app: brandIdentity_AppKey): string {
  return brandIdentity_brandFor(app).domain;
}

/** Story: Take the signup prompt to my agent / The prompt tells the agent to read the site's skill and follow it (spec/landingEntry.md) */
//@ pure
export function lawOnlySlopPromptHasNoVersion(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return !promptCarriesVersion(app) === (app === "Slop");
}

/** Story: Take the signup prompt to my agent / The prompt names the host of the site that serves it (spec/landingEntry.md) */
//@ pure
export function promptHost(app: brandIdentity_AppKey, siteHost: string): string {
  return siteHost === "" ? promptDomain(app) : siteHost;
}

/** Story: Take the signup prompt to my agent / The prompt names the host of the site that serves it (spec/landingEntry.md) */
//@ pure
export function lawProductionPromptNamesBrandDomain(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return promptHost(app, "") === brandIdentity_brandFor(app).domain;
}

/** Story: Take the signup prompt to my agent / The prompt names the host of the site that serves it (spec/landingEntry.md) */
//@ pure
export function lawStagingPromptNamesItsHost(app: brandIdentity_AppKey, siteHost: string): boolean {
  //@ ensures \result === true
  return !(siteHost !== "") || promptHost(app, siteHost) === siteHost;
}

/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
//@ pure
export function canMount(s: Landing, device: DeviceKind): boolean {
  return !s.mounted && device !== "NotDetected" && s.messages === "MessagesIdle" && !s.agentFollowed;
}

/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
//@ pure
export function mount(s: Landing, device: DeviceKind): Landing {
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysCopyButtonNeedsScript(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysDeviceKnownOnlyWithScript(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysFollowedAgentHasLink(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysNoDesktopAgentOnPhone(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysAgentStatusNamesPressedAgent(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysLinkFollowedOnlyWithoutScript(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysFallbackNeedsScript(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysWaitOnlyWhereMessagesOpens(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> alwaysStatusNeedsScript(\result)
  //@ ensures (inv(s) && canMount(s, device)) ==> stepCopyLabelChangesOnlyByCopy(s, "mount", \result)
  //@ ensures (inv(s) && canMount(s, device)) ==> stepMessagesFallbackShowsNumber(s, "mount", \result)
  return { ...s, mounted: true, device: device, copy: "CopyReady" };
}

/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
//@ pure
export function alwaysCopyButtonNeedsScript(s: Landing): boolean {
  return s.mounted === (s.copy !== "CopyHidden");
}

/** Story: Take the signup prompt to my agent / The Copy button shows only when the page script runs (spec/landingEntry.md) */
//@ pure
export function alwaysDeviceKnownOnlyWithScript(s: Landing): boolean {
  return s.mounted === (s.device !== "NotDetected");
}

/** Story: Take the signup prompt to my agent / A phone user agent or a touch Mac is a phone (spec/landingEntry.md) */
//@ pure
export function deviceFor(phoneUserAgent: boolean, macUserAgent: boolean, touchPoints: number): DeviceKind {
  return phoneUserAgent || (macUserAgent && touchPoints > 1) ? "Phone" : (macUserAgent ? "MacDesktop" : "OtherDesktop");
}

/** Story: Take the signup prompt to my agent / A phone user agent or a touch Mac is a phone (spec/landingEntry.md) */
//@ pure
export function lawTouchMacIsPhone(touchPoints: number): boolean {
  //@ ensures \result === true
  return !(touchPoints > 1) || deviceFor(false, true, touchPoints) === "Phone";
}

/** Story: Take the signup prompt to my agent / A phone user agent or a touch Mac is a phone (spec/landingEntry.md) */
//@ pure
export function lawDeviceIsAlwaysDetected(phoneUserAgent: boolean, macUserAgent: boolean, touchPoints: number): boolean {
  //@ ensures \result === true
  return deviceFor(phoneUserAgent, macUserAgent, touchPoints) !== "NotDetected";
}

/** Story: Take the signup prompt to my agent / Copy puts the prompt on the clipboard, or selects it when the clipboard refuses (spec/landingEntry.md) */
//@ pure
export function canPressCopy(s: Landing): boolean {
  return s.mounted && s.copy !== "CopyHidden";
}

/** Story: Take the signup prompt to my agent / Copy puts the prompt on the clipboard, or selects it when the clipboard refuses (spec/landingEntry.md) */
//@ pure
export function pressCopy(s: Landing, copied: boolean): Landing {
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysCopyButtonNeedsScript(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysDeviceKnownOnlyWithScript(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysFollowedAgentHasLink(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysNoDesktopAgentOnPhone(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysAgentStatusNamesPressedAgent(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysLinkFollowedOnlyWithoutScript(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysFallbackNeedsScript(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysWaitOnlyWhereMessagesOpens(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> alwaysStatusNeedsScript(\result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> stepCopyLabelChangesOnlyByCopy(s, "pressCopy", \result)
  //@ ensures (inv(s) && canPressCopy(s)) ==> stepMessagesFallbackShowsNumber(s, "pressCopy", \result)
  return { ...s, copy: copied ? "CopyCopied" : "CopySelected" };
}

/** Story: Take the signup prompt to my agent / Copy puts the prompt on the clipboard, or selects it when the clipboard refuses (spec/landingEntry.md) */
//@ pure
export function copyLabel(copyState: CopyState): string {
  return copyState === "CopyCopied" ? "Copied" : (copyState === "CopySelected" ? "Selected: press copy" : "Copy");
}

/** Story: Take the signup prompt to my agent / Copy puts the prompt on the clipboard, or selects it when the clipboard refuses (spec/landingEntry.md) */
//@ pure
export function stepCopyLabelChangesOnlyByCopy(before: Landing, via: string, after: Landing): boolean {
  return !(after.copy !== before.copy) || (via === "mount" || via === "pressCopy");
}

/** Story: Take the signup prompt to my agent / Copy puts the prompt on the clipboard, or selects it when the clipboard refuses (spec/landingEntry.md) */
//@ pure
export function sometimesCopied(s: Landing): boolean {
  return s.copy === "CopyCopied";
}

/** Story: Take the signup prompt to my agent / Copy puts the prompt on the clipboard, or selects it when the clipboard refuses (spec/landingEntry.md) */
//@ pure
export function sometimesSelectedForHandCopy(s: Landing): boolean {
  return s.copy === "CopySelected";
}

/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
//@ pure
export function tileKindFor(agent: AgentId): TileKind {
  return agent === "Muse" ? "CopyOnly" : (agent === "Gemini" ? "OpensForPaste" : (agent === "OpenClaw" || agent === "Hermes" ? "OpensInstalledApp" : "OpensWithPrompt"));
}

/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
//@ pure
export function agentName(agent: AgentId): string {
  return agent === "ChatGpt" ? "ChatGPT" : (agent === "Claude" ? "Claude" : (agent === "Grok" ? "Grok" : (agent === "Muse" ? "Muse" : (agent === "Gemini" ? "Gemini" : (agent === "Perplexity" ? "Perplexity" : (agent === "Cursor" ? "Cursor" : (agent === "OpenClaw" ? "OpenClaw" : "Hermes")))))));
}

/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
//@ pure
export function agentLogo(agent: AgentId): string {
  return agent === "ChatGpt" ? "openai" : (agent === "Claude" ? "claude" : (agent === "Grok" ? "grok" : (agent === "Muse" ? "muse" : (agent === "Gemini" ? "gemini" : (agent === "Perplexity" ? "perplexity" : (agent === "Cursor" ? "cursor" : (agent === "OpenClaw" ? "openclaw" : "hermesagent")))))));
}

/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
//@ pure
export function agentLinkTemplate(agent: AgentId): string {
  return agent === "ChatGpt" ? "https://chatgpt.com/?q={q}" : (agent === "Claude" ? "https://claude.ai/new?q={q}" : (agent === "Grok" ? "https://grok.com/?q={q}" : (agent === "Gemini" ? "https://gemini.google.com/app?q={q}" : (agent === "Perplexity" ? "https://www.perplexity.ai/search?q={q}" : (agent === "Cursor" ? "https://cursor.com/link/prompt?text={q}" : (agent === "OpenClaw" ? "openclaw://agent?message={q}" : (agent === "Hermes" ? "hermes://skill/install?identifier={skill}" : "")))))));
}

/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
//@ pure
export function tileLabelLead(agent: AgentId): string {
  return tileKindFor(agent) === "CopyOnly" ? copyTileLabelLead : openTileLabelLead;
}

/** Story: Open my agent from its tile / The agent row lists nine agents in a fixed order, each with a kind, a name, a logo and a link (spec/landingEntry.md) */
//@ pure
export function lawOnlyCopyOnlyTilesHaveNoLink(agent: AgentId): boolean {
  //@ ensures \result === true
  return (tileKindFor(agent) === "CopyOnly") === (agentLinkTemplate(agent) === "");
}

/** Story: Open my agent from its tile / A desktop-only tile is hidden on a phone, and a copy-only tile needs the page script (spec/landingEntry.md) */
//@ pure
export function desktopOnlyAgent(agent: AgentId): boolean {
  return agent === "Cursor";
}

/** Story: Open my agent from its tile / A desktop-only tile is hidden on a phone, and a copy-only tile needs the page script (spec/landingEntry.md) */
//@ pure
export function tileShown(agent: AgentId, mounted: boolean, device: DeviceKind): boolean {
  return (tileKindFor(agent) !== "CopyOnly" || mounted) && !(desktopOnlyAgent(agent) && device === "Phone");
}

/** Story: Open my agent from its tile / A desktop-only tile is hidden on a phone, and a copy-only tile needs the page script (spec/landingEntry.md) */
//@ pure
export function lawCopyOnlyTileNeedsScript(agent: AgentId, device: DeviceKind): boolean {
  //@ ensures \result === true
  return !(tileKindFor(agent) === "CopyOnly") || !tileShown(agent, false, device);
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function sometimesPasteOnlyAgent(s: Landing): boolean {
  return !s.agentFollowed && s.status === "PasteInAgent";
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function sometimesInstalledAppAgent(s: Landing): boolean {
  return s.status === "SendToAgentApp";
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function sometimesCopyByHand(s: Landing): boolean {
  return s.status === "CopyByHand";
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function sometimesAgentWithoutScript(s: Landing): boolean {
  return !s.mounted && s.agentFollowed;
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function agentToastText(agent: AgentId): string {
  return agent === "ChatGpt" ? "Opening ChatGPT. The prompt is copied too." : (agent === "Claude" ? "Opening Claude. The prompt is copied too." : (agent === "Grok" ? "Opening Grok. The prompt is copied too." : (agent === "Muse" ? "Copied. Paste it into Muse." : (agent === "Gemini" ? "Copied. Paste it into Gemini." : (agent === "Perplexity" ? "Opening Perplexity. The prompt is copied too." : (agent === "Cursor" ? "Opening Cursor. The prompt is copied too." : (agent === "OpenClaw" ? "Copied. If OpenClaw did not open, send it the prompt." : "Copied. If Hermes did not open, send it the prompt.")))))));
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function sometimesAgentOpening(s: Landing): boolean {
  return s.agentFollowed && s.status === "AgentOpening";
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function alwaysFollowedAgentHasLink(s: Landing): boolean {
  return !s.agentFollowed || tileKindFor(s.lastAgent) !== "CopyOnly";
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function alwaysNoDesktopAgentOnPhone(s: Landing): boolean {
  return !(s.agentFollowed && s.device === "Phone") || !desktopOnlyAgent(s.lastAgent);
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function toastFor(agent: AgentId): StatusLine {
  const local_0: TileKind = tileKindFor(agent);
  return local_0 === "OpensWithPrompt" ? "AgentOpening" : (local_0 === "OpensInstalledApp" ? "SendToAgentApp" : "PasteInAgent");
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function canChooseAgent(s: Landing, agent: AgentId): boolean {
  return tileShown(agent, s.mounted, s.device);
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function chooseAgent(s: Landing, agent: AgentId, copied: boolean): Landing {
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysCopyButtonNeedsScript(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysDeviceKnownOnlyWithScript(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysFollowedAgentHasLink(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysNoDesktopAgentOnPhone(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysAgentStatusNamesPressedAgent(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysLinkFollowedOnlyWithoutScript(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysFallbackNeedsScript(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysWaitOnlyWhereMessagesOpens(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> alwaysStatusNeedsScript(\result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> stepCopyLabelChangesOnlyByCopy(s, "chooseAgent", \result)
  //@ ensures (inv(s) && canChooseAgent(s, agent)) ==> stepMessagesFallbackShowsNumber(s, "chooseAgent", \result)
  const local_1 = tileKindFor(agent) !== "CopyOnly";
  return { ...s, agentFollowed: s.agentFollowed || local_1, lastAgent: local_1 ? agent : s.lastAgent, statusAgent: s.mounted ? agent : s.statusAgent, status: !s.mounted ? s.status : (copied ? toastFor(agent) : "CopyByHand") };
}

/** Story: Open my agent from its tile / A tile copies the prompt, opens its link, and the status line says what to do next (spec/landingEntry.md) */
//@ pure
export function alwaysAgentStatusNamesPressedAgent(s: Landing): boolean {
  return !(s.status === "AgentOpening" || s.status === "PasteInAgent" || s.status === "SendToAgentApp") || toastFor(s.statusAgent) === s.status;
}

/** Story: Start in Messages instead / The Messages entry writes `join <keyword>` to the shared line (spec/landingEntry.md) */
//@ pure
export function joinKeyword(app: brandIdentity_AppKey): string {
  return brandIdentity_brandFor(app).keyword;
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function messagesOpensHere(device: DeviceKind): boolean {
  return device === "Phone" || device === "MacDesktop";
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function messagesFallbackStatus(copied: boolean): StatusLine {
  return copied ? "MessageCopied" : "TextTheNumber";
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function canChooseMessages(s: Landing): boolean {
  return s.messages !== "MessagesWaiting";
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function alwaysLinkFollowedOnlyWithoutScript(s: Landing): boolean {
  return !(s.messages === "MessagesLinkFollowed") || !s.mounted;
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function alwaysFallbackNeedsScript(s: Landing): boolean {
  return !(s.messages === "MessagesFallback") || s.mounted;
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function messagesFallbackTemplate(copied: boolean): string {
  return messagesFallbackStatus(copied) === "MessageCopied" ? messageCopiedTemplate : textTheNumberTemplate;
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function chooseMessages(s: Landing, copied: boolean): Landing {
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysCopyButtonNeedsScript(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysDeviceKnownOnlyWithScript(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysFollowedAgentHasLink(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysNoDesktopAgentOnPhone(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysAgentStatusNamesPressedAgent(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysLinkFollowedOnlyWithoutScript(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysFallbackNeedsScript(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysWaitOnlyWhereMessagesOpens(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> alwaysStatusNeedsScript(\result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> stepCopyLabelChangesOnlyByCopy(s, "chooseMessages", \result)
  //@ ensures (inv(s) && canChooseMessages(s)) ==> stepMessagesFallbackShowsNumber(s, "chooseMessages", \result)
  return !s.mounted ? ({ ...s, messages: "MessagesLinkFollowed" } as Landing) : (!messagesOpensHere(s.device) ? ({ ...s, messages: "MessagesFallback", messageCopied: copied, status: messagesFallbackStatus(copied) } as Landing) : ({ ...s, messages: "MessagesWaiting", messageCopied: copied } as Landing));
}

/** Story: Start in Messages instead / The device decides whether the entry opens Messages or shows the number (spec/landingEntry.md) */
//@ pure
export function alwaysWaitOnlyWhereMessagesOpens(s: Landing): boolean {
  return !(s.messages === "MessagesWaiting" || s.messages === "MessagesOpened") || (s.mounted && messagesOpensHere(s.device));
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function canSettleMessages(s: Landing): boolean {
  return s.messages === "MessagesWaiting";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function stepMessagesFallbackShowsNumber(before: Landing, via: string, after: Landing): boolean {
  return !((via === "chooseMessages" || via === "settleMessages") && after.messages === "MessagesFallback") || (after.status === "MessageCopied" || after.status === "TextTheNumber");
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function leadsToMessagesSettled(s: Landing, later: Landing): boolean {
  return !(s.messages === "MessagesWaiting") || later.messages !== "MessagesWaiting";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function sometimesMessagesOpened(s: Landing): boolean {
  return s.messages === "MessagesOpened";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function sometimesMessageCopiedFallback(s: Landing): boolean {
  return s.messages === "MessagesFallback" && s.status === "MessageCopied";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function sometimesTextTheNumber(s: Landing): boolean {
  return s.status === "TextTheNumber";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function sometimesMessagesWithoutScript(s: Landing): boolean {
  return s.messages === "MessagesLinkFollowed";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function sometimesDesktopShowsNumberAtOnce(s: Landing): boolean {
  return s.messages === "MessagesFallback" && s.device === "OtherDesktop";
}

/** Story: Start in Messages instead / When Messages does not open in 1.5 seconds, the status line shows the number and the message (spec/landingEntry.md) */
//@ pure
export function settleMessages(s: Landing, pageLeft: boolean): Landing {
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysCopyButtonNeedsScript(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysDeviceKnownOnlyWithScript(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysFollowedAgentHasLink(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysNoDesktopAgentOnPhone(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysAgentStatusNamesPressedAgent(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysLinkFollowedOnlyWithoutScript(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysFallbackNeedsScript(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysWaitOnlyWhereMessagesOpens(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> alwaysStatusNeedsScript(\result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> stepCopyLabelChangesOnlyByCopy(s, "settleMessages", \result)
  //@ ensures (inv(s) && canSettleMessages(s)) ==> stepMessagesFallbackShowsNumber(s, "settleMessages", \result)
  return pageLeft ? ({ ...s, messages: "MessagesOpened" } as Landing) : ({ ...s, messages: "MessagesFallback", status: messagesFallbackStatus(s.messageCopied) } as Landing);
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function landingWordsAllowed(words: number): boolean {
  return words >= 0 && words < landingWordLimit;
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function landingHeadingsAllowed(headings: number): boolean {
  return headings === landingHeadingCount;
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function alwaysStatusNeedsScript(s: Landing): boolean {
  return !(!s.mounted) || s.status === "StatusEmpty";
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function landingShows(landingItem: LandingItem): boolean {
  return landingItems.includes(landingItem);
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function lawLandingHasNoAccountPortal(landingItem: LandingItem): boolean {
  //@ ensures \result === true
  return !(landingItem === "SignInItem" || landingItem === "SettingsItem" || landingItem === "DashboardItem") || !landingShows(landingItem);
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function lawLandingHasNoSafetyOrComplianceText(landingItem: LandingItem): boolean {
  //@ ensures \result === true
  return !(landingItem === "SafetyNoticeItem" || landingItem === "ComplianceItem" || landingItem === "ExplainerItem") || !landingShows(landingItem);
}

/** Story: See only what I need to start / The landing page shows the brand, the prompt, the agents, the Messages entry, the status line and two legal links (spec/landingEntry.md) */
//@ pure
export function lawLandingShowsEveryOtherItem(landingItem: LandingItem): boolean {
  //@ ensures \result === true
  return landingShows(landingItem) === !neverOnLanding.includes(landingItem);
}

/** Do the rules allow this event in this state? */
//@ pure
export function enabled(current: Landing, event: Event): boolean {
  if (event.type === "mount") return canMount(current, event.device);
  if (event.type === "pressCopy") return canPressCopy(current);
  if (event.type === "chooseAgent") return canChooseAgent(current, event.agent);
  if (event.type === "chooseMessages") return canChooseMessages(current);
  if (event.type === "settleMessages") return canSettleMessages(current);
  return false;
}

/** Apply an event. An event the rules do not allow leaves the state unchanged. */
//@ pure
export function step(current: Landing, event: Event): Landing {
  //@ requires inv(current)
  //@ ensures inv(\result)
  if (event.type === "mount") return canMount(current, event.device) ? mount(current, event.device) : current;
  if (event.type === "pressCopy") return canPressCopy(current) ? pressCopy(current, event.copied) : current;
  if (event.type === "chooseAgent") return canChooseAgent(current, event.agent) ? chooseAgent(current, event.agent, event.copied) : current;
  if (event.type === "chooseMessages") return canChooseMessages(current) ? chooseMessages(current, event.copied) : current;
  if (event.type === "settleMessages") return canSettleMessages(current) ? settleMessages(current, event.pageLeft) : current;
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
  if (raw.type === "mount" && (raw.device === "NotDetected" || raw.device === "Phone" || raw.device === "MacDesktop" || raw.device === "OtherDesktop")) return { type: "mount", device: raw.device };
  if (raw.type === "pressCopy" && typeof raw.copied === "boolean") return { type: "pressCopy", copied: raw.copied };
  if (raw.type === "chooseAgent" && (raw.agent === "ChatGpt" || raw.agent === "Claude" || raw.agent === "Grok" || raw.agent === "Muse" || raw.agent === "Gemini" || raw.agent === "Perplexity" || raw.agent === "Cursor" || raw.agent === "OpenClaw" || raw.agent === "Hermes") && typeof raw.copied === "boolean") return { type: "chooseAgent", agent: raw.agent, copied: raw.copied };
  if (raw.type === "chooseMessages" && typeof raw.copied === "boolean") return { type: "chooseMessages", copied: raw.copied };
  if (raw.type === "settleMessages" && typeof raw.pageLeft === "boolean") return { type: "settleMessages", pageLeft: raw.pageLeft };
  return undefined;
}

/**
 * Turn an untrusted value, such as a state loaded from storage, into a state, or undefined if it is not one. It must
 * have exactly the state's shape (no other fields, whole numbers that are safe integers, sets that hold nothing
 * twice, maps as records whose keys carry the "$" every key carries here) and satisfy every `always` rule. The
 * result is a fresh copy, so nothing the caller keeps can change it afterwards.
 */
//@ skip
export function parseState(x: unknown): Landing | undefined {
  let raw: any;
  try {
    raw = JSON.parse(JSON.stringify(x));
  } catch {
    return undefined;
  }
  if (!(typeof raw === "object" && raw !== null && !Array.isArray(raw) && typeof raw.mounted === "boolean" && (raw.device === "NotDetected" || raw.device === "Phone" || raw.device === "MacDesktop" || raw.device === "OtherDesktop") && (raw.copy === "CopyHidden" || raw.copy === "CopyReady" || raw.copy === "CopyCopied" || raw.copy === "CopySelected") && (raw.status === "StatusEmpty" || raw.status === "AgentOpening" || raw.status === "PasteInAgent" || raw.status === "SendToAgentApp" || raw.status === "CopyByHand" || raw.status === "MessageCopied" || raw.status === "TextTheNumber") && (raw.messages === "MessagesIdle" || raw.messages === "MessagesLinkFollowed" || raw.messages === "MessagesWaiting" || raw.messages === "MessagesOpened" || raw.messages === "MessagesFallback") && typeof raw.messageCopied === "boolean" && typeof raw.agentFollowed === "boolean" && (raw.lastAgent === "ChatGpt" || raw.lastAgent === "Claude" || raw.lastAgent === "Grok" || raw.lastAgent === "Muse" || raw.lastAgent === "Gemini" || raw.lastAgent === "Perplexity" || raw.lastAgent === "Cursor" || raw.lastAgent === "OpenClaw" || raw.lastAgent === "Hermes") && (raw.statusAgent === "ChatGpt" || raw.statusAgent === "Claude" || raw.statusAgent === "Grok" || raw.statusAgent === "Muse" || raw.statusAgent === "Gemini" || raw.statusAgent === "Perplexity" || raw.statusAgent === "Cursor" || raw.statusAgent === "OpenClaw" || raw.statusAgent === "Hermes") && Object.keys(raw).length === 9)) return undefined;
  const parsed: Landing = ({ mounted: raw.mounted, device: raw.device, copy: raw.copy, status: raw.status, messages: raw.messages, messageCopied: raw.messageCopied, agentFollowed: raw.agentFollowed, lastAgent: raw.lastAgent, statusAgent: raw.statusAgent });
  return inv(parsed) ? parsed : undefined;
}

/** Proof obligation: the initial state satisfies every `always` rule. */
export function initialHolds(): Landing {
  //@ ensures inv(\result)
  return initial;
}
