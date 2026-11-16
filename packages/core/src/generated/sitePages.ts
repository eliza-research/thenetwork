// GENERATED from spec/sitePages.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type JoinMode as brandIdentity_JoinMode, type AccentTokens as brandIdentity_AccentTokens, type Accent as brandIdentity_Accent, type Surface as brandIdentity_Surface, type AppKey as brandIdentity_AppKey, type SharedPart as brandIdentity_SharedPart, type LogoMark as brandIdentity_LogoMark, type Brand as brandIdentity_Brand, supportEmail as brandIdentity_supportEmail, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, accentTokens as brandIdentity_accentTokens, mayName as brandIdentity_mayName, siteUsesPart as brandIdentity_siteUsesPart, appKeys as brandIdentity_appKeys, brandFor as brandIdentity_brandFor, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, lawSitesShareParts as brandIdentity_lawSitesShareParts, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct } from "./brandIdentity.ts";

/** Story: Read the pages of the site / Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page (spec/sitePages.md:9) */
export type SitePage = "LandingPage" | "PrivacyPage" | "TermsPage" | "NotFoundPage" | "JoinPage";
/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md:38) */
export type SmsTermsItem = "SmsProgram" | "SmsOptIn" | "SmsFrequency" | "SmsStopEverything" | "SmsLeaveOne" | "SmsStartAgain" | "SmsHelp" | "SmsCosts" | "SmsNoMarketingShare";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
export type PathKind = "RootPath" | "PrivacyPath" | "TermsPath" | "JoinPath" | "SettingsPath" | "SkillPath" | "CatalogIndexPath" | "OwnCatalogSkillPath" | "OtherCatalogSkillPath" | "BackendPath" | "RobotsPath" | "UnknownPath";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
export type RequestMethod = "GetMethod" | "HeadMethod" | "OtherMethod";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
export type SiteRoute = "ServeLanding" | "ServePrivacy" | "ServeTerms" | "ServeJoin" | "ServeSkill" | "ServeCatalog" | "ServeRobots" | "ForwardToBackend" | "ServeNotFound" | "RefuseRetired" | "RedirectToLanding" | "RefuseMethod";
/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md:98) */
export interface SiteAnswer { status: number; noStore: boolean; hasBody: boolean; toLanding: boolean }
/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md:123) */
export type OptInWay = "OptInOnJoinPage" | "OptInInAgent" | "OptInByText";
/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md:189) */
export type SkillDoc = "RootSkill" | "CatalogIndex" | "CatalogSkill";

/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md:38) */
export const smsTermsAnchor: string = "sms";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
export const retiredSettingsPaths: string[] = ["/settings", "/settings/", "/settings.html"];
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
export const retiredJoinPaths: string[] = ["/join", "/join/", "/join.html"];
/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md:189) */
export const skillAllowOrigin: string = "*";
/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md:189) */
export const skillCacheSeconds: number = 300;
/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md:38) */
export const smsTermsItems: SmsTermsItem[] = ["SmsProgram", "SmsOptIn", "SmsFrequency", "SmsStopEverything", "SmsLeaveOne", "SmsStartAgain", "SmsHelp", "SmsCosts", "SmsNoMarketingShare"];
/** Story: Read the pages of the site / Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page (spec/sitePages.md:9) */
export const sitePageList: SitePage[] = ["LandingPage", "PrivacyPage", "TermsPage", "NotFoundPage", "JoinPage"];
/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md:27) */
export const footerLinks: SitePage[] = ["PrivacyPage", "TermsPage"];

/** Story: Read the pages of the site / Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page (spec/sitePages.md:9) */
//@ pure
export function keepsBrowserJoin(app: brandIdentity_AppKey): boolean {
  return brandIdentity_siteUsesPart(app, "PartJoinFlow");
}

/** Story: Read the pages of the site / Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page (spec/sitePages.md:9) */
//@ pure
export function siteHasPage(app: brandIdentity_AppKey, page: SitePage): boolean {
  return page !== "JoinPage" || keepsBrowserJoin(app);
}

/** Story: Read the pages of the site / Each site has a landing page, a privacy page, terms and a not-found page, and only peon.biz has a join page (spec/sitePages.md:9) */
//@ pure
export function lawJoinPageOnlyOnPeon(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return siteHasPage(app, "JoinPage") === (app === "Peon");
}

/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md:27) */
//@ pure
export function lawFooterLinksExistOnEverySite(app: brandIdentity_AppKey, page: SitePage): boolean {
  //@ ensures \result === true
  return !footerLinks.includes(page) || siteHasPage(app, page);
}

/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md:38) */
//@ pure
export function lawSmsTermsCoverStopAndLeave(termsItem: SmsTermsItem): boolean {
  //@ ensures \result === true
  return !(termsItem === "SmsStopEverything" || termsItem === "SmsLeaveOne") || smsTermsItems.includes(termsItem);
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
//@ pure
export function routeFor(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): SiteRoute {
  return path === "SettingsPath" ? "RefuseRetired" : (path === "JoinPath" && !keepsBrowserJoin(app) && method === "OtherMethod" ? "RefuseMethod" : (path === "JoinPath" && !keepsBrowserJoin(app) ? "RedirectToLanding" : (path === "BackendPath" ? "ForwardToBackend" : (path === "RootPath" ? "ServeLanding" : (path === "PrivacyPath" ? "ServePrivacy" : (path === "TermsPath" ? "ServeTerms" : (path === "JoinPath" ? "ServeJoin" : (path === "SkillPath" || path === "OwnCatalogSkillPath" ? "ServeSkill" : (path === "OtherCatalogSkillPath" && app === "Ntwrk" ? "ServeSkill" : (path === "CatalogIndexPath" ? "ServeCatalog" : (path === "RobotsPath" ? "ServeRobots" : "ServeNotFound")))))))))));
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
//@ pure
export function lawSettingsAreAlwaysRefused(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "SettingsPath", method) === "RefuseRetired";
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
//@ pure
export function lawJoinServesAFormOnlyWhereTheSiteKeepsIt(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return (routeFor(app, "JoinPath", method) === "ServeJoin") === keepsBrowserJoin(app);
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md:59) */
//@ pure
export function lawRetiredJoinReadsGoToLanding(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !(!keepsBrowserJoin(app) && method !== "OtherMethod") || routeFor(app, "JoinPath", method) === "RedirectToLanding";
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md:98) */
//@ pure
export function isRetiredRoute(route: SiteRoute): boolean {
  return route === "RefuseRetired" || route === "RedirectToLanding" || route === "RefuseMethod";
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md:98) */
//@ pure
export function answerFor(route: SiteRoute, method: RequestMethod): SiteAnswer {
  return route === "RefuseRetired" ? ({ status: 404, noStore: true, hasBody: method !== "HeadMethod", toLanding: false } as SiteAnswer) : (route === "RedirectToLanding" ? ({ status: 302, noStore: true, hasBody: false, toLanding: true } as SiteAnswer) : (route === "RefuseMethod" ? ({ status: 405, noStore: true, hasBody: false, toLanding: false } as SiteAnswer) : (route === "ForwardToBackend" ? ({ status: 0, noStore: false, hasBody: false, toLanding: false } as SiteAnswer) : (route === "ServeNotFound" ? ({ status: 404, noStore: false, hasBody: method !== "HeadMethod", toLanding: false } as SiteAnswer) : ({ status: 200, noStore: false, hasBody: method !== "HeadMethod", toLanding: false } as SiteAnswer)))));
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md:98) */
//@ pure
export function lawRetiredAnswersAreNeverCached(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !isRetiredRoute(routeFor(app, path, method)) || answerFor(routeFor(app, path, method), method).noStore;
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md:98) */
//@ pure
export function lawRetiredAnswersShowNoPage(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !isRetiredRoute(routeFor(app, path, method)) || answerFor(routeFor(app, path, method), method).status !== 200;
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md:123) */
//@ pure
export function optInWays(app: brandIdentity_AppKey): OptInWay[] {
  return keepsBrowserJoin(app) ? (["OptInOnJoinPage", "OptInByText"] as OptInWay[]) : (["OptInInAgent", "OptInByText"] as OptInWay[]);
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md:123) */
//@ pure
export function hasOptInWay(app: brandIdentity_AppKey, way: OptInWay): boolean {
  return optInWays(app).includes(way);
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md:123) */
//@ pure
export function mayLinkTo(app: brandIdentity_AppKey, path: PathKind): boolean {
  const local_0: SiteRoute = routeFor(app, path, "GetMethod");
  return !isRetiredRoute(local_0) && local_0 !== "ServeNotFound" && local_0 !== "ForwardToBackend";
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md:123) */
//@ pure
export function lawTermsAlwaysOfferText(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return hasOptInWay(app, "OptInByText");
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md:123) */
//@ pure
export function lawTermsNameOnlyAServedJoinPage(app: brandIdentity_AppKey, way: OptInWay): boolean {
  //@ ensures \result === true
  return !(way === "OptInOnJoinPage" && hasOptInWay(app, way)) || mayLinkTo(app, "JoinPath");
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md:145) */
//@ pure
export function servesPage(route: SiteRoute): boolean {
  return route === "ServeLanding" || route === "ServePrivacy" || route === "ServeTerms" || route === "ServeJoin" || route === "ServeNotFound";
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md:145) */
//@ pure
export function pageOfRoute(route: SiteRoute): SitePage {
  return route === "ServeLanding" ? "LandingPage" : (route === "ServePrivacy" ? "PrivacyPage" : (route === "ServeTerms" ? "TermsPage" : (route === "ServeJoin" ? "JoinPage" : "NotFoundPage")));
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md:145) */
//@ pure
export function lawUnknownPathsShowNotFound(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "UnknownPath", method) === "ServeNotFound";
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md:145) */
//@ pure
export function lawServedPagesExist(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  const local_1: SiteRoute = routeFor(app, path, method);
  return !servesPage(local_1) || siteHasPage(app, pageOfRoute(local_1));
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md:172) */
//@ pure
export function catalogListsSkillOf(site: brandIdentity_AppKey, owner: brandIdentity_AppKey): boolean {
  return brandIdentity_mayName(site, owner, "CatalogSurface");
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md:172) */
//@ pure
export function lawAppCatalogListsOnlyItself(site: brandIdentity_AppKey, owner: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return !(site !== "Ntwrk" && owner !== site) || !catalogListsSkillOf(site, owner);
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md:172) */
//@ pure
export function lawEveryCatalogListsItsOwnSkill(site: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return catalogListsSkillOf(site, site) && routeFor(site, "OwnCatalogSkillPath", method) === "ServeSkill";
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md:172) */
//@ pure
export function lawCatalogRouteFollowsListing(site: brandIdentity_AppKey, owner: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !(owner !== site) || (routeFor(site, "OtherCatalogSkillPath", method) === "ServeSkill") === catalogListsSkillOf(site, owner);
}

/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md:189) */
//@ pure
export function skillContentType(doc: SkillDoc): string {
  return doc === "CatalogIndex" ? "application/json" : "text/plain; charset=utf-8";
}

/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md:189) */
//@ pure
export function lawSkillTextIsPlainText(doc: SkillDoc): boolean {
  //@ ensures \result === true
  return !(doc !== "CatalogIndex") || skillContentType(doc) === "text/plain; charset=utf-8";
}

/** Story: Let my agent read the signup skill from the site / Backend paths go to the shared backend (spec/sitePages.md:206) */
//@ pure
export function lawBackendPathsAreForwarded(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "BackendPath", method) === "ForwardToBackend";
}

/** Story: Let my agent read the signup skill from the site / Backend paths go to the shared backend (spec/sitePages.md:206) */
//@ pure
export function lawRetiredPathsNeverReachTheBackend(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "SettingsPath", method) !== "ForwardToBackend" && routeFor(app, "JoinPath", method) !== "ForwardToBackend";
}
