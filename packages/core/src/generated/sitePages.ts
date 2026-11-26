// GENERATED from spec/sitePages.md by vibestack/spec.ts. Do not edit: change the spec and run `pnpm gen`.
//@ backend dafny
import { type AppKey as brandIdentity_AppKey, type JoinMode as brandIdentity_JoinMode, type Accent as brandIdentity_Accent, type LogoMark as brandIdentity_LogoMark, type Brand as brandIdentity_Brand, type AccentTokens as brandIdentity_AccentTokens, type Surface as brandIdentity_Surface, type SharedPart as brandIdentity_SharedPart, type StateColor as brandIdentity_StateColor, type MarkFill as brandIdentity_MarkFill, type ColorScheme as brandIdentity_ColorScheme, appKeys as brandIdentity_appKeys, joinModes as brandIdentity_joinModes, accents as brandIdentity_accents, logoMarks as brandIdentity_logoMarks, ntwrkBrand as brandIdentity_ntwrkBrand, slopBrand as brandIdentity_slopBrand, peonBrand as brandIdentity_peonBrand, friendsBrand as brandIdentity_friendsBrand, brandFor as brandIdentity_brandFor, lawBrandNamesItsApp as brandIdentity_lawBrandNamesItsApp, lawBrandsAreDistinct as brandIdentity_lawBrandsAreDistinct, designBrandId as brandIdentity_designBrandId, lawDesignBrandIdsAreDistinct as brandIdentity_lawDesignBrandIdsAreDistinct, lawOnlyTheNetworkIsInviteOnly as brandIdentity_lawOnlyTheNetworkIsInviteOnly, accentTokens as brandIdentity_accentTokens, lawAccentInkDiffersFromAccent as brandIdentity_lawAccentInkDiffersFromAccent, supportEmail as brandIdentity_supportEmail, agentAccessPage as brandIdentity_agentAccessPage, connectorEndpoint as brandIdentity_connectorEndpoint, openaiConnectorEndpoint as brandIdentity_openaiConnectorEndpoint, hubTextsOnAppSurface as brandIdentity_hubTextsOnAppSurface, lawAppEndpointsAreDistinct as brandIdentity_lawAppEndpointsAreDistinct, lawOnlyTheSkillNamesTheEndpoint as brandIdentity_lawOnlyTheSkillNamesTheEndpoint, mayName as brandIdentity_mayName, lawAppSiteNeverNamesTheNetwork as brandIdentity_lawAppSiteNeverNamesTheNetwork, lawAppSiteNamesNoOtherApp as brandIdentity_lawAppSiteNamesNoOtherApp, lawHubLandingNamesNoApp as brandIdentity_lawHubLandingNamesNoApp, siteUsesPart as brandIdentity_siteUsesPart, lawSitesShareParts as brandIdentity_lawSitesShareParts, partTokens as brandIdentity_partTokens, lawPartsTakeTheBrandTokens as brandIdentity_lawPartsTakeTheBrandTokens, stateColors as brandIdentity_stateColors, stateToken as brandIdentity_stateToken, nearColorFloorPermille as brandIdentity_nearColorFloorPermille, inverseTextContrastFloorTenths as brandIdentity_inverseTextContrastFloorTenths, inverseEdgeContrastFloorTenths as brandIdentity_inverseEdgeContrastFloorTenths, ringIsTheAccent as brandIdentity_ringIsTheAccent, colorIsClearOfAccent as brandIdentity_colorIsClearOfAccent, hoverFillIsClear as brandIdentity_hoverFillIsClear, inverseIsReadable as brandIdentity_inverseIsReadable, lawRingEqualsTheAccent as brandIdentity_lawRingEqualsTheAccent, lawTheAccentIsNeverClearOfItself as brandIdentity_lawTheAccentIsNeverClearOfItself, lawStateTokensAreDistinct as brandIdentity_lawStateTokensAreDistinct, lawInverseNeedsBothContrasts as brandIdentity_lawInverseNeedsBothContrasts, colorSchemes as brandIdentity_colorSchemes, markTileFill as brandIdentity_markTileFill, faviconMedia as brandIdentity_faviconMedia, lawOnlyTheTwoCirclesTileTakesThePageColor as brandIdentity_lawOnlyTheTwoCirclesTileTakesThePageColor, lawLightFaviconHasNoCondition as brandIdentity_lawLightFaviconHasNoCondition } from "./brandIdentity.ts";
import { type OneStepKind as oneStepPage_OneStepKind, type StepNotice as oneStepPage_StepNotice, type StepSession as oneStepPage_StepSession, type CloudReturn as oneStepPage_CloudReturn, type SignInAuth as oneStepPage_SignInAuth, type SignInStage as oneStepPage_SignInStage, type SignInPending as oneStepPage_SignInPending, type SignInCheck as oneStepPage_SignInCheck, type SignInError as oneStepPage_SignInError, type StepSignIn as oneStepPage_StepSignIn, type SignInLookup as oneStepPage_SignInLookup, type SignInAnswer as oneStepPage_SignInAnswer, type SignInAttemptKind as oneStepPage_SignInAttemptKind, type SignInAttempt as oneStepPage_SignInAttempt, oneStepIsPhoto as oneStepPage_oneStepIsPhoto, oneStepOnSite as oneStepPage_oneStepOnSite, lawPhotoUploadOnlyOnSlop as oneStepPage_lawPhotoUploadOnlyOnSlop, lawPhotoStepsOnlyOnSlop as oneStepPage_lawPhotoStepsOnlyOnSlop, lawHomeHelpOnlyOnHub as oneStepPage_lawHomeHelpOnlyOnHub, lawPhoneChangeOnEverySite as oneStepPage_lawPhoneChangeOnEverySite, photoPagePurposeHeader as oneStepPage_photoPagePurposeHeader, photoPagePurpose as oneStepPage_photoPagePurpose, lawOnlyPhotoLinkPagesNameAPurpose as oneStepPage_lawOnlyPhotoLinkPagesNameAPurpose, oneStepNeedsSignIn as oneStepPage_oneStepNeedsSignIn, oneStepLinkInFragment as oneStepPage_oneStepLinkInFragment, oneStepLinkMayBeKept as oneStepPage_oneStepLinkMayBeKept, lawPhotoTokenIsNeverKept as oneStepPage_lawPhotoTokenIsNeverKept, lawKeptLinkIsInTheFragment as oneStepPage_lawKeptLinkIsInTheFragment, oneStepNoticeShown as oneStepPage_oneStepNoticeShown, noticeForSession as oneStepPage_noticeForSession, lawSignedInHasNoNotice as oneStepPage_lawSignedInHasNoNotice, noticeForCloudReturn as oneStepPage_noticeForCloudReturn, noticeOnOpen as oneStepPage_noticeOnOpen, lawEveryCloudErrorShowsANotice as oneStepPage_lawEveryCloudErrorShowsANotice, lawSessionHidesTheCloudError as oneStepPage_lawSessionHidesTheCloudError, retryMinutesShown as oneStepPage_retryMinutesShown, lawRetryIsAtLeastOneMinute as oneStepPage_lawRetryIsAtLeastOneMinute, lawRetryIsNeverShorterThanTheWait as oneStepPage_lawRetryIsNeverShorterThanTheWait, signInStart as oneStepPage_signInStart, signInAttemptNone as oneStepPage_signInAttemptNone, signInAuthFor as oneStepPage_signInAuthFor, signInCheckFor as oneStepPage_signInCheckFor, signInShowsNumberForm as oneStepPage_signInShowsNumberForm, signInShowsCloudButton as oneStepPage_signInShowsCloudButton, signInWaiting as oneStepPage_signInWaiting, lawOnlyCloudLookupUsesCloud as oneStepPage_lawOnlyCloudLookupUsesCloud, lawCheckOnlyWithTextCodes as oneStepPage_lawCheckOnlyWithTextCodes, signInAttemptAllowed as oneStepPage_signInAttemptAllowed, signInBusy as oneStepPage_signInBusy, signInCodeAccepted as oneStepPage_signInCodeAccepted, signInSpent as oneStepPage_signInSpent, signInStartError as oneStepPage_signInStartError, signInSettledError as oneStepPage_signInSettledError, signInMove as oneStepPage_signInMove, lawCodeNeedsFourToEightDigits as oneStepPage_lawCodeNeedsFourToEightDigits, lawInvalidNumberIsNeverSent as oneStepPage_lawInvalidNumberIsNeverSent, lawEveryStartAnswerSpendsTheCheck as oneStepPage_lawEveryStartAnswerSpendsTheCheck, lawShortCodeIsNeverSent as oneStepPage_lawShortCodeIsNeverSent, signInAgain as oneStepPage_signInAgain, lawSignInAgainKeepsTheMode as oneStepPage_lawSignInAgainKeepsTheMode, signInConsistent as oneStepPage_signInConsistent, lawEveryAllowedMoveStaysConsistent as oneStepPage_lawEveryAllowedMoveStaysConsistent, lawSignInAgainIsConsistent as oneStepPage_lawSignInAgainIsConsistent } from "./oneStepPage.ts";

/** Story: Read the pages of the site / Every site serves public pages and each special page has one site (spec/sitePages.md) */
export type SitePage = "LandingPage" | "PrivacyPage" | "TermsPage" | "NotFoundPage" | "JoinPage" | "UpdateHandoffPage" | "PhonePage" | "HomeHelpPage" | "PhotosAddPage" | "PhotosCheckPage" | "PhotosMinePage" | "PhotosViewPage";
/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md) */
export type SmsTermsItem = "SmsProgram" | "SmsOptIn" | "SmsFrequency" | "SmsStopEverything" | "SmsLeaveOne" | "SmsStartAgain" | "SmsHelp" | "SmsCosts" | "SmsNoMarketingShare";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
export type PathKind = "RootPath" | "PrivacyPath" | "TermsPath" | "JoinPath" | "SettingsPath" | "SkillPath" | "CatalogIndexPath" | "OwnCatalogSkillPath" | "OtherCatalogSkillPath" | "BackendPath" | "RobotsPath" | "UpdateHandoffPath" | "MalformedUpdateHandoffPath" | "PhonePath" | "HomeHelpPath" | "PhotosAddPath" | "PhotosCheckPath" | "PhotosMinePath" | "PhotosViewPath" | "UnknownPath";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
export type RequestMethod = "GetMethod" | "HeadMethod" | "OtherMethod";
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
export type SiteRoute = "ServeLanding" | "ServePrivacy" | "ServeTerms" | "ServeJoin" | "ServeSkill" | "ServeCatalog" | "ServeRobots" | "ServeUpdateHandoff" | "RefuseUpdateHandoff" | "RefuseUpdateMethod" | "ForwardToBackend" | "ServeNotFound" | "RefuseRetired" | "RedirectToLanding" | "RefuseMethod" | "ServePhone" | "ServeHomeHelp" | "ServePhotosAdd" | "ServePhotosCheck" | "ServePhotosMine" | "ServePhotosView";
/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
export interface SiteAnswer { status: number; noStore: boolean; hasBody: boolean; toLanding: boolean; allowHeader: string }
/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md) */
export type OptInWay = "OptInOnJoinPage" | "OptInInAgent" | "OptInByText";
/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md) */
export type SkillDoc = "RootSkill" | "CatalogIndex" | "CatalogSkill";

/** Story: Read the pages of the site / Every site serves public pages and each special page has one site (spec/sitePages.md) */
export const sitePageList: SitePage[] = ["LandingPage", "PrivacyPage", "TermsPage", "NotFoundPage", "JoinPage", "UpdateHandoffPage", "PhonePage", "HomeHelpPage", "PhotosAddPage", "PhotosCheckPage", "PhotosMinePage", "PhotosViewPage"];
/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md) */
export const footerLinks: SitePage[] = ["PrivacyPage", "TermsPage"];
/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md) */
export const smsTermsAnchor: string = "sms";
/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md) */
export const smsTermsItems: SmsTermsItem[] = ["SmsProgram", "SmsOptIn", "SmsFrequency", "SmsStopEverything", "SmsLeaveOne", "SmsStartAgain", "SmsHelp", "SmsCosts", "SmsNoMarketingShare"];
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
export const retiredSettingsPaths: string[] = ["/settings", "/settings/", "/settings.html"];
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
export const retiredJoinPaths: string[] = ["/join", "/join/", "/join.html"];
/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
export const updateHandoffAssetPath: string = "/_update-handoff";
/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
export const siteReadOnlyMethods: string = "GET, HEAD";
/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md) */
export const skillAllowOrigin: string = "*";
/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md) */
export const skillCacheSeconds: number = 300;

/** Story: Read the pages of the site / Every site serves public pages and each special page has one site (spec/sitePages.md) */
//@ pure
export function keepsBrowserJoin(app: brandIdentity_AppKey): boolean {
  return brandIdentity_siteUsesPart(app, "PartJoinFlow");
}

/** Story: Read the pages of the site / Every site serves public pages and each special page has one site (spec/sitePages.md) */
//@ pure
export function siteHasPage(app: brandIdentity_AppKey, page: SitePage): boolean {
  return page === "JoinPage" ? keepsBrowserJoin(app) : (page === "UpdateHandoffPage" ? app === "Ntwrk" : (page === "PhonePage" ? oneStepPage_oneStepOnSite("StepPhone", app) : (page === "HomeHelpPage" ? oneStepPage_oneStepOnSite("StepHomeHelp", app) : (page === "PhotosAddPage" ? oneStepPage_oneStepOnSite("StepPhotoUpload", app) : (page === "PhotosCheckPage" ? oneStepPage_oneStepOnSite("StepPhotoCheck", app) : (page === "PhotosMinePage" ? oneStepPage_oneStepOnSite("StepPhotoMine", app) : (page === "PhotosViewPage" ? oneStepPage_oneStepOnSite("StepPhotoView", app) : true)))))));
}

/** Story: Read the pages of the site / Every site serves public pages and each special page has one site (spec/sitePages.md) */
//@ pure
export function lawJoinPageOnlyOnPeon(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return siteHasPage(app, "JoinPage") === (app === "Peon");
}

/** Story: Read the pages of the site / Each one-step page is on the sites that can do its step (spec/sitePages.md) */
//@ pure
export function oneStepKindOf(page: SitePage): oneStepPage_OneStepKind {
  return page === "HomeHelpPage" ? "StepHomeHelp" : (page === "PhotosAddPage" ? "StepPhotoUpload" : (page === "PhotosCheckPage" ? "StepPhotoCheck" : (page === "PhotosMinePage" ? "StepPhotoMine" : (page === "PhotosViewPage" ? "StepPhotoView" : "StepPhone"))));
}

/** Story: Read the pages of the site / Each one-step page is on the sites that can do its step (spec/sitePages.md) */
//@ pure
export function isOneStepPage(page: SitePage): boolean {
  return page === "PhonePage" || page === "HomeHelpPage" || page === "PhotosAddPage" || page === "PhotosCheckPage" || page === "PhotosMinePage" || page === "PhotosViewPage";
}

/** Story: Read the pages of the site / Each one-step page is on the sites that can do its step (spec/sitePages.md) */
//@ pure
export function lawPhotoPagesOnlyOnSlop(app: brandIdentity_AppKey, page: SitePage): boolean {
  //@ ensures \result === true
  return !(isOneStepPage(page) && oneStepPage_oneStepIsPhoto(oneStepKindOf(page))) || siteHasPage(app, page) === (app === "Slop");
}

/** Story: Read the pages of the site / Each one-step page is on the sites that can do its step (spec/sitePages.md) */
//@ pure
export function lawOneStepPagesFollowTheirStep(app: brandIdentity_AppKey, page: SitePage): boolean {
  //@ ensures \result === true
  return !isOneStepPage(page) || siteHasPage(app, page) === oneStepPage_oneStepOnSite(oneStepKindOf(page), app);
}

/** Story: Read the pages of the site / Each one-step page is on the sites that can do its step (spec/sitePages.md) */
//@ pure
export function lawPhonePageOnEverySite(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return siteHasPage(app, "PhonePage");
}

/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md) */
//@ pure
export function footerOf(page: SitePage): SitePage[] {
  return footerLinks;
}

/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md) */
//@ pure
export function lawEveryFooterIsPrivacyThenTerms(app: brandIdentity_AppKey, page: SitePage): boolean {
  //@ ensures \result === true
  return !siteHasPage(app, page) || (footerOf(page).length === 2 && (0 <= 0 && 0 < footerOf(page).length ? footerOf(page)[0] : "NotFoundPage") === "PrivacyPage" && (0 <= 1 && 1 < footerOf(page).length ? footerOf(page)[1] : "NotFoundPage") === "TermsPage");
}

/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md) */
//@ pure
export function lawLandingFooterHasNoOtherLink(otherPage: SitePage): boolean {
  //@ ensures \result === true
  return !footerOf("LandingPage").includes(otherPage) || (otherPage === "PrivacyPage" || otherPage === "TermsPage");
}

/** Story: Read the pages of the site / Every page links the privacy policy and the terms in its footer (spec/sitePages.md) */
//@ pure
export function lawFooterLinksExistOnEverySite(app: brandIdentity_AppKey, page: SitePage): boolean {
  //@ ensures \result === true
  return !footerLinks.includes(page) || siteHasPage(app, page);
}

/** Story: Read the pages of the site / The terms page has a text messaging section that a link can open (spec/sitePages.md) */
//@ pure
export function lawSmsTermsCoverStopAndLeave(termsItem: SmsTermsItem): boolean {
  //@ ensures \result === true
  return !(termsItem === "SmsStopEverything" || termsItem === "SmsLeaveOne") || smsTermsItems.includes(termsItem);
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
//@ pure
export function routeFor(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): SiteRoute {
  return path === "SettingsPath" ? "RefuseRetired" : (path === "JoinPath" && !keepsBrowserJoin(app) && method === "OtherMethod" ? "RefuseMethod" : (path === "JoinPath" && !keepsBrowserJoin(app) ? "RedirectToLanding" : (path === "MalformedUpdateHandoffPath" || (path === "UpdateHandoffPath" && !siteHasPage(app, "UpdateHandoffPage")) ? "RefuseUpdateHandoff" : (path === "UpdateHandoffPath" && method === "OtherMethod" ? "RefuseUpdateMethod" : (path === "UpdateHandoffPath" ? "ServeUpdateHandoff" : (path === "BackendPath" ? "ForwardToBackend" : (path === "RootPath" ? "ServeLanding" : (path === "PrivacyPath" ? "ServePrivacy" : (path === "TermsPath" ? "ServeTerms" : (path === "JoinPath" ? "ServeJoin" : (path === "SkillPath" || path === "OwnCatalogSkillPath" ? "ServeSkill" : (path === "OtherCatalogSkillPath" && app === "Ntwrk" ? "ServeSkill" : (path === "CatalogIndexPath" ? "ServeCatalog" : (path === "RobotsPath" ? "ServeRobots" : (path === "PhonePath" && siteHasPage(app, "PhonePage") ? "ServePhone" : (path === "HomeHelpPath" && siteHasPage(app, "HomeHelpPage") ? "ServeHomeHelp" : (path === "PhotosAddPath" && siteHasPage(app, "PhotosAddPage") ? "ServePhotosAdd" : (path === "PhotosCheckPath" && siteHasPage(app, "PhotosCheckPage") ? "ServePhotosCheck" : (path === "PhotosMinePath" && siteHasPage(app, "PhotosMinePage") ? "ServePhotosMine" : (path === "PhotosViewPath" && siteHasPage(app, "PhotosViewPage") ? "ServePhotosView" : "ServeNotFound"))))))))))))))))))));
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
//@ pure
export function lawSettingsAreAlwaysRefused(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "SettingsPath", method) === "RefuseRetired";
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
//@ pure
export function lawJoinServesAFormOnlyWhereTheSiteKeepsIt(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return (routeFor(app, "JoinPath", method) === "ServeJoin") === keepsBrowserJoin(app);
}

/** Story: Old links never open a retired page / A request routes by its path kind, the site and the method (spec/sitePages.md) */
//@ pure
export function lawRetiredJoinReadsGoToLanding(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !(!keepsBrowserJoin(app) && method !== "OtherMethod") || routeFor(app, "JoinPath", method) === "RedirectToLanding";
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
//@ pure
export function isRetiredRoute(route: SiteRoute): boolean {
  return route === "RefuseRetired" || route === "RedirectToLanding" || route === "RefuseMethod";
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
//@ pure
export function answerFor(route: SiteRoute, method: RequestMethod): SiteAnswer {
  return route === "RefuseRetired" || route === "RefuseUpdateHandoff" ? ({ status: 404, noStore: true, hasBody: method !== "HeadMethod", toLanding: false, allowHeader: "" } as SiteAnswer) : (route === "RedirectToLanding" ? ({ status: 302, noStore: true, hasBody: false, toLanding: true, allowHeader: "" } as SiteAnswer) : (route === "RefuseMethod" || route === "RefuseUpdateMethod" ? ({ status: 405, noStore: true, hasBody: false, toLanding: false, allowHeader: siteReadOnlyMethods } as SiteAnswer) : (route === "ServeUpdateHandoff" ? ({ status: 200, noStore: true, hasBody: method !== "HeadMethod", toLanding: false, allowHeader: "" } as SiteAnswer) : (route === "ForwardToBackend" ? ({ status: 0, noStore: false, hasBody: false, toLanding: false, allowHeader: "" } as SiteAnswer) : (route === "ServeNotFound" ? ({ status: 404, noStore: false, hasBody: method !== "HeadMethod", toLanding: false, allowHeader: "" } as SiteAnswer) : ({ status: 200, noStore: false, hasBody: method !== "HeadMethod", toLanding: false, allowHeader: "" } as SiteAnswer))))));
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
//@ pure
export function lawOnlyRefusedWritesHaveAllowHeader(route: SiteRoute, method: RequestMethod): boolean {
  //@ ensures \result === true
  return (answerFor(route, method).allowHeader === siteReadOnlyMethods) === (route === "RefuseMethod" || route === "RefuseUpdateMethod");
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
//@ pure
export function lawRetiredAnswersAreNeverCached(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !isRetiredRoute(routeFor(app, path, method)) || answerFor(routeFor(app, path, method), method).noStore;
}

/** Story: Old links never open a retired page / A retired path answers with no page and is never cached (spec/sitePages.md) */
//@ pure
export function lawRetiredAnswersShowNoPage(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !isRetiredRoute(routeFor(app, path, method)) || answerFor(routeFor(app, path, method), method).status !== 200;
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md) */
//@ pure
export function optInWays(app: brandIdentity_AppKey): OptInWay[] {
  return keepsBrowserJoin(app) ? (["OptInOnJoinPage", "OptInByText"] as OptInWay[]) : (["OptInInAgent", "OptInByText"] as OptInWay[]);
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md) */
//@ pure
export function hasOptInWay(app: brandIdentity_AppKey, way: OptInWay): boolean {
  return optInWays(app).includes(way);
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md) */
//@ pure
export function mayLinkTo(app: brandIdentity_AppKey, path: PathKind): boolean {
  const local_0: SiteRoute = routeFor(app, path, "GetMethod");
  return !isRetiredRoute(local_0) && local_0 !== "ServeNotFound" && local_0 !== "ForwardToBackend" && local_0 !== "RefuseUpdateHandoff";
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md) */
//@ pure
export function lawTermsNameOnlyAServedJoinPage(app: brandIdentity_AppKey, way: OptInWay): boolean {
  //@ ensures \result === true
  return !(way === "OptInOnJoinPage" && hasOptInWay(app, way)) || mayLinkTo(app, "JoinPath");
}

/** Story: Old links never open a retired page / The terms name the join page as a way to opt in only where the site serves it (spec/sitePages.md) */
//@ pure
export function lawTermsAlwaysOfferText(app: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return hasOptInWay(app, "OptInByText");
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md) */
//@ pure
export function servesPage(route: SiteRoute): boolean {
  return route === "ServeLanding" || route === "ServePrivacy" || route === "ServeTerms" || route === "ServeJoin" || route === "ServeUpdateHandoff" || route === "ServeNotFound" || route === "ServePhone" || route === "ServeHomeHelp" || route === "ServePhotosAdd" || route === "ServePhotosCheck" || route === "ServePhotosMine" || route === "ServePhotosView";
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md) */
//@ pure
export function pageOfRoute(route: SiteRoute): SitePage {
  return route === "ServeLanding" ? "LandingPage" : (route === "ServePrivacy" ? "PrivacyPage" : (route === "ServeTerms" ? "TermsPage" : (route === "ServeJoin" ? "JoinPage" : (route === "ServeUpdateHandoff" ? "UpdateHandoffPage" : (route === "ServePhone" ? "PhonePage" : (route === "ServeHomeHelp" ? "HomeHelpPage" : (route === "ServePhotosAdd" ? "PhotosAddPage" : (route === "ServePhotosCheck" ? "PhotosCheckPage" : (route === "ServePhotosMine" ? "PhotosMinePage" : (route === "ServePhotosView" ? "PhotosViewPage" : "NotFoundPage"))))))))));
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md) */
//@ pure
export function lawServedPagesExist(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  const local_1: SiteRoute = routeFor(app, path, method);
  return !servesPage(local_1) || siteHasPage(app, pageOfRoute(local_1));
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md) */
//@ pure
export function lawUnknownPathsShowNotFound(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "UnknownPath", method) === "ServeNotFound";
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md) */
//@ pure
export function lawStepPagesOnlyWhereTheStepIs(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return (routeFor(app, "PhonePath", method) === "ServePhone") === siteHasPage(app, "PhonePage") && (routeFor(app, "HomeHelpPath", method) === "ServeHomeHelp") === siteHasPage(app, "HomeHelpPage") && (routeFor(app, "PhotosAddPath", method) === "ServePhotosAdd") === siteHasPage(app, "PhotosAddPage") && (routeFor(app, "PhotosCheckPath", method) === "ServePhotosCheck") === siteHasPage(app, "PhotosCheckPage") && (routeFor(app, "PhotosMinePath", method) === "ServePhotosMine") === siteHasPage(app, "PhotosMinePage") && (routeFor(app, "PhotosViewPath", method) === "ServePhotosView") === siteHasPage(app, "PhotosViewPage");
}

/** Story: Old links never open a retired page / An unknown path shows the not-found page and every served page exists (spec/sitePages.md) */
//@ pure
export function lawStepPagesAreNeverLinked(page: SitePage): boolean {
  //@ ensures \result === true
  return !isOneStepPage(page) || !footerLinks.includes(page);
}

/** Story: Open an update text in my assistant / The update handoff accepts only a canonical reference on the hub (spec/sitePages.md) */
//@ pure
export function lawUpdateHandoffServesOnlyHubReads(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  return (routeFor(app, path, method) === "ServeUpdateHandoff") === (app === "Ntwrk" && path === "UpdateHandoffPath" && method !== "OtherMethod");
}

/** Story: Open an update text in my assistant / The update handoff accepts only a canonical reference on the hub (spec/sitePages.md) */
//@ pure
export function lawUpdateHandoffNeverUsesTheBackend(app: brandIdentity_AppKey, path: PathKind, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !(path === "UpdateHandoffPath" || path === "MalformedUpdateHandoffPath") || (routeFor(app, path, method) !== "ForwardToBackend" && answerFor(routeFor(app, path, method), method).noStore);
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md) */
//@ pure
export function catalogListsSkillOf(site: brandIdentity_AppKey, owner: brandIdentity_AppKey): boolean {
  return brandIdentity_mayName(site, owner, "CatalogSurface");
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md) */
//@ pure
export function lawAppCatalogListsOnlyItself(site: brandIdentity_AppKey, owner: brandIdentity_AppKey): boolean {
  //@ ensures \result === true
  return !(site !== "Ntwrk" && owner !== site) || !catalogListsSkillOf(site, owner);
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md) */
//@ pure
export function lawEveryCatalogListsItsOwnSkill(site: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return catalogListsSkillOf(site, site) && routeFor(site, "OwnCatalogSkillPath", method) === "ServeSkill";
}

/** Story: Let my agent read the signup skill from the site / Each site serves its own skill at /SKILL.md and lists it in its catalog (spec/sitePages.md) */
//@ pure
export function lawCatalogRouteFollowsListing(site: brandIdentity_AppKey, owner: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return !(owner !== site) || (routeFor(site, "OtherCatalogSkillPath", method) === "ServeSkill") === catalogListsSkillOf(site, owner);
}

/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md) */
//@ pure
export function skillContentType(doc: SkillDoc): string {
  return doc === "CatalogIndex" ? "application/json" : "text/plain; charset=utf-8";
}

/** Story: Let my agent read the signup skill from the site / Skill files are plain text that any origin can read (spec/sitePages.md) */
//@ pure
export function lawSkillTextIsPlainText(doc: SkillDoc): boolean {
  //@ ensures \result === true
  return !(doc !== "CatalogIndex") || skillContentType(doc) === "text/plain; charset=utf-8";
}

/** Story: Let my agent read the signup skill from the site / Backend paths go to the shared backend (spec/sitePages.md) */
//@ pure
export function lawBackendPathsAreForwarded(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "BackendPath", method) === "ForwardToBackend";
}

/** Story: Let my agent read the signup skill from the site / Backend paths go to the shared backend (spec/sitePages.md) */
//@ pure
export function lawRetiredPathsNeverReachTheBackend(app: brandIdentity_AppKey, method: RequestMethod): boolean {
  //@ ensures \result === true
  return routeFor(app, "SettingsPath", method) !== "ForwardToBackend" && routeFor(app, "JoinPath", method) !== "ForwardToBackend";
}
