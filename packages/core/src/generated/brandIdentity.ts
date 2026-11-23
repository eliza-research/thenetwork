// GENERATED from spec/brandIdentity.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny

/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export type JoinMode = "InviteOnly" | "OpenJoin";
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export type Accent = "Black" | "Chartreuse" | "Orange" | "Green";
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export type AppKey = "Ntwrk" | "Slop" | "Peon" | "Friends";
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export type LogoMark = "GraphMark" | "HeartMark" | "NecktieMark" | "TwoCirclesMark";
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export interface Brand { app: AppKey; name: string; domain: string; keyword: string; joinMode: JoinMode; accent: Accent; logo: LogoMark; headlineLead: string; headlineMark: string; headlineTail: string; skillName: string }
/** Story: Know which app I am joining / Each accent has one color for light mode and one for dark mode (spec/brandIdentity.md) */
export interface AccentTokens { light: string; lightInk: string; dark: string; darkInk: string }
/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
export type Surface = "LandingSurface" | "LegalSurface" | "NotFoundSurface" | "JoinSurface" | "SkillSurface" | "CatalogSurface";
/** Story: One component set for every brand / Every site uses the same parts, and only peon.biz adds the browser join flow (spec/brandIdentity.md) */
export type SharedPart = "PartMark" | "PartHeadline" | "PartPrompt" | "PartAgentRow" | "PartMessages" | "PartStatus" | "PartFooter" | "PartLegalText" | "PartNotFound" | "PartJoinFlow";
/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
export type StateColor = "OkColor" | "WarnColor" | "InfoColor" | "DestructiveColor";
/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
export type MarkFill = "PrimaryFill" | "BackgroundFill";
/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
export type ColorScheme = "LightScheme" | "DarkScheme";

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
export const supportEmail: string = "help@ntwrk.party";
/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
export const agentAccessPage: string = "https://ntwrk.party/oauth/consents";
/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
export const nearColorFloorPermille: number = 100;
/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
export const inverseTextContrastFloorTenths: number = 45;
/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
export const inverseEdgeContrastFloorTenths: number = 30;
/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
export const colorSchemes: ColorScheme[] = ["LightScheme", "DarkScheme"];
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const joinModes: JoinMode[] = ["InviteOnly", "OpenJoin"];
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const accents: Accent[] = ["Black", "Chartreuse", "Orange", "Green"];
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const logoMarks: LogoMark[] = ["GraphMark", "HeartMark", "NecktieMark", "TwoCirclesMark"];
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const ntwrkBrand: Brand = { app: "Ntwrk", name: "The Network", domain: "ntwrk.party", keyword: "network", joinMode: "InviteOnly", accent: "Black", logo: "GraphMark", headlineLead: "Build your ", headlineMark: "network", headlineTail: ".", skillName: "ntwrk-party" };
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const slopBrand: Brand = { app: "Slop", name: "slop.date", domain: "slop.date", keyword: "slop", joinMode: "OpenJoin", accent: "Chartreuse", logo: "HeartMark", headlineLead: "Let your agent find you the perfect ", headlineMark: "date", headlineTail: ".", skillName: "slop-date" };
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const peonBrand: Brand = { app: "Peon", name: "peon.biz", domain: "peon.biz", keyword: "peon", joinMode: "OpenJoin", accent: "Orange", logo: "NecktieMark", headlineLead: "Let your agent find you the perfect ", headlineMark: "job", headlineTail: ".", skillName: "peon-biz" };
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const friendsBrand: Brand = { app: "Friends", name: "friends.help", domain: "friends.help", keyword: "friends", joinMode: "OpenJoin", accent: "Green", logo: "TwoCirclesMark", headlineLead: "Let your agent find your best ", headlineMark: "friends", headlineTail: ".", skillName: "friends-help" };
/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
export const stateColors: StateColor[] = ["OkColor", "WarnColor", "InfoColor", "DestructiveColor"];
/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
export const appKeys: AppKey[] = ["Ntwrk", "Slop", "Peon", "Friends"];

/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
//@ pure
export function brandFor(app: AppKey): Brand {
  return app === "Ntwrk" ? ntwrkBrand : (app === "Slop" ? slopBrand : (app === "Peon" ? peonBrand : friendsBrand));
}

/** Story: Know which app I am joining / Each site has one brand record with its name, domain, app, keyword, join mode, accent, logo and headline (spec/brandIdentity.md) */
//@ pure
export function lawBrandNamesItsApp(app: AppKey): boolean {
  //@ ensures \result === true
  return brandFor(app).app === app;
}

/** Story: Know which app I am joining / Two sites never share a name, domain, keyword, accent, logo or skill (spec/brandIdentity.md) */
//@ pure
export function lawBrandsAreDistinct(a: AppKey, b: AppKey): boolean {
  //@ ensures \result === true
  const local_0: Brand = brandFor(a);
  const local_1: Brand = brandFor(b);
  return !(a !== b) || (local_0.name !== local_1.name && local_0.domain !== local_1.domain && local_0.keyword !== local_1.keyword && local_0.accent !== local_1.accent && local_0.logo !== local_1.logo && local_0.skillName !== local_1.skillName);
}

/** Story: Know which app I am joining / Each app has one design-system brand (spec/brandIdentity.md) */
//@ pure
export function designBrandId(app: AppKey): string {
  return app === "Ntwrk" ? "network" : (app === "Slop" ? "slop" : (app === "Peon" ? "peon" : "friends"));
}

/** Story: Know which app I am joining / Each app has one design-system brand (spec/brandIdentity.md) */
//@ pure
export function lawDesignBrandIdsAreDistinct(a: AppKey, b: AppKey): boolean {
  //@ ensures \result === true
  return !(a !== b) || designBrandId(a) !== designBrandId(b);
}

/** Story: Know which app I am joining / Only The Network asks for an invitation (spec/brandIdentity.md) */
//@ pure
export function lawOnlyTheNetworkIsInviteOnly(app: AppKey): boolean {
  //@ ensures \result === true
  return (brandFor(app).joinMode === "InviteOnly") === (app === "Ntwrk");
}

/** Story: Know which app I am joining / Each accent has one color for light mode and one for dark mode (spec/brandIdentity.md) */
//@ pure
export function accentTokens(accent: Accent): AccentTokens {
  return accent === "Black" ? ({ light: "oklch(0.16 0 0)", lightInk: "oklch(0.985 0 0)", dark: "oklch(0.96 0 0)", darkInk: "oklch(0.15 0 0)" } as AccentTokens) : (accent === "Chartreuse" ? ({ light: "oklch(0.2 0.04 118)", lightInk: "oklch(0.91 0.2 118)", dark: "oklch(0.91 0.2 118)", darkInk: "oklch(0.2 0.04 118)" } as AccentTokens) : (accent === "Orange" ? ({ light: "oklch(0.2 0.04 62)", lightInk: "oklch(0.78 0.16 62)", dark: "oklch(0.78 0.16 62)", darkInk: "oklch(0.2 0.04 62)" } as AccentTokens) : ({ light: "oklch(0.5 0.13 150)", lightInk: "oklch(0.985 0 0)", dark: "oklch(0.72 0.17 150)", darkInk: "oklch(0.17 0.04 150)" } as AccentTokens)));
}

/** Story: Know which app I am joining / Each accent has one color for light mode and one for dark mode (spec/brandIdentity.md) */
//@ pure
export function lawAccentInkDiffersFromAccent(accent: Accent): boolean {
  //@ ensures \result === true
  const local_2: AccentTokens = accentTokens(accent);
  return local_2.light !== local_2.lightInk && local_2.dark !== local_2.darkInk;
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function connectorEndpoint(app: AppKey): string {
  return app === "Ntwrk" ? "https://ntwrk.party/mcp" : (app === "Slop" ? "https://ntwrk.party/mcp/slop" : (app === "Peon" ? "https://ntwrk.party/mcp/peon" : "https://ntwrk.party/mcp/friends"));
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function openaiConnectorEndpoint(app: AppKey): string {
  return app === "Ntwrk" ? "https://ntwrk.party/mcp/openai" : (app === "Slop" ? "https://ntwrk.party/mcp/slop/openai" : (app === "Peon" ? "https://ntwrk.party/mcp/peon/openai" : "https://ntwrk.party/mcp/friends/openai"));
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function mayName(site: AppKey, named: AppKey, surface: Surface): boolean {
  return site === named || (site === "Ntwrk" && (surface === "LegalSurface" || surface === "CatalogSurface"));
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function hubTextsOnAppSurface(site: AppKey, surface: Surface): string[] {
  return surface === "SkillSurface" ? ([supportEmail, agentAccessPage, openaiConnectorEndpoint(site), connectorEndpoint(site)] as string[]) : ([supportEmail] as string[]);
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function lawAppEndpointsAreDistinct(a: AppKey, b: AppKey): boolean {
  //@ ensures \result === true
  return !(a !== b) || (connectorEndpoint(a) !== connectorEndpoint(b) && openaiConnectorEndpoint(a) !== openaiConnectorEndpoint(b) && connectorEndpoint(a) !== openaiConnectorEndpoint(b));
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function lawAppSiteNeverNamesTheNetwork(site: AppKey, surface: Surface): boolean {
  //@ ensures \result === true
  return !(site !== "Ntwrk") || !mayName(site, "Ntwrk", surface);
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function lawAppSiteNamesNoOtherApp(site: AppKey, named: AppKey, surface: Surface): boolean {
  //@ ensures \result === true
  return !(site !== "Ntwrk" && named !== site) || !mayName(site, named, surface);
}

/** Story: Each site keeps its own brand / An app site never names The Network or another app (spec/brandIdentity.md) */
//@ pure
export function lawOnlyTheSkillNamesTheEndpoint(site: AppKey, surface: Surface): boolean {
  //@ ensures \result === true
  return !(surface !== "SkillSurface") || equal_brandIdentity(hubTextsOnAppSurface(site, surface), ([supportEmail] as string[]));
}

/** Story: Each site keeps its own brand / ntwrk.party names no app on its landing page, its not-found page or its own skill (spec/brandIdentity.md) */
//@ pure
export function lawHubLandingNamesNoApp(named: AppKey, surface: Surface): boolean {
  //@ ensures \result === true
  return !(named !== "Ntwrk" && surface !== "LegalSurface" && surface !== "CatalogSurface") || !mayName("Ntwrk", named, surface);
}

/** Story: One component set for every brand / Every site uses the same parts, and only peon.biz adds the browser join flow (spec/brandIdentity.md) */
//@ pure
export function siteUsesPart(app: AppKey, part: SharedPart): boolean {
  return part !== "PartJoinFlow" || app === "Peon";
}

/** Story: One component set for every brand / Every site uses the same parts, and only peon.biz adds the browser join flow (spec/brandIdentity.md) */
//@ pure
export function lawSitesShareParts(a: AppKey, b: AppKey, part: SharedPart): boolean {
  //@ ensures \result === true
  return !(siteUsesPart(a, part) !== siteUsesPart(b, part)) || (part === "PartJoinFlow" && (a === "Peon" || b === "Peon"));
}

/** Story: One component set for every brand / Every site uses the same parts, and only peon.biz adds the browser join flow (spec/brandIdentity.md) */
//@ pure
export function partTokens(app: AppKey, part: SharedPart): AccentTokens {
  return accentTokens(brandFor(app).accent);
}

/** Story: One component set for every brand / Every site uses the same parts, and only peon.biz adds the browser join flow (spec/brandIdentity.md) */
//@ pure
export function lawPartsTakeTheBrandTokens(app: AppKey, part: SharedPart, other: SharedPart): boolean {
  //@ ensures \result === true
  return equal_brandIdentity(partTokens(app, part), partTokens(app, other)) && equal_brandIdentity(partTokens(app, part), accentTokens(brandFor(app).accent));
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function ringIsTheAccent(ring: string, primary: string): boolean {
  return ring === primary;
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function colorIsClearOfAccent(distancePermille: number): boolean {
  return distancePermille >= nearColorFloorPermille;
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function inverseIsReadable(textContrastTenths: number, edgeContrastTenths: number): boolean {
  return textContrastTenths >= inverseTextContrastFloorTenths && edgeContrastTenths >= inverseEdgeContrastFloorTenths;
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function stateToken(color: StateColor): string {
  return color === "OkColor" ? "ok" : (color === "WarnColor" ? "warn" : (color === "InfoColor" ? "info" : "destructive"));
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function hoverFillIsClear(distancePermille: number, sameHue: boolean): boolean {
  return sameHue && colorIsClearOfAccent(distancePermille);
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function lawRingEqualsTheAccent(color: string): boolean {
  //@ ensures \result === true
  return ringIsTheAccent(color, color);
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function lawInverseNeedsBothContrasts(textContrastTenths: number, edgeContrastTenths: number): boolean {
  //@ ensures \result === true
  return !inverseIsReadable(textContrastTenths, edgeContrastTenths) || (textContrastTenths >= 45 && edgeContrastTenths >= 30);
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function lawTheAccentIsNeverClearOfItself(sameHue: boolean): boolean {
  //@ ensures \result === true
  return !colorIsClearOfAccent(0) && !hoverFillIsClear(0, sameHue);
}

/** Story: One component set for every brand / The focus ring, the hover fill, the state colors and the inverse surface obey fixed color rules (spec/brandIdentity.md) */
//@ pure
export function lawStateTokensAreDistinct(a: StateColor, b: StateColor): boolean {
  //@ ensures \result === true
  return !(a !== b) || stateToken(a) !== stateToken(b);
}

/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
//@ pure
export function markTileFill(logo: LogoMark): MarkFill {
  return logo === "TwoCirclesMark" ? "BackgroundFill" : "PrimaryFill";
}

/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
//@ pure
export function faviconMedia(scheme: ColorScheme): string {
  return scheme === "LightScheme" ? "" : "(prefers-color-scheme: dark)";
}

/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
//@ pure
export function lawOnlyTheTwoCirclesTileTakesThePageColor(logo: LogoMark): boolean {
  //@ ensures \result === true
  return (markTileFill(logo) === "BackgroundFill") === (logo === "TwoCirclesMark");
}

/** Story: One component set for every brand / The logo and the favicon take only tokens, and the favicon has one variant for each color scheme (spec/brandIdentity.md) */
//@ pure
export function lawLightFaviconHasNoCondition(scheme: ColorScheme): boolean {
  //@ ensures \result === true
  return (faviconMedia(scheme) === "") === (scheme === "LightScheme");
}

/** Equality by structure, as Quint and the proof compare records, lists, maps and variants (none holds a set). */
export function equal_brandIdentity(a: unknown, b: unknown): boolean {
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return a === b;
  const keys = Object.keys(a);
  return Array.isArray(a) === Array.isArray(b) && keys.length === Object.keys(b).length
    && keys.every((k) => Object.hasOwn(b, k) && equal_brandIdentity((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
