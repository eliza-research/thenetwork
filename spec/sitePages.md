# Site pages

This spec owns the page set of each public site and the route that each request path gets. The site router (the Pages Worker of each site) gets the retired paths, the update handoff paths and the backend paths. It classifies the path and the method, calls these decisions, and writes the response. The static host gets every other path, and serves the pages, the agent skill files and robots.txt. Its answers must agree with the same decisions. The shared backend answers every backend path. Brand data comes from [brand identity](./brandIdentity.md). The landing page itself is in [landing entry](./landingEntry.md).

## Story: Read the pages of the site

> As a person who opens a site, I want a small set of pages that each link the privacy policy and the terms, so that I can find the legal text from any page.

### Every site serves public pages and each special page has one site

Each site has a landing page, a privacy page, terms and a not-found page. peon.biz keeps its browser join page. The other sites send a person to their agent or to Messages to join. ntwrk.party hosts the update handoff for all apps.

```quint
import brandIdentity.* from "./brandIdentity"

type SitePage = LandingPage | PrivacyPage | TermsPage | NotFoundPage | JoinPage | UpdateHandoffPage

pure val sitePageList: List[SitePage] = List(LandingPage, PrivacyPage, TermsPage, NotFoundPage, JoinPage, UpdateHandoffPage)

pure def keepsBrowserJoin(app: AppKey): bool = siteUsesPart(app, PartJoinFlow)

pure def siteHasPage(app: AppKey, page: SitePage): bool =
  if (page == JoinPage) keepsBrowserJoin(app)
  else if (page == UpdateHandoffPage) app == Ntwrk
  else true

pure def lawJoinPageOnlyOnPeon(app: AppKey): bool = siteHasPage(app, JoinPage) iff (app == Peon)
```

### Every page links the privacy policy and the terms in its footer

The footer of each page has two links: Privacy, then Terms. The landing footer has no other link. Both linked pages exist on every site.

```quint
pure val footerLinks: List[SitePage] = List(PrivacyPage, TermsPage)

pure def footerOf(page: SitePage): List[SitePage] = footerLinks

pure def lawEveryFooterIsPrivacyThenTerms(app: AppKey, page: SitePage): bool =
  siteHasPage(app, page) implies (footerOf(page).length() == 2 and footerOf(page).nth(0) == PrivacyPage and footerOf(page).nth(1) == TermsPage)

pure def lawLandingFooterHasNoOtherLink(otherPage: SitePage): bool =
  footerOf(LandingPage).includes(otherPage) implies (otherPage == PrivacyPage or otherPage == TermsPage)

pure def lawFooterLinksExistOnEverySite(app: AppKey, page: SitePage): bool =
  footerLinks.includes(page) implies siteHasPage(app, page)
```

### The terms page has a text messaging section that a link can open

The section has the anchor `sms`. It describes the program, how a person opts in, the message frequency, STOP for every app on the number, "leave" and the domain for one app, START, HELP, the costs, and that no number is shared for marketing.

```quint
type SmsTermsItem = SmsProgram | SmsOptIn | SmsFrequency | SmsStopEverything | SmsLeaveOne |
  SmsStartAgain | SmsHelp | SmsCosts | SmsNoMarketingShare

pure val smsTermsAnchor = "sms"

pure val smsTermsItems: List[SmsTermsItem] = List(SmsProgram, SmsOptIn, SmsFrequency, SmsStopEverything,
  SmsLeaveOne, SmsStartAgain, SmsHelp, SmsCosts, SmsNoMarketingShare)

pure def lawSmsTermsCoverStopAndLeave(termsItem: SmsTermsItem): bool =
  (termsItem == SmsStopEverything or termsItem == SmsLeaveOne) implies smsTermsItems.includes(termsItem)
```

## Story: Old links never open a retired page

> As a person who follows an old link, I want the site to refuse a retired settings page and to send a retired join link to the landing page, so that I never see an old account page or an old signup form.

### A request routes by its path kind, the site and the method

The router classifies retired paths, update handoff paths and backend paths before static files. The settings paths are retired on every site. The join paths are retired on every site that does not keep a browser join. A GET or HEAD to a retired join path goes to the landing page. Another method on a retired join path is refused.

```quint
type PathKind = RootPath | PrivacyPath | TermsPath | JoinPath | SettingsPath | SkillPath |
  CatalogIndexPath | OwnCatalogSkillPath | OtherCatalogSkillPath | BackendPath | RobotsPath |
  UpdateHandoffPath | MalformedUpdateHandoffPath | UnknownPath
type RequestMethod = GetMethod | HeadMethod | OtherMethod
type SiteRoute = ServeLanding | ServePrivacy | ServeTerms | ServeJoin | ServeSkill | ServeCatalog |
  ServeRobots | ServeUpdateHandoff | RefuseUpdateHandoff | RefuseUpdateMethod | ForwardToBackend | ServeNotFound |
  RefuseRetired | RedirectToLanding | RefuseMethod

pure val retiredSettingsPaths: Set[str] = Set("/settings", "/settings/", "/settings.html")
pure val retiredJoinPaths: Set[str] = Set("/join", "/join/", "/join.html")
pure val updateHandoffAssetPath = "/_update-handoff"

pure def routeFor(app: AppKey, path: PathKind, method: RequestMethod): SiteRoute =
  if (path == SettingsPath) RefuseRetired
  else if (path == JoinPath and not(keepsBrowserJoin(app)) and method == OtherMethod) RefuseMethod
  else if (path == JoinPath and not(keepsBrowserJoin(app))) RedirectToLanding
  else if (path == MalformedUpdateHandoffPath or (path == UpdateHandoffPath and not(siteHasPage(app, UpdateHandoffPage)))) RefuseUpdateHandoff
  else if (path == UpdateHandoffPath and method == OtherMethod) RefuseUpdateMethod
  else if (path == UpdateHandoffPath) ServeUpdateHandoff
  else if (path == BackendPath) ForwardToBackend
  else if (path == RootPath) ServeLanding
  else if (path == PrivacyPath) ServePrivacy
  else if (path == TermsPath) ServeTerms
  else if (path == JoinPath) ServeJoin
  else if (path == SkillPath or path == OwnCatalogSkillPath) ServeSkill
  else if (path == OtherCatalogSkillPath and app == Ntwrk) ServeSkill
  else if (path == CatalogIndexPath) ServeCatalog
  else if (path == RobotsPath) ServeRobots
  else ServeNotFound

pure def lawSettingsAreAlwaysRefused(app: AppKey, method: RequestMethod): bool =
  routeFor(app, SettingsPath, method) == RefuseRetired

pure def lawJoinServesAFormOnlyWhereTheSiteKeepsIt(app: AppKey, method: RequestMethod): bool =
  (routeFor(app, JoinPath, method) == ServeJoin) iff keepsBrowserJoin(app)

pure def lawRetiredJoinReadsGoToLanding(app: AppKey, method: RequestMethod): bool =
  (not(keepsBrowserJoin(app)) and method != OtherMethod) implies routeFor(app, JoinPath, method) == RedirectToLanding
```

### A retired path answers with no page and is never cached

A retired settings path answers 404 with a short text body, and with no body for HEAD. A retired join read answers 302 to the landing page with no body. A retired join write and a write to a valid hub update handoff answer 405 with `Allow: GET, HEAD`. The other site answers omit the Allow header. Every retired answer carries `no-store`, so a cache never keeps an old page. The not-found page answers 404. A backend path gets its answer from the backend, so its site answer has status 0.

```quint
type SiteAnswer = { status: int, noStore: bool, hasBody: bool, toLanding: bool, allowHeader: str }
pure val siteReadOnlyMethods = "GET, HEAD"

pure def isRetiredRoute(route: SiteRoute): bool =
  route == RefuseRetired or route == RedirectToLanding or route == RefuseMethod

pure def answerFor(route: SiteRoute, method: RequestMethod): SiteAnswer =
  if (route == RefuseRetired or route == RefuseUpdateHandoff) { status: 404, noStore: true, hasBody: method != HeadMethod, toLanding: false, allowHeader: "" }
  else if (route == RedirectToLanding) { status: 302, noStore: true, hasBody: false, toLanding: true, allowHeader: "" }
  else if (route == RefuseMethod or route == RefuseUpdateMethod) { status: 405, noStore: true, hasBody: false, toLanding: false, allowHeader: siteReadOnlyMethods }
  else if (route == ServeUpdateHandoff) { status: 200, noStore: true, hasBody: method != HeadMethod, toLanding: false, allowHeader: "" }
  else if (route == ForwardToBackend) { status: 0, noStore: false, hasBody: false, toLanding: false, allowHeader: "" }
  else if (route == ServeNotFound) { status: 404, noStore: false, hasBody: method != HeadMethod, toLanding: false, allowHeader: "" }
  else { status: 200, noStore: false, hasBody: method != HeadMethod, toLanding: false, allowHeader: "" }

pure def lawOnlyRefusedWritesHaveAllowHeader(route: SiteRoute, method: RequestMethod): bool =
  answerFor(route, method).allowHeader == siteReadOnlyMethods iff (route == RefuseMethod or route == RefuseUpdateMethod)

pure def lawRetiredAnswersAreNeverCached(app: AppKey, path: PathKind, method: RequestMethod): bool =
  isRetiredRoute(routeFor(app, path, method)) implies answerFor(routeFor(app, path, method), method).noStore

pure def lawRetiredAnswersShowNoPage(app: AppKey, path: PathKind, method: RequestMethod): bool =
  isRetiredRoute(routeFor(app, path, method)) implies answerFor(routeFor(app, path, method), method).status != 200
```

### The terms name the join page as a way to opt in only where the site serves it

A page links only to a path that the site serves. The text messaging terms tell how a person opts in. On peon.biz the person opts in on the join page or by text. On every other site the person opts in through the app's agent skill or by text, and the terms never name or link a join page.

```quint
type OptInWay = OptInOnJoinPage | OptInInAgent | OptInByText

pure def optInWays(app: AppKey): List[OptInWay] =
  if (keepsBrowserJoin(app)) List(OptInOnJoinPage, OptInByText) else List(OptInInAgent, OptInByText)

pure def hasOptInWay(app: AppKey, way: OptInWay): bool = optInWays(app).includes(way)

pure def mayLinkTo(app: AppKey, path: PathKind): bool =
  val route = routeFor(app, path, GetMethod)
  not(isRetiredRoute(route)) and route != ServeNotFound and route != ForwardToBackend and route != RefuseUpdateHandoff

pure def lawTermsNameOnlyAServedJoinPage(app: AppKey, way: OptInWay): bool =
  (way == OptInOnJoinPage and hasOptInWay(app, way)) implies mayLinkTo(app, JoinPath)

pure def lawTermsAlwaysOfferText(app: AppKey): bool = hasOptInWay(app, OptInByText)
```

### An unknown path shows the not-found page and every served page exists

A path that is not a page, a skill file, robots.txt or a backend path shows the not-found page of the site. A route that serves a page never serves a page that the site does not have.

```quint
pure def servesPage(route: SiteRoute): bool =
  route == ServeLanding or route == ServePrivacy or route == ServeTerms or route == ServeJoin or
    route == ServeUpdateHandoff or route == ServeNotFound

pure def pageOfRoute(route: SiteRoute): SitePage =
  if (route == ServeLanding) LandingPage
  else if (route == ServePrivacy) PrivacyPage
  else if (route == ServeTerms) TermsPage
  else if (route == ServeJoin) JoinPage
  else if (route == ServeUpdateHandoff) UpdateHandoffPage
  else NotFoundPage

pure def lawServedPagesExist(app: AppKey, path: PathKind, method: RequestMethod): bool =
  val route = routeFor(app, path, method)
  servesPage(route) implies siteHasPage(app, pageOfRoute(route))

pure def lawUnknownPathsShowNotFound(app: AppKey, method: RequestMethod): bool =
  routeFor(app, UnknownPath, method) == ServeNotFound
```

## Story: Open an update text in my assistant

> As a person who receives an update link by text, I want to choose my assistant without exposing my update on the web.

### The update handoff accepts only a canonical reference on the hub

Only `GET` and `HEAD` to `/t/<reference>` on ntwrk.party serve the handoff. The route takes the exact uppercase reference from the path in the format used by the notification service. Malformed paths and direct requests for the private build template answer 404. A non-read method on a valid hub path answers 405. The handoff is not cached, indexed, or sent as a referrer. It has no script or automatic redirect. It uses no account session or notification lookup and contains only assistant links derived from the reference. The assistant reads an update through its authenticated connector as specified in [agent entry](agentEntry.md).

```quint
pure def lawUpdateHandoffServesOnlyHubReads(app: AppKey, path: PathKind, method: RequestMethod): bool =
  (routeFor(app, path, method) == ServeUpdateHandoff) iff
    (app == Ntwrk and path == UpdateHandoffPath and method != OtherMethod)

pure def lawUpdateHandoffNeverUsesTheBackend(app: AppKey, path: PathKind, method: RequestMethod): bool =
  (path == UpdateHandoffPath or path == MalformedUpdateHandoffPath) implies
    (routeFor(app, path, method) != ForwardToBackend and answerFor(routeFor(app, path, method), method).noStore)
```

## Story: Let my agent read the signup skill from the site

> As an agent that a person asks to sign them up, I want each site to serve its skill and a skill catalog at fixed paths, so that I can read the exact instructions for the app that the person chose.

### Each site serves its own skill at /SKILL.md and lists it in its catalog

The site serves its skill at `/SKILL.md` and at `/.well-known/agent-skills/<skill>/SKILL.md` with the same bytes. A `version` query does not change the bytes. The catalog at `/.well-known/agent-skills/index.json` lists each skill with its path and a SHA-256 digest of its bytes. An app site lists only its own skill, and a request for the skill path of another app shows the not-found page. ntwrk.party is the hub, and its catalog lists and serves the skill of every app. [Brand identity](./brandIdentity.md) records this as the one place outside its legal pages where ntwrk.party names the apps.

```quint
pure def catalogListsSkillOf(site: AppKey, owner: AppKey): bool = mayName(site, owner, CatalogSurface)

pure def lawAppCatalogListsOnlyItself(site: AppKey, owner: AppKey): bool =
  (site != Ntwrk and owner != site) implies not(catalogListsSkillOf(site, owner))

pure def lawEveryCatalogListsItsOwnSkill(site: AppKey, method: RequestMethod): bool =
  catalogListsSkillOf(site, site) and (routeFor(site, OwnCatalogSkillPath, method) == ServeSkill)

pure def lawCatalogRouteFollowsListing(site: AppKey, owner: AppKey, method: RequestMethod): bool =
  (owner != site) implies ((routeFor(site, OtherCatalogSkillPath, method) == ServeSkill) iff catalogListsSkillOf(site, owner))
```

### Skill files are plain text that any origin can read

A skill file has the type `text/plain; charset=utf-8`. The catalog has the type `application/json`. Both allow every origin to read them and stay in a cache for 300 seconds.

```quint
type SkillDoc = RootSkill | CatalogIndex | CatalogSkill

pure def skillContentType(doc: SkillDoc): str =
  if (doc == CatalogIndex) "application/json" else "text/plain; charset=utf-8"

pure val skillAllowOrigin = "*"
pure val skillCacheSeconds = 300

pure def lawSkillTextIsPlainText(doc: SkillDoc): bool =
  doc != CatalogIndex implies skillContentType(doc) == "text/plain; charset=utf-8"
```

### Backend paths go to the shared backend

The router forwards `/api`, `/mcp`, `/oauth/` and `/.well-known/oauth-` paths to the shared backend on every site. A retired path never reaches the backend.

```quint
pure def lawBackendPathsAreForwarded(app: AppKey, method: RequestMethod): bool =
  routeFor(app, BackendPath, method) == ForwardToBackend

pure def lawRetiredPathsNeverReachTheBackend(app: AppKey, method: RequestMethod): bool =
  routeFor(app, SettingsPath, method) != ForwardToBackend and routeFor(app, JoinPath, method) != ForwardToBackend
```
